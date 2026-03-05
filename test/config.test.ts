import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  clearStoredApiKey,
  getStoredApiKey,
  maskApiKey,
  readPapyrusConfig,
  setStoredApiKey
} from "../src/config.js";

async function withTempConfigPath(
  run: (configFilePath: string) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "papyrus-config-test-"));
  try {
    await run(join(root, "config.json"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("setStoredApiKey and getStoredApiKey persist and read the key", async () => {
  await withTempConfigPath(async (configFilePath) => {
    await setStoredApiKey("sk-test-123", { configFilePath });
    const storedApiKey = await getStoredApiKey({ configFilePath });
    assert.equal(storedApiKey, "sk-test-123");

    const raw = JSON.parse(await readFile(configFilePath, "utf8")) as Record<string, string>;
    assert.equal(raw.openaiApiKey, "sk-test-123");
  });
});

test("clearStoredApiKey removes the key and reports state transitions", async () => {
  await withTempConfigPath(async (configFilePath) => {
    await setStoredApiKey("sk-test-123", { configFilePath });

    assert.equal(await clearStoredApiKey({ configFilePath }), true);
    assert.equal(await getStoredApiKey({ configFilePath }), undefined);
    assert.equal(await clearStoredApiKey({ configFilePath }), false);
  });
});

test("readPapyrusConfig rejects invalid JSON structures", async () => {
  await withTempConfigPath(async (configFilePath) => {
    await writeFile(configFilePath, "[]\n", "utf8");
    await assert.rejects(
      () => readPapyrusConfig({ configFilePath }),
      /expected a JSON object/
    );
  });
});

test("maskApiKey masks short and long keys", () => {
  assert.equal(maskApiKey("sk-short"), "s***t");
  assert.equal(maskApiKey("sk-test-123456789"), "sk-t...6789");
});
