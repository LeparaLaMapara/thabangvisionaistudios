# TASK-057: Autonomous Marketplace Operations — 24/7 AI Agent Orchestration

## Status: Todo

## Summary
Build an orchestrated multi-agent system where specialized AI agents handle marketplace operations autonomously 24/7 — listing quality, trust & safety, growth, retention, revenue optimization, and compliance monitoring. The platform operates itself; you supervise.

## Why
As the platform scales, operational tasks that are manageable at 50 creators become impossible at 500 or 5,000. Instead of hiring an operations team, build autonomous agents that handle routine operations, escalating to a human only when judgment is needed. This is the long-term architectural direction — not a single project but a framework that grows over time.

## Architecture

### Agent Roster
| Agent | Responsibility | Frequency | Escalation Threshold |
|-------|---------------|-----------|---------------------|
| **Listing Quality** | Improve listings, flag stale ones, suggest updates | Daily | Never (advisory only) |
| **Trust & Safety** | Content moderation, fraud detection, suspicious behavior | Real-time | Always (flag for admin) |
| **Growth** | Identify supply gaps, suggest demand sources, expansion opportunities | Weekly | Report to admin |
| **Retention** | Predict churn, intervene proactively, re-engagement campaigns | Weekly | High-risk creators/clients |
| **Revenue** | Identify upsell opportunities, surface at right moment | Per booking | Never (embedded in UX) |
| **Compliance** | POPIA monitoring, tax requirement changes, regulatory alerts | Monthly | Always (legal matters) |
| **Quality Assurance** | Review AI outputs across all agents, flag hallucinations | Daily | Anomalies detected |

### Orchestration Framework
```
Scheduler (cron) → Agent Queue → Agent Execution → Result Classification
  → Action (auto-execute if safe) OR Escalation (admin review required)
```

### Autonomy Levels
| Level | Description | Example |
|-------|-------------|---------|
| **L0 — Observe** | Agent monitors, logs observations, no action | Compliance: "new POPIA guideline detected" |
| **L1 — Suggest** | Agent recommends action, human decides | Listing quality: "suggest these improvements" |
| **L2 — Act + Report** | Agent takes action, reports afterwards | Retention: "sent re-engagement email" |
| **L3 — Autonomous** | Agent acts without reporting (low-risk only) | QA: "checked all AI outputs, all normal" |

All agents start at L0 or L1 and are promoted based on track record.

## Implementation Plan

### 1. Agent Orchestration Framework (`lib/agents/orchestrator.ts`)
- Job queue: define recurring agent tasks with schedules
- Execution engine: run agent, capture output, classify action type
- Autonomy gate: check agent's autonomy level before executing actions
- Result logger: all agent actions stored in `agent_operations` table
- Escalation router: high-priority items → admin notification

### 2. Agent Operations Table
```sql
CREATE TABLE IF NOT EXISTS agent_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  input_summary TEXT,
  output_summary TEXT,
  action_taken TEXT,
  autonomy_level INTEGER DEFAULT 0,
  escalated BOOLEAN DEFAULT false,
  admin_reviewed BOOLEAN DEFAULT false,
  admin_decision TEXT,
  executed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ON agent_operations(agent_id, executed_at DESC);
CREATE INDEX ON agent_operations(escalated, admin_reviewed) WHERE escalated = true;
```

### 3. Individual Agents (Implement Incrementally)

**Phase 1: Listing Quality Agent** (`lib/agents/ops/listing-quality.ts`)
- Scan listings older than 30 days without updates
- Analyze listing quality: title, description, images, pricing
- Generate improvement suggestions
- Send as notification to creator
- Autonomy: L1 (suggest only)

**Phase 2: Trust & Safety Agent** (`lib/agents/ops/trust-safety.ts`)
- Monitor new listings for inappropriate content
- Check profile images for policy violations
- Detect suspicious booking patterns (fraud signals)
- Flag for admin review — NEVER auto-remove content
- Autonomy: L0 (observe + escalate)

**Phase 3: Retention Agent** (`lib/agents/ops/retention.ts`)
- Identify creators inactive for 14+ days
- Identify clients who searched but never booked
- Generate personalized re-engagement messages
- Predict churn risk based on engagement patterns
- Autonomy: L1 initially, promote to L2 after validation

