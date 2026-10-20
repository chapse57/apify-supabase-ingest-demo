// Supabase Edge Function "apify-ingest" — called by an Apify webhook when a run finishes.
// It does NOT trust the webhook body: it takes only the run ID, re-reads that run from the
// Apify API with our token, and ingests only if the run really SUCCEEDED.
// Secrets: APIFY_TOKEN (set in Edge Functions -> Secrets). SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function log(row: Record<string, unknown>) {
  const { error } = await db.from("ingest_log").insert(row);
  if (error) console.error("ingest_log insert failed:", error.message);
}

async function apify(path: string) {
  const res = await fetch(`https://api.apify.com/v2${path}`, {
    headers: { Authorization: `Bearer ${Deno.env.get("APIFY_TOKEN")}` },
  });
  if (!res.ok) throw new Error(`Apify ${path.split("?")[0]} -> ${res.status}`);
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!Deno.env.get("APIFY_TOKEN")) return json({ error: "APIFY_TOKEN not set" }, 500);

  let runId: string | undefined;
  try {
    const body = await req.json();
    runId = body?.eventData?.actorRunId ?? body?.resource?.id;
    if (!runId || !/^[A-Za-z0-9]{10,40}$/.test(runId)) {
      await log({ status: "rejected", detail: "no valid run id in payload" });
      return json({ error: "no valid run id" }, 400);
    }

    // Verify with Apify itself, not with what the caller claims.
    const run = (await apify(`/actor-runs/${runId}`)).data;
    if (run.status !== "SUCCEEDED") {
      await log({ run_id: runId, status: "rejected", detail: `run status ${run.status}` });
      return json({ error: `run status ${run.status}` }, 409);
    }

    const items: Array<Record<string, unknown>> =
      await apify(`/datasets/${run.defaultDatasetId}/items?clean=true&format=json`);

    const rows = [];
    for (const it of items) {
      const url = typeof it.url === "string" ? it.url : "";
      const title = typeof it.title === "string" ? it.title.trim() : "";
      const category = typeof it.category === "string" ? it.category.trim() : "";
      const price = parseFloat(String(it.price ?? "").replace(/[^0-9.]/g, ""));
      if (!url || !title || !category || !(price > 0)) continue; // counted as skipped
      rows.push({ source_id: url, title, category, price_gbp: price, run_id: runId });
    }

    let inserted = 0;
    if (rows.length) {
      const { data, error } = await db
        .from("scraped_items")
        .upsert(rows, { onConflict: "source,source_id", ignoreDuplicates: true })
        .select("id");
      if (error) throw new Error(`upsert: ${error.message}`);
      inserted = data?.length ?? 0;
    }

    const result = {
      run_id: runId,
      received: items.length,
      valid: rows.length,
      inserted,
      skipped: items.length - rows.length,
    };
    await log({ ...result, status: "ok" });
    return json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("apify-ingest failed:", msg);
    await log({ run_id: runId ?? null, status: "error", detail: msg });
    return json({ error: msg }, 500);
  }
});
