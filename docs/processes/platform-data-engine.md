# PLATFORM DATA ENGINE — Raw Data Collection System

## Overview

ThabangVision collects every interaction on the platform as raw event data. Like how Pokemon Go's 143 million players unknowingly built a 30 billion image dataset for delivery robots, ThabangVision's creators and clients are building South Africa's most comprehensive creative production dataset.

The difference: ThabangVision is transparent about it. Users know their anonymized data helps build industry insights. The value is shared — creators get market intelligence, clients get better recommendations, and the platform gets smarter over time.

**One table collects everything. One function logs everything. Raw data in, intelligence out.**

---

## Architecture

```
Every user action
         │
         ▼
  logEvent() function
    (one line of code per event)
         │
         ▼
  platform_events table
    (single table, JSONB metadata)
         │
         ▼
  Raw data accumulates
         │
         ├── Real-time: dashboard analytics
         ├── Daily: aggregated reports
         ├── Monthly: industry insights
         ├── Yearly: SA Creative Industry Report
         └── Continuous: Ubunye gets smarter
```

---

## Core Database Schema

### Single events table — stores everything:

```sql
create table if not exists platform_events (
  id uuid primary key default gen_random_uuid(),
  
  -- What happened
  event_type text not null,
  event_category text not null,
  
  -- Who did it
  user_id uuid references auth.users(id),
  anonymous_id text,  -- for non-logged-in users (cookie/fingerprint)
  session_id text,
  
  -- Where it happened
  page_url text,
  page_category text,
  referrer_url text,
  
  -- Device info
  device_type text,  -- mobile, desktop, tablet
  browser text,
  os text,
  screen_width integer,
  screen_height integer,
  connection_speed text,
  ip_address text,
  geo_country text,
  geo_city text,
  geo_region text,
  
  -- Event-specific data (flexible)
  metadata jsonb default '{}',
  
  -- When
  created_at timestamptz default now()
);

-- Indexes for fast querying
create index idx_events_type on platform_events (event_type);
create index idx_events_category on platform_events (event_category);
create index idx_events_user on platform_events (user_id);
create index idx_events_session on platform_events (session_id);
create index idx_events_created on platform_events (created_at);
create index idx_events_page on platform_events (page_url);

-- Partial indexes for common queries
create index idx_events_bookings on platform_events (created_at) 
  where event_category = 'booking';
create index idx_events_search on platform_events (created_at)
  where event_category = 'search';
create index idx_events_chat on platform_events (created_at)
  where event_category = 'chat';

-- GIN index for JSONB queries
create index idx_events_metadata on platform_events using gin (metadata);

-- RLS
alter table platform_events enable row level security;

-- Only admin and system can read events
create policy "Admin reads all events" on platform_events
  for select using (true);  -- restrict to admin in API layer

-- System inserts events (service role)
create policy "System inserts events" on platform_events
  for insert with check (true);

-- Partition by month for performance (when data grows large)
-- Add partitioning later: platform_events_2026_03, platform_events_2026_04, etc.
```

### Supporting tables for structured data:

```sql
-- Photo metadata (structured, not just events)
create table if not exists photo_metadata (
  id uuid primary key default gen_random_uuid(),
  photo_id text not null,  -- cloudinary public ID
  uploaded_by uuid references auth.users(id),
  upload_context text not null check (upload_context in 
    ('production', 'rental', 'verification', 'avatar', 'delivery')),
  context_id uuid,  -- production_id, rental_id, etc.
  
  -- File info
  file_size_bytes integer,
  file_type text,
  image_width integer,
  image_height integer,
  cloudinary_url text,
  
  -- EXIF data (complete raw extraction)
  exif_data jsonb default '{}',
  
  -- Extracted fields for fast querying
  camera_make text,
  camera_model text,
  lens_model text,
  focal_length numeric,
  aperture numeric,
  shutter_speed text,
  iso integer,
  flash_fired boolean,
  gps_latitude numeric,
  gps_longitude numeric,
  date_taken timestamptz,
  software text,
  
  created_at timestamptz default now()
);

create index idx_photo_camera on photo_metadata (camera_make, camera_model);
create index idx_photo_lens on photo_metadata (lens_model);
create index idx_photo_context on photo_metadata (upload_context, context_id);
create index idx_photo_gps on photo_metadata (gps_latitude, gps_longitude)
  where gps_latitude is not null;
create index idx_photo_date on photo_metadata (date_taken)
  where date_taken is not null;

-- Conversation analytics (structured from Ubunye chats)
create table if not exists conversation_analytics (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null,
  user_id uuid,
  anonymous_id text,
  session_id text,
  
  -- Conversation metrics
  message_count integer,
  user_message_count integer,
  assistant_message_count integer,
  conversation_duration_ms integer,
  
  -- AI metrics
  model_used text,
  total_input_tokens integer,
  total_output_tokens integer,
  total_cost_usd numeric,
  
  -- Intent and outcome
  primary_topic text,
  topics_discussed text[] default '{}',
  sentiment text,  -- positive, neutral, negative
  intent text,  -- browse, compare, book, complain, ask_price, general
  
  -- Conversion
  led_to_booking boolean default false,
  led_to_signup boolean default false,
  led_to_rental_view boolean default false,
  led_to_creator_view boolean default false,
  booking_reference text,
  
  -- Quality
  ubunye_failed boolean default false,  -- couldn't answer
  fallback_triggered boolean default false,
  
  -- Language
  language_detected text,
  
  created_at timestamptz default now()
);

create index idx_convo_topic on conversation_analytics (primary_topic);
create index idx_convo_intent on conversation_analytics (intent);
create index idx_convo_conversion on conversation_analytics (led_to_booking)
  where led_to_booking = true;
```

