'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ChevronDown, Globe } from 'lucide-react';
import {
  formatSize,
  type UbunyeArch,
  type UbunyePickerFile,
  type UbunyePlatformId,
} from '@/lib/ubunye-release';
import { UBUNYE_STUDIO } from '@/lib/constants';
import { withAlpha } from './ubunye-styles';
import { detectSystem, type Detected } from './detect-system';

interface UbunyeDownloadPickerProps {
  appName: string;
  accent: string;
  webUrl: string;
  version: string | null;
  files: Record<UbunyePlatformId, UbunyePickerFile[]> | null;
}

const OS_TABS: { id: UbunyePlatformId; label: string; long: string }[] = [
  { id: 'windows', label: 'Windows', long: 'Windows' },
  { id: 'macos', label: 'Mac', long: 'Mac' },
  { id: 'linux', label: 'Linux', long: 'Linux' },
];

const ARCH_LABEL: Record<UbunyeArch, string> = {
  x64: 'Intel or AMD, 64-bit',
  arm64: 'ARM',
  x86: '32-bit',
  universal: 'Apple silicon and Intel',
};

export function UbunyeDownloadPicker({ appName, accent, webUrl, version, files }: UbunyeDownloadPickerProps) {
  const [os, setOs] = useState<UbunyePlatformId>('windows');
  const [arch, setArch] = useState<UbunyeArch | null>(null);
  const [detected, setDetected] = useState<Detected | null>(null);
  const [showOthers, setShowOthers] = useState(false);

  useEffect(() => {
    let live = true;
    detectSystem().then((d) => {
      if (!live) return;
      setDetected(d);
      if (d.os) setOs(d.os);
      if (d.arch) setArch(d.arch);
    });
    return () => {
      live = false;
    };
  }, []);

  const list = useMemo(() => files?.[os] ?? [], [files, os]);
  const mains = list.filter((f) => f.main);
  const archs = [...new Set(mains.map((f) => f.arch))].filter((a): a is UbunyeArch => a !== null);
  const chosenArch = arch && archs.includes(arch) ? arch : (archs[0] ?? null);
  const main = mains.find((f) => f.arch === chosenArch) ?? mains[0] ?? null;
  const others = list.filter((f) => f !== main);
  const tab = OS_TABS.find((t) => t.id === os) ?? OS_TABS[0];
  const suggested = detected?.os === os && (detected.arch === null || detected.arch === chosenArch);

  const pickOs = (id: UbunyePlatformId) => {
    setOs(id);
    setShowOthers(false);
    setArch(detected?.os === id ? detected.arch : null);
  };

  return (
    <div>
      {files && (
        <>
          <h3 className="font-sans text-base font-medium text-[var(--ub-text)]">Choose your operating system</h3>
          <div
            role="radiogroup"
            aria-label="Operating system"
            className="mt-4 grid grid-cols-3 gap-1 rounded-full border border-white/10 bg-black/30 p-1"
          >
            {OS_TABS.map((t) => {
              const on = t.id === os;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => pickOs(t.id)}
                  className={`min-h-[44px] rounded-full font-sans text-sm transition-colors ${
                    on ? 'bg-white/10 text-[var(--ub-text)]' : 'text-[var(--ub-text-2)] hover:text-[var(--ub-text)]'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {archs.length > 1 && (
            <div className="mt-4">
              <p className="font-sans text-xs text-[var(--ub-text-2)]">Processor</p>
              <div role="radiogroup" aria-label="Processor" className="mt-2 flex flex-wrap gap-2">
                {archs.map((a) => {
                  const on = a === chosenArch;
                  return (
                    <button
                      key={a}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setArch(a)}
                      className={`min-h-[44px] rounded-full border px-4 font-sans text-xs transition-colors ${
                        on ? 'text-[var(--ub-text)]' : 'border-white/15 text-[var(--ub-text-2)] hover:text-[var(--ub-text)]'
                      }`}
                      style={on ? { borderColor: accent, backgroundColor: withAlpha(accent, '1a') } : undefined}
                    >
                      {ARCH_LABEL[a]}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 font-sans text-xs text-[var(--ub-text-2)]">
                Not sure? Most computers are Intel or AMD, 64-bit.
              </p>
            </div>
          )}

          {main ? (
            <a
              href={main.url}
              download
              className="mt-5 flex min-h-[64px] flex-col items-center justify-center rounded-2xl px-6 py-4 text-center text-[var(--ub-bg)] transition-opacity hover:opacity-90"
              style={{ backgroundColor: accent }}
            >
              <span className="inline-flex items-center gap-2 font-sans text-lg font-semibold">
                <ArrowDown className="h-5 w-5" aria-hidden="true" />
                Download for {tab.long}
              </span>
              <span className="mt-1 font-sans text-xs opacity-80">
                {main.label} · {formatSize(main.size)} · Free, no account needed
              </span>
            </a>
          ) : (
            <p className="mt-5 rounded-2xl border border-white/10 px-6 py-5 text-center font-sans text-sm text-[var(--ub-text-2)]">
              No {tab.long} download in this release yet.
            </p>
          )}

          <p className="mt-3 min-h-[1rem] text-center font-sans text-xs text-[var(--ub-text-2)]">
            {detected?.mobile
              ? `${appName} is a desktop app. Download it on your computer, or open it in your browser.`
              : suggested
                ? 'We picked this for your computer. Choose another system above if it is wrong.'
                : ''}
          </p>
        </>
      )}

      <a
        href={webUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 flex min-h-[64px] flex-col items-center justify-center rounded-2xl border px-6 py-4 text-center text-[var(--ub-text)] transition-colors hover:bg-white/5"
        style={{ borderColor: withAlpha(accent, '80') }}
      >
        <span className="inline-flex items-center gap-2 font-sans text-base font-medium">
          <Globe className="h-5 w-5" aria-hidden="true" />
          Open in browser
        </span>
        <span className="mt-1 font-sans text-xs text-[var(--ub-text-2)]">Nothing to install</span>
      </a>

      {files && (
        <>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 font-sans text-xs text-[var(--ub-text-2)]">
            <span>{version ? `Version ${version}, early version` : ''}</span>
            {others.length > 0 && (
              <button
                type="button"
                onClick={() => setShowOthers((v) => !v)}
                aria-expanded={showOthers}
                className="inline-flex min-h-[44px] items-center gap-1 hover:text-[var(--ub-text)]"
              >
                Other {tab.long} formats ({others.length})
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${showOthers ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
              </button>
            )}
          </div>

          {showOthers && (
            <ul className="mt-1 divide-y divide-white/5 rounded-2xl border border-white/10 px-4">
              {others.map((f) => (
                <li key={f.name}>
                  <a
                    href={f.url}
                    download
                    className="flex min-h-[48px] items-center justify-between gap-4 font-sans text-sm text-[var(--ub-text)] hover:text-white"
                  >
                    <span>{f.label}</span>
                    <span className="shrink-0 text-xs text-[var(--ub-text-2)]">{formatSize(f.size)}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}

          {!UBUNYE_STUDIO.install.signed && (
            <p className="mt-4 font-sans text-xs leading-relaxed text-[var(--ub-text-2)]">
              {UBUNYE_STUDIO.install.trustNote}
              {os === 'macos' && ` ${UBUNYE_STUDIO.install.macNote}`}
            </p>
          )}
        </>
      )}
    </div>
  );
}
