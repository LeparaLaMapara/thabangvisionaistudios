# TASK-064: Retrieval-first Ubunye prompt (scale)
## Priority: LOW | Phase: V5 | Depends on: none
## Files allowed: lib/ubunye/system-prompt.ts, lib/agents/runtime.ts, lib/rag/
## Description
The system prompt embeds a ranked SAMPLE of the catalogue on every message.
As of 2026-08-29 each section is bounded (PROMPT_SECTION_LIMIT), which caps the
per-message token cost and removes the context-window risk. That is the right
fix for now.

The better architecture at real scale is retrieval-first: do NOT preload any
catalogue into the prompt. Answer from search/RAG tools on demand, so prompt
size is constant regardless of catalogue size. The pieces exist — isRagEnabled,
searchSimilar, formatRetrievalContext — but the always-on prompt still carries a
sample as a convenience.

This is the pattern large assistants use: a small stable system prompt plus
tool/RAG retrieval, rather than stuffing state into the context. Worth doing
when the catalogue is large enough that even the capped sample is a meaningful
share of each request, or when per-message AI cost needs to come down.
## Acceptance criteria
- [ ] Catalogue sections removed from the always-on prompt, or reduced to counts
- [ ] A retrieval tool covers what the sample used to answer (gear, creators,
      productions, listings), gated by isRagEnabled with a keyword fallback
- [ ] Measured: median prompt tokens per message before/after
- [ ] The assistant still answers "what cameras do you have" correctly
