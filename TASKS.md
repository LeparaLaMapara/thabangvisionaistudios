# TASKS.md — Agent Teams Task Breakdown

## How This File Works

Each task has a unique ID, status, assignee field, and dependencies. Agent teammates should:
1. Claim a task by writing their name to the assignee field
2. Create a lock file: `tasks/locks/TASK-ID.lock`
3. Complete the work
4. Update status to `done`
5. Push changes

**Statuses:** `open` | `claimed` | `in-progress` | `done` | `blocked`

**IMPORTANT:** Read existing code before writing new code. Follow the patterns already established in `smartProductions.ts`, `smartRentals.ts`, and the admin CRUD pages. Do NOT reinvent patterns — extend them.

---

## Phase 0: Critical Fixes (DO FIRST)

### TASK-000: Fix Middleware Bug
- **Status:** open
- **Assignee:** —
- **Priority:** 🔴 CRITICAL
- **Dependencies:** none
- **Description:** Rename `proxy.ts` at project root to `middleware.ts`. This is the Supabase session refresh middleware that Next.js never loads because the filename is wrong. Without this, auth sessions don't refresh and users get silently logged out.

**Work:**
- Rename `proxy.ts` → `middleware.ts`
- Verify the middleware config matcher patterns are correct for the app's route structure
- Test that admin routes still require auth after the rename
- Test that public routes are unaffected

**Acceptance criteria:**
- [ ] File renamed to `middleware.ts`
- [ ] Supabase session refresh runs on every request
- [ ] Admin routes still protected
- [ ] No regression on public pages

---

### TASK-001: Migrate Careers Admin to Supabase
- **Status:** open
- **Assignee:** —
- **Priority:** 🔴 HIGH
- **Dependencies:** TASK-000
- **Description:** The careers admin page currently uses in-memory state — data resets on refresh. Migrate to Supabase following the exact pattern of Smart Productions and Smart Rentals.

**Work:**
- Extend the existing `careers` Supabase table with all needed columns (the table exists but may need: description, department, location, employment_type, requirements, salary_range, etc.)
- Create `lib/supabase/queries/careers.ts` following the pattern of `smartProductions.ts`
- Update `app/(admin)/admin/careers/` to use Supabase instead of in-memory state
- Update `app/(marketing)/careers/` to read from Supabase instead of `lib/data.ts`
- Add Cloudinary image upload if career listings need images

**Acceptance criteria:**
- [ ] Careers admin persists data in Supabase
- [ ] Public careers page reads from Supabase
- [ ] CRUD operations work (create, read, update, soft delete)
- [ ] Follows existing admin patterns (auth guard, form layout, etc.)

---

### TASK-002: Migrate Press Admin to Supabase
- **Status:** open
- **Assignee:** —
- **Priority:** 🔴 HIGH
- **Dependencies:** TASK-000
- **Description:** Same as TASK-001 but for Press. Currently in-memory only.

**Work:**
- Extend the existing `press` Supabase table with needed columns (content/body, author, excerpt, category, cover_public_id, gallery, etc.)
- Create `lib/supabase/queries/press.ts` following existing patterns
- Update `app/(admin)/admin/press/` to use Supabase
- Update `app/(marketing)/press/` to read from Supabase
- Add Cloudinary image upload for press article images

**Acceptance criteria:**
- [ ] Press admin persists data in Supabase
- [ ] Public press page reads from Supabase
- [ ] CRUD operations work with Cloudinary image support
- [ ] Follows existing admin patterns

---

## Phase 1: Shared Infrastructure for New Modules

### TASK-010: PayFast Integration Setup
- **Status:** open
- **Assignee:** —
- **Priority:** HIGH
- **Dependencies:** none
- **Description:** Set up PayFast for payments and marketplace transactions. PayFast is South Africa's most popular payment gateway — no monthly fees, supports cards, instant EFT, SnapScan, Zapper, Mobicred.

**Work:**
- No npm package needed — PayFast uses server-side form posts and ITN (Instant Transaction Notification) webhooks
- Create `lib/payfast.ts` with PayFast configuration (merchant ID, merchant key, passphrase, sandbox mode)
- Create ITN handler: `app/api/webhooks/payfast/route.ts` (validates signature, updates payment status)
- Handle PayFast ITN notifications: validate signature with passphrase, verify payment amount, update booking/order status
- Idempotent ITN processing — deduplicate by pf_payment_id
- Add PayFast env vars to `.env.local` (PAYFAST_MERCHANT_ID, PAYFAST_MERCHANT_KEY, PAYFAST_PASSPHRASE, NEXT_PUBLIC_PAYFAST_SANDBOX)

