# TASK-053: Intelligence-as-a-Product — SA Creative Economy Data & Insights (B2B Revenue)

## Status: Todo

## Summary
Package ThabangVision's anonymized marketplace data (pricing trends, demand patterns, gear utilization, style trends, geographic distribution) into a B2B product: "ThabangVision Insights." Quarterly reports, API access, and custom analytics for brands, production companies, and casting agencies.

## Why
ThabangVision collects data nobody else has — SA creative economy pricing, demand patterns, gear usage, booking cycles, creator supply distribution. This data is itself a product with near-100% margins and a completely different customer profile (enterprise, recurring, low churn) from the marketplace. It diversifies revenue beyond transaction fees.

## Architecture

### Data Products
| Product | Audience | Format |
|---------|----------|--------|
| Quarterly SA Creative Economy Report | Everyone (free/gated) | PDF + web page |
| Pricing Benchmark API | Production companies | REST API, subscription |
| Talent Supply Map | Casting agencies, brands | Interactive dashboard |
| Demand Forecasting | Equipment rental companies | API + reports |
| Custom Analytics | Enterprise clients | On-demand analysis |

### Anonymization Requirements (POPIA Critical)
- No individual creator or client data exposed
- Minimum aggregation: 5+ data points per bucket (k-anonymity)
- Geographic granularity: city level max (no neighborhood-level data)
- Pricing data: ranges and percentiles only, never individual rates
- Time granularity: monthly minimum (no daily patterns that could identify individuals)

### Data Pipeline
```
Supabase operational DB → Daily ETL → Analytics tables → Aggregation → Reports/API
```

## Implementation Plan

### 1. Analytics Data Layer (`lib/insights/etl.ts`)
- Daily cron job extracts and anonymizes operational data
- Store in dedicated analytics tables (separate from operational)
- Aggregation by: service_type × location × month
- Enforce k-anonymity: suppress buckets with <5 data points

### 2. Analytics Tables
```sql
CREATE TABLE IF NOT EXISTS insights_pricing_trends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period DATE NOT NULL, -- first of month
  service_type TEXT NOT NULL,
  location TEXT NOT NULL, -- city level
  sample_size INTEGER NOT NULL,
  rate_p25 INTEGER, -- ZAR cents
  rate_p50 INTEGER,
  rate_p75 INTEGER,
  booking_volume INTEGER,
  avg_rating NUMERIC(3,2),
  computed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(period, service_type, location)
);

CREATE TABLE IF NOT EXISTS insights_demand_trends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period DATE NOT NULL,
  service_type TEXT NOT NULL,
  location TEXT NOT NULL,
  search_volume INTEGER,
  booking_volume INTEGER,
  conversion_rate NUMERIC(5,4),
  avg_lead_time_days INTEGER, -- how far ahead clients book
  computed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(period, service_type, location)
);

CREATE TABLE IF NOT EXISTS insights_supply_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period DATE NOT NULL,
  service_type TEXT NOT NULL,
  location TEXT NOT NULL,
  active_creators INTEGER,
  new_creators INTEGER,
  avg_response_time_hours NUMERIC(5,1),
  computed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(period, service_type, location)
);
```

### 3. Report Generator (`lib/insights/reports.ts`)
- Quarterly report template pulling from analytics tables
- AI-generated narrative summaries of trends (Claude for quality)
- PDF generation using existing `lib/pdf/` infrastructure
- Sections: market overview, pricing trends, demand shifts, supply changes, category breakdowns

### 4. Public Insights Page (`app/(marketing)/insights/`)
- Teaser version of the quarterly report (free, SEO value)
- Key statistics, trend charts, and AI-generated commentary
- CTA: "Get the full report" → email capture or subscription
- Updated quarterly

### 5. Insights API (Phase 2, when volume justifies)
- REST API with subscription-based access
- Endpoints: `/api/insights/pricing`, `/api/insights/demand`, `/api/insights/supply`
- API key auth + usage tracking
- Rate limited by subscription tier

### 6. Admin Dashboard
- Insights data health: row counts, latest computation, suppressed buckets
- Report preview and publish workflow
- Subscription management (Phase 2)

## Files to Create/Modify
```
CREATE:
  lib/insights/etl.ts — daily extraction + anonymization
  lib/insights/reports.ts — quarterly report generation
  lib/insights/types.ts
  app/(marketing)/insights/page.tsx — public insights page
  app/api/admin/insights/generate-report/route.ts
  lib/migrations/0XX-insights-tables.sql

MODIFY:
  app/api/cron/daily-maintenance/route.ts — add ETL step
  lib/pdf/ — report PDF template
```

## Dependencies
- Sufficient booking volume (~500+ bookings for meaningful city-level aggregations)
- TASK-047 (learning loop) — event data feeds into demand/supply metrics
- TASK-048 (pricing intelligence) — pricing benchmarks can be re-used

## Acceptance Criteria
- [ ] Daily ETL populates analytics tables from operational data
- [ ] k-anonymity enforced: no bucket with fewer than 5 data points
- [ ] Quarterly report generates with AI narrative summaries
- [ ] Public insights page displays key market statistics
- [ ] No individual creator or client data is identifiable in any output
- [ ] npm run build passes

## Effort Estimate
6-8 weeks total. Phase 1 (ETL + public page + quarterly report): 3-4 weeks. Phase 2 (API + subscriptions): 3-4 weeks.

## Priority
Low — requires 18+ months of transaction data before the insights are credible. Build the ETL pipeline early (it just accumulates data silently), but don't launch the public product until data volume is meaningful. The free public insights page can launch sooner as an SEO asset.

## Risk Notes
- **Anonymization is non-negotiable.** A data leak that exposes individual pricing would destroy creator trust.
- k-anonymity with k=5 is a minimum. For sensitive data (pricing), consider k=10.
- AI-generated report narratives must be reviewed before publishing — hallucinated trends are worse than no report.
- Revenue projections for this product should be conservative. It's a long-term play, not a quick win.
- Start collecting data NOW even if you don't publish for 18 months. The ETL pipeline is cheap to run.
