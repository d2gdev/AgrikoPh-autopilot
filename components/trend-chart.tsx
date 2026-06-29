"use client";

import { useId } from "react";

export interface TrendPoint {
  label: string;
  value: number;
}

interface TrendChartProps {
  points: TrendPoint[];
  /** Formats a value for the tooltip / axis labels. */
  format?: (v: number) => string;
  color?: string;
  height?: number;
}

/**
 * Dependency-free SVG line+area chart. Renders an empty state for <2 points.
 * Uses a viewBox so it scales to its container width.
 */
export function TrendChart({
  points,
  format = (v) => String(Math.round(v)),
  color = "#5c6ac4",
  height = 160,
}: TrendChartProps) {
  const gradId = useId();
  const W = 600;
  const H = height;
  const padX = 8;
  const padY = 16;

  if (points.length < 2) {
    return (
      <div
        style={{
          height: H,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#8c9196",
          fontSize: 13,
        }}
      >
        Not enough history yet — trend appears after a few analyzer runs.
      </div>
    );
  }

  const values = points.map((p) => p.value);
  const max = Math.max(...values);
  const min = Math.min(...values, 0);
  const range = max - min || 1;

  const x = (i: number) => padX + (i / (points.length - 1)) * (W - padX * 2);
  const y = (v: number) => padY + (1 - (v - min) / range) * (H - padY * 2);

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${x(points.length - 1).toFixed(1)},${(H - padY).toFixed(1)} L${x(0).toFixed(1)},${(H - padY).toFixed(1)} Z`;

  const last = points[points.length - 1]!;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Trend chart">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.value)} r={i === points.length - 1 ? 3.5 : 2} fill={color}>
          <title>{`${p.label}: ${format(p.value)}`}</title>
        </circle>
      ))}
      <text x={x(points.length - 1)} y={Math.max(y(last.value) - 8, 12)} textAnchor="end" fontSize="12" fill={color} fontWeight="600">
        {format(last.value)}
      </text>
    </svg>
  );
}
