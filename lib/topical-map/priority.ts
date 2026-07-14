export type TopicalMapPriorityBand = "high" | "medium" | "low" | "unspecified";

export function normalizeTopicalMapPriority(priority?: string | null): TopicalMapPriorityBand {
  const value = priority?.trim().toLowerCase();
  if (value === "p0" || value === "p1" || value === "critical" || value === "highest" || value === "high") return "high";
  if (value === "p2" || value === "medium") return "medium";
  if (value === "p3" || value === "low") return "low";
  return "unspecified";
}
