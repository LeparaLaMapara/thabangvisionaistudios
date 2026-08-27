# THABANGVISION STRATEGY — From Marketplace to Autonomous Creative Intelligence Platform

> This document covers the platform: revenue model, autonomy roadmap, go to
> market. For where the **company** is going beyond the marketplace (vertical
> integration into manufacturing, and the split between work that sells as a
> product and specialist skill that sells into a production), see
> [`docs/direction.md`](./direction.md).
>
> Note where the two differ: this document lists gear manufacturers as partners
> to sponsor recommendations and license a demand index to. `direction.md`
> records the longer aim of becoming one.

## Company

```
Name:           ThabangVision Studio (Pty) Ltd
Registration:   2025/742948/07
Director:       Thabang Lukhetho Mashinini-Sekgoto
Domain:         thabangvision.com
Entity:         Private Company (South Africa)
Founded:        September 2025
```

---

## Mission

Connect South Africa's creative talent with clients who need them — powered by AI that gets smarter with every interaction.

---

## What ThabangVision Is

A three-sided AI-powered marketplace for South Africa's creative production industry:

```
SIDE 1 — SMART RENTALS:     "I have gear" ↔ "I need gear"
SIDE 2 — SMART CREATORS:    "I'm available for hire" ↔ "I need someone"
SIDE 3 — SMART PRODUCTIONS: "Here's what we create" ↔ "I want that"
```

Powered by Ubunye AI — the intelligence layer that connects all three sides.

---

## The Problem

South Africa's creative industry runs on WhatsApp groups and who-you-know networks:

```
A photographer needs gear      → calls 10 people, hopes someone has it
A director needs a crew        → asks friends of friends
A client needs a videographer  → Googles and hopes for the best
A new graduate with a camera   → no way to get discovered or hired
Equipment sits idle            → owner doesn't know someone needs it
No one knows market rates      → everyone guesses
No industry data exists        → government, brands, educators fly blind
```

If you're not connected, you don't work. The industry gatekeeps through networks, not talent.

---

## The Solution

ThabangVision breaks the gate open:

```
Photographer needs gear      → browses Smart Rentals → books in 2 minutes
Director needs a crew        → browses Smart Creators → hires in 1 click
Client needs a videographer  → asks Ubunye → gets matched instantly
New graduate with a camera   → verifies, lists gear, gets first paid gig
Equipment sits idle          → listed on platform, earning money 24/7
Market rates                 → transparent pricing, data-driven
Industry intelligence        → built from every transaction
```

---

## Revenue Model

```
PRIMARY REVENUE (now):
  15% commission on every booking (creator keeps 85%)
  Studio gear rentals (100% margin on own equipment)
  Production services (direct client work)

SECONDARY REVENUE (V4+):
  Creator subscriptions (Pro/Studio plans with analytics)
  Ubunye AI tiers (free/premium for clients)
  Featured listings (creators pay for visibility)

DATA REVENUE (V6+):
  SA Creative Industry Report (annual subscription)
  Equipment Demand Index (licensed to manufacturers)
  Creator Market Intelligence (licensed to agencies)
  Location Intelligence (licensed to tourism/venues)
  Ubunye API (AI-as-a-service for other platforms)

BRAND REVENUE (V6+):
  Brand partnerships (gear manufacturers sponsor recommendations)
  Sponsored packages (brands co-create production packages)
```

---

## Competitive Moat

```
MOAT 1 — FOUNDER IS THE CUSTOMER
  Built by a photographer/filmmaker who lives the problem daily.
  Not a Silicon Valley team guessing at African creative needs.

MOAT 2 — FIRST MOVER IN SA
  No AI-powered creative production marketplace exists in SA.
  First to market with creators owns the network.

MOAT 3 — NETWORK EFFECTS
  More creators → more clients → more creators.
  Once 50 creators are on ThabangVision, a competitor needs
  to convince all 50 to switch. They won't.

MOAT 4 — CULTURAL CONTEXT
  Knows SA ceremonies (lobola, umembeso, matric dance).
  Knows township vs suburban pricing.
  Knows Johannesburg vs Cape Town vs Durban markets.
  No outsider startup understands this.

MOAT 5 — DATA MOAT
  Every booking, search, conversation, photo, and transaction
  builds a dataset no one else has.
  Year 3: the most comprehensive creative industry dataset in Africa.
  A competitor starting in Year 3 is millions of data points behind.
  They can copy the code. They can't copy the data.

MOAT 6 — UBUNYE AI
  AI trained on real SA creative industry conversations.
  Understands how South Africans describe what they want.
  Gets smarter with every interaction.
  No generic ChatGPT wrapper can replicate this contextual intelligence.
```

---

## Platform Evolution — The Autonomy Roadmap

