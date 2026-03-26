# TASK-035: Ubunye - Ask Ubunye Button on All Pages
## Priority: FEATURE | Phase: V3 | Depends on: TASK-018, TASK-019
## Files allowed: components/ubunye/AskUbunyeButton.tsx (create), app/(platform)/smart-rentals/page.tsx, app/(platform)/smart-rentals/[category]/[slug]/page.tsx, app/(platform)/smart-production/page.tsx, app/(platform)/pricing/page.tsx, app/(platform)/ubunye-ai-studio/page.tsx
## Description
Floating "Ask Ubunye" button on key pages with contextual pre-loaded prompts. Navigates to Ubunye chat with ?prompt param that auto-sends first message.
## Acceptance criteria
- [ ] AskUbunyeButton component with prompt and label props
- [ ] Ubunye chat reads ?prompt query param and auto-sends
- [ ] Button on: Smart Rentals, Rental Detail, Smart Productions, Pricing
- [ ] Each page passes contextual prompt
- [ ] Mobile: bottom sticky, Desktop: bottom-right floating
- [ ] npm run build passes