**Acceptance criteria:**
- [ ] PayFast client configured with sandbox mode
- [ ] ITN endpoint receives and validates PayFast notifications
- [ ] Event handlers stubbed for all needed event types
- [ ] Works in PayFast sandbox mode

---

### TASK-011: Build Shared UI Component Library
- **Status:** open
- **Assignee:** —
- **Priority:** HIGH
- **Dependencies:** none
- **Description:** `components/ui/` is empty. Build reusable components used across all modules. Use Tailwind v4. Support dark mode via next-themes.

**Components to build:**
- `Button` — primary, secondary, outline, danger variants + loading state
- `Input` — text, email, password, number with label and error states
- `Textarea` — with label and character count
- `Select` — dropdown with options
- `Card` — content card with image, title, description (extend existing project card patterns)
- `Modal` — dialog overlay with close button
- `Toast` — notification toasts (success, error, info)
- `Badge` — status badges (active, pending, completed, etc.)
- `Tabs` — tab navigation
- `DateRangePicker` — date range selection (for bookings)
- `Rating` — star rating display and input (for reviews)
- `Pagination` — page navigation
- `EmptyState` — empty content placeholders
- `LoadingSpinner` — loading states

**Acceptance criteria:**
- [ ] All components built with TypeScript props
- [ ] Responsive design (mobile-first)
- [ ] Dark mode compatible
- [ ] Consistent with existing Tailwind v4 styling

---

### TASK-012: User Profiles & Registration
- **Status:** open
- **Assignee:** —
- **Priority:** HIGH
- **Dependencies:** TASK-000
- **Description:** Currently only admin login exists. Build user registration and profile system for creators.

**Work:**
- Create `profiles` table in Supabase:
  ```
  id (uuid, FK to auth.users), display_name, bio, avatar_url, avatar_public_id,
  skills text[], social_links jsonb, location, phone, is_verified boolean,
  created_at, updated_at
  ```
- Create `lib/supabase/queries/profiles.ts`
- Build registration page at `app/(marketing)/register/page.tsx`
- Build Supabase trigger or API hook to auto-create profile on registration
- Build public profile page at `app/(platform)/creators/[id]/page.tsx`
- Build profile edit page at `app/(platform)/dashboard/profile/page.tsx`
- Build user dashboard layout at `app/(platform)/dashboard/layout.tsx`

**Acceptance criteria:**
- [ ] Users can register with email/password
- [ ] Profile auto-created on registration
- [ ] Users can edit their profile (name, bio, avatar, skills, social links)
- [ ] Public profile page shows user info and their productions
- [ ] Dashboard layout with sidebar navigation

---

### TASK-013: Wire Contact Form
- **Status:** open
- **Assignee:** —
- **Priority:** MEDIUM
- **Dependencies:** none
- **Description:** Contact form UI exists but doesn't actually send. Wire it up.

**Work:**
- Install Resend SDK (`resend`)
- Update `app/api/contact/route.ts` to send email via Resend
- Update contact page `handleSubmit` to call the API
- Add proper validation and error handling
- Add RESEND_API_KEY to env vars

**Acceptance criteria:**
- [ ] Contact form sends email to configured address
- [ ] Success/error feedback shown to user
- [ ] Basic spam protection (honeypot or rate limit)

---

## Phase 2: Smart Rentals — Booking System

### TASK-020: Booking Database Schema
- **Status:** open
- **Assignee:** —
- **Priority:** HIGH
- **Dependencies:** TASK-012
- **Description:** Create booking-related tables in Supabase.

**Tables:**
- `equipment_bookings`:
  ```
  id, user_id (FK profiles), rental_id (FK smart_rentals), start_date, end_date,
  total_price, deposit_amount, currency, status (pending/confirmed/active/completed/cancelled),
  notes, payfast_payment_id, created_at, updated_at, cancelled_at
  ```
- `booking_payments`:
  ```
  id, booking_id (FK equipment_bookings), payfast_payment_id, amount, currency,
  status (pending/succeeded/failed/refunded), created_at
  ```
- `invoices`:
  ```
  id, booking_id (FK equipment_bookings), invoice_number, amount, currency,
  status (draft/sent/paid), pdf_url, created_at
  ```

**RLS Policies:**
- Users can read/create their own bookings
- Users can read their own payments and invoices
- Admins can read/update all bookings

**Acceptance criteria:**
- [ ] All tables created with correct types, constraints, foreign keys
- [ ] RLS policies active
- [ ] TypeScript types added to `types/`

---

### TASK-021: Booking API
- **Status:** open
- **Assignee:** —
- **Priority:** HIGH
- **Dependencies:** TASK-020, TASK-010
- **Description:** Build booking system API endpoints.

