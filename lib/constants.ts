
// ─── Studio Branding & Configuration ─────────────────────────────────────────
// Single source of truth for ALL studio identity, contact info, and config.

export const STUDIO = {
  name: 'Thabang Vision AI Studios',
  shortName: 'ThabangVision',
  tagline: 'We Engineer The Invisible',
  email: 'thabangvisionstudios@gmail.com',
  careersEmail: 'thabangvisionstudios@gmail.com',
  supportEmail: 'thabangvisionstudios@gmail.com',
  pressEmail: 'thabangvisionstudios@gmail.com',
  privacyEmail: 'thabangvisionstudios@gmail.com',
  phone: '',

  location: {
    city: 'Johannesburg',
    province: 'Gauteng',
    country: 'South Africa',
    lat: -26.2041,
    lng: 28.0473,
    coordsDisplay: 'LAT: 26.2041 S / LONG: 28.0473 E',
  },

  social: {
    instagram: '',
    twitter: '',
    youtube: '',
    linkedin: '',
    tiktok: '',
    behance: '',
    vimeo: '',
    facebook: '',
  },

  legal: {
    companyName: 'Ubunye AI Ecosystems (Pty) Ltd',
    tradingAs: 'Thabang Vision AI Studios',
    registrationNumber: '',
  },

  meta: {
    url: 'https://thabangvisionstudios.com',
    title: 'Thabang Vision AI Studios',
    description:
      'Premium creative production and equipment rental platform for South African filmmakers and photographers.',
    ogImage: '/og-image.jpg',
  },

  currency: {
    code: 'ZAR',
    symbol: 'R',
    locale: 'en-ZA',
  },

  hours: {
    weekday: 'Mon–Fri: 08:00 – 18:00',
    weekend: 'Sat: 09:00 – 14:00',
    sunday: 'Sun: Closed',
  },

  locations: [
    {
      name: 'Johannesburg Studio',
      address: '',
      city: 'Johannesburg',
      province: 'Gauteng',
      phone: '',
      email: 'thabangvisionstudios@gmail.com',
      isPrimary: true,
    },
    {
      name: 'Cape Town Studio',
      address: '',
      city: 'Cape Town',
      province: 'Western Cape',
      phone: '',
      email: 'thabangvisionstudios@gmail.com',
      isPrimary: false,
    },
  ],

  partnerships: {
    international: [
      { city: 'Los Angeles', status: 'planned' as const },
      { city: 'London', status: 'planned' as const },
      { city: 'Dubai', status: 'planned' as const },
    ],
  },

  nav: {
    sections: [
      { id: '01', label: 'The Lab', href: '/lab' },
      { id: '02', label: 'Capabilities', href: '/ubunye-ai-studio' },
      { id: '03', label: 'Smart Productions', href: '/smart-production' },
      { id: '04', label: 'Smart Rentals', href: '/smart-rentals' },
      { id: '05', label: 'Press', href: '/press' },
      { id: '06', label: 'Careers', href: '/careers' },
    ],
  },

  rental: {
    depositPercent: 20,
    maxBookingDays: 30,
    cancellationHours: 24,
  },

  verification: {
    maxFileSizeMB: 5,
    acceptedTypes: ['image/jpeg', 'image/png', 'application/pdf'],
    reviewDays: '1-2 business days',
  },

  platform: {
    minPasswordLength: 8,
    maxListingImages: 5,
    maxGalleryImages: 20,
    paginationLimit: 12,
  },
} as const;

// ─── Derived constants (backward-compatible exports) ─────────────────────────

export const SITE_NAME = STUDIO.shortName.toUpperCase();
export const SITE_SUFFIX = '.LAB';
export const SITE_TAGLINE = 'Technology Creative Studio';
export const SITE_COPYRIGHT = `© ${new Date().getFullYear()} ${SITE_NAME}. ALL RIGHTS RESERVED.`;

// CONFIGURATION FLAGS
export const SHOW_CAREERS = true;

export const MAIN_NAVIGATION = [
  {
    label: 'The Lab',
    href: '/lab',
    children: [
      { label: 'About', href: '/lab' },
      { label: 'Our Team', href: '/careers' },
    ],
  },
  {
    label: 'Capabilities',
    href: '/smart-production',
    children: [
      { label: 'Smart Productions', href: '/smart-production' },
      { label: 'Smart Rentals', href: '/smart-rentals' },
      {
        label: 'Ubunye AI Studio',
        href: '/ubunye-ai-studio',
        children: [
          { label: 'Virtual Production', href: '/ubunye-ai-studio#vp' },
          { label: 'Remote Systems', href: '/ubunye-ai-studio#remote' },
          { label: 'Lighting Science', href: '/ubunye-ai-studio#lighting' },
          { label: 'Data & Workflow', href: '/ubunye-ai-studio#data' },
          { label: 'Creative AI Labs', href: '/ubunye-ai-studio#labs' },
        ],
      },
    ],
  },
  {
    label: 'Tools',
    href: '/resources/tools',
    children: [
      { label: 'Optics Calculators', href: '/resources/tools' },
      { label: 'Production Planners', href: '/resources/tools' },
      { label: 'Lens Comparison', href: '/resources/tools' },
    ],
  },
  {
    label: 'Pricing',
    href: '/pricing',
  },
  {
    label: 'Contact',
    href: '/contact',
  },
];

export const FOOTER_SECTIONS = [
  {
    title: `${STUDIO.shortName} Global`,
    links: [
      { label: 'Locations', href: '/locations' },
      { label: 'The Lab', href: '/lab' },
      ...(SHOW_CAREERS ? [{ label: 'Careers', href: '/careers' }] : []),
      { label: 'Press & News', href: '/press' },
    ],
  },
  {
    title: 'Account',
    links: [
      { label: 'Sign In', href: '/login' },
      { label: 'Create Account', href: '/register' },
      { label: 'Dashboard', href: '/dashboard' },
    ],
  },
  {
    title: 'Support',
    links: [
      { label: 'Contact', href: '/contact' },
      { label: 'Technical Support', href: '/support/tech' },
      { label: 'Legal / Terms', href: '/legal' },
      { label: 'Privacy Policy', href: '/privacy' },
    ],
  },
];

export const SOCIAL_LINKS = [
  ...(STUDIO.social.youtube ? [{ platform: 'Youtube', href: STUDIO.social.youtube }] : []),
  ...(STUDIO.social.instagram ? [{ platform: 'Instagram', href: STUDIO.social.instagram }] : []),
  ...(STUDIO.social.facebook ? [{ platform: 'Facebook', href: STUDIO.social.facebook }] : []),
  ...(STUDIO.social.twitter ? [{ platform: 'Twitter', href: STUDIO.social.twitter }] : []),
  ...(STUDIO.social.linkedin ? [{ platform: 'Linkedin', href: STUDIO.social.linkedin }] : []),
  { platform: 'Mail', href: `mailto:${STUDIO.email}` },
];
