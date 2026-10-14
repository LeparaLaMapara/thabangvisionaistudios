'use client';

import { useState } from 'react';
import Image from 'next/image';
import { ArrowDown, Globe } from 'lucide-react';
import { UBUNYE_STUDIO } from '@/lib/constants';
import { formatSize, type UbunyeInstaller, type UbunyePlatformId } from '@/lib/ubunye-release';
import { useDetectedSystem } from './detect-system';
import { withAlpha } from './ubunye-styles';

/** What the /tools buttons need about one app (built on the server from the release manifest). */
export interface UbunyeAppLinks {
  slug: string;
  name: string;
  accent: string;
  iconPng: string;
  webUrl: string;
  installers: Record<UbunyePlatformId, UbunyeInstaller | null>;
}

const OS: { id: UbunyePlatformId; label: string }[] = [
  { id: 'windows', label: 'Windows' },
  { id: 'macos', label: 'Mac' },
  { id: 'linux', label: 'Linux' },
];
const osLabel = (id: UbunyePlatformId): string => OS.find((o) => o.id === id)?.label ?? id;

const PRIMARY =
  'inline-flex min-h-[48px] items-center justify-center gap-2 whitespace-nowrap rounded-full px-6 font-sans text-base font-medium transition-opacity hover:opacity-90';
const SECONDARY =
  'inline-flex min-h-[48px] items-center justify-center gap-2 whitespace-nowrap rounded-full border border-white/20 px-6 font-sans text-base text-[var(--ub-text)] transition-colors hover:border-white/40 hover:bg-white/5';

/** The calm "your computer may ask" line, shown near Download while the apps are unsigned. */
export function UbunyeTrustNote({ os, className = '' }: { os: UbunyePlatformId | null; className?: string }) {
  const { install } = UBUNYE_STUDIO;
  if (install.signed) return null;
  return (
    <p className={`font-sans text-xs leading-relaxed text-[var(--ub-text-2)] ${className}`}>
      {install.trustNote}
      {os === 'macos' && <> {install.macNote}</>}
    </p>
  );
}

