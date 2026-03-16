import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { STUDIO } from '@/lib/constants';
import {
  Briefcase,
  Clapperboard,
  ChevronRight,
  Clock,
  FilePen,
  FileEdit,
  Package,
  Pencil,
  ShieldCheck,
  Star,
} from 'lucide-react';

export const metadata: Metadata = { title: 'Studio Control Center' };

// Opt out of static caching — always serve live DB data
export const dynamic = 'force-dynamic';

// ─── Types ────────────────────────────────────────────────────────────────────

type ProductionRow = {
  id: string;
  title: string;
  slug: string;
  is_published: boolean;
  is_featured: boolean;
  thumbnail_url: string | null;
  updated_at: string | null;
};

type RentalRow = {
  id: string;
  title: string;
  slug: string;
  is_published: boolean;
  is_featured: boolean;
  is_available: boolean;
  thumbnail_url: string | null;
  updated_at: string | null;
};

type PressRow = {
  id: string;
  title: string;
  slug: string;
  is_published: boolean;
  is_featured: boolean;
  thumbnail_url: string | null;
  updated_at: string | null;
};

type CareerRow = {
  id: string;
  title: string;
  is_published: boolean;
  updated_at: string | null;
};

type ActivityItem = {
  id: string;
  title: string;
  type: 'Production' | 'Rental' | 'Press';
  updated_at: string | null;
  editHref: string;
};

type DraftRow = {
  id: string;
  title: string;
  thumbnail_url: string | null;
  updated_at: string | null;
};

type FeaturedItem = {
  id: string;
  title: string;
  thumbnail_url: string | null;
  type: 'Production' | 'Rental' | 'Press';
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30)  return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

// ─── Data layer ───────────────────────────────────────────────────────────────