---

## Event Logger — One Function For Everything

### Server-side logger:

```typescript
// lib/analytics/logger.ts

import { createAdminClient } from '@/lib/supabase/admin';

interface EventData {
  eventType: string;
  eventCategory: string;
  userId?: string;
  anonymousId?: string;
  sessionId?: string;
  pageUrl?: string;
  pageCategory?: string;
  referrerUrl?: string;
  deviceType?: string;
  browser?: string;
  os?: string;
  screenWidth?: number;
  screenHeight?: number;
  connectionSpeed?: string;
  ipAddress?: string;
  geoCountry?: string;
  geoCity?: string;
  geoRegion?: string;
  metadata?: Record<string, any>;
}

export async function logEvent(event: EventData): Promise<void> {
  try {
    const supabase = await createAdminClient();
    await supabase.from('platform_events').insert({
      event_type: event.eventType,
      event_category: event.eventCategory,
      user_id: event.userId || null,
      anonymous_id: event.anonymousId || null,
      session_id: event.sessionId || null,
      page_url: event.pageUrl || null,
      page_category: event.pageCategory || null,
      referrer_url: event.referrerUrl || null,
      device_type: event.deviceType || null,
      browser: event.browser || null,
      os: event.os || null,
      screen_width: event.screenWidth || null,
      screen_height: event.screenHeight || null,
      connection_speed: event.connectionSpeed || null,
      ip_address: event.ipAddress || null,
      geo_country: event.geoCountry || null,
      geo_city: event.geoCity || null,
      geo_region: event.geoRegion || null,
      metadata: event.metadata || {},
    });
  } catch (error) {
    // Never let analytics break the app
    console.error('Analytics error:', error);
  }
}

// Convenience wrapper for API routes
export function logEventFromRequest(
  req: Request,
  eventType: string,
  eventCategory: string,
  userId?: string,
  metadata?: Record<string, any>
) {
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip');
  const userAgent = req.headers.get('user-agent') || '';
  
  // Parse user agent
  const isMobile = /mobile|android|iphone/i.test(userAgent);
  const browser = parseBrowser(userAgent);
  const os = parseOS(userAgent);

  // Fire and forget — don't await
  logEvent({
    eventType,
    eventCategory,
    userId,
    ipAddress: ip || undefined,
    deviceType: isMobile ? 'mobile' : 'desktop',
    browser,
    os,
    metadata,
  });
}

function parseBrowser(ua: string): string {
  if (/chrome/i.test(ua)) return 'Chrome';
  if (/firefox/i.test(ua)) return 'Firefox';
  if (/safari/i.test(ua)) return 'Safari';
  if (/edge/i.test(ua)) return 'Edge';
  return 'Other';
}

function parseOS(ua: string): string {
  if (/windows/i.test(ua)) return 'Windows';
  if (/mac/i.test(ua)) return 'macOS';
  if (/linux/i.test(ua)) return 'Linux';
  if (/android/i.test(ua)) return 'Android';
  if (/iphone|ipad/i.test(ua)) return 'iOS';
  return 'Other';
}
```

### Client-side tracker:

