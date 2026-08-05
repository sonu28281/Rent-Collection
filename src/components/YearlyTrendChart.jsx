import { useState } from 'react';

// Dependency-free SVG line chart of year-wise Rent vs Electricity collection.
// Each series is scaled to its own range so the up/down TREND of both is clearly
// visible despite very different magnitudes. Hovering a year shows a tooltip with
// the exact figures. Theme-aware (light + dark).
const YearlyTrendChart = ({ data }) => {
  const [hoverIdx, setHoverIdx] = useState(null);

  const years = [...(data || [])]
    .filter((y) => y && Number.isFinite(Number(y.year)))
    .sort((a, b) => Number(a.year) - Number(b.year));

  if (years.length < 2) return null;

  const W = 820;
  const H = 300;
  const padL = 30;
  const padR = 30;
  const padT = 20;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = years.length;
  const stepX = plotW / (n - 1);

  const rentMax = Math.max(...years.map((y) => Number(y.rentIncome) || 0), 1);
  const elecMax = Math.max(...years.map((y) => Number(y.electricityIncome) || 0), 1);

  const xAt = (i) => padL + i * stepX;
  const yRent = (v) => padT + plotH - ((Number(v) || 0) / rentMax) * plotH;
  const yElec = (v) => padT + plotH - ((Number(v) || 0) / elecMax) * plotH;

  const rentPts = years.map((y, i) => [xAt(i), yRent(y.rentIncome)]);
  const elecPts = years.map((y, i) => [xAt(i), yElec(y.electricityIncome)]);
  const toLine = (pts) => pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const toArea = (pts) =>
    `M ${pts[0][0].toFixed(1)},${(padT + plotH).toFixed(1)} L ${pts
      .map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`)
      .join(' L ')} L ${pts[n - 1][0].toFixed(1)},${(padT + plotH).toFixed(1)} Z`;

  const gridYs = [0, 0.25, 0.5, 0.75, 1].map((f) => padT + plotH - f * plotH);
  const inr = (v) => `₹${(Number(v) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-4 mb-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <h4 className="text-sm font-bold text-gray-700 dark:text-slate-200 flex items-center gap-2">📈 Year-wise Trend</h4>
        <div className="flex items-center gap-4 text-xs font-semibold">
          <span className="flex items-center gap-1.5 text-gray-600 dark:text-slate-300"><span className="h-2.5 w-2.5 rounded-full bg-indigo-500" /> Rent</span>
          <span className="flex items-center gap-1.5 text-gray-600 dark:text-slate-300"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Electricity</span>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="rentTrendGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="elecTrendGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
          </linearGradient>
        </defs>

        {gridYs.map((gy, idx) => (
          <line key={idx} x1={padL} x2={W - padR} y1={gy} y2={gy} className="stroke-gray-200 dark:stroke-slate-700" strokeWidth="1" />
        ))}

        <path d={toArea(rentPts)} fill="url(#rentTrendGrad)" />
        <path d={toArea(elecPts)} fill="url(#elecTrendGrad)" />

        <polyline points={toLine(elecPts)} fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={toLine(rentPts)} fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

        {years.map((y, i) => (
          <g key={y.year}>
            <circle cx={xAt(i)} cy={yElec(y.electricityIncome)} r="3.5" fill="#f59e0b" stroke="#fff" strokeWidth="1" className="dark:[stroke:#1e293b]" />
            <circle cx={xAt(i)} cy={yRent(y.rentIncome)} r="3.5" fill="#6366f1" stroke="#fff" strokeWidth="1" className="dark:[stroke:#1e293b]" />
            <text x={xAt(i)} y={H - 12} textAnchor="middle" fontSize="12" className={`font-semibold ${hoverIdx === i ? 'fill-gray-700 dark:fill-slate-200' : 'fill-gray-400 dark:fill-slate-500'}`}>{y.year}</text>
          </g>
        ))}

        {/* Hover hit areas (one column per year) */}
        {years.map((y, i) => (
          <rect
            key={`hit-${y.year}`}
            x={Math.max(0, xAt(i) - stepX / 2)}
            y={padT}
            width={stepX}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHoverIdx(i)}
            onMouseMove={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx(null)}
            onTouchStart={() => setHoverIdx(i)}
          />
        ))}

        {/* Tooltip */}
        {hoverIdx != null && (() => {
          const y = years[hoverIdx];
          const cx = xAt(hoverIdx);
          const boxW = 158;
          const boxH = 66;
          let bx = cx + 12;
          if (bx + boxW > W - padR) bx = cx - 12 - boxW;
          if (bx < padL) bx = padL;
          const by = padT + 4;
          return (
            <g pointerEvents="none">
              <line x1={cx} x2={cx} y1={padT} y2={padT + plotH} className="stroke-gray-300 dark:stroke-slate-600" strokeWidth="1" strokeDasharray="3 3" />
              <circle cx={cx} cy={yElec(y.electricityIncome)} r="5" fill="#f59e0b" stroke="#fff" strokeWidth="1.5" />
              <circle cx={cx} cy={yRent(y.rentIncome)} r="5" fill="#6366f1" stroke="#fff" strokeWidth="1.5" />
              <rect x={bx} y={by} width={boxW} height={boxH} rx="8" fill="#0f172a" opacity="0.96" />
              <text x={bx + 12} y={by + 20} fill="#ffffff" fontSize="14" fontWeight="700">{y.year}</text>
              <circle cx={bx + 15} cy={by + 36} r="4" fill="#818cf8" />
              <text x={bx + 25} y={by + 40} fill="#e2e8f0" fontSize="12.5">Rent {inr(y.rentIncome)}</text>
              <circle cx={bx + 15} cy={by + 54} r="4" fill="#fbbf24" />
              <text x={bx + 25} y={by + 58} fill="#e2e8f0" fontSize="12.5">Elec {inr(y.electricityIncome)}</text>
            </g>
          );
        })()}
      </svg>
      <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1 text-center">Each line is scaled to its own range — shape shows the year-over-year trend, not absolute size. Hover the chart for exact figures.</p>
    </div>
  );
};

export default YearlyTrendChart;
