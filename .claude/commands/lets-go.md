Autonomous development command. Figure out what to build next and do it.

## Step 1 — Assess Current State

Run these checks (in parallel where possible):

1. `git branch --show-current` and `git log --oneline -3`
2. `npm run build` — must pass before any work
3. `npm run test` — note passing/failing count
4. Read `docs/strategy.md` section "Platform Evolution — The Autonomy Roadmap"
5. List files in `docs/tasks/todo/` — these are pending tasks
6. List files in `docs/tasks/done/` — count completed tasks

## Step 2 — Determine Strategy Level

Cross-reference what's built against the strategy levels:

```
LEVEL 1 — AWARE (V3):
  ✓ Live website on Vercel
  ✓ Auth (Google, email + password)
  ✓ Smart Rentals (gear listings)
  ✓ Ubunye Chat (AI assistant)
  ✓ Admin panel
  ✓ Brand identity
  ✓ Email routing
  ✓ Security hardening
  ✓ Company registered
  ? Payment processing (Paystack) — check if /api/webhooks/paystack handles Paystack
  ? Booking system — check if /book page and booking API routes exist
  ? Smart Productions service catalogue — check if production_categories table exists
  ? Customers — check if real bookings exist in database

LEVEL 2 — ALERTING (V3.5 — launch):
  ? Cron jobs — check if /api/cron/ routes exist
  ? Health checks — check if hourly-checks route exists
  ? Weekly reports — check if weekly-reports route exists
  ? AI budget alerts — check if budget tracking exists
  ? Order alerts — check if notification system works
```

Verify each "?" by checking if the relevant code/routes/tables exist. Report:
- Current level: "Level X — [name] (V[version])"
- Completion: "X/Y items done for current level"
- Blocking items: what's missing for the NEXT level

## Step 3 — Pick Next Work (Priority Order)

Follow this priority chain strictly. Always pick the HIGHEST priority item that isn't done:

```
PRIORITY 1 — FIX BROKEN (blocks everything)
  Check: Does the build pass? Do tests pass?
  Check: Are there critical bugs in docs/tasks/todo/ (look for "bug", "fix", "broken")?
  If yes → fix these first before any new features.
  Relevant tasks: TASK-43 (landing page fixes), any build/test failures

PRIORITY 2 — LANDING PAGE & FIRST IMPRESSION (blocks user acquisition)
  Check: Is the home page restructured and professional?
  Check: Are navigation labels clear?
  Check: Are broken UI elements fixed?
  Relevant tasks: TASK-42 (home restructure), TASK-43 (16 fixes)

PRIORITY 3 — PAYMENT & BOOKING SYSTEM (blocks revenue)
  Check: Can a client select a package, pay via Paystack inline, and get a confirmed order?
  Check: Does the webhook handle charge.success?
  Check: Can a creator deliver work and get paid automatically?
  Design docs: docs/processes/client-payment-process.md, docs/processes/creator-payout-process.md
  This is the core revenue engine. Without it, the platform can't make money.

PRIORITY 4 — ONBOARDING & PROFILES (blocks creator/client readiness)
  Check: Does onboarding collect required fields (name, address, photo)?
  Check: Can creators add bank details for payouts?
  Relevant tasks: TASK-039 (onboarding redesign)

PRIORITY 5 — SMART PRODUCTIONS CATALOGUE (blocks service showcase)
  Check: Do production categories exist in the database?
  Check: Can admin create/manage categories and link productions?
  Design doc: docs/processes/smart-productions.md

PRIORITY 6 — CRON JOBS & AUTOMATION (blocks Level 2 / V3.5)
  Check: Do /api/cron/ routes exist?
  Check: Is vercel.json configured with cron schedules?
  Design doc: docs/processes/ai-platform-architecture.md (Layer 1 — Cron Jobs)

PRIORITY 7 — DATA ENGINE (blocks analytics & intelligence)
  Check: Does platform_events table exist?
  Check: Does logEvent() function exist?
  Design doc: docs/processes/platform-data-engine.md

PRIORITY 8 — UX ENHANCEMENTS (nice to have, not blocking)
  TASK-035 (Ask Ubunye button), TASK-41 (hero video), TASK-034 (voice mode)
  Only work on these if priorities 1-7 are complete.
```

## Step 4 — Report Plan Before Executing

Before writing any code, report:

```
STRATEGY LEVEL: Level [X] — [name] ([version])
COMPLETION: [X/Y] items for current level
NEXT WORK: [Priority N] — [description]
SCOPE: [small/medium/large] — [estimated file count]
AGENT TEAMS: [which teams will be used and why]
APPROACH: [bullet points of what will be built]
RISKS: [what could break, how to mitigate]
```

Wait for user confirmation ("go" or similar) before executing. If user says nothing or confirms, proceed.

## Step 5 — Execute With Agent Teams

Follow the routing rules from CLAUDE.md Agent Teams section:
- < 3 files → work solo
- 3-6 files → research + qa teams
- 7+ files → research + build + qa teams

For each piece of work:
1. Research team reads relevant process docs + checks existing code
2. Build team works in isolated worktrees if scope is large
3. QA team runs build + tests + checks in background
4. Coordinator merges and verifies

## Step 6 — Verify & Update

After completing work:
1. Run `npm run build` — must pass
2. Run `npm run test` — must pass
3. Run `/check-constants` — no hardcoded values
4. Run `/verify-abstractions` — no direct SDK imports
5. If a task from docs/tasks/todo/ was completed, move it to docs/tasks/done/
6. Report what was done and what the next priority is

## Rules

- NEVER skip a priority level. Fix broken things before building new things.
- NEVER break existing functionality. QA team catches regressions.
- ALWAYS read the relevant process doc before building a feature from it.
- ALWAYS use constants from lib/constants.ts for business values.
- ALWAYS use provider abstractions from lib/ — never import SDKs directly.
- If a task is too large for one session, break it into phases and complete phase 1.
- If something is blocked (e.g., needs Supabase migration run manually), report it and move to the next unblocked priority.
