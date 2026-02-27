import { useEffect, useState } from 'react';

const MOBILE_MEDIA_QUERY = '(max-width: 768px)';

const getScopedStorageKey = (storageKey) => {
  if (typeof window === 'undefined') return storageKey;
  const isMobile = window.matchMedia(MOBILE_MEDIA_QUERY).matches;
  return `${storageKey}-${isMobile ? 'mobile' : 'desktop'}`;
};

const getInitialViewMode = (scopedStorageKey, desktopDefault) => {
  if (typeof window === 'undefined') return desktopDefault;

  const stored = window.localStorage.getItem(scopedStorageKey);
  if (stored === 'card' || stored === 'table') {
    return stored;
  }

  return window.matchMedia(MOBILE_MEDIA_QUERY).matches ? 'card' : desktopDefault;
};

const useResponsiveViewMode = (storageKey, desktopDefault = 'table') => {
  const [scopedStorageKey, setScopedStorageKey] = useState(() => getScopedStorageKey(storageKey));
  const [viewMode, setViewMode] = useState(() => getInitialViewMode(getScopedStorageKey(storageKey), desktopDefault));

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const mediaQuery = window.matchMedia(MOBILE_MEDIA_QUERY);
    const handleDeviceChange = () => {
      const nextScopedKey = getScopedStorageKey(storageKey);
      setScopedStorageKey(nextScopedKey);
      setViewMode(getInitialViewMode(nextScopedKey, desktopDefault));
    };

    mediaQuery.addEventListener('change', handleDeviceChange);

    return () => {
      mediaQuery.removeEventListener('change', handleDeviceChange);
    };
  }, [desktopDefault, storageKey]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(scopedStorageKey, viewMode);
    }
  }, [scopedStorageKey, viewMode]);

  return {
    viewMode,
    setViewMode,
    isCardView: viewMode === 'card'
  };
};

export default useResponsiveViewMode;
