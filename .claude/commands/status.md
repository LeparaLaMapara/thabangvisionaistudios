Quick project status check:

1. Current branch: git branch --show-current
2. Last commit: git log --oneline -1
3. Uncommitted changes: git status --short
4. Build: npm run build 2>&1 | tail -5
5. Tests: npm run test 2>&1 | tail -10

6. Check docs/tasks/todo/ for pending tasks
7. Report:
   - Build and test status
   - Pending tasks from docs/tasks/todo/
   - Any blockers or prerequisites
