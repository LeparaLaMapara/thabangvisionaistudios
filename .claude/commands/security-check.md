Run a security check on the current changes:

1. API Route Auth — check every file in app/api/:
   - Does it check for a valid session where needed?
   - Do admin routes check ADMIN_EMAILS?
   - Are there any unprotected routes that should be protected?
   - List each route and its auth status

2. Input Sanitization — check all Supabase queries:
   - Are user inputs sanitized before ilike or text search?
   - Are special characters escaped (%, _, \)?
   - Any raw SQL or unsanitized template literals?

3. Secrets Check:
   - grep -r "sk-ant-\|sk-\|AIzaSy" --include="*.ts" --include="*.tsx" — should only be in .env
   - grep -r "password\|secret\|token" --include="*.ts" --include="*.tsx" — check for hardcoded values
   - Verify .env.local is in .gitignore

4. XSS Check:
   - Search for dangerouslySetInnerHTML — flag each usage
   - Check social link rendering uses URL validation
   - Check all user-generated content is escaped

5. Auth Bypass Check:
   - Can unauthenticated users reach /admin pages?
   - Can non-admin users access admin API routes?
   - Can users modify other users' data?

6. Rate Limiting:
   - Is /api/gemini (Ubunye chat) rate limited?
   - Are auth endpoints (login, register) rate limited?
   - Are payment endpoints protected?

7. Report findings with severity (Critical/High/Medium/Low) and suggested fix for each.
