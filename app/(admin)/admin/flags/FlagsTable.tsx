'use client';

import { useState, useTransition } from 'react';
import type { FeatureFlag } from '@/lib/features';
import { toggleFlag } from './actions';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-ZA', {
      timeZone: 'Africa/Johannesburg',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function FlagsTable({ flags }: { flags: FeatureFlag[] }) {
  const [pending, startTransition] = useTransition();
  const [localFlags, setLocalFlags] = useState(flags);
  const [error, setError] = useState<string | null>(null);

  const onToggle = (key: string, next: boolean) => {
    const ok = confirm(`Turn ${next ? 'ON' : 'OFF'} flag "${key}"?`);
    if (!ok) return;
    setError(null);
    setLocalFlags((prev) => prev.map((f) => (f.key === key ? { ...f, enabled: next } : f)));
    startTransition(async () => {
      const result = await toggleFlag(key, next);
      if (!result.ok) {
        setError(result.error);
        setLocalFlags((prev) => prev.map((f) => (f.key === key ? { ...f, enabled: !next } : f)));
      }
    });
  };

  return (
    <div>
      {error && (
        <div className="mb-4 px-4 py-3 border border-red-500/30 bg-red-500/10 text-red-300 text-sm">
          {error}
        </div>
      )}

      <div className="border border-white/10 divide-y divide-white/10">
        {localFlags.map((flag) => (
          <div key={flag.key} className="flex items-start gap-4 p-4 hover:bg-white/[0.02]">
            <div className="flex-1 min-w-0">
              <div className="font-mono text-sm text-white">{flag.key}</div>
              {flag.description && (
                <p className="mt-1 text-xs text-neutral-400">{flag.description}</p>
              )}
              <p className="mt-2 text-[10px] font-mono text-neutral-500 uppercase tracking-widest">
                Updated {formatDate(flag.updated_at)}
              </p>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={flag.enabled}
              disabled={pending}
              onClick={() => onToggle(flag.key, !flag.enabled)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50 ${
                flag.enabled
                  ? 'bg-[#D4A843] border-[#D4A843]'
                  : 'bg-neutral-800 border-neutral-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  flag.enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        ))}
      </div>

      {localFlags.length === 0 && (
        <p className="text-sm text-neutral-400">No feature flags configured.</p>
      )}
    </div>
  );
}
