/**
 * CostTrend — Compact SVG sparkline of cost per build.
 *
 * Inline SVG polyline, 200x60px. Shows avg cost and criteria pass rate.
 * No external chart library.
 *
 * @see PRD 047 §Analytics — Cost Trend
 */

const COST_DATA = [1.80, 8.40, 22.10, 3.20, 15.60, 7.30, 4.10, 12.80, 9.50, 6.20];

const SVG_W = 200;
const SVG_H = 60;
const PAD_X = 4;
const PAD_Y = 6;

function buildPolyline(data: number[]): string {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const plotW = SVG_W - PAD_X * 2;
  const plotH = SVG_H - PAD_Y * 2;
  const step = plotW / (data.length - 1);

  return data
    .map((v, i) => {
      const x = PAD_X + i * step;
      // invert Y so higher values go up
      const y = PAD_Y + plotH - ((v - min) / range) * plotH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function buildDotPositions(data: number[]): { x: number; y: number }[] {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const plotW = SVG_W - PAD_X * 2;
  const plotH = SVG_H - PAD_Y * 2;
  const step = plotW / (data.length - 1);

  return data.map((v, i) => ({
    x: PAD_X + i * step,
    y: PAD_Y + plotH - ((v - min) / range) * plotH,
  }));
}

export function CostTrend() {
  const avg = COST_DATA.reduce((s, v) => s + v, 0) / COST_DATA.length;
  const points = buildPolyline(COST_DATA);
  const dots = buildDotPositions(COST_DATA);

  return (
    <div className="bg-abyss border border-bdr rounded-xl p-5 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[13px] font-semibold text-txt">Cost Trend</div>
        <div className="font-mono text-[11px] text-txt-dim">last {COST_DATA.length} builds</div>
      </div>

      {/* SVG sparkline */}
      <div className="flex justify-center mb-3">
        <svg
          width={SVG_W}
          height={SVG_H}
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          className="overflow-visible"
        >
          {/* gradient fill under the line */}
          <defs>
            <linearGradient id="costFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6d5aed" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#6d5aed" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* area fill */}
          <polygon
            points={`${PAD_X},${SVG_H - PAD_Y} ${points} ${SVG_W - PAD_X},${SVG_H - PAD_Y}`}
            fill="url(#costFill)"
          />
          {/* line */}
          <polyline
            points={points}
            fill="none"
            stroke="#6d5aed"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* dots */}
          {dots.map((d, i) => (
            <circle
              key={i}
              cx={d.x}
              cy={d.y}
              r="2.5"
              fill="#0a0a12"
              stroke="#8b7cf7"
              strokeWidth="1.5"
            />
          ))}
        </svg>
      </div>

      {/* X-axis labels */}
      <div
        className="flex justify-between font-mono text-[9px] text-[#64748b] mb-3"
        style={{ paddingLeft: PAD_X, paddingRight: PAD_X }}
      >
        {COST_DATA.map((_, i) => (
          <span key={i}>#{i + 1}</span>
        ))}
      </div>

      {/* Summary stats */}
      <div className="flex items-center gap-4 font-mono text-[11px]">
        <span className="text-txt-dim">
          avg <span className="text-txt font-semibold">${avg.toFixed(2)}</span> across{' '}
          {COST_DATA.length} builds
        </span>
        <span className="text-[#10b981] font-semibold">89% criteria pass rate</span>
      </div>
    </div>
  );
}
