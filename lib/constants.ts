
// ─── Studio Branding & Configuration ─────────────────────────────────────────
// Single source of truth for ALL studio identity, contact info, and config.


export const STUDIO = {
  name: 'ThabangVision AI Studios',
  shortName: 'ThabangVision',
  tagline: 'We Engineer The Invisible',
  email: 'hello@thabangvision.com', //'thabangvisionstudios@gmail.com',
  careersEmail: 'careers@thabangvision.com',  //'thabangvisionstudios+careers@gmail.com',
  supportEmail: 'support@thabangvision.com',  //'thabasngvisionstudios+support@gmail.com',
  bookingEmail: 'bookings@thabangvision.com',  //'thabangvisionstudios+booking@gmail.com',
  pressEmail: 'press@thabangvision.com',  //'thabangvisionstudios+press@gmail.com',
  privacyEmail: 'privacy@thabangvision.com',  //'thabangvisionstudios+privacy@gmail.com',
  phone: '+27 79 539 9012',

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
    twitter: 'https://x.com/thabangvision',
    youtube: 'https://youtube.com/@thabangvision',
    // linkedin: 'https://linkedin.com/thabangvision',
    // tiktok: 'https://tiktok.com/thabangvision',
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
    url: 'https://thabangvision.com',
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
      email: 'hello@thabangvision.com',
      isPrimary: true,
    },
    {
      name: 'Pretoria Studio',
      address: '',
      city: 'Pretoria',
      province: 'Gauteng',
      phone: '',
      email: 'hello@thabangvision.com',
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
      { id: '01', label: 'About', href: '/about' },
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
    maxCartItems: 10,
    bulkDiscount: [
      { minItems: 1, maxItems: 2, discountPercent: 0 },
      { minItems: 3, maxItems: 4, discountPercent: 10 },
      { minItems: 5, maxItems: 6, discountPercent: 15 },
      { minItems: 7, maxItems: Infinity, discountPercent: 20 },
    ],
  },

  verification: {
    maxFileSizeMB: 5,
    acceptedTypes: ['image/jpeg', 'image/png'],
    maxAttempts: 3,
    reviewDays: 'instant',
  },

  platform: {
    minPasswordLength: 8,
    maxListingImages: 5,
    maxGalleryImages: 20,
    paginationLimit: 12,
  },

  hero: {
    type: 'image' as 'image' | 'video',  // switch to 'video' when ready
    imageSrc: 'https://res.cloudinary.com/dzymetqjr/image/upload/v1773909281/hero_image_erskic.avif',
    videoSrc: '',                          // Cloudinary video URL (desktop)
    mobileVideoSrc: '',                    // Smaller video for mobile (falls back to videoSrc)
    poster: 'https://res.cloudinary.com/dzymetqjr/image/upload/v1773909281/hero_image_erskic.avif',                            // Static image shown while video loads
  },

  creators: {
    commissionRate: 15,
    minRequestLength: 20,
    maxRequestsPerHour: 5,
    statusLabels: {
      pending: 'Under Review',
      contacted: 'In Discussion',
      confirmed: 'Confirmed',
      declined: 'Not Available',
      paid: 'Paid',
      in_progress: 'In Progress',
      completed: 'Completed',
      cancelled: 'Cancelled',
      expired: 'Expired',
    },
    requestExpiryHours: 48,
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


  booking: {
    platformCommission: 15,
    vatRate: 15,
    minBookingHours: 1,
    maxBookingHours: 72,
    cancellationPolicy: 'Free cancellation up to 48 hours before the shoot. After that, the full amount is non-refundable.',
    autoCompleteAfterDays: 30,
    projectCategories: [
      'Wedding Photography',
      'Wedding Cinematography',
      'Portrait Photography',
      'Corporate Photography',
      'Corporate Video',
      'Music Video',
      'Event Coverage',
      'Product Photography',
      'Real Estate Photography',
      'Content Creation',
      'Documentary',
      'Short Film',
      'Other',
    ],
    deliverableTypes: [
      'Edited Photos (Digital)',
      'Printed Photos',
      'Highlight Video',
      'Full-Length Video',
      'Raw Files',
      'Social Media Edits',
      'All of the Above',
    ],
    statusLabels: {
      pending: 'Pending Payment',
      paid: 'Paid',
      accepted: 'Accepted',
      completed: 'Completed',
      paid_out: 'Paid Out',
      cancelled: 'Cancelled',
      disputed: 'Disputed',
    } as Record<string, string>,
  },

  // ─── EXIF → Rental Slug Map ─────────────────────────────────────────────────
  // Maps camera/lens EXIF model strings to smart_rentals slugs.
  // Used on production detail pages to link "Shot With" gear to rental listings.
  gearExifMap: {
    // Camera bodies
    'ILCE-7M3': 'sony-alpha-a7-iii',
    'Sony ILCE-7M3': 'sony-alpha-a7-iii',
    'X-T1': 'fujifilm-x-t1',
    'FUJIFILM X-T1': 'fujifilm-x-t1',
    'Canon EOS 250D': 'canon-250d',
    'HERO9 Black': 'gopro-hero-9-black',
    'NIKON D5300': 'nikon-d5300',
    // Lenses
    'FE 85mm F1.8': 'sony-fe-85mm-f18',
    'FE 50mm F1.8': 'sony-fe-50mm-f18',
    'XF 35mm F2 R WR': 'fujifilm-xf-35mm-f2',
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

export const MAIN_NAVIGATION: {
  label: string;
  href: string;
  children?: { label: string; href: string; children?: { label: string; href: string }[] }[];
}[] = [
  { label: 'Creators', href: '/smart-creators' },
  { label: 'Gear', href: '/smart-rentals' },
  { label: 'Productions', href: '/smart-production' },
  { label: 'Pricing', href: '/pricing' },
];

export const FOOTER_SECTIONS = [
  {
    title: `${STUDIO.shortName} Global`,
    links: [
      { label: 'Locations', href: '/locations' },
      { label: 'About', href: '/about' },
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
      { label: 'Report an Issue', href: '/support/tech' },
      { label: 'Legal / Terms', href: '/legal' },
      { label: 'Privacy Policy', href: '/privacy' },
    ],
  },
];

// ─── PLACEHOLDER IMAGES ─────────────────────────────────────────────────────
export const PLACEHOLDER_IMAGES = {
  hero: 'https://res.cloudinary.com/dzymetqjr/image/upload/v1773909281/hero_image_erskic.avif',
  camerasOptics: 'https://res.cloudinary.com/dzymetqjr/image/upload/v1773356991/camerasOptics_rnce72.png',
  lightingPower: 'https://res.cloudinary.com/dzymetqjr/image/upload/v1773356990/lightingPower_pexxot.png',
  audio: 'https://res.cloudinary.com/dzymetqjr/image/upload/v1773356994/audio_aj6co5.png',
  gripMotion: 'https://res.cloudinary.com/dzymetqjr/image/upload/v1773356994/gripMotion_ucsu5j.png',
  dataStorage: 'https://res.cloudinary.com/dzymetqjr/image/upload/v1773356975/dataStorage_mpqvqo.png',
  crewServices: 'https://res.cloudinary.com/dzymetqjr/image/upload/v1773356985/crewServices_pcvchd.png',
  smartCreators: 'https://res.cloudinary.com/dzymetqjr/image/upload/v1773356985/crewServices_pcvchd.png',
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
    title: 'Smart Creators',
    subtitle: 'Verified Professionals for Hire',
    image: PLACEHOLDER_IMAGES.smartCreators,
    link: '/smart-creators',
  },
  {
    title: 'Smart Rentals',
    subtitle: 'AI-Optimized Gear',
    image: PLACEHOLDER_IMAGES.smartRentals,
    link: '/smart-rentals',
  },
  {
    title: 'Smart Productions',
    subtitle: 'Creative Services Hub',
    image: PLACEHOLDER_IMAGES.smartProductions,
    link: '/smart-production',
  },
];

export const SOCIAL_LINKS = [
  ...(STUDIO.social.youtube ? [{ platform: 'Youtube', href: STUDIO.social.youtube }] : []),
  ...(STUDIO.social.instagram ? [{ platform: 'Instagram', href: STUDIO.social.instagram }] : []),
  ...(STUDIO.social.facebook ? [{ platform: 'Facebook', href: STUDIO.social.facebook }] : []),
  ...(STUDIO.social.twitter ? [{ platform: 'Twitter', href: STUDIO.social.twitter }] : []),
  ...('linkedin' in STUDIO.social ? [{ platform: 'Linkedin', href: (STUDIO.social as Record<string, string>).linkedin }] : []),
  { platform: 'Mail', href: `mailto:${STUDIO.email}` },
];




export const SA_BANKS = [
  { name: 'ABSA', code: '632005' },
  { name: 'African Bank', code: '430000' },
  { name: 'Bidvest Bank', code: '462005' },
  { name: 'Capitec Bank', code: '470010' },
  { name: 'Discovery Bank', code: '679000' },
  { name: 'First National Bank (FNB)', code: '250655' },
  { name: 'Investec', code: '580105' },
  { name: 'Nedbank', code: '198765' },
  { name: 'Standard Bank', code: '051001' },
  { name: 'TymeBank', code: '678910' },
] as const;

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