# TASK-082: The site in isiZulu and Sesotho
## Priority: MEDIUM | Asked for by the owner on 2026-10-13
## Files allowed: package.json, i18n setup (new), messages/*.json (new), proxy.ts, components/layout/*, the pages in stage 1 and 2, lib/email/*, lib/agents/runtime.ts, one migration (profiles.locale)

## What the owner wants
A switch so people can use the site in English, isiZulu or Sesotho. Only these
three. No other languages.

## Today
No language support at all. All words are typed straight into about 90 pages.

## Plan
1. Add next-intl. Move the words into `messages/en.json`, `messages/zu.json`,
   `messages/st.json`.
2. A language switch in the header and footer (English, isiZulu, Sesotho).
   Remember it with a cookie; for signed-in people, save it on the profile
   (`profiles.locale`, default `en`).
3. Own address per language for search engines: `/zu/...`, `/st/...`, English
   stays at `/`. Add hreflang links and the sitemap entries.
4. Stage 1 (most used): header, footer, home, sign in, rentals, gear page,
   booking and checkout, welcome and nudge emails, push messages.
5. Stage 2: dashboard and creator onboarding.
6. Stays English: admin pages and legal documents (Terms, Privacy). Legal text
   needs a proper legal translation.
7. Ubunye replies in the chosen language by default (lib/agents/runtime.ts).
8. Emails and pushes go out in the person's saved language.

## Quality rule
Claude drafts isiZulu and Sesotho; it is good but not native. Before going live,
a fluent speaker reviews each language (booking, money and cancellation wording
first). Keep wording simple and everyday, not formal or academic.

## Done when
- The switch works on every stage 1 page in all three languages, on phone width.
- A missing translation falls back to English, never shows a key.
- A test fails if a key exists in en.json but not in zu.json or st.json.
- Reviewed by a fluent speaker for each language.
