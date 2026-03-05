#!/usr/bin/env node

import "dotenv/config";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { Command, InvalidArgumentError } from "commander";
import {
  convertPdf,
  type ConversionMode,
  type ConvertUsage,
  type OutputFormat
} from "./openaiPdfToMarkdown.js";

const program = new Command();

type CliOptions = {
  output?: string;
  model: string;
  concurrency?: number;
  yes?: boolean;
  mode: ConversionMode;
  format?: OutputFormat;
  instructions?: string;
  prompt?: string;
  promptFile?: string;
};

program
  .name("papyrus-cli")
  .description("Convert PDF files to Markdown or text using the OpenAI Agents SDK")
  .argument("<input>", "Path to input PDF file or folder")
  .option("-o, --output <path>", "Path to output file (single input) or output directory (folder input)")
  .option("-m, --model <model>", "OpenAI model to use", "gpt-5")
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

function parseConcurrency(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new InvalidArgumentError("Concurrency must be an integer between 1 and 100.");
  }

  return parsed;
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

async function processSingleFile(
  inputPath: string,
  options: CliOptions,
  promptText?: string
): Promise<ConvertUsage> {
  if (!isPdfPath(inputPath)) {
    throw new Error("Input file must have a .pdf extension.");
  }

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

  const outputRoot = options.output ? resolve(options.output) : undefined;
  let succeeded = 0;
  let failed = 0;
  let completed = 0;
  const usage = emptyUsage();
  const failures: Array<{ file: string; message: string }> = [];
  const dashboard = process.stdin.isTTY && process.stdout.isTTY
    ? await createSubagentDashboard(files.length, concurrency)
    : null;

  console.log(`Found ${files.length} PDF file(s). Using concurrency: ${concurrency}`);
  dashboard?.setSummary(completed, failed, "starting");

  try {
    await runWithConcurrency(files, concurrency, async (filePath, _index, workerId) => {
      const relativeInput = relative(inputDir, filePath);
      const startedAt = Date.now();
      dashboard?.setWorkerRunning(workerId, relativeInput);
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
        dashboard?.setWorkerDone(workerId, relativeInput, result.format, Date.now() - startedAt);
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        failures.push({
          file: relativeInput,
          message
        });
        dashboard?.setWorkerFailed(workerId, relativeInput, message, Date.now() - startedAt);
      } finally {
        completed += 1;
        dashboard?.setSummary(completed, failed);
      }
    });
  } finally {
    dashboard?.stop();
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

function defaultOutputPath(inputPath: string, format: OutputFormat): string {
  const extension = format === "md" ? ".md" : ".txt";

  if (extname(inputPath).toLowerCase() === ".pdf") {
    return inputPath.slice(0, -4) + extension;
  }

  return inputPath + extension;
}

function resolveFolderOutputPath(
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

function isPdfPath(inputPath: string): boolean {
  return extname(inputPath).toLowerCase() === ".pdf";
}

function looksLikeFileOutput(outputPath: string): boolean {
  const outputExt = extname(outputPath).toLowerCase();
  return outputExt === ".md" || outputExt === ".txt";
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

function formatDurationMs(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(2)}s`;
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

  const opentuiAnswer = await confirmWithOpenTui(totalFiles, concurrency);
  if (opentuiAnswer !== null) {
    return opentuiAnswer;
  }

  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const answer = (await rl.question(
      `Process ${totalFiles} PDF file(s) with concurrency ${concurrency}? [Y/n] `
    )).trim().toLowerCase();

    return answer === "" || answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

type WorkerLane = {
  state: "idle" | "running" | "done" | "failed";
  file?: string;
  message?: string;
  spinnerFrame: number;
};

type SubagentDashboard = {
  setSummary: (completed: number, failed: number, phase?: string) => void;
  setWorkerRunning: (workerId: number, file: string) => void;
  setWorkerDone: (workerId: number, file: string, format: OutputFormat, durationMs: number) => void;
  setWorkerFailed: (workerId: number, file: string, message: string, durationMs: number) => void;
  stop: () => void;
};

type OpenTuiModule = {
  createCliRenderer: (config?: Record<string, unknown>) => Promise<any>;
  BoxRenderable: new (renderer: any, options: Record<string, unknown>) => any;
  TextRenderable: new (renderer: any, options: Record<string, unknown>) => any;
};

class OpenTuiSubagentDashboard implements SubagentDashboard {
  private readonly renderer: any;
  private readonly lanes: WorkerLane[];
  private readonly laneTextNodes: any[];
  private readonly summaryText: any;
  private readonly phaseText: any;
  private readonly total: number;
  private readonly concurrency: number;
  private readonly spinnerTimer: NodeJS.Timeout;

  private completed = 0;
  private failed = 0;
  private phase = "running";

  private constructor(
    openTui: OpenTuiModule,
    renderer: any,
    total: number,
    concurrency: number
  ) {
    this.renderer = renderer;
    this.total = total;
    this.concurrency = concurrency;
    this.lanes = Array.from({ length: concurrency }, () => ({
      state: "idle",
      spinnerFrame: 0
    }));

    const container = new openTui.BoxRenderable(renderer, {
      width: "100%",
      height: "100%",
      padding: 1,
      flexDirection: "column",
      gap: 1
    });
    renderer.root.add(container);

    container.add(new openTui.TextRenderable(renderer, { content: "Papyrus Subagents Dashboard" }));
    this.phaseText = new openTui.TextRenderable(renderer, {
      content: `Phase: running | Subagents: ${concurrency}`
    });
    container.add(this.phaseText);

    this.summaryText = new openTui.TextRenderable(renderer, { content: "" });
    container.add(this.summaryText);

    this.laneTextNodes = this.lanes.map((_, index) => {
      const node = new openTui.TextRenderable(renderer, {
        content: this.renderLaneLine(index)
      });
      container.add(node);
      return node;
    });

    this.updateSummary();
    this.spinnerTimer = setInterval(() => {
      this.tickSpinners();
    }, 90);
  }

  static async create(total: number, concurrency: number): Promise<SubagentDashboard> {
    const openTui = await loadOpenTui();
    const renderer = await openTui.createCliRenderer({
      useConsole: false,
      exitOnCtrlC: false,
      autoFocus: false,
      useAlternateScreen: true
    });

    return new OpenTuiSubagentDashboard(openTui, renderer, total, concurrency);
  }

  setSummary(completed: number, failed: number, phase?: string): void {
    this.completed = completed;
    this.failed = failed;
    if (phase) {
      this.phase = phase;
    }

    this.phaseText.content = `Phase: ${this.phase} | Subagents: ${this.concurrency}`;
    this.updateSummary();
  }

  setWorkerRunning(workerId: number, file: string): void {
    const lane = this.lanes[workerId];
    if (!lane) {
      return;
    }

    lane.state = "running";
    lane.file = file;
    lane.message = "processing";
    this.updateLane(workerId);
    this.updateSummary();
  }

  setWorkerDone(workerId: number, file: string, format: OutputFormat, durationMs: number): void {
    const lane = this.lanes[workerId];
    if (!lane) {
      return;
    }

    lane.state = "done";
    lane.file = file;
    lane.message = `${format} in ${formatDurationMs(durationMs)}`;
    this.updateLane(workerId);
    this.updateSummary();
  }

  setWorkerFailed(workerId: number, file: string, message: string, durationMs: number): void {
    const lane = this.lanes[workerId];
    if (!lane) {
      return;
    }

    lane.state = "failed";
    lane.file = file;
    lane.message = `${truncate(message, 40)} (${formatDurationMs(durationMs)})`;
    this.updateLane(workerId);
    this.updateSummary();
  }

  stop(): void {
    clearInterval(this.spinnerTimer);
    this.phase = "finished";
    this.phaseText.content = `Phase: ${this.phase} | Subagents: ${this.concurrency}`;
    this.updateSummary();
    this.renderer.destroy();
  }

  private updateSummary(): void {
    const active = this.lanes.filter((lane) => lane.state === "running").length;
    const remaining = this.total - this.completed;
    this.summaryText.content =
      `Progress: done ${this.completed}/${this.total} | remaining ${remaining} | active ${active}/${this.concurrency} | failed ${this.failed}`;
  }

  private tickSpinners(): void {
    for (let index = 0; index < this.lanes.length; index += 1) {
      const lane = this.lanes[index];
      if (lane.state !== "running") {
        continue;
      }

      lane.spinnerFrame = (lane.spinnerFrame + 1) % SPINNER_FRAMES.length;
      this.updateLane(index);
    }
  }

  private updateLane(workerId: number): void {
    const node = this.laneTextNodes[workerId];
    if (!node) {
      return;
    }

    node.content = this.renderLaneLine(workerId);
  }

  private renderLaneLine(workerId: number): string {
    const lane = this.lanes[workerId];
    const label = `subagent-${String(workerId + 1).padStart(2, "0")}`;
    const icon = this.renderIcon(lane);
    const file = truncate(lane.file ?? "idle", 68);
    const message = lane.message ? ` | ${lane.message}` : "";
    return `${icon} ${label} | ${file}${message}`;
  }

  private renderIcon(lane: WorkerLane): string {
    if (lane.state === "running") {
      return SPINNER_FRAMES[lane.spinnerFrame];
    }

    if (lane.state === "done") {
      return "✔";
    }

    if (lane.state === "failed") {
      return "✖";
    }

    return "○";
  }
}

class AsciiSubagentDashboard implements SubagentDashboard {
  private readonly lanes: WorkerLane[];
  private readonly total: number;
  private readonly concurrency: number;
  private readonly spinnerTimer: NodeJS.Timeout;
  private completed = 0;
  private failed = 0;
  private phase = "running";
  private renderedLineCount = 0;

  constructor(total: number, concurrency: number) {
    this.total = total;
    this.concurrency = concurrency;
    this.lanes = Array.from({ length: concurrency }, () => ({
      state: "idle",
      spinnerFrame: 0
    }));

    process.stdout.write("\x1b[?25l");
    this.render();
    this.spinnerTimer = setInterval(() => {
      this.tickSpinners();
      this.render();
    }, 90);
  }

  setSummary(completed: number, failed: number, phase?: string): void {
    this.completed = completed;
    this.failed = failed;
    if (phase) {
      this.phase = phase;
    }

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

  setWorkerDone(workerId: number, file: string, format: OutputFormat, durationMs: number): void {
    const lane = this.lanes[workerId];
    if (!lane) {
      return;
    }

    lane.state = "done";
    lane.file = file;
    lane.message = `${format} in ${formatDurationMs(durationMs)}`;
    this.render();
  }

  setWorkerFailed(workerId: number, file: string, message: string, durationMs: number): void {
    const lane = this.lanes[workerId];
    if (!lane) {
      return;
    }

    lane.state = "failed";
    lane.file = file;
    lane.message = `${truncate(message, 40)} (${formatDurationMs(durationMs)})`;
    this.render();
  }

  stop(): void {
    clearInterval(this.spinnerTimer);
    this.phase = "finished";
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
    const remaining = this.total - this.completed;
    const lines = [
      "Papyrus Subagents Dashboard",
      `Phase: ${this.phase} | Subagents: ${this.concurrency}`,
      `Progress: done ${this.completed}/${this.total} | remaining ${remaining} | active ${active}/${this.concurrency} | failed ${this.failed}`
    ];

    for (let index = 0; index < this.lanes.length; index += 1) {
      const lane = this.lanes[index];
      const label = `subagent-${String(index + 1).padStart(2, "0")}`;
      const icon = this.renderIcon(lane);
      const file = truncate(lane.file ?? "idle", 68);
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
      return "✔";
    }

    if (lane.state === "failed") {
      return "✖";
    }

    return "○";
  }
}

async function createSubagentDashboard(total: number, concurrency: number): Promise<SubagentDashboard> {
  try {
    return await OpenTuiSubagentDashboard.create(total, concurrency);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`OpenTUI unavailable (${message}). Falling back to ANSI dashboard.`);
    return new AsciiSubagentDashboard(total, concurrency);
  }
}

async function confirmWithOpenTui(totalFiles: number, concurrency: number): Promise<boolean | null> {
  try {
    const openTui = await loadOpenTui();
    const renderer = await openTui.createCliRenderer({
      useConsole: false,
      exitOnCtrlC: false,
      autoFocus: false,
      useAlternateScreen: true
    });

    const container = new openTui.BoxRenderable(renderer, {
      width: "100%",
      height: "100%",
      padding: 1,
      flexDirection: "column",
      gap: 1
    });
    renderer.root.add(container);

    container.add(new openTui.TextRenderable(renderer, { content: "Papyrus: Folder Processing" }));
    container.add(
      new openTui.TextRenderable(renderer, {
        content: `Found ${totalFiles} PDF(s). Planned concurrency: ${concurrency} subagents.`
      })
    );
    container.add(
      new openTui.TextRenderable(renderer, {
        content: "Proceed? (y/enter = yes, n/esc = no)"
      })
    );

    return await new Promise<boolean>((resolvePromise) => {
      let finished = false;

      const done = (result: boolean): void => {
        if (finished) {
          return;
        }

        finished = true;
        renderer.keyInput.off("keypress", onKeyPress);
        renderer.destroy();
        resolvePromise(result);
      };

      const onKeyPress = (key: { name?: string; ctrl?: boolean }): void => {
        const name = key.name?.toLowerCase();
        if (key.ctrl && name === "c") {
          done(false);
          return;
        }

        if (name === "y" || name === "return" || name === "enter") {
          done(true);
          return;
        }

        if (name === "n" || name === "escape") {
          done(false);
        }
      };

      renderer.keyInput.on("keypress", onKeyPress);
    });
  } catch {
    return null;
  }
}

async function loadOpenTui(): Promise<OpenTuiModule> {
  try {
    const mod = await import("@opentui/core");
    return mod as unknown as OpenTuiModule;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `OpenTUI failed to load in this runtime. ${message}. OpenTUI currently targets Bun-first environments.`
    );
  }
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength <= 3) {
    return value.slice(0, maxLength);
  }

  return `${value.slice(0, maxLength - 3)}...`;
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
