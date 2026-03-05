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

const RATE_LIMIT_MAX_RETRIES = parsePositiveIntEnv("PAPYRUS_RATE_LIMIT_MAX_RETRIES", 8);
const RATE_LIMIT_BASE_DELAY_MS = parsePositiveIntEnv("PAPYRUS_RATE_LIMIT_BASE_DELAY_MS", 2_000);
const RATE_LIMIT_MAX_DELAY_MS = parsePositiveIntEnv("PAPYRUS_RATE_LIMIT_MAX_DELAY_MS", 120_000);

export async function convertPdf(options: ConvertOptions): Promise<ConvertResult> {
  const inputPath = resolve(options.inputPath);
  await access(inputPath);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const client = new OpenAI({ apiKey });

  const uploaded = await withRateLimitRetry("file upload", () =>
    client.files.create({
      file: createReadStream(inputPath),
      purpose: "user_data"
    })
  );

  const agent = new Agent({
    name: "PDF Converter",
    instructions: "You convert PDF files precisely according to the requested output format.",
    model: options.model
  });

  const promptText = buildPromptText(options);
  const result = await withRateLimitRetry("model run", () =>
    run(agent, [
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
    ])
  );

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

async function withRateLimitRetry<T>(operationName: string, operation: () => Promise<T>): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetriableRateLimitError(error) || attempt >= RATE_LIMIT_MAX_RETRIES) {
        throw error;
      }

      const retryAfterMs = getRetryAfterMs(error);
      const exponentialBackoffMs = RATE_LIMIT_BASE_DELAY_MS * (2 ** attempt);
      const jitterMs = Math.floor(Math.random() * 750);
      const computedDelayMs = retryAfterMs ?? (exponentialBackoffMs + jitterMs);
      const waitMs = clampDelayMs(computedDelayMs, RATE_LIMIT_MAX_DELAY_MS);
      const nextAttempt = attempt + 2;
      const totalAttempts = RATE_LIMIT_MAX_RETRIES + 1;
      const reason = extractErrorMessage(error);

      console.warn(
        `[retry] ${operationName} hit OpenAI rate limits. Waiting ${formatDelay(waitMs)} before retry ${nextAttempt}/${totalAttempts}. ${reason}`
      );

      await sleep(waitMs);
      attempt += 1;
    }
  }
}

function isRetriableRateLimitError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as {
    status?: unknown;
    code?: unknown;
    type?: unknown;
    error?: { code?: unknown; type?: unknown; message?: unknown };
    message?: unknown;
  };

  if (candidate.status === 429) {
    const code = typeof candidate.code === "string" ? candidate.code : undefined;
    const nestedCode = typeof candidate.error?.code === "string" ? candidate.error.code : undefined;
    if (code === "insufficient_quota" || nestedCode === "insufficient_quota") {
      return false;
    }

    return true;
  }

  const searchableText = [
    toLowerCaseIfString(candidate.code),
    toLowerCaseIfString(candidate.type),
    toLowerCaseIfString(candidate.error?.code),
    toLowerCaseIfString(candidate.error?.type),
    toLowerCaseIfString(candidate.message),
    toLowerCaseIfString(candidate.error?.message)
  ]
    .filter(Boolean)
    .join(" ");

  if (searchableText.includes("insufficient_quota")) {
    return false;
  }

  return (
    searchableText.includes("rate_limit") ||
    searchableText.includes("rate limit") ||
    searchableText.includes("too many requests")
  );
}

function getRetryAfterMs(error: unknown): number | undefined {
  const headerDelay = getRetryAfterMsFromHeaders(error);
  if (typeof headerDelay === "number" && Number.isFinite(headerDelay) && headerDelay >= 0) {
    return headerDelay;
  }

  const textDelay = getRetryAfterMsFromText(extractErrorMessage(error));
  if (typeof textDelay === "number" && Number.isFinite(textDelay) && textDelay >= 0) {
    return textDelay;
  }

  return undefined;
}

function getRetryAfterMsFromHeaders(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const candidate = error as {
    headers?: unknown;
    response?: { headers?: unknown };
  };

  const retryAfterMsHeader = readHeader(candidate.headers, "retry-after-ms")
    ?? readHeader(candidate.response?.headers, "retry-after-ms");
  if (retryAfterMsHeader) {
    const milliseconds = Number.parseInt(retryAfterMsHeader, 10);
    if (Number.isFinite(milliseconds) && milliseconds >= 0) {
      return milliseconds;
    }
  }

  const retryAfterHeader = readHeader(candidate.headers, "retry-after")
    ?? readHeader(candidate.response?.headers, "retry-after");
  if (!retryAfterHeader) {
    return undefined;
  }

  const seconds = Number.parseFloat(retryAfterHeader);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.round(seconds * 1_000));
  }

  const parsedDate = Date.parse(retryAfterHeader);
  if (Number.isFinite(parsedDate)) {
    return Math.max(0, parsedDate - Date.now());
  }

  return undefined;
}

function getRetryAfterMsFromText(message: string): number | undefined {
  const match = message.match(
    /(?:try again in|retry after)\s*([0-9]+(?:\.[0-9]+)?)\s*(ms|msec|millisecond|milliseconds|s|sec|second|seconds|m|min|minute|minutes)?/i
  );
  if (!match) {
    return undefined;
  }

  const rawValue = Number.parseFloat(match[1] ?? "");
  if (!Number.isFinite(rawValue) || rawValue < 0) {
    return undefined;
  }

  const unit = (match[2] ?? "s").toLowerCase();
  if (unit === "ms" || unit === "msec" || unit === "millisecond" || unit === "milliseconds") {
    return Math.round(rawValue);
  }

  if (unit === "m" || unit === "min" || unit === "minute" || unit === "minutes") {
    return Math.round(rawValue * 60_000);
  }

  return Math.round(rawValue * 1_000);
}

function readHeader(headersLike: unknown, headerName: string): string | undefined {
  if (!headersLike) {
    return undefined;
  }

  if (
    typeof headersLike === "object"
    && "get" in headersLike
    && typeof (headersLike as { get?: unknown }).get === "function"
  ) {
    const value = (headersLike as { get: (name: string) => string | null }).get(headerName);
    return value ?? undefined;
  }

  if (typeof headersLike !== "object") {
    return undefined;
  }

  const headersRecord = headersLike as Record<string, unknown>;
  const lowerTarget = headerName.toLowerCase();
  for (const [key, value] of Object.entries(headersRecord)) {
    if (key.toLowerCase() !== lowerTarget) {
      continue;
    }

    if (typeof value === "string") {
      return value;
    }

    if (Array.isArray(value)) {
      const first = value.find((entry) => typeof entry === "string");
      return typeof first === "string" ? first : undefined;
    }
  }

  return undefined;
}

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function clampDelayMs(value: number, max: number): number {
  return Math.max(250, Math.min(Math.round(value), max));
}

function formatDelay(milliseconds: number): string {
  if (milliseconds < 1_000) {
    return `${milliseconds}ms`;
  }

  const seconds = milliseconds / 1_000;
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown; error?: { message?: unknown } }).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }

    const nestedMessage = (error as { error?: { message?: unknown } }).error?.message;
    if (typeof nestedMessage === "string" && nestedMessage.trim().length > 0) {
      return nestedMessage;
    }
  }

  return String(error);
}

function toLowerCaseIfString(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, milliseconds);
  });
}
