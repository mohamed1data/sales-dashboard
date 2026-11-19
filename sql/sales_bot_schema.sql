-- =====================================================
-- Sales Rep Bot - Supabase schema (single client copy)
-- Run in Supabase SQL Editor
-- =====================================================

create extension if not exists "pgcrypto";

-- ---------- Reps ----------
create table reps (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  telegram_id bigint unique not null,
  phone text,
  is_manager boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Clients ----------
create table clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  aliases text[] not null default '{}',      -- alternative spellings, for matching
  type text,                                  -- pharmacy / hospital / clinic / supplier
  phone text,
  address text,
  lat double precision,
  lng double precision,
  rep_id uuid references reps(id),            -- primary rep for this client
  created_at timestamptz not null default now()
);
create index on clients using gin (aliases);

-- ---------- Products ----------
create table products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  aliases text[] not null default '{}',       -- e.g. {"جوانتي","جلافز","قفازات"}
  unit text not null,                         -- carton / box / pack
  default_price numeric(12,2),
  active boolean not null default true
);
create index on products using gin (aliases);

-- ---------- Visits ----------
create table visits (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references reps(id),
  client_id uuid references clients(id),
  visit_type text not null default 'sale'
    check (visit_type in ('sale','follow_up','collection')),
  lat double precision,
  lng double precision,
  raw_text text,                               -- typed text, if any
  transcript text,                             -- voice transcription
  voice_path text,                             -- path in Storage bucket "voices"
  voice_file_id text,                          -- Telegram file_id (backup reference)
  extra_voice_paths text[] not null default '{}', -- voice notes sent as corrections
  tg_message_id bigint,                        -- Telegram message id (prevents duplicate processing)
  draft_reminded boolean not null default false, -- reminder about an unconfirmed draft was sent
  ai_json jsonb,                               -- full extraction result
  client_notes text,                           -- objections, requests
  next_visit_at timestamptz,
  status text not null default 'draft'         -- draft until the rep taps Confirm
    check (status in ('draft','confirmed','cancelled')),
  created_at timestamptz not null default now()
);
create index on visits (rep_id, created_at desc);
create index on visits (status, created_at);
create unique index visits_rep_msg_uniq on visits (rep_id, tg_message_id);
create index on visits (client_id, created_at desc);

-- ---------- Visit items ----------
create table visit_items (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visits(id) on delete cascade,
  product_id uuid references products(id),
  product_text text,                           -- original wording if no match
  quantity numeric(12,2) not null,
  unit text,
  unit_price numeric(12,2),
  line_total numeric(14,2) generated always as (quantity * coalesce(unit_price,0)) stored
);
create index on visit_items (visit_id);

-- ---------- Payments received ----------
create table payments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  rep_id uuid references reps(id),
  visit_id uuid references visits(id),
  amount numeric(14,2) not null,
  method text default 'cash'                   -- cash / transfer / cheque
    check (method in ('cash','transfer','cheque')),
  created_at timestamptz not null default now()
);
create index on payments (client_id, created_at desc);

-- ---------- Collections (scheduled follow-ups to collect money) ----------
create table collections (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  rep_id uuid not null references reps(id),
  source_visit_id uuid references visits(id),
  due_at timestamptz not null,
  amount_due numeric(14,2),
  status text not null default 'pending'
    check (status in ('pending','done','cancelled')),
  reminded_24h boolean not null default false,
  reminded_2h boolean not null default false,
  created_at timestamptz not null default now()
);
create index on collections (status, due_at);

-- ---------- Settings (business config used to build the AI prompt) ----------
create table settings (
  key text primary key,
  value jsonb not null
);
insert into settings (key, value) values
  ('business_type', '"medical_ppe"'),
  ('visit_types', '["sale","follow_up","collection"]'),
  ('reminder_hours', '[24,2]'),
  ('currency', '"EGP"');

-- ---------- Client balance view (sales - payments) ----------
create view client_balances as
select
  c.id as client_id,
  c.name,
  coalesce(s.total_sales,0) as total_sales,
  coalesce(p.total_paid,0)  as total_paid,
  coalesce(s.total_sales,0) - coalesce(p.total_paid,0) as balance
from clients c
left join (
  select v.client_id, sum(i.line_total) as total_sales
  from visits v join visit_items i on i.visit_id = v.id
  where v.status = 'confirmed'
  group by v.client_id
) s on s.client_id = c.id
left join (
  select client_id, sum(amount) as total_paid
  from payments group by client_id
) p on p.client_id = c.id;

-- ---------- Reminders due (n8n schedule runs every 15 min) ----------
-- 24h reminder: due within next 24h and not yet reminded
create view reminders_24h as
select col.id, col.due_at, col.amount_due, r.telegram_id, c.name as client_name
from collections col
join reps r on r.id = col.rep_id
join clients c on c.id = col.client_id
where col.status = 'pending'
  and col.reminded_24h = false
  and col.due_at <= now() + interval '24 hours'
  and col.due_at > now();

-- 2h reminder: due within next 2h and not yet reminded
create view reminders_2h as
select col.id, col.due_at, col.amount_due, r.telegram_id, c.name as client_name
from collections col
join reps r on r.id = col.rep_id
join clients c on c.id = col.client_id
where col.status = 'pending'
  and col.reminded_2h = false
  and col.due_at <= now() + interval '2 hours'
  and col.due_at > now();


-- ---------- Rep sessions (last location + edit mode) ----------
create table rep_sessions (
  rep_id uuid primary key references reps(id) on delete cascade,
  lat double precision,
  lng double precision,
  location_at timestamptz,
  editing_visit_id uuid references visits(id) on delete set null
);

-- ---------- Security: block the public anon key from reading anything ----------
-- n8n uses the service_role key (bypasses RLS). Add policies later for dashboards.
alter table reps          enable row level security;
alter table clients       enable row level security;
alter table products      enable row level security;
alter table visits        enable row level security;
alter table visit_items   enable row level security;
alter table payments      enable row level security;
alter table collections   enable row level security;
alter table settings      enable row level security;
alter table rep_sessions  enable row level security;
alter view client_balances set (security_invoker = true);
alter view reminders_24h   set (security_invoker = true);
alter view reminders_2h    set (security_invoker = true);

-- ---------- Private storage bucket for voice notes ----------
insert into storage.buckets (id, name, public)
values ('voices', 'voices', false)
on conflict (id) do nothing;
-- Access with the service_role key from n8n; use signed URLs in dashboards.

-- ---------- Seed: sample PPE products ----------
insert into products (name, aliases, unit, default_price) values
  ('كمامة 3 طبقات', '{"كمامة","كمامات","ماسك"}', 'carton', null),
  ('كمامة N95', '{"n95","إن 95"}', 'box', null),
  ('جوانتي لاتكس', '{"جوانتي","جلافز","قفازات","لاتكس"}', 'box', null),
  ('جوانتي نتريل', '{"نتريل"}', 'box', null),
  ('غطاء حذاء', '{"شوز كفر","غطاء رجل"}', 'pack', null),
  ('غطاء رأس', '{"طاقية","هيد كفر"}', 'pack', null);
