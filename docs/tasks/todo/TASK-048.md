# TASK-048: AI Pricing Intelligence — Market-Aligned Rate Suggestions & Dynamic Pricing

## Status: Todo

## Summary
Build an AI-powered pricing layer that suggests rates to creators based on their style, location, demand, gear, and experience — and suggests budgets to clients based on what they want. Over time, this becomes a genuine product: "ThabangVision Price Intelligence."

## Why
Pricing in SA creative work is wildly inefficient. Photographers undercharge, clients overpay, and there's 5x price variance for identical work with no clear reason. A pricing intelligence layer brings transparency to both sides, increases booking conversion (fair prices = less hesitation), and positions ThabangVision as the pricing authority in SA creative work.

## Architecture

### Pricing Signals
| Signal | Source | Weight |
|--------|--------|--------|
| Creator's current rates | `PRODUCTION_SERVICES` + creator profile | Baseline |
| Similar creators' rates | Style cluster from TASK-046 | High |
| Booking conversion at price point | TASK-047 learning loop | Very High |
| Location demand | Booking history by area | Medium |
| Seasonal demand | Historical booking patterns | Medium |
| Creator experience/portfolio quality | Profile + reviews | Medium |
| Gear owned | Equipment bookings, profile | Low |
| Client budget signals | Search/inquiry data | Medium |

### Pricing Models
1. **Creator rate suggestion** — "Based on similar creators in your area, you could charge R X-Y per hour"
2. **Client budget guide** — "Wedding photography in Joburg typically costs R X-Y"
3. **Deal detection** — "This creator is priced 30% below their style cluster average"
4. **Dynamic pricing** — last-minute discounts, peak season premiums (Phase 2)

## Implementation Plan

### 1. Pricing Data Model (`lib/pricing/intelligence.ts`)
- `suggestCreatorRate(creatorId, serviceType)` — returns suggested rate range
- `suggestClientBudget(projectType, location, requirements)` — returns expected budget range
- `detectDeals(searchResults)` — flag underpriced creators relative to quality
- `getPricingTrends(serviceType, location, timeRange)` — market trends

### 2. Rate Suggestion Algorithm (Phase 1 — Heuristic)
- Find creator's style cluster (from TASK-046 embeddings)
- Get rates of all creators in the same cluster
- Compute percentile range (25th-75th)
- Adjust for location (Joburg premium vs. rural discount)
- Adjust for experience (review count, booking count)
- Return: `{ low, median, high, confidence, factors[] }`

### 3. Rate Suggestion Algorithm (Phase 2 — ML)
- Train k-nearest neighbors model on (creator_features → booking_rate → conversion_rate)
- Optimize for: rate that maximizes (booking_probability × rate)
- Retrain weekly from TASK-047 aggregated data

### 4. Integration Points
- **Creator dashboard** — "Rate insights" card showing suggested range vs. current rate
- **Ubunye booking flow** — when AI calculates quote, add context: "This is [below/at/above] market rate for this type of work"
- **Search results** — "Great value" badge on creators priced below cluster median
- **Rates agent** — enhance existing `rates` agent with market data context

### 5. Database
```sql
CREATE TABLE IF NOT EXISTS pricing_benchmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type TEXT NOT NULL,
  sub_type TEXT,
  location TEXT, -- city or region
  percentile_25 INTEGER NOT NULL, -- ZAR cents
  percentile_50 INTEGER NOT NULL,
  percentile_75 INTEGER NOT NULL,
  sample_size INTEGER NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(service_type, sub_type, location)
);
```

### 6. Aggregation Cron
- Weekly job: compute pricing benchmarks from booking data
- Group by service_type × location
- Store percentiles in `pricing_benchmarks`
- Flag creators whose rates deviate significantly from their cluster

## Files to Create/Modify
```
CREATE:
  lib/pricing/intelligence.ts — pricing suggestion logic
  lib/pricing/benchmarks.ts — benchmark computation
  lib/pricing/types.ts — pricing intelligence types
  lib/migrations/0XX-pricing-benchmarks.sql
  app/api/pricing/suggestions/route.ts — creator-facing rate suggestions

MODIFY:
  lib/agents/registry.ts — enhance rates agent with market data
  app/(platform)/dashboard/ — add rate insights card
  lib/ubunye/ — add pricing context to booking flow system prompt
```

## Dependencies
- TASK-046 (creator graph) — style clusters for peer comparison
- TASK-047 (learning loop) — conversion data by price point
- Sufficient booking volume (~200+ completed bookings for meaningful benchmarks)

## Acceptance Criteria
- [ ] Rate suggestions generated for creators with enough peer data
- [ ] Client budget guide returns reasonable ranges for common project types
- [ ] "Great value" detection identifies underpriced creators relative to quality
- [ ] Pricing benchmarks refresh weekly via cron
- [ ] Rates agent uses market data in suggestions
- [ ] No creator's actual rate is exposed to other creators (only anonymized benchmarks)
- [ ] npm run build passes
- [ ] npm run test passes

## Effort Estimate
3-4 weeks

## Priority
Medium — requires booking volume from TASK-047 to be meaningful. Start with heuristic (Phase 1) using PRODUCTION_SERVICES rates as baseline, graduate to data-driven when volume supports it.

## Risk Notes
- Never expose individual creator rates to other creators — only anonymized cluster statistics
- Price suggestions are advisory, never mandatory — creators set their own rates
- Dynamic pricing (Phase 2) needs careful UX to avoid perception of price manipulation
- Start with the existing `rates` agent as the delivery mechanism before building dedicated UI
