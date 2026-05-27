# TASK-049: Project Intelligence — AI-Managed Booking Lifecycle

## Status: Todo

## Summary
Transform bookings from single transactions into AI-managed project workflows with phases (pre-shoot, during, post-shoot, follow-up). An AI project agent monitors each booking's lifecycle, proactively handles logistics, flags concerns, and prompts actions at the right time — replacing what agencies do with account managers.

## Why
Bookings currently end at payment confirmation. Everything after (logistics coordination, deliverable handoff, review collection, repeat booking) is manual or doesn't happen at all. Project intelligence reduces operational burden as bookings scale, improves client satisfaction through proactive communication, and increases repeat business through timely follow-up.

## Architecture

### Booking Lifecycle Phases

```
BOOKED → PRE_SHOOT → IN_PROGRESS → POST_SHOOT → COMPLETED → FOLLOW_UP
```

| Phase | AI Actions |
|-------|------------|
| **BOOKED** | Send confirmation, generate brief from booking details |
| **PRE_SHOOT** | T-48h: send gear checklist to creator, confirm location, check weather |
| **IN_PROGRESS** | Monitor communication, flag if client/creator unresponsive |
| **POST_SHOOT** | Generate deliverable checklist, monitor handoff, prompt review at T+3d |
| **COMPLETED** | Archive, update creator stats, feed into learning loop |
| **FOLLOW_UP** | T+30d: suggest repeat booking, identify upsell (e.g., "want the photos edited?") |

### State Machine
- Each booking has a `lifecycle_phase` column
- Phase transitions triggered by: time (cron), events (payment confirmed, review submitted), or manual override
- Each transition can trigger AI actions (notifications, content generation, flag raising)

## Implementation Plan

### 1. Lifecycle State Machine (`lib/bookings/lifecycle.ts`)
- Define phase enum and valid transitions
- `advancePhase(bookingId)` — check conditions, transition, trigger actions
- `getPhaseActions(phase, booking)` — return list of actions for current phase
- Phase conditions: time-based (T-48h before shoot date) + event-based (payment confirmed)

### 2. Action Handlers (`lib/bookings/actions/`)
- `sendBriefToCreator(booking)` — AI-generated brief from booking details
- `sendGearChecklist(booking)` — based on project type + creator's gear
- `sendReviewPrompt(booking)` — T+3d after completion
- `suggestRepeatBooking(booking)` — T+30d, based on client history
- `flagUnresponsive(booking)` — if no communication in 24h during active phase
- All actions use existing notification system + email provider

### 3. Project Agent (`lib/agents/agents/project.ts`)
- Register `project` agent in registry
- Responsibilities: generate briefs, draft logistics messages, create checklists
- Uses booking data + creator profile + project type for context
- Wrapped in `trackedCompletion()` per CLAUDE.md rules

### 4. Cron Integration (extend `daily-maintenance`)
- New step: scan bookings approaching phase transitions
- T-48h before shoot: advance to PRE_SHOOT, trigger prep actions
- T+1d after shoot date: advance to POST_SHOOT
- T+3d after completion: send review prompt
- T+30d after completion: send follow-up suggestion

### 5. Database Changes
```sql
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS
  lifecycle_phase TEXT DEFAULT 'booked'
  CHECK (lifecycle_phase IN ('booked','pre_shoot','in_progress','post_shoot','completed','follow_up'));

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS
  lifecycle_updated_at TIMESTAMPTZ DEFAULT now();

-- Track actions taken per booking
CREATE TABLE IF NOT EXISTS booking_lifecycle_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,
  action_type TEXT NOT NULL,
  action_data JSONB DEFAULT '{}',
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 6. Dashboard Integration
- Creator dashboard: upcoming shoot prep checklist, pending deliverables
- Client dashboard: project status timeline, expected next steps
- Admin: lifecycle overview, flagged bookings needing intervention

## Files to Create/Modify
```
CREATE:
  lib/bookings/lifecycle.ts — state machine + phase logic
  lib/bookings/actions/ — per-phase action handlers
  lib/agents/agents/project.ts — project intelligence agent
  lib/migrations/0XX-booking-lifecycle.sql

MODIFY:
  lib/agents/registry.ts — register project agent
  app/api/cron/daily-maintenance/route.ts — lifecycle transition step
  app/(platform)/dashboard/ — project status cards
```

## Dependencies
- Existing booking system (bookings + equipment_bookings tables)
- Notification system (exists)
- Email provider (exists)
- TASK-047 (learning loop) — lifecycle outcomes feed back into matching quality

## Acceptance Criteria
- [ ] Bookings track lifecycle phase with valid state transitions
- [ ] Pre-shoot actions fire T-48h before shoot date (gear checklist, confirmation)
- [ ] Post-shoot review prompt sends T+3d after completion
- [ ] Follow-up suggestion sends T+30d after completion
- [ ] Flagging system identifies unresponsive parties
- [ ] AI-generated brief is accurate and useful (manual review)
- [ ] All AI calls use trackedCompletion()
- [ ] npm run build passes
- [ ] npm run test passes

## Effort Estimate
4-6 weeks

## Priority
Medium-High — directly reduces operational burden and improves client experience. Can start with time-based triggers only (simplest implementation), add event-based triggers later.

## Risk Notes
- Notification fatigue: don't over-communicate. Each phase should have at most 2-3 touchpoints.
- Phase transitions must be idempotent — cron runs daily, so same booking shouldn't trigger same action twice. Use `booking_lifecycle_actions` as dedup log.
- Follow-up suggestions must respect opt-out preferences.
- Start with service bookings only (the `bookings` table), extend to equipment bookings later.
