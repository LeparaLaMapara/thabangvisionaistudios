# Ubunye Agent Architecture

## Overview

Ubunye is a family of 5 specialized AI agents, not one monolithic chatbot. Each agent has focused tools, its own system prompt, and an appropriate AI model. They share common infrastructure (auth, rate limiting, cost tracking, streaming) through a unified runtime.

This follows the same abstraction pattern as `lib/payments/`, `lib/storage/`, and `lib/email/` — a shared interface with swappable implementations.

---

## The 5 Agents

| Agent | Purpose | Model | Cost |
|-------|---------|-------|------|
| **Ubunye Assistant** | General chat, platform Q&A, search across everything | Claude Sonnet + Gemini Flash routing | Medium |
| **Ubunye Booking** | Smart production quotes, creator search & booking, gear rental booking | Claude Sonnet | Medium |
| **Ubunye Onboarding** | ID capture, gear identification, category mapping | Gemma 4 (31B) | Free |
| **Ubunye Portfolios** | Portfolio creation, image tagging, scene classification, skills detection | Gemma 4 (31B) | Free |
| **Ubunye Rates** | Market-aligned rate suggestions for creators | Claude Sonnet | Medium |

### Agent Details

#### Ubunye Assistant
- **Role:** Front door of the platform. Handles general questions, searches across gear/creators/productions/press, and routes users to specialist agents when needed.
- **Model:** Claude Sonnet (complex queries) / Gemini Flash (simple queries)
- **Tools:** `search_gear`, `search_creators`, `search_productions`, `search_press`
- **Who uses it:** Everyone — guests, creators, renters, admins
- **Rate limits:** Guest: 5/session, Free: 20/day, Pro: 100/day, Studio: unlimited

#### Ubunye Booking
- **Role:** Handles the transactional side — generating quotes for production services, finding and booking creators, and booking gear rentals.
- **Model:** Claude Sonnet (always — needs tool calls for booking logic)
- **Tools:** `calculate_booking_quote`, `submit_creator_request`, `check_availability`, `submit_rental_booking`, `improve_brief`, `generate_social_content`
- **Who uses it:** Clients booking creators, renters booking gear
- **Rate limits:** Guest: 0, Free: 20/day, Pro: 100/day, Studio: unlimited

#### Ubunye Onboarding
- **Role:** Guides new creators through the mandatory onboarding flow — ID capture, gear photo identification, and category mapping to smart rental categories.
- **Model:** Gemma 4 `gemma-4-31b-it` (free via Google AI Studio, 15 RPM)
- **Tools:** `extract_id_fields`, `identify_gear`, `classify_gear_category`
- **Who uses it:** New creators during onboarding only
- **Rate limits:** Free: 50/day (onboarding sessions), Studio: 50/day
- **Key constraint:** Category classification is constrained to the 9 `RENTAL_CATEGORIES` from `lib/constants.ts`. No hallucinated categories.

#### Ubunye Portfolios
- **Role:** Helps creators build and tag their portfolio — scene classification, lighting detection, quality scoring, auto-generated descriptions and hashtags, skill detection from portfolio analysis.
- **Model:** Gemma 4 `gemma-4-31b-it` (free via Google AI Studio, 15 RPM)
- **Tools:** `analyze_scene`, `score_quality`, `generate_description`, `detect_skills`, `suggest_hashtags`
- **Who uses it:** Creators managing their portfolio
- **Rate limits:** Free: 50/day, Pro: 100/day, Studio: unlimited

#### Ubunye Rates
- **Role:** Suggests market-aligned rates for creators based on their skills, gear, portfolio quality, and location within South Africa.
- **Model:** Claude Sonnet (reasoning-heavy — needs market knowledge)
- **Tools:** `suggest_hourly_rates`, `compare_market_rates`
- **Who uses it:** Creators setting their pricing
- **Rate limits:** Free: 10/day, Pro: 20/day, Studio: unlimited

---

## Abstraction Layer Design

