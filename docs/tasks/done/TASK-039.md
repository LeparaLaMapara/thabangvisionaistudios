# TASK-039: Onboarding Redesign — Required Profile Fields + Address Autocomplete
## Priority: HIGH | Phase: V3 | Depends on: TASK-036 (onboarding page), TASK-038 (verification)
## Created: 2026-03-18

---

## Pre-Session Setup

```
/new-session
```
Branch name: `feature/task-039-onboarding-redesign`

Read these files first:
```
Read CLAUDE.md
Read MEMORY.md
Read lib/constants.ts
Read app/(platform)/onboarding/page.tsx
Read app/(platform)/dashboard/profile/page.tsx
Read app/(platform)/dashboard/page.tsx
Read lib/supabase/queries/profiles.ts
Read lib/migrations/006-handle-new-user-trigger.sql
Read app/auth/callback/route.ts
```

---

## Context

Current onboarding collects display_name, skills, and phone — all optional. Users skip through and end up with incomplete profiles. For verification (TASK-038) to work, admin needs to match the profile name against the ID document. For crew hiring (TASK-037), clients need to know where creators are based.

Redesign onboarding to require **full legal name**, **street address with autocomplete**, and **profile photo**. Keep bio and skills optional but nudge users to complete them later via a dashboard prompt.

---

## Database Migration

Create `lib/migrations/009-profile-name-address.sql`:

```sql
-- 009: Split display_name into first/last name, add structured address
-- Required by: TASK-039
-- Run in Supabase SQL Editor

-- ═══ 1. Add name fields ═══
alter table profiles add column if not exists
  first_name text;

alter table profiles add column if not exists
  last_name text;

-- ═══ 2. Add structured address fields ═══
alter table profiles add column if not exists
  street_address text;

alter table profiles add column if not exists
  city text;

alter table profiles add column if not exists
  province text;

alter table profiles add column if not exists
  postal_code text;

alter table profiles add column if not exists
  country text default 'South Africa';

-- Latitude/longitude for proximity search (crew hiring)
alter table profiles add column if not exists
  address_lat double precision;

alter table profiles add column if not exists
  address_lng double precision;

-- Google Place ID for deduplication
alter table profiles add column if not exists
  address_place_id text;

-- ═══ 3. Track profile completeness ═══
alter table profiles add column if not exists
  onboarding_completed_at timestamptz;

-- ═══ 4. Backfill display_name from first_name + last_name ═══
-- After migration, update the handle_new_user trigger to NOT set display_name
-- (it will be set from first_name + last_name during onboarding)

-- ═══ 5. Index for geo queries (crew search by proximity) ═══
create index if not exists idx_profiles_location
  on profiles (address_lat, address_lng)
  where address_lat is not null and address_lng is not null;
```

---

## Implementation

### PART 1: Onboarding Page Redesign

#### 1A. Rewrite `app/(platform)/onboarding/page.tsx`

Replace the current optional form with a multi-step required flow:

**Step 1 — Your Name (required)**
```
WELCOME TO THABANGVISION

Let's set up your profile. This information will be visible to clients and crew.

FULL NAME (AS ON YOUR ID)
┌──────────────────────────┐  ┌──────────────────────────┐
│ First Name *             │  │ Last Name *              │
└──────────────────────────┘  └──────────────────────────┘

This must match the name on your SA ID for verification.
```

**Step 2 — Your Location (required)**
```
WHERE ARE YOU BASED?

We use this to connect you with nearby clients and crew.

STREET ADDRESS
┌──────────────────────────────────────────────────────┐
│ Start typing your address...                          │
│                                                       │
│  ┌─ Suggestions ──────────────────────────────────┐  │
│  │ 123 Main Road, Braamfontein, Johannesburg      │  │
│  │ 123 Main Street, Cape Town City Centre          │  │
│  │ 123 Main Avenue, Sandton, Johannesburg          │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘

City: [auto-filled]    Province: [auto-filled]    Postal Code: [auto-filled]
```

- Use Google Places Autocomplete API (restricted to South Africa)
- On selection: auto-fill city, province, postal_code, country, lat, lng, place_id
- User can manually override city/province/postal_code if autocomplete is wrong
- If no Google API key configured, fall back to manual text fields

