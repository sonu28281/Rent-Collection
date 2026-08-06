import { useState } from 'react';

// Dependency-free SVG grouped-bar chart of month-wise Rent vs Electricity
// collection for one year. Unlike the year-over-year line chart (which scales
// each series independently to show trend shape), both series here share ONE
// y-scale — bars are best read by absolute height, so an honest shared scale
// lets you compare rent vs electricity, and month vs month, at a glance.
const MonthlyTrendChart = ({ data, year }) => {
  const [hoverIdx, setHoverIdx] = useState(null);

  const months = Array.isArray(data) ? data : [];
  const hasAnyIncome = months.some((m) => (Number(m.rentIncome) || 0) > 0 || (Number(m.electricityIncome) || 0) > 0);

  const W = 820;
  const H = 280;
  const padL = 20;
  const padR = 20;
  const padT = 20;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = 12;
  const groupW = plotW / n;
  const barGap = 4;
  const barW = (groupW - barGap * 3) / 2;

  const maxVal = Math.max(...months.map((m) => Math.max(Number(m.rentIncome) || 0, Number(m.electricityIncome) || 0)), 1);
  const yAt = (v) => padT + plotH - ((Number(v) || 0) / maxVal) * plotH;
  const barH = (v) => (padT + plotH) - yAt(v);

  const gridYs = [0, 0.25, 0.5, 0.75, 1].map((f) => padT + plotH - f * plotH);
  const inr = (v) => `₹${(Number(v) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <h4 className="text-sm font-bold text-gray-700 dark:text-slate-200 flex items-center gap-2">📊 Monthly Trend · {year}</h4>
        <div className="flex items-center gap-4 text-xs font-semibold">
          <span className="flex items-center gap-1.5 text-gray-600 dark:text-slate-300"><span className="h-2.5 w-2.5 rounded-full bg-indigo-500" /> Rent</span>
          <span className="flex items-center gap-1.5 text-gray-600 dark:text-slate-300"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Electricity</span>
        </div>
      </div>

      {!hasAnyIncome ? (
        <p className="text-sm text-gray-400 dark:text-slate-500 text-center py-16">No collections recorded for {year}.</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
            {gridYs.map((gy, idx) => (
              <line key={idx} x1={padL} x2={W - padR} y1={gy} y2={gy} className="stroke-gray-200 dark:stroke-slate-700" strokeWidth="1" />
            ))}

            {months.map((m, i) => {
              const gx = padL + i * groupW;
              const rentX = gx + barGap;
              const elecX = rentX + barW + barGap;
              const isHover = hoverIdx === i;
              return (
                <g key={m.month}>
                  <rect
                    x={rentX} y={yAt(m.rentIncome)} width={barW} height={Math.max(barH(m.rentIncome), 0)}
                    rx="2" fill="#6366f1" opacity={isHover ? 1 : 0.85}
                  />
                  <rect
                    x={elecX} y={yAt(m.electricityIncome)} width={barW} height={Math.max(barH(m.electricityIncome), 0)}
                    rx="2" fill="#f59e0b" opacity={isHover ? 1 : 0.85}
                  />
                  <text
                    x={gx + groupW / 2} y={H - 12} textAnchor="middle" fontSize="12"
                    className={`font-semibold ${isHover ? 'fill-gray-700 dark:fill-slate-200' : 'fill-gray-400 dark:fill-slate-500'}`}
                  >
                    {m.monthName}
                  </text>
                </g>
              );
            })}

            {/* Hover hit areas (one column per month) */}
            {months.map((m, i) => (
              <rect
                key={`hit-${m.month}`}
                x={padL + i * groupW} y={padT} width={groupW} height={plotH}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
                onMouseMove={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
                onTouchStart={() => setHoverIdx(i)}
              />
            ))}

            {/* Tooltip */}
            {hoverIdx != null && (() => {
              const m = months[hoverIdx];
              const gx = padL + hoverIdx * groupW;
              const boxW = 168;
              const boxH = 66;
              let bx = gx + groupW / 2 - boxW / 2;
              if (bx + boxW > W - padR) bx = W - padR - boxW;
              if (bx < padL) bx = padL;
              const by = padT + 4;
              return (
                <g pointerEvents="none">
                  <rect x={bx} y={by} width={boxW} height={boxH} rx="8" fill="#0f172a" opacity="0.96" />
                  <text x={bx + 12} y={by + 20} fill="#ffffff" fontSize="14" fontWeight="700">{m.monthName} {year}</text>
                  <circle cx={bx + 15} cy={by + 36} r="4" fill="#818cf8" />
                  <text x={bx + 25} y={by + 40} fill="#e2e8f0" fontSize="12.5">Rent {inr(m.rentIncome)}</text>
                  <circle cx={bx + 15} cy={by + 54} r="4" fill="#fbbf24" />
                  <text x={bx + 25} y={by + 58} fill="#e2e8f0" fontSize="12.5">Elec {inr(m.electricityIncome)}</text>
                </g>
              );
            })()}
          </svg>
          <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1 text-center">Both bars share one scale — heights are directly comparable. Hover a month for exact figures.</p>
        </>
      )}
    </div>
  );
};

export default MonthlyTrendChart;
