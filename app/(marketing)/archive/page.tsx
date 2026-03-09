import Link from 'next/link';
import { getArchivedProductions } from '@/lib/supabase/queries/smartProductions';
import { getArchivedRentals } from '@/lib/supabase/queries/smartRentals';
import ArchiveClient from './ArchiveClient';
import { STUDIO } from '@/lib/constants';

export const metadata = {
  title: `Archive — ${STUDIO.name}`,
  description: 'Browse our archived productions, equipment, and past work.',
};

export default async function ArchivePage() {
  const [productions, rentals] = await Promise.all([
    getArchivedProductions(),
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
      href: `/smart-production/${p.slug}`,
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
      href: `/smart-rentals/${r.category}/${r.slug}`,
      tags: r.tags ?? [],
      created_at: r.created_at,
    })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return <ArchiveClient items={items} />;
}