```typescript
// lib/analytics/tracker.ts
'use client';

// Generate or retrieve anonymous ID for non-logged-in users
function getAnonymousId(): string {
  if (typeof window === 'undefined') return '';
  let id = localStorage.getItem('tv_anon_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('tv_anon_id', id);
  }
  return id;
}

// Generate or retrieve session ID
function getSessionId(): string {
  if (typeof window === 'undefined') return '';
  let id = sessionStorage.getItem('tv_session_id');
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem('tv_session_id', id);
  }
  return id;
}

// Send event to API
export async function trackEvent(
  eventType: string,
  eventCategory: string,
  metadata?: Record<string, any>
): Promise<void> {
  try {
    await fetch('/api/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventType,
        eventCategory,
        anonymousId: getAnonymousId(),
        sessionId: getSessionId(),
        pageUrl: window.location.pathname,
        referrerUrl: document.referrer || null,
        screenWidth: window.innerWidth,
        screenHeight: window.innerHeight,
        connectionSpeed: (navigator as any).connection?.effectiveType || null,
        metadata,
      }),
    });
  } catch {
    // Silent fail — never break the app for analytics
  }
}

// Track page view (call in layout or page components)
export function trackPageView(pageCategory?: string): void {
  trackEvent('page_view', 'navigation', { pageCategory });
}

// Track click
export function trackClick(elementType: string, elementText: string, extra?: Record<string, any>): void {
  trackEvent('click', 'interaction', { elementType, elementText, ...extra });
}

// Track search
export function trackSearch(query: string, resultsCount: number, filters?: Record<string, any>): void {
  trackEvent('search', 'search', { query, resultsCount, ...filters });
}

// Track scroll depth
export function trackScrollDepth(depth: number): void {
  trackEvent('scroll', 'engagement', { depthPercentage: Math.round(depth) });
}
```

### API route for client-side events:

```typescript
// app/api/analytics/event/route.ts

import { logEvent } from '@/lib/analytics/logger';

export async function POST(req: Request) {
  const body = await req.json();
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip');
  const userAgent = req.headers.get('user-agent') || '';

  // Get authenticated user if exists
  const user = await getOptionalUser(req);

  logEvent({
    ...body,
    userId: user?.id || null,
    ipAddress: ip || undefined,
    deviceType: /mobile|android|iphone/i.test(userAgent) ? 'mobile' : 'desktop',
    browser: parseBrowser(userAgent),
    os: parseOS(userAgent),
  });

  // Always return 200 — analytics should never fail visibly
  return Response.json({ ok: true });
}
```

---

## 14 Data Layers — What To Collect

### LAYER 1: User Identity

Tracked automatically on signup and profile updates.

```typescript
// On registration
logEvent({
  eventType: 'user_registered',
  eventCategory: 'auth',
  userId: user.id,
  metadata: {
    authMethod: 'google' | 'magic_link' | 'password',
    referralSource: searchParams.get('ref'),
    utmSource: searchParams.get('utm_source'),
    utmMedium: searchParams.get('utm_medium'),
    utmCampaign: searchParams.get('utm_campaign'),
    firstPageLanded: sessionStorage.getItem('first_page'),
  },
});

// On login
logEvent({
  eventType: 'user_login',
  eventCategory: 'auth',
  userId: user.id,
  metadata: {
    authMethod: 'google' | 'magic_link' | 'password',
    timeSinceLastLogin: lastLoginDiff,
  },
});

// On profile update
logEvent({
  eventType: 'profile_updated',
  eventCategory: 'user',
  userId: user.id,
  metadata: {
    fieldsUpdated: ['bio', 'skills', 'hourly_rate'],
    profileCompletionBefore: 60,
    profileCompletionAfter: 85,
  },
});
```

### LAYER 2: Page Views

Tracked automatically via layout component or middleware.

```typescript
// In app layout or analytics provider
'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { trackEvent } from '@/lib/analytics/tracker';

export function PageViewTracker() {
  const pathname = usePathname();
  const enteredAt = useRef<number>(Date.now());

  useEffect(() => {
    const entered = Date.now();
    enteredAt.current = entered;

    // Track page enter
    trackEvent('page_view', 'navigation', {
      pageCategory: getPageCategory(pathname),
    });

    // Track page exit (duration)
    return () => {
      const duration = Date.now() - enteredAt.current;
      trackEvent('page_exit', 'navigation', {
        pageCategory: getPageCategory(pathname),
        durationMs: duration,
      });
    };
  }, [pathname]);

  return null;
}

function getPageCategory(path: string): string {
  if (path.startsWith('/smart-production')) return 'productions';
  if (path.startsWith('/smart-rentals')) return 'rentals';
  if (path.startsWith('/smart-creators')) return 'creators';
  if (path.startsWith('/ubunye')) return 'chat';
  if (path.startsWith('/book')) return 'booking';
  if (path.startsWith('/dashboard')) return 'dashboard';
  if (path.startsWith('/admin')) return 'admin';
  if (path === '/') return 'home';
  if (path === '/pricing') return 'pricing';
  if (path === '/contact') return 'contact';
  return 'other';
}
```

