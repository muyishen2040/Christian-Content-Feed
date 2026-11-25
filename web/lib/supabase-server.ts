import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isTemporaryAuthError } from "./auth-errors.ts";
import { cookies } from "next/headers";
import {
  consentFromRow,
  consentRowPatch,
  type ConsentState,
} from "./consent.ts";
import type { SessionDeps } from "./session-api.ts";

function publicConfig(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase is not configured");
  return { url, key };
}

/** Client that acts as the current visitor, with the session kept in HttpOnly cookies. */
async function visitorClient(): Promise<SupabaseClient> {
  const store = await cookies();
  const { url, key } = publicConfig();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (items) => {
        for (const { name, value, options } of items) {
          store.set(name, value, {
            ...options,
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
          });
        }
      },
    },
  });
}

/** Service-role client. Server-only, and only ever used with a user id taken from a verified
 * session. The key never reaches the browser and is never logged. */
export function adminClient(): SupabaseClient {
  const { url } = publicConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Supabase service role is not configured");
  return createClient(url, key, { auth: { persistSession: false } });
}

export function createSessionDeps(): SessionDeps {
  return {
    async getUser() {
      // getUser() asks the Auth server to verify the token; getSession() would trust the cookie.
      const { data, error } = await (await visitorClient()).auth.getUser();
      if (data.user) return { id: data.user.id };
      // "No visitor session" is a normal answer. A temporary Auth failure is not: reporting it as
      // "no session" would let the caller sign the visitor in again and replace their identity.
      if (error && isTemporaryAuthError(error)) {
        throw new Error("Auth check unavailable");
      }
      return null;
    },
    async signInAnonymously() {
      const { data, error } = await (
        await visitorClient()
      ).auth.signInAnonymously();
      return error || !data.user ? null : { id: data.user.id };
    },
    async readConsent(userId: string): Promise<ConsentState> {
      const { data, error } = await adminClient()
        .from("user_profiles")
        .select("consent_to_personalization, consent_keep_text")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error("Consent read failed");
      return consentFromRow(data);
    },
    async writeConsent(userId: string, consent: ConsentState) {
      const { error } = await adminClient()
        .from("user_profiles")
        .upsert(
          { user_id: userId, ...consentRowPatch(consent) },
          { onConflict: "user_id" },
        );
      if (error) throw new Error("Consent write failed");
    },
  };
}
