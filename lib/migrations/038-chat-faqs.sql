-- ============================================================================
-- Migration 038: Chat FAQs — AI-indexed Q&A from Ubunye conversations
-- ============================================================================
-- Surfaces anonymized, curated Q&A pairs from chat_messages as SEO-indexable
-- FAQ content. Questions are extracted by the weekly cron, reviewed by admin,
-- and rendered on public FAQ pages with FAQPage schema markup.
-- ============================================================================

-- ── Table ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_faqs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question        TEXT NOT NULL,
  answer          TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'general',
  source_conversation_id UUID REFERENCES chat_conversations(id) ON DELETE SET NULL,
  is_published    BOOLEAN NOT NULL DEFAULT false,
  view_count      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_chat_faqs_published ON chat_faqs(is_published) WHERE is_published = true;
CREATE INDEX IF NOT EXISTS idx_chat_faqs_category ON chat_faqs(category);

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE chat_faqs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read published FAQs"
  ON chat_faqs FOR SELECT
  USING (is_published = true);

CREATE POLICY "Service role full access on chat_faqs"
  ON chat_faqs FOR ALL
  USING (true)
  WITH CHECK (true);

-- ── View count increment function ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION increment_faq_view(faq_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE chat_faqs SET view_count = view_count + 1 WHERE id = faq_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