### LAYER 3: Clicks

Tracked on important interactive elements.

```typescript
// Book button clicked
trackClick('button', 'BOOK THIS PACKAGE', {
  packageId: 'wedding-premium',
  packagePrice: 38525,
  pageUrl: '/smart-production',
});

// Creator profile clicked
trackClick('card', 'creator_card', {
  creatorId: 'thabang-mokwena',
  creatorSlug: 'thabang-mokwena',
  position: 2,  // 2nd card in the list
  source: 'homepage_featured',
});

// Gear item clicked
trackClick('card', 'rental_card', {
  rentalId: 'sony-a7-iii',
  rentalSlug: 'sony-alpha-a7-iii',
  dailyRate: 750,
  category: 'cameras-optics',
  source: 'production_shot_with',  // came from "shot with" cross-sell
});

// Add extra clicked on booking page
trackClick('checkbox', 'add_extra', {
  extraId: 'drone-coverage',
  extraPrice: 3200,
  packageId: 'wedding-premium',
});

// Filter clicked
trackClick('filter', 'category_filter', {
  filterType: 'category',
  filterValue: 'weddings-ceremonies',
  page: '/smart-production',
});
```

### LAYER 4: Search

Tracked in the search handler.

```typescript
// In search API route or component
logEventFromRequest(req, 'search_performed', 'search', userId, {
  queryRaw: searchQuery,
  searchType: 'global',  // or 'rentals', 'creators', 'productions'
  filtersApplied: { category: 'photography', maxPrice: 1000 },
  sortApplied: 'price_low',
  resultsCount: results.length,
  resultsReturned: results.slice(0, 10).map((r, i) => ({
    itemId: r.id,
    itemType: r.type,
    position: i + 1,
  })),
});

// When user clicks a search result
trackEvent('search_result_clicked', 'search', {
  queryRaw: searchQuery,
  resultId: clickedItem.id,
  resultType: clickedItem.type,
  resultPosition: clickedPosition,
  timeToClickMs: Date.now() - searchTimestamp,
});

// When user searches but clicks nothing
trackEvent('search_abandoned', 'search', {
  queryRaw: searchQuery,
  resultsCount: results.length,
  timeOnResultsMs: Date.now() - searchTimestamp,
});
```

### LAYER 5: Ubunye Conversations

Tracked in the chat API route and frontend.

```typescript
// In /api/ubunye-chat route — after each message
logEventFromRequest(req, 'ubunye_message', 'chat', userId, {
  conversationId,
  messageRole: 'user',
  messageLength: message.length,
  quickChipUsed: quickChip || null,
});

logEventFromRequest(req, 'ubunye_response', 'chat', userId, {
  conversationId,
  messageRole: 'assistant',
  responseLength: response.length,
  responseTimeMs: endTime - startTime,
  modelUsed: 'claude-sonnet-4-20250514',
  inputTokens: usage.input_tokens,
  outputTokens: usage.output_tokens,
  costUsd: calculateCost(usage),
});

// At end of conversation (user leaves page or 5min inactivity)
// Save conversation summary to conversation_analytics table
await supabase.from('conversation_analytics').insert({
  conversation_id: conversationId,
  user_id: userId,
  anonymous_id: anonymousId,
  session_id: sessionId,
  message_count: messages.length,
  user_message_count: messages.filter(m => m.role === 'user').length,
  assistant_message_count: messages.filter(m => m.role === 'assistant').length,
  conversation_duration_ms: lastMessageTime - firstMessageTime,
  model_used: 'claude-sonnet-4-20250514',
  total_input_tokens: totalInputTokens,
  total_output_tokens: totalOutputTokens,
  total_cost_usd: totalCost,
  primary_topic: detectTopic(messages),
  topics_discussed: detectAllTopics(messages),
  sentiment: detectSentiment(messages),
  intent: detectIntent(messages),
  led_to_booking: didBookingFollow,
  led_to_signup: didSignupFollow,
  language_detected: detectLanguage(messages),
  ubunye_failed: ubunyeFailedToAnswer,
});
```

### LAYER 6: Creator Profile Views

Tracked on the creator detail page.

