# AI PLATFORM ARCHITECTURE — Skills + Tools + Cron (Anthropic Pattern)

## Overview

ThabangVision follows Anthropic's architecture pattern for AI-powered platforms: instead of building dozens of separate AI agents (each with their own API call and cost), the platform uses four layers:

1. **Cron Jobs** — automated tasks that need zero AI (just code on a schedule)
2. **MCP Tools** — callable functions that any agent can use (database, payments, email)
3. **Skills** — knowledge files loaded on demand when the AI needs specialized instructions
4. **AI Agents** — only 2 actual AI agents that load skills and call tools as needed

Most of what feels like "an agent" is actually a cron job or a tool call. AI is reserved for tasks that genuinely require reasoning, judgment, or natural language understanding.

```
WRONG (expensive):
  34 separate agents × own system prompt × own API call = R30,000/month

RIGHT (efficient):
  3 cron jobs + 6 MCP tool sets + 9 skills + 2 AI agents = R3,000-5,000/month
  Same functionality. 80% cheaper.
```

---

## The Rule

```
IF it can be done with code → CRON JOB (zero AI cost)
IF it needs to call external services → MCP TOOL (zero AI cost)
IF AI needs specialized knowledge → SKILL FILE (loaded on demand)
IF it genuinely needs reasoning → AI AGENT (only 2)
```

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    THABANGVISION                     │
│                                                     │
│  LAYER 1 — CRON JOBS (no AI, just code)            │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐  │
│  │ Daily       │ │ Hourly      │ │ Weekly      │  │
│  │ Maintenance │ │ Checks      │ │ Reports     │  │
│  └─────────────┘ └─────────────┘ └─────────────┘  │
│                                                     │
│  LAYER 2 — MCP TOOLS (callable functions)          │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐      │
│  │Supabase│ │Paystack│ │Cloudin.│ │ Email  │      │
│  └────────┘ └────────┘ └────────┘ └────────┘      │
│  ┌────────┐ ┌────────┐                             │
│  │Analyt. │ │Booking │                             │
│  └────────┘ └────────┘                             │
│                                                     │
│  LAYER 3 — SKILLS (loaded on demand)               │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐      │
│  │Booking │ │Quoting │ │Matching│ │Verific.│      │
│  └────────┘ └────────┘ └────────┘ └────────┘      │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐      │
│  │Product.│ │Rental  │ │Analyt. │ │Compli. │      │
│  └────────┘ └────────┘ └────────┘ └────────┘      │
│  ┌────────┐                                        │
│  │Support │                                        │
│  └────────┘                                        │
│                                                     │
│  LAYER 4 — AI AGENTS (only 2)                      │
│  ┌──────────────────────────────────────────┐      │
│  │ UBUNYE (primary)                         │      │
│  │  modes: chat | booking | analysis | admin│      │
│  └──────────────────────────────────────────┘      │
│  ┌──────────────────────────────────────────┐      │
│  │ VISION (separate — needs image input)    │      │
│  │  tasks: verification | curation | EXIF   │      │
│  └──────────────────────────────────────────┘      │
│                                                     │
│  LAYER 5 — COST MONITORING                         │
│  ┌──────────────────────────────────────────┐      │
│  │ trackedCompletion() — logs every AI call │      │
│  └──────────────────────────────────────────┘      │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## What Does NOT Need AI

These were originally "agents" but are actually just scheduled code:

```
TASK                          WHY NO AI             IMPLEMENTATION
────                          ─────────             ──────────────
Clean expired data            SQL DELETE            Cron: daily
Cancel unpaid orders          SQL UPDATE WHERE      Cron: daily
Auto-approve deliveries       SQL UPDATE WHERE      Cron: daily
Trigger auto-payouts          API call              Cron: daily
Reconcile payouts             Compare two queries   Cron: daily
Check services alive          HTTP ping             Cron: hourly
Monitor error rates           COUNT queries         Cron: hourly
Send reminder emails          Template + send       Cron: hourly
Check broken images           HTTP HEAD             Cron: weekly
Financial summary             SUM/GROUP BY          Cron: weekly
Performance metrics           AVG response times    Cron: weekly
Security anomalies            COUNT failed logins   Cron: hourly
Budget threshold alerts       Compare spend vs limit Cron: hourly
Flag no-show creators         COUNT no-shows        Cron: daily
SEO health check              Fetch + validate HTML Cron: weekly
Backup verification           Check timestamps      Cron: daily
```

**Total AI cost for all of the above: R0/month**

---

## LAYER 1 — Cron Jobs

### Daily Maintenance — `/api/cron/daily-maintenance`
Runs: 2am SAST

