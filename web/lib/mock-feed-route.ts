import { ApiError } from "./api-error.ts";
import { feedQuerySchema, feedResponseSchema } from "./contracts.ts";
import { MockApiClient } from "./mock-api.ts";

// An explicit environment opt-in is required, and Vercel production fails
// closed even when someone mistakenly enables the feature flag.
export function mockFeedEnabled(env: Record<string, string | undefined>): boolean {
  return (
    env.ENABLE_MOCK_FEED === "true" &&
    (env.NODE_ENV !== "production" || env.VERCEL_ENV === "preview") &&
    env.VERCEL_ENV !== "production"
  );
}

// This is the actual exported Next.js route handler (re-exported by route.ts).
// No production backend, persistence or user authentication is simulated.
export async function GET(request: Request): Promise<Response> {
  return handleMockFeedGet(request, process.env);
}

export async function handleMockFeedGet(
  request: Request,
  env: Record<string, string | undefined>,
): Promise<Response> {
  if (!mockFeedEnabled(env)) {
    return Response.json({ error: "Not Found" }, { status: 404 });
  }
  const params = new URL(request.url).searchParams;
  const parsed = feedQuerySchema.safeParse({
    ...(params.has("cursor") ? { cursor: params.get("cursor") } : {}),
    ...(params.has("limit") ? { limit: params.get("limit") } : {}),
  });
  if (!parsed.success) {
    return Response.json({ error: "Invalid pagination parameters" }, { status: 400 });
  }
  try {
    const data = await new MockApiClient().getFeed(parsed.data);
    return Response.json(feedResponseSchema.parse(data), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) {
      return Response.json({ error: "Invalid pagination cursor" }, { status: 400 });
    }
    return Response.json({ error: "Mock feed unavailable" }, { status: 500 });
  }
}
