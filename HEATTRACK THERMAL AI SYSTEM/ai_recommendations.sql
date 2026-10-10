-- ============================================
-- HeatTrack: AI-generated recommendations (Google Gemini)
-- Run once in Supabase -> SQL Editor (safe to re-run).
--
-- Each analytics result gets its own recommendation, written by the
-- "recommend" Edge Function (supabase/functions/recommend/index.ts) the first
-- time the dashboard shows that result. It is saved here so Gemini is asked
-- only once per result; the website reads it with the rest of the row.
--
-- ai_recommendation holds:
--   action, category, tip, explanation,
--   suggested_actions[], prevention[], environmental_insights[], temperature_guidance[],
--   model, generated_at
-- ============================================

alter table public.analytics add column if not exists ai_recommendation jsonb;

-- Make the new column visible to the website right away
notify pgrst, 'reload schema';
