# Auth Abstraction Layer

## Overview

The authentication system uses a **provider abstraction** pattern that allows switching between auth providers (Supabase, or future providers like NextAuth, Clerk, etc.) with a single environment variable. All auth checks -- user retrieval, route protection, and admin verification -- go through a unified interface defined in `lib/auth/`.

---

## Architecture

```
lib/auth/
  types.ts      - Shared types and AuthProvider interface
  supabase.ts   - Supabase adapter (@supabase/ssr cookie-based auth)
  index.ts      - Provider registry, env-based selection, convenience re-exports
```

### How Provider Selection Works

```
AUTH_PROVIDER env var
        |
        v
  index.ts reads env var (defaults to "supabase")
        |
        v
  Looks up in providers registry: { supabase }
        |
        v
  Exports the matched provider as `auth`
```

All layouts, pages, and API routes import from `@/lib/auth` and call `auth.getUser()`, `requireAuth()`, `requireAdmin()`, or `isAdmin()`. They never reference a specific provider directly.

---

## The AuthProvider Interface

Every provider implements this interface (`lib/auth/types.ts`):

```typescript
interface AuthProvider {
  readonly name: string;

  getUser(): Promise<AuthUser | null>;
  requireAuth(): Promise<AuthResult>;
  requireAdmin(): Promise<AuthResult>;
  isAdmin(email: string): boolean;
  signOut(): Promise<void>;
}
```

### Key Types

| Type | Purpose |
|------|---------|
| `AuthUser` | Authenticated user object: `{ id: string; email: string }` |
| `AuthResult` | Discriminated union: `{ user: AuthUser }` on success, `{ error: NextResponse }` on failure |
| `AuthProvider` | Interface that all auth providers must implement |

### AuthResult Pattern

The `AuthResult` type uses a discriminated union for type-safe error handling:

```typescript
type AuthResult =
  | { user: AuthUser; error?: never }
  | { user?: never; error: NextResponse };
```

This means you can check for success with a simple conditional:

```typescript
const result = await auth.requireAuth();
if (result.error) return result.error;  // 401 response
// result.user is guaranteed to exist here
```

---

## How the Supabase Provider Works

### `getUser()` — Server Components & Layouts

Retrieves the current user from the Supabase session cookie. Uses a **dynamic import** of `@/lib/supabase/server` to avoid pulling server-only code into client bundles.

```
Request arrives
  -> proxy.ts refreshes session token (middleware)
  -> Layout/page calls auth.getUser()
  -> Dynamic import: lib/supabase/server.createClient()
  -> supabase.auth.getUser() reads cookie
  -> Returns { id, email } or null
```

This is the method used in Server Components:

```typescript
// In a Server Component or layout
import { auth } from '@/lib/auth';

const user = await auth.getUser();
if (!user) redirect('/login');
```

### `requireAuth()` — API Routes (Authenticated)

Calls `getUser()` internally and returns either the user or a 401 JSON response. Designed for API route handlers:

```typescript
// In an API route
import { requireAuth } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const result = await requireAuth();
  if (result.error) return result.error;  // { error: "Authentication required." }, 401

  const user = result.user;
  // ... proceed with authenticated user
}
```

### `requireAdmin()` — API Routes (Admin Only)

Calls `requireAuth()` first, then checks `isAdmin()`. Returns:
- `401` if not authenticated
- `403` if authenticated but not an admin

```typescript
// In an admin API route
import { requireAdmin } from '@/lib/auth';

export async function DELETE(request: NextRequest) {
  const result = await requireAdmin();
  if (result.error) return result.error;  // 401 or 403

  // ... proceed with verified admin
}
```

### `isAdmin()` — Email-Based Admin Check

Checks the user's email against the `ADMIN_EMAILS` list in `lib/constants.ts`. Comparison is case-insensitive:

```typescript
// lib/constants.ts
export const ADMIN_EMAILS: readonly string[] = [
  'thabangvisionstudios@gmail.com',
];
```

To add a new admin, append their email to this array. No provider changes needed.

### `signOut()` — Client-Side Sign Out

Uses a dynamic import of `@/lib/supabase/client` (browser client) to sign out. This method exists on the provider interface but is **not commonly used directly** -- the `LogoutButton` component calls the browser Supabase client directly to avoid pulling the full auth abstraction into client bundles.

---

## Session Refresh: proxy.ts (Middleware)

Session token refresh happens in `proxy.ts` at the project root. This is **Supabase-specific by design** because session refresh must manipulate request/response cookies at the middleware level, which is inherently tied to the auth provider's cookie strategy.

```
Every request (matching config.matcher)
  -> proxy.ts creates a Supabase server client from request cookies
  -> Calls supabase.auth.getUser() to trigger token refresh
  -> Sets refreshed cookies on both request and response
  -> Also performs CSRF validation on API mutations
```

