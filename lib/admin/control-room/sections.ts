/**
 * The admin menu: eight sections in plain words, each listing the screens
 * that already exist. One place defines it, so the side menu, the phone menu
 * and the search box always agree.
 *
 * A label says what the person gets done there, not what the table is called.
 */

export type SectionId = 'today' | 'bookings' | 'money' | 'people' | 'gear' | 'content' | 'help' | 'settings';

/** A number shown next to a menu item: how many things wait there. */
export type CountKey =
  | 'idChecks'
  | 'disputes'
  | 'requests'
  | 'returns'
  | 'payouts'
  | 'refunds'
  | 'welcomes'
  | 'bugs'
  | 'pressDrafts'
  | 'listings';

export interface AdminTool {
  label: string;
  href: string;
  /** One short line: what you do on this screen. */
  hint: string;
  countKey?: CountKey;
  /** Extra words the search box should match. */
  keywords?: string;
  /** Other pages that belong to this screen (they win over a plain prefix match). */
  also?: RegExp[];
}

export interface AdminSection {
  id: SectionId;
  label: string;
  hint: string;
  /** Where the section name itself goes. */
  href: string;
  tools: AdminTool[];
}

export const ADMIN_SECTIONS: AdminSection[] = [
  {
    id: 'today',
    label: 'Today',
    hint: 'What needs you, and how the business is doing',
    href: '/admin',
    tools: [],
  },
  {
    id: 'bookings',
    label: 'Bookings',
    hint: 'Gear hire, crew and studio bookings, pickups and deliveries',
    href: '/admin/bookings',
    tools: [
      {
        label: 'Gear hire bookings',
        href: '/admin/bookings',
        hint: 'Every rental: hand over, check returns, mark EFT paid',
        countKey: 'returns',
        keywords: 'rentals equipment handover return eft',
        // The handover and take-back checklists live under /admin/rentals/<booking>/.
        also: [/^\/admin\/rentals\/[^/]+\/(handover|return)\/?$/],
      },
      { label: 'Crew and studio bookings', href: '/admin/service-bookings', hint: 'Photographers, videographers and shoots', keywords: 'service creator shoot studio' },
      { label: 'Booking requests', href: '/admin/creator-requests', hint: 'People asking to book a creator', countKey: 'requests', keywords: 'crew request enquiry quote' },
      { label: 'Pickups and deliveries', href: '/admin/delivery-ops', hint: 'Couriers, collections and drop-offs', keywords: 'delivery courier pickup collection bob go' },
    ],
  },
  {
    id: 'money',
    label: 'Money',
    hint: 'Payouts, refunds, payment problems and costs',
    href: '/admin/rental-ops',
    tools: [
      { label: 'Payouts and refunds', href: '/admin/rental-ops', hint: 'Pay owners, send refunds, fix payment problems', countKey: 'payouts', keywords: 'payout refund ledger payment owner' },
      { label: 'AI helpers and spend', href: '/admin/ai', hint: 'What each AI helper did and what it cost', keywords: 'agents ai cost budget ubunye tokens' },
      { label: 'Sign-up funnel', href: '/admin/funnel', hint: 'Where visitors drop off before booking', keywords: 'analytics conversion growth' },
    ],
  },
  {
    id: 'people',
    label: 'People',
    hint: 'Customers, creators and gear owners',
    href: '/admin/users',
    tools: [
      { label: 'Everyone', href: '/admin/users', hint: 'Find a person, suspend or restore an account', keywords: 'users customers creators accounts suspend' },
      { label: 'ID checks', href: '/admin/verifications', hint: 'Approve or decline identity documents', countKey: 'idChecks', keywords: 'verification identity kyc' },
      { label: 'Role profiles', href: '/admin/roles', hint: 'Check proof from make-up artists, models, drivers and more', keywords: 'roles join proof review makeup model driver crew' },
      { label: 'Welcome messages', href: '/admin/welcomes', hint: 'Check and send welcome notes to new people', countKey: 'welcomes', keywords: 'welcome email onboarding' },
      { label: 'Customer emails', href: '/admin/engagement', hint: 'Welcome, reminders and tips the site sent by itself', keywords: 'lifecycle email nudge reminder push notifications engagement unsubscribe' },
      { label: 'Outreach', href: '/admin/outreach', hint: 'Draft emails to win new business clients', keywords: 'outreach clients marketing email agencies' },
    ],
  },
  {
    id: 'gear',
    label: 'Gear',
    hint: 'Rental gear, photos, prices and listings',
    href: '/admin/rentals',
    tools: [
      { label: 'All gear', href: '/admin/rentals', hint: 'Add gear, upload photos, set prices and deposits', keywords: 'rentals equipment camera lens price photos' },
      { label: 'Gear people listed', href: '/admin/listings', hint: 'Approve gear that owners put up for hire', countKey: 'listings', keywords: 'listing review marketplace owner' },
      { label: 'Import a rate card', href: '/admin/rentals/import', hint: 'Bring in a supplier price list', keywords: 'import ratecard supplier csv' },
    ],
  },
  {
    id: 'content',
    label: 'Content',
    hint: 'Productions, press and news, careers and FAQs',
    href: '/admin/projects',
    tools: [
      { label: 'Productions and portfolio', href: '/admin/projects', hint: 'Upload productions, photos and videos', keywords: 'projects portfolio smart productions upload video' },
      { label: 'Press and news', href: '/admin/press', hint: 'Write and publish stories', countKey: 'pressDrafts', keywords: 'press news article story blog' },
      { label: 'Social posts from stories', href: '/admin/content-repurpose', hint: 'Turn a story into social media posts', keywords: 'repurpose social instagram copy' },
      { label: 'Production types', href: '/admin/production-categories', hint: 'The kinds of shoots people can book', keywords: 'categories services' },
      { label: 'Careers', href: '/admin/careers', hint: 'Job posts', keywords: 'jobs hiring' },
      { label: 'FAQs', href: '/admin/faqs', hint: 'Questions and answers on the site', keywords: 'faq questions help' },
    ],
  },
  {
    id: 'help',
    label: 'Help and safety',
    hint: 'Disputes and problems people reported',
    href: '/admin/disputes',
    tools: [
      { label: 'Disputes', href: '/admin/disputes', hint: 'Damage, no-shows and disagreements', countKey: 'disputes', keywords: 'dispute damage complaint claim' },
      { label: 'Bug reports', href: '/admin/bug-reports', hint: 'Problems people found on the site', countKey: 'bugs', keywords: 'bugs errors issues' },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    hint: 'Switch site features on and off',
    href: '/admin/flags',
    tools: [
      { label: 'Site switches', href: '/admin/flags', hint: 'Turn features on or off', keywords: 'feature flags toggles settings' },
    ],
  },
];

function aliasFor(pathname: string): { section: SectionId; tool: AdminTool } | null {
  for (const s of ADMIN_SECTIONS) {
    for (const t of s.tools) {
      if (t.also?.some((re) => re.test(pathname))) return { section: s.id, tool: t };
    }
  }
  return null;
}

/** The section a page belongs to, for highlighting the menu. */
export function sectionForPath(pathname: string): SectionId {
  if (pathname === '/admin' || pathname === '/admin/') return 'today';
  const alias = aliasFor(pathname);
  if (alias) return alias.section;
  let best: { id: SectionId; len: number } = { id: 'today', len: 0 };
  for (const s of ADMIN_SECTIONS) {
    for (const t of s.tools) {
      if ((pathname === t.href || pathname.startsWith(`${t.href}/`)) && t.href.length > best.len) {
        best = { id: s.id, len: t.href.length };
      }
    }
  }
  return best.id;
}

/** The one tool a page belongs to, if any (the longest matching link). */
export function toolForPath(pathname: string): AdminTool | null {
  const alias = aliasFor(pathname);
  if (alias) return alias.tool;
  let best: AdminTool | null = null;
  for (const s of ADMIN_SECTIONS) {
    for (const t of s.tools) {
      if ((pathname === t.href || pathname.startsWith(`${t.href}/`)) && (!best || t.href.length > best.href.length)) {
        best = t;
      }
    }
  }
  return best;
}
