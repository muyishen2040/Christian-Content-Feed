import { NextRequest, NextResponse } from "next/server";
import { feedQuerySchema, feedResponseSchema } from "@/lib/contracts";
import { MockApiClient } from "@/lib/mock-api";

// Development-only mock feed. This endpoint must be replaced before pilot launch.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const parsed = feedQuerySchema.safeParse({
    ...(params.has("cursor") ? { cursor: params.get("cursor") } : {}),
    ...(params.has("limit") ? { limit: params.get("limit") } : {}),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid pagination parameters" }, { status: 400 });
  }
  try {
    const data = await new MockApiClient().getFeed(parsed.data);
    return NextResponse.json(feedResponseSchema.parse(data), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  }
}
