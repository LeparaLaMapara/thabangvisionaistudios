
// ─── Studio Branding & Configuration ─────────────────────────────────────────
// Single source of truth for ALL studio identity, contact info, and config.


export const STUDIO = {
  name: 'ThabangVision AI Studios',
  shortName: 'ThabangVision',
  tagline: 'We Engineer The Invisible',
  email: 'thabangvisionstudios@gmail.com',
  careersEmail: 'thabangvisionstudios+careers@gmail.com',
  supportEmail: 'thabangvisionstudios+support@gmail.com',
  bookingEmail: 'thabangvisionstudios+booking@gmail.com',
  pressEmail: 'thabangvisionstudios+press@gmail.com',
  privacyEmail: 'thabangvisionstudios+privacy@gmail.com',
  phone: '079 539 9012',

  location: {
    city: 'Johannesburg',
    province: 'Gauteng',
    country: 'South Africa',
    lat: -26.2041,
    lng: 28.0473,
    coordsDisplay: 'LAT: 26.2041 S / LONG: 28.0473 E',
  },

  social: {
    instagram: 'https://instagram.com/thabangvisionlabs',
    twitter: 'https://x.com/thabangvisionlabs',
    youtube: 'https://youtube.com/@thabangvisionlabs',
    linkedin: 'https://linkedin.com/thabangvisionlabs',
    tiktok: 'https://tiktok.com/thabangvisionlabs',
    // behance: 'https://behance.net/thabangvisionstudios',
    // vimeo: 'https://vimeo.com/thabangvisionstudios',
    facebook: 'https://facebook.com/thabangvisionlabs',
  },

  legal: {
    companyName: 'Ubunye AI Ecosystems (Pty) Ltd',
    tradingAs: 'Thabang Vision AI Studios',
    registrationNumber: '',
  },

  meta: {
    url: 'https://thabangvisionstudios.com',
    title: 'ThabangVision AI Studios',
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
    multiDayDiscount: '7+ days = weekly rate applies',
  },

  services: {
    photography: {
      portrait: { rate: 1500, unit: 'hour' as const, description: 'Portrait / Headshot — Studio or on-location, includes lighting setup' },
      commercial: { rate: 1500, unit: 'hour' as const, description: 'Commercial / Product — Products, branding, look-book, flat-lay' },
      lifestyle: { rate: 1500, unit: 'hour' as const, description: 'Lifestyle / Editorial — Outdoor narrative sessions, full art direction' },
    },
    cinematography: {
      shortForm: { rate: 2850, unit: 'hour' as const, description: 'Short-Form Video — TikTok / IG optimized, 4K capture' },
      musicVideo: { rate: 2850, unit: 'hour' as const, description: 'Music Video Production — Multi-setup shoot, advanced SFX, cinema glass' },
      corporate: { rate: 2850, unit: 'hour' as const, description: 'Corporate / Industrial Film — 2-camera setup, script assist, voice-over' },
    },
    postProduction: {
      photoRetouch: { rate: 650, unit: 'hour' as const, description: 'Photo Retouching & Colour Grading — Skin retouch, compositing, tone matching' },
      videoEdit: { rate: 650, unit: 'hour' as const, description: 'Video Editing & Assembly — Rough cut through final master, audio sync' },
      cinemaGrade: { rate: 650, unit: 'hour' as const, description: 'Cinema Colour Grade / SFX — DaVinci Resolve grade, motion graphics, VFX' },
    },
    logistics: {
      travelRate: 4.95,
      fuelSurcharge: 550,
    },
    billing: {
      minimumBooking: '1 hour',
      incrementAfter: '30 minutes',
      overtimeMultiplier: 1.5,
      overtimeAfterHours: 8,
      vatRate: 15,
      instalmentThreshold: 15000,
    },
    edge: [
      'Cinema Grade Hardware: All video captured on Sony FX/Canon Cinema systems (4K 10-bit)',
      'Transparent Pricing: Every hour is accounted for — no hidden package markups',
      'Logistics Precision: Travel billed at the official 2026 SARS rate of R4.95/km',
      'Cloud Ecosystem: Secure, 12-month digital hosting of all final assets',
      'Intellectual Property: Full commercial usage licence granted upon final payment',
    ],
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

// ─── Admin Access Control ────────────────────────────────────────────────────
// Emails that have admin access. Add new admins here.
export const ADMIN_EMAILS: readonly string[] = [
  'thabangvisionstudios@gmail.com',
];

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
      { label: 'Our Team', href: '/lab#team' },
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
    label: 'Pricing',
    href: '/pricing',
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

// ─── PLACEHOLDER IMAGES ─────────────────────────────────────────────────────
export const PLACEHOLDER_IMAGES = {
  hero: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=2940&auto=format&fit=crop',
  camerasOptics: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?q=80&w=2800&auto=format&fit=crop',
  lightingPower: 'https://images.unsplash.com/photo-1524253482453-3fed8d2fe12b?q=80&w=2800&auto=format&fit=crop',
  audio: 'https://images.unsplash.com/photo-1590845947698-8924d7409b56?q=80&w=2800&auto=format&fit=crop',
  gripMotion: 'https://images.unsplash.com/photo-1601506521793-dc748fc80b67?q=80&w=2800&auto=format&fit=crop',
  dataStorage: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?q=80&w=2800&auto=format&fit=crop',
  crewServices: 'https://images.unsplash.com/photo-1605379399642-870262d3d051?q=80&w=2900&auto=format&fit=crop',
  specializedSolutions: 'https://images.unsplash.com/photo-1617581629397-a72507c3de9e?q=80&w=2800&auto=format&fit=crop',
  smartProductions: 'https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?q=80&w=2900&auto=format&fit=crop',
  smartRentals: 'https://images.unsplash.com/photo-1550948537-130a1ce83314?q=80&w=2900&auto=format&fit=crop',
  ubunyeAi: 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?q=80&w=2900&auto=format&fit=crop',
  communityGear: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?q=80&w=2900&auto=format&fit=crop',
  creatorDashboard: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?q=80&w=2900&auto=format&fit=crop',
} as const;

// ─── CAPABILITIES (used on home page ServiceGrid) ───────────────────────────
export const CAPABILITIES = [
  {
    title: 'Smart Productions',
    subtitle: 'Creative Services Hub',
    image: PLACEHOLDER_IMAGES.smartProductions,
    link: '/smart-production',
  },
  {
    title: 'Smart Rentals',
    subtitle: 'AI-Optimized Gear',
    image: PLACEHOLDER_IMAGES.smartRentals,
    link: '/smart-rentals',
  },
  {
    title: 'Ubunye AI Studio',
    subtitle: 'AI Tools, Automation & Creative Intelligence',
    image: PLACEHOLDER_IMAGES.ubunyeAi,
    link: '/ubunye-ai-studio',
  },
  {
    title: 'Community Gear',
    subtitle: 'Rent from Verified Creators',
    image: PLACEHOLDER_IMAGES.communityGear,
    link: '/smart-rentals',
  },
  {
    title: 'Creator Dashboard',
    subtitle: 'Manage Your Studio',
    image: PLACEHOLDER_IMAGES.creatorDashboard,
    link: '/dashboard',
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
