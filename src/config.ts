import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export type PapyrusConfig = {
  openaiApiKey?: string;
};

type ConfigPathOptions = {
  configFilePath?: string;
};

export function getConfigFilePath(options?: ConfigPathOptions): string {
  if (options?.configFilePath) {
    return options.configFilePath;
  }

  return join(homedir(), ".config", "papyrus", "config.json");
}

export async function readPapyrusConfig(options?: ConfigPathOptions): Promise<PapyrusConfig> {
  const configObject = await readConfigObject(options);
  const openaiApiKey = normalizeApiKey(configObject.openaiApiKey);
  return openaiApiKey ? { openaiApiKey } : {};
}

export async function getStoredApiKey(options?: ConfigPathOptions): Promise<string | undefined> {
  const config = await readPapyrusConfig(options);
  return config.openaiApiKey;
}

export async function setStoredApiKey(
  apiKey: string,
  options?: ConfigPathOptions
): Promise<void> {
  const normalizedApiKey = normalizeApiKey(apiKey);
  if (!normalizedApiKey) {
    throw new Error("API key cannot be empty.");
  }

  const configObject = await readConfigObject(options);
  configObject.openaiApiKey = normalizedApiKey;
  await writeConfigObject(configObject, options);
}

export async function clearStoredApiKey(options?: ConfigPathOptions): Promise<boolean> {
  const configPath = getConfigFilePath(options);
  const configObject = await readConfigObject(options);
  if (!("openaiApiKey" in configObject)) {
    return false;
  }

  delete configObject.openaiApiKey;
  if (Object.keys(configObject).length === 0) {
    await rm(configPath, { force: true });
    return true;
  }

  await writeConfigObject(configObject, options);
  return true;
}

export function maskApiKey(apiKey: string): string {
  const normalizedApiKey = normalizeApiKey(apiKey);
  if (!normalizedApiKey) {
    return "(empty)";
  }

  if (normalizedApiKey.length <= 8) {
    return `${normalizedApiKey[0]}***${normalizedApiKey[normalizedApiKey.length - 1]}`;
  }

  return `${normalizedApiKey.slice(0, 4)}...${normalizedApiKey.slice(-4)}`;
}

async function readConfigObject(options?: ConfigPathOptions): Promise<Record<string, unknown>> {
  const configPath = getConfigFilePath(options);

  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {};
    }

    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${configPath}: ${message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid config in ${configPath}: expected a JSON object.`);
  }

  return { ...(parsed as Record<string, unknown>) };
}

async function writeConfigObject(
  configObject: Record<string, unknown>,
  options?: ConfigPathOptions
): Promise<void> {
  const configPath = getConfigFilePath(options);
  const configDir = dirname(configPath);
  await mkdir(configDir, { recursive: true, mode: 0o700 });

  try {
    await chmod(configDir, 0o700);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  const serialized = `${JSON.stringify(configObject, null, 2)}\n`;
  await writeFile(configPath, serialized, { encoding: "utf8", mode: 0o600 });
  await chmod(configPath, 0o600);
}

function normalizeApiKey(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
