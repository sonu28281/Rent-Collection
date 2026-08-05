import { useEffect, useState } from 'react';
import { getUsage, LIMITS, QUOTA_EVENT } from '../utils/quotaMeter';

// Gauge showing an estimate of today's Firestore reads (browser-local).
// `compact` renders a slim inline pill for the top bar; default is the full bar.
const QuotaMeter = ({ compact = false }) => {
  const [usage, setUsage] = useState(getUsage());

  useEffect(() => {
    const refresh = () => setUsage(getUsage());
    window.addEventListener(QUOTA_EVENT, refresh);
    window.addEventListener('focus', refresh);
    // Catch the Pacific-midnight rollover even if idle.
    const id = setInterval(refresh, 30000);
    return () => {
      window.removeEventListener(QUOTA_EVENT, refresh);
      window.removeEventListener('focus', refresh);
      clearInterval(id);
    };
  }, []);

  const pct = Math.min(100, Math.round((usage.reads / LIMITS.reads) * 100));
  const barColor = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-green-500';
  const textColor = pct >= 90 ? 'text-red-600' : pct >= 70 ? 'text-yellow-700' : 'text-green-700';
  const dotColor = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-green-500';

  if (compact) {
    return (
      <div
        className="flex items-center gap-2 rounded-full border border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-700/60 px-2.5 py-1"
        title={`Reads today (est.): ${usage.reads.toLocaleString('en-IN')} / ${LIMITS.reads.toLocaleString('en-IN')}. Browser-local estimate, resets ~12:30 PM IST.`}
      >
        <span className="text-xs">📊</span>
        <span className="text-[11px] text-gray-500 dark:text-slate-300 hidden md:inline">Reads</span>
        <div className="h-1.5 w-16 rounded-full bg-gray-200 dark:bg-slate-600 overflow-hidden">
          <div className={`h-full rounded-full ${barColor} transition-all duration-500`} style={{ width: `${pct}%` }} />
        </div>
        <span className={`text-xs font-semibold tabular-nums ${textColor}`}>{pct}%</span>
      </div>
    );
  }

  return (
    <div className="px-1 py-2" title="Estimate of Firestore reads this browser made today (resets at 12:30 PM IST). Not the exact Google-side number.">
      <div className="flex items-center justify-between mb-1 text-xs">
        <span className="text-gray-500">📊 Reads today (est.)</span>
        <span className={`font-semibold ${textColor}`}>{pct}%</span>
      </div>
      <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full ${barColor} transition-all duration-300`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[10px] text-gray-400 mt-1">
        {usage.reads.toLocaleString('en-IN')} / {LIMITS.reads.toLocaleString('en-IN')}
        {usage.writes > 0 && <> · {usage.writes.toLocaleString('en-IN')} writes</>}
      </p>
    </div>
  );
};

export default QuotaMeter;
