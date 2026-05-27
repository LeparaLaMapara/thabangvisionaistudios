# TASK-050: Supply-Side Automation — Consent-Based Creator Discovery & Frictionless Onboarding

## Status: Todo

## Summary
Build an AI pipeline that identifies prospective SA creators from public platforms, ranks them by likely platform value, drafts personalized invitations, and provides one-click onboarding with a pre-populated profile. All external data access is consent-first and POPIA-compliant.

## Why
Creator supply currently grows organically — creators find the platform and sign up. This is slow and uncontrolled. An automated supply pipeline lets you grow from 50 to 500 to 5,000 creators intentionally, prioritizing high-value creators who fill gaps in the current roster. No sales team needed.

## Architecture

### Pipeline Stages
```
DISCOVER → RANK → INVITE → ONBOARD
```

| Stage | Description |
|-------|-------------|
| **DISCOVER** | Admin submits public profile URLs or search queries. AI extracts creator info. |
| **RANK** | Score prospects by: style gap fill, location demand, portfolio quality, engagement |
| **INVITE** | AI drafts personalized invitation email with compelling data points |
| **ONBOARD** | Invited creator clicks link → pre-populated profile → one-click signup |

### POPIA Compliance (Critical)
- **No scraping without consent.** The system does NOT autonomously crawl social media.
- **Admin-initiated discovery:** Admin pastes a public profile URL → AI extracts publicly visible info.
- **Invitation = consent request:** The email is the first contact. Creator must opt-in by clicking the invite link.
- **Pre-populated data is discarded** if the creator doesn't sign up within 30 days.
- **No data stored until consent:** Prospect data lives in a temporary `creator_prospects` table with auto-expiry.

## Implementation Plan

### 1. Prospect Intake (`app/api/admin/prospects/route.ts`)
- Admin submits: public profile URL (Instagram, Behance, personal website)
- AI analyzes the public page and extracts: name, location, creative categories, sample work descriptions
- No images are stored — only text metadata from publicly visible content
- Admin-only route with `requireAdmin()`

### 2. Prospect Analysis Agent (`lib/agents/agents/prospect-analyzer.ts`)
- Register `prospect-analyzer` agent in registry (use Gemma 4 for cost efficiency)
- Input: public profile URL content (fetched via server-side fetch)
- Output: `{ name, location, categories[], qualityTier, styleDescription, gapFillScore }`
- Gap fill score: how much this creator's style/location fills an underserved niche (from TASK-046 graph)

### 3. Ranking Model (`lib/supply/ranking.ts`)
- Score = weighted sum of:
  - Gap fill (does this style/location combo have few existing creators?) — 40%
  - Portfolio quality signal (engagement, presentation) — 25%
  - Location demand (are there unfilled booking requests in their area?) — 20%
  - Category demand (are their services in high demand?) — 15%
- Return sorted prospect list with scores and reasoning

### 4. Invitation Generator (`lib/supply/invitation.ts`)
- AI drafts personalized email using prospect data + platform stats
- Template: "We noticed your [category] work in [location]. We have [N] active inquiries this month we can route to you."
- Include: platform value prop, creator success stats, one-click signup link
- Email sent via existing email provider abstraction

### 5. One-Click Onboarding
- Invite link includes a signed token with prospect ID
- Landing page: pre-populated profile with extracted data
- Creator reviews, edits, and confirms → account created
- Skips standard onboarding steps that are already filled in
- If not claimed within 30 days, prospect record auto-deleted

### 6. Database
```sql
CREATE TABLE IF NOT EXISTS creator_prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url TEXT NOT NULL,
  extracted_data JSONB NOT NULL, -- name, location, categories, style
  gap_fill_score NUMERIC(4,2),
  ranking_factors JSONB,
  invitation_status TEXT DEFAULT 'pending'
    CHECK (invitation_status IN ('pending','invited','claimed','expired')),
  invitation_sent_at TIMESTAMPTZ,
  invite_token TEXT UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-cleanup expired prospects
-- (handled in daily-maintenance cron)
```

### 7. Admin UI (`app/(admin)/admin/prospects/`)
- Prospect list with ranking scores
- "Analyze URL" input for adding new prospects
- "Send Invitation" button per prospect
- Status tracking: pending → invited → claimed/expired
- Bulk operations for efficiency

## Files to Create/Modify
```
CREATE:
  lib/supply/ranking.ts
  lib/supply/invitation.ts
  lib/supply/types.ts
  lib/agents/agents/prospect-analyzer.ts
  app/api/admin/prospects/route.ts
  app/(admin)/admin/prospects/page.tsx
  app/(admin)/admin/prospects/ProspectsAdmin.tsx
  app/(admin)/admin/prospects/actions.ts
  app/api/invite/[token]/route.ts — invite claim endpoint
  lib/migrations/0XX-creator-prospects.sql

MODIFY:
  lib/agents/registry.ts — register prospect-analyzer agent
  components/admin/AdminNav.tsx — add Prospects link
  app/api/cron/daily-maintenance/route.ts — expire old prospects
```

## Dependencies
- TASK-046 (creator graph) — gap fill scoring requires existing creator embeddings
- Email provider (exists)
- Admin auth (exists)

## Acceptance Criteria
- [ ] Admin can submit a public URL and get structured prospect data back
- [ ] Prospects are ranked by gap fill, quality, and demand alignment
- [ ] Personalized invitation emails are generated with platform stats
- [ ] Invite link leads to pre-populated signup flow
- [ ] Prospect data auto-expires after 30 days if unclaimed
- [ ] No data stored without explicit admin action (no autonomous crawling)
- [ ] All AI calls wrapped in trackedCompletion()
- [ ] npm run build passes
- [ ] npm run test passes

## Effort Estimate
3-4 weeks

## Priority
Medium — high impact for supply growth, but requires TASK-046 (creator graph) for gap fill scoring. Can start with manual ranking (no graph dependency) and add gap fill later.

## Risk Notes
- **POPIA is non-negotiable.** Never store personal data without a legal basis. Admin-initiated + invitation-as-consent-request is the safest pattern.
- Rate limit prospect analysis to prevent abuse (max 20 per day)
- Invitation emails must include opt-out / "how did you get my info" explanation
- Don't pre-populate with any information the creator hasn't made publicly visible
