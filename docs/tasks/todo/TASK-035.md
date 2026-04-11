# TASK-035 — AI-Powered Creator Onboarding (Gemma Vision + Claude Reasoning)

## Branch
feature/task-035-ai-onboarding

## Mission
Make creator onboarding so simple that Thabang's mom can complete it in 5 minutes without typing anything except her name. Every form field that can be auto-filled from a photo or a portfolio should be auto-filled. Every decision that needs reasoning should use Claude. Every vision task should use Gemma 4 (free via Google AI Studio).

**The aim: Zero friction. Zero typing. Zero abandoned onboardings.**

---

## Why This Matters

Most creator marketplaces lose 90% of signups at onboarding because:
- Too many forms to fill
- Manual tagging of every portfolio photo
- Writing bios and descriptions
- Figuring out what rates to charge
- Uploading documents and waiting for verification

ThabangVision's unfair advantage: **AI does the work, creator just confirms.**

When we launch, "AI-powered onboarding" is the headline feature. Not "coming soon." Already built.

---

## Architecture — Hybrid AI Strategy

```
GEMMA 4 VISION (free via Google AI Studio):
  ✓ Identify gear from photos OF equipment (camera bodies, lenses, lights, drones)
  ✓ Auto-fill gear listing fields (name, brand, model, condition)
  ✓ Map detected gear to smart rental categories (constrained to 9 categories)
  ✓ Tag portfolio photos (scene type, lighting, quality)
  ✓ Classify scene types (wedding, portrait, corporate, event)
  ✓ Batch process (50 photos at once)

CLAUDE SONNET (paid, for reasoning only):
  ✓ Suggest hourly rates based on gear + style + location
  ✓ Write professional bios from portfolio analysis
  ✓ Generate rental listing descriptions
  ✓ Match skills to platform categories

RULE: Vision → Gemma. Reasoning → Claude.

NOTE: Creators upload photos OF their gear (e.g., a photo of their Sony A7 III
on a table). EXIF metadata is useless here — it only tells you what phone took
the picture, not what equipment is in the picture. Gemma Vision is the right
tool because it can visually identify equipment brands, models, and condition.
Many creators also export portfolio photos without metadata, so EXIF cannot
be relied on for gear detection in either case.
```

---

## Pre-Requisite: Centralize Rental Categories

**MUST be done before any onboarding work begins.**

The 9 smart rental categories are currently scattered across 4+ files (admin page, import page, client display, listing mapper). This violates single-source-of-truth and will cause mapping bugs if Gemma classifies against an inconsistent list.

### Step 0 — Move categories to `lib/constants.ts`

Define the canonical category list with all metadata in one place:

```typescript
export const RENTAL_CATEGORIES = [
  {
    value: 'cameras-optics',
    label: 'Cameras & Optics',
    subtitle: 'High-end Cinema Systems',
    description: 'Cinema cameras, prime and zoom lens sets, and anamorphics for every format.',
    fallbackImage: PLACEHOLDER_IMAGES.camerasOptics,
  },
  {
    value: 'lighting-power',
    label: 'Lighting & Power',
    subtitle: 'Fixtures & Distribution',
    description: 'LED panels, HMIs, generators, power distribution, and battery solutions.',
    fallbackImage: PLACEHOLDER_IMAGES.lightingPower,
  },
  {
    value: 'audio',
    label: 'Audio',
    subtitle: 'Capture & Monitoring',
    description: 'Microphones, field recorders, mixers, wireless systems, and IEM monitoring.',
    fallbackImage: PLACEHOLDER_IMAGES.audio,
  },
  {
    value: 'grip-motion',
    label: 'Grip & Motion',
    subtitle: 'Support & Stabilization',
    description: 'Dollies, cranes, gimbals, sliders, and remote heads.',
    fallbackImage: PLACEHOLDER_IMAGES.gripMotion,
  },
  {
    value: 'data-storage',
    label: 'Data & Storage',
    subtitle: 'Media Management',
    description: 'RAID arrays, NVMe drives, on-set DITs, and cloud backup solutions.',
    fallbackImage: PLACEHOLDER_IMAGES.dataStorage,
  },
  {
    value: 'crew-services',
    label: 'Crew Services',
    subtitle: 'Technical Personnel',
    description: 'DPs, gaffers, sound operators, grips, and full-package crew for any scale.',
    fallbackImage: PLACEHOLDER_IMAGES.crewServices,
  },
  {
    value: 'specialized-solutions',
    label: 'Specialized Solutions',
    subtitle: 'Emerging Tech & VP',
    description: 'LED volumes, virtual production tools, VR/AR rigs, and drone packages.',
    fallbackImage: PLACEHOLDER_IMAGES.specializedSolutions,
  },
  {
    value: 'aerial-support',
    label: 'Aerial Support',
    subtitle: 'Drone & Aerial Systems',
    description: 'Professional drone rigs, aerial camera systems, and licensed pilot services.',
    fallbackImage: PLACEHOLDER_IMAGES.gripMotion,
  },
  {
    value: 'sound-reinforcement',
    label: 'Sound Reinforcement',
    subtitle: 'Live Sound & PA Systems',
    description: 'PA systems, stage monitors, mixing consoles, and live sound engineering packages.',
    fallbackImage: PLACEHOLDER_IMAGES.soundReinforcement,
  },
] as const;

// Derived helpers
export const RENTAL_CATEGORY_VALUES = RENTAL_CATEGORIES.map(c => c.value);
export type RentalCategorySlug = (typeof RENTAL_CATEGORIES)[number]['value'];

// Community listing → rental category mapping
export const LISTING_TO_RENTAL_CATEGORY: Record<string, RentalCategorySlug> = {
  cameras:     'cameras-optics',
  lenses:      'cameras-optics',
  lighting:    'lighting-power',
  audio:       'audio',
  grip:        'grip-motion',
  accessories: 'specialized-solutions',
  drones:      'aerial-support',
  other:       'specialized-solutions',
};
```