### LEVEL 0 — MANUAL (where you started)

```
Status: COMPLETED
Everything done by hand.
WhatsApp to book, manual invoicing, bank transfers.
No platform, no automation, no data.
```

### LEVEL 1 — AWARE (V3 — current)

```
Status: ACTIVE
Platform exists and is operational.
You deploy, you fix, you monitor.
Claude Code builds what you tell it.

What exists:
  Live website on Vercel
  Auth (Google, magic link, password)
  Smart Rentals (gear listings)
  Ubunye Chat (AI assistant)
  Admin panel
  Brand identity
  Email routing
  Security hardening
  Company registered (Pty Ltd)
  Domain purchased

What's missing:
  Payment processing (Paystack — in progress)
  Business bank account (in progress)
  Booking system (TASK-039)
  Smart Productions service catalogue
  Customers
```

### LEVEL 2 — ALERTING (V3.5 — launch)

```
Status: NEXT
Platform tells you when something needs attention.

New capabilities:
  Cron: hourly health checks → email if service down
  Cron: daily maintenance → auto-cancel expired orders
  Cron: weekly reports → financial summary to admin
  AI budget alerts → email at 80% threshold
  Unassigned order alerts → email after 12 hours
  Overdue delivery alerts → email to admin + creator
  Payment failure alerts → email immediately

You still fix everything. But you know about problems in minutes, not days.

Trigger: first 10 bookings processed
```

### LEVEL 3 — SELF-HEALING (V4 — growth)

```
Status: PLANNED
Platform fixes common problems automatically.

New capabilities:
  Payout failed → auto-retry in 6 hours
  AI budget exceeded → auto-downgrade to cheaper model
  Cache full → auto-clean expired entries
  Creator didn't respond → auto-reassign after 48 hours
  Client didn't respond → auto-approve after 7 days
  Unpaid order → auto-cancel after 72 hours
  Service temporarily down → auto-retry with exponential backoff
  Broken image detected → flag and hide from public

You handle edge cases only. Platform handles the predictable problems.

New features:
  Creator matching (AI recommends, admin approves)
  Content generation (social posts from productions)
  EXIF analysis (auto-tag gear used in photos)
  Brief improver (AI asks clarifying questions for vague briefs)
  Model routing (simple chat → Gemini Flash, complex → Claude Sonnet)
  Semantic caching (don't pay twice for same answer)

Trigger: 50+ bookings, 20+ creators on platform
```

### LEVEL 4 — SELF-IMPROVING (V5 — scale)

```
Status: FUTURE
Platform learns from its own data and gets better over time.

New capabilities:
  Ubunye learns from conversation history → better recommendations
  Creator matching improves from booking outcomes → higher satisfaction
  Pricing adjusts based on supply/demand → market-rate intelligence
  Skills update themselves → what worked gets reinforced
  Cron jobs adjust schedules → based on activity patterns
  Fraud detection improves → learns from past verification decisions
  Email timing optimizes → sends when users are most likely to open

You set strategy. Platform executes and optimizes.

New features:
  Demand forecasting → "Wedding bookings will spike in October"
  Pricing optimizer → "Your rate is 15% below market, consider increasing"
  Portfolio curation → AI selects best photos from uploads
  Dispute mediation → AI suggests resolution based on precedent
  Creator churn prediction → "This creator hasn't logged in for 14 days"

Trigger: 6+ months of data, 200+ completed bookings
```

### LEVEL 5 — AUTONOMOUS (V6+ — dominance)

```
Status: FUTURE
Platform runs itself. You are the board, not the operator.

New capabilities:
  Detects new demand → suggests new production packages
  Finds creator gaps → recommends geographic recruitment areas
  Optimizes AI costs → auto-routes models based on performance data
  Generates reports → monthly SA Creative Industry Report, auto-published
  Handles disputes → using precedent from hundreds of past decisions
  Adjusts commission → dynamic pricing based on category and demand
  Manages creator lifecycle → onboarding, engagement, retention, reactivation

You make strategic decisions. Platform handles operations entirely.

New features:
  WhatsApp agent (Ubunye on WhatsApp)
  Voice interface (speak to Ubunye in any SA language)
  Multilingual dataset (first commercial SA language AI dataset)
  Report generator (quarterly industry reports)
  Upsell recommender (personalized add-on suggestions)
  Automated marketing (social posts, email campaigns, creator spotlights)

Trigger: 2+ years of data, 1000+ completed bookings, 100+ active creators
```

---

## Data Strategy — The Long Game

Every interaction builds a dataset no one else in South Africa has:

