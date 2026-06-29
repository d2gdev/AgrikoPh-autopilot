import { parseNum } from "@/lib/seo/types";
import type { GscQueryRow } from "@/lib/seo/types";

export interface KeywordReportRow {
  keyword: string;
  position: number | null;
  clicks: number;
  impressions: number;
  positionDelta: number | null;
  status: "improved" | "declined" | "flat" | "untracked";
  alert: boolean;
}

function findRow(queries: GscQueryRow[], keyword: string): GscQueryRow | undefined {
  const target = keyword.trim().toLowerCase();
  return queries.find((q) => String(q.query).trim().toLowerCase() === target);
}

export function buildKeywordReport(
  trackedKeywords: Array<{ keyword: string }>,
  currentQueries: GscQueryRow[],
  previousQueries: GscQueryRow[]
): KeywordReportRow[] {
  return trackedKeywords.map(({ keyword }) => {
    const cur = findRow(currentQueries, keyword);
    const prev = findRow(previousQueries, keyword);

    if (!cur) {
      return {
        keyword,
        position: null,
        clicks: 0,
        impressions: 0,
        positionDelta: null,
        status: "untracked" as const,
        alert: false,
      };
    }

    const position = parseNum(cur.position);
    const clicks = cur.clicks;
    const impressions = cur.impressions;

    let positionDelta: number | null = null;
    if (prev) {
      positionDelta = position - parseNum(prev.position);
    }

    let status: KeywordReportRow["status"];
    if (positionDelta !== null && positionDelta < -0.5) {
      status = "improved";
    } else if (positionDelta !== null && positionDelta > 0.5) {
      status = "declined";
    } else {
      status = "flat";
    }

    const alert = status === "declined" && positionDelta !== null && positionDelta >= 3;

    return { keyword, position, clicks, impressions, positionDelta, status, alert };
  });
}
