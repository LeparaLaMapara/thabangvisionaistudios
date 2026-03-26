# CLAUDE.md — ThabangVision Labs

## Project Overview
AI-powered creative production and equipment rental platform for South African filmmakers and photographers.
Built by ThabangVision (Pty) Ltd, trading as ThabangVision Labs.

**Stack:** Next.js 16, React 19, TypeScript 5, Tailwind v4, Supabase, Cloudinary, PayFast, Anthropic Claude
**Repo:** https://github.com/LeparaLaMapara/thabangvision
**Live:** https://nonprodthabangvisionaistudios.vercel.app
**Supabase:** https://zbdsqvpxpsygbuqnuekm.supabase.co

## Architecture Rules

### Single Source of Truth
- ALL business info comes from `lib/constants.ts` (STUDIO, PRODUCTION_SERVICES)
- Never hardcode prices, phone numbers, emails, URLs, or business terms in any file
- If a value might change, it lives in constants.ts or Supabase — nowhere else

### Provider Abstraction
- ALL provider calls go through abstraction layers in `lib/` — never import SDKs directly in pages or API routes
- `lib/ai/` → AI providers (Anthropic, Gemini, OpenAI)
- `lib/payments/` → Payment providers (PayFast, Paystack)
- `lib/storage/` → Storage providers (Cloudinary, S3)
- `lib/email/` → Email providers (Gmail/Nodemailer, Resend)
- `lib/search/` → Search providers (Supabase, Algolia)
- Env vars control which provider is active:
  - `AI_PROVIDER=anthropic`
  - `PAYMENT_PROVIDER=payfast`
  - `STORAGE_PROVIDER=cloudinary`
  - `EMAIL_PROVIDER=gmail`
  - `SEARCH_PROVIDER=supabase`
  - `RAG_ENABLED=false`

### Authentication & Authorization
- Admin access controlled by `ADMIN_EMAILS` array in `lib/constants.ts`
- All `/api/admin/*` routes: check session AND check email in ADMIN_EMAILS
- All `/dashboard/*` routes: check session via middleware
- Ubunye chat: requires login (unauthenticated get 5 free messages)
- Cloudinary delete: admin only. Cloudinary sign: authenticated users only.

### Theming
- Dark theme ONLY — no light mode, no theme toggle, no "Switch to Light Mode"
- Background: #050505, accent: #D4A843 (warm gold)
- Never use bg-white, text-black, bg-gray-50 in any component

### Rendering Strategy
- `force-dynamic`: dashboard/, admin/, ubunye-ai-studio/, pricing/, api/ routes
- `revalidate = 60`: smart-rentals/, smart-production/, press/, careers/, contact, lab, home
- Static: legal/, privacy/, login/, register/
- No generateStaticParams anywhere

## File Ownership & Structure

```
lib/
├── constants.ts          # STUDIO, PRODUCTION_SERVICES, ADMIN_EMAILS — single source of truth
├── ai/                   # AI provider abstraction (Vercel AI SDK)
│   └── index.ts          # getModel() — returns provider based on AI_PROVIDER env var
├── payments/             # Payment provider abstraction
│   ├── types.ts
│   ├── payfast.ts
│   ├── paystack.ts
│   └── index.ts
├── storage/              # Storage provider abstraction
│   ├── types.ts
│   ├── cloudinary.ts
│   └── index.ts
├── email/                # Email provider abstraction
│   ├── types.ts
│   ├── gmail.ts
│   └── index.ts
├── search/               # Search provider abstraction
│   ├── types.ts
│   ├── supabase.ts
│   └── index.ts
├── rag/                  # Vector search infrastructure
│   ├── embeddings.ts
│   ├── indexer.ts
│   ├── retrieval.ts
│   └── index.ts
├── ubunye/               # Ubunye AI system prompt builder
│   └── system-prompt.ts
├── ranking/              # Gear marketplace ranking
│   └── calculate.ts
└── supabase/             # Supabase client helpers
    ├── client.ts
    └── server.ts
```

## Code Style

