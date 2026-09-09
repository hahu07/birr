export interface DonutChartSegment {
  label: string;
  value: number;
  color: string;
}

export interface DonutChartProps {
  segments: DonutChartSegment[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
}

/**
 * Dependency-free SVG donut — no charting library in this repo, and one
 * proportion breakdown doesn't justify adding one. Stacks each segment as
 * an arc via stroke-dasharray/dashoffset on overlaid circles, rotated -90deg
 * so the first segment starts at 12 o'clock.
 */
export function DonutChart({ segments, size = 132, thickness = 20, centerLabel }: DonutChartProps) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const visible = segments.filter((s) => s.value > 0);

  let drawn = 0;
  const arcs = visible.map((s) => {
    const fraction = total > 0 ? s.value / total : 0;
    const dash = fraction * circumference;
    const arc = { ...s, dash, offset: -drawn, fraction };
    drawn += dash;
    return arc;
  });

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#f1f5f9" strokeWidth={thickness} />
          {arcs.map((arc) => (
            <circle
              key={arc.label}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={arc.color}
              strokeWidth={thickness}
              strokeDasharray={`${arc.dash} ${circumference - arc.dash}`}
              strokeDashoffset={arc.offset}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-semibold tabular-nums text-slate-900">{total}</span>
          {centerLabel && <span className="text-[10px] text-slate-500">{centerLabel}</span>}
        </div>
      </div>
      <ul className="space-y-1.5">
        {visible.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="text-slate-600">{s.label}</span>
            <span className="ml-auto pl-3 font-semibold tabular-nums text-slate-900">{s.value}</span>
          </li>
        ))}
        {visible.length === 0 && <li className="text-xs text-slate-500">No data yet</li>}
      </ul>
    </div>
  );
}
