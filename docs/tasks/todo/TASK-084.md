# TASK-084: Mobile apps on Google Play and the App Store (Capacitor)

## Status: In progress (step 1 done on feature/mobile-app)

## Summary
Publish ThabangVision as an Android and an iOS app from one Capacitor project
in `mobile/`, a native shell around www.thabangvision.com with native push,
app links, sign-in that works inside an app, and an offline screen. Plan and
store rules: `docs/mobile/README.md`.

## Steps
- [x] 1. Scaffold: `mobile/` (Capacitor 8, app id `com.thabangvision.app`), Android and iOS projects, offline screen, splash and status bar in the site colours, website build ignores `mobile/`, CI builds a debug APK and (on demand) an iOS simulator build.
- [ ] 2. Google sign-in in the system browser, returning through an app link to `/auth/callback`; email + password unchanged.
- [ ] 3. Sign in with Apple (Supabase Apple provider), required by App Store rule 4.8 because Google sign-in is offered.
- [ ] 4. In-app account deletion in the dashboard (App Store rule 5.1.1(v); also the POPIA erasure path on the web).
- [ ] 5. Native push: Firebase project, `@capacitor/push-notifications` registration, `POST /api/push/devices`, sender sends Web Push and FCM. Booking and delivery updates reach the app.
- [ ] 6. App links: `public/.well-known/assetlinks.json` and `apple-app-site-association`, Associated Domains entitlement, `appUrlOpen` routing.
- [ ] 7. Paystack checkout tested in both apps with a sandbox card (opens outside the app and returns).
- [ ] 8. Icons and splash from a 1024x1024 master; store screenshots at phone sizes.
- [ ] 9. Signed release builds in CI: Play App Bundle (upload keystore in secrets), iOS archive to TestFlight.
- [ ] 10. Store listings, privacy labels and data safety forms, internal testing, then production.

## Owner actions
- [ ] Google Play Console account as ThabangVision (Pty) Ltd (US$25 once)
- [ ] Apple Developer Program as an organisation (US$99 a year)
- [ ] D-U-N-S number for ThabangVision (Pty) Ltd (free, needed by both stores)
- [ ] Firebase project for Cloud Messaging (free)
- [ ] App icon master (1024x1024 PNG)

## Acceptance
- Both apps install from internal testing tracks, open the live site, survive no signal (offline screen), sign in with Google, Apple and email + password, receive a booking push, open thabangvision.com links in the app, and complete a sandbox Paystack payment.
- Website build, tests and CI unchanged by `mobile/`.
