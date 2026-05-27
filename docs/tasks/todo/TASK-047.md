# TASK-047: Continuous Learning Loop — Every Interaction Trains the System

## Status: Todo

## Summary
Build an event-driven learning pipeline where every user interaction (search, click, booking, rejection, review, conversation) feeds back into the system to improve matching, recommendations, and ranking over time. This is the compounding engine that makes every other AI feature smarter.

## Why
Currently, interactions are fire-and-forget — a user searches, clicks, books, and the system learns nothing. Google, TikTok, and Spotify all use this pattern: every action is training data. After ~90 days of data, the matching and recommendation quality should noticeably improve. After a year, it becomes a genuine competitive moat.

## Architecture

### Event Taxonomy
Every trackable interaction gets logged with a structured schema:

| Event | Signal | Weight |
|-------|--------|--------|
| `search_query` | What users are looking for | Medium |
| `search_click` | Which results were relevant | High |
| `search_skip` | Which results were NOT relevant | Medium |
| `creator_view` | Interest signal | Low |
| `creator_bookmark` | Strong interest | High |
| `booking_created` | Conversion signal | Very High |
| `booking_completed` | Successful match | Very High |
| `booking_cancelled` | Failed match | High (negative) |
| `review_submitted` | Outcome quality | Very High |
| `ubunye_recommendation_accepted` | AI match quality | High |
| `ubunye_recommendation_rejected` | AI match failure | High (negative) |
| `price_viewed` | Price sensitivity signal | Low |
| `cart_abandoned` | Friction/price signal | Medium |

### Learning Pipeline

```
Events → platform_events table → Daily aggregation cron
  → Feature extraction → Model update → Deployed to search/matching
```

### What Gets Learned
1. **Search ranking weights** — which creator attributes correlate with clicks/bookings
2. **Recommendation affinity** — "users who booked X also booked Y" patterns
3. **Price elasticity** — at what price points do bookings drop off
4. **Style preferences by project type** — weddings prefer style A, corporate prefers style B
5. **Temporal patterns** — when demand spikes, seasonal trends
6. **Geographic affinity** — which creators perform best in which areas

## Implementation Plan

### 1. Event Logger (`lib/analytics/events.ts`)
- `trackEvent(userId, eventType, payload)` — writes to `platform_events`
- Payload schema per event type (TypeScript types)
- Client-side wrapper for browser events (search clicks, page views)
- Server-side logger for booking/payment events (already partially exists)

### 2. Extend `platform_events` Table
```sql
-- platform_events already exists; ensure these columns:
ALTER TABLE platform_events ADD COLUMN IF NOT EXISTS
  event_payload JSONB DEFAULT '{}';
ALTER TABLE platform_events ADD COLUMN IF NOT EXISTS
  session_id TEXT;
ALTER TABLE platform_events ADD COLUMN IF NOT EXISTS
  entity_type TEXT; -- 'creator', 'listing', 'booking'
ALTER TABLE platform_events ADD COLUMN IF NOT EXISTS
  entity_id UUID;
```

### 3. Daily Aggregation (`app/api/cron/daily-maintenance/` — extend)
- New step: aggregate previous day's events into learning signals
- Compute: click-through rates per creator, booking conversion rates, abandonment rates
- Store aggregated metrics in `creator_performance_metrics` table
- Update search ranking weights based on outcome data

### 4. Search Ranking Integration
- Current search uses basic text matching
- Add performance-based boosting: creators with higher booking rates rank higher
- Add collaborative filtering: "creators similar to ones you've booked"
- Weights updated daily from aggregation pipeline

### 5. Ubunye Recommendation Feedback
- When Ubunye suggests creators, track which ones the user engages with
- Feed back into agent context: "in past conversations about weddings in Joburg, users preferred creators with these characteristics"
- Store anonymized recommendation outcomes

### 6. Client-Side Event Tracking (`lib/analytics/client.ts`)
- Lightweight client hook: `useTrackEvent()`
- Fire on: search result click, creator profile view, add-to-cart, booking start
- Debounced, batched sends to `/api/analytics/events`
- No PII in client-side events (user ID from session, not form data)

## Files to Create/Modify
```
CREATE:
  lib/analytics/events.ts — server-side event logger
  lib/analytics/client.ts — client-side tracking hook
  lib/analytics/aggregation.ts — daily aggregation logic
  lib/analytics/types.ts — event type definitions
  app/api/analytics/events/route.ts — client event ingestion endpoint
  lib/migrations/0XX-learning-loop.sql

MODIFY:
  app/api/cron/daily-maintenance/route.ts — add aggregation step
  lib/search/ — add performance-based ranking
  components/ — add tracking to search results, creator cards, booking flow
```

## Dependencies
- `platform_events` table (exists)
- TASK-046 (creator knowledge graph) — learning signals improve graph quality
- Sufficient booking volume (~100+ bookings before patterns emerge)

## Acceptance Criteria
- [ ] Events logged for all key interactions (search, click, book, review)
- [ ] Daily aggregation cron computes creator performance metrics
- [ ] Search results incorporate performance-based ranking
- [ ] Client-side tracking fires without impacting page performance
- [ ] No PII stored in client-side event payloads
- [ ] Event volume is monitorable (admin dashboard count)
- [ ] npm run build passes
- [ ] npm run test passes

## Effort Estimate
2 weeks foundation, then continuous refinement. Compounding starts after ~90 days of data.

## Priority
High — this is the engine that makes everything else (search, matching, pricing, recommendations) improve over time. But it needs transaction volume to be useful — ship after booking flow is well-trafficked.

## Risk Notes
- POPIA compliance: all event data must be anonymizable. Never store PII in event payloads.
- Start with simple heuristics (click-through rate boosting), not ML models. Graduate to models when data volume justifies it.
- Client-side tracking must not degrade Core Web Vitals — use `requestIdleCallback` or `sendBeacon`.
