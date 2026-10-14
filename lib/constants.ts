
// ─── Studio Branding & Configuration ─────────────────────────────────────────
// Single source of truth for ALL studio identity, contact info, and config.


export const STUDIO = {
  // One trading name everywhere (owner's choice, 2026-09-27); the registered
  // company is STUDIO.legal.companyName.
  name: 'ThabangVision',
  shortName: 'ThabangVision',
  tagline: 'We Engineer The Invisible',
  email: 'hello@thabangvision.com',
  // Owner alerts (new signup, ID check submitted) go straight to the Gmail
  // inbox. Sent to hello@ they came from that same Gmail and were forwarded
  // back to it, and Gmail filed the returning copy under Sent only: the
  // owner never saw them in the Inbox (found 2026-10-14).
  ownerAlertsTo: 'thabangvisionstudios@gmail.com',
  careersEmail: 'careers@thabangvision.com',
  supportEmail: 'support@thabangvision.com',
  bookingEmail: 'bookings@thabangvision.com',
  pressEmail: 'press@thabangvision.com',
  privacyEmail: 'privacy@thabangvision.com',
  /** System and agent alerts: health checks, invariant findings, AI budget. */
  securityEmail: 'security@thabangvision.com',
  /** Money alerts: payouts, released unpaid bookings, creator transfers. */
  billingEmail: 'billing@thabangvision.com',
  phone: '+27 63 990 5802',
  // WhatsApp only (owner, 2026-09-28): this number takes WhatsApp messages, not
  // calls. Everything customer-facing says WhatsApp, never "call".
  whatsapp: {
    number: '27639905802',
    display: '063 990 5802',
  },

  // How customers pay while online card payment is off (and afterwards, as an
  // option). The details match Capitec's account confirmation letter of
  // 27/09/2026. They are shown publicly on /pay on purpose: a customer can
  // always check them there, which is the defence against scammers who send
  // fake "new bank details" by WhatsApp or email.
  bank: {
    accountName: 'THABANGVISION STUDIO (PTY) LTD',
    bankName: 'Capitec Business',
    accountNumber: '1055250166',
    branchCode: '450105',
    accountType: 'Business account',
    // Unpaid EFT bookings keep their dates this long (see lib/rental/availability-server.ts).
    payWithinHours: 48,
  },

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
    tradingAs: 'ThabangVision',
    registrationNumber: '2025/742948/07',
    // Registered business address. MUST match the address on the Paystack dashboard.
    // Rendered in the footer and Terms of Service only when non-empty.
    registeredAddress: '9873 Extension 5, Soshanguve South, Gauteng, 0152, South Africa',
    // Whether the company is a registered VAT vendor. This — not vatNumber —
    // is what drives VAT wording and the VAT line at checkout.
    // Founder decision 2026-10-08: NOT registered. No VAT is added, shown or
    // invoiced. Rates and the effective date live in `tax` below so a future
    // registration is a dated config change, not a rewrite (lib/core/pricing/tax.ts).
    vatRegistered: false,
    tax: {
      vatRate: 15,
      // ISO date the registration takes effect, or null while not registered.
      // Sales before this date keep the meaning they had (no VAT).
      vatEffectiveFrom: null as string | null,
      // When registration happens, advertised prices are treated as
      // VAT-INCLUSIVE, so customer prices never rise automatically.
      pricesIncludeVat: true,
    },
    // Versioned legal documents. Bump the version (and date) whenever the
    // published text changes; acceptances are recorded against these strings
    // in public.consent_records (lib/migrations/068).
    documents: {
      terms: { version: '2026-10-13', label: 'Terms of Service', href: '/legal' },
      privacy: { version: '2026-10-08', label: 'Privacy Policy', href: '/privacy' },
      refunds: { version: '2026-10-13', label: 'Refunds & Cancellations', href: '/refunds' },
      rentalAgreement: { version: '2026-10-13', label: 'Rental agreement', href: '/legal#equipment-hire' },
      biometricNotice: { version: '2026-10-14', label: 'Identity check notice', href: '/privacy#identity-verification' },
    },
    // The VAT number itself. Optional: a vendor must show it on a tax invoice,
    // but is not obliged to publish it on the website. Rendered only if set.
    vatNumber: '',
    // POPIA requires a designated Information Officer, registered with the
    // Information Regulator. Rendered on /privacy only once the name is filled.
    informationOfficer: {
      name: 'Thabang Mashinini-Sekgoto',
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
    // ECT Act s44: a booking cancelled within this many days of being made,
    // before the hire or shoot starts, is refunded in full. Applied by
    // lib/rental/cancellation.ts and explained on /refunds section 10.
    coolingOffDays: 7,
  },

  // Where we work. Founder decision 2026-10-08: Gauteng, with travel outside
  // the province quoted separately. `listedCities` are the Gauteng places we
  // have pages for; they are examples, NOT the whole of Gauteng, so copy must
  // say "Gauteng" rather than imply these cities are the full area.
  serviceArea: {
    province: 'Gauteng',
    outsideProvince: 'travel_by_quote' as const,
    summary: 'Gauteng',
    outsideProvinceNote: 'Outside Gauteng, travel is quoted separately.',
  },

  // One promise for how fast we reply, used everywhere a time is stated.
  responseTime: 'within 2 business days',

  meta: {
    // The address the site is served on. The apex redirects to www, so every
    // canonical link and sitemap entry used to point at a redirect.
    url: 'https://www.thabangvision.com',
    title: 'ThabangVision',
    // Leads with gear rental, the offering that is live (2026-09-28).
    description:
      'Rent cameras, lenses, lighting and sound in Johannesburg. Collect in Dainfern, Fourways, and see the full price before you book. Photo and video shoots by request.',
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
      name: 'Johannesburg collection point',
      address: 'Dainfern, Fourways, Johannesburg. Collections by booking, during business hours; the exact place is sent with your booking.',
      city: 'Johannesburg',
      province: 'Gauteng',
      phone: '',
      email: 'hello@thabangvision.com',
      isPrimary: true,
    },
    {
      name: 'Pretoria Studio',
      address: 'By appointment.',
      city: 'Pretoria',
      province: 'Gauteng',
      phone: '',
      email: 'hello@thabangvision.com',
      isPrimary: false,
    },
  ],

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
    // Most units of one item in a single cart line or booking. Read by the
    // gear page, the cart, /api/cart and /api/rentals/eligibility.
    maxQuantityPerItem: 5,
    bulkDiscount: [
      { minItems: 1, maxItems: 2, discountPercent: 0 },
      { minItems: 3, maxItems: 4, discountPercent: 10 },
      { minItems: 5, maxItems: 6, discountPercent: 15 },
      { minItems: 7, maxItems: Infinity, discountPercent: 20 },
    ],

    // ── Gear protection (TASK-067): a trust ladder, not one heavy gate ──
    // "Value" is an item's replacement value (smart_rentals.replacement_value),
    // or its deposit when no value is recorded. The limit is on the value of
    // gear a renter has booked or out at the same time, and it rises with
    // returns made on time and undamaged. Applied by lib/rental/protection.ts
    // in /api/bookings and /api/cart/checkout.
    protection: {
      trustTiers: [
        { cleanReturns: 0, maxValue: 5000, label: 'New renter' },
        { cleanReturns: 2, maxValue: 20000, label: 'Trusted renter' },
        { cleanReturns: 5, maxValue: 60000, label: 'Regular renter' },
      ],
      // Orders above this value, and every first rental, are collection only,
      // so staff can check the renter against their ID at handover.
      collectionOnlyAboveValue: 20000,
      firstRentalCollectionOnly: true,
      // Damage fees, AppleCare style. Not shown anywhere until the owner sets
      // the amounts and flips `published`; until then Terms section 13 (repair
      // or replacement cost) applies.
      damageFees: {
        published: false,
        items: [] as readonly { issue: string; fee: number }[],
      },
    },
  },

  // Welcomes for new people (TASK-065, /admin/welcomes). null = the owner sends
  // each one by hand. 0 = sent straight away by the lifecycle engine
  // (lib/engagement) once the person's email is confirmed; a number = drafts
  // still unsent after that many hours are sent by the daily job. Owner
  // 2026-10-13: nobody approves welcomes; they all go automatically. Drafts
  // for people who joined more than autoSendMaxAgeDays ago are skipped (a
  // welcome months late reads as a mistake); 30 days covers everyone whose
  // draft was waiting for a hand send when auto-send started.
  welcomes: {
    autoSendAfterHours: 0 as number | null,
    autoSendMaxAgeDays: 30,
    // Signup is open to anyone with the public key, so a script making
    // accounts must not flood the owner's inbox or the AI budget. Past these
    // per-hour cap the owner note is skipped (the daily list in
    // /admin/welcomes still shows everyone). The welcome itself is one fixed
    // text (lib/greetings/welcome.ts welcomeTemplate), never AI-written.
    ownerNotesPerHour: 20,
  },

  // Lifecycle emails and push (lib/engagement): welcome, "finish your signup"
  // nudges, and tailored suggestions once a profile is complete.
  engagement: {
    // At most this many lifecycle emails per person (welcome included).
    maxEmailsPerDay: 1,
    maxEmailsPerWeek: 3,
    // "Finish your signup" nudges: days after the person stopped. Then we stop.
    nudgeAfterDays: [1, 3] as readonly number[],
    // People who stopped longer ago than this get no first nudge.
    nudgeLookbackDays: 14,
    // A cart counts as left behind after this many hours.
    cartAfterHours: 24,
    // Tailored suggestions written by the AI per daily run (cost and time bound:
    // the daily job has 60 seconds for everything).
    tailoredPerRun: 3,
    // Messages delivered per dispatcher run (the rest go the next day).
    dispatchPerRun: 20,
    // A push older than this is no longer news and is dropped.
    pushStaleHours: 26,
  },

  verification: {
    maxFileSizeMB: 5,
    acceptedTypes: ['image/jpeg', 'image/png'],
    maxAttempts: 3,
    // Checked by a person, not instantly. Say only what is true; the owner can
    // shorten this once a faster check (for example a face-match service) is in.
    reviewTime: 'usually within one working day',
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
    // Dainfern, Fourways (north Johannesburg), where most of the gear is
    // kept (owner, 2026-10-14). The coordinates are the Dainfern estates
    // (OpenStreetMap), close enough for delivery distances.
    dispatchFrom: {
      name: 'Dainfern, Fourways',
      lat: -25.9892,
      lng: 28.0050,
      // The exact place, sent only to someone with a booking (a residential
      // estate: public pages name the area only, lib/rental/collection-point.ts).
      meetingPoint: 'The View, Dainfern',
    },
    collection: {
      enabled: true,
      // Off since Phase 1 (spec §3.3: the hire fee and deposit are charged
      // together online). A deposit-only order left the hire to be paid at the
      // counter with no record of it, so an owner payout could be scheduled for
      // money that was never collected. Turn on only with a recorded,
      // reconciled counter payment.
      allowBalanceOnCollection: false,
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
      // whole of Gauteng from Dainfern, including Tshwane North and
      // Soshanguve. Below 100 parts of the south would fall outside, which
      // would be odd for a Johannesburg-Pretoria operation.
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
    // Shown at 40% opacity behind the headline, so a lighter encoding looks the same:
    // 1280px wide ~1.4 MB for larger screens, 720px ~0.6 MB for phones (the original was 1.76 MB).
    videoSrc: 'https://res.cloudinary.com/dzymetqjr/video/upload/q_auto:eco,f_auto,w_1280/v1775368307/hero_htn3xp.mp4',                          // Cloudinary video URL (desktop)
    mobileVideoSrc: 'https://res.cloudinary.com/dzymetqjr/video/upload/q_auto:low,f_auto,w_720/v1775368307/hero_htn3xp.mp4',                    // Smaller video for mobile (falls back to videoSrc)
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

  // Phone checks by WhatsApp (lib/phone-verify, docs/operations/whatsapp-setup.md).
  // The person sends "<message> TV-482913" to the business number from their
  // own WhatsApp; the sender's number is what gets confirmed.
  phoneVerify: {
    codePrefix: 'TV',
    whatsappMessage: 'Verify my ThabangVision number:',
    confirmedReply: 'Your number is confirmed on ThabangVision. You can go back to the site now.',
    unmatchedReply: 'We could not match that code to this WhatsApp number. It may have expired, or it was sent from a different number than the one you entered. Start again on your ThabangVision profile page.',
    // How often the profile page asks whether the message arrived.
    pollSeconds: 4,
  },

  // Phase 6 security limits (docs/security/phase-6-assessment.md).
  security: {
    // Server-side fetches of a URL a person or a model supplied
    // (lib/security/safe-fetch.ts): https only, public addresses only.
    fetch: {
      maxImageBytes: 15 * 1024 * 1024,
      timeoutMs: 15_000,
      maxRedirects: 3,
    },
    // Images one "analyze-portfolio" request may ask the server to fetch.
    portfolioAnalyzeMaxImages: 12,
    // Direct browser uploads signed by /api/cloudinary/sign
    // (lib/storage/upload-policy.ts). The server decides the folder (every
    // non-admin upload lands under userRoot/<user id>/), never signs a
    // client public_id, and signs allowed_formats so nothing but these file
    // types can be stored (no SVG, HTML, PDF or raw files).
    uploads: {
      userRoot: 'thabangvision_usecase/users',
      imageFormats: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'avif', 'gif'],
      // Portfolio project videos (STUDIO.creators.portfolio.acceptedVideoTypes).
      videoFormats: ['mp4'],
      // Admin uploads (productions, gear, handover/return photos, press) also
      // take the camera formats the admin tools always accepted. Still no
      // SVG, HTML, PDF or raw files.
      adminImageFormats: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'avif', 'gif', 'tif', 'tiff', 'bmp'],
      adminVideoFormats: ['mp4', 'mov', 'webm', 'm4v'],
    },
    // Ubunye chat (lib/ubunye/chat-links.ts, lib/agents/runtime.ts).
    chat: {
      // External hosts a chat reply may link to, besides our own site and
      // the STUDIO.social profiles. Any other link is shown as plain text,
      // and images in replies are never loaded (no zero-click exfiltration).
      // wa.me is allowed only for STUDIO.whatsapp.number, and payment pages
      // are never linked from model text (they come from /pay or the server).
      linkHosts: [] as string[],
      // Inbound request limits for POST /api/ubunye-chat.
      maxBodyBytes: 256 * 1024,
      maxMessageChars: 4000,
      maxHistoryMessages: 40,
      // Per reply: output tokens per model step, and tool executions in total
      // (stepCountIs bounds round trips, not calls per step).
      maxOutputTokens: 1500,
      maxToolCallsPerMessage: 8,
    },
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
    // Signed-out messages per network address per day, across everyone on it.
    // Higher than one guest's allowance because many people can share one
    // address (mobile carriers, offices, campuses); it caps cost, not people.
    guestNetworkDailyMessages: 60,
  },

  // Customer funnel metrics (spec §9.6): ids and codes only, kept this long,
  // then deleted by the daily maintenance job.
  analytics: {
    funnelRetentionDays: 180,
  },

  // Log retention: rows older than this are deleted by the daily maintenance
  // job (lib/cron/retention.ts, migration 086 prune_log_retention). Chat
  // history and the money ledger are never pruned here. The database refuses
  // less than 365 days for the audit log, payment events and AI cost history,
  // and less than 30 for the rest.
  retention: {
    platformEventsDays: 180,
    aiTokenUsageDays: 365, // AI cost history
    securityAuditLogDays: 365,
    paymentEventsDays: 365, // processed or ignored webhook events only
    readNotificationsDays: 180, // read notices only; unread ones stay
    batchSize: 1000, // rows per delete
    maxBatchesPerTable: 5, // per daily run, so the job cannot time out
  },

  booking: {
    platformCommission: 15,
    vatRate: 15,
    minBookingHours: 1,
    maxBookingHours: 72,
    cancellationPolicy: 'Cancel within 7 days of booking, before the shoot day, for a full refund. After that: cancel more than 48 hours before the shoot for a full refund. Between 24 and 48 hours, 50% is refunded. Inside 24 hours the booking is non-refundable, because crew and equipment are already committed.',
    // Applied automatically by app/api/service-bookings/[id]/status when a
    // client cancels, measured against bookings.shoot_date. Same shape as
    // STUDIO.rental.cancellationTiers; ordered most-notice-first.
    cancellationTiers: [
      { minHoursBefore: 48, refundPercent: 100 },
      { minHoursBefore: 24, refundPercent: 50 },
      { minHoursBefore: 0, refundPercent: 0 },
    ],
    autoCompleteAfterDays: 30,
    // ── Creative service fulfilment (spec §8.3, docs/marketplace/services.md) ──
    // Hours after the client approves the work (or it is approved
    // automatically) before the creator payout is sent, provided no dispute
    // is open. This is when WE send it; when it reaches the bank is the
    // bank's timing and is never promised.
    payoutDelayHours: 72,
    // Days a client has to approve, ask for a revision or raise a problem
    // after delivery before the work is approved automatically.
    autoApproveDeliveryAfterDays: 7,
    // Hours a creator has to accept or decline a paid booking before the
    // daily maintenance job passes it to another creator, counted from when
    // the client paid (lib/bookings/answer-by.ts). The reminder email goes
    // out on the daily run before that, about this many hours before.
    creatorAnswerHours: 48,
    creatorAnswerReminderHours: 24,
    // Revision rounds included when the package does not say otherwise.
    defaultRevisionsIncluded: 1,
    // Automatic payout attempts before a person takes over.
    maxPayoutAttempts: 3,
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
      delivered: 'Delivered',
      completed: 'Completed',
      paid_out: 'Paid Out',
      cancelled: 'Cancelled',
      declined: 'Declined',
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
export const SITE_TAGLINE = 'Rent camera gear in Johannesburg';
export const SITE_COPYRIGHT = `© ${new Date().getFullYear()} ${STUDIO.legal.companyName} (reg. ${STUDIO.legal.registrationNumber}), trading as ${STUDIO.shortName}. All rights reserved.`;

// CONFIGURATION FLAGS
export const SHOW_CAREERS = true;

// ─── CREATOR JOIN ────────────────────────────────────────────────────────────
// The way in for a creator who wants to offer their services: the home page,
// the sign-in page, the footer and the empty creator directory all use these
// words. Not in the header: signed out, it went to the same sign-in page as
// "Sign In", so the header keeps one door.
// /onboarding sends someone signed out to sign up first, then back.
/**
 * The offer door with roles_v1 on: one name everywhere, "Earn with
 * ThabangVision", for skills, gear and vehicles (TASK-085). CREATOR_JOIN below
 * stays what the site says with the flag off.
 */
export const EARN = {
  label: `Earn with ${STUDIO.shortName}`,
  copy: 'Offer your skills, your gear or your vehicle.',
  href: '/offer',
  homeTitle: `Earn with ${STUDIO.shortName}`,
  homeText: 'Make-up, modelling, driving, photos, video, sound or gear: offer your skills, your gear or your vehicle. No portfolio needed.',
} as const;

/**
 * Rentals categories shown as "coming soon" with roles_v1 on (labels only;
 * nothing to book yet). `category`, when set, is the RENTAL_CATEGORIES slug
 * that makes the label real: the tile disappears by itself as soon as that
 * category has a published listing (lib/rental/coming-soon.ts). A label with
 * no category stays until it is removed here.
 */
export const RENTALS_COMING_SOON: readonly { label: string; category?: string }[] = [
  { label: 'Studios and locations', category: 'studios' },
];

export const CREATOR_JOIN = {
  href: '/onboarding',
  ctaLabel: 'Join as a Creator',
  homeTitle: 'Get Booked',
  homeText: 'Photographer, videographer, editor or sound person? Join free, set up your profile and get booked for shoots.',
  loginLine: 'Want to get booked?',
  footerLabel: `Earn with ${STUDIO.shortName}`,
  emptyDirectoryTitle: 'No creators yet',
  emptyDirectoryText:
    'Verified creators appear here once their profiles and portfolios are ready. Are you a photographer, videographer, editor or sound person? Join and get booked.',
  emptyDirectoryCta: 'Offer your services',
} as const;

export const MAIN_NAVIGATION: {
  label: string;
  href: string;
  children?: { label: string; href: string; children?: { label: string; href: string }[] }[];
}[] = [
    { label: 'Rentals', href: '/rentals' },
    { label: 'Studio', href: '/studio' },
    // The free Ubunye apps. Hidden until the `creative_tools` flag is on (lib/nav.ts); /tools itself is always reachable by URL.
    { label: 'Apps', href: '/tools' },
    { label: 'Help', href: '/faq' },
    // No "Offer Your Services": see CREATOR_JOIN.
    // No "Pricing" item: every listing and package shows its own price, and the
    // one promise (free to join, pay when you book) sits on the home and rentals
    // pages. /pricing stays in the footer next to How to Pay.
  ];

export const FOOTER_SECTIONS = [
  {
    title: STUDIO.shortName,
    links: [
      { label: 'Rentals', href: '/rentals' },
      // The list of bookable creators. Nothing linked to it, so neither
      // visitors nor crawlers could find it.
      { label: 'Creators', href: '/smart-creators' },
      { label: 'Where to Collect', href: '/locations' },
      { label: 'About', href: '/about' },
      ...(SHOW_CAREERS ? [{ label: 'Careers', href: '/careers' }] : []),
      { label: 'Press & News', href: '/press' },
      { label: 'Share (QR code)', href: '/qr' },
    ],
  },
  {
    title: 'Account',
    links: [
      { label: 'Sign In', href: '/login' },
      { label: 'Create Account', href: '/register' },
      { label: 'Dashboard', href: '/dashboard' },
      { label: CREATOR_JOIN.footerLabel, href: CREATOR_JOIN.href },
    ],
  },
  {
    title: 'Support',
    links: [
      { label: 'How to Pay', href: '/pay' },
      { label: 'How Pricing Works', href: '/pricing' },
      { label: 'Contact', href: '/contact' },
      { label: 'Report a Bug', href: '/support/report-bug' },
      { label: 'Legal / Terms', href: '/legal' },
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Refunds & Returns', href: '/refunds' },
      { label: 'PAIA & data requests', href: '/paia' },
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
  // The owner's own studio, from his behind-the-scenes clips (public/media/rentals/studio).
  studios: '/media/rentals/studio/studio-softbox.webp',
  creatorDashboard: 'https://res.cloudinary.com/dzymetqjr/image/upload/v1773355513/creator_dashboard_xolw82.png',
} as const;

// ─── RENTAL CATEGORIES ─────────────────────────────────────────────────────
// Subtitles and descriptions say what kinds of gear each category holds, in
// plain words, without promising items we do not stock (they used to list
// cinema cameras, anamorphics, HMIs, LED volumes and licensed pilots).
export const RENTAL_CATEGORIES = [
  {
    value: 'cameras-optics',
    label: 'Cameras & Optics',
    subtitle: 'Cameras, Lenses & Filters',
    description: 'Cameras, lenses and filters for photo and video.',
    fallbackImage: PLACEHOLDER_IMAGES.camerasOptics,
  },
  {
    value: 'lighting-power',
    label: 'Lighting & Power',
    subtitle: 'Lights & Portable Power',
    description: 'Lights, flashes, reflectors and portable power.',
    fallbackImage: PLACEHOLDER_IMAGES.lightingPower,
  },
  {
    value: 'audio',
    label: 'Audio',
    subtitle: 'Microphones & Mixers',
    description: 'Wireless microphones, mixers and recording kit.',
    fallbackImage: PLACEHOLDER_IMAGES.audio,
  },
  {
    value: 'grip-motion',
    label: 'Grip & Motion',
    subtitle: 'Gimbals & Tripods',
    description: 'Gimbals and tripods to keep your shot steady.',
    fallbackImage: PLACEHOLDER_IMAGES.gripMotion,
  },
  {
    value: 'data-storage',
    label: 'Data & Storage',
    subtitle: 'Cards & Drives',
    description: 'Memory cards and drives for your footage.',
    fallbackImage: PLACEHOLDER_IMAGES.dataStorage,
  },
  {
    value: 'specialized-solutions',
    label: 'Specialized Solutions',
    subtitle: 'Specialist Kit',
    description: 'Radios and other specialist equipment.',
    fallbackImage: PLACEHOLDER_IMAGES.specializedSolutions,
  },
  {
    value: 'aerial-support',
    label: 'Aerial Support',
    subtitle: 'Drones',
    description: 'Drones for aerial photos and video.',
    fallbackImage: PLACEHOLDER_IMAGES.gripMotion,
  },
  {
    value: 'sound-reinforcement',
    label: 'Sound Reinforcement',
    subtitle: 'PA & Speakers',
    description: 'PA systems and speakers for events.',
    fallbackImage: PLACEHOLDER_IMAGES.soundReinforcement,
  },
  {
    // A place, not gear: booked by the day and used where it is (ON_SITE_RENTAL).
    // Like every category it shows only once it has a published listing.
    value: 'studios',
    label: 'Studios',
    subtitle: 'Photo & Video Studios',
    description: 'Photo and video studios with lights, backdrop and props, booked by the day.',
    fallbackImage: PLACEHOLDER_IMAGES.studios,
  },
] as const;

/**
 * Rental categories that are places (owner, 2026-10-15: his studio in
 * Dainfern, Fourways). They are used where they are, so they are never
 * delivered, and owners cannot list one as gear. The half-day price is the
 * listing's own `smart_rentals.price_per_half_day` (rands, migration 093);
 * clearing it removes the half-day option everywhere. Half days are not
 * bookable online yet (bookings are whole days), so the page offers it as
 * "ask us" on WhatsApp.
 */
export const ON_SITE_RENTAL = {
  categories: ['studios'] as readonly string[],
  minimumBooking: 'Half day',
  fullDayLabel: 'Full day',
  halfDayLabel: 'Half day',
  halfDayAsk: 'ask us',
  bookLabel: 'Book the studio',
  halfDayMessage: (title: string): string => `Hi, I would like to book a half day at ${title}.`,
  noDeliveryNote: 'A studio is used at the studio, so there is nothing to deliver.',
  // Notice for a studio: the same STUDIO.rental.minLeadTimeHours rule that
  // checkout enforces for every hire, in studio words.
  leadTimeMessage: (hours: number, firstDate: string): string =>
    `Book the studio at least ${hours} hours ahead so it is set up for you. The earliest date is ${firstDate}.`,
} as const;

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

// ─── RENTAL POLICY (money, integer basis points / cents) ─────────────────────
// Founder decisions 2026-10-08. Read by the pure pricing core
// (lib/core/pricing/rental.ts). Basis points avoid fractional-cent drift:
// 2500 bps = 25%.
export const RENTAL_POLICY = {
  // Deposit = 25% of the item's replacement value. Refundable; never revenue.
  depositRateBps: 2500,
  // Community-owned gear: owner 80% of the hire fee, platform 20%. The
  // deposit is excluded from this split.
  ownerShareBps: 8000,
  platformShareBps: 2000,
  ownerPayoutDelayHours: 48,
  // Any single item above R50,000 replacement value is collected in person.
  highValueCollectionThresholdCents: 5_000_000,
  firstHireCollectionOnly: true,
  // Renter trust tiers (spec §7.9): the most replacement value a renter may
  // hold at once, in cents. Calculated on the server only (lib/core/rental/trust.ts).
  //   contactable  verified email and phone
  //   verified     approved ID + selfie review and a validated bank account
  //   proven       1 clean return and 14 days in good standing since it
  //   trusted      5 clean returns, R50,000 returned clean, 90 days in good standing
  trustTierLimitsCents: {
    contactable: 200_000,
    verified: 1_000_000,
    proven: 2_500_000,
    trusted: 8_000_000,
  },
  trustThresholds: {
    proven: { cleanReturns: 1, historyDays: 14 },
    trusted: { cleanReturns: 5, cleanReturnValueCents: 5_000_000, historyDays: 90 },
  },
  // Owner payouts that pass every automatic check still wait for a person to
  // approve them in /admin/rental-ops until the founder decides otherwise
  // (decision register D-19). Set true to let the daily job approve them.
  payoutAutoApprove: false,
} as const;

// ─── DELIVERY POLICY (Phase 4, spec §4.2, §4.6–4.8, §4.13) ───────────────────
// Read by the pure delivery core (lib/core/delivery/*) and the adapters in
// lib/delivery/*. Amounts in integer cents. Values marked FOUNDER DECISION
// are safe defaults until the founder approves a value (decision register
// D-37 to D-42). Nothing here can loosen the rental rules in RENTAL_POLICY:
// first hire collected in person, any item over the high-value threshold
// collected in person, trust-tier limits.
export const DELIVERY_POLICY = {
  // FOUNDER DECISION (D-37, set 2026-10-13): the highest single-item
  // replacement value an automated (third-party) courier may carry. The owner
  // named the Sony Alpha A7 III as the most valuable item a courier may take;
  // its replacement value is R35,000 (Orms Direct body price, see
  // docs/operations/replacement-values-2026-10.md). Anything above goes by our
  // own vehicle or is collected. 0 = automated courier delivery OFF for every
  // item. Our own vehicle (manual adapter) is not affected by this limit.
  automatedDeliveryMaxItemValueCents: 3_500_000,
  // FOUNDER DECISION (D-38, set 2026-10-13): what we add to a courier's price
  // for a leg: R20 per trip (covers the card fee and packing). The customer
  // sees one delivery total; provider cost + this fee are stored apart.
  // Delivery money is never part of the owner's 80% hire share. Our own
  // vehicle adds nothing: its formula already is the customer price.
  platformFeeCents: 2000,
  // How long a customer delivery quote can be paid. Shorter than the provider
  // quote is fine; the customer price can never outlive the provider price.
  quoteTtlMinutes: 30,
  // Hand-to-hand only: never leave rented gear unattended (spec §4.11).
  requireHandToHand: true,
  // A courier must have ALL of these verified for our account, or it is not
  // offered, whatever its price (spec §4.6 item 3, §4.10).
  requiredCourierCapabilities: ['pickupConfirmation', 'proofOfDelivery', 'noLeaveAtDoor', 'idempotentCreate'] as const,
  // Ordering among providers that pass every safety gate (spec §4.6 items
  // 6–8). Reliability is a 0–100 score from operations history; unknown
  // providers score 0. Edit here, never in code.
  // FOUNDER DECISION (2026-10-13): the cheaper option for the customer wins
  // (courier price + platformFeeCents against the own-vehicle price); the
  // safety gates above still decide who may carry it at all.
  providerPreferences: {
    rankBy: ['price', 'reliability', 'speed'] as const,
    reliability: { manual: 80 } as Record<string, number>,
  },
  // FOUNDER DECISION (D-39): a renter who cancels after a courier is booked
  // pays the courier's cancellation fee at cost, capped at the delivery fee
  // they paid. Cancellations by us or the provider are refunded in full.
  passOnProviderCancellationFee: true,
  // A provider invoice within this many cents of the quote counts as matched.
  reconciliationToleranceCents: 0,
  // At most this many dispatch attempts per leg before a person takes over.
  maxDispatchAttemptsPerLeg: 3,
  // FOUNDER DECISION (D-48): a delivered outbound leg that the renter neither
  // accepts nor reports a problem with within this many hours of the recorded
  // delivery is deemed accepted by the system (custody event
  // `deemed_accepted`): the outbound fee is earned and the address can follow
  // retention. Never over a reported exception or an open incident, and never
  // for a return leg's inspection. The renter is reminded first
  // (deemedAcceptanceReminderLeadHours before).
  deemedAcceptanceHours: 48,
  deemedAcceptanceReminderLeadHours: 24,
  // Delivery addresses and driver contact details are deleted (or reduced to
  // suburb level) this many days after the leg closes (POPIA purpose limit).
  addressRetentionDays: 180,
  // What a driver is told is in the parcel: generic, never the brand or value
  // (spec §4.10: no unnecessary equipment values to drivers).
  driverLabel: 'Camera equipment',
  // Battery content is not recorded per listing yet, so every parcel is
  // declared as containing lithium-ion batteries (a courier that refuses them
  // then says so, instead of carrying them unknowingly).
  assumeLithiumBatteries: true,
  // Our own vehicle and staff (the manual adapter).
  ownFleet: {
    // FOUNDER DECISION (D-40, updated 2026-10-13): the owner confirmed their
    // own policy covers all the gear in transit and at the renter's, so
    // own-vehicle shipments record coverage_verified = true.
    verifiedTransitCover: true,
  },
  // FOUNDER DECISION (D-84..D-88, Phase 8): community gear can be collected
  // from (and returned to) the owner's own verified pickup address instead of
  // the owner bringing it to the studio. Only for a listing the owner opted in
  // (per listing, default off, D-86), an owner whose ID is verified and who is
  // not suspended, and a pickup address verified on the server inside the
  // service area. Anything else: the gear goes from (and back to) the studio,
  // as before. First-hire and high-value orders stay collection in person at
  // the studio (D-85). false switches owner pickup off for new quotes.
  ownerPickup: {
    enabled: true,
    // D-93: the renter's price for a trip from (or back to) an owner's
    // address is worked out from the CENTRE of the grid cell the owner's
    // address falls in, never from the exact point, so quoting from several
    // addresses cannot pinpoint the owner's home. 0.02 degrees is about
    // 2.2 km north-south and 2 km east-west around Johannesburg. The driver
    // still goes to the real address. Studio trips are priced exactly.
    pricingGridDegrees: 0.02,
  },
  // FOUNDER DECISION (D-41, set 2026-10-13): a verified goods-in-transit
  // policy. The owner confirmed on 2026-10-13 that their own policy covers
  // all the gear, cameras and lenses included, while a courier carries it
  // and while it is at the renter's. Insurer and policy number still to be
  // recorded here in place of the placeholder reference. Only the couriers
  // listed are covered, and only up to the courier limit above (D-37).
  // A null reference makes every courier "not covered" again.
  insurance: {
    verifiedPolicyRef: 'owner-policy-2026-10-13' as string | null,
    coveredProviders: ['uber_direct'] as readonly string[],
    maxItemValueCents: 3_500_000,
  },
} as const;

// ─── Delivery operations (Phase 4: webhooks, daily jobs, admin, retention) ───
// Operational limits, not business terms. Webhooks are the real-time source;
// the daily pipeline pass is the safety net (CLAUDE.md: daily crons only).
export const DELIVERY_OPS = {
  // Largest webhook body accepted from a delivery provider (bytes). Larger
  // requests are refused before anything is stored.
  webhookMaxBodyBytes: 256 * 1024,
  // Stored provider events retried per pipeline pass, and how many attempts
  // before an event is dead-lettered for a person.
  inboxBatchSize: 50,
  inboxMaxRetries: 8,
  // Shipments reconciled or polled per pipeline pass (bounded work).
  jobBatchSize: 50,
  // A dispatch claim older than this is presumed dead and is reconciled with
  // the provider before anything else (matches the core's stale-claim rule).
  staleClaimMinutes: 10,
  // Return-pickup reminder: sent once when the pickup window starts within
  // this many hours (the pass runs daily at 07:45 SAST).
  returnReminderLeadHours: 36,
  // Admin dashboard: how far back failed legs and dead-lettered events show.
  failedLookbackDays: 30,
  // Address retention purge (R-41, D-46): addresses handled per daily run.
  // Retention itself is DELIVERY_POLICY.addressRetentionDays.
  addressPurgeBatchSize: 200,
  // Coordinates of a purged address are kept to this many decimals (about
  // 1 km: suburb level), so history still shows the area, not the house.
  purgedCoordinateDecimals: 2,
  // The daily pipeline runs the delivery steps AFTER the money steps; together
  // they get at most this long (the cron has 60 s), so a slow courier API can
  // never starve the payment, refund and payout steps or the outbox. Work left
  // over waits for the next pass or "Run delivery jobs now".
  pipelineStepsBudgetMs: 20_000,
  // Ubunye's delivery quote tools store an (advisory) quote per call: limit
  // how many one person can ask for.
  ubunyeQuoteRateLimit: { max: 10, windowMs: 60 * 60_000 },
  // Renter acceptance requests (POST /api/delivery/accept) per person per minute.
  acceptRateLimit: { max: 20, windowMs: 60_000 },
} as const;

// ─── Delivery at checkout (Phase 4 customer flow) ────────────────────────────
// Additive block for the cart, checkout and booking screens. The delivery
// rules themselves live in DELIVERY_POLICY above; this holds only what the
// customer flow needs: delivery windows, the server-side address check and
// copy limits. Prices never come from here (they come from stored quotes).
export const DELIVERY_CHECKOUT = {
  // Windows a renter can choose, in SAST, on the first hire day (delivery)
  // and the last hire day (return pickup). Our own vehicle works to a
  // scheduled window; there is no on-demand option.
  windows: [
    { id: 'morning', label: '08:00 to 12:00', start: '08:00', end: '12:00' },
    { id: 'afternoon', label: '12:00 to 17:00', start: '12:00', end: '17:00' },
  ],
  // South African Standard Time (no daylight saving).
  utcOffset: '+02:00',
  // The same zone for showing times to people (quote expiry, windows), whatever the browser's zone.
  timeZone: 'Africa/Johannesburg',
  // A position the browser reports is only a hint. Farther than this from the
  // server-verified address, it is logged as a mismatch; it never sets a price.
  hintToleranceKm: 2,
  // Server-side address verification (AddressPort, lib/delivery/address.ts).
  // ADDRESS_PROVIDER=nominatim (default) or none (delivery then falls back to
  // collection with a clear message).
  address: {
    nominatimUrl: 'https://nominatim.openstreetmap.org/search',
    // OSMF Nominatim usage policy: at most 1 request per second, identified
    // by a real User-Agent with contact details, results cached, no
    // autocomplete. One lookup per "Get quote" press, never per keystroke.
    minIntervalMs: 1100,
    timeoutMs: 5000,
    cacheTtlMs: 24 * 60 * 60 * 1000,
    cacheMaxEntries: 500,
    countryCode: 'za',
    attribution: 'Address check: © OpenStreetMap contributors',
    minLength: 10,
    maxLength: 300,
  },
  contact: {
    maxNameLength: 80,
    maxInstructionsLength: 300,
  },
} as const;

// ─── Community listing review (spec §8.1–8.2) ───────────────────────────────
// Rules live in lib/core/listings/review.ts and run on the server only.
export const LISTING_POLICY = {
  // A person reviews any listing whose replacement value is above this.
  reviewValueThresholdCents: RENTAL_POLICY.highValueCollectionThresholdCents,
  // An owner may publish without a person reviewing the listing only when
  // ALL of these hold (and they have no rejected listing, no open dispute and
  // are not suspended). Deliberately conservative; lower only by founder
  // decision.
  establishedOwner: {
    minPublishedListings: 3,
    minCompletedRentals: 5,
  },
  // Sanity bounds on owner-entered amounts, in cents. Not business rules:
  // they stop typos (an extra zero) from reaching a renter's deposit.
  maxPricePerDayCents: 100_000_000,
  maxReplacementValueCents: 1_000_000_000,
  // Owner declarations are recorded against the Terms version in force
  // (Part D, Creators and Suppliers).
  ownerTermsVersion: STUDIO.legal.documents.terms.version,
  ownerTermsHref: STUDIO.legal.documents.terms.href,
  reviewNotesMaxLength: 2000,
} as const;

// Starting-point rates the listing flow pre-fills after a photo is
// recognised (lib/core/listings/suggest.ts). Rands. A suggestion only: it is
// marked AI-suggested and the owner must confirm or change it before the
// listing can be submitted. No replacement value is ever suggested here.
export const LISTING_SUGGESTED_RATES = {
  dayRateByCategory: {
    'cameras-optics': 650,
    'lighting-power': 400,
    audio: 350,
    'grip-motion': 450,
    'specialized-solutions': 300,
  } as Record<string, number>,
  defaultDayRate: 400,
  // Condition vocabulary as stored in smart_rentals.sub_category.
  conditionMultiplier: {
    new: 1.1,
    'like-new': 1.0,
    good: 0.9,
    fair: 0.75,
  } as Record<string, number>,
  defaultConditionMultiplier: 0.9,
  // SA market norm: a week's hire is billed as 5 days.
  weekBilledAsDays: 5,
} as const;

/**
 * Many roles, honest proof (docs/processes/roles-and-proof.md, TASK-085).
 *
 * The role catalogue itself (names, legal requirements, proof steps, review
 * guidelines, suggested prices) lives in the `roles` table (migration 090).
 * What stays here is the ladder: how much evidence earns each level and the
 * biggest single job each level may take. Like the renter trust tiers
 * (RENTAL_POLICY.trustTierLimitsCents), nobody is blocked: a person is
 * matched to jobs their record supports. REQUIRES_FOUNDER_APPROVAL for the
 * final numbers.
 */
export const ROLES_POLICY = {
  /** Biggest single job (client price, cents, VAT included) per evidence level. */
  jobSizeLimitsCents: {
    new: 150_000,
    shown: 400_000,
    vouched: 1_000_000,
    proven: 2_500_000,
    trusted: 8_000_000,
  },
  ladder: {
    /** In-app captured photos or videos (accepted by a reviewer) for "shown". */
    shownMinCaptured: 3,
    /** Confirmed vouches (a past client or a proven pro) for "vouched". */
    vouchedMinVouches: 1,
    /** Confirmed ThabangVision jobs for "proven". */
    provenMinJobs: 3,
    /** "trusted": more jobs, good reviews, no disputes. */
    trustedMinJobs: 10,
    trustedMinReviews: 5,
    trustedMinAverageRating: 4.5,
  },
  /**
   * A photo counts as "captured in the app" only when it came from the camera
   * button and the file is this fresh when it reaches us (EXIF date or the
   * file's own time). Older files count as uploads. A signal for the
   * reviewer, not proof on its own.
   */
  captureFreshnessMinutes: 15,
  /** The person may move the suggested price within the role's low..high band. */
  pricing: {
    unitLabels: {
      hour: 'per hour',
      half_day: 'per half day',
      day: 'per day',
      look: 'per look',
      day_plus_km: 'per day',
      project: 'per project',
    },
    perKmLabel: 'per km',
  },
  /** Words clients see. Hide the machinery: one mark, a real count, the promise. */
  copy: {
    verified: 'Verified',
    verifiedHelp: 'ID checked, and every legal check this kind of work needs.',
    newOnPlatform: `New on ${STUDIO.shortName}`,
    jobsDone: (n: number): string => `${n} job${n === 1 ? '' : 's'} done on ${STUDIO.shortName}`,
    promise: `${STUDIO.shortName} stands behind every booking. We hold your payment until the work is delivered. If something goes wrong, we find a replacement or refund you.`,
    reviewPromise: 'A person on our team will look at it, usually within 2 working days. If something needs fixing, we tell you exactly how.',
    facePrompt: 'Clients only see it after they book you, so everyone is chosen for their work.',
    done: 'Done. A person will check it within 2 working days.',
    blindNote: 'Chosen for the work. You see who is coming once your booking is confirmed.',
    recordLine: (jobs: number, onTime: number | null): string =>
      jobs === 0 ? `New on ${STUDIO.shortName}` : `${jobs} job${jobs === 1 ? '' : 's'}${onTime === null ? '' : ` · on time ${onTime}/${jobs}`}`,
  },
  /** Matching (admin only for now): score weights and the fair "new" slots. */
  matching: {
    similarityWeight: 0.6,
    reliabilityWeight: 0.3,
    areaWeight: 0.1,
    defaultLimit: 10,
    /** Places in every top list kept for people with no jobs yet. */
    newSlots: 2,
  },
  /** The private CV or voice-note original is deleted this many days after upload. */
  cvRetentionDays: 90,
  /** Facts extraction (CV, voice note, text): tries per person per window. */
  extractRateLimit: { max: 6, windowMs: 60 * 60 * 1000 },
  /** Role match (Find and Offer): tries per person (or per IP when signed out) per window. */
  matchRateLimit: { max: 10, windowMs: 10 * 60 * 1000 },
  /** Coming-soon interest: max sign-ups per IP per window. */
  interestRateLimit: { max: 5, windowMs: 60 * 60 * 1000 },
  /** Most photos or clips per proof step, so a cheap phone and little data still work. */
  maxFilesPerStep: 6,
} as const;

// Creator specialisations (profiles.specializations), stored lower-case.
// Search and the profile page use this list; onboarding maps detected skills
// onto it (lib/creators/specializations.ts).
export const CREATOR_SPECIALIZATIONS = [
  { value: 'photography', label: 'Photography' },
  { value: 'cinematography', label: 'Cinematography' },
  { value: 'editing', label: 'Editing' },
  { value: 'sound', label: 'Sound' },
  { value: 'directing', label: 'Directing' },
  { value: 'lighting', label: 'Lighting' },
  { value: 'producing', label: 'Producing' },
] as const;
export type CreatorSpecialization = (typeof CREATOR_SPECIALIZATIONS)[number]['value'];

export const RENTAL_CATEGORY_VALUES = RENTAL_CATEGORIES.map(c => c.value);
export type RentalCategorySlug = (typeof RENTAL_CATEGORIES)[number]['value'];

/** Categories an owner can list gear in, and gear photos are recognised into: every category except places. */
export const GEAR_RENTAL_CATEGORIES = RENTAL_CATEGORIES.filter((c) => !ON_SITE_RENTAL.categories.includes(c.value));

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
    subtitle: 'Photo and video shoots, by request',
    image: PLACEHOLDER_IMAGES.smartProductions,
    link: '/studio',
  },
];

/**
 * The home page with People switched on (roles_v1): two halves, people and
 * things, as two equal doors. Replaces the Studio card and the "Need a
 * photographer? Send us a brief" link (owner, 2026-10-14).
 */
export const CAPABILITIES_PEOPLE = [
  {
    title: 'Rentals',
    subtitle: 'Gear for your shoot',
    image: PLACEHOLDER_IMAGES.smartRentals,
    link: '/rentals',
  },
  {
    title: 'People',
    subtitle: 'Photographers, make-up artists, models and drivers',
    image: PLACEHOLDER_IMAGES.smartProductions,
    link: '/people',
  },
];

export const HOME_PEOPLE = {
  titleTop: 'Gear and people',
  titleBottom: 'for your shoot.',
  peopleLine: 'Book photographers, make-up artists, models and drivers, chosen on their work.',
  rentLabel: 'Rent gear',
  peopleLabel: 'Book people',
  peopleHref: '/people',
  finalTitle: 'Ready to shoot?',
} as const;

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
  // Travel, fuel surcharge, overtime, instalments and the "competitive edge"
  // claims were removed 2026-10-08 (Phase 0): nothing in the product charged
  // or delivered them. Travel outside Gauteng is quoted by a person.
  billing: {
    minimumBooking: "1 hour",
    vatRate: 15,
  },
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
    // No "popular" flag: no service booking has been completed yet (2026-09-28).
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
  // "Hire Crew" ("Verified creators and rates") was removed on 2026-09-28:
  // no creators are listed yet.
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
  'Which lens should I rent for portraits?',
  'Compare Sony cameras for documentary filmmaking.',
  'Create a wedding production package.',
  `What gear do I need for a rooftop shoot in ${STUDIO.location.city}?`,
  `Plan a 2-day music video shoot for R50,000.`,
  'Find an editor for a 5-minute corporate promo.',
  'What lighting setup works best for product photography?',
] as const;
// ─── FUNNEL (spec §9.6) ──────────────────────────────────────────────────────
// Where a browser may say a funnel step happened (POST /api/funnel). Anything
// else is refused, so the funnel tables only hold known page names.
export const FUNNEL_CLIENT_SURFACES = ['gear_page'] as const;
export type FunnelClientSurface = (typeof FUNNEL_CLIENT_SURFACES)[number];