```typescript
// On /smart-creators/[slug] page load
trackEvent('creator_profile_view', 'creators', {
  creatorId: creator.id,
  creatorSlug: creator.crew_slug,
  creatorSpecializations: creator.specializations,
  creatorHourlyRate: creator.hourly_rate,
  creatorRating: creator.avg_rating,
  sourcePage: referrer,  // where they came from
});

// Track which sections they viewed (intersection observer)
trackEvent('creator_section_viewed', 'creators', {
  creatorSlug: creator.crew_slug,
  section: 'reviews',  // bio, skills, gear, work, reviews, availability
  viewDurationMs: sectionViewDuration,
});

// Track if they clicked the book button
trackClick('button', 'BOOK THIS CREATOR', {
  creatorId: creator.id,
  creatorSlug: creator.crew_slug,
  creatorRate: creator.hourly_rate,
  viewedSections: sectionsViewed,
  timeOnProfileMs: Date.now() - pageLoadTime,
});
```

### LAYER 7: Rental Views

Tracked on rental detail pages.

```typescript
// On /smart-rentals/[category]/[slug] page load
trackEvent('rental_view', 'rentals', {
  rentalId: rental.id,
  rentalSlug: rental.slug,
  rentalCategory: rental.category,
  dailyRate: rental.daily_rate,
  ownerType: rental.owner_type,  // studio or community
  sourcePage: referrer,
  cameFromProduction: referrer?.includes('/smart-production'),
  sourceProductionId: sourceProductionId,
});

// Track image interactions
trackEvent('rental_image_viewed', 'rentals', {
  rentalId: rental.id,
  imageIndex: currentImageIndex,
  totalImages: rental.gallery_urls.length,
});

// Track booking widget interaction
trackEvent('rental_booking_widget', 'rentals', {
  rentalId: rental.id,
  action: 'dates_selected',
  startDate: selectedStart,
  endDate: selectedEnd,
  daysCount: daysDiff,
  calculatedPrice: totalPrice,
});
```

### LAYER 8: Booking Events

Tracked at every status change in the booking lifecycle.

```typescript
// In every booking status change handler
async function logBookingEvent(
  booking: Booking,
  eventType: string,
  triggeredBy: 'client' | 'creator' | 'admin' | 'system' | 'cron',
  oldStatus: string,
  newStatus: string,
  extra?: Record<string, any>
) {
  await logEvent({
    eventType: `booking_${eventType}`,
    eventCategory: 'booking',
    userId: booking.client_id,
    metadata: {
      bookingId: booking.id,
      reference: booking.reference,
      bookingType: booking.booking_type,
      packageId: booking.package_id,
      packageName: booking.package_name,
      total: booking.total,
      creatorAmount: booking.creator_amount,
      platformAmount: booking.platform_amount,
      triggeredBy,
      oldStatus,
      newStatus,
      timeSinceCreatedMs: Date.now() - new Date(booking.created_at).getTime(),
      timeSincePreviousEventMs: extra?.timeSincePrevious,
      ...extra,
    },
  });
}

// Usage throughout booking lifecycle:
await logBookingEvent(booking, 'created', 'client', '', 'pending', {
  packageId: 'wedding-premium',
  extras: ['drone-coverage'],
  eventDate: '2026-03-22',
  location: 'Sandton',
});

await logBookingEvent(booking, 'paid', 'system', 'pending', 'paid', {
  paymentMethod: 'card',
  cardType: 'visa',
  paymentTimeMs: 45000,
});

await logBookingEvent(booking, 'assigned', 'admin', 'paid', 'assigned', {
  creatorId: creator.id,
  assignmentReason: 'manual',
});

await logBookingEvent(booking, 'accepted', 'creator', 'assigned', 'accepted', {
  responseTimeMs: Date.now() - new Date(booking.assigned_at).getTime(),
});

await logBookingEvent(booking, 'delivered', 'creator', 'in_progress', 'delivered', {
  deliveryUrl: deliveryUrl,
  onTime: isOnTime,
  daysEarly: daysEarly,
  daysLate: daysLate,
});

await logBookingEvent(booking, 'approved', 'client', 'delivered', 'completed', {
  rating: clientRating,
  reviewLength: review?.length || 0,
  reviewSentiment: analyzeSentiment(review),
  timeToApproveMs: Date.now() - new Date(booking.delivered_at).getTime(),
  revisionsUsed: booking.revision_count,
});

await logBookingEvent(booking, 'payout_triggered', 'system', 'completed', 'completed', {
  payoutAmount: booking.creator_amount,
  recipientCode: creator.paystack_recipient_code,
});

await logBookingEvent(booking, 'cancelled', triggeredBy, oldStatus, 'cancelled', {
  cancellationReason: reason,
  refundAmount: refundAmount,
  wasBeforeDeadline: isBeforeDeadline,
});
```