If you switch to a different auth provider, you will need to update `proxy.ts` to handle that provider's session refresh mechanism.

---

## Convenience Re-Exports

`lib/auth/index.ts` re-exports standalone functions that delegate to the active provider. This ensures backward compatibility -- all existing imports work without changes:

| Export | Type | Delegates to |
|--------|------|-------------|
| `auth` | `AuthProvider` | The active provider object |
| `requireAuth()` | `async function` | `auth.requireAuth()` |
| `requireAdmin()` | `async function` | `auth.requireAdmin()` |
| `isAdmin(email)` | `function` | `auth.isAdmin(email)` |

### Import Styles

Both of these are valid and equivalent:

```typescript
// Style 1: Import the provider object
import { auth } from '@/lib/auth';
const user = await auth.getUser();

// Style 2: Import standalone functions
import { requireAuth, isAdmin } from '@/lib/auth';
const result = await requireAuth();
```

Use **Style 1** in layouts and pages (for `getUser()`). Use **Style 2** in API routes (for `requireAuth()` / `requireAdmin()`).

---

## Provider-Agnostic Utilities

`lib/auth/index.ts` also exports utilities that are not provider-specific:

### `checkRateLimit(key, maxRequests, windowMs)`

Simple in-memory rate limiter. Returns `true` if the request is allowed, `false` if rate-limited.

```typescript
import { checkRateLimit } from '@/lib/auth';

// Allow 5 requests per minute per IP
const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
if (!checkRateLimit(`contact:${ip}`, 5, 60_000)) {
  return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });
}
```

Used by: `/api/contact`, `/api/gemini`, `/api/bookings`, `/api/subscriptions`, `/api/cloudinary/sign`

**Note:** This is an in-memory store that resets on server restart. For production at scale, consider Redis-backed rate limiting.

### `isSafeUrl(url)`

Validates that a URL uses a safe protocol (`http:` or `https:` only). Blocks `javascript:`, `data:`, and other dangerous protocols:

```typescript
import { isSafeUrl } from '@/lib/auth';

if (!isSafeUrl(returnUrl)) {
  return NextResponse.json({ error: 'Invalid URL.' }, { status: 400 });
}
```

---

## How Routes Use the Abstraction

### Server Component Layout (Auth Guard)

From `app/(admin)/layout.tsx`:

```typescript
import { auth } from '@/lib/auth';

export default async function AdminLayout({ children }) {
  const user = await auth.getUser();

  if (!user) redirect('/login');

  // Check admin access
  if (!auth.isAdmin(user.email)) {
    redirect('/dashboard');
  }

  return <div>...</div>;
}
```

### Server Component Layout (Simple Auth Guard)

From `app/(platform)/dashboard/layout.tsx`:

```typescript
import { auth } from '@/lib/auth';

export default async function DashboardLayout({ children }) {
  const user = await auth.getUser();
  if (!user) redirect('/login');

  return <div>...</div>;
}
```

### Server Component Page (Auth + DB Queries)

From `app/(platform)/dashboard/page.tsx`:

```typescript
import { auth } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export default async function DashboardPage() {
  const user = await auth.getUser();
  // auth gives us the user; Supabase client is used separately for DB queries
  const supabase = await createClient();

  const { count } = await supabase
    .from('equipment_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id);
}
```

### API Route (Authenticated)

From `app/api/cloudinary/sign/route.ts`:

```typescript
import { requireAuth, checkRateLimit } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  if (!checkRateLimit(`cloudinary-sign:${ip}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });
  }

  const authResult = await requireAuth();
  if (authResult.error) return authResult.error;

  // ... sign upload params
}
```

### API Route (Admin Only)

From `app/api/cloudinary/delete/route.ts`:

```typescript
import { requireAdmin } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const adminResult = await requireAdmin();
  if (adminResult.error) return adminResult.error;

  // ... delete asset (only admins can do this)
}
```

---

## Client-Side Auth

Client components (Header, profile edit, listings page, etc.) **do not use the auth abstraction**. They use the browser Supabase client directly:

```typescript
'use client';
import { createClient } from '@/lib/supabase/client';

// For auth state
const supabase = createClient();
const { data: { user } } = await supabase.auth.getUser();

// For sign out (LogoutButton component)
await supabase.auth.signOut();
```

This is by design. The auth abstraction uses dynamic imports of server-only modules (`@/lib/supabase/server`) which cannot run in the browser. Client components that need auth state should use the browser Supabase client directly.

If you add a new auth provider, you'll also need to update these client-side components to use the new provider's browser SDK.

---

## How to Switch Providers

### Step 1: Set the environment variable

In `.env.local`:

```env
# Options: supabase (more providers can be added)
AUTH_PROVIDER=supabase
```

### Step 2: Create the provider adapter

Create `lib/auth/newprovider.ts` implementing the `AuthProvider` interface:

```typescript
import type { AuthProvider, AuthUser, AuthResult } from './types';

