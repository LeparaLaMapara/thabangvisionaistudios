# TASK-046: Creator Knowledge Graph — AI-Maintained Style & Collaboration Network

## Status: Todo

## Summary
Build a continuously updated creator knowledge graph that represents every creator's visual style, gear, collaborators, growth trajectory, and creative DNA as vector embeddings. This replaces static profile browsing with intelligent, similarity-based discovery — "find creators whose style matches THIS image."

## Why
Most marketplaces store creators as flat database rows. A knowledge graph turns creator data into a living, queryable network. It enables style-based matching, gap analysis (underrepresented styles), collaboration discovery, and dramatically better search. Once 6 months of graph data accumulates, it becomes nearly impossible for competitors to replicate.

## Architecture

### Data Sources (Phase 1 — Internal Only)
- Portfolio images already uploaded to Cloudinary
- Booking history (what types of projects, client ratings, repeat clients)
- Profile data (skills, location, bio, rates)
- Review text and sentiment
- Equipment they own/rent (from bookings)

### Data Sources (Phase 2 — External, Consent-Based)
- Creator-provided Instagram/YouTube/Behance links (already in profiles)
- Only crawl links the creator has explicitly added to their profile
- Extract: visual style fingerprints, color palettes, composition patterns, subject preferences
- Track growth metrics (public follower counts, engagement rates)

### Vector Representation
- Each creator gets a multi-dimensional embedding vector stored in `content_embeddings` (table already exists)
- Dimensions encode: visual style, subject matter, quality tier, price point, location, availability patterns
- Use Gemma 4 multimodal for image analysis + embedding generation
- Re-compute embeddings weekly via cron or on portfolio update

### Graph Queries
- `findSimilarCreators(creatorId, limit)` — k-nearest neighbors in embedding space
- `findCreatorsForBrief(briefText, styleImage?)` — embed the brief, find closest creators
- `getCollaborationGraph(creatorId)` — who have they worked with (from shared bookings)
- `getStyleClusters()` — group creators by visual similarity for category pages
- `identifyGaps()` — embedding regions with low creator density = market opportunities

## Implementation Plan

### 1. Embedding Pipeline (`lib/graph/embeddings.ts`)
- Accept creator ID, fetch their portfolio images + profile data
- Send to Gemma 4 vision model for style analysis (registered agent: `graph-embedder`)
- Generate structured style descriptors: `{ colorPalette, compositionStyle, subjectMatter, qualityTier, moodTones }`
- Convert to numerical embedding vector
- Upsert into `content_embeddings` with `entity_type = 'creator_style'`

### 2. Graph Query Layer (`lib/graph/queries.ts`)
- `findSimilarCreators()` — cosine similarity search on embeddings
- `findCreatorsForBrief()` — embed brief text + optional image, search
- `getStyleClusters()` — k-means clustering for category generation
- All queries return ranked results with similarity scores

### 3. Ingestion Cron (`app/api/cron/daily-maintenance/` — extend existing)
- Add step: for creators with updated portfolios since last run, re-compute embeddings
- Batch process to stay within AI budget
- Track last-embedded timestamp per creator

### 4. Search Integration
- Extend existing global search to include style-based results
- "Find similar" button on creator profiles
- Brief-to-creator matching in Ubunye booking flow

### 5. Database Migration
```sql
-- Extend content_embeddings or create creator_style_embeddings
CREATE TABLE IF NOT EXISTS creator_style_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  style_descriptors JSONB NOT NULL,
  embedding_vector VECTOR(768),
  portfolio_hash TEXT, -- detect when re-embedding is needed
  last_computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(creator_id)
);

CREATE INDEX ON creator_style_profiles USING ivfflat (embedding_vector vector_cosine_ops);
```

## Files to Create/Modify
```
CREATE:
  lib/graph/embeddings.ts
  lib/graph/queries.ts
  lib/graph/types.ts
  lib/migrations/0XX-creator-style-profiles.sql

MODIFY:
  lib/agents/registry.ts — register graph-embedder agent
  app/api/cron/daily-maintenance/route.ts — add embedding refresh step
  lib/search/ — extend with style-based search
```

## Dependencies
- `content_embeddings` table (exists)
- Supabase pgvector extension (check if enabled)
- Gemma 4 multimodal (free tier, already used for onboarding/portfolios)
- Portfolio images in Cloudinary (exists)

## Acceptance Criteria
- [ ] Creator embeddings generated from portfolio images + profile data
- [ ] Similarity search returns relevant creators (manual spot-check)
- [ ] "Find similar" query runs in <500ms
- [ ] Embeddings auto-refresh when portfolio is updated
- [ ] Cron step processes creators in batches within AI budget
- [ ] npm run build passes
- [ ] npm run test passes

## Effort Estimate
2-3 weeks

## Priority
High — this is the foundational data layer that Layers 2, 3, 9, and 11 build on. Start with internal data only (Phase 1). Phase 2 (external crawling) is separate and requires POPIA-compliant consent flows.

## Risk Notes
- pgvector extension may need to be enabled on Supabase (free plan supports it)
- Embedding quality depends heavily on prompt engineering for the style analysis
- Start with a small creator cohort to validate before scaling
- External crawling (Phase 2) requires explicit creator consent per POPIA — do NOT scrape without opt-in
