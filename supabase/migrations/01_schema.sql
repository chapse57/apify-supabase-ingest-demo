-- Price medians demo — minimal schema (sample data, not real listings)
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run

create table if not exists public.listings (
  id          bigint generated always as identity primary key,
  source      text not null check (source in ('portal_a', 'portal_b')),
  source_id   text not null,
  zone        text not null,
  price_eur   numeric(12,2) not null check (price_eur > 0),
  area_m2     numeric(8,2)  not null check (area_m2 > 0),
  scraped_at  timestamptz   not null default now(),
  unique (source, source_id)          -- re-running the same scrape writes nothing new
);

alter table public.listings enable row level security;

drop policy if exists "public read listings" on public.listings;
create policy "public read listings"
  on public.listings for select to anon using (true);

-- Medians per zone. security_invoker = the view obeys the table's RLS.
create or replace view public.zone_medians
with (security_invoker = true) as
select
  zone,
  count(*)::int                                                           as listings,
  round((percentile_cont(0.5) within group (order by price_eur))::numeric, 0)          as median_price_eur,
  round((percentile_cont(0.5) within group (order by price_eur / area_m2))::numeric, 2) as median_eur_per_m2
from public.listings
group by zone;

grant select on public.zone_medians to anon;

-- Sample rows (clearly fake). ON CONFLICT makes this file safe to run twice.
insert into public.listings (source, source_id, zone, price_eur, area_m2) values
  ('portal_a','a-101','Santa Cruz',        185000, 78),
  ('portal_a','a-102','Santa Cruz',        210000, 92),
  ('portal_b','b-201','Santa Cruz',        169000, 70),
  ('portal_b','b-202','Santa Cruz',        245000, 105),
  ('portal_a','a-103','Santa Cruz',        199000, 85),
  ('portal_a','a-111','Adeje',             320000, 88),
  ('portal_a','a-112','Adeje',             410000, 110),
  ('portal_b','b-211','Adeje',             289000, 75),
  ('portal_b','b-212','Adeje',             535000, 140),
  ('portal_a','a-113','Adeje',             365000, 95),
  ('portal_b','b-213','Adeje',             298000, 80),
  ('portal_a','a-121','Puerto de la Cruz', 155000, 68),
  ('portal_a','a-122','Puerto de la Cruz', 178000, 74),
  ('portal_b','b-221','Puerto de la Cruz', 142000, 60),
  ('portal_b','b-222','Puerto de la Cruz', 199000, 90),
  ('portal_a','a-123','Puerto de la Cruz', 165000, 71)
on conflict (source, source_id) do nothing;

-- Check: should return 3 rows
select * from public.zone_medians order by zone;
