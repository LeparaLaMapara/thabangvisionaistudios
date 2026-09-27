# TASK-066: Google sign-in creates the account but never logs the person in
## Priority: CRITICAL | Phase: V5 | Depends on: none
## Files allowed: app/auth/, app/(marketing)/login/, app/(marketing)/register/, lib/auth/, proxy.ts, lib/constants.ts
## Description
Checked on prod 2026-09-27: every Google signup since 2026-08-20 (14 people)
has an auth identity (Google approved them) but no session and no
`last_sign_in_at`. Email signups sign in fine. The last Google sign-ins that
worked were in June (2026-06-16, 2026-06-19). People press "Continue with
Google", come back logged out, and several then created an email account
minutes later (for example 13:23 Google, then 13:26 and 13:30 email).

Suspected cause (not yet confirmed): the OAuth redirect or the PKCE code
verifier cookie is on the apex `thabangvision.com` (STUDIO.meta.url) while the
site is served on `www`, so the callback cannot exchange the code. Check the
Supabase Auth redirect URL list, the `redirectTo` the login page sends, and the
callback route's `exchangeCodeForSession` error, reproduced on a preview.

## Acceptance criteria
- [ ] A Google sign-in on www.thabangvision.com ends signed in (session row exists)
- [ ] The callback logs a clear error instead of failing silently
- [ ] An e2e or integration check covers the Google callback path
- [ ] The 14 affected people can sign in with Google afterwards (same account)