```
┌──────────────────────────────────────────────────────────────┐
│  Pages / API Routes                                          │
│  POST /api/agents/assistant                                  │
│  POST /api/agents/booking                                    │
│  POST /api/agents/onboarding                                 │
│  POST /api/agents/portfolios                                 │
│  POST /api/agents/rates                                      │
└──────────────┬───────────────────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────────────────┐
│  Agent Runtime (lib/agents/runtime.ts)                        │
│  Shared: auth → rate limit → prompt build → execute → cost   │
└──────────────┬───────────────────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────────────────┐
│  Agent Registry (lib/agents/registry.ts)                      │
│  ┌───────────┐ ┌─────────┐ ┌────────────┐ ┌──────────┐ ┌───┐│
│  │ Assistant │ │ Booking │ │ Onboarding │ │Portfolios│ │Rate││
│  └─────┬─────┘ └────┬────┘ └─────┬──────┘ └────┬─────┘ └─┬─┘│
│        │            │            │              │          │  │
│     Claude       Claude       Gemma 4        Gemma 4   Claude│
│     +Gemini      Sonnet       31B-it         31B-it    Sonnet│
└──────────────────────────────────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────────────────┐
│  Tool Registry (lib/agents/tools/)                            │
│  search.ts  booking.ts  vision.ts  portfolio.ts  pricing.ts  │
└──────────────────────────────────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────────────────┐
│  Provider SDKs (via lib/ai/)                                  │
│  @ai-sdk/anthropic  @ai-sdk/google  @google/generative-ai    │
└──────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
lib/agents/
├── types.ts              # UbunyeAgent interface, AgentTool, AgentContext, shared types
├── registry.ts           # All 5 agents registered, exported as UBUNYE_AGENTS
├── runtime.ts            # Shared execution: auth → rate limit → prompt → execute → cost track
├── router.ts             # Intent classification for Assistant → specialist hand-off
├── agents/
│   ├── assistant.ts      # Config: model, tools, system prompt, rate limits
│   ├── booking.ts
│   ├── onboarding.ts
│   ├── portfolios.ts
│   └── rates.ts
└── tools/
    ├── search.ts         # search_creators, search_gear, search_productions, search_press
    ├── booking.ts        # calculate_quote, submit_booking, check_availability
    ├── vision.ts         # identify_gear, classify_category, extract_id
    ├── portfolio.ts      # analyze_scene, score_quality, detect_skills, generate_description
    └── pricing.ts        # suggest_rates, compare_market
```

---

## Shared Runtime

Every agent goes through the same execution pipeline:

```
Request → Auth Check → Rate Limit → Build System Prompt → Select Model → Execute with Tools → Track Cost → Stream Response
```

This means:
- **Auth** is checked once, the same way, for every agent
- **Rate limiting** is per-agent, per-user, per-tier (guest/free/pro/studio)
- **Cost tracking** aggregates by agent so you can see which agents cost money
- **Streaming** works the same for Claude and Gemma agents
- **No duplicated code** across agents — add a new agent by defining its config

---

## Agent Routing & Hand-Off

### Explicit Routing (Primary)
Frontend knows which agent to call based on the page context:

| Page | Agent |
|------|-------|
| `/ubunye-ai-studio` (general chat) | Assistant |
| `/dashboard/bookings`, `/smart-productions` | Booking |
| `/onboarding` | Onboarding |
| `/dashboard/portfolio` | Portfolios |
| `/dashboard/pricing` | Rates |

### Auto-Routing (Secondary)
When a user talks to Assistant about something a specialist handles better:

```
User: "I want to book a photographer for Saturday"
Assistant detects intent → hands off to Booking agent
Booking agent takes over with full booking tools
```

The router uses a cheap model (Gemini Flash) to classify intent before routing.

### Hand-Off Rules
- Assistant can route TO any specialist
- Specialists do NOT route to each other — they complete their task and return to Assistant
- Onboarding is always explicit (only accessed from `/onboarding`)
- Rates is always explicit (only accessed from pricing settings)

---

## Cost Model

