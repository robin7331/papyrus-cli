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
  resolveFolderOutputPath,
  truncate,
  validateOptionCombination,
  type CliOptions
} from "../src/cliHelpers.js";

test("parseFormat accepts valid values", () => {
  assert.equal(parseFormat("md"), "md");
  assert.equal(parseFormat("txt"), "txt");
  assert.equal(parseFormat("csv"), "csv");
  assert.equal(parseFormat(".json"), "json");
  assert.equal(parseFormat("tar.gz"), "tar.gz");
});

test("parseFormat rejects invalid values", () => {
  assert.throws(() => parseFormat(""), InvalidArgumentError);
  assert.throws(() => parseFormat("   "), InvalidArgumentError);
  assert.throws(() => parseFormat("../json"), InvalidArgumentError);
  assert.throws(() => parseFormat("a/b"), InvalidArgumentError);
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

test("validateOptionCombination allows default auto behavior without prompt flags", () => {
  const base: CliOptions = {
    model: "gpt-4o-mini"
  };

  assert.doesNotThrow(() => validateOptionCombination(base));
  assert.doesNotThrow(() => validateOptionCombination({ ...base, instructions: "Extra formatting rules" }));
});

test("validateOptionCombination treats --prompt and --prompt-file as mutually exclusive", () => {
  const base: CliOptions = {
    model: "gpt-4o-mini"
  };

  assert.doesNotThrow(() => validateOptionCombination({ ...base, prompt: "Convert" }));
  assert.doesNotThrow(() => validateOptionCombination({ ...base, promptFile: "./prompt.txt" }));
  assert.throws(
    () => validateOptionCombination({ ...base, prompt: "x", promptFile: "./prompt.txt" }),
    /Use exactly one of --prompt or --prompt-file\./
  );
});

test("validateOptionCombination rejects --instructions with prompt flags", () => {
  const base: CliOptions = {
    model: "gpt-4o-mini"
  };

  assert.throws(
    () => validateOptionCombination({ ...base, prompt: "x", instructions: "Extra" }),
    /--instructions cannot be combined with --prompt or --prompt-file\./
  );
  assert.throws(
    () => validateOptionCombination({ ...base, promptFile: "./prompt.txt", instructions: "Extra" }),
    /--instructions cannot be combined with --prompt or --prompt-file\./
  );
});

test("defaultOutputPath replaces .pdf extension and appends for other files", () => {
  assert.equal(defaultOutputPath("/tmp/input.pdf", "md"), "/tmp/input.md");
  assert.equal(defaultOutputPath("/tmp/input.PDF", "txt"), "/tmp/input.txt");
  assert.equal(defaultOutputPath("/tmp/input.pdf", ".csv"), "/tmp/input.csv");
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

  assert.equal(
    resolveFolderOutputPath("/data/invoices/file.pdf", "/data/invoices", "/exports", ".csv"),
    "/exports/file.csv"
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
