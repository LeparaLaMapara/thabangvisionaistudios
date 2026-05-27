-- Migration 037: Chat conversation and message history
-- Stores full Ubunye AI chat interactions for analytics and conversion tracking.

-- ─── Conversations ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_conversations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  agent_id      text NOT NULL DEFAULT 'assistant',
  status        text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'ended', 'converted')),
  message_count integer NOT NULL DEFAULT 0,
  -- What the conversation led to (null = no conversion yet)
  converted_to  text CHECK (converted_to IN (
    'booking', 'rental_inquiry', 'creator_view', 'quote_request', NULL
  )),
  converted_ref text,            -- booking ID, rental slug, creator slug, etc.
  -- Guest identification (IP hash for anonymous users)
  guest_ip_hash text,
  metadata      jsonb NOT NULL DEFAULT '{}',
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_conversations_user ON chat_conversations(user_id);
CREATE INDEX idx_chat_conversations_started ON chat_conversations(started_at);
CREATE INDEX idx_chat_conversations_status ON chat_conversations(status);
CREATE INDEX idx_chat_conversations_converted ON chat_conversations(converted_to)
  WHERE converted_to IS NOT NULL;

-- ─── Messages ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content         text,
  -- Tool calls made by the assistant in this turn
  tool_calls      jsonb,          -- [{name, args_summary, result_summary}]
  -- Entities referenced in this message (for analytics)
  entities        jsonb,          -- {creators: [id], gear: [id], productions: [id]}
  -- Which agent + model processed this message
  agent_id        text,
  model           text,
  -- Token usage for this specific exchange
  input_tokens    integer,
  output_tokens   integer,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_messages_conversation ON chat_messages(conversation_id);
CREATE INDEX idx_chat_messages_role ON chat_messages(role);
CREATE INDEX idx_chat_messages_created ON chat_messages(created_at);
CREATE INDEX idx_chat_messages_entities ON chat_messages USING gin(entities)
  WHERE entities IS NOT NULL;

-- ─── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Users can read their own conversations
CREATE POLICY "users_read_own_conversations"
  ON chat_conversations FOR SELECT
  USING (auth.uid() = user_id);

-- Users can read messages in their own conversations
CREATE POLICY "users_read_own_messages"
  ON chat_messages FOR SELECT
  USING (
    conversation_id IN (
      SELECT id FROM chat_conversations WHERE user_id = auth.uid()
    )
  );

-- Service role (admin client) can do everything — bypasses RLS automatically.
-- Explicit admin read for the admin dashboard.
CREATE POLICY "admin_read_all_conversations"
  ON chat_conversations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "admin_read_all_messages"
  ON chat_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ─── Auto-increment message_count via trigger ──────────────────────────────────
CREATE OR REPLACE FUNCTION increment_conversation_message_count()
RETURNS trigger AS $$
BEGIN
  UPDATE chat_conversations
  SET message_count = message_count + 1
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_chat_message_count
  AFTER INSERT ON chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION increment_conversation_message_count();

-- Notify PostgREST to pick up new tables
NOTIFY pgrst, 'reload schema';
