# TASK-037: Crew & Services System
## Priority: HIGH | Phase: V3 | Depends on: TASK-036 (bugs fixed), verification system working
## Created: 2026-03-18 | Updated: 2026-03-18

---

## Pre-Session Setup

```
/new-session
```
Branch name: `feature/task-037-crew-system`

Read these files first:
```
Read CLAUDE.md
Read MEMORY.md
Read lib/constants.ts
Read lib/supabase/queries/ (all files)
Read lib/ubunye/system-prompt.ts
Read app/api/ubunye-chat/route.ts
Read app/(platform)/ (directory listing)
Read app/(admin)/ (directory listing)
Read app/(platform)/dashboard/ (directory listing)
```

---

## Context

Verified creators should appear as hireable crew on the platform. Clients discover and book crew through **Ubunye (the AI assistant)** — not through static forms. Ubunye searches crew, recommends matches, collects booking details conversationally, and submits the request. Admin acts as middleman — clients never contact creators directly.

The crew profile is NOT a separate upload — it auto-builds from data already on the platform: profile info, gear listings, productions they're tagged in, and reviews from completed gigs.

**Key architecture decision:** Crew booking flows through Ubunye via Vercel AI SDK **function calling** (tool use). This replaces the traditional form approach. The `/crew` pages exist for browsing, but the "Request This Creator" action opens the Ubunye chat with context pre-filled.

---

## Database Migrations

Create `lib/migrations/007-crew-system.sql`:

```sql
-- ═══ 1. Add crew columns to profiles ═══

alter table profiles add column if not exists
  available_for_hire boolean default false;

alter table profiles add column if not exists
  hourly_rate integer;

alter table profiles add column if not exists
  specializations text[] default '{}';

alter table profiles add column if not exists
  crew_slug text unique;

alter table profiles add column if not exists
  crew_bio text;

alter table profiles add column if not exists
  years_experience integer;

alter table profiles add column if not exists
  crew_featured boolean default false;

-- Index for crew queries
create index if not exists idx_profiles_crew
  on profiles (available_for_hire, verification_status)
  where available_for_hire = true and verification_status = 'verified';

-- ═══ 2. Add crew_ids to smart_productions (for tagging crew in portfolio) ═══

alter table smart_productions add column if not exists
  crew_ids uuid[] default '{}';

create index if not exists idx_productions_crew_ids
  on smart_productions using gin (crew_ids);

-- ═══ 3. Crew requests table ═══

create table if not exists crew_requests (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid references profiles(id) not null,
  client_name text not null,
  client_email text not null,
  client_phone text,
  project_type text not null,
  preferred_dates text,
  description text not null,
  budget_range text,
  location text,
  duration text,
  status text default 'pending'
    check (status in ('pending', 'contacted', 'confirmed', 'declined', 'completed', 'cancelled')),
  admin_notes text,
  commission_rate integer default 15,
  total_amount integer,
  commission_amount integer,
  booked_via text default 'ubunye',  -- 'ubunye' or 'manual' — tracks how the request was created
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table crew_requests enable row level security;

-- Admin can see all
create policy "Admins can manage crew requests" on crew_requests
  for all using (true);

-- Creators can see their own (without client contact info — handled in query)
create policy "Creators can view own requests" on crew_requests
  for select using (auth.uid() = creator_id);

-- Public can insert (submit a request — used by Ubunye tool calls)
create policy "Anyone can submit crew request" on crew_requests
  for insert with check (true);

-- ═══ 4. Smart crews (preset teams) ═══

create table if not exists smart_crews (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  description text,
  category text,
  package_rate integer,
  package_includes text,
  is_published boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table smart_crews enable row level security;

create policy "Public can view published crews" on smart_crews
  for select using (is_published = true);

create policy "Admins can manage crews" on smart_crews
  for all using (true);

-- ═══ 5. Smart crew members junction ═══

create table if not exists smart_crew_members (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid references smart_crews(id) on delete cascade not null,
  profile_id uuid references profiles(id) not null,
  role_in_crew text not null,
  unique (crew_id, profile_id)
);

alter table smart_crew_members enable row level security;

create policy "Public can view crew members" on smart_crew_members
  for select using (true);

create policy "Admins can manage members" on smart_crew_members
  for all using (true);

-- ═══ 6. Crew reviews ═══

create table if not exists crew_reviews (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references crew_requests(id) not null,
  creator_id uuid references profiles(id) not null,
  reviewer_name text not null,
  reviewer_email text not null,
  rating integer not null check (rating >= 1 and rating <= 5),
  review_text text,
  is_published boolean default false,
  created_at timestamptz default now()
);

alter table crew_reviews enable row level security;

create policy "Public can view published reviews" on crew_reviews
  for select using (is_published = true);

create policy "Anyone can insert review" on crew_reviews
  for insert with check (true);

create policy "Admins can manage reviews" on crew_reviews
  for all using (true);
```

