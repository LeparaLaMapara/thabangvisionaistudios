Quick project status check:

1. Current branch: git branch --show-current
2. Last commit: git log --oneline -1
3. Uncommitted changes: git status --short
4. Build: npm run build 2>&1 | tail -5
5. Tests: npm run test 2>&1 | tail -10

6. Read MEMORY.md and report:
   - Which sessions are COMPLETE
   - Which session is next
   - Any blockers or prerequisites

7. Read TODO_BY_THABANG.md and report:
   - Which manual tasks are still pending