Then update all consumers to import from constants:
- `app/(admin)/admin/rentals/page.tsx` — remove local `RENTAL_CATEGORIES`
- `app/(admin)/admin/rentals/import/page.tsx` — remove local `VALID_CATEGORIES`
- `app/(platform)/smart-rentals/SmartRentalsClient.tsx` — remove local `CATEGORY_META`
- `app/(platform)/smart-rentals/[category]/RentalCategoryClient.tsx` — remove local `CATEGORY_LABELS`
- `lib/supabase/queries/smartRentals.ts` — remove local `LISTING_TO_RENTAL_CATEGORY`

**This is a standalone commit before onboarding work begins.**

---

## The Five-Step Onboarding Flow

### STEP 1 — Identity Pre-Fill (30 seconds)

**Aim:** Pre-fill creator profile from ID document. NOT verification — labelled as "pre-fill" with manual fallback.

**Flow:**
```
Creator lands on /onboarding
"Let's set up your profile — upload your ID to skip the typing"

Upload ID front → Gemma Vision extracts:
  ✓ First name
  ✓ Last name
  ✓ ID number
  ✓ Date of birth

All fields auto-fill. Creator can edit any field manually.
"Skip" option always visible for creators who prefer to type.
Creator clicks "Confirm" button.
Done.
```

**Important:** This is NOT identity verification. It is convenience pre-fill only. True KYC (liveness detection, fraud prevention) is deferred to a future task with a proper provider (e.g., Smile Identity). The UI must NOT say "verified" — it says "profile completed."

**What it solves:** Removes 2 minutes of typing for creators who have their ID handy.

---

### STEP 2 — Portfolio Bulk Upload (2 minutes)

**Aim:** Creator uploads portfolio photos once. Gemma handles scene/style tagging.

**Flow:**
```
"Drag your best 5-20 portfolio photos here"
(Minimum 5, not 20 — respects SA mobile data costs)

Creator drags portfolio photos from phone/computer
Photos upload to Cloudinary

For each photo, Gemma Vision analyzes:
  ✓ Scene type (wedding, portrait, product, event, landscape)
  ✓ Lighting setup (natural, softbox, ring light, mixed)
  ✓ Quality score (0-100)
  ✓ Auto-generated description
  ✓ Hashtags

Processing shows progress: "Analyzing photo 3 of 12..."

Creator sees results in a grid:
  Photo 1: "Wedding photography, golden hour, natural light" [Edit]
  Photo 2: "Corporate headshot, studio lighting, softbox" [Edit]

Creator can edit tags if wrong (click to correct).
Clicks "Looks good" → moves to next step.
```

**What it solves:** Eliminates manual tagging. 12 photos in 2 minutes vs 20 minutes.

---

### STEP 3 — Skills Auto-Detection (30 seconds)

**Aim:** Creator doesn't guess their specialties. AI tells them what they shoot.

