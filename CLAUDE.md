# CLAUDE.md — Thabang Vision AI Studios

## Project Vision

Thabang Vision AI Studios is a **full-scale data engine for the creative space** in South Africa. It serves independent creators, students, and small production houses by combining production management, equipment rentals, a marketplace, and AI-powered tools into one integrated platform.

Part of the broader **UAIE (Ubunye AI Ecosystems)** vision — "Ubunye" meaning "oneness" in Zulu/Xhosa — reflecting digital inclusion and equitable access to creative tools.

---

## Tech Stack

- **Framework**: Next.js 16 (App Router), React 19, TypeScript 5
- **Styling**: Tailwind CSS v4, framer-motion
- **Database & Auth**: Supabase (@supabase/ssr) — email+password auth
- **Media Storage**: Cloudinary (signed server-side uploads)
- **AI**: Gemini AI (proxied via /api/gemini)
- **UI Libraries**: lucide-react, next-themes, react-dropzone, react-easy-crop
- **Payments**: PayFast (TO BE INTEGRATED — South Africa's most popular payment gateway, no monthly fees, supports cards, instant EFT, SnapScan, Zapper, Mobicred)
- **Deployment**: TBD (likely Vercel)

---

## Current Codebase State

### What's BUILT and WORKING ✅

**Smart Productions — Full CRUD:**
- Admin panel with Cloudinary image upload, cropping, gallery management
- Server-rendered public page with filtering
- Supabase queries: `getPublishedProductions`, `getProductionBySlug`

**Smart Rentals — Full CRUD:**
- Same admin capabilities as productions + category routing (`/smart-rentals/[category]/[slug]`)
- Supabase queries: `getPublishedRentals`, `getByCategory`, `getBySlug`

**Admin Dashboard:**
- Live KPIs from Supabase, activity feed, drafts panel, featured content grid
- Auth guard on all `/admin/*` routes

**Authentication:**
- Supabase email+password login at `/login`
- Auth guard protecting admin routes

**Cloudinary Pipeline:**
- Signed uploads via `/api/cloudinary/sign`
- Single-asset delete via `/api/cloudinary/delete`
- Folder delete via `/api/cloudinary/delete-folder`
- Upload helpers in `lib/cloudinary/upload.ts`

**Marketing Pages:**
- Home (Hero, ProjectGallery, ServiceGrid, TechArsenal)
- The Lab (`/lab`), Locations, Legal, Privacy, Technical Support
- All styled and functional

**Header/Navigation:**
- Animated lens logo, dark/light toggle, responsive dropdown nav

### What's BROKEN or MISSING ⚠️

| Issue | Severity | Details |
|-------|----------|---------|
| `proxy.ts` never loads | 🔴 CRITICAL | Must be renamed to `middleware.ts` at project root. Session refresh logic never runs — security vulnerability |
| Careers & Press admin | 🔴 HIGH | In-memory state only. Data resets on every page refresh. Needs Supabase tables + query functions |
| Careers & Press public pages | 🟡 MEDIUM | Read from `lib/data.ts` hardcoded mock, not Supabase |
| Contact form | 🟡 MEDIUM | `handleSubmit` fires `setTimeout` then sets "submitted", never calls `/api/contact` |
| `/api/contact` | 🟡 MEDIUM | Just `console.log` — no email provider (Resend/SendGrid) wired |
| `/catalog/[slug]` | 🟡 MEDIUM | Uses hardcoded `featuredEquipment` from `lib/data.ts`, not DB-backed |
| `components/ui/` | 🟡 LOW | Empty directory (just `.gitkeep`). No shared component library |
| Social links | 🟢 LOW | Footer/constants all point to `#` |
| Marketplace | 🔴 NOT BUILT | Entire module missing — peer-to-peer listings, orders, reviews, subscriptions |
| PayFast payments | 🔴 NOT BUILT | No payment integration yet — use PayFast (payfast.co.za) |
| Ubunye AI Studio | 🟡 MARKETING ONLY | Static page exists, no functional AI features |

---

## Existing Supabase Schema

### `smart_productions`
```
id, slug, title, client, year, project_type, sub_category, description,
video_provider, video_url, tags[], thumbnail_url, cover_public_id,
gallery (jsonb {url, public_id}[]), is_published, is_featured,
created_at, updated_at, deleted_at
```

### `smart_rentals`
```
id, slug, title, description, category, sub_category, brand, model,
price_per_day, price_per_week, deposit_amount, currency, thumbnail_url,
cover_public_id, gallery, is_available, quantity, is_published,
is_featured, is_archived, tags[], features[], rental_includes[],
metadata (jsonb), video_provider, video_url, video_id,
created_at, updated_at, deleted_at
```

### `press`
```
id, title, slug, is_published, is_featured, thumbnail_url,
updated_at, deleted_at
```

### `careers`
```
id, title, is_published, updated_at, deleted_at
```

**Tables that NEED to be created:** profiles, equipment_bookings, booking_payments, invoices, listings, orders, reviews, subscription_plans, subscriptions

---

## File Structure (Current)

```
app/
  (marketing)/           ← Public pages with Header + Footer
    page.tsx             ← Home (Hero, ProjectGallery, ServiceGrid, TechArsenal)
    lab/                 ← R&D division page
    careers/             ← Job listings (reads lib/data.ts — NOT Supabase)
    contact/             ← Contact form (NOT wired to API)
    press/               ← Press/news (reads lib/data.ts — NOT Supabase)
    locations/           ← Static locations page
    login/               ← Supabase email+password login
    legal/, privacy/, support/tech/  ← Static content pages

  (platform)/            ← Capability pages with Header + Footer
    smart-production/    ← Server → SmartProductionClient (Supabase live)
    smart-rentals/       ← Server → SmartRentalsClient (Supabase live) + [category]/[slug]
    ubunye-ai-studio/    ← Static marketing page
    resources/tools/     ← Full calculator suite (FOV, DoF, Power, Storage, Budget, Location)
    catalog/[slug]/      ← Hardcoded equipment detail (uses lib/data.ts, not real catalog)

  (admin)/               ← Auth-gated CMS
    admin/               ← Dashboard (live Supabase KPIs + activity feed)
    admin/projects/      ← Smart Productions CRUD + Cloudinary image upload/crop
    admin/rentals/       ← Smart Rentals CRUD + Cloudinary image upload/crop
    admin/careers/       ← Careers CRUD (⚠️ in-memory only, not Supabase)
    admin/press/         ← Press CRUD (⚠️ in-memory only, not Supabase)

  api/
    cloudinary/sign/           ← Generates signed upload params
    cloudinary/delete/         ← Deletes single asset
    cloudinary/delete-folder/  ← Deletes full folder
    contact/                   ← ⚠️ Stub — just console.logs
    gemini/                    ← Working Gemini AI proxy

components/
  layout/Header.tsx      ← Animated logo, dark mode, responsive nav
  layout/Footer.tsx      ← Footer with links
  layout/Providers.tsx   ← ThemeProvider wrapper
  admin/LogoutButton.tsx
  cinematic/ServiceGrid.tsx     ← Capabilities grid on home
  cinematic/TechnicalHUD.tsx    ← Equipment spec overlay
  projects/ProjectsComponents.tsx ← Filter bar + project cards
  ui/                    ← ⚠️ Empty (just .gitkeep)

lib/
  data.ts                ← Mock/seed data (equipment, projects, careers, press, rentals)
  constants.ts           ← Site name, navigation, social links
  cloudinary/upload.ts   ← uploadFile, uploadMany, smartProductionFolder
  supabase/client.ts     ← Browser Supabase client
  supabase/server.ts     ← Server Supabase client
  supabase/queries/smartProductions.ts  ← getPublishedProductions, getProductionBySlug
  supabase/queries/smartRentals.ts      ← getPublishedRentals, getByCategory, getBySlug

types/equipment.ts       ← Equipment, Project, RentalProduct, NavItem types
proxy.ts                 ← ⚠️ Must be renamed to middleware.ts (CRITICAL BUG)
```

---

## Coding Conventions (FOLLOW EXISTING PATTERNS)

### General
- TypeScript strict mode
- Functional components with React hooks
- App Router with route groups: `(marketing)`, `(platform)`, `(admin)`
- Server Components by default, Client Components with `"use client"` when needed
- Tailwind CSS v4 for styling
- framer-motion for animations
- Dark mode via next-themes

### API Routes
- Next.js Route Handlers in `app/api/`
- Signed Cloudinary uploads (never unsigned)
- Supabase server client for DB operations in API routes

### Database Patterns
- Supabase client from `lib/supabase/client.ts` (browser) and `lib/supabase/server.ts` (server)
- Query functions in `lib/supabase/queries/` — follow the pattern of `smartProductions.ts` and `smartRentals.ts`
- Soft deletes via `deleted_at` column (existing pattern)
- `is_published` and `is_featured` flags for content visibility
- Slug-based routing for public pages

### Admin Pattern
- All admin pages under `app/(admin)/admin/`
- Auth guard checks Supabase session
- CRUD pattern: list page → create/edit form → Cloudinary upload → save to Supabase
- Image cropping with react-easy-crop before upload

### Component Patterns
- Layout components in `components/layout/`
- Feature components in `components/[feature]/`
- Client components use `"use client"` directive
- Server components fetch data and pass to client components as props

---

## DO NOT TOUCH — Off-Limits Files & Pages

The following exist but are **NOT in scope for this build**. Do not modify, refactor, or reference them:

- `app/(platform)/resources/tools/` — entire tools/calculator suite (FOV, DoF, Power, Storage, Budget, Location Scout)
- Any files related to the tools page

---

## What Needs to Be Built (Priority Order)

### Priority 1: Critical Fixes
1. Rename `proxy.ts` → `middleware.ts` (security fix)
2. Migrate Careers admin to Supabase (create table columns, query functions, update admin page)
3. Migrate Press admin to Supabase (same pattern)

### Priority 2: Marketplace (New Module)
4. Create marketplace database tables (listings, orders, reviews, subscriptions)
5. Build Marketplace API routes
6. Build Marketplace frontend pages under `app/(platform)/marketplace/`
7. Integrate PayFast for payments (payfast.co.za — use sandbox mode for dev)

### Priority 3: Booking System for Smart Rentals
8. Create booking tables (equipment_bookings, booking_payments, invoices)
9. Build booking API with availability checking and double-booking prevention
10. Build booking frontend (date picker, checkout flow)
11. PayFast payment integration for rentals

### Priority 4: Profiles & User Accounts
12. Create profiles table
13. Build user profile pages (public portfolio, edit profile)
14. Build user dashboard (my bookings, my listings, my orders)

### Priority 5: Ubunye AI Engine (Phase 2)
15. Build chat interface component for AI agent
16. Connect to Claude/Gemini for platform actions (booking, invoicing, recommendations)
17. Future: Desktop app for creative tool guidance (screen vision + step-by-step help)

### Priority 6: Polish
18. Build shared UI component library in `components/ui/`
19. Wire contact form to email provider (Resend)
20. Fix social links in Footer
21. Connect `/catalog/[slug]` to real database
22. SEO optimization

---

## Environment Variables Required

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Cloudinary
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# Gemini AI
GEMINI_API_KEY=

# PayFast (TO BE ADDED)
PAYFAST_MERCHANT_ID=
PAYFAST_MERCHANT_KEY=
PAYFAST_PASSPHRASE=
NEXT_PUBLIC_PAYFAST_SANDBOX=true

# Email (TO BE ADDED)
RESEND_API_KEY=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## Key Business Logic

### Rental Booking Flow (To Be Built)
1. Creator browses equipment at `/smart-rentals` → selects item → picks dates
2. System checks `equipment_bookings` for date conflicts
3. Total calculated: `price_per_day × days` (or `price_per_week` if applicable)
4. Creator confirms → PayFast payment request created (redirect to PayFast checkout)
5. PayFast ITN (Instant Transaction Notification) confirms payment → booking confirmed → invoice auto-generated
6. Equipment availability updated

### Marketplace Transaction Flow (To Be Built)
1. Creator lists gear/service → listing goes live
2. Buyer places order → PayFast processes payment (redirect checkout)
3. Platform takes fee (10%) → PayFast split payment or manual payout to seller
4. Both parties can leave reviews after completion

### Existing Content Flow (Already Working)
1. Admin creates production/rental in admin panel
2. Uploads images via Cloudinary (with cropping)
3. Sets `is_published: true`
4. Content appears on public pages via server-rendered queries

---

## Target Users
- Independent creators and students (primary)
- Small production houses
- Freelance videographers, photographers, editors
- South African creative community