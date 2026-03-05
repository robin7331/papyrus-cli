#!/usr/bin/env node

import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { Command, InvalidArgumentError } from "commander";
import {
  convertPdf,
  type ConversionMode,
  type OutputFormat
} from "./openaiPdfToMarkdown.js";

const program = new Command();

type CliOptions = {
  output?: string;
  model: string;
  mode: ConversionMode;
  format?: OutputFormat;
  instructions?: string;
  prompt?: string;
  promptFile?: string;
};

program
  .name("papyrus-cli")
  .description("Convert PDF files to Markdown or text using the OpenAI Agents SDK")
  .argument("<input>", "Path to the input PDF")
  .option("-o, --output <path>", "Path to the output file")
  .option("-m, --model <model>", "OpenAI model to use", "gpt-5")
  .option("--mode <mode>", "Conversion mode: auto or prompt", parseMode, "auto")
  .option("--format <format>", "Output format override: md or txt", parseFormat)
  .option(
    "--instructions <text>",
    "Additional conversion instructions for auto mode"
  )
  .option("--prompt <text>", "Custom prompt text for prompt mode")
  .option("--prompt-file <path>", "Path to file containing prompt text for prompt mode")
  .action(async (input: string, options: CliOptions) => {
    const inputPath = resolve(input);
    const startedAt = Date.now();

    try {
      validateOptionCombination(options);

      const promptText = await resolvePromptText(options);
      const result = await convertPdf({
        inputPath,
        model: options.model,
        mode: options.mode,
        format: options.format,
        instructions: options.instructions,
        promptText
      });

      const outputPath = resolve(options.output ?? defaultOutputPath(inputPath, result.format));
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, result.content, "utf8");

      console.log(`Output (${result.format}) written to: ${outputPath}`);
      console.log(`Duration: ${((Date.now() - startedAt) / 1000).toFixed(2)}s`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Conversion failed: ${message}`);
      console.error(`Duration: ${((Date.now() - startedAt) / 1000).toFixed(2)}s`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);

function parseMode(value: string): ConversionMode {
  if (value === "auto" || value === "prompt") {
    return value;
  }

  throw new InvalidArgumentError("Mode must be either 'auto' or 'prompt'.");
}

function parseFormat(value: string): OutputFormat {
  if (value === "md" || value === "txt") {
    return value;
  }

  throw new InvalidArgumentError("Format must be either 'md' or 'txt'.");
}

function validateOptionCombination(options: CliOptions): void {
  if (options.mode === "prompt") {
    const promptSourceCount = Number(Boolean(options.prompt)) + Number(Boolean(options.promptFile));
    if (promptSourceCount !== 1) {
      throw new Error("Prompt mode requires exactly one of --prompt or --prompt-file.");
    }

    if (options.instructions) {
      throw new Error("--instructions is only supported in auto mode.");
    }

    return;
  }

  if (options.prompt || options.promptFile) {
    throw new Error("--prompt and --prompt-file are only supported in prompt mode.");
  }
}

async function resolvePromptText(options: CliOptions): Promise<string | undefined> {
  if (options.mode !== "prompt") {
    return undefined;
  }

  if (options.prompt) {
    const prompt = options.prompt.trim();
    if (!prompt) {
      throw new Error("--prompt cannot be empty.");
    }

    return prompt;
  }

  if (!options.promptFile) {
    return undefined;
  }

  const promptPath = resolve(options.promptFile);
  const promptFromFile = (await readFile(promptPath, "utf8")).trim();
  if (!promptFromFile) {
    throw new Error("--prompt-file must contain non-empty text.");
  }

  return promptFromFile;
}

function defaultOutputPath(inputPath: string, format: OutputFormat): string {
  const extension = format === "md" ? ".md" : ".txt";

  if (extname(inputPath).toLowerCase() === ".pdf") {
    return inputPath.slice(0, -4) + extension;
  }

  return inputPath + extension;
}
