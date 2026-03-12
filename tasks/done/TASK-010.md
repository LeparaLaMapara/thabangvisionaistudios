# TASK-010: Abstraction - Storage Provider Layer
## Priority: FEATURE | Phase: V2 | Depends on: none
## Files allowed: lib/storage/*, app/api/cloudinary/*
## Description
Create storage abstraction layer. Wrap existing Cloudinary code.
## Acceptance criteria
- [ ] lib/storage/types.ts — StorageProvider interface
- [ ] lib/storage/cloudinary.ts — implements using existing code
- [ ] lib/storage/index.ts — reads STORAGE_PROVIDER env
- [ ] No direct cloudinary imports in app/
- [ ] npm run build passes
