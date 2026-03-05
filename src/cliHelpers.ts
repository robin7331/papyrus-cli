import { InvalidArgumentError } from "commander";
import { basename, dirname, extname, join, relative } from "node:path";

export type CliOptions = {
  output?: string;
  model: string;
  concurrency?: number;
  yes?: boolean;
  format?: string;
  instructions?: string;
  prompt?: string;
  promptFile?: string;
};

export function parseFormat(value: string): string {
  const normalized = value.trim().replace(/^\.+/, "");
  if (!normalized) {
    throw new InvalidArgumentError("Format must be a non-empty file extension.");
  }

  if (normalized.includes("/") || normalized.includes("\\")) {
    throw new InvalidArgumentError("Format must be a file extension, not a path.");
  }

  return normalized;
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

export function defaultOutputPath(inputPath: string, extension: string): string {
  const normalizedExtension = extension.startsWith(".") ? extension : `.${extension}`;

  if (extname(inputPath).toLowerCase() === ".pdf") {
    return inputPath.slice(0, -4) + normalizedExtension;
  }

  return inputPath + normalizedExtension;
}

export function resolveFolderOutputPath(
  inputPath: string,
  inputRoot: string,
  outputRoot: string | undefined,
  extension: string
): string {
  if (!outputRoot) {
    return defaultOutputPath(inputPath, extension);
  }

  const relativePath = relative(inputRoot, inputPath);
  const relativeDir = dirname(relativePath);
  const base = basename(relativePath, extname(relativePath));
  const normalizedExtension = extension.startsWith(".") ? extension.slice(1) : extension;
  const filename = `${base}.${normalizedExtension}`;

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