### LAYER 9: Payment Events

Tracked in Paystack webhook handler.

```typescript
// In /api/webhooks/paystack
await logEvent({
  eventType: `payment_${event.event.replace('.', '_')}`,
  eventCategory: 'payment',
  metadata: {
    reference: event.data.reference,
    amountKobo: event.data.amount,
    amountZar: event.data.amount / 100,
    currency: event.data.currency,
    paymentMethod: event.data.channel,  // card, bank_transfer, ussd
    cardType: event.data.authorization?.card_type,  // visa, mastercard
    cardBank: event.data.authorization?.bank,
    cardCountry: event.data.authorization?.country_code,
    paystackFee: event.data.fees,
    ipAddress: event.data.ip_address,
    attemptNumber: event.data.log?.attempts,
    failureReason: event.data.gateway_response,
  },
});
```

### LAYER 10: Photo Metadata

Tracked on every photo upload.

```typescript
// In photo upload handler (productions, rentals, verification)
import { extractPhotoMetadata } from '@/lib/metadata/verification';

async function trackPhotoUpload(
  fileBuffer: ArrayBuffer,
  userId: string,
  context: string,
  contextId: string,
  cloudinaryUrl: string,
  cloudinaryPublicId: string,
  fileSize: number,
  fileType: string,
) {
  // Extract EXIF
  const exif = await extractPhotoMetadata(fileBuffer);

  // Store in structured table
  await supabase.from('photo_metadata').insert({
    photo_id: cloudinaryPublicId,
    uploaded_by: userId,
    upload_context: context,
    context_id: contextId,
    file_size_bytes: fileSize,
    file_type: fileType,
    image_width: exif.imageWidth,
    image_height: exif.imageHeight,
    cloudinary_url: cloudinaryUrl,
    exif_data: exif,  // full raw EXIF as JSONB
    camera_make: exif.cameraMake,
    camera_model: exif.cameraModel,
    lens_model: exif.lensModel,
    focal_length: exif.focalLength,
    aperture: exif.aperture,
    shutter_speed: exif.shutterSpeed,
    iso: exif.iso,
    flash_fired: exif.flashFired,
    gps_latitude: exif.gps?.latitude,
    gps_longitude: exif.gps?.longitude,
    date_taken: exif.dateTaken,
    software: exif.software,
  });

  // Also log as event
  await logEvent({
    eventType: 'photo_uploaded',
    eventCategory: 'content',
    userId,
    metadata: {
      context,
      contextId,
      cameraModel: exif.cameraModel,
      lensModel: exif.lensModel,
      hasGps: !!exif.gps,
      fileSize,
    },
  });
}
```

### LAYER 11: Email Events

Tracked in the email sending function.

```typescript
// In lib/email/index.ts — wrap every email send
async function sendTrackedEmail(options: {
  to: string;
  userId?: string;
  emailType: string;
  subject: string;
  body: string;
  bookingReference?: string;
}) {
  // Send the email
  const result = await emailProvider.send(options);

  // Log the event
  await logEvent({
    eventType: 'email_sent',
    eventCategory: 'communication',
    userId: options.userId,
    metadata: {
      recipientEmail: options.to,
      emailType: options.emailType,
      subject: options.subject,
      bookingReference: options.bookingReference,
      delivered: result.success,
      bounced: result.bounced,
      bounceReason: result.bounceReason,
    },
  });
}
```

### LAYER 12: Reviews

Tracked when reviews are submitted.

```typescript
// In /api/orders/[ref]/review
await logEvent({
  eventType: 'review_submitted',
  eventCategory: 'review',
  userId: clientUserId,
  metadata: {
    bookingReference: reference,
    creatorId: booking.creator_id,
    rating: rating,
    reviewTextLength: review?.length || 0,
    reviewSentiment: analyzeSentiment(review),
    reviewTopics: extractTopics(review),
    // e.g., ["punctuality:positive", "quality:positive", "communication:neutral"]
    timeSinceCompletedMs: Date.now() - new Date(booking.completed_at).getTime(),
    wasPrompted: source === 'email',  // clicked from email reminder
    packageId: booking.package_id,
    packageName: booking.package_name,
  },
});
```

### LAYER 13: Admin Actions

Tracked on every admin operation.