**Work:**
- Create `lib/supabase/queries/bookings.ts`
- Build endpoints:
  - `GET /api/bookings` — list user's bookings
  - `POST /api/bookings` — create booking (validate availability, calculate total, create PayFast payment request)
  - `GET /api/bookings/[id]` — booking detail
  - `PUT /api/bookings/[id]` — update status (confirm, cancel)
  - `GET /api/rentals/[id]/availability?start=&end=` — check date availability

**Business Logic:**
- Double-booking prevention: query `equipment_bookings` for overlapping dates on same rental_id
- Total calculation: `price_per_day × days` or `price_per_week × weeks` (use cheaper option)
- Status flow: pending → confirmed (on payment) → active (on start_date) → completed (on end_date)
- Cancellation: refund logic based on time before start_date

**Acceptance criteria:**
- [ ] Availability check prevents double-booking
- [ ] Booking creates PayFast payment request
- [ ] PayFast ITN updates booking status on payment success
- [ ] All endpoints auth-protected

---

### TASK-022: Booking Frontend
- **Status:** open
- **Assignee:** —
- **Priority:** HIGH
- **Dependencies:** TASK-021, TASK-011
- **Description:** Build booking UI integrated into existing Smart Rentals pages.

**Work:**
- Add date range picker and "Book Now" button to `/smart-rentals/[category]/[slug]` page
- Show real-time availability calendar
- Checkout flow: select dates → review total → PayFast checkout redirect → confirmation
- Build `/dashboard/bookings` — user's booking list with status tabs
- Build `/dashboard/bookings/[id]` — booking detail with payment status and invoice download
- Build `/admin/bookings` — admin view of all bookings

**Acceptance criteria:**
- [ ] Date picker shows unavailable dates
- [ ] Booking checkout with PayFast payment works
- [ ] User can view their bookings in dashboard
- [ ] Admin can manage all bookings

---

## Phase 3: Marketplace

### TASK-030: Marketplace Database Schema
- **Status:** open
- **Assignee:** —
- **Priority:** HIGH
- **Dependencies:** TASK-012
- **Description:** Create marketplace tables in Supabase.

**Tables:**
- `listings`:
  ```
  id, user_id (FK profiles), type (gear/service), title, slug, description,
  price, pricing_model (hourly/daily/weekly/fixed), currency, category, sub_category,
  thumbnail_url, cover_public_id, gallery (jsonb), location, condition (for gear),
  is_published, is_featured, tags[], features[], created_at, updated_at, deleted_at
  ```
- `orders`:
  ```
  id, buyer_id (FK profiles), seller_id (FK profiles), listing_id (FK listings),
  status (pending/paid/in_progress/completed/disputed/cancelled), total, platform_fee,
  seller_payout, currency, payfast_payment_id, payfast_payout_ref,
  notes, created_at, updated_at
  ```
- `reviews`:
  ```
  id, order_id (FK orders), reviewer_id (FK profiles), reviewee_id (FK profiles),
  rating (1-5), comment, created_at, updated_at
  ```
- `subscription_plans`:
  ```
  id, name, slug, description, price, currency, interval (monthly/yearly),
  features jsonb, payfast_plan_id, is_active, created_at
  ```
- `subscriptions`:
  ```
  id, user_id (FK profiles), plan_id (FK subscription_plans),
  payfast_subscription_token, status (active/cancelled/past_due),
  current_period_start, current_period_end, created_at, updated_at
  ```

**Acceptance criteria:**
- [ ] All tables created with correct constraints
- [ ] RLS policies: listings readable by all, writable by owner; orders readable by buyer/seller; reviews readable by all
- [ ] TypeScript types added

---

### TASK-031: Marketplace API
- **Status:** open
- **Assignee:** —
- **Priority:** HIGH
- **Dependencies:** TASK-030, TASK-010
- **Description:** Build marketplace API endpoints.

**Work:**
- Create `lib/supabase/queries/marketplace.ts`
- Create `lib/supabase/queries/orders.ts`
- Create `lib/supabase/queries/reviews.ts`
- Build endpoints:
  - `GET /api/marketplace` — browse listings (search, filter by type/category/price, sort, paginate)
  - `GET /api/marketplace/[id]` — listing detail with reviews
  - `POST /api/marketplace` — create listing (auth required)
  - `PUT /api/marketplace/[id]` — update listing (owner only)
  - `DELETE /api/marketplace/[id]` — soft delete (owner only)
  - `POST /api/marketplace/[id]/order` — place order (creates PayFast payment)
  - `GET /api/orders` — user's orders (as buyer and seller)
  - `GET /api/orders/[id]` — order detail
  - `PUT /api/orders/[id]` — update order status
  - `POST /api/reviews` — leave review (after order completed)
  - `GET /api/subscriptions/plans` — list subscription plans
  - `POST /api/subscriptions` — subscribe (PayFast recurring billing)
  - `GET /api/subscriptions/me` — current subscription
  - `POST /api/subscriptions/cancel` — cancel subscription

