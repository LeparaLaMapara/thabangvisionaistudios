# Backend Analysis & Environment Split Plan

**Date:** 2026-03-22
**Scope:** Database-frontend alignment audit + prod/non-prod environment strategy

---

## Part 1: Frontend ↔ Backend Table Alignment

### Tables That Match (Frontend page → DB table)

| Frontend Page/Feature | DB Table | Status |
|---|---|---|
| Smart Productions (`/smart-production`) | `smart_productions` | ✅ Aligned |
| Smart Rentals (`/smart-rentals`) | `smart_rentals` | ✅ Aligned |
| Careers (`/careers`) | `careers` | ✅ Aligned |
| Press (`/press`) | `press` | ✅ Aligned |
| Marketplace (`/marketplace`) | `listings` + `orders` | ✅ Aligned |
| Dashboard Profile | `profiles` | ✅ Aligned |
| Dashboard Bookings | `equipment_bookings` + `booking_payments` | ✅ Aligned |
| Dashboard Gigs | `crew_requests` | ✅ Aligned |
| Dashboard Listings | `listings` | ✅ Aligned |
| Dashboard Orders | `orders` | ✅ Aligned |
| Dashboard Verification | `profiles` (verification columns) | ✅ Aligned |
| Dashboard Banking | `banking_details` | ✅ Aligned |
| Dashboard Cart | `cart_items` | ✅ Aligned |
| Dashboard Notifications | `notifications` | ✅ Aligned |
| Smart Creators (`/smart-creators`) | `profiles` (crew columns) | ✅ Aligned |
| Ubunye AI Chat | `ubunye_usage` | ✅ Aligned |
| Service Bookings (admin) | `bookings` | ✅ Aligned |
| Subscriptions/Pricing | `subscription_plans` + `subscriptions` | ✅ Aligned |

### Critical Issues Found

#### 1. BROKEN: `notifications.type` CHECK constraint
**Severity:** HIGH — inserts will fail silently
- Migration 010 defines CHECK with only: `gig_request`, `gig_confirmed`, `gig_declined`, `gig_completed`, `gig_cancelled`, `payment_received`
- Code inserts types NOT in CHECK: `booking_accepted`, `booking_rejected`, `booking_completed`, `booking_cancelled`, `payout_initiated`, `payout_completed`, `booking_reassigned`, `booking_admin_cancelled`, `booking_admin_completed`
- **Evidence:** 0 rows in notifications table confirms inserts are failing
- **Fix:** Expand CHECK constraint (see migration below)

#### 2. Dead Tables (exist in DB, no frontend reference)
| Table | Rows | Recommendation |
|---|---|---|
| `contact_messages` | 0 | DROP — contact form uses Resend email, never writes to DB |
| `smart_crews` | 0 | DROP — superseded by individual creator profiles |
| `smart_crew_members` | 0 | DROP — join table for dead smart_crews |

#### 3. Dead Columns (5 tables × 1 column each)
`embedding vector(1536)` exists on `profiles`, `smart_rentals`, `smart_productions`, `press`, `careers` but all embeddings go to `content_embeddings` table. DROP all 5.

#### 4. Review Table Redundancy
3 separate review tables (`reviews`, `crew_reviews`, `rental_reviews`) — all have 0 rows and are read-only in code. Service booking reviews live inline on `bookings.client_rating`/`client_review`. Consider consolidating or dropping the empty ones.

#### 5. Missing FK Indexes (performance)
15 foreign key columns have no index. High-priority ones with active data:
- `booking_payments.booking_id`
- `equipment_bookings.user_id`, `equipment_bookings.rental_id`
- `crew_requests.creator_id`
- `smart_rentals.owner_id`
- `listings.user_id`
- `cart_items.rental_id`

#### 6. RLS Status Unknown on 16 Tables
Tables created before the migration system may lack RLS. CRITICAL for: `profiles`, `equipment_bookings`, `booking_payments`, `orders`, `invoices`, `subscriptions`.

---

## Part 2: Prod / Non-Prod Environment Split

### Current State
- **1 Supabase instance** (`zbdsqvpxpsygbuqnuekm`) used for everything
- **1 Vercel deployment** (`nonprodthabangvisionaistudios.vercel.app`)
- **1 branch** (`main`) auto-deploys to Vercel
- `.env.local` has all keys (PayFast sandbox, Supabase, Cloudinary, etc.)
- No environment separation — dev work hits production data

### Recommended Architecture