---

## Implementation

### PART 1: Ubunye Crew Tools (Function Calling)

This is the core of the booking flow. Ubunye gets three tools via the Vercel AI SDK `streamText()` `tools` parameter. The model decides when to call them based on conversation context.

**How it works:**
```
Client: "I need a cinematographer for a music video in Braamfontein next weekend"
    ↓
Ubunye calls search_crew({ specialization: "cinematography", location: "johannesburg" })
    ↓
Tool runs Supabase query → returns matching creators to model
    ↓
Ubunye: "I found 2 cinematographers in Joburg — [Thabang M.](/crew/thabang-m) (R1,500/hr)
         and [Creator B](/crew/creator-b) (R1,200/hr). Want me to book one?"
    ↓
Client: "Book Thabang"
    ↓
Ubunye: "What's your name and email so the team can reach you?"
    ↓
Client: "Ntando, ntando@email.com"
    ↓
Ubunye calls submit_crew_request({ creator_id, client_name, client_email, ... })
    ↓
Tool inserts into crew_requests + sends admin email → returns confirmation
    ↓
Ubunye: "Done! ThabangVision will reach out within 24 hours."
```

#### 1A. Tool Definitions — `lib/ubunye/tools.ts`

Create this file with three tool implementations. Each tool receives a Supabase client (passed from the route handler).

**Tool 1: `search_crew`**
```typescript
import { tool } from 'ai';
import { z } from 'zod';

export const searchCrewTool = tool({
  description: 'Search for verified, available-for-hire crew members on the platform. Call this when a client describes what kind of creative professional they need.',
  parameters: z.object({
    specialization: z.string().optional().describe('Type of work: photography, cinematography, editing, sound, directing'),
    location: z.string().optional().describe('City or area, e.g. johannesburg, cape town'),
    budget_max: z.number().optional().describe('Maximum hourly rate in ZAR'),
  }),
  execute: async ({ specialization, location, budget_max }, { supabase }) => {
    let query = supabase
      .from('profiles')
      .select(`
        id, display_name, crew_slug, avatar_url, crew_bio,
        specializations, hourly_rate, location, years_experience,
        crew_featured
      `)
      .eq('verification_status', 'verified')
      .eq('available_for_hire', true)
      .order('crew_featured', { ascending: false })
      .limit(5);

    if (specialization) {
      query = query.contains('specializations', [specialization]);
    }
    if (location) {
      query = query.ilike('location', `%${location}%`);
    }
    if (budget_max) {
      query = query.lte('hourly_rate', budget_max);
    }

    const { data, error } = await query;
    if (error) return { error: error.message };
    if (!data || data.length === 0) return { results: [], message: 'No crew found matching your criteria.' };

    return {
      results: data.map(c => ({
        id: c.id,
        name: c.display_name,
        slug: c.crew_slug,
        specializations: c.specializations,
        hourly_rate: c.hourly_rate,
        location: c.location,
        years_experience: c.years_experience,
        featured: c.crew_featured,
        bio: c.crew_bio,
        profile_url: `/crew/${c.crew_slug}`,
      })),
    };
  },
});
```