| Agent | Provider | Cost per 1M tokens (input/output) | Daily Budget |
|-------|----------|-----------------------------------|-------------|
| Assistant | Claude Sonnet | R54 / R216 | R50 |
| Assistant (simple) | Gemini Flash | R1.35 / R5.40 | (shared) |
| Booking | Claude Sonnet | R54 / R216 | R50 |
| Onboarding | Gemma 4 (free) | R0 / R0 | R0 |
| Portfolios | Gemma 4 (free) | R0 / R0 | R0 |
| Rates | Claude Sonnet | R54 / R216 | R20 |

**Total daily budget:** ~R170 ZAR (~R5,100/month)

Onboarding and Portfolios are free because they use Gemma 4 via Google AI Studio's free tier. This is a deliberate design choice — the highest-volume agents (every creator onboards, every creator uploads photos) cost nothing.

---

## Adding a New Agent

1. Create `lib/agents/agents/newagent.ts` implementing the `UbunyeAgent` interface
2. Add tools to `lib/agents/tools/` if needed
3. Register in `lib/agents/registry.ts`
4. Create API route `app/api/agents/newagent/route.ts` (calls `executeAgent('newagent', ...)`)
5. No changes to runtime, auth, rate limiting, or cost tracking needed

Same pattern as adding a new payment provider or storage provider.

---

## Env Vars

```
# AI Providers (existing)
AI_PROVIDER=anthropic
GEMINI_API_KEY=xxx              # Used by Gemma 4 agents (onboarding, portfolios)

# Agent-specific (new)
AGENT_ASSISTANT_ENABLED=true
AGENT_BOOKING_ENABLED=true
AGENT_ONBOARDING_ENABLED=true
AGENT_PORTFOLIOS_ENABLED=true
AGENT_RATES_ENABLED=true
```

Each agent can be toggled independently. Disabled agents return a "coming soon" message.

---

## User Journeys — How Agents Work Together

### Creator Journey

A photographer/videographer joins the platform to offer services and rent out gear.

#### Phase 1: Sign Up & Onboard

```
/register → /onboarding

UBUNYE ONBOARDING (Gemma 4, free)
│
├─ Step 1: Upload SA ID → Gemma extracts name, ID number
│          (mandatory — no transactions without ID)
│          Fallback: type manually if photo extraction fails
│
└─ Step 5: Upload gear photos → Gemma identifies
           "Sony A7 III → Cameras & Optics"
           Creator confirms → listings go live in smart_rentals
           │
           ▼
UBUNYE PORTFOLIOS (Gemma 4, free)
│
├─ Step 2: Upload portfolio photos → Gemma tags scenes
│          "Wedding, golden hour, natural light"
│
└─ Step 3: Skills auto-detected from portfolio
           "Wedding 40%, Portrait 25%, Corporate 20%"
           │
           ▼
UBUNYE RATES (Claude Sonnet, P2)
│
└─ Step 4: "Based on your gear + skills + Joburg market:
            Wedding: R1,800/hr, Portrait: R1,200/hr"
           Creator adjusts with sliders → confirms
           │
           ▼
ONBOARDING COMPLETE → redirect to /dashboard
```

#### Phase 2: Ongoing — Creator Manages Their Business

| Page | Agent | What happens |
|------|-------|-------------|
| `/dashboard/portfolio` | **Portfolios** | Add more photos, re-tag, update skills |
| `/dashboard/pricing` | **Rates** | "Market shifted — update your rates?" |
| `/dashboard/rentals` | **Onboarding** | Add new gear (photo → identify → list) |
| `/ubunye-ai-studio` | **Assistant** | "How do I get more bookings?", "What gear is trending in Cape Town?" |

---

### Client Journey

A brand, agency, or individual looking to hire a creator or rent gear.

#### Phase 1: Discover

```
Client lands on platform (may or may not be logged in)
/ubunye-ai-studio or /smart-productions or /smart-rentals

UBUNYE ASSISTANT (Claude + Gemini routing)
│
├─ "I need a photographer for a corporate shoot in Sandton"
│   → Searches creators by specialization + location
│   → "Here are 3 corporate photographers near Sandton..."
│
├─ "What camera should I rent for a wedding?"
│   → Searches smart rentals
│   → "For weddings I'd recommend these full-frame options..."
│
└─ Detects booking intent → hands off to Booking
```