function OsTabs({ value, onChange }: { value: UbunyePlatformId | null; onChange: (id: UbunyePlatformId) => void }) {
  return (
    <div role="radiogroup" aria-label="Your computer" className="grid grid-cols-3 gap-1 rounded-full border border-white/10 bg-black/30 p-1">
      {OS.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.id)}
            className={`min-h-[44px] rounded-full font-sans text-sm transition-colors ${
              on ? 'bg-white/10 text-[var(--ub-text)]' : 'text-[var(--ub-text-2)] hover:text-[var(--ub-text)]'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The hero's buttons. The primary one names the visitor's computer ("Download
 * for Windows"); on a phone it becomes "Try it in your browser", since the
 * desktop apps are not for phones. Either opens a small chooser of the three
 * apps. Until the system is known, or if it cannot be told, the chooser asks.
 */
export function UbunyeHeroButtons({ apps }: { apps: UbunyeAppLinks[] }) {
  const detected = useDetectedSystem();
  const [mode, setMode] = useState<'download' | 'browser' | null>(null);
  const [os, setOs] = useState<UbunyePlatformId | null>(null);
  const chosenOs = os ?? detected?.os ?? null;
  const mobile = detected?.mobile ?? false;
  const accent = UBUNYE_STUDIO.colors.text;

  const open = (m: 'download' | 'browser') => setMode((cur) => (cur === m ? null : m));

  return (
    <div className="flex flex-col items-center">
      <div className="flex w-full max-w-sm flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center">
        {mobile ? (
          <button
            type="button"
            onClick={() => open('browser')}
            aria-expanded={mode === 'browser'}
            aria-controls="ubunye-chooser"
            className={PRIMARY}
            style={{ backgroundColor: accent, color: UBUNYE_STUDIO.colors.bg }}
          >
            <Globe className="h-5 w-5" aria-hidden="true" />
            {UBUNYE_STUDIO.hero.browserCta}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => open('download')}
              aria-expanded={mode === 'download'}
              aria-controls="ubunye-chooser"
              className={PRIMARY}
              style={{ backgroundColor: accent, color: UBUNYE_STUDIO.colors.bg }}
            >
              <ArrowDown className="h-5 w-5" aria-hidden="true" />
              {detected?.os ? `Download for ${osLabel(detected.os)}` : 'Download'}
            </button>
            <button
              type="button"
              onClick={() => open('browser')}
              aria-expanded={mode === 'browser'}
              aria-controls="ubunye-chooser"
              className={SECONDARY}
            >
              <Globe className="h-5 w-5" aria-hidden="true" />
              {UBUNYE_STUDIO.hero.browserCta}
            </button>
          </>
        )}
      </div>

      {mode && (
        <div
          id="ubunye-chooser"
          role="region"
          aria-label={mode === 'download' ? 'Choose an app to download' : 'Choose an app to open in your browser'}
          className="mt-6 w-full max-w-md rounded-[22px] border border-white/10 bg-[var(--ub-bg-2)] p-4 text-left sm:p-5"
        >
          {mode === 'download' && (
            <div className="mb-4">
              <OsTabs value={chosenOs} onChange={setOs} />
            </div>
          )}
          <ul className="space-y-2">
            {apps.map((app) => {
              const file = mode === 'download' && chosenOs ? app.installers[chosenOs] : null;
              return (
                <li key={app.slug} className="flex min-h-[56px] items-center gap-3 rounded-2xl px-2">
                  <Image src={app.iconPng} alt="" width={40} height={40} unoptimized className="h-10 w-10 shrink-0" />
                  <span className="flex-1 font-sans text-base text-[var(--ub-text)]">{app.name}</span>
                  {mode === 'browser' ? (
                    <a
                      href={app.webUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[44px] items-center rounded-full border px-4 font-sans text-sm text-[var(--ub-text)] hover:bg-white/5"
                      style={{ borderColor: withAlpha(app.accent, '80') }}
                    >
                      Open
                    </a>
                  ) : file ? (
                    <a
                      href={file.url}
                      download
                      className="inline-flex min-h-[44px] items-center gap-1 rounded-full px-4 font-sans text-sm font-medium hover:opacity-90"
                      style={{ backgroundColor: app.accent, color: UBUNYE_STUDIO.colors.bg }}
                      aria-label={`Download ${app.name} for ${chosenOs ? osLabel(chosenOs) : ''}, ${formatSize(file.size)}`}
                    >
                      <ArrowDown className="h-4 w-4" aria-hidden="true" />
                      {formatSize(file.size)}
                    </a>
                  ) : (
                    <span className="font-sans text-xs text-[var(--ub-text-2)]">
                      {chosenOs ? 'Not yet' : 'Pick above'}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {mode === 'download' && <UbunyeTrustNote os={chosenOs} className="mt-4 px-2" />}
        </div>
      )}
    </div>
  );
}

/**
 * One app's two buttons. Download goes straight to the installer for the
 * visitor's computer when we know it; otherwise it opens a small chooser.
 * On a phone, "Open in browser" leads, since the desktop app is not for phones.
 */
export function UbunyeAppButtons({ app }: { app: UbunyeAppLinks }) {
  const detected = useDetectedSystem();
  const [choosing, setChoosing] = useState(false);
  const mobile = detected?.mobile ?? false;
  const direct = !mobile && detected?.os ? app.installers[detected.os] : null;
  const hasAny = OS.some((o) => app.installers[o.id] !== null);
  const chooserId = `ubunye-get-${app.slug}`;

  const browser = (
    <a
      href={app.webUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={mobile ? PRIMARY : SECONDARY}
      style={mobile ? { backgroundColor: app.accent, color: UBUNYE_STUDIO.colors.bg } : undefined}
    >
      <Globe className="h-5 w-5" aria-hidden="true" />
      Open in browser
    </a>
  );

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {mobile && browser}
        {hasAny &&
          (direct && detected?.os ? (
            <a
              href={direct.url}
              download
              className={mobile ? SECONDARY : PRIMARY}
              style={{ backgroundColor: app.accent, color: UBUNYE_STUDIO.colors.bg }}
            >
              <ArrowDown className="h-5 w-5" aria-hidden="true" />
              Download for {osLabel(detected.os)}
            </a>
          ) : (
            <button
              type="button"
              onClick={() => setChoosing((v) => !v)}
              aria-expanded={choosing}
              aria-controls={chooserId}
              className={mobile ? SECONDARY : PRIMARY}
              style={mobile ? undefined : { backgroundColor: app.accent, color: UBUNYE_STUDIO.colors.bg }}
            >
              <ArrowDown className="h-5 w-5" aria-hidden="true" />
              {mobile ? 'Download for a computer' : 'Download'}
            </button>
          ))}
        {!mobile && browser}
      </div>

      {choosing && !direct && (
        <ul id={chooserId} className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {OS.map((o) => {
            const file = app.installers[o.id];
            return (
              <li key={o.id}>
                {file ? (
                  <a
                    href={file.url}
                    download
                    className="flex min-h-[48px] flex-col items-center justify-center rounded-2xl border border-white/15 px-3 py-2 text-center font-sans text-sm text-[var(--ub-text)] hover:bg-white/5"
                  >
                    {o.label}
                    <span className="text-xs text-[var(--ub-text-2)]">{formatSize(file.size)}</span>
                  </a>
                ) : (
                  <span className="flex min-h-[48px] items-center justify-center rounded-2xl border border-white/5 px-3 font-sans text-xs text-[var(--ub-text-2)]">
                    {o.label}: not yet
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {hasAny && !mobile && (direct || choosing) && (
        <UbunyeTrustNote os={direct ? (detected?.os ?? null) : 'macos'} className="mt-3 max-w-md" />
      )}
    </div>
  );
}