**Phase 4: Growth Agent** (`lib/agents/ops/growth.ts`)
- Analyze supply-demand gaps by category and location
- Suggest new categories or locations to expand into
- Identify trending search terms not well-served
- Weekly report to admin
- Autonomy: L0 (report only)

**Phase 5: Revenue Agent** (`lib/agents/ops/revenue.ts`)
- Identify post-booking upsell moments ("want the photos edited too?")
- Detect repeat-booking opportunities
- Surface at appropriate UX moments
- Autonomy: L1 (suggest, embedded in booking flow)

**Phase 6: Compliance Agent** (`lib/agents/ops/compliance.ts`)
- Monitor POPIA updates relevant to marketplace operations
- Check data retention compliance (are expired records being cleaned?)
- Verify tax-relevant records are intact
- Monthly report to admin
- Autonomy: L0 (report only)

### 4. Admin Operations Dashboard (`app/(admin)/admin/operations/`)
- Real-time view of all agent activities
- Escalation queue: items needing human review
- Agent performance: actions taken, escalation rate, false positive rate
- Autonomy level management: promote/demote agents
- Kill switch: disable any agent instantly

### 5. Observability
- All agent operations logged with timing, cost, and outcome
- Alert on: agent failure, unusual escalation volume, budget overrun
- Weekly digest email to admin: agent summary, key actions, recommendations
- Cost tracking: AI spend per agent (integrates with existing ai_token_usage)

## Files to Create/Modify
```
CREATE:
  lib/agents/orchestrator.ts — job scheduling + execution engine
  lib/agents/ops/listing-quality.ts
  lib/agents/ops/trust-safety.ts
  lib/agents/ops/retention.ts
  lib/agents/ops/growth.ts
  lib/agents/ops/revenue.ts
  lib/agents/ops/compliance.ts
  lib/agents/ops/types.ts
  app/(admin)/admin/operations/page.tsx
  app/(admin)/admin/operations/OperationsAdmin.tsx
  lib/migrations/0XX-agent-operations.sql

MODIFY:
  lib/agents/registry.ts — register all ops agents
  app/api/cron/daily-maintenance/route.ts — trigger daily agents
  app/api/cron/weekly-reports/route.ts — trigger weekly agents
  components/admin/AdminNav.tsx — add Operations link
```

## Dependencies
- All prior tasks (046-056) feed into various agents
- Existing agent framework (registry, router, runtime)
- Existing notification system
- Existing cron infrastructure

## Acceptance Criteria
- [ ] Orchestrator framework schedules and executes agent jobs
- [ ] All agent actions logged in agent_operations table
- [ ] Escalation routing sends admin notifications for flagged items
- [ ] Autonomy levels enforced (agents can't exceed their level)
- [ ] Kill switch disables agents instantly
- [ ] Admin dashboard shows real-time agent activity
- [ ] AI cost tracked per agent via existing token tracking
- [ ] No agent takes destructive action without admin approval
- [ ] npm run build passes

## Effort Estimate
Ongoing. Framework: 2-3 weeks. Each agent: 1-2 weeks. Full roster: 3-4 months of incremental development.

## Priority
Low (framework) to Medium (individual agents as needs emerge). Build the framework early, add agents one at a time as operational pain points emerge. Don't build agents for problems you don't have yet.

## Risk Notes
- **Never give an ops agent destructive permissions.** No auto-deleting content, no auto-suspending users, no auto-refunding. All destructive actions require admin approval.
- AI budget management is critical — 7 agents running daily could burn through API credits fast. Start with Gemma/Flash for routine tasks, Claude only for complex analysis.
- Agent reliability: if an agent fails, it should fail silently (log error, continue). Never let one agent's failure cascade to others.
- Start simple. The listing quality agent (Phase 1) is the lowest-risk, highest-value first agent. Don't build the full roster upfront.
- The orchestrator framework is the real deliverable. Individual agents are plugins that can be added at any time.

## Build Order
1. Framework (orchestrator + operations table + admin dashboard)
2. Listing Quality Agent (safest, most immediate value)
3. Trust & Safety Agent (important as content grows)
4. Retention Agent (important as user base grows)
5. Growth/Revenue/Compliance (as scale demands)