### TypeScript
- Strict mode
- Explicit types on function params and returns
- No `any` unless unavoidable — use `unknown` and narrow

### Imports
- Use `@/` path alias for all project imports
- Never import provider SDKs directly in pages — always through `lib/` abstraction
- Example: `import { ai } from '@/lib/ai'` NOT `import Anthropic from '@anthropic-ai/sdk'`

### API Routes
- Every route: check auth where needed, validate input, handle errors with try/catch
- Admin routes: check session + check ADMIN_EMAILS
- Return proper status codes: 200, 201, 400, 401, 403, 404, 429, 500
- Never expose stack traces to client in production

### Pricing
- All prices in ZAR
- Production rates come from PRODUCTION_SERVICES in constants.ts
- Equipment rates come from Supabase smart_rentals table
- VAT: PRODUCTION_SERVICES.billing.vatRate (currently 15%)
- Deposit: STUDIO.rental.depositPercent (currently 50%)

## Branch Strategy
- `main` — production, auto-deploys to Vercel
- `develop` — integration branch, auto-deploys to Vercel Preview (uses dev Supabase)
- `feature/*` — branch from develop, merge back via PR
- `hotfix/*` — branch from main for urgent fixes
- Always merge to main only after build + tests pass

## Testing
- `npm run test` — vitest unit tests
- `npm run test:e2e` — playwright e2e tests
- `npm run build` — production build
- ALL THREE must pass before merging to main

## Documentation
- `docs/processes/` — business process design docs (payment flows, payout logic, data engine, AI architecture, smart productions)
- `docs/tasks/` — task tracking (`done/` completed, `todo/` pending)
- `docs/design/` — historical design audits
- `docs/architecture.md` — provider abstraction layers
- `docs/security.md` — security audit and status
- `docs/strategy.md` — company vision, revenue model, platform roadmap

## Agent Teams

Use parallel agent teams when a task is large enough to benefit from concurrent work. Three teams are defined:

### Team: research
**When:** Any task that references a process doc or needs database/codebase context before coding.
**What:** Front-load all context gathering in parallel so coding starts immediately.
```
Spawn agents to read in parallel:
  - Relevant docs/processes/ files
  - Supabase table schemas (via MCP)
  - Existing code patterns in lib/ and app/
  - Related type definitions in types/
Return: summarized context to coordinator
```

### Team: build
**When:** A task touches 3+ independent file groups (e.g. API routes + frontend components + lib utilities).
**What:** Split work across isolated worktrees so agents code in parallel without conflicts.
```
Agent "api" (worktree):     API routes in app/api/
Agent "frontend" (worktree): Page components in app/
Agent "infra" (worktree):    Shared lib code, types, cron jobs, email templates
Coordinator:                 Merge worktrees, resolve conflicts, final integration
```
Each agent follows all CLAUDE.md rules independently. Each worktree must pass `npm run build` before merge.

### Team: qa
**When:** Every coding task. Run in background alongside build work.
**What:** Continuous quality checks that catch issues while code is still being written.
```
Background checks (run after each file change):
  - npm run build (type errors, import errors)
  - npm run test (regression)
  - /check-constants (no hardcoded business values)
  - /verify-abstractions (no direct SDK imports)
  - /security-check (no auth bypasses, no exposed secrets)
Report: flag issues immediately so the coding agent can fix inline
```

### Routing Rules
```
Task size < 3 files         → work solo (no teams)
Task size 3-6 files         → research + qa teams
Task size 7+ files          → research + build + qa teams
Task references process doc → always spawn research team
/pre-merge                  → qa team runs all checks in parallel
```

## Do NOT
- Modify files outside the scope of the current task
- Refactor working code that isn't part of the current task
- Add light mode or theme toggles
- Hardcode prices, emails, phone numbers, or URLs
- Import provider SDKs directly in pages (use lib/ abstraction)
- Remove or modify existing passing tests
- Change ADMIN_EMAILS without explicit instruction
- Expose user data to other users
- Include bank details in AI prompts
- Use `localStorage` or `sessionStorage` for auth (use Supabase session)
