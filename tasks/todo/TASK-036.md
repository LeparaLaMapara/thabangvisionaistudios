# TASK-036: Bug Fixes + Auth Improvements — Agent Teams Session
## Priority: CRITICAL | Phase: V2/V3 | Sprint: Testing Week
## Created: 2026-03-18

---

## Pre-Session Setup

Before starting, run:
```
/new-session
```
Branch name: `fix/task-036-testing-bugs`

Then read these files first:
```
Read CLAUDE.md
Read MEMORY.md
Read lib/constants.ts
Read app/(marketing)/login/page.tsx
Read app/(marketing)/register/page.tsx
Read middleware.ts
Read lib/auth/supabase.ts
```

---

## Context

User testing revealed 10 bugs and 3 auth improvements needed. Real users (family testers) reported: registration failures, login flicker, password reset confusion, avatar upload broken, admin mobile nav broken. One tester said: "I can't get by the registration part, I've tried 2 emails already." Another hit "email rate limit exceeded" on password reset.

Platform is live at: https://thabangvisionnonprod.vercel.app
Supabase project: https://zbdsqvpxpsygbuqnuekm.supabase.co
Stack: Next.js 16, React 19, TypeScript 5, Tailwind v4, Supabase, Vercel AI SDK, Cloudinary

---

## Fixes — Priority Order

### FIX 1: Registration Failing (CRITICAL)
**Bug:** New users cannot register. Tester tried 2 different emails and couldn't get past registration.
**Likely cause:** RLS policy on profiles table blocks INSERT, or auth trigger missing/broken.

- Read `app/(marketing)/register/page.tsx`
- Check if Supabase auth trigger `handle_new_user` exists — if not, create it:
  ```sql
  create or replace function handle_new_user()
  returns trigger as $$
  begin
    insert into profiles (id, email)
    values (new.id, new.email)
    on conflict (id) do nothing;
    return new;
  end;
  $$ language plpgsql security definer;

  create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function handle_new_user();
  ```
- The register page should ONLY call `supabase.auth.signUp()` — do NOT insert into profiles from the frontend. Let the trigger handle it.
- If the register page still inserts into profiles, change it to upsert or remove it entirely.
- Check RLS policies: `SELECT * FROM pg_policies WHERE tablename = 'profiles';`
- Test: register with a new test email and confirm it works.

**Acceptance:** New user can register with email and password. No errors. Profile created automatically.

---

### FIX 2: Login → Dashboard Redirect Broken (CRITICAL)
**Bug:** After login, navigating to /dashboard doesn't work until manual page refresh. Auth state is stale.

- Read `app/(marketing)/login/page.tsx`
- Find `router.push('/dashboard')` and change to `window.location.href = '/dashboard'`
- Do the same in register page: change `router.push` to `window.location.href`
- Do the same for sign out: change `router.push('/')` to `window.location.href = '/'`
- Reason: `router.push` does client-side navigation without re-evaluating middleware cookies. `window.location.href` forces a full server request with fresh auth cookies.

**Acceptance:** Login → immediately see dashboard. No refresh needed. Sign out → immediately see home page.

---

### FIX 3: Whole Page Auth Flicker (HIGH)
**Bug:** Entire page flickers between logged-out and logged-in state on every page load.

- Create `providers/AuthProvider.tsx`:
  - Takes `initialUser` prop from server
  - Uses `createContext` with `{ user, loading }` state
  - Initializes from `initialUser` (no flash)
  - Listens to `onAuthStateChange` for updates
- Update `app/layout.tsx` (server component):
  - Get user from cookies: `const { data: { user } } = await supabase.auth.getUser()`
  - Pass to `<AuthProvider initialUser={user}>`
- Update Header component:
  - Use `useAuth()` hook instead of local auth state
  - While `loading === true`, render invisible placeholder
  - Show correct buttons only after loading resolves
- Apply to desktop header AND mobile menu

**Acceptance:** No flicker on any page load. Auth state correct on first render.

---

### FIX 4: Password Reset Error Message (HIGH)
**Bug:** Shows raw "email rate limit exceeded" when user clicks reset too many times.

- Read forgot password handler on login page
- Catch the rate limit error and show user-friendly message:
  `"We've already sent a reset link. Please check your inbox and spam folder. You can try again in 60 minutes."`