```
WHAT YOU COLLECT:
  Every page view, click, search query
  Every Ubunye conversation (topics, intent, language, sentiment)
  Every booking (category, price, location, dates, ratings)
  Every payment (amount, method, timing, refund rate)
  Every photo EXIF (camera, lens, settings, GPS, time)
  Every creator action (response time, delivery speed, quality rating)
  Every review (sentiment, topics, satisfaction signals)

WHAT IT BECOMES:

  YEAR 1 — Raw events → basic analytics dashboard
  YEAR 2 — Aggregated insights → "SA Creative Industry Report"
  YEAR 3 — Predictive models → demand forecasting per category
  YEAR 4 — AI training data → Ubunye trained on real SA conversations
  YEAR 5 — Data products → sell insights to brands, government, universities

POPIA COMPLIANCE:
  Raw data: anonymized before aggregating
  Individual data: never shared or sold
  Opt-out: users can disable analytics tracking
  Retention: raw events 24 months, aggregates forever
  ID documents: deleted 30 days after verification
  Reports: minimum group size of 10 for any published statistic
```

---

## AI Architecture

Two AI agents, not thirty-four. Skills loaded on demand. Tools do the work.

```
LAYER 1 — CRON JOBS (no AI cost):
  Daily maintenance (cleanup, auto-actions)
  Hourly checks (health, security, alerts)
  Weekly reports (financial, performance, growth)

LAYER 2 — MCP TOOLS (no AI cost):
  Supabase (database operations)
  Paystack (payments, transfers, refunds)
  Cloudinary (image management)
  Email (templated notifications)
  Analytics (query platform data)
  Booking (search, availability, pricing)

LAYER 3 — SKILLS (loaded on demand):
  booking, quoting, matching, verification
  production, rental, analytics, compliance, support

LAYER 4 — AI AGENTS (only 2):
  Ubunye: chat | booking | support | analysis modes
  Vision: verification | EXIF | portfolio curation

COST TARGET:
  V3:   R1,500/month (3 active capabilities)
  V4:   R3,000/month (full skill library + caching)
  V5:   R5,000/month (learning + forecasting)
  V6:   R8,000/month (full autonomy)
  Rule: AI cost must stay under 25% of platform commission
```

---

## Technology Stack

```
Frontend:        Next.js 16, React 19, TypeScript 5, Tailwind v4
Backend:         Next.js API routes, Vercel serverless
Database:        Supabase (PostgreSQL + Auth + Storage + RLS)
AI:              Anthropic Claude API (via Vercel AI SDK)
                 Google Gemini Flash (cheap model for simple tasks)
Payments:        Paystack (inline checkout, transfers, refunds)
Images:          Cloudinary (upload, transform, deliver)
Email:           Cloudflare email routing → Gmail
Domain:          thabangvision.com (Cloudflare)
Hosting:         Vercel (auto-deploy from GitHub)
Dev tools:       Claude Code, Supabase MCP, GitHub
Analytics:       Custom (platform_events table + logEvent())
```

---

## Ubunye AI — The Intelligence Layer

Ubunye is not a chatbot. It's the intelligence that connects the entire platform:

```
FOR CLIENTS:
  Answer questions about services and pricing
  Collect project briefs through conversation
  Calculate quotes with VAT
  Match clients to the right creator
  Guide through booking and payment
  Handle support and disputes

FOR CREATORS:
  Market intelligence ("your rate vs market average")
  Demand signals ("wedding bookings up 40% this month")
  Portfolio feedback ("your best-performing work is...")
  Skill recommendations ("clients are looking for drone operators")

FOR THE PLATFORM:
  Conversation analytics (what do clients actually want?)
  Intent detection (browsing vs buying vs complaining)
  Language data (how South Africans describe creative needs)
  Product gaps (what clients ask for that doesn't exist yet)
  Quality signals (sentiment analysis on reviews)

FUTURE — UBUNYE STANDALONE:
  Ubunye AI as a separate product for education (underserved communities)
  WhatsApp-based AI tutor
  SA language dataset powers other AI applications
  Separate brand from ThabangVision (per Chris's recommendation)
  Funding target: Chat for Learning & AI Accelerator 2026 (Turn.io)
```

---

## Go-To-Market Strategy

### Phase 1 — You Are The Platform (Week 1-4)

```
You are the first creator.
You are the first listing.
You are the proof it works.

Actions:
  Register as creator, verify yourself
  List all your gear
  Add your productions to portfolio
  Post daily on Instagram @thabangvision
  WhatsApp status: platform screenshots
  Share link with 20 people personally
  DM past clients: "I'm now booking through my platform"
```

### Phase 2 — First 5 Creators (Week 2-6)

```
DM 5 photographer/filmmaker friends:
  "I built a platform where clients find and book you.
   Free to join. You keep 85% of every booking.
   You'd be one of the first 5 verified creators."

Offer: first movers get featured on homepage.
No payment to creators. The platform IS the value.
```

