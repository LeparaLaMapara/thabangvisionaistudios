# TASK-008: Abstraction - AI Provider Layer
## Priority: FEATURE | Phase: V2 | Depends on: none
## Files allowed: lib/ai/*, app/api/gemini/route.ts OR app/api/ubunye-chat/route.ts, package.json
## Description
Create AI abstraction layer with Anthropic, Gemini, OpenAI providers.
## Acceptance criteria
- [ ] lib/ai/types.ts — AIProvider interface (sendMessage, streamMessage)
- [ ] lib/ai/anthropic.ts — claude-sonnet-4-20250514
- [ ] lib/ai/gemini.ts — Gemini Pro
- [ ] lib/ai/openai.ts — gpt-4o
- [ ] lib/ai/index.ts — reads AI_PROVIDER env
- [ ] Chat route uses lib/ai, not direct SDK
- [ ] No SDK imports in app/ directory
- [ ] npm run build passes
## Verification
grep -rn "from '@anthropic-ai" app/  # should return nothing
grep -rn "from 'openai'" app/         # should return nothing
