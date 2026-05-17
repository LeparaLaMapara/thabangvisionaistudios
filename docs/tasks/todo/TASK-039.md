# TASK-039: AI-Generated Press Cover Images via Google Imagen 3

## Status: Todo

## Summary
Generate cover visuals for press articles using Google Imagen 3, which is available through the existing Google AI API key (`GEMINI_API_KEY`). Upload generated images to Cloudinary and attach them to press entries (`cover_url`, `cover_public_id`).

## Why
Press articles currently have no cover images. Manually creating or sourcing visuals for every article is slow. Imagen 3 can generate on-brand visuals from the article title/excerpt, keeping the press page visually rich without a designer.

## Implementation

### API Route
- `app/api/admin/press/generate-cover/route.ts`
  - POST: accepts `{ pressId, prompt? }`
  - If no prompt provided, auto-generate one from the article title + excerpt
  - Call Imagen 3 via `@google/generative-ai` (same SDK as vision/portfolio tools)
  - Upload result to Cloudinary under `press/covers/` folder
  - Update `press` row with `cover_url` and `cover_public_id`
  - Admin-only route (`requireAdmin()`)

### AI Integration
- Use `@google/generative-ai` SDK (already installed, used by onboarding/portfolio agents)
- Imagen 3 model: `imagen-3.0-generate-002`
- Default prompt template: cinematic, editorial style matching ThabangVision brand (dark tones, gold accent, South African creative industry)
- Wrap with `trackedCompletion()` or equivalent cost tracking
- Register `press-cover` agent in `lib/agents/registry.ts`

### Admin UI Enhancement
- Add "Generate Cover" button on each press article in `/admin/press`
- Show loading state while generating
- Preview generated image before saving
- Option to regenerate with a custom prompt

### Prompt Strategy
- Auto-prompt from title: e.g. "ThabangVision Launches AI-Powered Equipment Rental Platform" → "Editorial photograph of professional film equipment — cinema camera, lighting rig, and drone — arranged on a dark surface with warm gold accent lighting. South African creative production studio aesthetic. No text."
- Style keywords: cinematic, editorial, dark background, warm gold tones, professional, South African
- Negative: no text, no logos, no watermarks, no people's faces (avoid likeness issues)

### Cloudinary Storage
- Folder: `press/covers/`
- Public ID format: `press/covers/{slug}`
- Use existing `lib/cloudinary/` upload helpers

## Dependencies
- `GEMINI_API_KEY` env var (already set)
- `@google/generative-ai` package (already installed)
- Cloudinary credentials (already configured)

## Priority
Low — nice-to-have visual polish for the press page.
