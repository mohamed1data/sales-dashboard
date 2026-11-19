-- Diagnostic for "voice / invoice photo does not play in the dashboard". Read-only. Run in Supabase SQL Editor.
-- 1) what is really stored in the buckets (size and type of each file)
select o.bucket_id, o.name as path, o.metadata ->> 'mimetype' as mimetype, (o.metadata ->> 'size')::int as bytes, o.created_at
from storage.objects o
order by o.created_at desc
limit 20;

-- 2) what the database points to (compare these paths with the list above)
select 'visit voice' as what, v.voice_path as path, v.created_at from visits v where v.voice_path is not null
union all
select 'stock voice', s.voice_path, s.created_at from stock_issues s where s.voice_path is not null
union all
select 'invoice photo', s.photo_path, s.created_at from stock_issues s where s.photo_path is not null
order by created_at desc
limit 20;
