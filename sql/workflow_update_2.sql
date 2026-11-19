-- =====================================================
-- Update 2 (run once in Supabase SQL Editor) — safe to re-run
-- =====================================================

-- the bot waits for a new location when the rep says "I will send another location" for a new client
alter table rep_sessions add column if not exists awaiting_loc_visit uuid;

-- clean old junk: drafts that were never understood (empty/noise voice or text) must not count as visits
update visits       set status = 'cancelled' where status = 'draft' and ai_json is null and created_at < now() - interval '10 minutes';
update stock_issues set status = 'cancelled' where status = 'draft' and ai_json is null and created_at < now() - interval '10 minutes';

-- (optional) see what is still in draft
-- select id, created_at, transcript, raw_text from visits where status = 'draft' order by created_at desc;
