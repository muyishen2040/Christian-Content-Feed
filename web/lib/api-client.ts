import {
  type ApiClient, type FeedQuery, type FeedbackRequest, type ProfileInput,
  feedResponseSchema, feedbackResponseSchema, mutationResponseSchema,
  profileResponseSchema, savedResponseSchema, safetyResponseSchema,
} from "./contracts";
import { MockApiClient } from "./mock-api";

// The real adapter deliberately does not implement authentication here.
// Subsequent backend tickets must supply anonymous Supabase auth/session handling.
export function createHttpApiClient(fetcher: typeof fetch = fetch): ApiClient {
  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetcher(path, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      ...init,
    });
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    return response.json();
  }
  function qs(query: FeedQuery = {}) {
    const params = new URLSearchParams();
    if (query.cursor) params.set("cursor", query.cursor);
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    return params.toString() ? `?${params}` : "";
  }
  return {
    async saveProfile(input: ProfileInput) {
      return profileResponseSchema.parse(await request("/api/profile", {
        method: "PUT", body: JSON.stringify(input),
      }));
    },
    async getFeed(query: FeedQuery = {}) {
      return feedResponseSchema.parse(await request(`/api/feed${qs(query)}`));
    },
    async sendFeedback(input: FeedbackRequest) {
      return feedbackResponseSchema.parse(await request("/api/feedback", {
        method: "POST", body: JSON.stringify(input),
      }));
    },
    async getSaved(query: FeedQuery = {}) {
      return savedResponseSchema.parse(await request(`/api/saved${qs(query)}`));
    },
    async reset() {
      return mutationResponseSchema.parse(await request("/api/profile/reset", { method: "POST" }));
    },
    async deleteProfile() {
      return mutationResponseSchema.parse(await request("/api/profile", { method: "DELETE" }));
    },
    async getSafety() {
      return safetyResponseSchema.parse(await request("/api/safety"));
    },
  };
}

export function createApiClient(mode: "mock" | "http" = "mock"): ApiClient {
  return mode === "mock" ? new MockApiClient() : createHttpApiClient();
}