- For non-existent emails, always show: `"If this email exists, we've sent a reset link. Check your inbox and spam folder."` (don't reveal if account exists)

**Acceptance:** No raw Supabase error messages visible to users. Always friendly text.

---

### FIX 5: Add Magic Link Login (HIGH)
**Bug:** Users (especially non-technical) struggle with passwords.

- Add magic link option to login page:
  ```
  [Enter your email]
  [SEND ME A SIGN IN LINK]
  
  ── or sign in with password ──
  
  [Email]
  [Password]
  [SIGN IN]
  ```
- Implementation:
  ```typescript
  const handleMagicLink = async () => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
      },
    });
    if (error) setError(error.message);
    else setMessage('Check your email for a sign-in link. No password needed.');
  };
  ```
- Create `/auth/callback/route.ts`:
  ```typescript
  export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    if (code) {
      const supabase = await createServerClient();
      await supabase.auth.exchangeCodeForSession(code);
    }
    // Check if profile has display_name
    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .single();
    
    if (!profile || !profile.display_name) {
      return NextResponse.redirect(new URL('/onboarding', request.url));
    }
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }
  ```
- Simplify register page: same magic link option + optional password
- Make sure Supabase has Email OTP enabled: Authentication → Providers → Email

**Acceptance:** User can enter email, receive link, click it, arrive at dashboard. No password needed.

---

### FIX 6: Add Google OAuth (HIGH)
**Bug:** One-click sign-in is the easiest option for non-technical users.

- Add Google sign-in button to login and register pages:
  ```typescript
  const handleGoogleSignIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
      },
    });
  };
  ```
- Button: white bg, Google G icon, text "Sign in with Google"
- Same `/auth/callback` route handles Google redirect → check profile → onboarding or dashboard
- Login page order: Google button → magic link → password (collapsed under "or sign in with password")
- Note: Google OAuth credentials must be configured in Supabase by the admin. Add a TODO comment with setup instructions.

**Acceptance:** Google sign-in button visible. Flow works if Google OAuth is configured in Supabase.

---

### FIX 7: Onboarding Flow for New Users (MEDIUM)
**Bug:** Magic link and Google users have no profile data on first sign-in.

- Create `app/(platform)/onboarding/page.tsx`:
  - Only accessible when logged in
  - Form fields:
    - Display name (required)
    - What do you do? (optional, multi-select pills: Photography, Cinematography, Editing, Sound, Directing, Other)
    - Phone (optional)
  - On submit: upsert profile with display_name, specializations, phone → redirect to /dashboard
  - "Skip for now" link → redirect to /dashboard
- Auth callback route checks for display_name:
  - Has display_name → /dashboard
  - No display_name → /onboarding
- Register page: remove display_name field. Only email + password (optional). Onboarding handles the rest.

**Acceptance:** New user (any method) → onboarding → fill name → dashboard. Only shows once.

---

### FIX 8: Avatar Upload Failing (MEDIUM)
**Bug:** Profile page shows "Failed to upload avatar."

- Read the profile page and avatar upload handler
- Check if `/api/cloudinary/sign` requires auth — if so, ensure auth cookie is sent
- Check if Cloudinary environment variables are set in Vercel
- Check if the upload handler sends the correct file format
- If using Supabase Storage instead of Cloudinary, check bucket policies
- Show initials fallback when avatar is null/missing

**Acceptance:** User can upload avatar from profile page. Avatar displays correctly. Initials shown as fallback.

---

### FIX 9: Admin Mobile Nav Broken (MEDIUM)
**Bug:** Admin page icons overflow on mobile screens.

- Read `app/(admin)/layout.tsx` or admin nav component
- On mobile (< 768px): collapse admin nav into a hamburger menu
- Same pattern as the main site mobile nav
- Admin nav items: Dashboard, Rentals, Press, Careers, Bookings, Verifications, Users
- Hamburger toggles open/closed

**Acceptance:** Admin panel fully usable on mobile. No overflow. Hamburger menu works.

---

### FIX 10: Mobile Menu Close (MEDIUM)
**Bug:** Main site mobile menu has no way to close once opened.

- Read the header/mobile menu component
- Hamburger icon should TOGGLE: tap to open, tap again to close
- Same icon, same position, always visible (z-index above overlay)
- Clicking any nav link closes the menu
- Clicking any CTA button closes the menu
- Header z-index: 300, menu overlay z-index: 200

**Acceptance:** Mobile menu opens and closes with hamburger. Clicking any link closes menu.

---

### FIX 11: Ubunye Links Not Clickable (LOW)
**Bug:** Ubunye writes paths as plain text (/smart-production) instead of clickable markdown links.

- Read `lib/ubunye/system-prompt.ts`
- Add to behaviour rules in system prompt:
  ```
  "When sharing page links, ALWAYS format them as markdown links: [Page Name](/path).
  Example: [View our portfolio](/smart-production) NOT /smart-production
  Example: [Sony Alpha A7 III](/smart-rentals/cameras-optics/sony-alpha-a7-iii) NOT just the path.
  Never write raw URLs or paths — always wrap in markdown link syntax."
  ```

**Acceptance:** Ubunye responses contain clickable links that navigate within the app.

---

### FIX 12: Ubunye Uses Emojis (LOW)
**Bug:** Ubunye uses emojis which look unprofessional for a premium platform.

- Read `lib/ubunye/system-prompt.ts`
- Add to behaviour rules: `"Never use emojis in responses. Keep the tone professional, clean, and direct."`

**Acceptance:** Ubunye responses contain zero emojis.

---

## Post-Fix Verification

After all fixes, run:
```bash
npm run build
npm run test
npm run test:e2e
```

All must pass. Then:

1. Test registration with a new email
2. Test login → dashboard redirect (no refresh needed)
3. Test magic link flow
4. Test sign out → home redirect
5. Test mobile menu open/close
6. Test admin on mobile
7. Test Ubunye chat — verify links are clickable and no emojis
8. Test avatar upload
9. Test forgot password error messages

Report results for each test.

---

## Update MEMORY.md

After all fixes are complete, append to MEMORY.md:

```
## Session: TASK-036 — Bug Fixes + Auth Improvements (2026-03-18)
### Branch: fix/task-036-testing-bugs
### Fixes Applied:
- Registration: auth trigger creates profile, frontend only calls signUp()
- Login redirect: window.location.href replaces router.push for auth transitions
- Auth flicker: AuthProvider with initialUser from server eliminates page flash
- Password reset: user-friendly error messages, no raw Supabase errors
- Magic link login: passwordless sign-in via email OTP
- Google OAuth: one-click sign-in (requires Google Console setup)
- Onboarding: new users fill profile on first login, works for all auth methods
- Avatar upload: [describe fix]
- Admin mobile nav: hamburger menu for admin on mobile
- Mobile menu: hamburger toggle open/close
- Ubunye: system prompt updated — markdown links required, no emojis
### Tests: [X/Y passed]
### Notes: [any blockers or follow-ups]
```

---

## Post-Session

```
/pre-merge
```

Verify CI passes. Then merge to main. Run `/end-session`.