```
Actions:
  1. Cancel unpaid orders older than 72 hours
  2. Auto-approve delivered orders past 7-day window
  3. Trigger auto-payouts for newly approved orders
  4. Check for stuck payouts (processing > 24 hours)
  5. Check Paystack balance vs pending payouts
  6. Clean expired AI cache entries
  7. Archive platform events older than 24 months
  8. Flag creators with 3+ no-shows
  9. Clean orphaned unverified accounts (30 days)
  10. Log maintenance results to platform_events
```

### Hourly Checks — `/api/cron/hourly-checks`
Runs: every hour

```
Actions:
  1. Health check: Supabase, Paystack, Cloudinary, Anthropic API
  2. Alert admin if any service is down
  3. Check for unassigned paid orders (12+ hours old)
  4. Check for overdue deliveries (past delivery deadline)
  5. Monitor failed login attempts (>20 in 5 minutes)
  6. Check AI budget thresholds per agent
  7. Log check results to platform_events
```

### Weekly Reports — `/api/cron/weekly-reports`
Runs: Monday 8am SAST

```
Actions:
  1. Financial summary: revenue, commission, payouts, refunds
  2. AI costs: total spend, by mode, cache savings
  3. User growth: new signups, new creators, new clients
  4. Content integrity: check sample of 20 image URLs
  5. Performance: slow API routes, slow queries
  6. Booking funnel: views → bookings → completions → conversion rate
  7. Email full report to admin
  8. Log report to platform_events
```

### Vercel Cron Configuration:

```json
{
  "crons": [
    { "path": "/api/cron/daily-maintenance", "schedule": "0 0 * * *" },
    { "path": "/api/cron/hourly-checks", "schedule": "0 * * * *" },
    { "path": "/api/cron/weekly-reports", "schedule": "0 6 * * 1" }
  ]
}
```

All cron routes verify a secret:
```typescript
const authHeader = req.headers.get('authorization');
if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}
```

---

## LAYER 2 — MCP Tools

Tools are functions that AI agents can call. The AI decides WHEN. The tool does the work. No AI cost for the execution.

### Tool Set 1: Database (Supabase MCP)
```
Already connected: https://mcp.supabase.com/mcp
Capabilities: SQL queries, table management, RLS, storage
```

### Tool Set 2: Paystack
```
check_balance        → GET /balance
verify_payment       → GET /transaction/verify/:ref
initiate_transfer    → POST /transfer
process_refund       → POST /refund
list_transfers       → GET /transfer
create_recipient     → POST /transferrecipient
```

### Tool Set 3: Cloudinary
```
upload_image         → upload to cloud storage
delete_image         → remove by public ID
check_image_exists   → HEAD request to verify URL
```

### Tool Set 4: Email
```
send_templated_email → send pre-built template with variables
Templates: order_confirmed, order_delivered, payout_success,
           payout_failed, reminder_unassigned, reminder_overdue,
           admin_weekly_report, admin_service_down
```

### Tool Set 5: Analytics
```
query_booking_stats  → booking counts, amounts, by category/period
query_revenue        → revenue breakdown by period
query_ai_costs       → AI usage and cost by agent/mode
query_popular_searches → top search queries
```

### Tool Set 6: Booking
```
search_creators      → find creators by skill, location, date, rating
check_availability   → check creator or gear availability for dates
calculate_quote      → price a package with extras
create_booking       → insert new booking record
```

---

## LAYER 3 — Skills (Progressive Disclosure)

Skills are SKILL.md files loaded ONLY when the conversation needs specialized knowledge. Each skill summary takes ~5 tokens in the base prompt. Full skill loads ~500-2000 tokens only when relevant.

### Skill Library:

```
skills/
├── booking/SKILL.md
│   When: client wants to book, asks about pricing, payment
│   Contains: packages, pricing rules, booking flow, cancellation policy
│   Tools: calculate_quote, create_booking, search_creators
│
├── quoting/SKILL.md
│   When: client asks for custom quote, non-standard project
│   Contains: hourly rates, custom package building, VAT rules, add-ons
│   Tools: calculate_quote
│
├── matching/SKILL.md
│   When: system needs to recommend a creator for a booking
│   Contains: matching criteria, ranking logic, what to show client
│   Tools: search_creators, check_availability
│
├── verification/SKILL.md
│   When: processing a new creator verification
│   Contains: ID check rules, fraud indicators, EXIF validation, approval criteria
│   Tools: none (vision analysis)
│
├── production/SKILL.md
│   When: discussing production services, categories, packages
│   Contains: six categories, package details, cross-sell rules, portfolio structure
│   Tools: query_booking_stats
│
├── rental/SKILL.md
│   When: discussing gear rentals, equipment
│   Contains: gear categories, daily rates, rental process, deposit rules
│   Tools: check_availability
│
├── analytics/SKILL.md
│   When: admin asks for data, trends, reports
│   Contains: what data exists, how to query, POPIA aggregation rules
│   Tools: query_booking_stats, query_revenue, query_ai_costs
│
├── compliance/SKILL.md
│   When: questions about POPIA, tax, legal, terms
│   Contains: data retention, creator tax obligations, refund rules, ToS summary
│   Tools: none (knowledge only)
│
└── support/SKILL.md
    When: client has issue, dispute, complaint
    Contains: dispute resolution, refund decision tree, escalation rules
    Tools: process_refund
```

