import "server-only";

import { embedEligibleText } from "./embedding-client.ts";
import {
  decryptProfileDescription,
  encryptProfileDescription,
} from "./profile-crypto.ts";
import type { ProfileDeps, ProfileRow } from "./profile-api.ts";
import { createSessionDeps, adminClient } from "./supabase-server.ts";

/** Real dependencies for the profile handlers. Reuses the verified-session check from MUY-26. */
export function createProfileDeps(): ProfileDeps {
  const session = createSessionDeps();
  return {
    getUser: () => session.getUser(),
    async readProfile(userId: string): Promise<ProfileRow | null> {
      const { data, error } = await adminClient()
        .from("user_profiles")
        .select(
          "consent_to_personalization, consent_keep_text, topics, preference_model_version, description_ciphertext",
        )
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error("Profile read failed");
      if (!data) return null;
      return {
        consent_to_personalization: data.consent_to_personalization === true,
        consent_keep_text: data.consent_keep_text === true,
        topics: Array.isArray(data.topics) ? data.topics : [],
        has_preference: typeof data.preference_model_version === "string",
        description_ciphertext:
          typeof data.description_ciphertext === "string"
            ? data.description_ciphertext
            : null,
      };
    },
    async writeProfile(userId, patch) {
      const { error } = await adminClient()
        .from("user_profiles")
        .upsert(
          { user_id: userId, ...patch, updated_at: new Date().toISOString() },
          { onConflict: "user_id" },
        );
      // Do not include the error: it can echo submitted values.
      if (error) throw new Error("Profile write failed");
    },
    async deleteProfile(userId) {
      const { error } = await adminClient()
        .from("user_profiles")
        .delete()
        .eq("user_id", userId);
      if (error) throw new Error("Profile delete failed");
    },
    encrypt: encryptProfileDescription,
    decrypt: decryptProfileDescription,
    embed: (text) => embedEligibleText(text, "query"),
  };
}