#### Phase 2: Book (requires login + ID on file)

```
If no account → /register → /onboarding

UBUNYE ONBOARDING (Gemma 4, free)
│
└─ Clients only do Step 1 (ID capture)
   No portfolio, no gear, no skills.
   Just: "Upload ID so we know who's renting"
   │
   ▼
UBUNYE BOOKING (Claude Sonnet)
│
├─ CREATOR BOOKING:
│  "I want to book Thabo for a wedding on March 15"
│   → Checks Thabo's availability
│   → Calculates quote (R1,800/hr x 8hrs + VAT)
│   → "Total: R16,560. Deposit: R8,280. Book now?"
│   → Generates booking → payment via Paystack
│
├─ GEAR RENTAL:
│  "I need a Sony A7 III for this Saturday"
│   → Checks availability in smart_rentals
│   → "Available from ThabangVision. R750/day. Book?"
│   → Generates rental booking → payment via Paystack
│
└─ PRODUCTION PACKAGE:
   "I need a full crew for a 2-day brand shoot"
    → Improves brief ("What's your budget? Indoor/outdoor?")
    → Calculates full production quote
    → Submits booking request
    │
    ▼
PAYMENT → BOOKING CONFIRMED → both parties notified
```

#### Phase 3: Post-Booking

| Page | Agent | What happens |
|------|-------|-------------|
| `/ubunye-ai-studio` | **Assistant** | "Where's my booking confirmation?", "Can I extend my rental?" |
| `/ubunye-ai-studio` | **Booking** (via hand-off) | "Generate social content from the shoot" |

---

### Creator vs Client — Side by Side

| | Creator | Client |
|---|---------|--------|
| **Onboarding steps** | All 5 (ID + portfolio + skills + gear + rates) | Step 1 only (ID capture) |
| **Agents at signup** | Onboarding → Portfolios → Rates | Onboarding (ID only) |
| **Primary agent ongoing** | Portfolios, Rates, Assistant | Booking, Assistant |
| **Booking agent** | Receives bookings (gets notified) | Makes bookings (initiates) |
| **Portfolios agent** | Builds and manages profile | Never uses it |
| **Rates agent** | Sets and updates pricing | Sees the prices (read-only) |

---

### Agent Hand-Off Rules

```
ASSISTANT ──── "I want to book someone" ──────→ BOOKING
    │
    ├──── "Help me tag my photos" ─────────→ PORTFOLIOS
    │
    ├──── "What should I charge?" ─────────→ RATES
    │
    └──── general question ────────────────→ stays in ASSISTANT

ONBOARDING ──── completes ─────────────────→ DASHBOARD (page navigation, not chat)
```

- **Assistant** is the only agent that routes to others
- **Specialists** finish their job and the user returns to where they were
- **Onboarding** is always page-driven (explicit `/onboarding` flow), never chat-initiated
- Specialists do NOT route to each other

---

## Relationship to Existing Code

### What changes
- `POST /api/ubunye-chat` → refactored into `POST /api/agents/assistant` and `POST /api/agents/booking`
- Tools currently in the ubunye-chat route → moved to `lib/agents/tools/`
- System prompt builder in `lib/ubunye/system-prompt.ts` → becomes `assistant.systemPrompt()` and `booking.systemPrompt()`
- Rate limiting logic → centralized in `lib/agents/runtime.ts`

### What stays the same
- `lib/ai/index.ts` — still the provider abstraction for model selection
- `lib/ubunye/` — can remain as the system prompt builder library, imported by agent configs
- Frontend `useChat()` — same hook, just points to new endpoints
- Auth flow — unchanged, runtime calls existing auth helpers

### Migration path
1. Build `lib/agents/` framework (types, runtime, registry)
2. Move Assistant + Booking out of monolithic ubunye-chat
3. Add Onboarding, Portfolios, Rates as new agents
4. Deprecate `/api/ubunye-chat` and `/api/gemini` (redirect to `/api/agents/assistant`)
