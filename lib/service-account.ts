import fs from "fs";

function normalizeWindowsPath(value: string) {
  const match = value.match(/^([A-Za-z]):\\(.*)$/);
  if (!match) return value;
  return `/mnt/${match[1]!.toLowerCase()}/${match[2]!.replace(/\\/g, "/")}`;
}

export function resolveExistingFile(value: string | undefined) {
  if (!value) return null;
  const normalized = normalizeWindowsPath(value.trim().replace(/^['"]|['"]$/g, ""));
  const basename = normalized.split("/").filter(Boolean).at(-1);
  const candidates = [
    normalized,
    `${normalized}.json`,
    basename ? `/opt/autopilot-secrets/${basename}` : "",
    basename ? `/opt/autopilot-secrets/${basename}.json` : "",
    basename ? `/opt/autopilot/scripts/${basename}` : "",
    basename ? `/opt/autopilot/scripts/${basename}.json` : "",
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

export function loadServiceAccountJson(jsonEnv: string | undefined, pathEnv: string | undefined, label: string): Record<string, unknown> {
  const inline = jsonEnv?.trim();
  const explicitPath = pathEnv?.trim();

  try {
    if (inline?.startsWith("{")) return JSON.parse(inline) as Record<string, unknown>;

    const resolvedFile = resolveExistingFile(explicitPath) ?? resolveExistingFile(inline);
    if (resolvedFile) {
      return JSON.parse(fs.readFileSync(resolvedFile, "utf-8")) as Record<string, unknown>;
    }
  } catch (err) {
    throw new Error(`${label}: failed to parse service account credentials: ${(err as Error).message}`);
  }

  throw new Error(`${label}: service account credentials are not set or file was not found`);
}