export const newProviderAuth: AuthProvider = {
  name: 'newprovider',

  async getUser(): Promise<AuthUser | null> {
    // Retrieve user from your provider's session
  },

  async requireAuth(): Promise<AuthResult> {
    const user = await this.getUser();
    if (!user) {
      return {
        error: NextResponse.json(
          { error: 'Authentication required.' },
          { status: 401 },
        ),
      };
    }
    return { user };
  },

  async requireAdmin(): Promise<AuthResult> {
    const auth = await this.requireAuth();
    if (auth.error) return auth;
    if (!this.isAdmin(auth.user.email)) {
      return {
        error: NextResponse.json(
          { error: 'Admin access required.' },
          { status: 403 },
        ),
      };
    }
    return { user: auth.user };
  },

  isAdmin(email: string): boolean {
    return ADMIN_EMAILS.includes(email.toLowerCase());
  },

  async signOut(): Promise<void> {
    // Sign out via your provider's browser SDK
  },
};
```

### Step 3: Register in `lib/auth/index.ts`

```typescript
import { newProviderAuth } from './newprovider';

const providers: Record<string, AuthProvider> = {
  supabase: supabaseAuth,
  newprovider: newProviderAuth,
};
```

### Step 4: Update proxy.ts

Update the middleware to handle your provider's session refresh mechanism (cookie handling, token refresh, etc.).

### Step 5: Update client-side components

Update `LogoutButton`, `Header`, and any other client components that use the browser Supabase client directly.

### Step 6: Restart the dev server

The provider is resolved at module load time. A server restart is required after changing `AUTH_PROVIDER`.

---

## Files Modified by This Abstraction

| File | Change |
|------|--------|
| `lib/auth/types.ts` | Created -- AuthProvider interface, AuthUser, AuthResult types |
| `lib/auth/supabase.ts` | Created -- Supabase adapter using @supabase/ssr |
| `lib/auth/index.ts` | Created -- Provider registry, env selection, convenience re-exports, rate limiter, URL validator |
| `lib/auth.ts` | Deleted -- Replaced by `lib/auth/index.ts` (all imports still work) |
| `app/(admin)/layout.tsx` | Updated -- uses `auth.getUser()` + `auth.isAdmin()` |
| `app/(platform)/dashboard/layout.tsx` | Updated -- uses `auth.getUser()` |
| `app/(platform)/dashboard/page.tsx` | Updated -- uses `auth.getUser()` + separate Supabase client for DB |
| `components/admin/LogoutButton.tsx` | Updated -- added comment explaining why it uses browser client directly |

### Files That Import From `@/lib/auth` (Unchanged, Backward Compatible)

These files required **zero changes** thanks to the convenience re-exports:

| File | Imports Used |
|------|-------------|
| `app/api/gemini/route.ts` | `requireAuth`, `checkRateLimit` |
| `app/api/contact/route.ts` | `checkRateLimit` |
| `app/api/bookings/route.ts` | `checkRateLimit` |
| `app/api/subscriptions/route.ts` | `checkRateLimit` |
| `app/api/cloudinary/sign/route.ts` | `requireAuth`, `checkRateLimit` |
| `app/api/cloudinary/delete/route.ts` | `requireAdmin` |
| `app/api/cloudinary/delete-folder/route.ts` | `requireAdmin` |
| `app/api/admin/verifications/route.ts` | `requireAdmin` |
| `app/api/admin/verifications/[id]/route.ts` | `requireAdmin` |

---

## Design Decisions

### Why dynamic imports in supabase.ts?

The `getUser()` method uses `await import('@/lib/supabase/server')` instead of a static import. This prevents the server-only `@supabase/ssr` server client from being bundled into client-side code. Without this, importing `@/lib/auth` in any context would pull in server dependencies and break client builds.

### Why is proxy.ts not abstracted?

Session refresh in middleware requires direct cookie manipulation that is fundamentally tied to the auth provider's session format. Supabase uses cookie-based JWTs that need to be refreshed on every request. Other providers (Clerk, NextAuth) have completely different middleware patterns. Abstracting this would add complexity without benefit -- when switching providers, the middleware must be rewritten regardless.

### Why does LogoutButton not use auth.signOut()?

The `LogoutButton` is a client component (`'use client'`). The auth abstraction's `signOut()` method uses dynamic imports which add unnecessary overhead for a simple sign-out action. The component calls `createClient()` from `@/lib/supabase/client` directly, which is the standard browser Supabase pattern.

### Why is admin check email-based?

The `ADMIN_EMAILS` list in `lib/constants.ts` provides a simple, auditable admin access control mechanism. Emails are compared case-insensitively. This approach:
- Works across all auth providers (every provider returns an email)
- Is easy to audit (one array in one file)
- Requires no database table or role system
- Can be extended to a role-based system later if needed
