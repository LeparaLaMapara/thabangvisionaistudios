# TODO_BY_THABANG.md — Manual Tasks

Tasks that only Thabang can do — not automatable by Claude Code.

## Before Session 1
- [ ] Copy CLAUDE.md, MEMORY.md, AGENT_HARNESS.md, CODEOWNERS to repo root
- [ ] Copy .claude/commands/ folder to repo
- [ ] Copy tasks/ folder to repo
- [ ] Copy .github/workflows/ci.yml (update, don't replace if existing)
- [ ] Copy .env.example to repo
- [ ] Push to main: `git add -A && git commit -m "chore: add agent harness and task system" && git push`

## Environment Setup
- [ ] Add ANTHROPIC_API_KEY to Vercel env vars (Production + Preview)
- [ ] Add AI_PROVIDER=anthropic to Vercel
- [ ] Add PAYMENT_PROVIDER=payfast to Vercel
- [ ] Add STORAGE_PROVIDER=cloudinary to Vercel
- [ ] Add EMAIL_PROVIDER=gmail to Vercel
- [ ] Add SEARCH_PROVIDER=supabase to Vercel
- [ ] Add RAG_ENABLED=false to Vercel
- [ ] Add OPENAI_API_KEY to .env.local and Vercel (for embeddings)
- [ ] Set up Gmail app password (myaccount.google.com → Security → App Passwords)
- [ ] Add GMAIL_USER and GMAIL_APP_PASSWORD to .env.local and Vercel

## Supabase SQL (run in SQL Editor)
- [ ] Run pgvector setup:
  ```sql
  create extension if not exists vector;
  alter table smart_rentals add column if not exists embedding vector(1536);
  alter table smart_productions add column if not exists embedding vector(1536);
  alter table profiles add column if not exists embedding vector(1536);
  alter table press add column if not exists embedding vector(1536);
  alter table careers add column if not exists embedding vector(1536);
  ```
- [ ] Run match_content function (see AGENT_HARNESS.md)
- [ ] Run unified marketplace migration (after Session 8):
  ```sql
  alter table smart_rentals add column if not exists owner_type text default 'studio';
  alter table smart_rentals add column if not exists owner_id uuid references profiles(id);
  alter table smart_rentals add column if not exists ranking_score numeric default 0;
  alter table smart_rentals add column if not exists total_rentals integer default 0;
  alter table smart_rentals add column if not exists average_rating numeric default 0;
  alter table smart_rentals add column if not exists is_featured boolean default false;
  alter table smart_rentals add column if not exists review_count integer default 0;
  ```

## GitHub Settings
- [ ] Enable branch protection on main (Settings → Branches → main):
  - Require PR reviews before merging
  - Require status checks to pass (CI)
  - Require branches to be up to date before merging
- [ ] Add all env var secrets to GitHub (Settings → Secrets → Actions)

## Domain & Email
- [ ] Buy thabangvisionlabs.com on Cloudflare (~R180/year)
- [ ] Set up Cloudflare DNS pointing to Vercel
- [ ] Set up Cloudflare Email Routing:
  - info@thabangvisionlabs.com → Gmail
  - support@thabangvisionlabs.com → Gmail
  - press@thabangvisionlabs.com → Gmail
  - careers@thabangvisionlabs.com → Gmail
- [ ] Set up Gmail filters for +aliases (support, press, careers, bookings, verify)

## Content
- [ ] Fill in STUDIO.legal.registrationNumber in constants.ts
- [ ] Replace Unsplash placeholder images with real production photos
- [ ] Add real social media URLs to constants.ts (currently only Instagram)
- [ ] Create subscription_plans table in Supabase with real plan data
- [ ] Bulk upload remaining gear from rate card (after SQL script is ready)
- [ ] Add real client testimonials (after first paid projects)

## After V3 Complete
- [ ] Run /api/admin/reindex to generate embeddings for all content
- [ ] Test Ubunye with real questions on live site
- [ ] Set RAG_ENABLED=true when ready to switch from prompt stuffing to vector search

## AFTER chnaging domain name to thabangvision.com
1. Vercel → Domains:
   thabangvision.com
   www.thabangvision.com (redirects to thabangvision.com)

2. Vercel env var:
   NEXT_PUBLIC_APP_URL=https://thabangvision.com

3. Supabase → URL Configuration:
   Site URL: https://thabangvision.com
   Redirect URLs: https://thabangvision.com/**

4. Google Cloud → OAuth Client:
   Add: https://thabangvision.com to authorized origins