**Tool 2: `get_crew_detail`**
```typescript
export const getCrewDetailTool = tool({
  description: 'Get full details about a specific crew member including their equipment, recent work, and reviews. Call this when a client asks about a specific creator.',
  parameters: z.object({
    crew_slug: z.string().describe('The crew slug from the search results'),
  }),
  execute: async ({ crew_slug }, { supabase }) => {
    const { data: creator } = await supabase
      .from('profiles')
      .select('*')
      .eq('crew_slug', crew_slug)
      .eq('verification_status', 'verified')
      .eq('available_for_hire', true)
      .single();

    if (!creator) return { error: 'Creator not found or not available.' };

    // Fetch gear, productions, reviews in parallel
    const [gear, productions, reviews] = await Promise.all([
      supabase
        .from('smart_rentals')
        .select('id, title, slug, category, price_per_day')
        .eq('owner_id', creator.id)
        .eq('is_published', true)
        .limit(5),
      supabase
        .from('smart_productions')
        .select('id, title, slug, project_type')
        .contains('crew_ids', [creator.id])
        .limit(5),
      supabase
        .from('crew_reviews')
        .select('rating, review_text, reviewer_name, created_at')
        .eq('creator_id', creator.id)
        .eq('is_published', true)
        .order('created_at', { ascending: false })
        .limit(5),
    ]);

    const ratings = reviews.data?.map(r => r.rating) ?? [];
    const avgRating = ratings.length > 0
      ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
      : null;

    return {
      creator: {
        id: creator.id,
        name: creator.display_name,
        slug: creator.crew_slug,
        bio: creator.crew_bio || creator.bio,
        specializations: creator.specializations,
        hourly_rate: creator.hourly_rate,
        location: creator.location,
        years_experience: creator.years_experience,
        profile_url: `/crew/${creator.crew_slug}`,
        avg_rating: avgRating,
        total_reviews: ratings.length,
      },
      equipment: gear.data?.map(g => ({
        title: g.title,
        rate: g.price_per_day,
        url: `/smart-rentals/${g.category}/${g.slug}`,
      })) ?? [],
      recent_work: productions.data?.map(p => ({
        title: p.title,
        type: p.project_type,
        url: `/smart-production/${p.slug}`,
      })) ?? [],
      reviews: reviews.data ?? [],
    };
  },
});
```

**Tool 3: `submit_crew_request`**
```typescript
export const submitCrewRequestTool = tool({
  description: `Submit a crew booking request. ONLY call this after you have ALL required info AND the client has explicitly confirmed they want to book. Required: creator_id, client_name, client_email, project_type, description. Ask for missing fields conversationally before calling this tool.`,
  parameters: z.object({
    creator_id: z.string().uuid().describe('The creator UUID from search results'),
    client_name: z.string().min(1).describe('Client full name'),
    client_email: z.string().email().describe('Client email address'),
    client_phone: z.string().optional().describe('Client phone number'),
    project_type: z.string().describe('photography, cinematography, wedding, corporate, music_video, event, documentary, content_creation, other'),
    preferred_dates: z.string().optional().describe('When the client needs the work done'),
    location: z.string().optional().describe('Where the shoot will happen'),
    duration: z.string().optional().describe('half_day, full_day, multi_day'),
    description: z.string().min(20).describe('What the client needs — min 20 characters'),
    budget_range: z.string().optional().describe('under_5k, 5k_15k, 15k_50k, 50k_plus, flexible'),
  }),
  execute: async (params, { supabase, email }) => {
    // Insert the crew request
    const { data, error } = await supabase
      .from('crew_requests')
      .insert({
        creator_id: params.creator_id,
        client_name: params.client_name,
        client_email: params.client_email,
        client_phone: params.client_phone || null,
        project_type: params.project_type,
        preferred_dates: params.preferred_dates || null,
        location: params.location || null,
        duration: params.duration || null,
        description: params.description,
        budget_range: params.budget_range || null,
        booked_via: 'ubunye',
      })
      .select('id')
      .single();

    if (error) return { error: 'Failed to submit request. Please try again.' };

    // Send admin notification email (fire and forget)
    try {
      const { sendEmail } = await import('@/lib/email');
      await email.send({
        to: STUDIO.bookingEmail,
        subject: `New crew request: ${params.project_type} — ${params.client_name}`,
        text: `A new crew request was submitted via Ubunye.\n\nClient: ${params.client_name} (${params.client_email})\nProject: ${params.project_type}\nDates: ${params.preferred_dates || 'TBD'}\nLocation: ${params.location || 'TBD'}\nBudget: ${params.budget_range || 'Not specified'}\n\nDescription:\n${params.description}\n\nView in admin: /admin/crew-requests`,
      });
    } catch {
      // Email failure shouldn't block the booking
    }

    return {
      success: true,
      request_id: data.id,
      message: `Request submitted successfully. ThabangVision will review and reach out to ${params.client_name} within 24 hours.`,
    };
  },
});
```