```typescript
// Wrap every admin action
async function logAdminAction(
  adminUserId: string,
  actionType: string,
  targetType: string,
  targetId: string,
  metadata?: Record<string, any>,
  req?: Request,
) {
  await logEvent({
    eventType: `admin_${actionType}`,
    eventCategory: 'admin',
    userId: adminUserId,
    ipAddress: req?.headers.get('x-forwarded-for') || undefined,
    metadata: {
      actionType,
      targetType,
      targetId,
      ...metadata,
    },
  });
}

// Usage:
await logAdminAction(adminId, 'assign_creator', 'booking', bookingId, {
  creatorId: selectedCreatorId,
  reason: 'best_match',
});

await logAdminAction(adminId, 'approve_verification', 'profile', profileId, {
  aiScreeningPassed: true,
  fraudFlagsCount: 0,
});

await logAdminAction(adminId, 'trigger_payout', 'booking', bookingId, {
  amount: creatorAmount,
  recipientCode: recipientCode,
});
```

### LAYER 14: Platform Health

Tracked via cron job or middleware metrics.

```typescript
// Cron job: /api/cron/platform-health — runs every 5 minutes

export async function GET() {
  const now = new Date();
  const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);

  // Count active sessions (events in last 5 min)
  const { count: activeUsers } = await supabase
    .from('platform_events')
    .select('user_id', { count: 'exact', head: true })
    .gt('created_at', fiveMinAgo.toISOString());

  // Count API errors
  const { count: errorCount } = await supabase
    .from('platform_events')
    .select('id', { count: 'exact', head: true })
    .eq('event_category', 'error')
    .gt('created_at', fiveMinAgo.toISOString());

  await logEvent({
    eventType: 'platform_health_check',
    eventCategory: 'system',
    metadata: {
      activeUsers,
      errorCount,
      timestamp: now.toISOString(),
      interval: '5min',
    },
  });

  return Response.json({ ok: true });
}
```

---

## Where To Add logEvent() Calls

One line per event. Here's every file that needs it:

```
FILE                                          EVENTS TO LOG
────                                          ─────────────
app/layout.tsx                                page_view (via PageViewTracker component)
app/(marketing)/login/page.tsx                user_login, login_failed
app/(marketing)/register/page.tsx             user_registered
app/auth/callback/route.ts                    auth_callback, user_onboarded
app/api/ubunye-chat/route.ts                  ubunye_message, ubunye_response
app/api/orders/route.ts                       booking_created
app/api/orders/[ref]/approve/route.ts         booking_approved, review_submitted
app/api/orders/[ref]/deliver/route.ts         booking_delivered
app/api/orders/[ref]/cancel/route.ts          booking_cancelled
app/api/orders/[ref]/revision/route.ts        booking_revision_requested
app/api/webhooks/paystack/route.ts            payment_success/failed, transfer_success/failed
app/api/search/route.ts                       search_performed
app/api/contact/route.ts                      contact_form_submitted
app/api/crew/request/route.ts                 crew_request_submitted
app/api/verifications/route.ts                verification_submitted
app/api/dashboard/bank-details/route.ts       bank_details_saved
app/api/admin/*/route.ts                      admin_* actions
app/api/cloudinary/sign/route.ts              photo_uploaded
lib/email/index.ts                            email_sent
lib/payments/payout.ts                        payout_triggered, payout_success, payout_failed

CLIENT-SIDE:
components/crew/CrewCard.tsx                  creator_card_clicked
components/rentals/RentalCard.tsx             rental_card_clicked
components/productions/PackageCard.tsx        package_card_clicked
components/search/SearchModal.tsx             search_result_clicked, search_abandoned
components/ubunye/ChatInput.tsx               ubunye_chip_clicked
app/(platform)/smart-creators/[slug]/page.tsx creator_profile_view, creator_section_viewed
app/(platform)/smart-rentals/[cat]/[slug]/page.tsx rental_view, rental_image_viewed
app/(platform)/book/page.tsx                  booking_page_view, extra_added, payment_initiated
```

---

## Data Retention & Privacy

### POPIA compliance:

```
WHAT WE COLLECT:
  Anonymous behavioral data (page views, clicks, searches)
  Transactional data (bookings, payments — required for business)
  Content metadata (EXIF from photos — required for features)
  Conversation analytics (anonymized topics and intents)

WHAT WE DON'T COLLECT:
  Keystroke logging
  Clipboard content
  Contacts or phone data
  Location tracking outside of EXIF
  Screen recording
  Cross-site tracking

RETENTION POLICY:
  Raw events: 24 months (then archived or aggregated)
  Aggregated data: indefinite
  Photo metadata: indefinite (anonymized)
  Conversation content: 12 months (summaries kept indefinitely)
  Payment data: 7 years (legal requirement)
  
ANONYMIZATION:
  For data products and reports:
  - Remove user_id → replace with anonymous hash
  - Remove ip_address
  - Remove exact GPS → round to city level
  - Remove names → use "Creator A", "Client B"
  - Aggregate to minimum group size of 10
  
USER RIGHTS (POPIA):
  - Right to access: user can download their data
  - Right to delete: user can request deletion
  - Right to object: user can opt out of analytics
  - Add opt-out toggle in /dashboard/settings:
    [ ] Help improve ThabangVision with anonymous usage data
    (on by default, user can turn off)
```

