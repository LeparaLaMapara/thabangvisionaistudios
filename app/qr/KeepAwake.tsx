'use client';

import { useEffect } from 'react';

/** Keeps the phone screen on while the code is being shown to a room. */
export function KeepAwake() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const request = async () => {
      try {
        lock = await navigator.wakeLock?.request('screen');
      } catch {
        // Not supported or refused (low battery): the page still works.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request();
    };
    void request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release();
    };
  }, []);
  return null;
}