// ─── UBUNYE CREATIVE STUDIO (/tools) ────────────────────────────────────────
// The free, open source desktop suite: Ubunye Light, Photo and Film. One
// source for the /tools catalogue and its detail pages. Download links are
// never written here: each app page reads <downloads.base>/<slug>/latest.json
// (lib/ubunye-release.ts) and falls back to "coming soon" if it is missing.
// Card photos: `image` stays null until the owner's own photos exist; the
// card then shows an accent-tinted gradient. Use a Cloudinary URL when set.

export type UbunyeAppSlug = 'light' | 'photo' | 'film';
export type UbunyePlatformId = 'windows' | 'macos' | 'linux' | 'browser';
export type UbunyeReleaseStatus = 'coming-soon' | 'preview' | 'released';

export interface UbunyePlatform {
  id: UbunyePlatformId;
  label: string;
  /** Short qualifier shown beside the label, e.g. "preview". */
  note: string | null;
}

export interface UbunyeStudioApp {
  slug: UbunyeAppSlug;
  name: string;
  /** The word after "Ubunye", shown in the app's accent colour. */
  shortName: string;
  category: string;
  tagline: string;
  accent: string;
  icon: string;
  iconPng: string;
  /** Background photo for the catalogue card. Null until the owner's photos exist. */
  image: { src: string; alt: string } | null;
  capabilities: readonly string[];
  repoUrl: string;
  /** The browser version (served from R2 by the ubunye-creative-web Worker). */
  webUrl: string;
  upstream: { name: string; credit: string; url: string };
  /** One plain sentence for /tools, in everyday words. */
  plain: string;
  /** Who it is for, e.g. "For photographers." */
  audience: string;
  /**
   * A short silent loop of the real browser app (recorded with Playwright,
   * 720px wide, under 600 KB) and its still. Files live in public/ubunye/media.
   */
  media: { mp4: string; webm: string; poster: string; alt: string };
}

