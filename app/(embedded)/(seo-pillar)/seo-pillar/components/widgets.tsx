import { Text } from "@shopify/polaris";

// CSS-clip visually-hidden technique: keeps the text in the accessibility
// tree (announced by screen readers) without affecting layout or visuals.
const visuallyHiddenStyle: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

// delta chip: shows change vs previous period. lowerIsBetter for position.
export function Delta({ curr, prev, lowerIsBetter = false, suffix = "" }: { curr: number; prev: number | null | undefined; lowerIsBetter?: boolean; suffix?: string }) {
  if (prev === null || prev === undefined) return null;
  const diff = curr - prev;
  if (Math.abs(diff) < 0.0001) return <Text as="span" tone="subdued" variant="bodySm">no change</Text>;
  const better = lowerIsBetter ? diff < 0 : diff > 0;
  const arrow = diff > 0 ? "▲" : "▼";
  const direction = diff > 0 ? "up" : "down";
  const val = Math.abs(diff);
  const shown = suffix === "%" ? `${(val * 100).toFixed(1)}%` : Number.isInteger(val) ? val.toLocaleString() : val.toFixed(1);
  return (
    <Text as="span" tone={better ? "success" : "critical"} variant="bodySm">
      <span aria-hidden="true">{arrow}</span>
      <span style={visuallyHiddenStyle}>{direction}</span>
      {" "}{shown}{suffix && suffix !== "%" ? suffix : ""}
    </Text>
  );
}

// lightweight inline SVG line chart — no dependency
export function Sparkline({ points, color = "var(--p-color-bg-fill-info)", height = 40, width = 220 }: { points: number[]; color?: string; height?: number; width?: number }) {
  if (points.length === 0) return null;
  // Scale to the actual data range, not a hardcoded 0..1 baseline — that
  // baseline only makes sense for non-negative series (clicks, impressions).
  // The avg-position series is plotted negated so "up" reads as improvement,
  // so all its points are ≤0; forcing max to 1 stretched the range far past
  // the real data and made genuine position movement render as a flat line.
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  const stepX = points.length > 1 ? width / (points.length - 1) : 0;
  const coords = points.map((p, i) => {
    const x = i * stepX;
    const y = height - ((p - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={width} height={height} style={{ display: "block", maxWidth: "100%", height: "auto" }} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-hidden>
      <polyline fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={coords.join(" ")} />
    </svg>
  );
}
