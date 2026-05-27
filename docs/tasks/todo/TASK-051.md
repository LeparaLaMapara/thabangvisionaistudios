# TASK-051: Demand Generation Engine — Multi-Source Signal Detection & Automated Outreach

## Status: Todo

## Summary
Build a demand intelligence pipeline that monitors public sources (SA business news, social media, event announcements) for signals of imminent creative work needs, identifies contacts, and drafts personalized outreach. This replaces advertising-dependent client acquisition with programmatic demand detection.

## Why
Currently ThabangVision relies on Google search + Instagram for client discovery. Both are expensive, competitive, and controlled by third parties. A demand signal pipeline finds clients at the moment of need — before they even start searching — and routes them to relevant creators. This is effectively a sales team in code.

## Architecture

### Signal Sources
| Source | Signal Type | Detection Method |
|--------|-------------|------------------|
| SA business news RSS | Product launches, openings, campaigns | Keyword + NLP classification |
| Google Alerts API | "looking for photographer/videographer" queries | Keyword monitoring |
| Public Instagram/LinkedIn | "need a photographer" posts | Hashtag + keyword search |
| Event venue calendars | Upcoming events that need coverage | Structured data extraction |
| Wedding announcement sites | Engagements → future wedding photography need | Public listing monitoring |
| Job boards | "freelance photographer" listings | Keyword matching |

### Pipeline
```
Signal Sources → Ingestion → Intent Classification → Contact Enrichment → Outreach Draft → Admin Review → Send
```

### Key Principle
All outreach is **admin-reviewed before sending**. The AI drafts and ranks — a human approves and sends. This prevents spam, maintains brand quality, and keeps POPIA compliance.

## Implementation Plan

### 1. Signal Ingestion (`lib/demand/ingestion.ts`)
- RSS feed parser for SA news sources (configurable list)
- Google Alerts webhook handler (or polling)
- Each signal: `{ source, url, title, excerpt, detectedAt, rawContent }`
- Store in `demand_signals` table

### 2. Intent Classifier (`lib/demand/classifier.ts`)
- AI agent classifies each signal: `{ hasCreativeNeed: boolean, confidence: number, projectType, urgency, location }`
- Filter: only signals with `confidence > 0.7` proceed
- Use Gemini Flash for cost efficiency (high volume, simple classification)
- Register `demand-classifier` agent

### 3. Contact Enrichment (Phase 2)
- For classified signals, extract or look up contact information
- Only from publicly available business directories or the signal source itself
- No scraping personal social media for contact info
- Store as `demand_prospects`

### 4. Outreach Drafting (`lib/demand/outreach.ts`)
- AI drafts personalized message based on:
  - The detected need
  - Matching creators on the platform
  - Relevant pricing and availability
- Template: "We noticed [signal]. We have [N] [category] creators available in [location], starting from R[price]."
- Draft stored for admin review

### 5. Admin Review UI (`app/(admin)/admin/demand/`)
- Signal feed: new signals with classification scores
- Outreach queue: drafted messages awaiting approval
- One-click approve/edit/reject per draft
- Conversion tracking: which outreach led to signups/bookings

### 6. Automated Inbound Enhancement
- When demand signals are detected for a category/location, boost those creators in search rankings temporarily
- Pre-generate landing page content targeting detected demand ("Wedding photographers in [location] available [date range]")
- Feed demand signals into Ubunye context so it can proactively mention availability

### 7. Database
```sql
CREATE TABLE IF NOT EXISTS demand_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  source_url TEXT,
  title TEXT,
  excerpt TEXT,
  raw_content TEXT,
  classification JSONB, -- { hasCreativeNeed, confidence, projectType, urgency, location }
  status TEXT DEFAULT 'new' CHECK (status IN ('new','classified','actioned','dismissed')),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS demand_outreach (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID REFERENCES demand_signals(id),
  prospect_name TEXT,
  prospect_contact TEXT,
  draft_message TEXT NOT NULL,
  matched_creators UUID[], -- creator IDs suggested
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','approved','sent','converted','rejected')),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Files to Create/Modify
```
CREATE:
  lib/demand/ingestion.ts — signal source parsers
  lib/demand/classifier.ts — AI intent classification
  lib/demand/outreach.ts — outreach draft generation
  lib/demand/types.ts
  app/(admin)/admin/demand/page.tsx
  app/(admin)/admin/demand/DemandAdmin.tsx
  app/(admin)/admin/demand/actions.ts
  app/api/admin/demand/route.ts
  lib/migrations/0XX-demand-signals.sql

MODIFY:
  lib/agents/registry.ts — register demand-classifier agent
  components/admin/AdminNav.tsx — add Demand link
  app/api/cron/daily-maintenance/route.ts — daily signal ingestion step
```

## Dependencies
- Existing outreach admin UI (from Sprint C — `app/(admin)/admin/outreach/`)
- Email provider (exists)
- TASK-046 (creator graph) — for matching signals to creators
- RSS feed sources (need to curate list of SA news/event sources)

## Acceptance Criteria
- [ ] RSS feed ingestion parses at least 3 SA news sources
- [ ] Intent classifier filters signals with >0.7 confidence
- [ ] Outreach drafts are personalized and reference platform stats
- [ ] Admin can review, edit, approve, or reject drafts
- [ ] Conversion tracking links outreach to eventual signups/bookings
- [ ] All outreach is admin-approved before sending (never auto-send)
- [ ] Signal ingestion runs daily via cron without hitting rate limits
- [ ] npm run build passes

## Effort Estimate
4-6 weeks

## Priority
Medium — high strategic value but requires curating signal sources and building classification accuracy over time. Start with 2-3 RSS feeds and expand.

## Risk Notes
- **Never auto-send outreach.** All messages must be admin-reviewed. Unsolicited commercial email without review is a brand and legal risk.
- POPIA: outreach to businesses (not individuals) is lower risk, but still include opt-out.
- Start with business-to-business signals (product launches, events) not personal signals (engagement announcements).
- Signal source quality matters more than quantity — 3 good RSS feeds beat 30 noisy ones.
- The existing outreach admin page (from Sprint C) handles cold outreach to known prospects. This task handles signal-driven discovery of NEW prospects.