#### 1B. Wire Tools into Ubunye Chat Route — `app/api/ubunye-chat/route.ts`

Update the existing `streamText()` call to include the crew tools:

```typescript
import { searchCrewTool, getCrewDetailTool, submitCrewRequestTool } from '@/lib/ubunye/tools';

// ... existing code ...

const result = streamText({
  model: getModel(),
  system: systemPrompt,
  messages: modelMessages,
  tools: {
    search_crew: searchCrewTool,
    get_crew_detail: getCrewDetailTool,
    submit_crew_request: submitCrewRequestTool,
  },
  maxSteps: 5, // Allow multi-step tool calls (search → detail → book)
  toolContext: { supabase }, // Pass Supabase client to tool execute functions
});
```

**IMPORTANT:** The Vercel AI SDK `tool()` function's `execute` receives a second argument with the context you pass via `toolContext`. Check the Vercel AI SDK docs for the exact API — if `toolContext` isn't supported in the current version, pass `supabase` via closure instead:

```typescript
// Alternative: define tools inline with closure over supabase
const tools = {
  search_crew: tool({
    description: '...',
    parameters: z.object({ ... }),
    execute: async (params) => {
      // supabase is available via closure from the route handler
      const { data } = await supabase.from('profiles')...
      return { results: data };
    },
  }),
  // ... same for other tools
};
```

#### 1C. Update System Prompt — `lib/ubunye/system-prompt.ts`

Add crew booking instructions to `buildSystemPrompt()`:

```
===== CREW BOOKING =====
You have tools to search and book crew. When a client asks about hiring someone:
1. Use search_crew to find matching creators. Present 2-3 options with name, rate, rating, and profile link.
2. If the client asks for more detail, use get_crew_detail to get their full profile.
3. When the client wants to book, collect: their name, email, project type, and a brief description (min 20 chars).
4. Ask for optional info: phone, dates, location, duration, budget range.
5. Confirm all details with the client BEFORE calling submit_crew_request.
6. After booking, tell them ThabangVision will reach out within 24 hours.

RULES:
- NEVER share creator email or phone with clients — only show display name, specializations, rate, rating, and profile link.
- NEVER fabricate crew members — only recommend creators returned by search_crew.
- If no crew match, suggest the client contact ThabangVision directly at ${STUDIO.email}.
- For team/package requests, search for multiple crew members and present as a package.
- Always use exact rates from the data — never estimate.
```

#### 1D. Frontend — "Book via Ubunye" Button

On the crew detail page (`/crew/[slug]`), the "Request This Creator" button navigates to Ubunye with context:

```typescript
// Instead of opening a form modal:
const handleRequestCreator = () => {
  const msg = `I'd like to book ${creator.display_name} for a project.`;
  window.location.href = `/ubunye-ai-studio?prefill=${encodeURIComponent(msg)}`;
};
```

Update the Ubunye chat page to read the `prefill` search param and auto-send it as the first message.

---

### PART 2: Crew Public Pages

#### 2A. Crew Listing Page — `app/(platform)/crew/page.tsx`

Server component. Fetches all verified, available-for-hire creators.

**Query:**
```typescript
const { data: crew } = await supabase
  .from('profiles')
  .select(`
    id, display_name, crew_slug, avatar_url, crew_bio, bio,
    specializations, hourly_rate, location, years_experience,
    crew_featured
  `)
  .eq('verification_status', 'verified')
  .eq('available_for_hire', true)
  .order('crew_featured', { ascending: false })
  .order('created_at', { ascending: false });
```

**Page layout:**
```
CREW & TALENT
Find verified professionals for your next production.

[Filter pills: All | Photography | Cinematography | Editing | Sound | Directing]

┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ [Avatar]     │ │ [Avatar]     │ │ [Avatar]     │
│ Name         │ │ Name         │ │ Name         │
│ Cinematographer│ │ Photographer │ │ Editor       │
│ Johannesburg │ │ Cape Town    │ │ Pretoria     │
│ R1,500/hr    │ │ R1,200/hr    │ │ R800/hr      │
│ 4.8 (12)     │ │ 4.5 (8)      │ │ New          │
│ [SKILLS]     │ │ [SKILLS]     │ │ [SKILLS]     │
│              │ │              │ │              │
│ [VIEW PROFILE]│ │ [VIEW PROFILE]│ │ [VIEW PROFILE]│
└──────────────┘ └──────────────┘ └──────────────┘

