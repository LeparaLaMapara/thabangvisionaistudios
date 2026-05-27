# TASK-052: WebMCP — Agent-Native Booking Infrastructure

## Status: Todo

## Summary
Expose ThabangVision's core capabilities (search, availability, booking, payment) as a WebMCP server so that external AI agents (ChatGPT, Gemini, Claude) can discover, query, and book SA creative services on behalf of their users. Early-mover infrastructure for the agent-mediated commerce wave.

## Why
When AI assistants routinely book services for users ("find me a wedding photographer in Joburg for October"), the platforms with structured, agent-accessible APIs win the distribution battle. Building this now — before agent-mediated commerce is mainstream — means ThabangVision is already infrastructure when the wave hits. Competitors will be scrambling to build what you already have.

## Architecture

### MCP Server Capabilities
| Capability | Description |
|-----------|-------------|
| `search_creators` | Find creators by category, location, style, availability, price range |
| `get_creator_profile` | Detailed creator info: portfolio, rates, reviews, availability |
| `check_availability` | Real-time availability for a creator on specific dates |
| `calculate_quote` | Get exact pricing for a project (uses existing quote calculation) |
| `create_booking` | Initiate a booking on behalf of a user (requires auth) |
| `get_booking_status` | Check status of an existing booking |
| `list_equipment` | Browse available rental equipment |
| `check_equipment_availability` | Real-time rental equipment availability |

### Auth Model
- **Public tools** (no auth): search_creators, get_creator_profile, list_equipment
- **User-scoped tools** (requires user auth): check_availability, calculate_quote, create_booking, get_booking_status
- Agent-on-behalf-of-user auth via OAuth 2.0 or signed tokens
- Rate limiting per agent + per user

### Protocol
- Follow the Model Context Protocol (MCP) specification
- Expose via `/.well-known/mcp.json` manifest
- Alongside MCP: expose `llms.txt` at root for AI crawler discovery (from growth strategy)

## Implementation Plan

### 1. MCP Server (`app/api/mcp/route.ts`)
- Single endpoint handling MCP protocol messages
- Tool registry mapping MCP tool names to internal handlers
- Request validation per MCP spec
- Response formatting per MCP spec

### 2. Tool Handlers (`lib/mcp/tools/`)
- Each tool maps to existing internal functions:
  - `search_creators` → `lib/search/` + `lib/supabase/queries/profiles.ts`
  - `calculate_quote` → `lib/productions/pricing.ts`
  - `create_booking` → existing booking API logic
- No new business logic — just structured interfaces to existing capabilities
- All prices in ZAR with clear currency labeling

### 3. Auth Layer (`lib/mcp/auth.ts`)
- Public tools: rate-limited by IP/agent identifier
- User tools: OAuth 2.0 bearer token or signed JWT
- Agent registration: optional API key for higher rate limits
- Audit logging: all MCP requests logged to `platform_events`

### 4. Discovery Files
- `/.well-known/mcp.json` — MCP manifest with tool definitions
- `/llms.txt` — plain-text description of capabilities for AI crawlers
- Both auto-generated from tool registry to stay in sync

### 5. Rate Limiting
- Public tools: 100 requests/hour per IP
- Authenticated tools: 500 requests/hour per user
- Registered agents: 2000 requests/hour per API key
- Use existing `checkRateLimit()` from `lib/auth/`

### 6. Documentation
- Self-documenting tool schemas (descriptions, parameter types, examples)
- Each tool includes example request/response in its schema
- Error responses with actionable messages ("Creator not available on that date. Try these alternatives: [...]")

## Files to Create/Modify
```
CREATE:
  lib/mcp/server.ts — MCP protocol handler
  lib/mcp/tools/ — tool handler modules
  lib/mcp/auth.ts — agent auth layer
  lib/mcp/types.ts — MCP types
  app/api/mcp/route.ts — MCP endpoint
  app/.well-known/mcp.json/route.ts — MCP manifest
  app/llms.txt/route.ts — AI crawler manifest

MODIFY:
  next.config.ts — CSP headers for MCP endpoint
  lib/auth/ — extend rate limiter for agent patterns
```

## Dependencies
- Existing search, booking, and pricing infrastructure (all exist)
- Existing auth system (exists)
- MCP specification (public standard)

## Acceptance Criteria
- [ ] MCP manifest discoverable at `/.well-known/mcp.json`
- [ ] `llms.txt` accessible at `/llms.txt`
- [ ] Public tools (search, profile) work without auth
- [ ] Authenticated tools require valid token
- [ ] Rate limiting enforced per tier (public/auth/registered)
- [ ] All MCP requests logged to platform_events
- [ ] Tool responses include structured, parseable data
- [ ] Error responses are actionable (not generic 500s)
- [ ] npm run build passes
- [ ] npm run test passes

## Effort Estimate
2-3 weeks

## Priority
Medium-High — low effort, high optionality. The `llms.txt` file alone (30 min) should ship immediately as part of SEO sprint. The full MCP server is a 2-3 week investment that positions ThabangVision for the agent commerce wave.

## Risk Notes
- MCP spec is still evolving — build to current spec but design for easy updates
- Agent-on-behalf-of-user auth needs careful security review (don't let agents exceed user permissions)
- Start with read-only tools (search, profile, availability). Add write tools (booking) after auth is solid.
- Rate limiting is critical — agents can send volume that humans never would
- Don't expose creator contact details (email, phone) via MCP — all communication must go through the platform
