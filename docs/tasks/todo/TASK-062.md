# TASK-062: Repair the local git object store
## Priority: LOW | Phase: V4 | Depends on: none
## Files allowed: (none — local repo maintenance)
## Description
One commit object, 1c76543a6ee825ad2741be83af6fa5803db44f06, is missing from
the local object store. It is a parent of d166735f, roughly 53 commits back.

Nothing current is affected: commits, pushes, builds, checkouts and deploys all
work. What breaks is full-history commands — `git log` stops at 53 commits,
`git branch -vv` errors, and bisect or blame through that point fails.

GitHub has complete history; this is local-only damage. A plain `git fetch`
will not repair it, because git does not re-download objects it believes it
already has.
## Acceptance criteria
- [ ] `git fetch origin --refetch` run (repo is ~10 MB, quick)
- [ ] `git fsck --connectivity-only` reports no broken links
- [ ] `git log --oneline main | wc -l` returns the full history