[ NEED HELP CHOOSING? ASK UBUNYE → ]
```

**Card component — `components/crew/CrewCard.tsx`:**
- Avatar with initials fallback
- Display name
- Primary specialization (first in array)
- Location
- Hourly rate (show "Contact for rate" if not set)
- Rating + number of completed gigs
- Top 3 skill pills
- FEATURED badge if crew_featured = true
- Click navigates to `/crew/[crew_slug]`

**Filter:**
- Client-side filter by specialization
- Uses URL search params: `/crew?skill=photography`

**Privacy — NEVER show on crew listing:**
- Email
- Phone
- Social links
- Booking history

---

#### 2B. Crew Detail Page — `app/(platform)/crew/[slug]/page.tsx`

Server component. Fetches full creator profile plus related data.

**Queries:**
```typescript
// Profile
const { data: creator } = await supabase
  .from('profiles')
  .select('*')
  .eq('crew_slug', params.slug)
  .eq('verification_status', 'verified')
  .eq('available_for_hire', true)
  .single();

// Their gear listings (columns: price_per_day, gallery JSONB)
const { data: listings } = await supabase
  .from('smart_rentals')
  .select('id, title, slug, category, price_per_day, gallery')
  .eq('owner_id', creator.id)
  .eq('is_published', true);

// Productions they're tagged in (crew_ids uuid[] added by 007 migration)
const { data: productions } = await supabase
  .from('smart_productions')
  .select('id, title, slug, project_type, thumbnail_url')
  .contains('crew_ids', [creator.id]);

// Reviews
const { data: reviews } = await supabase
  .from('crew_reviews')
  .select('rating, review_text, reviewer_name, created_at')
  .eq('creator_id', creator.id)
  .eq('is_published', true)
  .order('created_at', { ascending: false })
  .limit(10);
```

**Page layout:**
```
┌─────────────────────────────────────────────────┐
│                                                   │
│ [Large Avatar]                                    │
│                                                   │
│ THABANG MOKWENA                                   │
│ Cinematographer & Photographer                    │
│ Johannesburg, Gauteng                             │
│ R1,500/hr | 5 years experience                    │
│ 4.8 (12 completed gigs)                           │
│                                                   │
│ ─────────────────────────────────────────         │
│                                                   │
│ ABOUT                                             │
│ "I engineer the invisible. Specializing in        │
│  cinematic storytelling, music videos, and        │
│  corporate productions."                          │
│                                                   │
│ SKILLS                                            │
│ [Cinematography] [Photography] [Colour Grading]   │
│ [Editing] [Directing]                             │
│                                                   │
│ ─────────────────────────────────────────         │
│                                                   │
│ THEIR EQUIPMENT (available for rent)               │
│ ┌──────────┐ ┌──────────┐                         │
│ │ Sony A7  │ │ Fuji XT1 │                         │
│ │ R750/day │ │ R600/day │                         │
│ └──────────┘ └──────────┘                         │
│                                                   │
│ ─────────────────────────────────────────         │
│                                                   │
│ RECENT WORK                                       │
│ ┌──────────┐ ┌──────────┐                         │
│ │ Baby     │ │ Music    │                         │
│ │ Shower   │ │ Video    │                         │
│ └──────────┘ └──────────┘                         │
│                                                   │
│ ─────────────────────────────────────────         │
│                                                   │
│ REVIEWS                                           │
│ "Professional and creative..."                    │
│ — Client Name, March 2026                         │
│                                                   │
│ ─────────────────────────────────────────         │
│                                                   │
│ [  BOOK VIA UBUNYE  ]                             │
│ Opens Ubunye chat with: "I'd like to book         │
│ Thabang Mokwena for a project."                   │
│                                                   │
│ Social: IG | YT | LinkedIn (icons, open new tab)  │
│                                                   │
└─────────────────────────────────────────────────┘
```

**Privacy — show social links but NOT:**
- Email address
- Phone number
- Other client bookings

---

#### 2C. Smart Crews Page — `app/(platform)/crew/teams/page.tsx`

Shows pre-built production teams.

```
PRODUCTION TEAMS
Book a full crew in one click.

