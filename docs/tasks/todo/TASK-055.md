# TASK-055: Dispute Prevention & AI Mediation

## Status: Todo

## Summary
Build a predictive dispute system that watches bookings for early warning signs, intervenes proactively to prevent disputes, and when disputes do occur, automates resolution with AI-generated analysis and recommendations. Reduce dispute resolution from weeks to hours.

## Why
Disputes are expensive operationally (admin time) and relationally (both parties may leave the platform). Most disputes are predictable — delayed responses, vague briefs, payment delays are all early warning signs. By intervening early, most disputes never happen. When they do, AI mediation dramatically reduces resolution time.

## Architecture

### Dispute Prevention Pipeline
```
Booking active → Monitor signals → Risk score → Threshold crossed → Intervention
```

### Warning Signals
| Signal | Weight | Detection |
|--------|--------|-----------|
| Client unresponsive >24h during active phase | High | Last message timestamp |
| Creator hasn't confirmed arrival T-12h | High | Lifecycle phase check |
| Brief is vague (<50 words, no specifics) | Medium | NLP analysis at booking |
| Payment delayed past due date | High | Payment status check |
| Multiple date/time changes | Medium | Booking modification log |
| Creator's first booking (no track record) | Low | Booking count check |
| Price significantly below market (potential quality risk) | Low | TASK-048 pricing data |
| Client has prior disputes | Medium | Dispute history |

### Risk Score
- Each booking gets a real-time risk score (0-100)
- Score = weighted sum of active warning signals
- Thresholds: <30 = normal, 30-60 = monitor, 60-80 = intervene, >80 = escalate to admin

### Intervention Actions
| Risk Level | Action |
|-----------|--------|
| 30-60 | Send gentle reminders to unresponsive party |
| 60-80 | AI sends clarifying questions, suggests brief improvements, prompts confirmation |
| >80 | Flag for admin review, offer to connect both parties via Ubunye mediation |

## Implementation Plan

### 1. Risk Scoring Engine (`lib/disputes/risk.ts`)
- `calculateBookingRisk(bookingId)` — evaluates all signals, returns score + factors
- Each signal has a detector function that returns (active: boolean, weight: number)
- Score updated every time relevant data changes (message sent, payment received, etc.)
- Cached in booking metadata, refreshed by cron

### 2. Signal Detectors (`lib/disputes/signals/`)
- `unresponsiveClient(booking)` — check last client message timestamp
- `vagueeBrief(booking)` — NLP analysis of booking description
- `paymentDelay(booking)` — compare payment due date vs. actual
- `firstTimeCreator(booking)` — check creator's booking count
- Each returns `{ active: boolean, severity: number, details: string }`

### 3. Intervention Engine (`lib/disputes/interventions.ts`)
- `checkAndIntervene(bookingId)` — evaluate risk, trigger appropriate action
- Low risk: no action
- Medium risk: send nudge notification
- High risk: AI-generated clarifying message via Ubunye
- Critical: flag for admin with AI summary of concerns

### 4. AI Mediation Agent (`lib/agents/agents/mediator.ts`)
- Register `mediator` agent in registry
- When dispute is filed: analyze both sides' messages, booking details, timeline
- Generate: `{ summary, likelyFault, suggestedResolution, fairnessScore, draftMessage }`
- Draft resolution message for admin review
- Admin approves/modifies before sending

### 5. Dispute Resolution Flow
```
Dispute filed → AI analysis → Resolution recommendation → Admin review → Resolution sent
```
- Track resolution time, outcome satisfaction, repeat disputes
- Feed outcomes back into risk model (TASK-047 learning loop)

### 6. Database
```sql
CREATE TABLE IF NOT EXISTS booking_risk_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  risk_score INTEGER NOT NULL DEFAULT 0,
  active_signals JSONB DEFAULT '[]',
  last_intervention TEXT, -- latest action taken
  last_computed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(booking_id)
);

CREATE TABLE IF NOT EXISTS dispute_resolutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id),
  filed_by UUID NOT NULL REFERENCES profiles(id),
  reason TEXT NOT NULL,
  ai_analysis JSONB, -- AI-generated analysis
  resolution TEXT,
  resolved_by UUID REFERENCES profiles(id), -- admin who resolved
  resolution_time_hours NUMERIC(6,1),
  outcome TEXT CHECK (outcome IN ('refund','partial_refund','no_refund','rebook','dismissed')),
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
```

### 7. Cron Integration
- Add to daily-maintenance: scan active bookings, update risk scores, trigger interventions
- Also integrates with TASK-049 (project intelligence) lifecycle phases

### 8. Admin UI
- Risk dashboard: bookings sorted by risk score, color-coded
- Dispute queue: pending disputes with AI analysis and recommended resolution
- One-click resolution with AI-drafted messages
- Historical stats: resolution time trends, common causes, prevention effectiveness

## Files to Create/Modify
```
CREATE:
  lib/disputes/risk.ts — risk scoring engine
  lib/disputes/signals/ — individual signal detectors
  lib/disputes/interventions.ts — intervention logic
  lib/disputes/types.ts
  lib/agents/agents/mediator.ts — AI mediation agent
  app/(admin)/admin/disputes/page.tsx
  app/(admin)/admin/disputes/DisputesAdmin.tsx
  lib/migrations/0XX-dispute-prevention.sql

MODIFY:
  lib/agents/registry.ts — register mediator agent
  app/api/cron/daily-maintenance/route.ts — risk scoring step
  components/admin/AdminNav.tsx — add Disputes link
```

## Dependencies
- TASK-049 (project intelligence) — lifecycle phases provide context for risk signals
- TASK-047 (learning loop) — dispute outcomes feed back into prediction
- Existing notification system (exists)
- Existing booking system (exists)

## Acceptance Criteria
- [ ] Risk scores computed for all active bookings
- [ ] Warning signals detected accurately (manual spot-check on test bookings)
- [ ] Interventions triggered at appropriate thresholds
- [ ] AI mediation generates reasonable analysis and recommendations
- [ ] Admin can review and approve/modify AI-recommended resolutions
- [ ] Resolution time tracked and measurable
- [ ] Interventions are not annoying (max 2 nudges per booking)
- [ ] All AI calls wrapped in trackedCompletion()
- [ ] npm run build passes

## Effort Estimate
4-6 weeks

## Priority
Medium — value increases with booking volume. At low volume, admin can handle disputes manually. Build the risk scoring engine first (passive monitoring), add AI mediation when volume justifies it.

## Risk Notes
- **AI mediation is advisory, never binding.** Admin always makes the final call.
- Intervention messages must not alarm users — "just checking in" tone, not "we detected a problem"
- Risk scores should not be visible to clients or creators — internal tool only
- False positives (flagging healthy bookings as risky) are worse than false negatives. Tune conservatively.
- Don't auto-resolve disputes. Even if AI confidence is high, a human must approve.
