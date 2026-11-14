// Manual deployment smoke test. No credentials or personal content are printed.
export async function verifyPreview({ url, bypassToken = "", fetcher = fetch }) {
  if (!url) throw new Error("PREVIEW_URL must be set");
  const base = new URL(url);
  if (base.protocol !== "https:") {
    throw new Error("Preview URL must use HTTPS");
  }
  const headers = bypassToken ? { "x-vercel-protection-bypass": bypassToken } : {};
  const result = await fetcher(new URL("/", base), {
    headers,
    redirect: "follow",
    cache: "no-store",
  });
  if (!result.ok) {
    throw new Error(`Preview returned HTTP ${result.status}; check Vercel access protection`);
  }
  const html = await result.text();
  if (!html.includes("故事，陪你走一段路") || !html.includes("開發預覽")) {
    throw new Error("Expected mock landing page not found (possible auth wall or build mismatch)");
  }
  return true;
}

if (process.argv[1]?.endsWith("/verify-preview.mjs")) {
  verifyPreview({
    url: process.env.PREVIEW_URL,
    bypassToken: process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
  }).then(
    () => process.stdout.write("Deployment smoke check passed.\n"),
    (error) => {
      process.stderr.write(`Deployment smoke check failed: ${error.message}\n`);
      process.exitCode = 1;
    },
  );
}
