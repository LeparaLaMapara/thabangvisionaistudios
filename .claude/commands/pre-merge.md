Run pre-merge checks before merging to main. ALL must pass:

1. Run: npm run build
   - Report: PASS or FAIL with error details

2. Run: npm run test
   - Report: X passing, Y failing with details

3. Run: git diff --stat main
   - Show what files changed and how many lines

4. Scope check — verify no files were modified outside the task scope:
   - List all modified files
   - Flag any files that seem unrelated to the current task
   - Ask for confirmation if unexpected files were changed

5. Constants check — search for hardcoded business values:
   - grep -r "079 539" --include="*.tsx" --include="*.ts" — should only be in constants.ts
   - grep -r "gmail.com" --include="*.tsx" --include="*.ts" — should only be in constants.ts and .env
   - grep -r "R1,500\|R2,850\|R650" --include="*.tsx" --include="*.ts" — should only be in constants.ts
   - Flag any violations

6. Auth check — verify new API routes have auth:
   - List any new files in app/api/
   - Check each has auth verification (getUser, session check)
   - Flag any unprotected routes

7. Abstraction check — verify no direct SDK imports in pages:
   - grep -r "from '@anthropic-ai" --include="*.tsx" --include="*.ts" app/
   - grep -r "from 'cloudinary'" --include="*.tsx" --include="*.ts" app/
   - grep -r "from 'nodemailer'" --include="*.tsx" --include="*.ts" app/
   - Should only appear in lib/ directories, not in app/

8. Final report:
   ✅ READY TO MERGE — all checks pass
   OR
   ❌ ISSUES FOUND — list each issue

If ready: provide the merge commands:
   git checkout main
   git merge [branch-name]
   git push origin main
