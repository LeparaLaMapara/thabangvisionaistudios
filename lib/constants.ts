
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
    instagram: 'https://instagram.com/thabangvision',
    twitter: 'https://x.com/thabangvisionlabs',
    youtube: 'https://youtube.com/@thabangvision',
    linkedin: 'https://linkedin.com/thabangvision',
    tiktok: 'https://tiktok.com/thabangvisionlabs',
    // behance: 'https://behance.net/thabangvisionstudios',
    // vimeo: 'https://vimeo.com/thabangvisionstudios',
    facebook: 'https://facebook.com/thabangvision',
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
  },

  verification: {
    maxFileSizeMB: 5,
    acceptedTypes: ['image/jpeg', 'image/png'],
    maxAttempts: 3,
    reviewDays: '1-2 business days',
  },

  platform: {
    minPasswordLength: 8,
    maxListingImages: 5,
    maxGalleryImages: 20,
    paginationLimit: 12,
  },

  crew: {
    commissionRate: 15,
    minRequestLength: 20,
    maxRequestsPerHour: 5,
    statusLabels: {
      pending: 'Under Review',
      contacted: 'In Discussion',
      confirmed: 'Confirmed',
      declined: 'Not Available',
      completed: 'Completed',
      cancelled: 'Cancelled',
    },
    projectTypes: [
      'Photography',
      'Cinematography',
      'Wedding',
      'Corporate',
      'Music Video',
      'Event',
      'Documentary',
      'Content Creation',
      'Other',
    ],
    budgetRanges: [
      'Under R5,000',
      'R5,000 - R15,000',
      'R15,000 - R50,000',
      'R50,000+',
      'Flexible',
    ],
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
      { label: 'Crew & Talent', href: '/crew' },
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
  camerasOptics: 'https://res.cloudinary.com/dzymetqjr/image/upload/v1773356991/camerasOptics_rnce72.png',
  lightingPower: 'https://res.cloudinary.com/dzymetqjr/image/upload/v1773356990/lightingPower_pexxot.png',
  audio: 'https://res.cloudinary.com/dzymetqjr/image/upload/v1773356994/audio_aj6co5.png',
  gripMotion: 'https://res.cloudinary.com/dzymetqjr/image/upload/v1773356994/gripMotion_ucsu5j.png',
  dataStorage: 'https://res.cloudinary.com/dzymetqjr/image/upload/v1773356975/dataStorage_mpqvqo.png',
  crewServices: 'https://res.cloudinary.com/dzymetqjr/image/upload/v1773356985/crewServices_pcvchd.png',
  specializedSolutions: 'https://res.cloudinary.com/dzymetqjr/image/upload/v1773356963/specializedSolutions_gdsa3n.png',
  soundReinforcement: 'https://res.cloudinary.com/dzymetqjr/image/upload/v1773356994/audio_aj6co5.png',
  smartProductions: 'https://res.cloudinary.com/dzymetqjr/image/upload/v1773356173/smart_productions_difzj3.png',
  smartRentals: 'https://res.cloudinary.com/dzymetqjr/image/upload/v1773355515/smart_rentals_zagh26.png',
  ubunyeAi: 'https://res.cloudinary.com/dzymetqjr/image/upload/v1773355508/ubunye_studio_qt4xqk.png',
  communityGear: 'https://res.cloudinary.com/dzymetqjr/image/upload/v1773355512/community_gear_butskk.png',
  creatorDashboard: 'https://res.cloudinary.com/dzymetqjr/image/upload/v1773355513/creator_dashboard_xolw82.png',
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




export const PRODUCTION_SERVICES = {
  photography: {
    portrait: { rate: 1500, unit: "hour", description: "Portrait / Headshot — Studio or on-location, includes lighting setup" },
    commercial: { rate: 1500, unit: "hour", description: "Commercial / Product — Products, branding, look-book, flat-lay" },
    lifestyle: { rate: 1500, unit: "hour", description: "Lifestyle / Editorial — Outdoor narrative sessions, full art direction" },
  },
  cinematography: {
    shortForm: { rate: 2850, unit: "hour", description: "Short-Form Video — TikTok / IG optimized, 4K capture" },
    musicVideo: { rate: 2850, unit: "hour", description: "Music Video Production — Multi-setup shoot, advanced SFX, cinema glass" },
    corporate: { rate: 2850, unit: "hour", description: "Corporate / Industrial Film — 2-camera setup, script assist, voice-over" },
  },
  postProduction: {
    photoRetouch: { rate: 650, unit: "hour", description: "Photo Retouching & Colour Grading — Skin retouch, compositing, tone matching" },
    videoEdit: { rate: 650, unit: "hour", description: "Video Editing & Assembly — Rough cut through final master, audio sync" },
    cinemaGrade: { rate: 650, unit: "hour", description: "Cinema Colour Grade / SFX — DaVinci Resolve grade, motion graphics, VFX" },
  },
  logistics: {
    travelRate: 4.95,
    fuelSurcharge: 550,
  },
  billing: {
    minimumBooking: "1 hour",
    incrementAfter: "30 minutes",
    overtimeMultiplier: 1.5,
    overtimeAfterHours: 8,
    vatRate: 15,
    instalmentThreshold: 15000,
  },
  edge: [
    "Cinema Grade Hardware: All video captured on Sony FX/Canon Cinema systems (4K 10-bit)",
    "Transparent Pricing: Every hour is accounted for — no hidden package markups",
    "Logistics Precision: Travel billed at the official 2026 SARS rate of R4.95/km",
    "Cloud Ecosystem: Secure, 12-month digital hosting of all final assets",
    "Intellectual Property: Full commercial usage licence granted upon final payment",
  ],
};