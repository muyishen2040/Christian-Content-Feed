import "server-only";

import { getVercelOidcToken } from "@vercel/oidc";

const EXPECTED_MODEL = "BAAI/bge-small-zh-v1.5";
const EXPECTED_REVISION = "7999e1d3359715c523056ef9478215996d62a620";
const EXPECTED_EXPORT = "fcecc3c5fef6becfa2b2bdda15c1c938857be534";

export type Embedding = {
  vector: number[];
  model: string;
  revision: string;
  export_revision: string;
  dimension: number;
};

/** The caller must complete the safety check before using text for personalization. */
export async function embedEligibleText(
  text: string,
  kind: "query" | "passage",
): Promise<Embedding | null> {
  const serviceUrl = process.env.EMBEDDING_SERVICE_URL;
  const token = process.env.EMBEDDING_SERVICE_TOKEN;
  if (!serviceUrl || !token || !text.trim() || text.length > 8000) return null;

  try {
    const base = new URL(serviceUrl);
    const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
    if (
      (base.protocol !== "https:" && !(base.protocol === "http:" && isLocal)) ||
      base.username || base.password || base.search || base.hash
    ) return null;

    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
    if (process.env.EMBEDDING_SERVICE_USE_VERCEL_OIDC === "true") {
      const oidcToken = await getVercelOidcToken();
      if (!oidcToken) return null;
      headers["x-vercel-trusted-oidc-idp-token"] = oidcToken;
    }
    const url = new URL(`${base.pathname.replace(/\/$/, "")}/embed`, base.origin);
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ text, kind }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const result: unknown = await response.json();
    if (!result || typeof result !== "object") return null;
    const value = result as Partial<Embedding>;
    if (
      value.model !== EXPECTED_MODEL || value.revision !== EXPECTED_REVISION ||
      value.export_revision !== EXPECTED_EXPORT || value.dimension !== 512 ||
      !Array.isArray(value.vector) || value.vector.length !== 512 ||
      !value.vector.every((item) => typeof item === "number" && Number.isFinite(item))
    ) return null;
    const length = Math.sqrt(value.vector.reduce((sum, item) => sum + item * item, 0));
    if (Math.abs(length - 1) > 0.001) return null;
    return value as Embedding;
  } catch {
    // Do not log an error or response: they may contain the submitted text.
    return null;
  }
}
