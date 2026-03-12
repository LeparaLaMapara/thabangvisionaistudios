# MEMORY.md — ThabangVision Labs Session Log

## Current Version: V2 (In Progress)

## Completed
- V1 shipped: 30+ pages, admin panel, Supabase auth, PayFast, Ubunye basic chat, 44 tests, CI/CD
- Security audit: SECURITY.md created with 29 findings (4 critical, 10 high, 9 medium, 6 low)
- Constants.ts: STUDIO + PRODUCTION_SERVICES as single source of truth
- Ubunye context-aware prompt designed (not yet implemented)
- Rate card digitized: photography R1,500/hr, cinematography R2,850/hr, post R650/hr

## Session Log

### Session 1 — Security Fixes
- Date:
- Branch: v2/security-fixes
- Status: NOT STARTED
- Scope: C1 (middleware), C2 (admin API auth), C3 (admin role check), C4 (cloudinary auth), H1 (gemini auth + rate limit), H2 (search sanitization), H10 (social link XSS)
- Changes:
- Tests:
- Issues:

### Session 2 — AI Abstraction Layer
- Date:
- Branch: v2/ai-abstraction
- Status: NOT STARTED
- Scope: lib/ai/ with Anthropic, Gemini, OpenAI providers. Update chat route.
- Changes:
- Tests:
- Issues:

### Session 3 — Payment + Storage + Email Abstraction
- Date:
- Branch: v2/payment-storage-email
- Status: NOT STARTED
- Scope: lib/payments/, lib/storage/, lib/email/. Update API routes.
- Changes:
- Tests:
- Issues:

### Session 4 — Mobile Nav + Dark Mode + Fonts
- Date:
- Branch: v2/mobile-theme
- Status: NOT STARTED
- Scope: Mobile menu rebuild, dark mode lock, next/font, touch targets.
- Changes:
- Tests:
- Issues:

### Session 5 — Context-Aware Ubunye + Streaming
- Date:
- Branch: v3/ubunye-context
- Status: NOT STARTED
- Scope: System prompt builder, streaming, markdown rendering, message limits.
- Changes:
- Tests:
- Issues:

### Session 6 — Vector Database Infrastructure
- Date:
- Branch: v3/vector-db
- Status: NOT STARTED
- Scope: lib/rag/ with embeddings, indexer, retrieval. Admin reindex route. RAG_ENABLED=false.
- Prereq: Thabang runs pgvector SQL in Supabase first.
- Changes:
- Tests:
- Issues:

### Session 7 — Smart Productions Redesign
- Date:
- Branch: v3/smart-productions
- Status: NOT STARTED
- Scope: Marketplace layout, photography + film divisions, packages, brief form, gear cross-sell.
- Changes:
- Tests:
- Issues:

### Session 8 — Unified Gear Marketplace
- Date:
- Branch: v3/gear-marketplace
- Status: NOT STARTED
- Scope: Merge listings into smart_rentals, ranking system, badges, sort options.
- Prereq: Thabang runs unified-marketplace.sql in Supabase first.
- Changes:
- Tests:
- Issues:

## Manual Tasks (Thabang)
- [ ] Run pgvector SQL in Supabase SQL Editor
- [ ] Run unified-marketplace.sql in Supabase SQL Editor
- [ ] Add OPENAI_API_KEY to .env.local and Vercel
- [ ] Add all provider env vars to Vercel
- [ ] Run /api/admin/reindex after adding OpenAI key
- [ ] Fill in STUDIO.legal.registrationNumber
- [ ] Replace Unsplash images with real photos
- [ ] Set up Gmail app password for Nodemailer
- [ ] Buy domain: thabangvisionlabs.com on Cloudflare
- [ ] Set up Cloudflare email routing
- [ ] Add real social media URLs to constants.ts