### Privacy policy updates:

```
Add to /privacy page:

"ANALYTICS AND USAGE DATA

We collect anonymous usage data to improve the platform:
- Pages you visit and time spent
- Features you use
- Search queries (anonymized)
- Booking patterns (aggregated)

This data helps us:
- Improve the platform experience
- Provide better recommendations
- Generate industry insights for creators
- Make Ubunye smarter

You can opt out of analytics data collection
in your dashboard settings. This does not affect
transactional data required for bookings and payments.

We never sell individual user data.
Industry reports use anonymized, aggregated data only.
Minimum group size of 10 for any published statistic."
```

---

## Data Products (Future)

### What the raw data becomes:

```
PRODUCT 1: SA Creative Industry Report (annual)
  Source: aggregated booking, pricing, and demand data
  Audience: agencies, brands, government, universities
  Revenue: subscription or one-time purchase
  
PRODUCT 2: Creator Market Intelligence (dashboard)
  Source: anonymized pricing, demand, and rating data
  Audience: creators on Pro/Studio plans
  Revenue: included in subscription
  Example: "Your rate is 15% below market average for wedding photography in JHB"

PRODUCT 3: Ubunye API (AI as a service)
  Source: conversation data trains smarter SA-specific AI
  Audience: other platforms needing SA creative industry AI
  Revenue: API usage fees
  
PRODUCT 4: Equipment Demand Index
  Source: rental data, EXIF data, search queries
  Audience: camera manufacturers, retailers
  Revenue: data licensing
  Example: "Sony A7 III demand up 23% QoQ in Gauteng"

PRODUCT 5: Location Intelligence
  Source: booking locations, GPS from EXIF, event venues
  Audience: location scouts, tourism boards, venue owners
  Revenue: data licensing
  Example: "Top 10 wedding venues in JHB by booking volume"

PRODUCT 6: Brand Partnerships
  Source: gear usage data, creator preferences
  Audience: camera brands wanting creator endorsements
  Revenue: partnership fees
  Example: Sony pays to be recommended by Ubunye for wedding shoots
```

---

## Implementation Priority

```
PHASE 1 — Launch (add immediately, minimal effort):
  ✓ platform_events table
  ✓ logEvent() function
  ✓ Page views (layout component)
  ✓ Booking events (in booking API routes)
  ✓ Payment events (in webhook handler)
  ✓ Search events (in search API)
  ✓ Auth events (login, register)

PHASE 2 — Month 1 (after 100 users):
  ✓ Ubunye conversation analytics
  ✓ Creator profile view tracking
  ✓ Rental view tracking
  ✓ Click tracking on CTAs
  ✓ Photo EXIF extraction
  ✓ Email tracking

PHASE 3 — Month 3 (after 500 users):
  ✓ Scroll depth tracking
  ✓ Search result click tracking
  ✓ Session reconstruction
  ✓ Admin action logging
  ✓ Platform health monitoring
  ✓ Privacy opt-out toggle

PHASE 4 — Month 6 (after 1000 users):
  ✓ Data aggregation pipelines
  ✓ Admin analytics dashboard
  ✓ Creator market intelligence
  ✓ First industry report

PHASE 5 — Year 1+:
  ✓ Data products
  ✓ Ubunye trained on real conversation data
  ✓ Predictive demand forecasting
  ✓ Automated pricing recommendations
```

---

## Key Rules

```
1. NEVER let analytics break the app — silent fail on all tracking
2. FIRE AND FORGET — don't await logEvent() in request handlers
3. ONE TABLE — platform_events stores everything, JSONB for flexibility
4. ONE FUNCTION — logEvent() is the only way to write analytics data
5. POPIA COMPLIANT — anonymize before aggregating, opt-out available
6. RAW FIRST — collect raw, aggregate later. You can't un-aggregate.
7. NO PII IN REPORTS — never expose individual users in data products
8. RETENTION LIMITS — raw events 24 months, aggregates forever
9. PHASE IT IN — start with booking + payment + auth, add more over time
10. THE DATA IS THE MOAT — code can be copied, 3 years of SA creative data cannot
```