```
┌─────────────────────────────────────────────────┐
│                    REPO (GitHub)                │
│                                                 │
│  main ──────► Vercel PROD ──► Supabase PROD     │
│                (thabangvision.com)               │
│                                                 │
│  develop ───► Vercel PREVIEW ──► Supabase DEV   │
│                (dev.thabangvision.vercel.app)    │
│                                                 │
│  feature/* ─► Vercel PREVIEW ──► Supabase DEV   │
│                (auto-generated URLs)             │
└─────────────────────────────────────────────────┘
```

### Step-by-Step Implementation

#### Phase 1: Create Supabase Dev Instance

1. **Create a new Supabase project** for dev/staging
   - Name: `thabangvision-dev`
   - Region: same as prod (for latency consistency)
   - This gives you a separate DB, auth, storage — completely isolated

2. **Run all migrations** on the new instance in order (001 → 017)
   - This ensures schema parity with prod
   - Seed with test data (not real user data)

3. **Set up storage buckets** on dev: `verifications`, `avatars`

4. **Configure auth providers** on dev Supabase:
   - Google OAuth with separate dev credentials
   - Email/password (same config)
   - Set redirect URLs to Vercel preview domains

#### Phase 2: Environment Variables

**File structure:**
```
.env.local              ← git-ignored, developer's local (points to DEV)
.env.example            ← checked in, documents all vars (no real values)
```

**Vercel environment variables (set in dashboard):**

| Variable | Production | Preview/Dev |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://zbdsqvpxpsygbuqnuekm.supabase.co` | `https://<dev-project>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | prod key | dev key |
| `SUPABASE_SERVICE_ROLE_KEY` | prod key | dev key |
| `PAYMENT_PROVIDER` | `payfast` | `payfast` |
| `PAYFAST_MERCHANT_ID` | prod ID | sandbox ID |
| `PAYFAST_MERCHANT_KEY` | prod key | sandbox key |
| `PAYFAST_PASSPHRASE` | prod passphrase | sandbox passphrase |
| `PAYFAST_SANDBOX` | `false` | `true` |
| `CLOUDINARY_CLOUD_NAME` | prod cloud | same (or separate dev cloud) |
| `CLOUDINARY_API_KEY` | prod key | dev key |
| `CLOUDINARY_API_SECRET` | prod secret | dev secret |
| `AI_PROVIDER` | `anthropic` | `anthropic` |
| `ANTHROPIC_API_KEY` | prod key | dev key (or same with lower limits) |
| `RESEND_API_KEY` | prod key | dev key (or omit — degrades to console.log) |
| `NODE_ENV` | `production` | `preview` |

**How to set in Vercel:**
- Go to Project Settings → Environment Variables
- For each var, set separate values for "Production" vs "Preview" environments
- Vercel automatically injects the right values per deployment

#### Phase 3: Branch Strategy

```
main (protected)
  ├── Production deployments only
  ├── Requires PR approval
  ├── Requires passing build + tests
  └── Auto-deploys to Vercel Production

develop
  ├── Integration branch for feature work
  ├── Auto-deploys to Vercel Preview (uses DEV Supabase)
  └── Merge to main via PR when stable

feature/*
  ├── Branch from develop
  ├── Auto-deploys to Vercel Preview (uses DEV Supabase)
  └── Merge to develop via PR

hotfix/*
  ├── Branch from main
  ├── Merge directly to main (urgent fixes)
  └── Cherry-pick back to develop
```

**GitHub branch protection rules for `main`:**
- Require PR reviews (1 approval)
- Require status checks: build, test, test:e2e
- No direct pushes
- No force pushes

#### Phase 4: Database Migration Workflow

**Problem:** Migrations are currently SQL files run manually in Supabase SQL editor.

**Solution:** Adopt Supabase CLI for migration management.

```bash
# Install Supabase CLI
npm install -D supabase

# Link to prod
npx supabase link --project-ref zbdsqvpxpsygbuqnuekm

# Link to dev (separate config)
npx supabase link --project-ref <dev-project-ref>
```

**Migration flow:**
1. Create migration: `npx supabase migration new <name>`
2. Write SQL in `supabase/migrations/<timestamp>_<name>.sql`
3. Test on dev: `npx supabase db push --linked` (targeting dev)
4. Verify in dev environment
5. After PR merge to main, run on prod: `npx supabase db push --linked` (targeting prod)

**Move existing migrations:**
```
lib/migrations/001-*.sql  →  supabase/migrations/20260312000001_pgvector_gemini.sql
lib/migrations/002-*.sql  →  supabase/migrations/20260312000002_unified_marketplace.sql
... etc
```

#### Phase 5: Seed Data for Dev