┌─────────────────────────────────────┐
│ WEDDING PACKAGE                     │
│ Complete wedding coverage team       │
│                                     │
│ Photographer — Thabang M.          │
│ Cinematographer — Creator B        │
│ Editor — Creator C                 │
│                                     │
│ R8,000/day (save 15% vs individual) │
│                                     │
│ Includes: full day coverage, 2      │
│ cameras, edited highlights reel,    │
│ 200 retouched photos                │
│                                     │
│ [BOOK THIS TEAM VIA UBUNYE]        │
└─────────────────────────────────────┘
```

- "Book This Team" opens Ubunye with: "I'd like to book the Wedding Package team."
- Ubunye calls search_crew for the team → presents the package → collects client details → submits

---

### PART 3: Creator Dashboard

#### 3A. Gigs Page — `app/(platform)/dashboard/gigs/page.tsx`

Where creators see their incoming requests.

**Query (creator sees own requests, WITHOUT client contact info):**
```typescript
const { data: gigs } = await supabase
  .from('crew_requests')
  .select(`
    id, project_type, preferred_dates, description,
    budget_range, location, duration, status,
    booked_via, created_at, updated_at
  `)
  .eq('creator_id', userId)
  .order('created_at', { ascending: false });

// NOTE: do NOT select client_name, client_email, client_phone
// Creator sees project details but NOT who the client is
// Admin handles all client communication
```

**Layout:**
```
YOUR GIGS

Tabs: [Pending] [Contacted] [Confirmed] [Completed] [All]

┌──────────────────────────────────────┐
│ Music Video Production               │
│ Status: CONFIRMED                    │
│ Booked via: Ubunye                   │
│ Dates: 22-23 March 2026             │
│ Location: Braamfontein, JHB          │
│ Duration: 2 days                     │
│ Budget: R15k-50k                     │
│ "Looking for a cinematographer       │
│  for a hip-hop music video..."       │
│ Submitted: 17 Mar 2026              │
└──────────────────────────────────────┘
```

**Status messages shown to creator:**
- `pending`: "ThabangVision is reviewing a new request for you"
- `contacted`: "We've reached out to discuss this opportunity with you"
- `confirmed`: "Gig confirmed! Details to follow."
- `declined`: "This one didn't work out."
- `completed`: "Gig completed. Awaiting client review."
- `cancelled`: "This request was cancelled."

---

#### 3B. Creator Availability Toggle — `app/(platform)/dashboard/profile/page.tsx`

Add to existing profile page:

```
CREW SETTINGS
─────────────

Available for hire: [toggle on/off]

Hourly rate: [R _____ /hr]

Specializations:
[Photography x] [Cinematography x] [Add +]

Crew bio (shown on your public profile):
[textarea — max 500 chars]

Years of experience: [dropdown: 1-20+]
```

When `available_for_hire` is toggled OFF:
- Creator disappears from /crew listing
- Creator disappears from Ubunye search_crew results
- Existing pending requests stay visible to admin
- Profile page shows: "You're currently hidden from the crew listing"

---

### PART 4: Admin Panel

#### 4A. Crew Requests Management — `app/(admin)/admin/crew-requests/page.tsx`

**Query (admin sees everything including client info):**
```typescript
// NOTE: profiles table has no email column — email lives in auth.users.
// Fetch creator profile data from profiles, then look up email separately
// via the admin client (supabase.auth.admin.getUserById) if needed.
const { data: requests } = await supabase
  .from('crew_requests')
  .select(`
    *,
    creator:profiles!creator_id (
      id, display_name, phone, avatar_url,
      specializations, hourly_rate
    )
  `)
  .order('created_at', { ascending: false });

// For each request, fetch creator email via admin client:
// const { data: { user } } = await adminClient.auth.admin.getUserById(creator.id);
// user.email → creator's email
```

**Layout:**
```
CREW REQUESTS

Tabs: [Pending 3] [Contacted 1] [Confirmed 2] [Completed 5] [All 15]

