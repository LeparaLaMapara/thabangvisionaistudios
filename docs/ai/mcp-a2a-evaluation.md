# MCP and A2A evaluation (Phase 2, spec §8.10)

**Status: evaluated, NOT enabled.** No MCP or A2A endpoint is exposed.

## Why not now
Every channel must call the same core use cases. Those now exist: `lib/core/agent/use-cases.ts` and the prepare and approval endpoints. An MCP server would be a thin adapter over them. Exposing it safely needs several things that do not exist yet:

| Requirement (spec §8.10) | State |
|---|---|
| OAuth with user-specific consent | Not built. Supabase sessions are cookie-based, and MCP clients need OAuth 2.1 with PKCE and dynamic client registration. |
| Scopes: read-only vs financial | Proposed: `catalogue:read`, `bookings:read` (own), `bookings:prepare`. **No commit scope.** Commits stay on the human approval screen. |
| Tool restrictions | Same rule as Ubunye: tools prepare, people approve. |
| Approval flow | The approval card is web-only. An MCP client would return a link to `/approve/<proposal>` to finish in the browser. |
| Rate limits | The shared `rate_limit_hit` counter can key by OAuth client and user. |
| Logging | The existing `agent_actions` rows and events log, plus a per-client audit. |
| Tool-injection resistance | The same sanitiser and fencing as Ubunye. Tool descriptions are static, never built from user data. |

## A2A
A2A is interoperability between agents. It is not a dependency of the marketplace and is not planned before MCP. If it is added, it gets the same scopes and the same "no commit without a person" rule.

## Decision needed
Whether to build an MCP server at all, and which client (if any) is the first target. Until then nothing is exposed, so MCP inspection does not apply.