**Business Logic:**
- PayFast processes full payment to platform, then platform manually pays out seller (90%) via bank transfer or PayFast split payments if available
- Order status flow: pending → paid → in_progress → completed / disputed
- Reviews only allowed on completed orders
- Subscription feature gating based on plan

**Acceptance criteria:**
- [ ] Listing CRUD working with Cloudinary image upload
- [ ] Orders with PayFast payments processed
- [ ] Reviews linked to completed orders
- [ ] Subscription management via PayFast recurring billing

---

### TASK-032: Marketplace Frontend
- **Status:** open
- **Assignee:** —
- **Priority:** HIGH
- **Dependencies:** TASK-031, TASK-011
- **Description:** Build marketplace frontend pages.

**Work:**
- Create `app/(platform)/marketplace/page.tsx` — browse listings with search/filters
- Create `app/(platform)/marketplace/[slug]/page.tsx` — listing detail with reviews, order button
- Create `app/(platform)/marketplace/new/page.tsx` — create listing form with Cloudinary upload
- Create `app/(platform)/dashboard/listings/page.tsx` — my listings
- Create `app/(platform)/dashboard/orders/page.tsx` — my orders (buying/selling tabs)
- Create `app/(platform)/pricing/page.tsx` — subscription plans comparison
- Follow existing route group patterns: `(platform)` for public, component patterns from Smart Rentals

**Acceptance criteria:**
- [ ] Marketplace browsable with filters and search
- [ ] Listing creation with image upload (follow admin/rentals pattern)
- [ ] Order placement with PayFast payment
- [ ] User dashboard shows listings and orders
- [ ] Pricing page with plan comparison and PayFast subscription checkout

---

## Phase 4: Polish & Integration

### TASK-040: Landing Page Enhancement
- **Status:** open
- **Assignee:** —
- **Priority:** MEDIUM
- **Dependencies:** TASK-022, TASK-032
- **Description:** Update the existing home page to showcase all modules including marketplace and booking.

**Work:**
- Add Marketplace section to home page
- Add rental booking CTA
- Update ServiceGrid if needed
- Ensure all CTAs link to real pages

---

### TASK-041: Fix Catalog Page
- **Status:** open
- **Assignee:** —
- **Priority:** MEDIUM
- **Dependencies:** none
- **Description:** `/catalog/[slug]` currently uses hardcoded data from `lib/data.ts`. Connect it to the `smart_rentals` Supabase table.

---

### TASK-042: Fix Social Links
- **Status:** open
- **Assignee:** —
- **Priority:** LOW
- **Dependencies:** none
- **Description:** Update `lib/constants.ts` to use real social media URLs instead of `#` placeholders.

---

### TASK-043: Error Handling & Loading States
- **Status:** open
- **Assignee:** —
- **Priority:** MEDIUM
- **Dependencies:** all other tasks
- **Description:** Add error boundaries, loading skeletons, and empty states across all new pages. Follow patterns of existing pages.

---

## Agent Team Structure

### Team Lead
- Reads CLAUDE.md and TASKS.md
- Analyzes existing codebase first
- Assigns tasks respecting dependencies
- Coordinates between teammates
- Reviews completed work for pattern consistency

### Teammate 1: Backend & Database Engineer
- TASK-000 (Middleware fix)
- TASK-001, TASK-002 (Careers/Press migration)
- TASK-010 (PayFast setup)
- TASK-020 (Booking schema)
- TASK-021 (Booking API)
- TASK-030 (Marketplace schema)
- TASK-031 (Marketplace API)
- TASK-012 (Profiles — database + queries)

### Teammate 2: Frontend Engineer
- TASK-011 (UI component library)
- TASK-012 (Profiles — registration + profile pages + dashboard layout)
- TASK-022 (Booking frontend)
- TASK-032 (Marketplace frontend)
- TASK-040 (Landing page update)
- TASK-041 (Fix catalog page)

### Teammate 3: Integration & Payments
- TASK-010 (PayFast — shared with Backend)
- TASK-013 (Contact form)
- TASK-021 (Booking API — PayFast integration parts)
- TASK-031 (Marketplace API — PayFast payment parts)
- TASK-042 (Social links)
- TASK-043 (Error handling & loading states)