export type DatabaseUrlSource = "DATABASE_URL" | "DATABASE_URL_PROD" | null;

export type DatabaseUrlDiagnostics = {
  present: boolean;
  valid: boolean;
  source: DatabaseUrlSource;
  protocol: string | null;
  host: string | null;
  port: string | null;
  database: string | null;
  hasConnectionLimit: boolean;
  connectionLimit: number | null;
  hasPoolTimeout: boolean;
  poolTimeout: number | null;
  warnings: string[];
  errors: string[];
};

type EnvLike = Record<string, string | undefined>;

function parsePositiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export function resolveDatabaseUrl(env: EnvLike = process.env): { url: string | null; source: DatabaseUrlSource } {
  if (env.DATABASE_URL) return { url: env.DATABASE_URL, source: "DATABASE_URL" };
  if (env.DATABASE_URL_PROD) return { url: env.DATABASE_URL_PROD, source: "DATABASE_URL_PROD" };
  return { url: null, source: null };
}

export function getDatabaseUrlDiagnostics(env: EnvLike = process.env): DatabaseUrlDiagnostics {
  const { url, source } = resolveDatabaseUrl(env);
  const warnings: string[] = [];
  const errors: string[] = [];
  const requireConnectionLimit =
    env.DATABASE_URL_REQUIRE_CONNECTION_LIMIT === "true" ||
    env.DATABASE_URL_STRICT === "true" ||
    env.NODE_ENV === "production";

  if (!url) {
    return {
      present: false,
      valid: false,
      source,
      protocol: null,
      host: null,
      port: null,
      database: null,
      hasConnectionLimit: false,
      connectionLimit: null,
      hasPoolTimeout: false,
      poolTimeout: null,
      warnings,
      errors: ["DATABASE_URL is not set, and DATABASE_URL_PROD fallback is not available."],
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      present: true,
      valid: false,
      source,
      protocol: null,
      host: null,
      port: null,
      database: null,
      hasConnectionLimit: false,
      connectionLimit: null,
      hasPoolTimeout: false,
      poolTimeout: null,
      warnings,
      errors: ["DATABASE_URL is not a valid URL."],
    };
  }

  if (!["postgresql:", "postgres:"].includes(parsed.protocol)) {
    errors.push(`DATABASE_URL must use postgres/postgresql protocol, got ${parsed.protocol}.`);
  }

  const connectionLimitRaw = parsed.searchParams.get("connection_limit");
  const poolTimeoutRaw = parsed.searchParams.get("pool_timeout");
  const connectionLimit = parsePositiveInt(connectionLimitRaw);
  const poolTimeout = parsePositiveInt(poolTimeoutRaw);

  if (!connectionLimitRaw) {
    const message = "DATABASE_URL should include connection_limit to cap Prisma pool size.";
    if (requireConnectionLimit) errors.push(message);
    else warnings.push(message);
  } else if (connectionLimit == null) {
    errors.push("DATABASE_URL connection_limit must be a positive integer.");
  } else if (connectionLimit > 10) {
    warnings.push(`DATABASE_URL connection_limit=${connectionLimit} is above the recommended cap of 10.`);
  }

  if (!poolTimeoutRaw) {
    warnings.push("DATABASE_URL should include pool_timeout so pool exhaustion fails quickly instead of hanging.");
  } else if (poolTimeout == null) {
    errors.push("DATABASE_URL pool_timeout must be a positive integer.");
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!database) errors.push("DATABASE_URL must include a database name.");

  return {
    present: true,
    valid: errors.length === 0,
    source,
    protocol: parsed.protocol.replace(/:$/, ""),
    host: parsed.hostname || null,
    port: parsed.port || null,
    database: database || null,
    hasConnectionLimit: Boolean(connectionLimitRaw),
    connectionLimit,
    hasPoolTimeout: Boolean(poolTimeoutRaw),
    poolTimeout,
    warnings,
    errors,
  };
}

export function assertDatabaseUrlReady(env: EnvLike = process.env): DatabaseUrlDiagnostics {
  const diagnostics = getDatabaseUrlDiagnostics(env);
  const strict = env.DATABASE_URL_STRICT === "true" || env.NODE_ENV === "production";

  if (strict && diagnostics.errors.length > 0) {
    throw new Error(`Database URL validation failed:\n${diagnostics.errors.map((err) => `  - ${err}`).join("\n")}`);
  }

  return diagnostics;
}
