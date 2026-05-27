# TASK-054: Creator Success Agent — AI Career Coach for Every Creator

## Status: Todo

## Summary
Build a per-creator AI agent that actively helps creators succeed on the platform — analyzing their portfolio, suggesting improvements, identifying skill gaps, recommending pricing changes, drafting client communications, and generating social content suggestions. This transforms ThabangVision from "a place to list services" into "the platform that actively grows my career."

## Why
Creator retention is the single biggest challenge for creative marketplaces. Creators leave when they don't get bookings, don't know how to improve, or get better offers elsewhere. An AI career coach makes leaving expensive — the creator's history, insights, and personalized guidance can't be replicated on another platform. This is the stickiest feature you can build.

## Architecture

### Agent Capabilities
| Capability | Description | Frequency |
|-----------|-------------|-----------|
| **Portfolio Review** | Analyze portfolio for gaps, quality issues, missing categories | On upload + monthly |
| **Rate Optimization** | Suggest pricing changes based on market data | Monthly |
| **Profile Improvements** | Suggest bio updates, better descriptions, missing info | On profile view |
| **Skill Gap Analysis** | Identify skills that high-earning peers have but creator lacks | Quarterly |
| **Client Communication** | Draft proposal responses, follow-up messages | On demand |
| **Social Content Ideas** | Suggest posts to share on Instagram/LinkedIn to attract clients | Weekly |
| **Performance Dashboard** | Profile views, inquiry rate, booking conversion, review score trends | Always visible |
| **Growth Roadmap** | Personalized quarterly goals with specific actions | Quarterly |

### Insight Generation Pipeline
```
Creator data (portfolio, bookings, reviews, profile views)
  → AI analysis against peer group (from TASK-046 style clusters)
  → Personalized recommendations
  → Delivered via dashboard card + optional notification
```

## Implementation Plan

### 1. Success Agent (`lib/agents/agents/creator-success.ts`)
- Register `creator-success` agent in registry
- Uses Claude Sonnet for nuanced career advice
- Input: creator profile + portfolio + booking history + peer comparison data
- Output: structured recommendations with priority and actionability scores
- Wrapped in `trackedCompletion()`, subject to rate limits

### 2. Analysis Functions (`lib/creator-success/`)
- `analyzePortfolio(creatorId)` — quality, diversity, gaps vs. peer group
- `suggestRateChanges(creatorId)` — market-aligned pricing (from TASK-048)
- `identifySkillGaps(creatorId)` — compare capabilities vs. high earners in cluster
- `generateContentIdeas(creatorId)` — social post suggestions based on portfolio + trending topics
- `buildGrowthRoadmap(creatorId)` — quarterly goals with specific actions

### 3. Performance Metrics (`lib/creator-success/metrics.ts`)
- `getCreatorMetrics(creatorId, period)` — aggregate performance data
- Metrics: profile_views, inquiry_count, booking_count, conversion_rate, avg_rating, response_time
- Compare against cluster average and platform average
- Trend: improving, stable, declining

### 4. Dashboard Integration
- **Success Score** — overall health metric (0-100) combining all signals
- **Recommendations Card** — top 3 actionable suggestions, refreshed monthly
- **Performance Trends** — sparkline charts for key metrics
- **AI Coach Chat** — dedicated Ubunye conversation mode for career questions
- Location: `/dashboard/success` or integrated into existing dashboard home

### 5. Notification Triggers
- Monthly: "Your success summary" with top 3 insights
- On booking completion: "Congrats! Here's how to turn this into a repeat client"
- On portfolio update: instant feedback on new uploads
- On prolonged inactivity: gentle nudge with specific improvement suggestions
- All notifications respect user preferences (can mute success notifications)

### 6. Peer Comparison (Anonymous)
- "Creators like you" benchmark based on TASK-046 style clusters
- Show: "You're in the top 30% for response time but bottom 20% for portfolio variety"
- Never reveal specific peers — only anonymized cluster statistics
- Motivational framing, never punitive ("opportunity" not "failing")

## Files to Create/Modify
```
CREATE:
  lib/creator-success/analysis.ts — portfolio/rate/skill analysis
  lib/creator-success/metrics.ts — performance metric aggregation
  lib/creator-success/roadmap.ts — growth plan generation
  lib/creator-success/types.ts
  lib/agents/agents/creator-success.ts — AI agent definition
  app/(platform)/dashboard/success/page.tsx — success dashboard
  app/(platform)/dashboard/success/SuccessDashboard.tsx — client component

MODIFY:
  lib/agents/registry.ts — register creator-success agent
  lib/agents/router.ts — route career questions to success agent
  app/(platform)/dashboard/ — add success score card to dashboard home
  app/api/cron/daily-maintenance/route.ts — monthly insight generation
```

## Dependencies
- TASK-046 (creator graph) — peer comparison requires style clusters
- TASK-047 (learning loop) — performance metrics need event data
- TASK-048 (pricing intelligence) — rate optimization uses market benchmarks
- Existing notification system (exists)

## Acceptance Criteria
- [ ] Success score computed for creators with sufficient data
- [ ] Portfolio analysis identifies specific, actionable improvements
- [ ] Rate suggestions reference market data (not generic advice)
- [ ] Performance metrics display trends over time
- [ ] Peer comparison is fully anonymized (no individual creator data exposed)
- [ ] Monthly insight notifications respect user preferences
- [ ] AI coach responses are specific to the creator's actual data
- [ ] All AI calls wrapped in trackedCompletion()
- [ ] npm run build passes

## Effort Estimate
4-5 weeks

## Priority
Medium-High — directly impacts creator retention and satisfaction. But depends on TASK-046/47/48 for data quality. Can ship a basic version (portfolio review + performance metrics) without the full dependency chain.

## Risk Notes
- **Tone matters enormously.** Career advice that comes across as criticism will drive creators away. Every suggestion must be framed positively with clear action steps.
- Never compare creators by name. All peer benchmarking is anonymized and aggregate.
- Rate suggestions are advisory only — explicitly state "these are suggestions, you set your own rates."
- AI coaching should acknowledge uncertainty: "Based on what we see, you might benefit from..." not "You should..."
- Guard against hallucinated advice — AI must ground recommendations in actual data points
