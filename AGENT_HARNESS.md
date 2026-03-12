# AGENT_HARNESS.md — ThabangVision Labs
# Based on the Anthropic C Compiler Agent Pattern

## The Pattern

Anthropic's approach:
1. Human defines WHAT to build and HOW to verify it
2. Agents decide HOW to build it
3. Agents self-coordinate via shared Git repo
4. Lock files prevent conflicts
5. Test harness is the source of truth — not human review
6. Agents run in infinite loops: pick task → work → test → commit → pick next task

## Your Role (Thabang)

You are NOT writing code. You are:
1. Writing the test harness (what "correct" looks like)
2. Defining the task queue (what needs to be built)
3. Building the verification pipeline (CI that checks everything)
4. Reviewing results when agents get stuck

## Architecture

```
┌─────────────────────────────────────────────────┐
│                TASK QUEUE                        │
│  tasks/                                          │
│  ├── todo/          (unclaimed tasks)            │
│  ├── in-progress/   (agent working on it)        │
│  ├── done/          (completed + tested)         │
│  └── blocked/       (needs human input)          │
│                                                   │
│  Each task is a .md file with:                    │
│  - Description of what to build                   │
│  - Files that can be modified                     │
│  - Acceptance criteria (tests that must pass)     │
│  - Dependencies (which tasks must complete first) │
└─────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────┐
│              AGENT LOOP                          │
│                                                   │
│  while true:                                      │
│    1. git pull                                    │
│    2. Pick unclaimed task from tasks/todo/        │
│    3. Move task to tasks/in-progress/{agent-id}/  │
│    4. Read task requirements                      │
│    5. Do the work (only modify allowed files)     │
│    6. Run tests specific to this task             │
│    7. If tests pass:                              │
│       - git commit + push                         │
│       - Move task to tasks/done/                  │
│    8. If tests fail:                              │
│       - Fix and retry (max 3 attempts)            │
│       - If still failing: move to tasks/blocked/  │
│    9. Pick next task                              │
│                                                   │
│  Agents coordinate via git:                       │
│  - Lock file = tasks/in-progress/{agent-id}/task  │
│  - If merge conflict: git pull, retry             │
│  - No direct agent-to-agent communication         │
└─────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────┐
│            VERIFICATION PIPELINE                  │
│                                                   │
│  On every commit:                                 │
│  1. npm run build          (compiles?)            │
│  2. npm run test           (unit tests pass?)     │
│  3. npm run test:e2e       (e2e tests pass?)      │
│  4. Abstraction check      (no direct SDK?)       │
│  5. Constants check        (no hardcoded values?) │
│  6. Security check         (auth on all routes?)  │
│  7. Type check             (npx tsc --noEmit)     │
│                                                   │
│  If ANY check fails: commit is rejected           │
│  Agent must fix before proceeding                 │
└─────────────────────────────────────────────────┘
```

## Task File Format

Each task in tasks/todo/ looks like:

```markdown
# TASK-001: Security - Admin Route Authentication

## Priority: CRITICAL
## Phase: V2
## Depends on: none
## Estimated effort: 30 minutes

## Description
Add authentication and admin role verification to all /api/admin/* routes.

## Files allowed to modify
- app/api/admin/**/*.ts
- middleware.ts
- lib/auth/admin.ts (create if needed)

## Files NOT allowed to modify
- lib/constants.ts
- app/(platform)/**
- components/**

## Acceptance criteria
- [ ] All /api/admin/* routes check for valid session
- [ ] All /api/admin/* routes check email against ADMIN_EMAILS
- [ ] Unauthenticated request to /api/admin/verifications returns 401
- [ ] Non-admin authenticated request returns 403
- [ ] Admin authenticated request returns 200
- [ ] npm run build passes
- [ ] npm run test passes

## Verification commands
```bash
# These commands must all succeed
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/admin/verifications
# Expected: 401

# With non-admin cookie:
curl -s -o /dev/null -w "%{http_code}" -H "Cookie: session=non-admin" http://localhost:3000/api/admin/verifications
# Expected: 403
```
```

## Complete Task Queue

### V2 — Architecture (Sessions 1-4)

TASK-001: Security - Middleware verification [CRITICAL]
TASK-002: Security - Admin route authentication [CRITICAL]
TASK-003: Security - Admin role verification [CRITICAL]
TASK-004: Security - Cloudinary route auth [CRITICAL]
TASK-005: Security - Ubunye chat auth + rate limiting [HIGH]
TASK-006: Security - Search input sanitization [HIGH]
TASK-007: Security - Social link XSS prevention [HIGH]
TASK-008: Abstraction - AI provider layer [FEATURE]
TASK-009: Abstraction - Payment provider layer [FEATURE]
TASK-010: Abstraction - Storage provider layer [FEATURE]
TASK-011: Abstraction - Email provider layer [FEATURE]
TASK-012: Abstraction - Search provider layer [FEATURE]
TASK-013: UI - Mobile navigation rebuild [FEATURE]
TASK-014: UI - Dark mode lock [FEATURE]
TASK-015: UI - Font optimization (next/font) [FEATURE]
TASK-016: UI - Touch target compliance [FEATURE]