### How skills load:

```typescript
function detectSkillNeeded(messages: Message[]): string | null {
  const lastMessage = messages.at(-1)?.content?.toLowerCase() || '';

  if (/book|package|price|cost|how much|order/.test(lastMessage)) return 'booking';
  if (/custom|bespoke|specific|different|unique/.test(lastMessage)) return 'quoting';
  if (/rent|gear|equipment|camera|lens|drone/.test(lastMessage)) return 'rental';
  if (/wedding|portrait|corporate|video|event|content/.test(lastMessage)) return 'production';
  if (/cancel|refund|complaint|problem|dispute/.test(lastMessage)) return 'support';
  if (/privacy|popia|data|terms|legal|tax/.test(lastMessage)) return 'compliance';
  if (/stats|analytics|report|revenue|trend/.test(lastMessage)) return 'analytics';
  if (/verify|verification|id|identity/.test(lastMessage)) return 'verification';

  return null;
}
```

### Token savings:

```
Without progressive disclosure:
  All 9 skills loaded every message: ~12,000 tokens per call
  700 calls/month × 12,000 = 8.4M tokens = R25.20/month just for skill context

With progressive disclosure:
  Skill summaries in base prompt: ~50 tokens per call
  Full skill loaded only when needed: ~1,500 tokens per call, ~40% of calls
  700 calls × 50 + 280 calls × 1,500 = 455,000 tokens = R1.37/month
  
  Savings: 95% reduction in skill-related token cost
```

---

## LAYER 4 — AI Agents (Only 2)

### Agent 1: Ubunye (Primary Agent)

One agent with four modes. Loads skills on demand. Calls tools as needed.

```typescript
export const AI_AGENTS = {
  ubunye: {
    status: 'active',
    name: 'Ubunye',
    description: 'Primary platform AI — conversations, bookings, analysis, support',
    defaultModel: 'claude-sonnet-4-20250514',
    fallbackModel: 'gemini-2.0-flash',
    budgetDailyUsd: 30,
    budgetMonthlyUsd: 600,

    modes: {
      chat: {
        description: 'General questions, recommendations, help',
        model: 'gemini-2.0-flash',
        skills: [],
        tools: [],
        cacheable: true,
        cacheMaxAge: 3600,
      },
      booking: {
        description: 'Multi-step booking flow with tool use',
        model: 'claude-sonnet-4-20250514',
        skills: ['booking', 'quoting'],
        tools: ['search_creators', 'check_availability', 'calculate_quote', 'create_booking'],
        cacheable: false,
      },
      support: {
        description: 'Client issue resolution and disputes',
        model: 'claude-sonnet-4-20250514',
        skills: ['support', 'compliance'],
        tools: ['process_refund'],
        cacheable: false,
      },
      analysis: {
        description: 'Admin data analysis and reporting',
        model: 'claude-sonnet-4-20250514',
        skills: ['analytics'],
        tools: ['query_booking_stats', 'query_revenue', 'query_ai_costs'],
        cacheable: false,
      },
    },
  },
} as const;
```

### Agent 2: Vision Agent

Separate because it requires image input — different API call pattern.

```typescript
export const AI_AGENTS = {
  // ... ubunye above ...

  vision: {
    status: 'active',
    name: 'Vision Agent',
    description: 'Image analysis — verification, curation, EXIF',
    defaultModel: 'claude-sonnet-4-20250514',
    fallbackModel: null,
    budgetDailyUsd: 10,
    budgetMonthlyUsd: 200,

    tasks: {
      verification: {
        description: 'Screen selfie + ID photos for fraud',
        skills: ['verification'],
        phase: 'v3',
        status: 'active',
      },
      exif_analysis: {
        description: 'Extract gear info from photos, match to rentals',
        skills: [],
        phase: 'v4',
        status: 'planned',
      },
      portfolio_curation: {
        description: 'Select best photos from production uploads',
        skills: [],
        phase: 'v5',
        status: 'future',
      },
    },
  },
} as const;
```

### Mode routing:

