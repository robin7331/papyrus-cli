#!/usr/bin/env node

import "dotenv/config";
import { readFileSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { Command } from "commander";
import {
  clearStoredApiKey,
  getConfigFilePath,
  getStoredApiKey,
  maskApiKey,
  setStoredApiKey
} from "./config.js";
import {
  convertPdf,
  type ConvertUsage
} from "./openaiPdfToMarkdown.js";
import {
  defaultOutputPath,
  formatDurationMs,
  isPdfPath,
  looksLikeFileOutput,
  parseConcurrency,
  parseFormat,
  parseMode,
  resolveFolderOutputPath,
  truncate,
  type CliOptions,
  validateOptionCombination
} from "./cliHelpers.js";

const program = new Command();
const configFilePath = getConfigFilePath();
const OPENAI_API_KEYS_URL = "https://platform.openai.com/settings/organization/api-keys";
const cliVersion = getCliVersion();

type ConfigInitOptions = {
  force?: boolean;
};

program
  .name("papyrus")
  .version(cliVersion, "-v, --version", "display version number")
  .description("Convert PDF files to Markdown or text using the OpenAI Agents SDK")
  .argument("<input>", "Path to input PDF file or folder")
  .option("-o, --output <path>", "Path to output file (single input) or output directory (folder input)")
  .option("-m, --model <model>", "OpenAI model to use", "gpt-4o-mini")
  .option(
    "--concurrency <n>",
    "Max parallel workers for folder input (default: 10)",
    parseConcurrency
  )
  .option("-y, --yes", "Skip confirmation prompt in folder mode")
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
      const inputKind = await detectInputKind(inputPath);
      let usageTotals: ConvertUsage = emptyUsage();

      if (inputKind === "file") {
        usageTotals = await processSingleFile(inputPath, options, promptText);
      } else {
        const summary = await processFolder(inputPath, options, promptText);
        usageTotals = summary.usage;
        if (!summary.cancelled && summary.failed > 0) {
          process.exitCode = 1;
        }
      }

      printUsageTotals(usageTotals);
      console.log(`Duration: ${((Date.now() - startedAt) / 1000).toFixed(2)}s`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Conversion failed: ${message}`);
      console.error(`Duration: ${((Date.now() - startedAt) / 1000).toFixed(2)}s`);
      process.exitCode = 1;
    }
  });

const configCommand = program
  .command("config")
  .description("Manage persistent configuration");

configCommand
  .command("init")
  .description("Interactively save an OpenAI API key to the local Papyrus config file")
  .option("-f, --force", "Overwrite an existing saved API key without confirmation")
  .action(async (options: ConfigInitOptions) => {
    try {
      await handleConfigInit(options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Config init failed: ${message}`);
      process.exitCode = 1;
    }
  });

configCommand
  .command("show")
  .description("Show the saved API key in masked form")
  .action(async () => {
    try {
      const storedApiKey = await getStoredApiKey();
      console.log(`Config file: ${configFilePath}`);
      if (!storedApiKey) {
        console.log("OpenAI API key: not set");
        return;
      }

      console.log(`OpenAI API key: ${maskApiKey(storedApiKey)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Config show failed: ${message}`);
      process.exitCode = 1;
    }
  });

