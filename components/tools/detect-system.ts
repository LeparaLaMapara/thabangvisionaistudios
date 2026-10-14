import { useEffect, useState } from 'react';
import type { UbunyeArch, UbunyePlatformId } from '@/lib/ubunye-release';

// Shared by the /tools page and the /tools/[app] download picker.

export interface Detected {
  os: UbunyePlatformId | null;
  arch: UbunyeArch | null;
  mobile: boolean;
}

interface UADataLike {
  mobile?: boolean;
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string; bitness?: string }>;
}

/** Best guess at the visitor's system. Falls back to nothing rather than guessing wrong. */
export async function detectSystem(): Promise<Detected> {
  const ua = navigator.userAgent;
  const data = (navigator as Navigator & { userAgentData?: UADataLike }).userAgentData;
  const ipadDesktopMode = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  const mobile = Boolean(data?.mobile) || /Android|iPhone|iPad|iPod/i.test(ua) || ipadDesktopMode;
  if (mobile) return { os: null, arch: null, mobile: true };

  const platform = data?.platform ?? '';
  let os: UbunyePlatformId | null = null;
  if (/Windows/i.test(platform) || /Windows/.test(ua)) os = 'windows';
  else if (/macOS/i.test(platform) || /Mac OS X|Macintosh/.test(ua)) os = 'macos';
  else if (/Linux|Chrome OS/i.test(platform) || /Linux|X11|CrOS/.test(ua)) os = 'linux';

  let arch: UbunyeArch | null = os === 'macos' ? 'universal' : null;
  if (os === 'windows' || os === 'linux') {
    arch = /aarch64|arm64/i.test(ua) ? 'arm64' : /WOW64|Win64|x86_64|x64|amd64/i.test(ua) ? 'x64' : null;
    try {
      const hints = await data?.getHighEntropyValues?.(['architecture', 'bitness']);
      if (hints?.architecture === 'arm') arch = 'arm64';
      else if (hints?.architecture === 'x86') arch = hints.bitness === '32' ? 'x86' : 'x64';
    } catch {
      // Hints refused: keep the user-agent guess.
    }
  }
  return { os, arch, mobile: false };
}

/** The visitor's system once known; null until detection finishes (and during SSR). */
export function useDetectedSystem(): Detected | null {
  const [detected, setDetected] = useState<Detected | null>(null);
  useEffect(() => {
    let live = true;
    detectSystem().then((d) => {
      if (live) setDetected(d);
    });
    return () => {
      live = false;
    };
  }, []);
  return detected;
}
