// Shared display formatting. One timeAgo, one peso formatter — pages must not hand-roll these.

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return "unknown";
  const diff = Date.now() - time;
  const absDiff = Math.abs(diff);
  const mins = Math.floor(absDiff / 60000);
  const suffix = diff < 0 ? " from now" : " ago";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m${suffix}`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h${suffix}`;
  const days = Math.floor(hrs / 24);
  if (days <= 30) return `${days}d${suffix}`;
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

export function formatPhp(value: number, decimals = 2): string {
  return "₱" + value.toLocaleString("en-PH", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatMoney(value: number, currency?: string | null): string {
  const amount = value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency ? `${currency} ` : "₱"}${amount}`;
}

export function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 10_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

export function actionLabel(t: string): string {
  const map: Record<string, string> = {
    pause_campaign: "Pause Campaign",
    pause_ad: "Pause Ad",
    adjust_budget: "Adjust Budget",
    enable_campaign: "Enable Campaign",
  };
  return map[t] ?? t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
