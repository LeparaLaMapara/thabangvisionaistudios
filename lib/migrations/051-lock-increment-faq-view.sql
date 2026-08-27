-- 051 — Take increment_faq_view off the REST surface
--
-- lib/supabase/queries/chatFaqs.ts calls it through createAdminClient(), and
-- the service role bypasses grants entirely, so no legitimate caller needs
-- EXECUTE. It was the last SECURITY DEFINER function anonymous visitors could
-- invoke apart from is_admin(), which must stay callable (see 042).
revoke execute on function public.increment_faq_view(uuid) from public, anon, authenticated;
