import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Keeps a returning visitor's Supabase session fresh. It only runs for /api routes and only when the
// browser already has Supabase cookies, so first-time visitors and bots reading public pages cost no
// Auth calls and create no users. Anonymous sessions are created only by POST /api/session.
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const hasSession = request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-"));
  if (!url || !key || !hasSession) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (items) => {
        for (const { name, value } of items) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of items) {
          response.cookies.set(name, value, {
            ...options,
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
          });
        }
      },
    },
  });
  await supabase.auth.getUser(); // refreshes an expiring token and rewrites the cookies
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = { matcher: ["/api/:path*"] };
