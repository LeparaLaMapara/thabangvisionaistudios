# TASK-006: Security - Search Input Sanitization
## Priority: HIGH | Phase: V2 | Depends on: none
## Files allowed: app/api/search/route.ts
## Description
Escape special characters in search queries before passing to Supabase ilike.
## Acceptance criteria
- [ ] sanitizeSearch() escapes %, _, \ characters
- [ ] Applied to all ilike queries
- [ ] Normal search still works
- [ ] npm run build passes
