'use client';

import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';

/**
 * "Turn on notifications", shown on the dashboard only to someone with
 * something to hear about (a booking, a listing, a job or an ID check in
 * progress) and never on a first visit. Hidden once they answer or close it.
 *
 * iPhone and iPad: web push works only from the home screen app (iOS 16.4+).
 * In Safari we explain how to add it instead of showing a button that cannot work.
 *
 * localStorage holds only "closed" and a visit count, never anything about auth.
 */

const CLOSED_KEY = 'tv-push-prompt-closed';
const VISITS_KEY = 'tv-push-prompt-visits';

type View = 'hidden' | 'ask' | 'ios-install' | 'busy' | 'on' | 'blocked' | 'error';

function readNumber(key: string): number {
  try {
    return Number(window.localStorage.getItem(key) ?? '0') || 0;
  } catch {
    return 0;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode: the prompt just shows again next time */
  }
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export default function PushPrompt({ eligible }: { eligible: boolean }) {
  const [view, setView] = useState<View>('hidden');

  useEffect(() => {
    if (!eligible) return;
    let closed = false;
    try {
      closed = window.localStorage.getItem(CLOSED_KEY) === '1';
    } catch {
      closed = false;
    }
    if (closed) return;
    const visits = readNumber(VISITS_KEY) + 1;
    write(VISITS_KEY, String(visits));
    if (visits < 2) return; // never on the first visit

    if (isIos() && !isStandalone()) {
      setView('ios-install');
      return;
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
    if (Notification.permission === 'denied') return;
    if (Notification.permission === 'granted') {
      // Already allowed: make sure this browser is saved, quietly.
      navigator.serviceWorker.getRegistration('/').then(async (reg) => {
        const sub = await reg?.pushManager.getSubscription();
        if (!sub) setView('ask');
      }).catch(() => undefined);
      return;
    }
    setView('ask');
  }, [eligible]);

  const close = () => {
    write(CLOSED_KEY, '1');
    setView('hidden');
  };

  const turnOn = async () => {
    setView('busy');
    try {
      const keyRes = await fetch('/api/push/subscription');
      const { publicKey } = (await keyRes.json()) as { publicKey: string | null };
      if (!publicKey) {
        setView('error');
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        write(CLOSED_KEY, '1');
        setView('blocked');
        return;
      }
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
      const res = await fetch('/api/push/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error('save failed');
      write(CLOSED_KEY, '1');
      setView('on');
    } catch {
      setView('error');
    }
  };

  if (view === 'hidden') return null;

  return (
    <div className="bg-[#0A0A0B] border border-[#D4A843]/30 p-5 mb-10 flex items-start gap-4" role="region" aria-label="Notifications">
      <Bell className="w-6 h-6 text-[#D4A843] flex-shrink-0 mt-1" aria-hidden />
      <div className="flex-1 text-sm text-neutral-300 leading-relaxed">
        {view === 'ask' || view === 'busy' ? (
          <>
            <p className="text-white font-medium mb-1">Get a notification when something changes</p>
            <p className="text-neutral-400 mb-4">When a booking is confirmed, your ID check is done or someone answers you. You can switch it off any time in your browser.</p>
            <button
              onClick={turnOn}
              disabled={view === 'busy'}
              className="min-h-[44px] px-5 bg-[#D4A843] text-[#050505] text-xs font-mono font-bold uppercase tracking-widest disabled:opacity-50"
            >
              {view === 'busy' ? 'Turning on…' : 'Turn on notifications'}
            </button>
          </>
        ) : view === 'ios-install' ? (
          <>
            <p className="text-white font-medium mb-1">Notifications on iPhone and iPad</p>
            <p className="text-neutral-400">
              Apple only allows notifications from the home screen. In Safari, tap the Share button, then Add to Home Screen.
              Open the site from that new icon, and this button will appear here.
            </p>
          </>
        ) : view === 'on' ? (
          <p className="text-white">Notifications are on for this device.</p>
        ) : view === 'blocked' ? (
          <p className="text-neutral-400">Notifications are off. To change that later, allow them for this site in your browser settings.</p>
        ) : (
          <p className="text-neutral-400">That did not work. Please try again later.</p>
        )}
      </div>
      <button onClick={close} aria-label="Close" className="min-h-[44px] min-w-[44px] flex items-center justify-center text-neutral-400 hover:text-white">
        <X className="w-4 h-4" aria-hidden />
      </button>
    </div>
  );
}
