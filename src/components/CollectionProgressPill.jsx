import { useEffect, useState } from 'react';
import { getCollectionProgress, COLLECTION_EVENT } from '../utils/collectionProgress';

// Compact top-bar view of this month's collection progress, fed by the Dashboard.
const CollectionProgressPill = () => {
  const [data, setData] = useState(getCollectionProgress());

  useEffect(() => {
    const sync = () => setData(getCollectionProgress());
    window.addEventListener(COLLECTION_EVENT, sync);
    return () => window.removeEventListener(COLLECTION_EVENT, sync);
  }, []);

  if (!data || !data.expected) return null;

  const pct = Math.min(100, Math.round((data.collected / data.expected) * 100));
  const bar = pct >= 80 ? 'from-green-400 to-emerald-500' : pct >= 40 ? 'from-yellow-400 to-amber-500' : 'from-orange-400 to-red-500';

  return (
    <div
      className="flex items-center gap-2"
      title={`Collected ₹${Math.round(data.collected).toLocaleString('en-IN')} of ₹${Math.round(data.expected).toLocaleString('en-IN')} this month`}
    >
      <span className="text-xs font-semibold text-gray-600 dark:text-slate-300 hidden sm:inline">📈 Collection</span>
      <div className="h-2 w-24 sm:w-36 rounded-full bg-gray-200 dark:bg-slate-600 overflow-hidden ring-1 ring-inset ring-gray-300/60 dark:ring-slate-500/40">
        <div className={`h-full rounded-full bg-gradient-to-r ${bar} transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{pct}%</span>
    </div>
  );
};

export default CollectionProgressPill;