**Step 3 — Profile Photo (required)**
```
ADD A PROFILE PHOTO

Clients and crew will see this photo on your profile.

┌─────────────────────────┐
│                         │
│  [Upload or Take Photo] │
│                         │
└─────────────────────────┘

Tips: Use a clear, recent photo of your face. Professional headshots work best.
```

- Upload to Cloudinary via signed upload (same flow as avatar on profile page)
- Minimum 100KB, maximum 5MB, JPG/PNG only
- Show circular preview after upload
- Mobile: `capture="user"` for front camera

**Step 4 — Almost Done**
```
YOUR PROFILE IS SET UP!

┌──────────────────────────────────────┐
│ [Photo]                              │
│ Thabang Mokwena                      │
│ 📍 Johannesburg, Gauteng             │
│                                      │
│ [GO TO DASHBOARD →]                  │
└──────────────────────────────────────┘

Optional: You can add a bio, skills, and social links from your dashboard.
```

#### 1B. Required field enforcement

- User CANNOT proceed past each step without filling required fields
- On step 1: both first_name and last_name must be non-empty (min 2 chars each)
- On step 2: street_address must be selected from autocomplete (or manually entered with city + province)
- On step 3: avatar must be uploaded
- Final submit: POST to `/api/onboarding` with all data

#### 1C. Auto-generate display_name

```typescript
// display_name = first_name + " " + last_name
// This replaces the old free-text display_name field
const displayName = `${firstName.trim()} ${lastName.trim()}`;
```

---

### PART 2: Google Places Autocomplete Component

#### 2A. Create `components/ui/AddressAutocomplete.tsx`

```typescript
'use client';

interface AddressResult {
  streetAddress: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  lat: number;
  lng: number;
  placeId: string;
}

interface Props {
  onSelect: (address: AddressResult) => void;
  defaultValue?: string;
}
```

**Implementation approach:**
- Load Google Places API via `<Script>` from `next/script` (only when `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY` is set)
- Use `google.maps.places.Autocomplete` with `componentRestrictions: { country: 'za' }`
- Extract structured address from `place.address_components`
- Map component types: `street_number` + `route` → streetAddress, `locality` → city, `administrative_area_level_1` → province, `postal_code` → postalCode
- Get lat/lng from `place.geometry.location`

**Fallback when no API key:**
- Show manual text inputs: Street Address, City, Province, Postal Code
- No lat/lng or place_id (null in DB)
- Display notice: "Address suggestions unavailable. Enter your address manually."

#### 2B. Add env var

```
NEXT_PUBLIC_GOOGLE_PLACES_API_KEY=  # Optional — enables address autocomplete
```

Add to CLAUDE.md env var docs if not already there.

---

### PART 3: Onboarding API Route

#### 3A. Create `app/api/onboarding/route.ts`

```typescript
export async function POST(req: NextRequest) {
  // 1. Auth check
  // 2. Validate required fields:
  //    - first_name (min 2 chars, letters/spaces/hyphens only)
  //    - last_name (min 2 chars, letters/spaces/hyphens only)
  //    - street_address (non-empty)
  //    - city (non-empty)
  //    - province (non-empty)
  //    - avatar_url (non-empty — already uploaded to Cloudinary)
  // 3. Generate display_name from first + last
  // 4. Update profile:
  //    - first_name, last_name, display_name
  //    - street_address, city, province, postal_code, country
  //    - address_lat, address_lng, address_place_id
  //    - avatar_url, avatar_public_id
  //    - location (legacy field: "City, Province")
  //    - onboarding_completed_at = now()
  // 5. Return success
}
```

**Name validation:**
```typescript
function validateName(name: string): { valid: boolean; error?: string } {
  const trimmed = name.trim();
  if (trimmed.length < 2) {
    return { valid: false, error: 'Name must be at least 2 characters.' };
  }
  // Allow letters, spaces, hyphens, apostrophes (SA names like O'Brien, Nkosi-Dlamini)
  if (!/^[a-zA-ZÀ-ÿ\s'-]+$/.test(trimmed)) {
    return { valid: false, error: 'Name contains invalid characters.' };
  }
  return { valid: true };
}
```

---

### PART 4: Auth Callback Update

#### 4A. Update `app/auth/callback/route.ts`

Change the onboarding check from:
```typescript
if (!profile || !profile.display_name) {
  return NextResponse.redirect(new URL('/onboarding', origin));
}
```

