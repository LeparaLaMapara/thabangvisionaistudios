'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Search, X } from 'lucide-react';
import { ADMIN_SECTIONS } from '@/lib/admin/control-room/sections';

interface Hit {
  kind: string;
  label: string;
  sub: string;
  href: string;
}

const KIND_LABEL: Record<string, string> = {
  page: 'Go to',
  person: 'Person',
  'gear-booking': 'Bookings',
  gear: 'Gear',
  'service-booking': 'Crew booking',
  production: 'Production',
  press: 'Press',
};

/** Every admin screen, so typing "refund" or "id check" goes straight there. */
const PAGES: (Hit & { words: string })[] = ADMIN_SECTIONS.flatMap((s) =>
  s.id === 'today'
    ? [{ kind: 'page', label: 'Today', sub: s.hint, href: s.href, words: 'today home dashboard needs' }]
    : s.tools.map((t) => ({
        kind: 'page',
        label: t.label,
        sub: `${s.label} · ${t.hint}`,
        href: t.href,
        words: `${t.label} ${s.label} ${t.hint} ${t.keywords ?? ''}`.toLowerCase(),
      })),
);

function matchPages(q: string): Hit[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return PAGES.slice(0, 8);
  return PAGES.filter((p) => words.every((w) => p.words.includes(w))).slice(0, 5);
}

/** Mounted only while open, so every opening starts empty. */
export function AdminSearch({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState<{ term: string; hits: Hit[] }>({ term: '', hits: [] });
  const [active, setActive] = useState(0);
  const term = q.trim();

  useEffect(() => {
    input.current?.focus();
  }, []);

  // Ask the server after a short pause in typing.
  useEffect(() => {
    if (term.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/admin/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal, cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : { hits: [] }))
        .then((d: { hits?: Hit[] }) => setRemote({ term, hits: d.hits ?? [] }))
        .catch(() => {});
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [term]);

  const fresh = term.length >= 2 && remote.term === term;
  const loading = term.length >= 2 && !fresh;
  const hits = useMemo(() => [...matchPages(term), ...(fresh ? remote.hits : [])], [term, fresh, remote.hits]);
  const current = Math.min(active, Math.max(hits.length - 1, 0));

  function go(h: Hit) {
    onClose();
    router.push(h.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(current + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(current - 1, 0));
    } else if (e.key === 'Enter' && hits[current]) {
      e.preventDefault();
      go(hits[current]);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[10vh]" role="dialog" aria-modal="true" aria-label="Find anything">
      <button type="button" aria-label="Close search" className="absolute inset-0 bg-black/75" onClick={onClose} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-white/15 bg-[#111] shadow-2xl" onKeyDown={onKeyDown}>
        <div className="flex items-center gap-3 border-b border-white/10 px-4">
          <Search className="h-5 w-5 flex-shrink-0 text-neutral-400" aria-hidden="true" />
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            placeholder="A name, a phone number, gear, a booking number, a page…"
            aria-label="Search"
            aria-controls="admin-search-results"
            aria-activedescendant={hits[current] ? `admin-hit-${current}` : undefined}
            className="h-14 flex-1 bg-transparent text-base text-white placeholder:text-neutral-500 focus:outline-none"
          />
          <button type="button" onClick={onClose} aria-label="Close search" className="flex h-11 w-11 items-center justify-center rounded-lg text-neutral-400 hover:text-white">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <ul id="admin-search-results" role="listbox" className="max-h-[60vh] overflow-y-auto py-2">
          {hits.map((h, i) => (
            <li key={`${h.kind}:${h.href}:${h.label}:${i}`} id={`admin-hit-${i}`} role="option" aria-selected={i === current}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(h)}
                className={`flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left ${i === current ? 'bg-white/[0.07]' : ''}`}
              >
                <span className="w-24 flex-shrink-0 text-xs text-neutral-500">{KIND_LABEL[h.kind] ?? h.kind}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] text-white">{h.label}</span>
                  <span className="block truncate text-xs text-neutral-400">{h.sub}</span>
                </span>
                {i === current && <ArrowRight className="h-4 w-4 flex-shrink-0 text-accent-gold" aria-hidden="true" />}
              </button>
            </li>
          ))}
          {!hits.length && !loading && (
            <li className="px-4 py-6 text-center text-sm text-neutral-400">Nothing found for “{term}”.</li>
          )}
          {loading && <li className="px-4 py-3 text-xs text-neutral-500">Searching people, gear and bookings…</li>}
        </ul>
        <p className="hidden border-t border-white/10 px-4 py-2 text-[11px] text-neutral-500 sm:block">
          ↑ ↓ to move · Enter to open · Esc to close
        </p>
      </div>
    </div>
  );
}
