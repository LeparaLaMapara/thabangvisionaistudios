# Listing the ThabangVision MCP server

The server is live once this branch is deployed. Nothing was submitted to any
directory: listing is a public action for the owner. Below is the exact text
and the steps.

## Facts to paste

- Name: `thabangvision`
- Title: ThabangVision
- Endpoint (Streamable HTTP): `https://www.thabangvision.com/mcp`
- Server card: `https://www.thabangvision.com/.well-known/mcp.json`
- Authentication: none
- Access: read only
- Website: `https://www.thabangvision.com`
- Docs for agents: `https://www.thabangvision.com/llms.txt`
- Tools: `search_gear`, `get_gear`, `search_creators`, `get_creator`,
  `list_categories`, `list_tools`, `how_to_book`

Short description (under 100 characters):

> Rent camera and production gear in South Africa and find ID-checked creators.

Long description:

> Read-only MCP server for ThabangVision, a South African marketplace to rent
> cameras, lenses, lighting, sound and other production gear (collection in
> Johannesburg, delivery in Gauteng) and to book ID-checked photographers and
> videographers. Search gear by words, category, city and dates; see prices in
> rand per day and deposits; find creators; list the free, open source Ubunye
> photo and film apps; and learn how booking works. No sign in. Every result
> has the page link where the person books.

Tags: rental, camera, film, photography, south-africa, marketplace, read-only

## 1. Official MCP Registry (registry.modelcontextprotocol.io)

The registry lists remote servers through a `server.json` and checks that you
own the name's namespace.

1. Install the publisher CLI (`mcp-publisher`) from the
   modelcontextprotocol/registry GitHub releases.
2. Pick the namespace. With DNS proof you can use `com.thabangvision/mcp`:
   `mcp-publisher login dns --domain thabangvision.com` and add the TXT record
   it prints in the DNS for thabangvision.com.
3. Create `server.json`:

   ```json
   {
     "$schema": "https://static.modelcontextprotocol.io/schemas/2025-09-29/server.schema.json",
     "name": "com.thabangvision/mcp",
     "title": "ThabangVision",
     "description": "Rent camera and production gear in South Africa and find ID-checked creators.",
     "version": "1.0.0",
     "websiteUrl": "https://www.thabangvision.com",
     "remotes": [
       { "type": "streamable-http", "url": "https://www.thabangvision.com/mcp" }
     ]
   }
   ```

   Check the `$schema` date against the registry docs on the day; it changes.
4. `mcp-publisher publish`.
5. Check it appears: search the registry for `thabangvision`.

## 2. Other directories (optional)

Each takes the facts above. Submit through their own form or pull request:

- Smithery (smithery.ai): add a remote server by URL.
- PulseMCP (pulsemcp.com): submit form; they also read the official registry.
- mcp.so: submit form.
- Glama (glama.ai/mcp/servers): add server.
- The `modelcontextprotocol/servers` README community list on GitHub: pull
  request adding one line under community servers.

## 3. After listing

- Test with an MCP client (Claude, ChatGPT developer mode, MCP Inspector):
  add `https://www.thabangvision.com/mcp` as a remote server, call
  `search_gear` with `{"query": "sony"}`.
- When the tools change, bump `MCP_SERVER_VERSION` in
  `lib/discovery/mcp.ts` and the `version` in `server.json`, then publish
  again.
