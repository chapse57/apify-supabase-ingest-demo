-- Apify ingest: table + medians view + ingest log. Safe to run twice.

create table if not exists public.scraped_items (
  id          bigint generated always as identity primary key,
  source      text not null default 'books_toscrape',
  source_id   text not null,                 -- item URL
  category    text not null,
  title       text not null,
  price_gbp   numeric(10,2) not null check (price_gbp > 0),
  run_id      text not null,                 -- Apify run that first wrote this row
  scraped_at  timestamptz not null default now(),
  unique (source, source_id)                 -- re-running a scrape writes nothing new
);

alter table public.scraped_items enable row level security;
drop policy if exists "public read scraped_items" on public.scraped_items;
create policy "public read scraped_items"
  on public.scraped_items for select to anon using (true);

create or replace view public.category_medians
with (security_invoker = true) as
select
  category,
  count(*)::int as items,
  round((percentile_cont(0.5) within group (order by price_gbp))::numeric, 2) as median_price_gbp
from public.scraped_items
group by category;

grant select on public.category_medians to anon;

-- One row per webhook call. No anon policy: only the service role (the Edge Function) writes/reads it.
create table if not exists public.ingest_log (
  id          bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  run_id      text,
  status      text not null,                 -- ok | rejected | error
  received    int,
  valid       int,
  inserted    int,
  skipped     int,
  detail      text
);
alter table public.ingest_log enable row level security;

select 'ok' as setup;