**Flow:**
```
Gemma analyzes the uploaded photos as a collection:
  "You shot 8 weddings"
  "You shot 5 portraits"
  "You shot 4 corporate events"
  "You shot 3 product shoots"

Platform shows:
  Your top skills (based on your portfolio):
  ☑ Wedding Photography (40%)
  ☑ Portrait Photography (25%)
  ☑ Corporate Photography (20%)
  ☑ Product Photography (15%)

  [Edit] [Confirm]

Creator clicks Confirm. Done.
```

**What it solves:** Creator doesn't have to categorize themselves. Portfolio speaks for itself.

---

### STEP 4 — Rate Suggestions (30 seconds)

**Aim:** Creator doesn't guess what to charge. Claude suggests market-aligned rates.

**Flow:**
```
Claude Sonnet analyzes:
  - Creator's skills (from Step 3)
  - Gear listed by creator (from Step 5)
  - Photo quality scores (from Step 2)
  - Location (Johannesburg)
  - Current market rates in SA

Claude returns:
  "Based on your portfolio quality and gear:
   Wedding Photography: R1,800/hr (market avg: R1,500-2,500)
   Portrait Sessions: R1,200/hr (market avg: R1,000-1,800)
   Corporate Shoots: R2,000/hr (market avg: R1,800-3,000)

   You can adjust these anytime."

Creator sees suggested rates with sliders.
Adjusts if needed. Clicks "Continue".
```

**What it solves:** Removes imposter syndrome + pricing paralysis.

---

### STEP 5 — Gear-to-Rental Auto-Listing (1 minute)

**Aim:** Creator uploads photos OF their gear. Gemma identifies and categorizes it. Listing auto-fills.

**Flow:**
```
"Want to rent out your gear? Upload photos of your equipment."

Creator takes photos of their gear (camera body on table, lenses, lights, etc.)
Photos upload to Cloudinary

For each gear photo, Gemma Vision identifies:
  ✓ Brand and model (e.g., "Sony A7 III", "Aputure 600d")
  ✓ Equipment type (camera body, lens, light, drone, mic, etc.)
  ✓ Condition estimate (new, good, fair — from visual inspection)
  ✓ Category (mapped to one of 9 RENTAL_CATEGORIES — constrained list)

Platform shows auto-filled listing:
  ┌─────────────────────────────────────────────────┐
  │ 📷 [gear photo]                                  │
  │ Name: Sony A7 III              [Edit]            │
  │ Category: Cameras & Optics     [Edit ▼]          │
  │ Condition: Good                [Edit ▼]          │
  │ Daily Rate: R___               [Enter]           │
  │                                                   │
  │ Description: (Claude writes this)                │
  │ "Professional full-frame mirrorless camera..."   │
  └─────────────────────────────────────────────────┘

Creator reviews, corrects any mistakes, sets daily rate.
Category dropdown is constrained to the 9 RENTAL_CATEGORIES.
Clicks "List all" → rental listings created in smart_rentals table.

Done. Creator is now a photographer AND a gear rental provider.
```

**Why Gemma Vision (not EXIF):** Creators upload photos OF their gear — a camera sitting
on a table, a lens in a bag. EXIF only tells you what phone took the picture, not what
equipment is IN the picture. Gemma can visually identify brands, models, and condition.
Categories are constrained to the 9 values from `RENTAL_CATEGORIES` in constants.ts —
Gemma picks from this fixed list, no hallucinated categories.

**What it solves:** One onboarding creates two revenue streams.

---

## Priority Order (What to Build First)

```
PRIORITY 0 (PRE-REQUISITE):
  ✓ Centralize RENTAL_CATEGORIES in lib/constants.ts
  ✓ Update all consumers (admin, import, client, queries)
  This unblocks everything else.

PRIORITY 1 (MUST HAVE FOR LAUNCH):
  ✓ Step 2: Portfolio upload + Gemma scene tagging
  ✓ Step 3: Skills detection from portfolio
  ✓ Step 5: Gear-to-rental auto-listing (constrained to RENTAL_CATEGORIES)

  These three are the strongest value prop and lowest risk.
  Launch with these.

PRIORITY 2 (WEEK 2 AFTER LAUNCH):
  ✓ Step 4: Claude rate suggestions
  ✓ Step 1: ID pre-fill (convenience, not verification)

  Rate suggestions add business value but can come after first creators sign up.
  ID pre-fill is nice-to-have — most creators can type their name.

PRIORITY 3 (MONTH 2):
  True KYC with a proper provider (Smile Identity or similar)
  Voice input for bio
  Portfolio quality coaching
  Peer comparison nudges
```

