-- Public, read-only summary of ingest runs for the demo page (no error details exposed).
create or replace view public.ingest_summary as
select id, received_at, run_id, status, received, valid, inserted, skipped
from public.ingest_log
where status = 'ok';

revoke all on public.ingest_summary from anon, authenticated;
grant select on public.ingest_summary to anon;