### V3 — Intelligence (Sessions 5-8)

TASK-017: Ubunye - System prompt builder [FEATURE]
  Depends on: TASK-008
TASK-018: Ubunye - Streaming responses [FEATURE]
  Depends on: TASK-017
TASK-019: Ubunye - Markdown rendering [FEATURE]
  Depends on: TASK-018
TASK-020: Ubunye - Message limits [FEATURE]
  Depends on: TASK-018
TASK-021: RAG - Embedding pipeline [FEATURE]
TASK-022: RAG - Indexer [FEATURE]
  Depends on: TASK-021
TASK-023: RAG - Retrieval function [FEATURE]
  Depends on: TASK-021
TASK-024: RAG - Admin reindex route [FEATURE]
  Depends on: TASK-022
TASK-025: RAG - Auto-index on content change [FEATURE]
  Depends on: TASK-022
TASK-026: Productions - Photography/Film divisions [FEATURE]
TASK-027: Productions - Package pricing [FEATURE]
TASK-028: Productions - Brief submission form [FEATURE]
TASK-029: Productions - Gear cross-sell [FEATURE]
TASK-030: Marketplace - Database migration [FEATURE]
TASK-031: Marketplace - Ranking algorithm [FEATURE]
  Depends on: TASK-030
TASK-032: Marketplace - Unified listing display [FEATURE]
  Depends on: TASK-031
TASK-033: Marketplace - Creator listing flow [FEATURE]
  Depends on: TASK-030

### V4 — Actions (Future)

TASK-034: Function calling - Equipment search tool [FEATURE]
  Depends on: TASK-008, TASK-017
TASK-035: Function calling - Availability check tool [FEATURE]
  Depends on: TASK-034
TASK-036: Function calling - Booking creation tool [FEATURE]
  Depends on: TASK-035
TASK-037: Function calling - Quote generation tool [FEATURE]
  Depends on: TASK-017
TASK-038: PDF - Quote template (pdfkit) [FEATURE]
  Depends on: TASK-037
TASK-039: PDF - Generation API route [FEATURE]
  Depends on: TASK-038
TASK-040: Multi-model - Router (Gemini classify, Claude reason) [FEATURE]
  Depends on: TASK-008
TASK-041: Multi-model - Cost tracking [FEATURE]
  Depends on: TASK-040
TASK-042: WhatsApp - Webhook handler [FEATURE]
TASK-043: WhatsApp - Message processing [FEATURE]
  Depends on: TASK-042, TASK-017
TASK-044: Cron - Daily ranking recalculation [FEATURE]
  Depends on: TASK-031
TASK-045: Cron - Overdue rental alerts [FEATURE]

### V5 — Platform (Big Future)

TASK-046: Multi-tenant - Studio schema isolation [FEATURE]
TASK-047: Multi-tenant - White-label theming [FEATURE]
  Depends on: TASK-046
TASK-048: Business Intelligence - Revenue analytics [FEATURE]
TASK-049: Business Intelligence - Ubunye weekly report [FEATURE]
  Depends on: TASK-048
TASK-050: Council - Multi-LLM deliberation [FEATURE]
  Depends on: TASK-040

## How to Run Agent Teams with This System

### Session prompt template:

```
Read CLAUDE.md for project rules.
Read MEMORY.md for session history.
Read AGENT_HARNESS.md for the task system.

Pick up these tasks from the queue:
- TASK-XXX
- TASK-YYY
- TASK-ZZZ

Create agent team:

Teammate "agent-name":
  Tasks: TASK-XXX
  Files owned: [list from task file]
  Acceptance: [criteria from task file]

Teammate "agent-name-2":
  Tasks: TASK-YYY
  Files owned: [list from task file]
  Acceptance: [criteria from task file]

Rules:
- Each agent ONLY modifies files listed in their task
- If a task depends on another task, wait for it to complete
- Run npm run build and npm run test after each task
- If tests fail, fix your code — don't modify the tests
- Commit each completed task separately with message: "feat: TASK-XXX description"
- Update MEMORY.md when done

After all tasks complete:
- Run full verification: build, test, type check
- Report which tasks completed and which are blocked
```

## Scaling This System

Phase 1-2 (now): You run 2-3 agents per session manually
Phase 3: You run 4-6 agents per session, tasks get more complex
Phase 4: You set up the infinite loop — agents run continuously
Phase 5: You hire humans who follow the same task system

The task queue, verification pipeline, and file ownership rules
work identically whether the worker is a Claude agent or a human.
That's the whole point.