Create `supabase/seed.sql` with:
- Test profiles (not real users)
- Sample smart_rentals (5-10 items across categories)
- Sample smart_productions (2-3 projects)
- Sample press articles (1-2)
- Sample career listings (1-2)
- Test subscription plans (matching prod pricing)

This runs automatically on `supabase db reset`.

---

## Part 3: Immediate Migration (Run on Current Supabase)

### Migration 018: Database Cleanup

```sql
-- 018-database-cleanup.sql
-- Fixes critical issues found in DATABASE_AUDIT.md

-- ═══════════════════════════════════════════════════════════════
-- 1. FIX: notifications.type CHECK constraint (CRITICAL)
--    Current constraint blocks booking/payout notification types
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'gig_request', 'gig_confirmed', 'gig_declined', 'gig_completed',
    'gig_cancelled', 'gig_expired', 'payment_received',
    'booking_accepted', 'booking_rejected', 'booking_completed',
    'booking_cancelled', 'booking_reassigned',
    'booking_admin_cancelled', 'booking_admin_completed',
    'payout_initiated', 'payout_completed'
  ));

-- ═══════════════════════════════════════════════════════════════
-- 2. ADD: Missing FK indexes (performance)
-- ═══════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_booking_payments_booking ON booking_payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_equipment_bookings_user ON equipment_bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_equipment_bookings_rental ON equipment_bookings(rental_id);
CREATE INDEX IF NOT EXISTS idx_crew_requests_creator ON crew_requests(creator_id);
CREATE INDEX IF NOT EXISTS idx_smart_rentals_owner ON smart_rentals(owner_id);
CREATE INDEX IF NOT EXISTS idx_listings_user ON listings(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_id);
CREATE INDEX IF NOT EXISTS idx_orders_listing ON orders(listing_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan ON subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_invoices_booking ON invoices(booking_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_rental ON cart_items(rental_id);

-- ═══════════════════════════════════════════════════════════════
-- 3. DROP: Dead embedding columns (all use content_embeddings)
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE profiles DROP COLUMN IF EXISTS embedding;
ALTER TABLE smart_rentals DROP COLUMN IF EXISTS embedding;
ALTER TABLE smart_productions DROP COLUMN IF EXISTS embedding;
ALTER TABLE press DROP COLUMN IF EXISTS embedding;
ALTER TABLE careers DROP COLUMN IF EXISTS embedding;

-- ═══════════════════════════════════════════════════════════════
-- 4. DROP: Dead tables
-- ═══════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS smart_crew_members CASCADE;
DROP TABLE IF EXISTS smart_crews CASCADE;
DROP TABLE IF EXISTS contact_messages CASCADE;

-- ═══════════════════════════════════════════════════════════════
-- 5. DROP: Unused storage bucket
-- ═══════════════════════════════════════════════════════════════
-- Run manually in Supabase dashboard: delete bucket "bug-screenshots"

-- ═══════════════════════════════════════════════════════════════
-- 6. ADD: Missing FK on rental_reviews
-- ═══════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'rental_reviews_reviewer_id_fkey'
  ) THEN
    ALTER TABLE rental_reviews
      ADD CONSTRAINT rental_reviews_reviewer_id_fkey
      FOREIGN KEY (reviewer_id) REFERENCES profiles(id);
  END IF;
END $$;
```

### RLS Verification Query (run in SQL editor)
```sql
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

If any HIGH-sensitivity table shows `rowsecurity = false`, enable RLS and add policies immediately.

---

## Implementation Order

### Now (before env split)
1. [ ] Run migration 018 on current Supabase (fixes notifications, adds indexes, cleans dead tables)
2. [ ] Run RLS verification query and fix any missing policies
3. [ ] Create `.env.example` documenting all required env vars

### Week 1: Dev Environment
4. [ ] Create Supabase dev project
5. [ ] Run all migrations (001-018) on dev
6. [ ] Create seed.sql with test data
7. [ ] Set up Vercel environment variables (prod vs preview)
8. [ ] Create `develop` branch, set as default for PRs

### Week 2: Branch Protection & CI
9. [ ] Add GitHub branch protection on `main`
10. [ ] Set up Supabase CLI in the repo
11. [ ] Move migrations from `lib/migrations/` to `supabase/migrations/`
12. [ ] Update CLAUDE.md with new branch/env strategy
13. [ ] Test full flow: feature branch → develop → main

### Week 3: Polish
14. [ ] Consolidate review tables (reviews, crew_reviews, rental_reviews → single table)
15. [ ] Evaluate merging equipment_bookings + bookings
16. [ ] Add NOT NULL constraints on critical status columns
17. [ ] Set up Supabase database backups schedule