### Phase 3 — First 10 Clients (Week 4-8)

```
Post: "Launch special — first booking gets 1 free hour"
DM people who've asked you for shoots before
Ask girlfriend to share in film industry WhatsApp groups
Ask Chris to share with his network

Every completed booking → ask client to share
Every new creator → they bring their own clients
```

### Phase 4 — Growth Engine (Month 3+)

```
Every booking = data
Every creator = brings their clients
Every client = may become repeat
Every review = social proof
Every production = portfolio proof
Every Instagram post = discovery

Network effects compound.
At 50 creators, the platform sells itself.
```

---

## Financial Targets

```
MONTH 1:    1 booking        = R2,250 commission (on R15,000 avg booking)
MONTH 3:    5 bookings/month = R11,250 commission
MONTH 6:    20 bookings/month = R45,000 commission
YEAR 1:     50 bookings/month = R112,500 commission
YEAR 2:     150 bookings/month = R337,500 commission + data revenue
YEAR 3:     500 bookings/month = R1,125,000 commission + data products + subscriptions

BREAK-EVEN:
  Fixed costs: ~R5,000/month (Vercel Pro, Supabase Pro, Claude API, domain, email)
  Need: 3 bookings/month at R15,000 avg to cover costs
  After 3 bookings: everything is profit
```

---

## Funding & Acceleration Targets

```
MOST ALIGNED:
  Chat for Learning & AI Accelerator 2026 (Turn.io)
  Supported by Bill & Melinda Gates Foundation + Anthropic
  Focus: Ubunye as educational AI for underserved communities

LOWEST BARRIER:
  UNDP timbuktoo EdTech Accelerator 2026
  Focus: African startups, early stage

ALSO TARGETING:
  Google for Startups Accelerator Africa
  AlphaCode (Rand Merchant Investments)
  4Di Capital
  Uprise.Africa
  Mastercard Foundation EdTech Fellowship (Injini)

APPROACH:
  Apply with Ubunye AI as the standalone product (education focus)
  ThabangVision is the commercial proof that the AI works
  Separate brands, connected vision
```

---

## Team (Current and Future)

```
NOW:
  Thabang (you)      → CEO, photographer, sole operator
  Claude (AI)         → CTO, architecture
  Claude Code (AI)    → Engineering team
  Chris              → Advisor, product feedback

YEAR 1 HIRES (when revenue supports):
  1. Creator Success Manager → onboard and support creators
  2. Operations Assistant → handle admin, payouts, support tickets

YEAR 2 HIRES:
  3. Marketing Lead → social media, partnerships, growth
  4. Head of Film (girlfriend?) → film industry partnerships

YEAR 3 HIRES:
  5. Data Analyst → run data products, generate reports
  6. Senior Engineer → take over from Claude Code for complex features
```

---

## Key Principles

```
1.  SHIP BEFORE PERFECT — a working platform with 1 booking beats
    a perfect platform with 0 bookings

2.  PLATFORM INTEGRITY OVER UX — protect the 15% commission model
    (no social links on profiles, booking through platform only)

3.  DATA IS THE REAL PRODUCT — the marketplace generates revenue,
    the data generates long-term value

4.  AI IS INFRASTRUCTURE, NOT A FEATURE — Ubunye powers everything
    but isn't the hero message for clients

5.  CULTURAL CONTEXT IS THE MOAT — understanding SA ceremonies,
    pricing, languages, and creative culture can't be copied

6.  TRANSPARENT DATA COLLECTION — share the value with creators,
    never sell individual data, POPIA compliant from day one

7.  AUTONOMOUS BY DESIGN — architect for self-healing today
    so the platform can run itself in 3 years

8.  NETWORK EFFECTS WIN — every creator and client makes the
    platform more valuable for the next one

9.  REVENUE BEFORE FUNDING — prove the model works with
    paying customers before seeking investment

10. SIMPLICITY ALWAYS — fixed prices, clear commission,
    one-click booking, inline payment, auto-payout
```

---

## For Claude Code

When building any feature for ThabangVision, reference this strategy document and the relevant SKILL files:

```
docs/processes/smart-productions.md             → service catalogue
docs/processes/client-payment-process.md        → how clients pay
docs/processes/creator-payout-process.md        → how creators get paid
docs/processes/platform-data-engine.md          → data collection
docs/processes/ai-platform-architecture.md      → AI system design
```

Every feature should:
- Generate revenue or support revenue generation
- Collect data for the data engine
- Work within the AI architecture (skills + tools + cron, not new agents)
- Be simple for clients and creators to use
- Protect the 15% commission model
- Be POPIA compliant
- Pass npm run build and all existing tests
