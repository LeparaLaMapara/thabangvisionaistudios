# ThabangVision mobile apps (Android and iOS)

One Capacitor project in `mobile/` builds both store apps. The app is a native
shell around the live site, https://www.thabangvision.com: every web release
reaches the apps the moment Vercel deploys it, with no store update. What the
shell adds is what a browser tab cannot do well.

| Layer | What it is |
|---|---|
| `mobile/capacitor.config.ts` | App id `com.thabangvision.app` (permanent once published), name, the site URL, which domains may open inside the app, splash, status bar and push settings |
| `mobile/www/index.html` | The offline screen, shown when the site cannot load |
| `mobile/android/` | The Android Studio project (Gradle, SDK 36, min SDK 24) |
| `mobile/ios/` | The Xcode project (Swift Package Manager, no CocoaPods) |
| `.github/workflows/mobile.yml` | A debug APK on every change to `mobile/` (artifact on the run page); an unsigned iOS simulator build on demand |

The website build ignores `mobile/` (tsconfig `exclude`, ESLint ignores,
`.vercelignore`).

## Why a shell, and why Capacitor

- The site is server rendered (Next 16, API routes, `force-dynamic` pages), so
  it cannot be exported to static files and bundled into the app. Loading the
  live URL keeps one codebase and instant updates.
- Capacitor builds both Android and iOS from one project and gives native
  plugins (push, app links, back button, status bar). Cordova is effectively
  unmaintained; a Trusted Web Activity covers Android only.

## What the stores will check, and the plan for each

| Store rule | Risk for this app | Plan |
|---|---|---|
| Apple 4.2, minimum functionality (no "website in a box") | High: Apple rejects thin wrappers | Native push for booking and delivery updates, links that open the app, native share, offline screen, camera upload for portfolios and ID checks. Ship push before the first iOS submission. |
| Apple 4.8, Sign in with Apple | High: the app offers Google sign-in, so Apple requires an equivalent option | Add "Sign in with Apple" (Supabase supports the Apple provider) to the login screen, shown at least on iOS. |
| Apple 5.1.1(v), account deletion | High: no in-app account deletion exists today | Add "Delete my account" in the dashboard (POPIA erasure path), on the web too. |
| Google sign-in inside a WebView | Blocked: Google refuses OAuth in embedded WebViews (`disallowed_useragent`) | Open Google sign-in in the system browser (`@capacitor/browser`), return through an app link to `/auth/callback`, then hand the session back to the WebView. Email + password already works inside the app. |
| Paystack 3-D Secure | Medium: bank pages can break in WebViews | Keep checkout on paystack.com outside `allowNavigation`, so it opens in the system browser and returns through the callback URL. Test with a sandbox card on both platforms. |
| Play target SDK | Fine | SDK 36 from the Capacitor 8 template. |
| Play new personal accounts: 12 testers for 14 days before production | Avoided with an organisation account | Register the Play account as ThabangVision (Pty) Ltd (needs a D-U-N-S number), or run the 14-day closed test. |
| Privacy labels / data safety forms | Paperwork | Fill from `app/(marketing)/privacy` and the POPIA consent records. |

## Push notifications

The site already sends Web Push (VAPID, `public/sw.js`,
`components/notifications/PushPrompt.tsx`). Inside the apps, Web Push is not
available on iOS WebViews, so the apps use native push:

1. Firebase Cloud Messaging (free) for Android, and APNs through FCM for iOS.
2. The app registers with `@capacitor/push-notifications` and posts its device
   token to a new endpoint (for example `POST /api/push/devices`), stored next
   to the existing web subscriptions.
3. The notification sender (`lib/push/`) sends to both: Web Push for browsers,
   FCM for app devices. Delivery updates (#111) and booking updates use it.

## Links that open the app

- Android App Links: `public/.well-known/assetlinks.json` with the app's
  signing certificate SHA-256 (known once the Play upload key exists).
- iOS Universal Links: `public/.well-known/apple-app-site-association` with the
  Apple Team ID, plus the Associated Domains entitlement in Xcode.
- `@capacitor/app` `appUrlOpen` routes the link inside the WebView; this is
  also how Google sign-in and Paystack return to the app.

## Building

| | Where | Needs |
|---|---|---|
| Android debug APK | GitHub Actions (every change) or locally | Locally: Android Studio or the command-line SDK (not installed on the dev PC yet) and JDK 21 |
| Android release (AAB for Play) | GitHub Actions | An upload keystore stored as repository secrets |
| iOS simulator build | GitHub Actions on demand | Nothing extra |
| iOS release (TestFlight, App Store) | GitHub Actions macOS runner or Codemagic | Apple Developer membership, a distribution certificate and provisioning profile (or an App Store Connect API key with fastlane match) |

Local commands, from `mobile/`:

```
npm ci
npx cap sync            # copy config and plugins into both native projects
npx cap open android    # Android Studio
npx cap open ios        # Xcode (macOS only)
```

## What the owner must set up

| Item | Cost | Why |
|---|---|---|
| Google Play Console developer account (organisation: ThabangVision (Pty) Ltd) | US$25 once | Publish on Play |
| Apple Developer Program (organisation) | US$99 a year | Publish on the App Store and TestFlight |
| D-U-N-S number for ThabangVision (Pty) Ltd | Free | Both stores require it for organisation accounts |
| Firebase project (Cloud Messaging) | Free | Native push on both platforms |
| App icon (1024x1024 PNG) and store screenshots | Design time | Store listings; the splash uses the site colours |
