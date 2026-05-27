# TASK-056: Multi-Modal Client Intake — Image, Voice & Natural Language Brief Creation

## Status: Todo

## Summary
Replace form-based client intake with a multi-modal experience where clients can upload inspiration images, record voice memos, paste Pinterest URLs, or write naturally — and AI synthesizes all inputs into a structured brief, asks clarifying questions, and presents matched creators with reasoning. This is the highest-impact conversion optimization available.

## Why
Forms are friction. Forms are also limited — they can't capture "I want something like this" (pointing at an image) or "let me just tell you what I need" (voice). Multi-modal intake meets clients where they are and dramatically reduces the gap between intent and booking. Conservative estimate: 3-5x improvement in inquiry-to-booking conversion.

## Architecture

### Input Modes
| Mode | Technology | Processing |
|------|-----------|------------|
| **Text** | Ubunye chat (existing) | NLP intent extraction |
| **Inspiration Image** | Upload or paste | Gemini vision analysis → style matching |
| **Voice Memo** | Browser MediaRecorder API | Gemini audio transcription → NLP extraction |
| **Reference URL** | Paste URL | Fetch page → AI extracts style/requirements |
| **Combined** | Any mix of the above | All inputs merged into unified brief |

### Processing Pipeline
```
Raw inputs (text + images + audio + URLs)
  → Per-mode processing (transcription, vision analysis, web scrape)
  → Unified brief synthesis
  → Clarifying questions (if needed)
  → Creator matching (using TASK-046 graph)
  → Ranked results with reasoning
  → "Book Now" action
```

### Brief Schema
```typescript
type SynthesizedBrief = {
  projectType: string;         // wedding, corporate, portrait, etc.
  location: string;
  preferredDates: string;
  duration: string;
  stylePreferences: string[];  // from image analysis
  budgetRange: { min: number; max: number };
  deliverables: string[];
  specialRequirements: string;
  inspirationAnalysis?: {
    colorPalette: string[];
    compositionStyle: string;
    mood: string;
    referenceImages: string[];
  };
  confidence: number;          // how complete is this brief
  missingInfo: string[];       // what should we ask next
};
```

## Implementation Plan

### 1. Image Analysis (`lib/intake/image.ts`)
- Accept uploaded image(s) via Ubunye chat or dedicated upload zone
- Send to Gemini vision model for style analysis
- Extract: color palette, composition style, subject matter, mood, quality tier
- Return as `inspirationAnalysis` block for brief synthesis
- Use existing Cloudinary upload for temporary storage

### 2. Voice Memo Processing (`lib/intake/audio.ts`)
- Browser-side: MediaRecorder API captures audio
- Upload audio blob to API endpoint
- Server-side: Gemini audio model transcribes and extracts structured data
- Return transcription + extracted requirements
- Max duration: 2 minutes (cost control)

### 3. URL Analysis (`lib/intake/url.ts`)
- Accept Pinterest, Instagram, Behance, or generic URLs
- Server-side fetch with appropriate user-agent
- AI extracts: style elements, project type indicators, reference imagery descriptions
- No images stored from external URLs — only AI-generated descriptions

### 4. Brief Synthesizer (`lib/intake/synthesizer.ts`)
- Merges all input modes into a single `SynthesizedBrief`
- Identifies gaps: "We know you want wedding photography, but need dates and location"
- Generates clarifying questions ranked by importance
- Confidence score: how complete is the brief (0-1)
- When confidence > 0.7, proceed to matching

### 5. Enhanced Ubunye Integration
- Ubunye booking flow already handles text-based intake
- Extend to accept image uploads in chat: "Send me an inspiration image and I'll find creators who match that style"
- Voice memo button in chat UI: "Or just tell me what you need"
- URL paste detection: auto-analyze when user pastes a URL
- All processing through existing agent routing (booking agent)

### 6. Creator Matching Enhancement
- Use TASK-046 embeddings for style-based matching
- When inspiration image provided: embed image → find nearest creator style vectors
- Explain matches: "We matched you with X because their color palette and composition style closely match your inspiration images"
- Rank by: style similarity × availability × rating × price fit

### 7. UI Components
- **Image Upload Zone** — drag/drop or paste in Ubunye chat (or dedicated intake page)
- **Voice Record Button** — hold-to-record with waveform visualization
- **URL Input** — auto-detects and shows preview
- **Brief Preview Card** — shows synthesized brief with edit capability
- **Match Results** — creator cards with match reasoning

### 8. Dedicated Intake Page (Alternative to Chat)
- `/get-started` or `/find-creators` — standalone intake experience
- Step 1: "What do you need?" (text/voice/image/URL — any combination)
- Step 2: AI-generated brief with clarifying questions
- Step 3: Matched creators with "Book Now" buttons
- Feeds into existing booking flow

## Files to Create/Modify
```
CREATE:
  lib/intake/image.ts — inspiration image analysis
  lib/intake/audio.ts — voice memo processing
  lib/intake/url.ts — URL content extraction
  lib/intake/synthesizer.ts — multi-modal brief synthesis
  lib/intake/types.ts
  app/api/intake/analyze/route.ts — multi-modal analysis endpoint
  app/(platform)/get-started/page.tsx — standalone intake page
  app/(platform)/get-started/IntakeFlow.tsx — client component
  components/intake/ImageUpload.tsx
  components/intake/VoiceRecorder.tsx
  components/intake/BriefPreview.tsx

MODIFY:
  components/ubunye/ — add image upload + voice record to chat UI
  lib/agents/agents/booking.ts — enhance with multi-modal context
  lib/agents/router.ts — route multi-modal inputs to booking agent
```

## Dependencies
- TASK-046 (creator graph) — style-based matching uses creator embeddings
- Gemini multimodal API (existing GEMINI_API_KEY)
- Cloudinary (temporary image storage, exists)
- Existing booking flow (exists)

## Acceptance Criteria
- [ ] Image upload triggers style analysis and returns matched creators
- [ ] Voice memo records, transcribes, and extracts structured requirements
- [ ] URL paste auto-analyzes and incorporates into brief
- [ ] Brief synthesizer merges multiple input modes correctly
- [ ] Clarifying questions generated for incomplete briefs
- [ ] Creator matching explains WHY each creator was suggested
- [ ] Works on mobile (44px touch targets, responsive layout)
- [ ] Voice recording works in major browsers (Chrome, Safari, Firefox)
- [ ] All AI calls wrapped in trackedCompletion()
- [ ] Audio files not retained after processing (privacy)
- [ ] npm run build passes
- [ ] npm run test passes

## Effort Estimate
3-4 weeks for core (text + image). +1 week for voice. +1 week for URL analysis.

## Priority
**HIGH — Build first.** This is the single highest-impact feature for conversion. Even without the full creator graph (TASK-046), image-based style analysis + better text intake will meaningfully improve the booking funnel. Start with text + image (Gemini vision already available), add voice and URL later.

## Risk Notes
- Voice recording requires HTTPS (browser security requirement — already on Vercel)
- Audio processing costs: cap at 2 minutes per memo, warn users at 1:30
- Image analysis costs: max 5 images per intake session
- Pinterest/Instagram URL fetching may be rate-limited or blocked — graceful degradation needed
- Mobile UX is critical — SA audience is mobile-first. Test extensively on mobile.
- Audio files MUST be deleted after transcription — never retain voice recordings
- Inspiration images are temporary — delete after analysis unless client explicitly saves
