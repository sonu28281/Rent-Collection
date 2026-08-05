// Lightweight, browser-local estimate of how many Firestore operations this app
// has performed "today". This is NOT the real Google-side quota number (the
// client SDK doesn't expose that) — it only counts reads/writes made by THIS
// browser through the app. Still useful as a "am I hammering the DB today?" gauge.
//
// Firestore's free-tier quota resets at midnight Pacific Time, so we bucket usage
// by the current PT calendar date and auto-reset when it rolls over.

export const LIMITS = { reads: 50000, writes: 20000 };
const KEY = 'callvia_quota_usage';
const EVENT = 'callvia-quota-changed';

const ptDateKey = () => {
  try {
    // en-CA gives YYYY-MM-DD
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
};

const read = () => {
  const today = ptDateKey();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (raw.date !== today) return { date: today, reads: 0, writes: 0 };
    return { date: today, reads: Number(raw.reads) || 0, writes: Number(raw.writes) || 0 };
  } catch {
    return { date: today, reads: 0, writes: 0 };
  }
};

const persist = (usage) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(usage));
  } catch {
    /* storage unavailable — ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: usage }));
  } catch {
    /* no window (SSR) — ignore */
  }
};

export const recordReads = (n = 1) => {
  const count = Number(n) || 0;
  if (count <= 0) return;
  const usage = read();
  usage.reads += count;
  persist(usage);
};

export const recordWrites = (n = 1) => {
  const count = Number(n) || 0;
  if (count <= 0) return;
  const usage = read();
  usage.writes += count;
  persist(usage);
};

export const getUsage = () => ({ ...read(), limits: LIMITS });

export const QUOTA_EVENT = EVENT;
