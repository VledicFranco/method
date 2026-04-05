/**
 * CostSparkline — inline SVG mini-chart of recent observation costs.
 * Renders 24x16px by default for MetricCard sparkline slot.
 */

export interface CostSparklineProps {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
}

export function CostSparkline({
  data,
  width = 48,
  height = 18,
  stroke = '#00c9a7', // --bio
}: CostSparklineProps) {
  if (data.length < 2) {
    return (
      <svg width={width} height={height}>
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke={stroke}
          strokeWidth={1}
          opacity={0.3}
        />
      </svg>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 2;
  const plotW = width - pad * 2;
  const plotH = height - pad * 2;
  const step = plotW / (data.length - 1);

  const points = data
    .map((v, i) => {
      const x = pad + i * step;
      const y = pad + plotH - ((v - min) / range) * plotH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