┌─────────────────────────────────────────────────┐
│ REQUEST #CR-001                    PENDING       │
│ Booked via: Ubunye                               │
│                                                   │
│ CLIENT:                                           │
│ Name: Ntando Mashinini                            │
│ Email: ntando@email.com (clickable)               │
│ Phone: 082 xxx xxxx (clickable)                   │
│                                                   │
│ REQUESTED CREATOR:                                │
│ Thabang Mokwena                                  │
│ Email: thabang@... (admin can see)                │
│ Phone: 079 xxx xxxx (admin can see)               │
│ Rate: R1,500/hr                                   │
│                                                   │
│ PROJECT:                                          │
│ Type: Music Video                                 │
│ Dates: 22-23 March                                │
│ Location: Braamfontein                            │
│ Duration: 2 days                                  │
│ Budget: R15k-50k                                  │
│ Description: "Looking for a cinematographer..."   │
│                                                   │
│ ADMIN NOTES:                                      │
│ [textarea — add notes about this request]         │
│                                                   │
│ FINANCIALS:                                       │
│ Creator rate: 2 days x 8hrs x R1,500 = R24,000   │
│ Commission (15%): R3,600                          │
│ Total to client: R27,600                          │
│                                                   │
│ [MARK CONTACTED] [CONFIRM] [DECLINE]              │
└─────────────────────────────────────────────────┘
```

**Admin workflow buttons:**
- `MARK CONTACTED` → status = 'contacted', admin reached out to creator
- `CONFIRM` → status = 'confirmed', sends email to client AND creator
- `DECLINE` → shows reason field, sends email to client with suggestion
- `MARK COMPLETED` → status = 'completed', triggers review request email to client

**Status change emails:**
- Contacted: no email (internal status)
- Confirmed:
  - To client: "Your crew request has been confirmed. [Creator name] will be working on your [project type] on [dates]. We'll send you a detailed brief soon."
  - To creator: "You've been booked for a [project type] gig on [dates] in [location]. We'll share the brief shortly."
- Declined:
  - To client: "Unfortunately [creator name] isn't available for your dates. Would you like us to suggest an alternative? Reply to this email or browse more crew at [/crew link]."
- Completed:
  - To client: "How was your experience with [creator name]? [Leave a review link]"

---

#### 4B. Smart Crews Management — `app/(admin)/admin/smart-crews/page.tsx`

Admin creates and manages preset teams.

**Create team form:**
- Team name
- Slug (auto-generated)
- Description
- Category: wedding, corporate, music_video, event, documentary
- Package rate (total for the team)
- Package includes (what client gets)
- Add members: search verified creators by name, assign role in team
- Publish toggle

---

#### 4C. Crew Dashboard Stats — add to `/admin` home page

```
CREW OVERVIEW
─────────────
Active crew members: 12
Pending requests: 3
Gigs this month: 7
Revenue (commission): R18,200
Booked via Ubunye: 85%
```

---

### PART 5: Verification → Crew Auto-Setup

#### 5A. On Verification Approval

When admin approves a creator's verification, auto-setup their crew profile:

```typescript
// In the verification approval handler:
await supabase.from('profiles').update({
  verification_status: 'verified',
  verification_reviewed_at: new Date().toISOString(),
  available_for_hire: true,
  crew_slug: generateSlug(profile.display_name),
}).eq('id', userId);
```

**Generate slug:**
```typescript
function generateSlug(name: string): string {
  let slug = name.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();

  // Check for duplicates, append number if needed
  // thabang-mokwena, thabang-mokwena-2, etc.
  return slug;
}
```

**Send welcome email to creator:**
```
Subject: "You're verified! Welcome to the ThabangVision crew."
Body: "Your identity has been verified. You can now:
  - List your equipment for rent
  - Appear as hireable crew
  - Accept gig requests through the platform

