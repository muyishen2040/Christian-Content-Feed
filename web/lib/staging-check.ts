const STAGING_URL = "https://ejvymlkjxcupnkxtzdtv.supabase.co";
const APPROVED = [
  "00000000-0000-4000-8000-0000000000f1",
  "00000000-0000-4000-8000-0000000000f2",
];
const DRAFT = "00000000-0000-4000-8000-0000000000f3";

export async function handleStagingCheck(
  env: Record<string, string | undefined>,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  if (env.VERCEL_ENV !== "preview" || env.ENABLE_STAGING_CHECK !== "true") {
    return new Response(null, { status: 404 });
  }
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (
    env.NEXT_PUBLIC_SUPABASE_URL !== STAGING_URL ||
    !key?.startsWith("sb_publishable_") ||
    key === "sb_publishable_"
  ) {
    return Response.json(
      { ok: false },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const url = new URL("/rest/v1/published_testimonies", STAGING_URL);
    url.searchParams.set("select", "id");
    url.searchParams.set("id", `in.(${[...APPROVED, DRAFT].join(",")})`);
    const response = await fetcher(url, {
      headers: { apikey: key },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Staging request failed");
    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) throw new Error("Invalid staging response");
    const ids = new Set(rows.map((row: { id?: string }) => row.id));
    if (!APPROVED.every((id) => ids.has(id)) || ids.has(DRAFT)) {
      throw new Error("Unexpected staging fixtures");
    }
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { ok: false },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
