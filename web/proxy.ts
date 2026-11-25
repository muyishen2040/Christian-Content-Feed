import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server.js";
import { isTemporaryAuthError } from "./lib/auth-errors.ts";

// Keeps a returning visitor's Supabase session fresh. It only runs for /api routes and only when the
// browser already has Supabase cookies, so first-time visitors and bots reading public pages cost no
// Auth calls and create no users. Anonymous sessions are created only by POST /api/session.
type CookieItem = {
  name: string;
  value: string;
  options: Record<string, unknown>;
};

export async function proxy(request: NextRequest) {
  return refreshSession(request, createServerClient);
}

// The client factory is a parameter so tests can simulate Auth failures without a network.
export async function refreshSession(
  request: NextRequest,
  createClient: typeof createServerClient,
) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const hasSession = request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-"));
  if (!url || !key || !hasSession) return NextResponse.next();

  let pending: CookieItem[] = [];
  const supabase = createClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      // Held back until the refresh is known to have succeeded: on a temporary failure the client
      // may ask to clear the cookies, and that would end the visitor's session.
      setAll: (items) => {
        pending = [...pending, ...(items as CookieItem[])];
      },
    },
  });
  const { error } = await supabase.auth.getUser(); // refreshes an expiring token
  if (error && isTemporaryAuthError(error)) {
    // For example a 409 when refresh requests overlap. Keep the cookies as they are and let the
    // browser retry, so the API route never sees a half-refreshed session.
    const retry = NextResponse.json(
      { error: { code: "session_refresh_conflict", message: "Try again" } },
      { status: 503 },
    );
    retry.headers.set("Retry-After", "1");
    retry.headers.set("Cache-Control", "no-store");
    return retry;
  }
  for (const { name, value } of pending) request.cookies.set(name, value);
  const response = NextResponse.next({ request });
  for (const { name, value, options } of pending) {
    response.cookies.set(name, value, {
      ...options,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = { matcher: ["/api/:path*"] };