/**
 * The research lab behind the free apps and the editor in research (owner,
 * 2026-10-14). Shown on /about in "From the lab".
 */
export const RESEARCH_LAB = {
  name: 'Ubunye AI Ecosystems Research Lab',
  url: 'https://uaie.vercel.app',
  line: 'We build tools that make creative work easier, and give them away.',
  why: 'Great work should not depend on who you know or what you can afford. So our lab takes the hard parts out of creating, and puts the tools in everyone’s hands.',
  editor: {
    name: 'Ubunye Studio',
    status: 'In research',
    desc: 'An AI editor that watches your footage, finds your best moments and cuts a first edit. Then it checks its own work.',
  },
} as const;

export const UBUNYE_STUDIO = {
  suiteName: 'Ubunye Apps',
  shortName: 'Ubunye',
  wordmark: '/ubunye/ubunye-creative-studio-dark.svg',
  intro: 'Free apps for photo and film. Download them, or try them in your browser.',
  version: 'Early version',
  status: 'preview' as UbunyeReleaseStatus,
  statusLabels: {
    'coming-soon': 'Coming soon',
    preview: 'Early version',
    released: 'Available',
  } as Record<UbunyeReleaseStatus, string>,
  /** The /tools hero: what it is, where it runs, what it costs. */
  hero: {
    title: 'Three free apps for your photos and videos.',
    subtitle: 'Mac, Windows, Linux, or right in your browser. No account. No cost.',
    browserCta: 'Try it in your browser',
  },
  /**
   * The desktop downloads are not code signed (checked 2026-10-14: the Windows
   * MSI has no Authenticode signature; the macOS app is ad-hoc signed only, no
   * Developer ID, not notarized). Owner chose to ship unsigned. Set `signed`
   * to true once they are, and the trust note disappears.
   */
  install: {
    signed: false,
    trustNote: "The first time, your computer may ask if you trust the app. That's normal for new apps.",
    macNote: 'On a Mac, right-click the app and choose Open. On newer macOS, go to System Settings, Privacy & Security, and choose Open Anyway.',
  },
  /** Closing line on /tools, linked to RESEARCH_LAB.url. */
  closing: `Made by the ${RESEARCH_LAB.name}, because great work shouldn’t depend on what you can afford.`,
  licence: 'MIT OR Apache-2.0',
  maker: 'Ubunye AI Ecosystems',
  systemRequirements: 'Windows (x64, x86 or Arm), macOS (Apple silicon or Intel) or Linux (x86_64 or Arm64). Or use the browser version.',
  colors: {
    bg: '#0B0D10',
    bgSecondary: '#161A20',
    text: '#F5F0E6',
    textSecondary: '#A8ADB5',
  },
  platforms: [
    { id: 'windows', label: 'Windows', note: null },
    { id: 'macos', label: 'macOS', note: null },
    { id: 'linux', label: 'Linux', note: null },
    { id: 'browser', label: 'Browser', note: 'preview' },
  ] as readonly UbunyePlatform[],
  downloads: {
    /** Each app's files are listed in <base>/<slug>/latest.json; see lib/ubunye-release.ts. */
    base: 'https://downloads.thabangvision.com',
  },
  apps: [
    {
      slug: 'light',
      name: 'Ubunye Light',
      shortName: 'Light',
      category: 'RAW Photo Editor',
      tagline: 'Sort your shoot and develop your RAW camera files.',
      accent: '#F6C75B',
      icon: '/ubunye/light-icon.svg',
      iconPng: '/ubunye/light-256.png',
      image: { src: '/ubunye/light-card.webp', alt: "Columns of a sandstone hall under an orange storm sky, by Tha'Bang Studios" },
      capabilities: [
        'RAW development for camera files',
        'A photo library to import, sort and find your shots',
      ],
      repoUrl: 'https://github.com/ubunye-ai-ecosystems/ubunye-creative-light',
      webUrl: 'https://light.tools.thabangvision.com',
      upstream: {
        name: 'LightCraft',
        credit: 'Based on LightCraft by the ArtCraft team',
        url: 'https://github.com/storytold/lightcraft',
      },
      plain: 'Develop the photos from your camera. Make them brighter, warmer and sharper, even RAW files.',
      audience: 'For photographers.',
      media: {
        mp4: '/ubunye/media/light.mp4',
        webm: '/ubunye/media/light.webm',
        poster: '/ubunye/media/light-poster.webp',
        alt: 'Ubunye Light in the browser: contrast, warmth and vibrance sliders move and a pale lake photo turns vivid.',
      },
    },
    {
      slug: 'photo',
      name: 'Ubunye Photo',
      shortName: 'Photo',
      category: 'Photo Editor',
      tagline: 'Retouch and edit pictures with layers and masks. Opens PSD files.',
      accent: '#FF6B4A',
      icon: '/ubunye/photo-icon.svg',
      iconPng: '/ubunye/photo-256.png',
      image: { src: '/ubunye/photo-card.webp', alt: "A round glass building lit pink at night, by Tha'Bang Studios" },
      capabilities: [
        'Layers and masks',
        'Retouching tools',
        'PSD file support',
      ],
      repoUrl: 'https://github.com/ubunye-ai-ecosystems/ubunye-creative-photo',
      webUrl: 'https://photo.tools.thabangvision.com',
      upstream: {
        name: 'PhotoCraft',
        credit: 'Based on PhotoCraft by the ArtCraft team',
        url: 'https://github.com/storytold/photocraft',
      },
      plain: 'Edit and retouch pictures, like Photoshop. Opens Photoshop files.',
      audience: 'For designers and retouchers.',
      media: {
        mp4: '/ubunye/media/photo.mp4',
        webm: '/ubunye/media/photo.webm',
        poster: '/ubunye/media/photo-poster.webp',
        alt: 'Ubunye Photo in the browser: a Brightness and Contrast layer is added to a dark night photo and the building lights up.',
      },
    },
    {
      slug: 'film',
      name: 'Ubunye Film',
      shortName: 'Film',
      category: 'Video Editor',
      tagline: 'Cut your footage, fix the colour and sound, and export your video.',
      accent: '#13D1C2',
      icon: '/ubunye/film-icon.svg',
      iconPng: '/ubunye/film-256.png',
      image: { src: '/ubunye/film-card.webp', alt: "The Union Buildings clock tower under a dark teal sky, by Tha'Bang Studios" },
      capabilities: [
        'Timeline editing',
        'Colour correction',
        'Audio editing',
        'Export to common video formats',
      ],
      repoUrl: 'https://github.com/ubunye-ai-ecosystems/ubunye-creative-film',
      webUrl: 'https://film.tools.thabangvision.com',
      upstream: {
        name: 'FilmCraft',
        credit: 'Based on FilmCraft by the ArtCraft team',
        url: 'https://github.com/storytold/filmcraft',
      },
      plain: 'Cut your video, fix the colour and sound, and export it.',
      audience: 'For filmmakers and content creators.',
      media: {
        mp4: '/ubunye/media/film.mp4',
        webm: '/ubunye/media/film.webm',
        poster: '/ubunye/media/film-poster.webp',
        alt: 'Ubunye Film in the browser: a clip is trimmed on the timeline, then its colour is warmed and made richer.',
      },
    },
  ] as readonly UbunyeStudioApp[],
} as const;

export function getUbunyeApp(slug: string): UbunyeStudioApp | undefined {
  return UBUNYE_STUDIO.apps.find((a) => a.slug === slug);
}
