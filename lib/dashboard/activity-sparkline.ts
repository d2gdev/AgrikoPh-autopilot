import { prisma } from "@/lib/db";

const DAYS = 30;
const DAY_MS = 24 * 3600_000;
const DASHBOARD_TIMEZONE = process.env.DASHBOARD_TIMEZONE ?? "UTC";

export type SparklineDay = { date: string; count: number };
export type ActivitySparklineResult = { days: SparklineDay[]; timezone: string; generatedAt: string };

function dateKey(date: Date, timezone: string): string {
  if (timezone === "UTC") return date.toISOString().slice(0, 10);

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : date.toISOString().slice(0, 10);
}

export async function getActivitySparkline(now = new Date()): Promise<ActivitySparklineResult> {
  const timezone = DASHBOARD_TIMEZONE;
  const since = new Date(now.getTime() - (DAYS - 1) * DAY_MS);

  const entries = await prisma.auditLog.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  // Build a bucket for each of the last 30 days in the response timezone.
  const countByDay = new Map<string, number>();
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * DAY_MS);
    countByDay.set(dateKey(d, timezone), 0);
  }

  for (const e of entries) {
    const key = dateKey(e.createdAt, timezone);
    if (countByDay.has(key)) {
      countByDay.set(key, (countByDay.get(key) ?? 0) + 1);
    }
  }

  const days: SparklineDay[] = [...countByDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  return { days, timezone, generatedAt: now.toISOString() };
}
