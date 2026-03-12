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
├── ai/                   # AI provider abstraction
│   ├── types.ts
│   ├── anthropic.ts
│   ├── gemini.ts
│   ├── openai.ts
│   └── index.ts
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
- `v2/*` — V2 architecture branches
- `v3/*` — V3 intelligence branches
- Always branch from main, merge back only after build + tests pass

## Testing
- `npm run test` — vitest unit tests
- `npm run test:e2e` — playwright e2e tests
- `npm run build` — production build
- ALL THREE must pass before merging to main

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
