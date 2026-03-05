import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { Agent, run } from "@openai/agents";
import OpenAI from "openai";
import { z } from "zod";

export type ConvertOptions = {
  inputPath: string;
  model: string;
  mode: ConversionMode;
  format?: OutputFormat;
  instructions?: string;
  promptText?: string;
};

export type ConversionMode = "auto" | "prompt";
export type OutputFormat = "md" | "txt";

export type ConvertResult = {
  format: OutputFormat;
  content: string;
  usage: ConvertUsage;
};

export type ConvertUsage = {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

const AUTO_RESPONSE_SCHEMA = z.object({
  format: z.enum(["md", "txt"]),
  content: z.string().min(1)
});

export async function convertPdf(options: ConvertOptions): Promise<ConvertResult> {
  const inputPath = resolve(options.inputPath);
  await access(inputPath);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const client = new OpenAI({ apiKey });

  const uploaded = await client.files.create({
    file: createReadStream(inputPath),
    purpose: "user_data"
  });

  const agent = new Agent({
    name: "PDF Converter",
    instructions: "You convert PDF files precisely according to the requested output format.",
    model: options.model
  });

  const promptText = buildPromptText(options);
  const result = await run(agent, [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: promptText
        },
        {
          type: "input_file",
          file: { id: uploaded.id }
        }
      ]
    }
  ]);

  const rawOutput = (result.finalOutput ?? "").trim();
  if (!rawOutput) {
    throw new Error("No content returned by the API.");
  }

  const usage: ConvertUsage = {
    requests: result.state.usage.requests,
    inputTokens: result.state.usage.inputTokens,
    outputTokens: result.state.usage.outputTokens,
    totalTokens: result.state.usage.totalTokens
  };

  if (options.mode === "auto" && !options.format) {
    return { ...parseAutoResponse(rawOutput), usage };
  }

  const format = options.format ?? "txt";
  return { format, content: rawOutput, usage };
}

function buildPromptText(options: ConvertOptions): string {
  if (options.mode === "prompt") {
    if (!options.promptText) {
      throw new Error("promptText is required when mode is 'prompt'.");
    }

    const promptModeParts = [
      "Apply the following user prompt to the PDF.",
      "Return only the final converted content.",
      `User prompt:\n${options.promptText}`
    ];

    if (options.format === "md") {
      promptModeParts.push("Output format requirement: Return only GitHub-flavored Markdown.");
    } else if (options.format === "txt") {
      promptModeParts.push("Output format requirement: Return plain text only and do not use Markdown syntax.");
    } else {
      promptModeParts.push("If the prompt does not enforce a format, prefer plain text without Markdown syntax.");
    }

    return promptModeParts.join("\n\n");
  }

  if (options.format === "md") {
    return withAdditionalInstructions(
      [
        "Convert this PDF into clean GitHub-flavored Markdown.",
        "Preserve headings, paragraphs, lists, and tables.",
        "Render tables as Markdown pipe tables with header separators.",
        "If cells are empty due to merged cells, keep the table readable and consistent.",
        "Return only Markdown without code fences."
      ].join(" "),
      options.instructions
    );
  }

  if (options.format === "txt") {
    return withAdditionalInstructions(
      [
        "Convert this PDF into clean plain text.",
        "Preserve reading order and paragraph boundaries.",
        "Represent tables in readable plain text (no Markdown syntax).",
        "Return plain text only and do not use Markdown syntax or code fences."
      ].join(" "),
      options.instructions
    );
  }

  return withAdditionalInstructions(
    [
      "Decide the best output format for this PDF: Markdown ('md') or plain text ('txt').",
      "Choose 'md' for documents with meaningful headings, lists, and tables that benefit from Markdown.",
      "Choose 'txt' for mostly linear text where Markdown adds little value.",
      "Respond with JSON only, using this exact schema:",
      "{\"format\":\"md|txt\",\"content\":\"<converted content>\"}",
      "If format is 'md', use clean GitHub-flavored Markdown and pipe tables where appropriate.",
      "If format is 'txt', output plain text only and do not use Markdown syntax.",
      "Do not wrap the JSON in code fences."
    ].join("\n"),
    options.instructions
  );
}

function withAdditionalInstructions(base: string, additional?: string): string {
  if (!additional) {
    return base;
  }

  return `${base}\n\nAdditional user instructions:\n${additional}`;
}

function parseAutoResponse(rawOutput: string): Omit<ConvertResult, "usage"> {
  let candidate = rawOutput.trim();

  const fencedMatch = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    candidate = fencedMatch[1].trim();
  }

  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    throw new Error("Auto mode response is not valid JSON.");
  }

  const jsonPayload = candidate.slice(firstBrace, lastBrace + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonPayload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse auto mode JSON response: ${message}`);
  }

  const validated = AUTO_RESPONSE_SCHEMA.safeParse(parsed);
  if (!validated.success) {
    throw new Error("Auto mode JSON must match { format: 'md' | 'txt', content: string }.");
  }

  const content = validated.data.content.trim();
  if (!content) {
    throw new Error("Auto mode returned empty content.");
  }

  return { format: validated.data.format, content };
}