Set up your crew profile: [/dashboard/profile]
Start listing gear: [/dashboard/listings]"
```

---

### PART 6: Navigation Updates

Add crew to site navigation:

**Header:**
- Under CAPABILITIES dropdown: add "Crew & Talent"

**Footer:**
- Add /crew to the platform links

**Ubunye system prompt:**
- Crew search/booking instructions already added in Part 1C above
- Add crew data to the platform cache in `fetchPlatformData()`:
  ```typescript
  const crew = await supabase
    .from('profiles')
    .select('display_name, crew_slug, specializations, hourly_rate, location')
    .eq('verification_status', 'verified')
    .eq('available_for_hire', true);
  ```
- Include in system prompt so Ubunye has awareness even without tool calls

**Dashboard sidebar:**
- Add "Gigs" link (only visible to verified creators)

**Admin sidebar (AdminNav.tsx):**
- Add "Crew Requests" link → `/admin/crew-requests`
- Add "Smart Crews" link → `/admin/smart-crews`

---

### PART 7: Constants

Add to `lib/constants.ts` inside the STUDIO object:

```typescript
crew: {
  commissionRate: 15, // percentage ThabangVision takes
  minRequestLength: 20, // minimum description characters
  maxRequestsPerHour: 5, // rate limit per IP
  statusLabels: {
    pending: 'Under Review',
    contacted: 'In Discussion',
    confirmed: 'Confirmed',
    declined: 'Not Available',
    completed: 'Completed',
    cancelled: 'Cancelled',
  },
  projectTypes: [
    'Photography',
    'Cinematography',
    'Wedding',
    'Corporate',
    'Music Video',
    'Event',
    'Documentary',
    'Content Creation',
    'Other',
  ],
  budgetRanges: [
    'Under R5,000',
    'R5,000 - R15,000',
    'R15,000 - R50,000',
    'R50,000+',
    'Flexible',
  ],
} as const,
```

---

## API Routes Summary

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| — | (via Ubunye tools) | — | search_crew, get_crew_detail, submit_crew_request |
| GET | /api/admin/crew-requests | Admin | All crew requests |
| PATCH | /api/admin/crew-requests/[id] | Admin | Update request status |
| POST | /api/admin/smart-crews | Admin | Create smart crew |
| PATCH | /api/admin/smart-crews/[id] | Admin | Update smart crew |
| DELETE | /api/admin/smart-crews/[id] | Admin | Delete smart crew |

**Note:** No public `/api/crew/request` route needed — all crew requests flow through Ubunye's `submit_crew_request` tool which executes server-side in the `/api/ubunye-chat` route handler. This is more secure (no public endpoint to abuse) and scalable (rate limiting is per-chat-session, not per-IP).

---

## Acceptance Criteria

- [ ] Ubunye can search crew via function calling (search_crew tool)
- [ ] Ubunye can show crew details via function calling (get_crew_detail tool)
- [ ] Ubunye can submit crew requests via function calling (submit_crew_request tool)
- [ ] Ubunye collects all required info conversationally before booking
- [ ] Ubunye NEVER reveals creator email or phone to clients
- [ ] /crew page shows verified, available-for-hire creators
- [ ] /crew/[slug] shows full profile with equipment, work, reviews
- [ ] "Book via Ubunye" button opens chat with context pre-filled
- [ ] Admin receives email notification on new request
- [ ] Admin can change request status with notes
- [ ] Creator sees gigs in /dashboard/gigs (without client contact info)
- [ ] Status change sends appropriate emails
- [ ] Smart crews page shows preset teams
- [ ] Admin can create/edit smart crews
- [ ] Verification approval auto-enables crew profile
- [ ] Creator can toggle available_for_hire
- [ ] No client contact info ever visible to creators
- [ ] No creator contact info ever visible to public
- [ ] Admin sees everything
- [ ] npm run build passes
- [ ] All existing tests still pass
- [ ] New tests added for crew tools

---

## Update MEMORY.md

After completion, append:

```
## Session: TASK-037 — Crew & Services System (2026-03-XX)
### Branch: feature/task-037-crew-system
### Built:
- Ubunye crew tools: search_crew, get_crew_detail, submit_crew_request (Vercel AI SDK function calling)
- /crew listing and detail pages (browse only — booking flows through Ubunye)
- Admin crew request management with status workflow
- Creator gigs dashboard (privacy-filtered)
- Smart crews (preset production teams)
- Auto crew setup on verification approval
- Crew constants and commission tracking
- Review system for completed gigs
### Database: 007-crew-system.sql migration (includes crew_ids on smart_productions)
### Key files: lib/ubunye/tools.ts, app/api/ubunye-chat/route.ts, lib/ubunye/system-prompt.ts
### New routes: /api/admin/crew-requests/*, /api/admin/smart-crews/*
### Tests: [results]
### Notes: [blockers or follow-ups]
```

---

## Post-Session

```
/pre-merge
```
Verify CI passes. Merge to main. Run `/end-session`.
