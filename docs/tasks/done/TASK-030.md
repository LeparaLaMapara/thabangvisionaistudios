# TASK-030: Marketplace - Database Migration SQL
## Priority: FEATURE | Phase: V3 | Depends on: none
## Prereq: Thabang runs SQL manually in Supabase
## Files allowed: lib/migrations/002-unified-marketplace.sql
## Description
Create SQL migration for unified gear marketplace columns.
## Acceptance criteria
- [ ] SQL adds owner_type, owner_id, ranking_score, total_rentals, average_rating, is_featured, review_count to smart_rentals
- [ ] Creates rental_reviews table with rating and comment
- [ ] Creates indexes for ranking queries
- [ ] Valid SQL that runs in Supabase SQL Editor
