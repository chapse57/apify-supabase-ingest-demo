// Supabase Edge Function "medians" — read-only JSON for the demo page.
// zones: sample listings (pricing engine shape); categories: rows ingested from Apify;
// ingests: each successful webhook run (received vs newly inserted).

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return json({ error: "GET only" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );

  const [zones, categories, ingests] = await Promise.all([
    supabase.from("zone_medians")
      .select("zone, listings, median_price_eur, median_eur_per_m2").order("zone"),
    supabase.from("category_medians")
      .select("category, items, median_price_gbp").order("category"),
    supabase.from("ingest_summary")
      .select("received_at, run_id, received, valid, inserted, skipped").order("id"),
  ]);

  const failed = [zones, categories, ingests].find((r) => r.error);
  if (failed?.error) {
    console.error("query failed:", failed.error.message);
    return json({ error: failed.error.message }, 500);
  }

  return json({
    generated_at: new Date().toISOString(),
    zones: zones.data,
    categories: categories.data,
    ingests: ingests.data,
  });
});