---

## Implementation

### 1. Google AI Studio Setup (Gemma 4 Vision)

**Get free API key:**
- Go to https://aistudio.google.com/apikey
- Create API key (free tier: 1,500 requests/day)
- Add to `.env.local`: `GOOGLE_AI_API_KEY=xxx`

**Install SDK:**
```bash
npm install @google/generative-ai
```

### 2. Vision Provider

Create `lib/ai/providers/gemma-vision.ts`:

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';
import { RENTAL_CATEGORIES, type RentalCategorySlug } from '@/lib/constants';

const client = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);
const model = client.getGenerativeModel({
  model: 'gemini-2.0-flash-exp'
});

const CATEGORY_LIST = RENTAL_CATEGORIES.map(c => `"${c.value}" (${c.label})`).join(', ');

export async function analyzePortfolioImage(imageUrl: string) {
  const imageData = await fetchImageAsBase64(imageUrl);

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: 'image/jpeg',
        data: imageData,
      },
    },
    `Analyze this portfolio image. Return JSON with:
     - sceneType: string (wedding, portrait, corporate, product, event, landscape)
     - lightingSetup: string
     - qualityScore: number (0-100)
     - description: string (professional caption)
     - hashtags: string[]`
  ]);

  return JSON.parse(result.response.text());
}

export async function classifyGearCategory(
  gearName: string,
  gearDescription: string
): Promise<RentalCategorySlug> {
  const result = await model.generateContent([
    `Classify this equipment into exactly one category.

     Equipment: ${gearName}
     Description: ${gearDescription}

     Valid categories (pick ONE value): ${CATEGORY_LIST}

     Return JSON: { "category": "<value>" }`
  ]);

  const parsed = JSON.parse(result.response.text());
  // Validate against known categories
  const valid = RENTAL_CATEGORIES.find(c => c.value === parsed.category);
  return valid ? valid.value : 'specialized-solutions';
}

export async function extractIdDocument(imageUrl: string) {
  const imageData = await fetchImageAsBase64(imageUrl);

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: 'image/jpeg',
        data: imageData,
      },
    },
    `Extract from this South African ID document:
     - firstName
     - lastName
     - idNumber
     - dateOfBirth
     Return JSON. If any field is unreadable, set it to null.`
  ]);

  return JSON.parse(result.response.text());
}
```

### 3. Add to Agent Registry

Update `lib/constants.ts`:

```typescript
AGENTS: {
  // ... existing

  'portfolio-analyzer': {
    status: 'active',
    name: 'Portfolio Analyzer',
    defaultModel: 'gemini-2.0-flash-exp',
    endpoint: '/api/onboarding/analyze-portfolio',
    costTier: 'free',
    budgetDailyUsd: 0,
    tools: [],
  },
  'gear-classifier': {
    status: 'active',
    name: 'Gear Category Classifier',
    defaultModel: 'gemini-2.0-flash-exp',
    endpoint: '/api/onboarding/classify-gear',
    costTier: 'free',
    budgetDailyUsd: 0,
    tools: [],
  },
  'rate-suggester': {
    status: 'active',
    name: 'Rate Suggester',
    defaultModel: 'claude-sonnet-4-20250514',
    endpoint: '/api/onboarding/suggest-rates',
    costTier: 'medium',
    budgetDailyUsd: 5,
    tools: [],
  },
}
```

### 5. API Routes

- `POST /api/onboarding/analyze-portfolio` — Gemma scene tagging for portfolio photos
- `POST /api/onboarding/detect-skills` — aggregate portfolio into skill percentages
- `POST /api/onboarding/identify-gear` — Gemma identifies gear from photo, maps to RENTAL_CATEGORIES
- `POST /api/onboarding/create-rentals` — auto-create rental listings from identified gear
- `POST /api/onboarding/suggest-rates` — Claude generates rate suggestions (P2)
- `POST /api/onboarding/prefill-id` — Gemma extracts fields from ID photo (P2)

### 6. Database Schema

```sql
create table portfolio_analysis (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid references profiles(id),
  photo_url text not null,
  cloudinary_public_id text,
  -- Gemma analysis (scene classification)
  scene_type text,
  lighting_setup text,
  quality_score integer,
  description text,
  hashtags text[],
  created_at timestamptz default now()
);

