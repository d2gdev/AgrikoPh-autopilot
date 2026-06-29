import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";

const warnedOverrides = new Set<string>();

export interface ResolvedConfigValue {
  key: string;
  value: string | null;
  source: "db" | "env" | "missing";
}

function warnDbOverride(key: string) {
  if (warnedOverrides.has(key)) return;
  warnedOverrides.add(key);
  console.warn(`[config] DB credential "${key}" overrides environment value`);
}

async function readDbCredential(key: string): Promise<string | null> {
  const credential = await prisma.apiCredential.findUnique({
    where: { key },
    select: { value: true },
  });
  if (!credential) return null;
  return decrypt(credential.value);
}

async function readDbCredentials(keys: readonly string[]): Promise<Map<string, string>> {
  if (keys.length === 0) return new Map();
  const credentials = await prisma.apiCredential.findMany({
    where: { key: { in: [...keys] } },
    select: { key: true, value: true },
  });
  return new Map(credentials.map((credential) => [credential.key, decrypt(credential.value)]));
}

export async function resolveConfigValue(key: string): Promise<ResolvedConfigValue> {
  const dbValue = await readDbCredential(key);
  const envValue = process.env[key] || null;

  if (dbValue) {
    if (envValue && envValue !== dbValue) warnDbOverride(key);
    return { key, value: dbValue, source: "db" };
  }

  if (envValue) return { key, value: envValue, source: "env" };
  return { key, value: null, source: "missing" };
}

export async function resolveConfigValues(keys: readonly string[]): Promise<Record<string, ResolvedConfigValue>> {
  const uniqueKeys = Array.from(new Set(keys));
  const dbValues = await readDbCredentials(uniqueKeys);
  return Object.fromEntries(uniqueKeys.map((key) => {
    const dbValue = dbValues.get(key) ?? null;
    const envValue = process.env[key] || null;

    if (dbValue) {
      if (envValue && envValue !== dbValue) warnDbOverride(key);
      return [key, { key, value: dbValue, source: "db" } satisfies ResolvedConfigValue] as const;
    }

    if (envValue) return [key, { key, value: envValue, source: "env" } satisfies ResolvedConfigValue] as const;
    return [key, { key, value: null, source: "missing" } satisfies ResolvedConfigValue] as const;
  }));
}

export async function getOptionalSecret(key: string): Promise<string | null> {
  return (await resolveConfigValue(key)).value;
}

export async function getSecret(key: string): Promise<string> {
  const resolved = await resolveConfigValue(key);
  if (!resolved.value) throw new Error(`Missing required credential: ${key}`);
  return resolved.value;
}

export async function getConnectorConfig<T extends string>(
  keys: readonly T[]
): Promise<Record<T, ResolvedConfigValue>> {
  return await resolveConfigValues(keys) as Record<T, ResolvedConfigValue>;
}