```typescript
function detectMode(messages: Message[]): string {
  const lastMessage = messages.at(-1)?.content?.toLowerCase() || '';

  if (/book|order|pay|checkout|package/.test(lastMessage)) return 'booking';
  if (/cancel|refund|complaint|problem|help with my order/.test(lastMessage)) return 'support';
  if (/stats|revenue|how many|report|analytics/.test(lastMessage)) return 'analysis';

  return 'chat';
}

function getModelForMode(mode: string, messageLength: number, conversationLength: number): string {
  // Booking, support, analysis always need Claude Sonnet
  if (mode !== 'chat') return 'claude-sonnet-4-20250514';

  // Short simple chat → Gemini Flash (40x cheaper)
  if (messageLength < 100 && conversationLength < 5) return 'gemini-2.0-flash';

  // Complex chat → Claude Sonnet
  return 'claude-sonnet-4-20250514';
}
```

---

## LAYER 5 — Cost Monitoring

### trackedCompletion wrapper:

Every AI call goes through one function. Logs everything.

```typescript
const { response, usage } = await trackedCompletion({
  agentId: 'ubunye',        // or 'vision'
  model,
  userId,
  conversationId,
  messages,
  tools,
  metadata: {
    mode: 'booking',
    skillLoaded: 'booking',
    toolsCalled: ['calculate_quote'],
  },
});
```

### What gets logged per call:

```
agentId, agentName, mode, model, provider
inputTokens, outputTokens, totalTokens
costUsd, costZar
responseTimeMs
cachedResponse (boolean)
skillLoaded (which skill, if any)
toolsCalled (which tools were used)
success, finishReason
budgetUsedPercent
systemPromptTokens
```

### Admin dashboard: `/admin/ai-costs`

Shows:
- Total cost by agent (Ubunye vs Vision)
- Cost by Ubunye mode (chat vs booking vs support vs analysis)
- Cost by skill loaded
- Cache hit rate and savings
- Model usage breakdown
- Budget status per agent
- Daily cost trend chart
- Cron job status (last run, pass/fail)

---

## Cost Projection

```
MONTHLY AT SCALE:

Ubunye Chat:     520 calls × R0.50 (Flash)    = R260
Ubunye Booking:   98 calls × R15.00 (Sonnet)  = R1,470
Ubunye Support:   62 calls × R9.00 (Sonnet)   = R558
Ubunye Analysis:  20 calls × R8.10 (Sonnet)   = R162
Vision:           42 calls × R9.52 (Sonnet)   = R400
────────────────────────────────────────────────────
Gross total:                                    R2,850
Cache savings (38%):                           -R680
────────────────────────────────────────────────────
Net total:                                      R2,170/month

Cron jobs:                                      R0/month
MCP tools:                                      R0/month (code, not AI)
Skills:                                         R0/month (text files, not AI)

COMPARISON:
  34 separate agents approach:  R8,500+/month
  This architecture:            R2,170/month
  Savings:                      75%
```

---

## Implementation Phases

```
PHASE 1 — V3 (now):
  Ubunye: chat + booking modes
  Vision: verification screening
  trackedCompletion wrapper
  Cost logging to platform_events
  Cron: daily maintenance
  Cron: hourly health checks

PHASE 2 — V3.5 (launch):
  Ubunye: support mode
  Skills: booking, quoting, rental, production, support, compliance
  Model routing (chat → Flash)
  Semantic caching for chat
  Budget alerts
  Cron: weekly reports
  Admin AI costs dashboard

PHASE 3 — V4 (growth):
  Ubunye: analysis mode
  Skills: analytics, matching
  Tools: search_creators, check_availability, calculate_quote
  Vision: EXIF analysis
  All skills loaded dynamically

PHASE 4 — V5 (scale):
  Vision: portfolio curation
  Tools: query_booking_stats, query_revenue
  Demand forecasting (weekly cron → AI analysis)
  Pricing intelligence for creators

PHASE 5 — V6 (expand):
  WhatsApp mode for Ubunye
  Automated report generation
  Upsell recommendations in booking flow
```

---

## Key Rules

```
1.  IF IT CAN BE CODE, DON'T USE AI — cron jobs for maintenance, not agents
2.  ONE AGENT, MANY SKILLS — Ubunye loads knowledge on demand
3.  PROGRESSIVE DISCLOSURE — skill summaries in base prompt, full skills on demand
4.  TOOLS DO THE WORK — AI decides when, tools execute
5.  MODEL ROUTING — Flash for simple chat, Sonnet for reasoning
6.  CACHE REPEATED QUERIES — 30-45% of chat is repetitive
7.  BUDGET PER AGENT — alert at 80%, downgrade at 100%
8.  TRACK BY MODE — cost of chat vs booking vs support vs analysis
9.  CRON FOR MAINTENANCE — daily cleanup, hourly health, weekly reports
10. COST < 25% OF COMMISSION — AI must stay profitable
```