configCommand
  .command("clear")
  .description("Remove the saved API key from local config")
  .action(async () => {
    try {
      const didClear = await clearStoredApiKey();
      if (!didClear) {
        console.log(`No saved API key found in ${configFilePath}.`);
        return;
      }

      console.log(`Removed saved API key from ${configFilePath}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Config clear failed: ${message}`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Command failed: ${message}`);
  process.exitCode = 1;
});

async function processSingleFile(
  inputPath: string,
  options: CliOptions,
  promptText?: string
): Promise<ConvertUsage> {
  if (!isPdfPath(inputPath)) {
    throw new Error("Input file must have a .pdf extension.");
  }

  await ensureApiKey();
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
  return result.usage;
}

type FolderSummary = {
  total: number;
  succeeded: number;
  failed: number;
  cancelled: boolean;
  usage: ConvertUsage;
};

async function processFolder(
  inputDir: string,
  options: CliOptions,
  promptText?: string
): Promise<FolderSummary> {
  if (options.output && looksLikeFileOutput(options.output)) {
    throw new Error(
      "In folder mode, --output must be a directory path (not a .md/.txt file path)."
    );
  }

  const files = await collectPdfFiles(inputDir);
  if (files.length === 0) {
    throw new Error(`No PDF files found in directory: ${inputDir}`);
  }

  const concurrency = options.concurrency ?? 10;
  const shouldProceed = await confirmFolderProcessing(files.length, concurrency, Boolean(options.yes));
  if (!shouldProceed) {
    console.log("Cancelled. No files were processed.");
    return { total: files.length, succeeded: 0, failed: 0, cancelled: true, usage: emptyUsage() };
  }

  await ensureApiKey();
  const outputRoot = options.output ? resolve(options.output) : undefined;
  let succeeded = 0;
  let failed = 0;
  let completed = 0;
  const usage = emptyUsage();
  const failures: Array<{ file: string; message: string }> = [];
  const workerCount = Math.min(concurrency, files.length);

  console.log(`Found ${files.length} PDF file(s). Using concurrency: ${concurrency}`);
  const workerDashboard = process.stdout.isTTY
    ? new AsciiWorkerDashboard(files.length, workerCount)
    : null;
  workerDashboard?.setSummary(completed, failed);

  try {
    await runWithConcurrency(files, concurrency, async (filePath, _index, workerId) => {
      const relativeInput = relative(inputDir, filePath);
      const startedAt = Date.now();
      workerDashboard?.setWorkerRunning(workerId, relativeInput);

      try {
        const result = await convertPdf({
          inputPath: filePath,
          model: options.model,
          mode: options.mode,
          format: options.format,
          instructions: options.instructions,
          promptText
        });

        const outputPath = resolveFolderOutputPath(filePath, inputDir, outputRoot, result.format);
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, result.content, "utf8");
        succeeded += 1;
        mergeUsage(usage, result.usage);

        if (workerDashboard) {
          workerDashboard.setWorkerDone(
            workerId,
            relativeInput,
            `${result.format} in ${formatDurationMs(Date.now() - startedAt)}`
          );
        } else {
          console.log(
            `[worker-${workerId + 1}] Done ${relativeInput} -> ${outputPath} (${result.format}, ${formatDurationMs(Date.now() - startedAt)})`
          );
        }
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        failures.push({
          file: relativeInput,
          message
        });

        if (workerDashboard) {
          workerDashboard.setWorkerFailed(
            workerId,
            relativeInput,
            `${truncate(message, 42)} (${formatDurationMs(Date.now() - startedAt)})`
          );
        } else {
          console.error(
            `[worker-${workerId + 1}] Failed ${relativeInput}: ${message} (${formatDurationMs(Date.now() - startedAt)})`
          );
        }
      } finally {
        completed += 1;
        workerDashboard?.setSummary(completed, failed);
      }
    });
  } finally {
    workerDashboard?.stop();
  }

  console.log(
    `Summary: total=${files.length}, succeeded=${succeeded}, failed=${failed}`
  );
  if (failures.length > 0) {
    console.error("Failures:");
    for (const failure of failures) {
      console.error(`- ${failure.file}: ${failure.message}`);
    }
  }

  return { total: files.length, succeeded, failed, cancelled: false, usage };
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

async function handleConfigInit(options: ConfigInitOptions): Promise<void> {
  const existingKey = await getStoredApiKey();
  if (existingKey && !options.force) {
    const overwrite = await askYesNo("An API key is already stored. Overwrite it? [y/N] ", false);
    if (!overwrite) {
      console.log("No changes made.");
      return;
    }
  }

  const apiKey = await promptForApiKey();
  await setStoredApiKey(apiKey);
  console.log(`Saved OpenAI API key to ${configFilePath}`);
}

async function ensureApiKey(): Promise<void> {
  const envApiKey = normalizeApiKey(process.env.OPENAI_API_KEY);
  if (envApiKey) {
    process.env.OPENAI_API_KEY = envApiKey;
    return;
  }

  const storedApiKey = await getStoredApiKey();
  if (storedApiKey) {
    process.env.OPENAI_API_KEY = storedApiKey;
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      [
        "OPENAI_API_KEY is not set.",
        `Run "papyrus config init" to store one in ${configFilePath},`,
        "or set OPENAI_API_KEY in your environment."
      ].join(" ")
    );
  }

  console.log(`No OpenAI API key found in environment or ${configFilePath}.`);
  const apiKey = await promptForApiKey();
  const shouldSave = await askYesNo(
    `Save this key to ${configFilePath} for future runs? [Y/n] `,
    true
  );

  if (shouldSave) {
    await setStoredApiKey(apiKey);
    console.log(`Saved OpenAI API key to ${configFilePath}`);
  }

  process.env.OPENAI_API_KEY = apiKey;
}

async function promptForApiKey(): Promise<string> {
  console.log(`Create a new API key at: ${OPENAI_API_KEYS_URL}`);
  const apiKey = normalizeApiKey(await promptHidden("Paste OpenAI API key: "));
  if (!apiKey) {
    throw new Error("API key cannot be empty.");
  }

  return apiKey;
}

async function promptHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("This prompt requires an interactive terminal.");
  }

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let value = "";
    let consumeEscapeSequence = false;
    const wasRaw = stdin.isRaw ?? false;
    process.stdout.write(question);

    const cleanup = (): void => {
      stdin.off("data", onData);
      if (stdin.isTTY) {
        stdin.setRawMode(wasRaw);
      }

      stdin.pause();
      process.stdout.write("\n");
    };

    const onData = (chunk: string | Buffer): void => {
      const content = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (const character of content) {
        if (consumeEscapeSequence) {
          if (/[A-Za-z~]/.test(character)) {
            consumeEscapeSequence = false;
          }
          continue;
        }

        if (character === "\u001b") {
          consumeEscapeSequence = true;
          continue;
        }

        if (character === "\u0003") {
          cleanup();
          reject(new Error("Cancelled by user."));
          return;
        }

        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(value);
          return;
        }

        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }

        if (character < " ") {
          continue;
        }

        value += character;
      }
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

function normalizeApiKey(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed;
}

async function detectInputKind(inputPath: string): Promise<"file" | "directory"> {
  const metadata = await stat(inputPath);
  if (metadata.isFile()) {
    return "file";
  }

  if (metadata.isDirectory()) {
    return "directory";
  }

  throw new Error("Input path must be a PDF file or directory.");
}

async function collectPdfFiles(rootDir: string): Promise<string[]> {
  const collected: string[] = [];
  await walkDirectory(rootDir, collected);
  return collected;
}

async function walkDirectory(currentDir: string, collected: string[]): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }

    const fullPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await walkDirectory(fullPath, collected);
      continue;
    }

    if (entry.isFile() && isPdfPath(entry.name)) {
      collected.push(fullPath);
    }
  }
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number, workerId: number) => Promise<void>
): Promise<void> {
  const maxWorkers = Math.min(concurrency, items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: maxWorkers }, async (_, workerId) => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      await worker(items[currentIndex], currentIndex, workerId);
    }
  });

  await Promise.all(workers);
}

const SPINNER_FRAMES = ["-", "\\", "|", "/"];

type WorkerLane = {
  state: "idle" | "running" | "done" | "failed";
  file?: string;
  message?: string;
  spinnerFrame: number;
};

class AsciiWorkerDashboard {
  private readonly lanes: WorkerLane[];
  private readonly total: number;
  private readonly workerCount: number;
  private readonly spinnerTimer: NodeJS.Timeout;
  private completed = 0;
  private failed = 0;
  private renderedLineCount = 0;

  constructor(total: number, workerCount: number) {
    this.total = total;
    this.workerCount = workerCount;
    this.lanes = Array.from({ length: workerCount }, () => ({
      state: "idle",
      spinnerFrame: 0
    }));

    process.stdout.write("\x1b[?25l");
    this.render();
    this.spinnerTimer = setInterval(() => {
      this.tickSpinners();
      this.render();
    }, 100);
  }

  setSummary(completed: number, failed: number): void {
    this.completed = completed;
    this.failed = failed;
    this.render();
  }

  setWorkerRunning(workerId: number, file: string): void {
    const lane = this.lanes[workerId];
    if (!lane) {
      return;
    }

    lane.state = "running";
    lane.file = file;
    lane.message = "processing";
    this.render();
  }

  setWorkerDone(workerId: number, file: string, message: string): void {
    const lane = this.lanes[workerId];
    if (!lane) {
      return;
    }

    lane.state = "done";
    lane.file = file;
    lane.message = message;
    this.render();
  }

  setWorkerFailed(workerId: number, file: string, message: string): void {
    const lane = this.lanes[workerId];
    if (!lane) {
      return;
    }

    lane.state = "failed";
    lane.file = file;
    lane.message = message;
    this.render();
  }

  stop(): void {
    clearInterval(this.spinnerTimer);
    this.render();
    process.stdout.write("\x1b[?25h");
  }

  private render(): void {
    const lines = this.composeLines();
    if (this.renderedLineCount > 0) {
      process.stdout.write(`\x1b[${this.renderedLineCount}F`);
    }

    for (const line of lines) {
      process.stdout.write(`\x1b[2K${line}\n`);
    }

    this.renderedLineCount = lines.length;
  }

  private composeLines(): string[] {
    const active = this.lanes.filter((lane) => lane.state === "running").length;
    const lines = [
      `Progress: ${this.completed}/${this.total} complete | active ${active}/${this.workerCount} | failed ${this.failed}`
    ];

    for (let index = 0; index < this.lanes.length; index += 1) {
      const lane = this.lanes[index];
      const label = `worker-${String(index + 1).padStart(2, "0")}`;
      const icon = this.renderIcon(lane);
      const file = truncate(lane.file ?? "idle", 64);
      const message = lane.message ? ` | ${lane.message}` : "";
      lines.push(`${icon} ${label} | ${file}${message}`);
    }

    return lines;
  }

  private tickSpinners(): void {
    for (const lane of this.lanes) {
      if (lane.state !== "running") {
        continue;
      }

      lane.spinnerFrame = (lane.spinnerFrame + 1) % SPINNER_FRAMES.length;
    }
  }

  private renderIcon(lane: WorkerLane): string {
    if (lane.state === "running") {
      return SPINNER_FRAMES[lane.spinnerFrame];
    }

    if (lane.state === "done") {
      return "OK";
    }

    if (lane.state === "failed") {
      return "!!";
    }

    return "..";
  }
}

async function confirmFolderProcessing(
  totalFiles: number,
  concurrency: number,
  skipPrompt: boolean
): Promise<boolean> {
  if (skipPrompt) {
    return true;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "Folder mode requires an interactive terminal confirmation. Use --yes to skip the prompt."
    );
  }

  return askYesNo(
    `Process ${totalFiles} PDF file(s) with concurrency ${concurrency}? [Y/n] `,
    true
  );
}

async function askYesNo(question: string, defaultYes: boolean): Promise<boolean> {
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    if (answer === "") {
      return defaultYes;
    }

    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

function emptyUsage(): ConvertUsage {
  return {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0
  };
}

function mergeUsage(target: ConvertUsage, delta: ConvertUsage): void {
  target.requests += delta.requests;
  target.inputTokens += delta.inputTokens;
  target.outputTokens += delta.outputTokens;
  target.totalTokens += delta.totalTokens;
}

function printUsageTotals(usage: ConvertUsage): void {
  console.log(
    `Token usage: input=${usage.inputTokens}, output=${usage.outputTokens}, total=${usage.totalTokens}, requests=${usage.requests}`
  );
}

function getCliVersion(): string {
  try {
    const packageJsonPath = new URL("../package.json", import.meta.url);
    const raw = readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.trim().length > 0) {
      return parsed.version;
    }
  } catch {
    // ignore and use fallback
  }

  return "0.0.0";
}
