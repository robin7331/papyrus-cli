import assert from "node:assert/strict";
import test from "node:test";
import { InvalidArgumentError } from "commander";
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
  validateOptionCombination,
  type CliOptions
} from "../src/cliHelpers.js";

test("parseMode accepts valid values", () => {
  assert.equal(parseMode("auto"), "auto");
  assert.equal(parseMode("prompt"), "prompt");
});

test("parseMode rejects invalid values", () => {
  assert.throws(() => parseMode("invalid"), InvalidArgumentError);
});

test("parseFormat accepts valid values", () => {
  assert.equal(parseFormat("md"), "md");
  assert.equal(parseFormat("txt"), "txt");
});

test("parseFormat rejects invalid values", () => {
  assert.throws(() => parseFormat("json"), InvalidArgumentError);
});

test("parseConcurrency accepts in-range integers", () => {
  assert.equal(parseConcurrency("1"), 1);
  assert.equal(parseConcurrency("100"), 100);
});

test("parseConcurrency rejects invalid values", () => {
  assert.throws(() => parseConcurrency("0"), InvalidArgumentError);
  assert.throws(() => parseConcurrency("101"), InvalidArgumentError);
  assert.throws(() => parseConcurrency("1.5"), InvalidArgumentError);
  assert.throws(() => parseConcurrency("abc"), InvalidArgumentError);
});

test("validateOptionCombination enforces prompt mode requirements", () => {
  const base: CliOptions = {
    model: "gpt-4o-mini",
    mode: "prompt"
  };

  assert.throws(
    () => validateOptionCombination(base),
    /Prompt mode requires exactly one of --prompt or --prompt-file\./
  );
  assert.doesNotThrow(() => validateOptionCombination({ ...base, prompt: "Convert this" }));
  assert.doesNotThrow(() => validateOptionCombination({ ...base, promptFile: "./prompt.txt" }));
  assert.throws(
    () => validateOptionCombination({ ...base, prompt: "x", promptFile: "./prompt.txt" }),
    /Prompt mode requires exactly one of --prompt or --prompt-file\./
  );
  assert.throws(
    () => validateOptionCombination({ ...base, prompt: "x", instructions: "Extra" }),
    /--instructions is only supported in auto mode\./
  );
});

test("validateOptionCombination rejects prompt flags in auto mode", () => {
  const base: CliOptions = {
    model: "gpt-4o-mini",
    mode: "auto"
  };

  assert.doesNotThrow(() => validateOptionCombination(base));
  assert.throws(
    () => validateOptionCombination({ ...base, prompt: "Convert" }),
    /--prompt and --prompt-file are only supported in prompt mode\./
  );
  assert.throws(
    () => validateOptionCombination({ ...base, promptFile: "./prompt.txt" }),
    /--prompt and --prompt-file are only supported in prompt mode\./
  );
});

test("defaultOutputPath replaces .pdf extension and appends for other files", () => {
  assert.equal(defaultOutputPath("/tmp/input.pdf", "md"), "/tmp/input.md");
  assert.equal(defaultOutputPath("/tmp/input.PDF", "txt"), "/tmp/input.txt");
  assert.equal(defaultOutputPath("/tmp/input", "md"), "/tmp/input.md");
});

test("resolveFolderOutputPath preserves nested structure when output root is set", () => {
  assert.equal(
    resolveFolderOutputPath(
      "/data/invoices/2025/jan/file.pdf",
      "/data/invoices",
      "/exports",
      "md"
    ),
    "/exports/2025/jan/file.md"
  );

  assert.equal(
    resolveFolderOutputPath("/data/invoices/file.pdf", "/data/invoices", "/exports", "txt"),
    "/exports/file.txt"
  );
});

test("resolveFolderOutputPath falls back to default path when no output root", () => {
  assert.equal(
    resolveFolderOutputPath("/data/invoices/file.pdf", "/data/invoices", undefined, "md"),
    "/data/invoices/file.md"
  );
});

test("isPdfPath and looksLikeFileOutput detect supported extensions case-insensitively", () => {
  assert.equal(isPdfPath("report.pdf"), true);
  assert.equal(isPdfPath("report.PDF"), true);
  assert.equal(isPdfPath("report.txt"), false);

  assert.equal(looksLikeFileOutput("out.md"), true);
  assert.equal(looksLikeFileOutput("out.TXT"), true);
  assert.equal(looksLikeFileOutput("out.json"), false);
});

test("truncate shortens long values and preserves short ones", () => {
  assert.equal(truncate("abcdef", 10), "abcdef");
  assert.equal(truncate("abcdef", 3), "abc");
  assert.equal(truncate("abcdefghij", 8), "abcde...");
});

test("formatDurationMs formats to seconds with two decimals", () => {
  assert.equal(formatDurationMs(0), "0.00s");
  assert.equal(formatDurationMs(1543), "1.54s");
});
