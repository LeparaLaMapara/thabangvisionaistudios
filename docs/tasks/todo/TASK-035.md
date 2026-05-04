# TASK-043 — Feature Flag System with Admin UI

## Branch
feature/task-043-feature-flags

## Mission
Build a database-driven feature flag system so Thabang can toggle features (starting with Smart Productions) on and off from the admin dashboard without a deploy. Designed from first principles: single source of truth, instant reversibility, observability, and blast-radius containment.

**The aim: Flip any feature on or off in under 10 seconds, from the admin UI, with no code changes and no redeploy.**

---

## Why This Matters

Thabang is soft-launching with Smart Rentals first, keeping Smart Productions hidden until traction in rentals justifies a launch. This pattern will repeat: new features built in advance of launch, gated until ready. Without a proper feature flag system, hiding Smart Productions means either deleting code (destructive, irreversible) or scattered env variables (requires redeploy, no audit trail, doesn't scale).

A database-driven system with an admin UI gives us:

- **Reversibility**: flip off in seconds if something breaks after launch
- **Progressive rollout path**: today binary, tomorrow percentage-based or cohort-based
- **Single source of truth**: all flag state in one table, not scattered across env vars and code
- **Observability**: one admin page shows every flag, its state, and who changed it
- **No redeploy required**: marketing wants to flip a feature live during a LinkedIn post? Done in 2 seconds.

---

## Architecture — First Principles

```
SINGLE SOURCE OF TRUTH:
  feature_flags table in Supabase
  ↓
TYPED ACCESS LAYER:
  lib/features.ts — getFlag(key) with 60s revalidate cache
  ↓
UI LAYER:
  <FeatureGate> component wraps anything that's gated
  Page-level guards call notFound() for gated routes
  ↓
CONTROL PLANE:
  Admin UI at /admin/flags — toggle switches + audit log
  ↓
SAFETY NET:
  middleware.ts redirects disabled routes as defense-in-depth
```

**Rule: All flag state lives in the database. No environment variables for feature flags.**

---

## Implementation Plan

### 1. Database Migration

Create `lib/migrations/008-feature-flags.sql`:

```sql
-- Feature flags table
create table feature_flags (
  key text primary key,
  enabled boolean not null default false,
  description text,
  updated_at timestamptz default now(),
  updated_by uuid references auth.users(id)
);

-- Audit log for flag changes
create table feature_flag_events (
  id uuid primary key default gen_random_uuid(),
  flag_key text not null references feature_flags(key) on delete cascade,
  old_value boolean,
  new_value boolean,
  changed_by uuid references auth.users(id),
  changed_at timestamptz default now(),
  reason text
);

create index idx_feature_flag_events_key on feature_flag_events(flag_key);
create index idx_feature_flag_events_changed_at on feature_flag_events(changed_at desc);

-- RLS: everyone can read, only admins can write
alter table feature_flags enable row level security;
alter table feature_flag_events enable row level security;

create policy "Anyone can read feature flags"
  on feature_flags for select
  using (true);

create policy "Only admins can modify feature flags"
  on feature_flags for all
  using (
    exists (
      select 1 from profiles 
      where profiles.id = auth.uid() 
      and profiles.role = 'admin'
    )
  );

create policy "Only admins can read flag events"
  on feature_flag_events for select
  using (
    exists (
      select 1 from profiles 
      where profiles.id = auth.uid() 
      and profiles.role = 'admin'
    )
  );

create policy "Only admins can insert flag events"
  on feature_flag_events for insert
  with check (
    exists (
      select 1 from profiles 
      where profiles.id = auth.uid() 
      and profiles.role = 'admin'
    )
  );

-- Seed initial flags
insert into feature_flags (key, enabled, description) values
  ('smart_productions', false, 'Smart Productions marketplace — hidden until Smart Rentals gains traction'),
  ('smart_productions_booking', false, 'Smart Productions booking flow — depends on smart_productions'),
  ('studio_crews', false, 'AI-assembled production crews (V5+)'),
  ('voice_onboarding', false, 'Voice input for creator onboarding (Phase 2)'),
  ('ai_rate_suggestions', true, 'Claude-powered rate suggestions during creator onboarding'),
  ('ai_portfolio_tagging', true, 'Gemma 4 Vision portfolio auto-tagging');

-- Trigger to auto-log flag changes
create or replace function log_feature_flag_change()
returns trigger as $$
begin
  if (old.enabled is distinct from new.enabled) then
    insert into feature_flag_events (flag_key, old_value, new_value, changed_by)
    values (new.key, old.enabled, new.enabled, auth.uid());
  end if;
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$ language plpgsql security definer;

create trigger feature_flags_audit
  before update on feature_flags
  for each row execute function log_feature_flag_change();
```

### 2. Typed Feature Flag Library

Create `lib/features.ts`:

```ts
import { unstable_cache, revalidateTag } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

// Single source of truth for valid flag keys — add new flags here
export const FEATURE_KEYS = [
  'smart_productions',
  'smart_productions_booking',
  'studio_crews',
  'voice_onboarding',
  'ai_rate_suggestions',
  'ai_portfolio_tagging',
] as const;

export type FeatureKey = typeof FEATURE_KEYS[number];

export interface FeatureFlag {
  key: FeatureKey;
  enabled: boolean;
  description: string | null;
  updated_at: string;
  updated_by: string | null;
}

/**
 * Read a single feature flag. Cached for 60 seconds.
 * Returns false if the flag doesn't exist (fail-closed).
 */
export const getFlag = unstable_cache(
  async (key: FeatureKey): Promise<boolean> => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('key', key)
      .single();
    
    if (error || !data) return false; // fail-closed
    return data.enabled;
  },
  ['feature-flags'],
  { revalidate: 60, tags: ['feature-flags'] }
);

/**
 * Read all flags at once. Useful for admin UI.
 */
export const getAllFlags = unstable_cache(
  async (): Promise<FeatureFlag[]> => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('feature_flags')
      .select('*')
      .order('key');
    
    if (error || !data) return [];
    return data as FeatureFlag[];
  },
  ['feature-flags-all'],
  { revalidate: 60, tags: ['feature-flags'] }
);

/**
 * Toggle a flag. Admin only. Invalidates cache immediately.
 */
export async function setFlag(key: FeatureKey, enabled: boolean): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('feature_flags')
    .update({ enabled })
    .eq('key', key);
  
  if (error) throw new Error(`Failed to toggle flag: ${error.message}`);
  
  // Invalidate cache so change is immediate
  revalidateTag('feature-flags');
}
```

### 3. FeatureGate Component

Create `components/FeatureGate.tsx`:

```tsx
import { getFlag, type FeatureKey } from '@/lib/features';

interface FeatureGateProps {
  flag: FeatureKey;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Async server component that conditionally renders based on a feature flag.
 * 
 * Usage:
 *   <FeatureGate flag="smart_productions">
 *     <SmartProductionsNavLink />
 *   </FeatureGate>
 */
export async function FeatureGate({ 
  flag, 
  children, 
  fallback = null 
}: FeatureGateProps) {
  const enabled = await getFlag(flag);
  return enabled ? <>{children}</> : <>{fallback}</>;
}
```

### 4. Apply Gates to Smart Productions Touchpoints

Systematically wrap every Smart Productions reference:

**Navigation:**
- `components/navigation/DesktopNav.tsx`
- `components/navigation/MobileNav.tsx`
- `components/navigation/Footer.tsx`

Wrap each Smart Productions link:
```tsx
<FeatureGate flag="smart_productions">
  <NavLink href="/smart-productions">Smart Productions</NavLink>
</FeatureGate>
```

**Pages:**
- `app/smart-productions/page.tsx`
- `app/smart-productions/[slug]/page.tsx`
- `app/smart-productions/booking/page.tsx` (if exists)

At the top of each:
```tsx
import { getFlag } from '@/lib/features';
import { notFound } from 'next/navigation';

export default async function Page() {
  if (!(await getFlag('smart_productions'))) notFound();
  // ... existing page code
}
```

**Homepage sections:**
- `app/page.tsx` — wrap any Smart Productions sections/CTAs

**Ubunye AI system prompt:**
- `app/api/chat/route.ts` (or wherever the system prompt is built)
- Conditionally include Smart Productions context:

```ts
const smartProductionsEnabled = await getFlag('smart_productions');

const systemPrompt = `You are Ubunye...

${smartProductionsEnabled ? `
===== SMART PRODUCTIONS =====
${productions.data?.map(p => `...`).join('\n')}
` : ''}

===== SMART RENTALS =====
${rentals.data?.map(r => `...`).join('\n')}
`;
```

**Admin dashboards:**
- Hide Smart Productions admin sections when flag is off
- Keep data intact — admins might still need to manage it

### 5. Admin UI

Create `app/(admin)/admin/flags/page.tsx`:

```tsx
import { getAllFlags } from '@/lib/features';
import { FlagsTable } from './FlagsTable';

export default async function FlagsPage() {
  const flags = await getAllFlags();
  
  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-3xl font-bold mb-2">Feature Flags</h1>
      <p className="text-gray-600 mb-8">
        Toggle features on and off instantly. Changes take effect within 60 seconds.
      </p>
      <FlagsTable flags={flags} />
    </div>
  );
}
```

Create `app/(admin)/admin/flags/FlagsTable.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { toggleFlag } from './actions';
import type { FeatureFlag } from '@/lib/features';

export function FlagsTable({ flags }: { flags: FeatureFlag[] }) {
  const [pending, setPending] = useState<string | null>(null);
  
  const handleToggle = async (key: string, currentValue: boolean) => {
    if (!confirm(`Turn ${currentValue ? 'OFF' : 'ON'} "${key}"?`)) return;
    setPending(key);
    try {
      await toggleFlag(key, !currentValue);
    } catch (err) {
      alert(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setPending(null);
    }
  };
  
  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full">
        <thead className="bg-gray-50">
          <tr>
            <th className="text-left p-4 font-semibold">Flag</th>
            <th className="text-left p-4 font-semibold">Description</th>
            <th className="text-left p-4 font-semibold">Last updated</th>
            <th className="text-center p-4 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {flags.map(flag => (
            <tr key={flag.key} className="border-t">
              <td className="p-4 font-mono text-sm">{flag.key}</td>
              <td className="p-4 text-sm text-gray-600">{flag.description}</td>
              <td className="p-4 text-sm text-gray-500">
                {new Date(flag.updated_at).toLocaleString()}
              </td>
              <td className="p-4 text-center">
                <button
                  onClick={() => handleToggle(flag.key, flag.enabled)}
                  disabled={pending === flag.key}
                  className={`
                    relative inline-flex h-6 w-11 items-center rounded-full transition-colors
                    ${flag.enabled ? 'bg-green-600' : 'bg-gray-300'}
                    ${pending === flag.key ? 'opacity-50 cursor-wait' : 'cursor-pointer'}
                  `}
                >
                  <span
                    className={`
                      inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                      ${flag.enabled ? 'translate-x-6' : 'translate-x-1'}
                    `}
                  />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

Create `app/(admin)/admin/flags/actions.ts`:

```ts
'use server';

import { setFlag, type FeatureKey, FEATURE_KEYS } from '@/lib/features';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function toggleFlag(key: string, enabled: boolean) {
  // Validate key is a known flag
  if (!FEATURE_KEYS.includes(key as FeatureKey)) {
    throw new Error(`Unknown flag: ${key}`);
  }
  
  // Verify admin role
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  
  if (profile?.role !== 'admin') throw new Error('Admin access required');
  
  await setFlag(key as FeatureKey, enabled);
  revalidatePath('/admin/flags');
}
```

### 6. Middleware Safety Net

Create or update `middleware.ts`:

```ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getFlag } from '@/lib/features';

