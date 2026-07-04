export function Sparkline({ data, color = "var(--p-color-bg-fill-info)", label }: { data: number[]; color?: string; label: string }) {
  const max = Math.max(...data, 1);
  const total = data.reduce((sum, value) => sum + value, 0);
  return (
    <div
      role="img"
      aria-label={`${label}. ${data.length} points, total ${total}, high ${max}.`}
      style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 40, minWidth: 160 }}
    >
      {data.map((v, i) => (
        <div
          key={i}
          aria-hidden="true"
          style={{
            flex: 1,
            height: `${Math.round((v / max) * 40)}px`,
            backgroundColor: v === 0 ? "var(--p-color-bg-fill-tertiary)" : color,
            borderRadius: 2,
            minHeight: v > 0 ? 2 : 1,
          }}
        />
      ))}
    </div>
  );
}
