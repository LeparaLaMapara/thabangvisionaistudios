CREATE TABLE IF NOT EXISTS portfolio_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID REFERENCES profiles(id),
  photo_url TEXT NOT NULL,
  cloudinary_public_id TEXT,
  scene_type TEXT,
  lighting_setup TEXT,
  quality_score INTEGER,
  description TEXT,
  hashtags TEXT[],
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_analysis_creator ON portfolio_analysis(creator_id);
ALTER TABLE portfolio_analysis ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS onboarding_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID REFERENCES profiles(id) UNIQUE,
  current_step INTEGER DEFAULT 1,
  step_1_complete BOOLEAN DEFAULT false,
  step_2_complete BOOLEAN DEFAULT false,
  step_3_complete BOOLEAN DEFAULT false,
  step_4_complete BOOLEAN DEFAULT false,
  step_5_complete BOOLEAN DEFAULT false,
  detected_skills JSONB,
  detected_gear JSONB,
  suggested_rates JSONB,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_progress_creator ON onboarding_progress(creator_id);
ALTER TABLE onboarding_progress ENABLE ROW LEVEL SECURITY;