export async function middleware(request: NextRequest) {
  // Smart Productions routes
  if (request.nextUrl.pathname.startsWith('/smart-productions')) {
    const enabled = await getFlag('smart_productions');
    if (!enabled) {
      return NextResponse.redirect(new URL('/', request.url));
    }
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: ['/smart-productions/:path*'],
};
```

### 7. Audit Log View (bonus)

Add a simple events view under `/admin/flags/history`:

```tsx
// Shows last 100 flag changes: flag key, old → new, who, when
// Useful for debugging "wait, when did we turn this off?"
```

---

## Files to Create/Modify

```
CREATE:
  lib/migrations/008-feature-flags.sql
  lib/features.ts
  components/FeatureGate.tsx
  app/(admin)/admin/flags/page.tsx
  app/(admin)/admin/flags/FlagsTable.tsx
  app/(admin)/admin/flags/actions.ts
  app/(admin)/admin/flags/history/page.tsx

MODIFY:
  components/navigation/DesktopNav.tsx
  components/navigation/MobileNav.tsx
  components/navigation/Footer.tsx
  app/page.tsx (homepage — wrap any Smart Productions sections)
  app/smart-productions/page.tsx
  app/smart-productions/[slug]/page.tsx
  app/api/chat/route.ts (Ubunye system prompt — conditional inclusion)
  middleware.ts (add flag check)
```

---

## Acceptance Criteria

- [ ] `feature_flags` table created with RLS policies
- [ ] `feature_flag_events` audit table created
- [ ] Trigger logs every flag change automatically
- [ ] `lib/features.ts` exports `getFlag`, `getAllFlags`, `setFlag`, `FeatureKey` type
- [ ] `getFlag` uses 60-second cache via `unstable_cache`
- [ ] `setFlag` invalidates cache via `revalidateTag`
- [ ] `<FeatureGate>` component works as async server component
- [ ] All Smart Productions nav links wrapped in `<FeatureGate>`
- [ ] `/smart-productions/*` pages call `notFound()` when flag is off
- [ ] Ubunye AI system prompt conditionally includes Smart Productions section
- [ ] Middleware redirects `/smart-productions/*` to home when flag is off
- [ ] Admin UI at `/admin/flags` shows all flags with toggle switches
- [ ] Toggling a flag in admin UI takes effect within 60 seconds
- [ ] Only users with `role = 'admin'` can access `/admin/flags`
- [ ] Only admins can toggle flags (enforced at RLS + server action level)
- [ ] Audit log page shows recent flag changes with user and timestamp
- [ ] Confirmation dialog before toggling to prevent accidents
- [ ] No Smart Productions code or data is deleted
- [ ] MEMORY.md updated with the flag system architecture

---

## Out of Scope

- User-level targeting (show feature to specific users) — Phase 2
- Percentage-based rollouts (show to 10% of users) — Phase 2
- Environment-specific flags (dev vs prod) — Phase 2
- A/B testing framework — use PostHog/Statsig later if needed
- Deleting Smart Productions code — never, only hiding it

---

## Success Metrics

```
BEFORE:
  Hiding a feature: delete code or set env var + redeploy (~60s + risk)
  Flipping back on: redeploy (~60s)
  Audit trail: git log, hope you remember
  Progressive rollout: impossible

AFTER:
  Hiding a feature: toggle in admin UI (~2s + 60s cache)
  Flipping back on: toggle in admin UI (~2s + 60s cache)
  Audit trail: full history in feature_flag_events table
  Progressive rollout: extensible architecture ready for it
```

---

## Commit Strategy

1. `feat: add feature_flags table with RLS and audit trigger`
2. `feat: add lib/features.ts with typed flag access and caching`
3. `feat: add FeatureGate component`
4. `feat: gate Smart Productions navigation, pages, and Ubunye prompt`
5. `feat: add middleware safety net for gated routes`
6. `feat: add admin UI for toggling feature flags`
7. `feat: add feature flag audit log view`
8. `docs: update MEMORY.md with feature flag system`

---

## Testing

Before merging, verify:

1. **Flag off path:**
   - Toggle `smart_productions` OFF in admin UI
   - Wait 60 seconds
   - Confirm: nav link hidden, direct URL redirects to home, homepage section hidden, Ubunye doesn't mention productions
   
2. **Flag on path:**
   - Toggle `smart_productions` ON in admin UI
   - Wait 60 seconds
   - Confirm: nav link visible, direct URL loads, homepage section visible, Ubunye includes productions
   
3. **Audit trail:**
   - Check `/admin/flags/history` after toggling
   - Confirm: event logged with correct user, timestamp, old/new values
   
4. **Access control:**
   - Log in as non-admin user
   - Try to access `/admin/flags` — should be denied
   - Try to call toggleFlag server action directly — should throw
   
5. **Performance:**
   - Confirm `getFlag` doesn't hammer database (cached for 60s)
   - Confirm admin toggle takes <2s to update DB + invalidate cache

---

## Update MEMORY.md

After completion, append:

```
## Session: TASK-043 — Feature Flag System (2026-04-XX)
### Branch: feature/task-043-feature-flags
### Built:
- feature_flags table with RLS and audit trigger
- lib/features.ts with typed flag access, 60s cache, revalidation on write
- <FeatureGate> component for UI gating
- Admin UI at /admin/flags with toggle switches and confirmation
- Audit log at /admin/flags/history
- Middleware safety net for /smart-productions/*
### Flags seeded:
- smart_productions (OFF) — launch later after rentals traction
- smart_productions_booking (OFF) — depends on smart_productions
- studio_crews (OFF) — V5+ feature
- voice_onboarding (OFF) — Phase 2
- ai_rate_suggestions (ON) — Claude rate suggestions during onboarding
- ai_portfolio_tagging (ON) — Gemma 4 portfolio auto-tagging
### How to add new flags:
1. Add key to FEATURE_KEYS in lib/features.ts
2. Insert row into feature_flags via migration or admin UI
3. Wrap relevant UI in <FeatureGate flag="your_flag_key">
4. Add page-level guard if it's a routed page
5. Add middleware entry if it needs URL-level blocking
### Notes: All flag state is in database, never env vars. Changes take effect within 60s.
```

---

## Post-Session

```
/pre-merge
```

Verify CI passes and all acceptance criteria are met before merging.