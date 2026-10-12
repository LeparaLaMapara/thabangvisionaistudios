'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CalendarCheck,
  Camera,
  LifeBuoy,
  Menu,
  Newspaper,
  Search,
  Settings,
  Sun,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { ADMIN_SECTIONS, sectionForPath, type CountKey, type SectionId } from '@/lib/admin/control-room/sections';
import { STUDIO } from '@/lib/constants';
import { LogoutButton } from '@/components/admin/LogoutButton';
import { AdminSearch } from './AdminSearch';

const ICONS: Record<SectionId, LucideIcon> = {
  today: Sun,
  bookings: CalendarCheck,
  money: Wallet,
  people: Users,
  gear: Camera,
  content: Newspaper,
  help: LifeBuoy,
  settings: Settings,
};

/** The four sections on the phone's bottom bar; the rest sit behind "Menu". */
const PHONE_TABS: SectionId[] = ['today', 'bookings', 'money', 'people'];

type Counts = Partial<Record<CountKey, number>>;
type Areas = Partial<Record<SectionId, number>>;

/** A section's number is how many Today items belong to it, so the two always agree. */
function sectionCount(id: SectionId, areas: Areas): number {
  return areas[id] ?? 0;
}

function Badge({ n, quiet }: { n: number; quiet?: boolean }) {
  if (!n) return null;
  return (
    <span
      className={`ml-auto inline-flex min-w-[1.5rem] items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums ${
        quiet ? 'bg-white/10 text-neutral-300' : 'bg-accent-gold text-background'
      }`}
    >
      {n > 99 ? '99+' : n}
    </span>
  );
}

function isActiveTool(pathname: string, href: string, all: string[]): boolean {
  if (!(pathname === href || pathname.startsWith(`${href}/`))) return false;
  // A longer link that also matches wins (Import a rate card beats All gear).
  return !all.some((h) => h !== href && h.length > href.length && (pathname === h || pathname.startsWith(`${h}/`)));
}

