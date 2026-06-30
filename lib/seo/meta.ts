function isBlankMetaValue(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function hasOwn(data: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(data, key);
}

function hasBlankField(data: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => hasOwn(data, key) && isBlankMetaValue(data[key]));
}

export function hasMissingMeta(seoData: unknown): boolean {
  if (!seoData || typeof seoData !== "object") return false;

  const seo = seoData as Record<string, unknown>;
  const issues = Array.isArray(seo.issues) ? seo.issues.map((issue) => String(issue)) : [];
  const missingTitle =
    issues.includes("missing_meta") ||
    issues.includes("missing-meta") ||
    issues.includes("missing-meta-title") ||
    issues.includes("missing-title") ||
    hasBlankField(seo, ["metaTitle", "seoTitle"]) ||
    seo.titleLength === 0;
  const missingDesc =
    issues.includes("missing_meta") ||
    issues.includes("missing-meta") ||
    issues.includes("missing-meta-description") ||
    hasBlankField(seo, ["metaDescription", "seoDescription"]) ||
    seo.descLength === 0;

  return missingTitle || missingDesc;
}
