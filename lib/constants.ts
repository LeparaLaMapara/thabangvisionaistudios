
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
    linkedin: 'https://linkedin.com/company/thabangvision',
    // tiktok: 'https://tiktok.com/thabangvision',
    // behance: 'https://behance.net/thabangvisionstudios',
    // vimeo: 'https://vimeo.com/thabangvisionstudios',
    facebook: 'https://facebook.com/thabangvision',
  },

  legal: {
    // Exactly as it appears on the CIPC COR 14.3 registration certificate
    // issued 19/09/2025. Do not restyle it — payment providers match this
    // string character-for-character against the certificate.
    companyName: 'THABANGVISION STUDIO (Pty) Ltd',
    tradingAs: 'Thabang Vision AI Studios',
    registrationNumber: '2025/742948/07',
    // Registered business address. MUST match the address on the Paystack dashboard.
    // Rendered in the footer and Terms of Service only when non-empty.
    registeredAddress: '9873 Extension 5, Soshanguve South, Gauteng, 0152, South Africa',
    // Whether the company is a registered VAT vendor. This — not vatNumber —
    // is what drives VAT wording and the VAT line at checkout.
    vatRegistered: true,
    // The VAT number itself. Optional: a vendor must show it on a tax invoice,
    // but is not obliged to publish it on the website. Rendered only if set.
    vatNumber: '',
    // POPIA requires a designated Information Officer, registered with the
    // Information Regulator. Rendered on /privacy only once the name is filled.
    informationOfficer: {
      name: '',
      email: 'privacy@thabangvision.com',
    },
    // The statutory complaints authority for POPIA. Do not point users at a
    // generic "your local data protection authority".
    informationRegulator: {
      name: 'Information Regulator (South Africa)',
      complaintsEmail: 'POPIAComplaints@inforegulator.org.za',
      generalEmail: 'inforeg@inforegulator.org.za',
      address: 'JD House, 27 Stiemens Street, Braamfontein, Johannesburg, 2001',
      website: 'https://inforegulator.org.za',
    },
    popia: {
      version: '2026.04.20',
      retentionDays: 30, // Delete verification storage objects 30 days after review
    },
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
      { id: '03', label: 'Studio', href: '/studio' },
      { id: '04', label: 'Rentals', href: '/rentals' },
      { id: '05', label: 'Press', href: '/press' },
      { id: '06', label: 'Careers', href: '/careers' },
    ],
  },

  rental: {
    depositPercent: 50,
    maxBookingDays: 30,
    maxDirectBookingDays: 365,
    // Final tier boundary below. Kept as its own value because tests and the
    // Ubunye system prompt read it directly.
    // How long an unpaid checkout holds stock before the dates are released.
    // A hold is taken at checkout, before payment, so without an expiry an
    // abandoned payment page removes those dates from sale permanently --
    // which had already cost five date ranges in production, one unsellable
    // for 161 days. Long enough that nobody actively paying loses a booking,
    // short enough that a Saturday abandonment does not cost Sunday's rental.
    pendingHoldMinutes: 30,
    /**
     * Notice a hire needs before it starts, in HOURS not days.
     *
     * Gear could previously be booked for tomorrow, or today. Stock has to be
     * checked, charged and put aside first.
     *
     * Hours rather than calendar days on purpose: bookings are date-granular,
     * so "two days" would accept a Sunday-morning hire booked Friday afternoon,
     * which is about 44. Measured against the START of the booking day, so the
     * customer always gets at least this much. See lib/rental/leadTime.ts.
     */
    minLeadTimeHours: 48,
    cancellationHours: 24,
    // Tiered cancellation scale for equipment hire, applied automatically by
    // app/api/bookings/[id]/route.ts. refundPercent applies to the HIRE charge
    // only — the security deposit is always refunded in full on cancellation,
    // because the equipment never left our premises.
    // Ordered most-notice-first; the first matching tier wins.
    cancellationTiers: [
      { minHoursBefore: 48, refundPercent: 100 },
      { minHoursBefore: 24, refundPercent: 50 },
      { minHoursBefore: 0, refundPercent: 0 },
    ],
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

  // ── Fulfilment: collection or delivery ───────────────────────────────────
  // How the customer gets the gear, chosen at checkout.
  //
  // Delivery is priced from the distance to the address plus the size of the
  // order, and the exact fee is shown before payment. We deliver in our own
  // vehicle, so this is a running cost, not a courier rate. There is no
  // courier and therefore no tracking number.
  fulfilment: {
    // Where equipment physically leaves from, and what delivery distances are
    // measured against. Deliberately separate from STUDIO.location, which is
    // the city we present as our base, and from legal.registeredAddress, which
    // is the CIPC address and is not an operating site.
    //
    // University of the Witwatersrand, Braamfontein, Johannesburg.
    dispatchFrom: {
      name: 'Braamfontein',
      lat: -26.1929,
      lng: 28.0305,
    },
    collection: {
      enabled: true,
      // A collection can be paid in full online, or the security deposit can
      // be paid online to hold the gear with the hire charge settled at the
      // counter. We never hold stock with nothing paid.
      allowBalanceOnCollection: true,
    },
    delivery: {
      enabled: true,
      // Rate per kilometre of one-way road distance. Derived so it can be
      // re-checked when fuel moves:
      //   petrol ~R22/l, a loaded bakkie ~10 l/100km  ->  R2.20/km of fuel
      //   we drive there and back                     ->  R4.40/km
      //   driver time, vehicle wear, insurance, admin ->  R11/km
      // Multiply only the ONE-WAY distance; the return leg is already in here.
      ratePerKm: 11,
      // Straight-line distance underestimates the drive. Roughly 1.3x is the
      // usual correction for Gauteng.
      roadDistanceFactor: 1.3,
      // Short local runs still cost a person an hour.
      minimumFee: 150,
      // Bigger loads need a bigger vehicle and more handling.
      itemsIncluded: 3,
      surchargePerExtraItem: 25,
      // Past this we stop calculating and quote by hand. 100km reaches the
      // whole of Gauteng from Braamfontein, including Tshwane North and
      // Soshanguve at roughly 96km by road. Below 100 those fall outside,
      // which would be odd for a Johannesburg-Pretoria operation.
      maxRadiusKm: 100,
    },
  },

  // ── Subscriptions ────────────────────────────────────────────────────────
  // Paid plans (Pro / Studio) are OFF while the offer is reworked. The tiered
  // commission that justified them was never implemented, so the plans were
  // advertising a discount that no code applied.
  //
  // Everything behind this stays intact: subscription_plans table,
  // /api/subscriptions/*, and createSubscriptionCheckout on both payment
  // providers. Flip this to true to put the plans back on sale.
  subscriptions: {
    enabled: false,
  },

  platform: {
    minPasswordLength: 8,
    maxListingImages: 5,
    maxGalleryImages: 20,
    paginationLimit: 12,
  },

  hero: {
    type: 'video',  // 'video' | 'image'
    colorMode: 'color' as 'bw' | 'color',  // 'bw' = black & white (grayscale) | 'color' = full color
    imageSrc: 'https://res.cloudinary.com/dzymetqjr/image/upload/v1773909281/hero_image_erskic.avif',
    videoSrc: 'https://res.cloudinary.com/dzymetqjr/video/upload/q_auto/f_auto/v1775368307/hero_htn3xp.mp4',                          // Cloudinary video URL (desktop)
    mobileVideoSrc: 'https://res.cloudinary.com/dzymetqjr/video/upload/q_auto/f_auto/v1775368307/hero_htn3xp.mp4',                    // Smaller video for mobile (falls back to videoSrc)
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
    portfolio: {
      maxProjects: 3,
      maxPhotosPerProject: 3,
      maxPhotoSizeMB: 10,
      maxVideoSizeMB: 50,
      maxVideoDurationSeconds: 30,
      acceptedImageTypes: ['image/jpeg', 'image/png'],
      acceptedVideoTypes: ['video/mp4'],
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

  session: {
    idleTimeoutMinutes: 30, // Auto-logout after 30 minutes of inactivity
  },

  ai: {
    budget: {
      monthlyBudgetZAR: 500,         // R500/month AI spend cap
      alertThresholds: [80, 100],     // Alert at 80% and 100%
    },
    // Cost per 1M tokens in ZAR (approximate, using ~R18/USD exchange rate)
    pricing: {
      'claude-sonnet-5': { input: 54, output: 216 },   // $3/$12 per 1M
      'gpt-4o': { input: 45, output: 270 },   // $2.50/$15 per 1M
      'gemini-3.6-flash': { input: 1.35, output: 5.4 }, // $0.075/$0.30 per 1M
    } as Record<string, { input: number; output: number }>,
  },

  booking: {
    platformCommission: 15,
    vatRate: 15,
    minBookingHours: 1,
    maxBookingHours: 72,
    cancellationPolicy: 'Cancel more than 48 hours before the shoot for a full refund. Between 24 and 48 hours, 50% is refunded. Inside 24 hours the booking is non-refundable, because crew and equipment are already committed.',
    // Applied automatically by app/api/service-bookings/[id]/status when a
    // client cancels, measured against bookings.shoot_date. Same shape as
    // STUDIO.rental.cancellationTiers; ordered most-notice-first.
    cancellationTiers: [
      { minHoursBefore: 48, refundPercent: 100 },
      { minHoursBefore: 24, refundPercent: 50 },
      { minHoursBefore: 0, refundPercent: 0 },
    ],
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
    { label: 'Rentals', href: '/rentals' },
    { label: 'Studio', href: '/studio' },
  ];

export const FOOTER_SECTIONS = [
  {
    title: `${STUDIO.shortName} Global`,
    links: [
      { label: 'Locations', href: '/locations' },
      { label: 'About', href: '/about' },
      ...(SHOW_CAREERS ? [{ label: 'Careers', href: '/careers' }] : []),
      { label: 'Press & News', href: '/press' },
      { label: 'Pricing', href: '/pricing' },
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
      { label: 'Report a Bug', href: '/support/report-bug' },
      { label: 'Legal / Terms', href: '/legal' },
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Refunds & Returns', href: '/refunds' },
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

// ─── RENTAL CATEGORIES ─────────────────────────────────────────────────────
export const RENTAL_CATEGORIES = [
  {
    value: 'cameras-optics',
    label: 'Cameras & Optics',
    subtitle: 'High-end Cinema Systems',
    description: 'Cinema cameras, prime and zoom lens sets, and anamorphics for every format.',
    fallbackImage: PLACEHOLDER_IMAGES.camerasOptics,
  },
  {
    value: 'lighting-power',
    label: 'Lighting & Power',
    subtitle: 'Fixtures & Distribution',
    description: 'LED panels, HMIs, generators, power distribution, and battery solutions.',
    fallbackImage: PLACEHOLDER_IMAGES.lightingPower,
  },
  {
    value: 'audio',
    label: 'Audio',
    subtitle: 'Capture & Monitoring',
    description: 'Microphones, field recorders, mixers, wireless systems, and IEM monitoring.',
    fallbackImage: PLACEHOLDER_IMAGES.audio,
  },
  {
    value: 'grip-motion',
    label: 'Grip & Motion',
    subtitle: 'Support & Stabilization',
    description: 'Dollies, cranes, gimbals, sliders, and remote heads.',
    fallbackImage: PLACEHOLDER_IMAGES.gripMotion,
  },
  {
    value: 'data-storage',
    label: 'Data & Storage',
    subtitle: 'Media Management',
    description: 'RAID arrays, NVMe drives, on-set DITs, and cloud backup solutions.',
    fallbackImage: PLACEHOLDER_IMAGES.dataStorage,
  },
  {
    value: 'specialized-solutions',
    label: 'Specialized Solutions',
    subtitle: 'Emerging Tech & VP',
    description: 'LED volumes, virtual production tools, VR/AR rigs, and drone packages.',
    fallbackImage: PLACEHOLDER_IMAGES.specializedSolutions,
  },
  {
    value: 'aerial-support',
    label: 'Aerial Support',
    subtitle: 'Drone & Aerial Systems',
    description: 'Professional drone rigs, aerial camera systems, and licensed pilot services.',
    fallbackImage: PLACEHOLDER_IMAGES.gripMotion,
  },
  {
    value: 'sound-reinforcement',
    label: 'Sound Reinforcement',
    subtitle: 'Live Sound & PA Systems',
    description: 'PA systems, stage monitors, mixing consoles, and live sound engineering packages.',
    fallbackImage: PLACEHOLDER_IMAGES.soundReinforcement,
  },
] as const;

// ─── RENTAL POLICIES ─────────────────────────────────────────────────────────
// These are the values the RETURN pipeline actually enforces
// (app/api/rentals/[id]/return/route.ts). The legal pages read from here, so
// the published terms and the charged amounts cannot drift apart.
//
// Note: the security deposit is NOT a percentage of the hire. It is a fixed
// rand amount per listing (smart_rentals.deposit_amount). STUDIO.rental
// .depositPercent is used only to seed suggested deposits at AI onboarding.
export const RENTAL_POLICIES = {
  lateFeePerDayZar: 150,
  maxLateDays: 14,
  // Loss of earnings recovered when gear is lost, stolen or out of service for
  // repair. Charged as a contractual debt by invoice — there is no automatic
  // deduction path beyond the deposit.
  lossOfEarnings: {
    percentOfHireValue: 35,
    minimumWeeks: 10,
  },
  supportEmail: STUDIO.supportEmail,
} as const;

export const RENTAL_CATEGORY_VALUES = RENTAL_CATEGORIES.map(c => c.value);
export type RentalCategorySlug = (typeof RENTAL_CATEGORIES)[number]['value'];

export const LISTING_TO_RENTAL_CATEGORY: Record<string, RentalCategorySlug> = {
  cameras: 'cameras-optics',
  lenses: 'cameras-optics',
  lighting: 'lighting-power',
  audio: 'audio',
  grip: 'grip-motion',
  accessories: 'specialized-solutions',
  drones: 'aerial-support',
  other: 'specialized-solutions',
};

// ─── CAPABILITIES (used on home page ServiceGrid) ───────────────────────────
export const CAPABILITIES = [
  {
    title: 'Rentals',
    subtitle: 'Professional Gear',
    image: PLACEHOLDER_IMAGES.smartRentals,
    link: '/rentals',
  },
  {
    title: 'Studio',
    subtitle: 'Book Professionals For Your Next Project',
    image: PLACEHOLDER_IMAGES.smartProductions,
    link: '/studio',
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

// ─── Production Categories ───────────────────────────────────────────────────
// The 6 service types ThabangVision offers. Drives the category grid on /studio.
// Each slug maps to smart_productions.project_type for filtering.

import type { ProductionCategory, ProductionPackage } from '@/types/production';

export const PRODUCTION_CATEGORIES: ProductionCategory[] = [
  {
    slug: 'photography',
    name: 'Photography',
    description: 'Professional photo sessions for portraits, products, fashion, and real estate.',
    subTypes: ['Portrait & Headshot', 'Product & Commercial', 'Real Estate & Interior', 'Fashion & Editorial'],
    coverImageUrl: 'https://res.cloudinary.com/dzymetqjr/image/upload/q_auto/f_auto/v1775813248/Confident_portrait_in_warm_tones_gxr3cl.png',
    startingRate: 1500,
    startingUnit: 'session',
    projectType: 'photography',
    creatorKeywords: ['Photography', 'Portrait', 'Product Photography', 'Real Estate Photography'],
  },
  {
    slug: 'video-production',
    name: 'Video Production',
    description: 'Cinematic video from music videos to documentaries and short films.',
    subTypes: ['Music Video', 'Documentary', 'Short Film', 'Promo & Ad'],
    coverImageUrl: 'https://res.cloudinary.com/dzymetqjr/image/upload/q_auto/f_auto/v1775813141/film_fub4qk.png',
    startingRate: 2850,
    startingUnit: 'project',
    projectType: 'film',
    creatorKeywords: ['Cinematography', 'Music Video', 'Documentary', 'Filmmaking'],
  },
  {
    slug: 'weddings-ceremonies',
    name: 'Weddings & Ceremonies',
    description: 'Full photo and video coverage for weddings, lobola, matric dances, and more.',
    subTypes: ['Wedding (Photo + Video)', 'Lobola & Umembeso', 'Matric Dance', 'Graduation', 'Baby Shower'],
    coverImageUrl: 'https://res.cloudinary.com/dzymetqjr/image/upload/q_auto/f_auto/v1775813232/wedding_hmgrnl.png',
    startingRate: 9000,
    startingUnit: 'package',
    projectType: 'wedding',
    creatorKeywords: ['Wedding', 'Photography', 'Cinematography', 'Event'],
  },
  {
    slug: 'event-coverage',
    name: 'Event Coverage',
    description: 'Capture every moment at corporate events, product launches, and festivals.',
    subTypes: ['Corporate Conference', 'Product Launch', 'Concert & Festival', 'Birthday & Private'],
    coverImageUrl: 'https://res.cloudinary.com/dzymetqjr/image/upload/q_auto/f_auto/v1775813106/live_event_qv7ogv.png',
    startingRate: 5000,
    startingUnit: 'event',
    projectType: 'event',
    creatorKeywords: ['Event', 'Corporate', 'Photography', 'Cinematography'],
  },
  {
    slug: 'content-creation',
    name: 'Content Creation',
    description: 'Social media, YouTube, and brand content optimized for engagement.',
    subTypes: ['Social Media (IG/TikTok)', 'YouTube', 'Brand Content', 'Influencer Shoot'],
    coverImageUrl: 'https://res.cloudinary.com/dzymetqjr/image/upload/q_auto/f_auto/v1775813079/content_creation_oabcwo.png',
    startingRate: 1500,
    startingUnit: 'session',
    projectType: 'content',
    creatorKeywords: ['Content Creation', 'Social Media', 'Photography', 'Short-Form Video'],
  },
  {
    slug: 'corporate-brand',
    name: 'Corporate & Brand',
    description: 'Team headshots, office culture, product photography, and brand films.',
    subTypes: ['Team Headshots', 'Office & Culture', 'Product Photography', 'Annual Report', 'Brand Film'],
    coverImageUrl: 'https://res.cloudinary.com/dzymetqjr/image/upload/q_auto/f_auto/v1775813048/coopperate_gh7oyz.png',
    startingRate: 2850,
    startingUnit: 'project',
    projectType: 'corporate',
    creatorKeywords: ['Corporate', 'Photography', 'Cinematography', 'Product Photography'],
  },
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

// ─── Production Packages ─────────────────────────────────────────────────────
// Pre-built service bundles. Prices auto-calculated from PRODUCTION_SERVICES rates.
// Each package links to a PRODUCTION_CATEGORIES slug via `category`.

export const PRODUCTION_PACKAGES: ProductionPackage[] = [
  {
    id: 'headshot-session',
    name: 'Headshot Session',
    description: '1-hour portrait photography session',
    category: 'photography',
    services: [
      { type: 'photography', subType: 'portrait', hours: 1 },
    ],
    deliverables: ['5 retouched images', 'Online delivery'],
  },
  {
    id: 'content-creator-day',
    name: 'Content Creator Day',
    description: '4-hour lifestyle photography session',
    category: 'content-creation',
    services: [
      { type: 'photography', subType: 'lifestyle', hours: 4 },
    ],
    deliverables: ['20 edited images', 'Social media formats', 'Online gallery'],
  },
  {
    id: 'wedding-photo-video',
    name: 'Wedding Photo + Video',
    description: 'Full-day wedding photography and cinematic film',
    category: 'weddings-ceremonies',
    services: [
      { type: 'photography', subType: 'portrait', hours: 8 },
      { type: 'cinematography', subType: 'musicVideo', hours: 8 },
      { type: 'postProduction', subType: 'photoRetouch', hours: 4 },
      { type: 'postProduction', subType: 'videoEdit', hours: 6 },
    ],
    deliverables: ['200+ edited photos', '5-min highlight film', 'Full ceremony edit', 'Online gallery'],
    popular: true,
  },
  {
    id: 'music-video',
    name: 'Music Video',
    description: '6-hour music video production with post',
    category: 'video-production',
    services: [
      { type: 'cinematography', subType: 'musicVideo', hours: 6 },
      { type: 'postProduction', subType: 'cinemaGrade', hours: 3 },
    ],
    deliverables: ['Multi-setup shoot', 'Cinema colour grade', '2 revision rounds'],
  },
  {
    id: 'corporate-package',
    name: 'Corporate Package',
    description: '4-hour shoot + 2-hour post-production',
    category: 'corporate-brand',
    services: [
      { type: 'cinematography', subType: 'corporate', hours: 4 },
      { type: 'postProduction', subType: 'videoEdit', hours: 2 },
    ],
    deliverables: ['2-camera setup', 'Script support', 'Edited deliverable'],
  },
  {
    id: 'event-half-day',
    name: 'Event Half-Day',
    description: '4-hour event photo and video coverage',
    category: 'event-coverage',
    services: [
      { type: 'photography', subType: 'commercial', hours: 4 },
      { type: 'cinematography', subType: 'shortForm', hours: 4 },
    ],
    deliverables: ['50+ edited photos', 'Highlight reel', 'Social media clips'],
  },
];

// ─── Ubunye AI Studio ────────────────────────────────────────────────────────

import type { QuickAction } from '@/types/ubunye';

export const UBUNYE_QUICK_ACTIONS: readonly QuickAction[] = [
  {
    id: 'plan-shoot',
    label: 'Plan a Shoot',
    description: `Crew, gear, and shot list for ${STUDIO.location.city}`,
    icon: 'Clapperboard',
    prompt: `Help me plan a professional shoot in ${STUDIO.location.city}. I need a shot list, crew recommendations, and equipment.`,
  },
  {
    id: 'find-gear',
    label: 'Find Gear',
    description: 'Camera, lens, and lighting packages',
    icon: 'Camera',
    prompt: `What camera and lens packages do you recommend for a cinematic corporate video in ${STUDIO.location.country}?`,
  },
  {
    id: 'hire-crew',
    label: 'Hire Crew',
    description: `Verified creators and rates in ${STUDIO.currency.code}`,
    icon: 'Users',
    prompt: `I need to hire a film crew for a 2-day shoot in ${STUDIO.location.city}. What roles do I need and what are typical rates in ${STUDIO.currency.code}?`,
  },
  {
    id: 'build-package',
    label: 'Build Package',
    description: 'Custom production bundles and quotes',
    icon: 'Package',
    prompt: `Help me build a full production package for a music video shoot in ${STUDIO.location.city}. Include crew, gear, and post-production.`,
  },
  {
    id: 'compare-pricing',
    label: 'Compare Pricing',
    description: `Production costs breakdown in ${STUDIO.currency.code}`,
    icon: 'Scale',
    prompt: `Give me a breakdown of typical production costs in ${STUDIO.currency.code} for a 1-minute commercial in ${STUDIO.location.country}.`,
  },
] as const;

export const UBUNYE_EXAMPLE_PROMPTS: readonly string[] = [
  'Build a podcast setup for 3 people.',
  `Find a photographer in ${STUDIO.location.city}.`,
  'Compare Sony cameras for documentary filmmaking.',
  'Create a wedding production package.',
  `What gear do I need for a rooftop shoot in ${STUDIO.location.city}?`,
  `Plan a 2-day music video shoot for R50,000.`,
  'Find an editor for a 5-minute corporate promo.',
  'What lighting setup works best for product photography?',
] as const;