create table onboarding_progress (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid references profiles(id) unique,
  current_step integer default 1,
  step_1_complete boolean default false,
  step_2_complete boolean default false,
  step_3_complete boolean default false,
  step_4_complete boolean default false,
  step_5_complete boolean default false,
  detected_skills jsonb,        -- { "wedding": 0.4, "portrait": 0.25, ... }
  detected_gear jsonb,          -- [{ name, brand, model, category, condition, photo_url }]
  suggested_rates jsonb,        -- { "wedding": 1800, "portrait": 1200, ... }
  completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

### 7. Frontend Components

- `components/onboarding/OnboardingFlow.tsx` — main wrapper with step navigation
- `components/onboarding/OnboardingProgress.tsx` — progress indicator
- `components/onboarding/StepPortfolioUpload.tsx` — drag-and-drop + Gemma scene analysis
- `components/onboarding/StepSkillsDetection.tsx` — skill breakdown with edit
- `components/onboarding/StepGearRentals.tsx` — gear-to-rental with category mapping
- `components/onboarding/StepRateSuggestions.tsx` — Claude rate suggestions (P2)
- `components/onboarding/StepIdPrefill.tsx` — ID pre-fill (P2)

Use Cloudinary for all image uploads. Use `react-dropzone` for drag-and-drop.

---

## Key Design Decisions

1. **Gemma Vision for gear identification.** Creators upload photos OF their gear (camera on a table, lens in a bag). Gemma visually identifies brand, model, and condition. EXIF is useless here — it only tells you what phone took the picture, not what's in it. Many portfolio photos are also exported without metadata.

2. **Constrained category classification.** Gemma picks from the 9 `RENTAL_CATEGORIES` defined in constants.ts. If it returns an invalid value, fallback to `specialized-solutions`. No hallucinated categories.

3. **ID upload is pre-fill, not verification.** We don't claim to verify identity. The UI says "pre-fill your profile" with a manual fallback always visible. True KYC is a separate future task with a real provider.

4. **5 photos minimum, not 20.** SA mobile data is expensive. 5 good photos is enough for skill detection. Creators can add more later.

5. **Build order: categories → portfolio → skills → gear listings → rates → ID.** Start with the highest-value, lowest-risk features. ID pre-fill and rate suggestions come later.

---

## Acceptance Criteria

- [ ] RENTAL_CATEGORIES centralized in lib/constants.ts (all consumers updated)
- [ ] Creator can complete onboarding in under 5 minutes
- [ ] Gemma identifies gear brand/model from uploaded gear photos
- [ ] Gemma scene classification accuracy > 85% for scene types
- [ ] Gear-to-category mapping always produces a valid RENTAL_CATEGORIES value
- [ ] All Gemma calls use free Google AI Studio tier
- [ ] Claude only used for rate suggestions and descriptions
- [ ] Progress indicator shows creator where they are
- [ ] Creator can edit auto-tags and category mappings if wrong
- [ ] Failed analysis falls back gracefully (manual input)
- [ ] All results stored in Supabase
- [ ] Works on mobile (most creators use phones)
- [ ] Minimum 5 photos (not 20) for upload step

---

## Out of Scope

- True KYC / identity verification (future task with proper provider)
- Face matching / liveness detection
- Voice input (Phase 2)
- Portfolio quality coaching (Phase 2)
- Multi-language ID extraction (Phase 2 — SA IDs only for now)
- Video analysis (Phase 2 — photos only for now)

---

## Success Metrics

```
BEFORE (manual onboarding):
  Time: 30 minutes
  Completion rate: 10-15%
  Abandoned at: portfolio tagging (70% drop)

AFTER (AI-powered):
  Time: under 5 minutes
  Completion rate target: 85%+
  Abandoned at: n/a (each step takes <1 min)

This is the difference between
"another platform with forms" and
"the platform that does the work for you"
```

---

## Commit Strategy

1. `refactor: centralize RENTAL_CATEGORIES in lib/constants.ts`
2. `feat: add Gemma vision provider via Google AI Studio`
3. `feat: portfolio upload + scene tagging API + UI`
4. `feat: skills detection from portfolio`
5. `feat: gear identification + auto-listing with category mapping`
6. `feat: onboarding flow with progress tracking`
7. `feat: Claude rate suggestion API` (P2)
8. `feat: ID pre-fill with Gemma vision` (P2)

PR title: "TASK-035: AI-powered creator onboarding (Gemma Vision + Claude)"