To:
```typescript
if (!profile || !profile.onboarding_completed_at) {
  return NextResponse.redirect(new URL('/onboarding', origin));
}
```

This ensures users who registered before TASK-039 but haven't completed the new onboarding are redirected.

---

### PART 5: Dashboard Profile Completeness Prompt

#### 5A. Update `app/(platform)/dashboard/page.tsx`

Add a "Complete Your Profile" card at the top of the dashboard if bio or skills are empty:

```
┌──────────────────────────────────────────────────────────┐
│ COMPLETE YOUR PROFILE                                     │
│                                                           │
│ Add a bio and skills to appear in crew searches and       │
│ stand out to clients.                                     │
│                                                           │
│ ○ Bio (tell clients about your experience)                │
│ ○ Skills (e.g. Premiere Pro, Cinematography)              │
│ ○ Social links (Instagram, YouTube, etc.)                 │
│                                                           │
│ [EDIT PROFILE →]                                          │
└──────────────────────────────────────────────────────────┘
```

- Only show if `bio` is null/empty OR `skills` is null/empty
- Links to `/dashboard/profile`
- Dismissible (store dismissed state in localStorage)

---

### PART 6: Profile Edit Page Update

#### 6A. Update `app/(platform)/dashboard/profile/page.tsx`

- Add `first_name` and `last_name` fields (read-only display, or editable with note: "Must match your ID")
- Add address section with Google Places autocomplete (same component as onboarding)
- Keep existing bio, skills, social links, avatar sections
- Update `display_name` automatically when first/last name changes
- Keep the `location` legacy field synced: `"${city}, ${province}"`

---

## Files to Create/Modify

```
CREATE:
  components/ui/AddressAutocomplete.tsx    — Google Places autocomplete with fallback
  app/api/onboarding/route.ts              — onboarding submission handler
  lib/migrations/009-profile-name-address.sql

MODIFY:
  app/(platform)/onboarding/page.tsx       — multi-step required flow
  app/auth/callback/route.ts               — check onboarding_completed_at
  app/(platform)/dashboard/page.tsx         — profile completeness prompt
  app/(platform)/dashboard/profile/page.tsx — add name + address fields
  lib/supabase/queries/profiles.ts          — add new fields to types + queries
  lib/constants.ts                          — add NEXT_PUBLIC_GOOGLE_PLACES_API_KEY note if needed
```

---

## Acceptance Criteria

- [ ] Onboarding requires first_name, last_name, street address, and profile photo
- [ ] First/last name validated (min 2 chars, letters/spaces/hyphens/apostrophes)
- [ ] display_name auto-generated from first_name + last_name
- [ ] Google Places autocomplete works for SA addresses (when API key configured)
- [ ] Autocomplete auto-fills city, province, postal_code, lat, lng, place_id
- [ ] Graceful fallback to manual address entry when no API key
- [ ] Profile photo required at onboarding (Cloudinary signed upload)
- [ ] Mobile camera opens for profile photo (capture="user")
- [ ] Auth callback redirects to /onboarding if onboarding_completed_at is null
- [ ] Dashboard shows "Complete Your Profile" prompt when bio/skills missing
- [ ] Profile edit page shows name + address fields
- [ ] Legacy location field synced as "City, Province"
- [ ] onboarding_completed_at timestamp set on completion
- [ ] Geo index created for proximity queries
- [ ] npm run build passes
- [ ] Existing tests still pass

---

## Update MEMORY.md

After completion, append:

```
### Session: TASK-039 — Onboarding Redesign (2026-03-XX)
- Multi-step onboarding: full name (required), street address with Google Places autocomplete (required), profile photo (required)
- Split display_name into first_name + last_name (auto-generates display_name)
- Structured address: street_address, city, province, postal_code, country, lat, lng, place_id
- Google Places Autocomplete component with SA-only restriction + manual fallback
- Auth callback checks onboarding_completed_at instead of display_name
- Dashboard profile completeness prompt for bio + skills
- Profile edit page updated with name + address fields
- Geo index for proximity crew search
### Database: 009-profile-name-address.sql migration
### Dependencies: Google Places API key (optional, NEXT_PUBLIC_GOOGLE_PLACES_API_KEY)
### Tests: [results]
### Notes: [blockers or follow-ups]
```

---

## Post-Session

```
/pre-merge
```
Verify CI passes. Merge to main. Run `/end-session`.
