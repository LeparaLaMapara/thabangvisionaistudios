export const revalidate = 60;

import Link from 'next/link';
import { getArchivedProductions } from '@/lib/supabase/queries/smartProductions';
import { getArchivedRentals } from '@/lib/supabase/queries/smartRentals';
import ArchiveClient from './ArchiveClient';
import { getFlag } from '@/lib/features';
import { buildPageMetadata } from '@/lib/seo/metadata';

// Retired gear and past work: useful to browse, not a page to send search
// traffic to (nothing on it can be booked).
export const metadata = buildPageMetadata({
  title: 'Archive',
  description: 'Browse our archived productions, equipment, and past work.',
  path: '/archive',
  noIndex: true,
});

export default async function ArchivePage() {
  const smartProductionsEnabled = await getFlag('smart_productions');
  const [productions, rentals] = await Promise.all([
    smartProductionsEnabled ? getArchivedProductions() : Promise.resolve([]),
    getArchivedRentals(),
  ]);

  const items = [
    ...productions.map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      description: p.description,
      thumbnail_url: p.thumbnail_url,
      category: 'production' as const,
      meta: [p.client, p.year].filter(Boolean).join(' / ') || 'Production',
      href: `/studio/${p.slug}`,
      tags: p.tags ?? [],
      created_at: p.created_at,
    })),
    ...rentals.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      description: r.description,
      thumbnail_url: r.thumbnail_url,
      category: 'rental' as const,
      meta: [r.brand, r.model].filter(Boolean).join(' ') || r.category,
      href: `/rentals/${r.category}/${r.slug}`,
      tags: r.tags ?? [],
      created_at: r.created_at,
    })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return <ArchiveClient items={items} />;
}
