import { InvalidArgumentError } from "commander";
import { basename, dirname, extname, join, relative } from "node:path";
import { type OutputFormat } from "./openaiPdfToMarkdown.js";

export type CliOptions = {
  output?: string;
  model: string;
  concurrency?: number;
  yes?: boolean;
  format?: OutputFormat;
  instructions?: string;
  prompt?: string;
  promptFile?: string;
};

export function parseFormat(value: string): OutputFormat {
  if (value === "md" || value === "txt") {
    return value;
  }

  throw new InvalidArgumentError("Format must be either 'md' or 'txt'.");
}

export function parseConcurrency(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new InvalidArgumentError("Concurrency must be an integer between 1 and 100.");
  }

  return parsed;
}

export function validateOptionCombination(options: CliOptions): void {
  const promptSourceCount = Number(Boolean(options.prompt)) + Number(Boolean(options.promptFile));
  if (promptSourceCount > 1) {
    throw new Error("Use exactly one of --prompt or --prompt-file.");
  }

  if (promptSourceCount === 1 && options.instructions) {
    throw new Error("--instructions cannot be combined with --prompt or --prompt-file.");
  }
}

export function defaultOutputPath(inputPath: string, format: OutputFormat): string {
  const extension = format === "md" ? ".md" : ".txt";

  if (extname(inputPath).toLowerCase() === ".pdf") {
    return inputPath.slice(0, -4) + extension;
  }

  return inputPath + extension;
}

export function resolveFolderOutputPath(
  inputPath: string,
  inputRoot: string,
  outputRoot: string | undefined,
  format: OutputFormat
): string {
  if (!outputRoot) {
    return defaultOutputPath(inputPath, format);
  }

  const relativePath = relative(inputRoot, inputPath);
  const relativeDir = dirname(relativePath);
  const base = basename(relativePath, extname(relativePath));
  const filename = `${base}.${format}`;

  if (relativeDir === ".") {
    return join(outputRoot, filename);
  }

  return join(outputRoot, relativeDir, filename);
}

export function isPdfPath(inputPath: string): boolean {
  return extname(inputPath).toLowerCase() === ".pdf";
}

export function looksLikeFileOutput(outputPath: string): boolean {
  const outputExt = extname(outputPath).toLowerCase();
  return outputExt === ".md" || outputExt === ".txt";
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength <= 3) {
    return value.slice(0, maxLength);
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

export function formatDurationMs(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(2)}s`;
}
