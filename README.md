# Apify → Supabase webhook ingest (demo)

A small, working pipeline: an Apify scraper run triggers a webhook, a Supabase Edge Function (TypeScript, Deno) verifies the run and loads the rows into Postgres idempotently, SQL views compute medians, and a static page on Cloudflare Pages reads them through a second Edge Function.

Live page: https://tenerife-medians.pages.dev

I built it in one evening as a scaled-down version of a pricing-tool job post, to show the pattern end to end. It uses fake sample listings and [books.toscrape.com](https://books.toscrape.com) (a public scraping sandbox) instead of real property portals.

## How it fits together

```
Apify task (Cheerio Scraper, 5 category pages)
   │  "Run succeeded" HTTP webhook (default payload)
   ▼
Edge Function  apify-ingest   (POST)
   1. take only the run ID from the payload (format-checked)
   2. re-read that run from the Apify API with our own token; continue only if status = SUCCEEDED
   3. read the run's dataset
   4. validate each row (url, title, category, price > 0); bad rows are counted as skipped
   5. upsert into scraped_items, unique on (source, source_id = item URL); count only new rows
   6. write one row to ingest_log for every call: ok / rejected / error
   ▼
Postgres (RLS on)
   listings (16 fake rows)  → view zone_medians
   scraped_items            → view category_medians
   ingest_log               → view ingest_summary (successful runs only)
   ▼
Edge Function  medians   (GET, read-only)  → JSON { zones, categories, ingests }
   ▼
Cloudflare Pages  web/index.html  (fetches the endpoint on every load)
```

## Design choices

- **The webhook body is not trusted.** Anyone who finds the URL can POST to it, so the function takes only the run ID and asks Apify itself whether that run exists and succeeded. A fake or empty request is rejected and logged.
- **Re-running is safe.** Rows are keyed on (source, item URL) and inserted with `ON CONFLICT DO NOTHING` semantics, so running the same scrape twice adds nothing.
- **Every call leaves a trace.** `ingest_log` records received / valid / inserted / skipped per run, plus rejections and errors with the reason.
- **Medians live in SQL** (`percentile_cont(0.5)` views), not in the page, so anything reading the database gets the same numbers.

## What I checked

| Check | Result |
|---|---|
| Same scrape run twice | run 1: 90 received / 90 inserted · run 2: 90 received / **0** inserted |
| Empty POST to `apify-ingest` | 400 `no valid run id`, logged as rejected |
| GET to `apify-ingest` | 405 `POST only` |
| Category medians | recomputed by hand from three source pages (Travel, Classics, Mystery); match the SQL view |
| Zone medians | match a hand calculation on the 16 sample rows |

## Files

| Path | What it is |
|---|---|
| `supabase/migrations/01_schema.sql` | `listings` table, `zone_medians` view, 16 fake rows |
| `supabase/migrations/02_apify_ingest.sql` | `scraped_items`, `category_medians`, `ingest_log` |
| `supabase/migrations/03_ingest_summary_view.sql` | read-only run summary for the page |
| `supabase/functions/apify-ingest/index.ts` | webhook receiver |
| `supabase/functions/medians/index.ts` | read endpoint for the page |
| `apify/task-input.json` | Cheerio Scraper task input |
| `web/index.html` | the Cloudflare Pages page |

## Run it yourself

1. Create a Supabase project and run the three SQL files in order (SQL Editor).
2. Deploy the two functions. Add `APIFY_TOKEN` under Edge Functions → Secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically). In this demo both functions have JWT verification off: `medians` is public and read-only, and `apify-ingest` is protected by re-checking the run with Apify.
3. In Apify, create a Cheerio Scraper task with `apify/task-input.json`, then add an HTTP webhook on "Run succeeded" pointing at the `apify-ingest` URL.
4. Change `FUNCTION_URL` in `web/index.html` to your `medians` URL and deploy the file to Cloudflare Pages.

## Limits (it's a demo)

- Sample data and a scraping sandbox, not real listings.
- `ingest_summary` is a plain view exposing successful runs to the anonymous role; a real project would not expose the log at all.
- For a real webhook I would also require a shared-secret header, on top of re-checking the run.
- No automated tests in this repo; the checks above were run by hand against the deployed functions.

Built with AI-assisted development (Claude Code); I reviewed, deployed and tested every part.
