-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 023: Creator Portfolio Projects
-- Adds portfolio_projects jsonb column to profiles for creator portfolio.
-- Structure: array of max 3 projects, each with title, project_type,
-- up to 3 photos, and 1 optional showreel video (Cloudinary-hosted).
-- ═══════════════════════════════════════════════════════════════════════════════

alter table profiles add column if not exists
  portfolio_projects jsonb default '[]'::jsonb;

-- Validate: max 3 projects
alter table profiles add constraint chk_portfolio_max_3
  check (jsonb_array_length(coalesce(portfolio_projects, '[]'::jsonb)) <= 3);

comment on column profiles.portfolio_projects is
  'Creator portfolio: max 3 projects. Each: {id, title, project_type, photos: [{url, public_id}], video: {url, public_id} | null}';
