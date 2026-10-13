import { emptyCatalog, type Catalog, type CatalogRental } from '@/lib/discovery/types';

/** A small, made-up public catalogue for the discovery tests. */

function rental(over: Partial<CatalogRental> & { slug: string; category: string; title: string }): CatalogRental {
  return {
    id: `00000000-0000-4000-8000-${over.slug.padStart(12, '0').slice(-12)}`,
    categoryLabel: over.category === 'cameras-optics' ? 'Cameras & Optics' : 'Audio',
    brand: null,
    model: null,
    description: null,
    pricePerDay: 500,
    pricePerWeek: null,
    deposit: 2000,
    image: null,
    isAvailable: true,
    quantity: 1,
    ownerType: 'studio',
    ownerId: null,
    rankingScore: 0,
    includes: [],
    updatedAt: '2026-10-10T10:00:00.000Z',
    path: `/rentals/${over.category}/${over.slug}`,
    ...over,
  };
}

export function fixtureCatalog(): Catalog {
  return {
    ...emptyCatalog(),
    generatedAt: '2026-10-13T08:00:00.000Z',
    studioOn: true,
    rentals: [
      rental({ slug: 'sony-fx3', category: 'cameras-optics', title: 'Sony FX3', brand: 'Sony', model: 'FX3', pricePerDay: 950, deposit: 5000, rankingScore: 9, description: 'Full frame cinema camera.', includes: ['Two batteries'], updatedAt: '2026-10-13T06:00:00.000Z' }),
      rental({ slug: 'canon-r6', category: 'cameras-optics', title: 'Canon EOS R6', brand: 'Canon', pricePerDay: 700, rankingScore: 5, isAvailable: false }),
      rental({ slug: 'rode-ntg', category: 'audio', title: 'Rode NTG shotgun mic', brand: 'Rode', pricePerDay: 150, rankingScore: 3, ownerType: 'community', ownerId: '00000000-0000-4000-8000-0000000000aa', updatedAt: '2026-09-01T10:00:00.000Z' }),
    ],
    creators: [
      {
        id: '00000000-0000-4000-8000-000000000001',
        handle: 'thandi',
        name: 'Thandi M',
        category: 'photography',
        specializations: ['Photography', 'Portrait'],
        location: 'Braamfontein, Johannesburg',
        bio: 'Portraits and events.',
        hourlyRate: 600,
        yearsExperience: 4,
        avatar: null,
        citySlugs: ['johannesburg'],
        path: '/studio/category/photography/thandi',
      },
    ],
    members: [{ id: '00000000-0000-4000-8000-0000000000aa', updatedAt: '2026-09-01T10:00:00.000Z', path: '/creators/00000000-0000-4000-8000-0000000000aa' }],
    studioCategories: [
      { slug: 'photography', name: 'Photography', description: 'Photo sessions.', creatorKeywords: ['Photography', 'Portrait'], updatedAt: null, path: '/studio/category/photography' },
      { slug: 'video-production', name: 'Video Production', description: 'Video.', creatorKeywords: ['Videography'], updatedAt: null, path: '/studio/category/video-production' },
    ],
    productions: [{ slug: 'headshots', title: 'Headshots', projectType: 'photography', description: 'Studio headshots.', price: 1500, priceUnit: 'session', updatedAt: '2026-10-12T10:00:00.000Z', path: '/studio/headshots' }],
    press: [{ slug: 'launch', title: 'We launched', excerpt: 'Short.', content: 'Long **markdown** body.', author: 'Team', publishedAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', path: '/press/launch' }],
    listings: [],
    tools: [
      {
        slug: 'light',
        name: 'Ubunye Light',
        category: 'RAW Photo Editor',
        tagline: 'Develop RAW files.',
        capabilities: ['RAW development'],
        repoUrl: 'https://github.com/example/light',
        webUrl: 'https://light.example.test',
        licence: 'MIT OR Apache-2.0',
        version: '0.1.0',
        published: '2026-10-05T00:00:00.000Z',
        files: [
          { name: 'ubunye-light-0.1.0-windows-x64.msi', url: 'https://downloads.thabangvision.com/light/ubunye-light-0.1.0-windows-x64.msi', size: 1, sha256: 'abc' },
        ],
        path: '/tools/light',
      },
    ],
    faqs: [{ question: 'Do you open on Sundays?', answer: 'By appointment.', category: 'general' }],
  };
}
