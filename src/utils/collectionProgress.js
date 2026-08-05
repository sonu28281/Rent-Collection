// Tiny in-memory bus so the Dashboard can publish this month's collection
// progress and the global TopBar can display it without prop-drilling or an
// extra data fetch. Last value is kept so the pill survives route changes.

let current = null; // { collected, expected, monthLabel }
export const COLLECTION_EVENT = 'callvia-collection-progress';

export const setCollectionProgress = (data) => {
  current = data;
  try {
    window.dispatchEvent(new CustomEvent(COLLECTION_EVENT, { detail: data }));
  } catch {
    /* no window */
  }
};

export const getCollectionProgress = () => current;