async function fetchAll() {
  const supabase = await createClient();

  // Run all queries in parallel; use allSettled so a missing table doesn't
  // break the whole dashboard — it just returns an empty array.
  const [prodsRes, rentalsRes, pressRes, careersRes, pendingVerificationsRes] = await Promise.allSettled([
    supabase
      .from('smart_productions')
      .select('id,title,slug,is_published,is_featured,thumbnail_url,updated_at')
      .is('deleted_at', null),
    supabase
      .from('smart_rentals')
      .select('id,title,slug,is_published,is_featured,is_available,thumbnail_url,updated_at')
      .is('deleted_at', null),
    supabase
      .from('press')
      .select('id,title,slug,is_published,is_featured,thumbnail_url,updated_at')
      .is('deleted_at', null),
    supabase
      .from('careers')
      .select('id,title,is_published,updated_at')
      .is('deleted_at', null),
    supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('verification_status', 'pending'),
  ]);

  const productions: ProductionRow[] =
    prodsRes.status === 'fulfilled' && !prodsRes.value.error
      ? (prodsRes.value.data as ProductionRow[]) ?? [] : [];

  const rentals: RentalRow[] =
    rentalsRes.status === 'fulfilled' && !rentalsRes.value.error
      ? (rentalsRes.value.data as RentalRow[]) ?? [] : [];

  const press: PressRow[] =
    pressRes.status === 'fulfilled' && !pressRes.value.error
      ? (pressRes.value.data as PressRow[]) ?? [] : [];

  const careers: CareerRow[] =
    careersRes.status === 'fulfilled' && !careersRes.value.error
      ? (careersRes.value.data as CareerRow[]) ?? [] : [];

  const pendingVerifications =
    pendingVerificationsRes.status === 'fulfilled' && !pendingVerificationsRes.value.error
      ? pendingVerificationsRes.value.count ?? 0 : 0;

  return { productions, rentals, press, careers, pendingVerifications };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function AdminDashboardPage() {
  const { productions, rentals, press, careers, pendingVerifications } = await fetchAll();

  // ── KPI stats ─────────────────────────────────────────────────────────────
  const kpi = {
    productions: {
      total:     productions.length,
      published: productions.filter(p => p.is_published).length,
      drafts:    productions.filter(p => !p.is_published).length,
    },
    rentals: {
      total:     rentals.length,
      available: rentals.filter(r => r.is_available).length,
      inactive:  rentals.filter(r => !r.is_available).length,
    },
    press: {
      total:     press.length,
      published: press.filter(p => p.is_published).length,
      drafts:    press.filter(p => !p.is_published).length,
    },
    careers: {
      total:     careers.length,
      published: careers.filter(c => c.is_published).length,
    },
    featured:
      productions.filter(p => p.is_featured).length +
      rentals.filter(r => r.is_featured).length +
      press.filter(p => p.is_featured).length,
    totalDrafts:
      productions.filter(p => !p.is_published).length +
      rentals.filter(r => !r.is_published).length +
      press.filter(p => !p.is_published).length,
  };

  // ── Activity feed — latest 10 across all tables ──────────────────────────
  const activityFeed: ActivityItem[] = [
    ...productions.map(p => ({
      id: p.id, title: p.title, type: 'Production' as const,
      updated_at: p.updated_at, editHref: '/admin/projects',
    })),
    ...rentals.map(r => ({
      id: r.id, title: r.title, type: 'Rental' as const,
      updated_at: r.updated_at, editHref: '/admin/rentals',
    })),
    ...press.map(p => ({
      id: p.id, title: p.title, type: 'Press' as const,
      updated_at: p.updated_at, editHref: '/admin/press',
    })),
  ]
    .filter(a => a.updated_at)
    .sort((a, b) => new Date(b.updated_at!).getTime() - new Date(a.updated_at!).getTime())
    .slice(0, 10);

  // ── Draft groups ─────────────────────────────────────────────────────────
  const draftProductions: DraftRow[] = productions.filter(p => !p.is_published);
  const draftRentals:     DraftRow[] = rentals.filter(r => !r.is_published);
  const draftPress:       DraftRow[] = press.filter(p => !p.is_published);

  // ── Featured items ────────────────────────────────────────────────────────
  const featuredItems: FeaturedItem[] = [
    ...productions.filter(p => p.is_featured).map(p =>
      ({ id: p.id, title: p.title, thumbnail_url: p.thumbnail_url, type: 'Production' as const }),
    ),
    ...rentals.filter(r => r.is_featured).map(r =>
      ({ id: r.id, title: r.title, thumbnail_url: r.thumbnail_url, type: 'Rental' as const }),
    ),
    ...press.filter(p => p.is_featured).map(p =>
      ({ id: p.id, title: p.title, thumbnail_url: p.thumbnail_url, type: 'Press' as const }),
    ),
  ];

  const today = new Date().toLocaleDateString('en-ZA', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
  });

  return (
    <div className="max-w-7xl mx-auto px-3 md:px-6 py-6 md:py-12 space-y-8 md:space-y-12">

      {/* ── Header ── */}
      <div className="border-b border-white/5 pb-8 flex items-end justify-between">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-neutral-600 mb-2">
            {STUDIO.shortName}
          </p>
          <h1 className="text-2xl font-display font-medium uppercase text-white tracking-wide">
            Studio Control Center
          </h1>
        </div>
        <p className="text-[10px] font-mono text-neutral-700 uppercase tracking-widest hidden md:block">
          {today}
        </p>
      </div>

      {/* ── Section 1: KPI Row ── */}
      <section>
        <SectionLabel>Global Stats</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px bg-white/[0.04]">

          <KpiCard
            label="Productions"
            total={kpi.productions.total}
            lines={[
              { label: 'Published', value: kpi.productions.published, color: 'green' },
              { label: 'Drafts',    value: kpi.productions.drafts,    color: 'amber' },
            ]}
            href="/admin/projects"
            icon={<Clapperboard className="w-3.5 h-3.5" />}
          />
          <KpiCard
            label="Rentals"
            total={kpi.rentals.total}
            lines={[
              { label: 'Available', value: kpi.rentals.available, color: 'green'   },
              { label: 'Inactive',  value: kpi.rentals.inactive,  color: 'neutral' },
            ]}
            href="/admin/rentals"
            icon={<Package className="w-3.5 h-3.5" />}
          />
          <KpiCard
            label="Press"
            total={kpi.press.total}
            lines={[
              { label: 'Published', value: kpi.press.published, color: 'green' },
              { label: 'Drafts',    value: kpi.press.drafts,    color: 'amber' },
            ]}
            href="/admin/press"
            icon={<FilePen className="w-3.5 h-3.5" />}
          />
          <KpiCard
            label="Featured"
            total={kpi.featured}
            lines={[]}
            href="#featured"
            icon={<Star className="w-3.5 h-3.5" />}
            accent="amber"
          />
          <KpiCard
            label="Action Required"
            total={kpi.totalDrafts}
            lines={[]}
            href="#drafts"
            icon={<FileEdit className="w-3.5 h-3.5" />}
            accent={kpi.totalDrafts > 0 ? 'red' : 'neutral'}
          />
          <KpiCard
            label="Verifications"
            total={pendingVerifications}
            lines={[]}
            href="/admin/verifications"
            icon={<ShieldCheck className="w-3.5 h-3.5" />}
            accent={pendingVerifications > 0 ? 'amber' : 'neutral'}
          />

        </div>
      </section>

      {/* ── Section 2: Quick Create ── */}
      <section>
        <SectionLabel>Quick Create</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          <QuickCreateBtn href="/admin/projects" label="New Production" icon={<Clapperboard className="w-4 h-4" />} />
          <QuickCreateBtn href="/admin/rentals"  label="New Rental"     icon={<Package      className="w-4 h-4" />} />
          <QuickCreateBtn href="/admin/press"    label="New Press"      icon={<FilePen      className="w-4 h-4" />} />
          <QuickCreateBtn href="/admin/careers"  label="New Career"     icon={<Briefcase    className="w-4 h-4" />} />
        </div>
      </section>

      {/* ── Sections 3 + 4: Activity Feed + Drafts ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* Section 3: Studio Activity Feed */}
        <section className="lg:col-span-7">
          <SectionLabel>Studio Activity</SectionLabel>
          <div className="bg-neutral-900 border border-white/5 divide-y divide-white/[0.04]">
            {activityFeed.length === 0 ? (
              <EmptyRow label="No recent activity." />
            ) : (
              activityFeed.map(item => (
                <div
                  key={`${item.type}-${item.id}`}
                  className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 md:gap-4 px-3 md:px-4 py-3 hover:bg-white/[0.02] transition-colors"
                >
                  <TypeBadge type={item.type} />
                  <p className="text-sm font-mono text-neutral-300 truncate">{item.title}</p>
                  <span className="text-[10px] font-mono text-neutral-700 flex items-center gap-1.5 flex-shrink-0">
                    <Clock className="w-2.5 h-2.5" />
                    {relativeTime(item.updated_at)}
                  </span>
                  <Link
                    href={item.editHref}
                    className="text-[10px] font-mono text-neutral-700 hover:text-white transition-colors flex-shrink-0 flex items-center gap-0.5"
                  >
                    Edit <ChevronRight className="w-2.5 h-2.5" />
                  </Link>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Section 4: Action Required */}
        <section className="lg:col-span-5" id="drafts">
          <SectionLabel>
            Action Required
            {kpi.totalDrafts > 0 && (
              <span className="px-1.5 py-0.5 bg-amber-500/15 text-amber-400 text-[9px] font-mono rounded tabular-nums">
                {kpi.totalDrafts}
              </span>
            )}
          </SectionLabel>

          {kpi.totalDrafts === 0 ? (
            <div className="bg-neutral-900 border border-white/5 flex items-center gap-3 px-4 py-4">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
              <p className="text-[10px] font-mono text-neutral-600 uppercase tracking-widest">
                All content is published.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <DraftGroup label="Productions" items={draftProductions} editHref="/admin/projects" />
              <DraftGroup label="Rentals"     items={draftRentals}     editHref="/admin/rentals"  />
              <DraftGroup label="Press"       items={draftPress}       editHref="/admin/press"    />
            </div>
          )}
        </section>

      </div>

      {/* ── Section 5: Featured Content ── */}
      {featuredItems.length > 0 && (
        <section id="featured">
          <SectionLabel>
            Featured Content
            <span className="text-neutral-700">· {featuredItems.length}</span>
          </SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {featuredItems.map(item => (
              <div
                key={`${item.type}-${item.id}`}
                className="bg-neutral-900 border border-white/5 overflow-hidden group hover:border-white/10 transition-colors"
              >
                <div className="aspect-[3/2] bg-neutral-800 overflow-hidden">
                  {item.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.thumbnail_url}
                      alt={item.title}
                      className="w-full h-full object-cover opacity-70 group-hover:opacity-100 transition-opacity"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Star className="w-4 h-4 text-neutral-700" />
                    </div>
                  )}
                </div>
                <div className="p-2 space-y-1">
                  <TypeBadge type={item.type} small />
                  <p className="text-[10px] font-mono text-neutral-300 truncate leading-tight">
                    {item.title}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Section 6: Studio Overview ── */}
      <section>
        <SectionLabel>Studio Overview</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-px bg-white/[0.04]">
          <OverviewCard
            label="Productions"
            count={kpi.productions.total}
            sub={`${kpi.productions.published} published`}
            icon={<Clapperboard className="w-4 h-4" />}
            href="/admin/projects"
          />
          <OverviewCard
            label="Rentals"
            count={kpi.rentals.total}
            sub={`${kpi.rentals.available} available`}
            icon={<Package className="w-4 h-4" />}
            href="/admin/rentals"
          />
          <OverviewCard
            label="Press"
            count={kpi.press.total}
            sub={`${kpi.press.published} published`}
            icon={<FilePen className="w-4 h-4" />}
            href="/admin/press"
          />
          <OverviewCard
            label="Careers"
            count={kpi.careers.total}
            sub={`${kpi.careers.published} active`}
            icon={<Briefcase className="w-4 h-4" />}
            href="/admin/careers"
          />
        </div>
      </section>

    </div>
  );
}

// ─── UI primitives ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-neutral-600 mb-3 flex items-center gap-2">
      {children}
    </p>
  );
}

function EmptyRow({ label }: { label: string }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-[10px] font-mono text-neutral-700 uppercase tracking-widest">{label}</p>
    </div>
  );
}

type KpiLine = {
  label: string;
  value: number;
  color: 'green' | 'amber' | 'neutral';
};

function KpiCard({
  label,
  total,
  lines,
  href,
  icon,
  accent = 'neutral',
}: {
  label: string;
  total: number;
  lines: KpiLine[];
  href: string;
  icon: React.ReactNode;
  accent?: 'amber' | 'red' | 'neutral';
}) {
  const topBorder =
    accent === 'amber' ? 'border-t-2 border-t-amber-500/30' :
    accent === 'red' && total > 0 ? 'border-t-2 border-t-red-500/30' :
    '';

  const iconColor =
    accent === 'amber' ? 'text-amber-500/60' :
    accent === 'red' && total > 0 ? 'text-red-500/60' :
    'text-neutral-700';

  return (
    <Link href={href} className="block">
      <div className={`bg-neutral-900 px-5 py-5 h-full hover:bg-neutral-800/80 transition-colors group ${topBorder}`}>
        <div className="flex items-start justify-between mb-4">
          <span className={`${iconColor} group-hover:text-neutral-500 transition-colors`}>
            {icon}
          </span>
          <span className="text-3xl font-display font-medium text-white tabular-nums leading-none">
            {total}
          </span>
        </div>
        <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-neutral-600 mb-3">
          {label}
        </p>
        {lines.map(line => (
          <div key={line.label} className="flex items-center justify-between mt-1.5">
            <span className="text-[9px] font-mono text-neutral-700 uppercase tracking-widest">
              {line.label}
            </span>
            <span className={`text-[10px] font-mono tabular-nums ${
              line.color === 'green'  ? 'text-emerald-500' :
              line.color === 'amber'  ? 'text-amber-500/80' :
              'text-neutral-600'
            }`}>
              {line.value}
            </span>
          </div>
        ))}
      </div>
    </Link>
  );
}

function QuickCreateBtn({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <Link href={href} className="block">
      <div className="bg-neutral-900 border border-white/5 hover:border-white/15 hover:bg-neutral-800/80 transition-all p-4 flex items-center gap-3 group">
        <div className="w-8 h-8 bg-white/5 group-hover:bg-white/10 transition-colors flex items-center justify-center flex-shrink-0">
          <span className="text-neutral-500 group-hover:text-white transition-colors">
            {icon}
          </span>
        </div>
        <div className="min-w-0">
          <p className="text-[8px] font-mono uppercase tracking-[0.2em] text-neutral-700">Create</p>
          <p className="text-xs font-mono text-neutral-400 group-hover:text-white transition-colors truncate">
            {label}
          </p>
        </div>
        <ChevronRight className="w-3 h-3 text-neutral-700 group-hover:text-neutral-500 transition-colors ml-auto flex-shrink-0" />
      </div>
    </Link>
  );
}

function TypeBadge({
  type,
  small = false,
}: {
  type: 'Production' | 'Rental' | 'Press';
  small?: boolean;
}) {
  const palette = {
    Production: 'text-blue-400    bg-blue-500/10',
    Rental:     'text-violet-400  bg-violet-500/10',
    Press:      'text-emerald-400 bg-emerald-500/10',
  } as const;

  return (
    <span
      className={`inline-block font-mono uppercase tracking-widest flex-shrink-0 ${palette[type]} ${
        small ? 'text-[8px] px-1 py-0.5' : 'text-[9px] px-1.5 py-0.5'
      }`}
    >
      {type}
    </span>
  );
}

function DraftGroup({
  label,
  items,
  editHref,
}: {
  label: string;
  items: DraftRow[];
  editHref: string;
}) {
  if (items.length === 0) return null;

  const visible  = items.slice(0, 4);
  const overflow = items.length - visible.length;

  return (
    <div className="bg-neutral-900 border border-white/5">
      <div className="px-4 py-2 border-b border-white/[0.04]">
        <p className="text-[9px] font-mono uppercase tracking-widest text-neutral-600">
          {label} <span className="text-neutral-700">· {items.length}</span>
        </p>
      </div>

      {visible.map(item => (
        <div
          key={item.id}
          className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.03] last:border-b-0 hover:bg-white/[0.02] transition-colors"
        >
          <div className="w-8 h-6 bg-neutral-800 flex-shrink-0 overflow-hidden">
            {item.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.thumbnail_url} alt="" className="w-full h-full object-cover opacity-50" />
            ) : (
              <div className="w-full h-full" />
            )}
          </div>
          <p className="flex-1 text-[11px] font-mono text-neutral-400 truncate min-w-0">
            {item.title}
          </p>
          <span className="text-[9px] font-mono text-neutral-700 flex-shrink-0">
            {relativeTime(item.updated_at)}
          </span>
          <Link
            href={editHref}
            title={`Edit in ${label}`}
            className="flex-shrink-0 p-1 text-neutral-700 hover:text-white transition-colors"
          >
            <Pencil className="w-3 h-3" />
          </Link>
        </div>
      ))}

      {overflow > 0 && (
        <div className="px-4 py-2 border-t border-white/[0.04]">
          <Link
            href={editHref}
            className="text-[9px] font-mono text-neutral-700 hover:text-white transition-colors uppercase tracking-widest"
          >
            +{overflow} more →
          </Link>
        </div>
      )}
    </div>
  );
}

function OverviewCard({
  label,
  count,
  sub,
  icon,
  href,
}: {
  label: string;
  count: number;
  sub: string;
  icon: React.ReactNode;
  href: string;
}) {
  return (
    <Link href={href} className="block">
      <div className="bg-neutral-900 px-5 py-5 flex items-center gap-4 hover:bg-neutral-800/80 transition-colors group">
        <span className="text-neutral-700 group-hover:text-neutral-500 transition-colors flex-shrink-0">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-2xl font-display font-medium text-white tabular-nums leading-none mb-1">
            {count}
          </p>
          <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-neutral-600 truncate">
            {label}
          </p>
          <p className="text-[9px] font-mono text-neutral-700 mt-0.5 truncate">
            {sub}
          </p>
        </div>
      </div>
    </Link>
  );
}