function MenuBody({ pathname, counts, areas, onNavigate }: { pathname: string; counts: Counts; areas: Areas; onNavigate?: () => void }) {
  const current = sectionForPath(pathname);
  const allHrefs = ADMIN_SECTIONS.flatMap((s) => s.tools.map((t) => t.href));
  return (
    <nav aria-label="Admin" className="flex flex-col gap-1">
      {ADMIN_SECTIONS.map((s) => {
        const Icon = ICONS[s.id];
        const open = s.id === current;
        const total = s.id === 'today' ? 0 : sectionCount(s.id, areas);
        return (
          <div key={s.id}>
            <Link
              href={s.href}
              onClick={onNavigate}
              aria-current={s.id === 'today' && pathname === '/admin' ? 'page' : undefined}
              className={`flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-[15px] transition-colors ${
                open ? 'bg-white/[0.07] text-white' : 'text-neutral-300 hover:bg-white/[0.04] hover:text-white'
              }`}
            >
              <Icon className={`h-[18px] w-[18px] flex-shrink-0 ${open ? 'text-accent-gold' : 'text-neutral-400'}`} aria-hidden="true" />
              <span className="font-medium">{s.label}</span>
              {!open && <Badge n={total} quiet />}
            </Link>
            {open && s.tools.length > 0 && (
              <ul className="mb-2 ml-[2.1rem] mt-1 flex flex-col border-l border-white/10">
                {s.tools.map((t) => {
                  const active = isActiveTool(pathname, t.href, allHrefs);
                  return (
                    <li key={t.href}>
                      <Link
                        href={t.href}
                        onClick={onNavigate}
                        aria-current={active ? 'page' : undefined}
                        className={`-ml-px flex min-h-[40px] items-center gap-2 border-l-2 py-1.5 pl-3 pr-2 text-sm transition-colors ${
                          active ? 'border-accent-gold text-white' : 'border-transparent text-neutral-400 hover:text-white'
                        }`}
                      >
                        <span>{t.label}</span>
                        <Badge n={t.countKey ? counts[t.countKey] ?? 0 : 0} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}

/**
 * The frame around every admin page: the eight sections on the left (a
 * drawer and a bottom bar on a phone), one search box, and the counts of
 * what waits in each place.
 */
export function AdminShell({ email, children }: { email: string; children: React.ReactNode }) {
  const pathname = usePathname() ?? '/admin';
  const [drawer, setDrawer] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [counts, setCounts] = useState<Counts>({});
  const [areas, setAreas] = useState<Areas>({});

  // Fresh counts on every page change; the page never waits for them.
  useEffect(() => {
    let live = true;
    fetch('/api/admin/today', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { counts?: Counts; areas?: Areas } | null) => {
        if (!live || !d) return;
        if (d.counts) setCounts(d.counts);
        if (d.areas) setAreas(d.areas);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [pathname]);

  const openSearch = useCallback(() => setSearchOpen(true), []);

  // Ctrl+K or Cmd+K anywhere, or "/" when not typing, opens the search.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName));
      if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Keep the page behind the drawer still.
  useEffect(() => {
    document.body.style.overflow = drawer ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [drawer]);

  const current = sectionForPath(pathname);

  return (
    <div className="min-h-screen bg-background text-white">
      {/* Desktop side menu */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-white/10 bg-[#0a0a0a] lg:flex">
        <div className="flex h-16 items-center gap-2 px-5">
          <span className="font-display text-sm font-bold uppercase tracking-[0.2em] text-white">{STUDIO.shortName}</span>
          <span className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-neutral-400">Admin</span>
        </div>
        <div className="px-3 pb-3">
          <button
            type="button"
            onClick={openSearch}
            className="flex min-h-[44px] w-full items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-left text-sm text-neutral-400 transition-colors hover:border-white/20 hover:text-white"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            <span className="flex-1">Find anything</span>
            <kbd className="rounded border border-white/15 px-1.5 text-[11px] text-neutral-500">Ctrl K</kbd>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          <MenuBody pathname={pathname} counts={counts} areas={areas} />
        </div>
        <div className="border-t border-white/10 px-5 py-4">
          <p className="truncate text-xs text-neutral-500" title={email}>{email}</p>
          <div className="mt-2">
            <LogoutButton />
          </div>
        </div>
      </aside>

      {/* Phone and tablet top bar */}
      <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-white/10 bg-[#0a0a0a]/90 px-2 backdrop-blur-md lg:hidden">
        <button
          type="button"
          onClick={() => setDrawer(true)}
          aria-label="Open menu"
          className="flex h-11 w-11 items-center justify-center rounded-lg text-white hover:bg-white/5"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        <span className="font-display text-sm font-bold uppercase tracking-[0.2em]">{STUDIO.shortName}</span>
        <button
          type="button"
          onClick={openSearch}
          aria-label="Find anything"
          className="ml-auto flex h-11 w-11 items-center justify-center rounded-lg text-white hover:bg-white/5"
        >
          <Search className="h-5 w-5" aria-hidden="true" />
        </button>
      </header>

      {/* Phone drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Admin menu">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/70" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] flex-col border-r border-white/10 bg-[#0a0a0a]">
            <div className="flex h-14 items-center justify-between px-4">
              <span className="font-display text-sm font-bold uppercase tracking-[0.2em]">{STUDIO.shortName}</span>
              <button
                type="button"
                onClick={() => setDrawer(false)}
                aria-label="Close menu"
                className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-white/5"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 pb-4">
              <MenuBody pathname={pathname} counts={counts} areas={areas} onNavigate={() => setDrawer(false)} />
            </div>
            <div className="border-t border-white/10 px-4 py-4">
              <p className="truncate text-xs text-neutral-500">{email}</p>
              <div className="mt-2">
                <LogoutButton />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Page */}
      <div className="lg:pl-64">
        <main id="main" tabIndex={-1} className="min-h-screen pb-24 outline-none lg:pb-0">
          {children}
        </main>
      </div>

      {/* Phone bottom bar */}
      <nav
        aria-label="Main sections"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-white/10 bg-[#0a0a0a]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        {PHONE_TABS.map((id) => {
          const s = ADMIN_SECTIONS.find((x) => x.id === id)!;
          const Icon = ICONS[id];
          const on = current === id;
          const n = id === 'today' ? 0 : sectionCount(id, areas);
          return (
            <Link
              key={id}
              href={s.href}
              aria-current={on ? 'page' : undefined}
              className={`relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] ${on ? 'text-accent-gold' : 'text-neutral-400'}`}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              {s.label}
              {n > 0 && (
                <span className="absolute right-[calc(50%-1.4rem)] top-1.5 h-2 w-2 rounded-full bg-accent-gold" aria-label={`${n} waiting`} />
              )}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setDrawer(true)}
          className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] ${
            PHONE_TABS.includes(current) ? 'text-neutral-400' : 'text-accent-gold'
          }`}
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
          More
        </button>
      </nav>

      {searchOpen && <AdminSearch onClose={() => setSearchOpen(false)} />}
    </div>
  );
}
