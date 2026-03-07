# Agent Teams Launch Guide

## Step 1: Enable Agent Teams

Add this to your Claude Code `settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

## Step 2: Place Files in Project Root

Copy `CLAUDE.md` and `TASKS.md` into the root of your `thabangvisionaistudios/` directory, alongside `package.json`.

## Step 3: Make sure your `.env.local` has all existing keys

```env
NEXT_PUBLIC_SUPABASE_URL=your_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_key
SUPABASE_SERVICE_ROLE_KEY=your_key
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=your_cloud
CLOUDINARY_API_KEY=your_key
CLOUDINARY_API_SECRET=your_secret
GEMINI_API_KEY=your_key
```

If you don't have Stripe keys yet, that's fine — the backend agent will stub those calls and they can be wired later.

## Step 4: Open Claude Code in your project directory and paste this prompt

---

```
Read CLAUDE.md and TASKS.md in this project root. These contain the complete vision, current codebase analysis, and task breakdown for Thabang Vision AI Studios.

CRITICAL: This is an EXISTING codebase with established patterns. Before writing ANY code, analyze:
- The admin CRUD pattern in app/(admin)/admin/projects/ and app/(admin)/admin/rentals/
- The Supabase query pattern in lib/supabase/queries/smartProductions.ts and smartRentals.ts
- The server → client component pattern in app/(platform)/smart-production/ and smart-rentals/
- The Cloudinary upload pattern in lib/cloudinary/upload.ts and app/api/cloudinary/
- The route group structure: (marketing), (platform), (admin)
- The existing types in types/equipment.ts

All new code MUST follow these existing patterns exactly.

Create an agent team with 3 teammates:

Teammate 1 — Backend & Database Engineer:
- Start with TASK-000: rename proxy.ts to middleware.ts (critical security fix)
- TASK-001 and TASK-002: Migrate Careers and Press admin to Supabase. Follow the EXACT pattern of smartProductions.ts queries and the admin/projects CRUD page.
- TASK-010: Set up Stripe integration (lib/stripe.ts + webhook handler)
- TASK-012: Create profiles table and query functions
- TASK-020: Create booking tables (equipment_bookings, booking_payments, invoices)
- TASK-021: Build booking API with availability checking
- TASK-030: Create marketplace tables (listings, orders, reviews, subscriptions)
- TASK-031: Build marketplace API

Teammate 2 — Frontend Engineer:
- TASK-011: Build shared UI component library in components/ui/ (Tailwind v4, dark mode, framer-motion)
- TASK-012: Build registration page, user dashboard layout, profile pages
- TASK-022: Add booking UI to Smart Rentals detail pages + dashboard booking views
- TASK-032: Build marketplace pages (browse, detail, create listing, dashboard views, pricing)
- TASK-040: Update landing page to showcase new modules

Teammate 3 — Integration & Payments:
- TASK-013: Wire contact form to Resend email
- Stripe payment intents for rental bookings (coordinate with Teammate 1 on TASK-021)
- Stripe Connect for marketplace payouts (coordinate with Teammate 1 on TASK-031)
- Stripe Checkout for subscriptions
- TASK-041: Connect catalog page to real database
- TASK-043: Add error handling, loading states, empty states across new pages

All teammates: Claim tasks in TASKS.md before starting. Respect dependency order. Start with Phase 0 critical fixes, then Phase 1 infrastructure, then Phase 2 bookings and Phase 3 marketplace in parallel where possible.
```

---

## Step 5: Let it run

If you have tmux installed, each agent gets its own terminal panel so you can monitor progress. Without tmux, all output appears in a single thread.

Check progress by reviewing git commits in the morning.

## Troubleshooting

- **If agents can't access Supabase:** Make sure `.env.local` has all Supabase keys
- **If Stripe calls fail:** That's expected if you don't have Stripe keys yet. The agents should stub those endpoints.
- **If agents break existing pages:** They should be reading existing code first. If this happens, revert the commit and re-prompt with more specific instructions about preserving existing functionality.
