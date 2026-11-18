import {
  type ApiClient,
  type FeedEventRequest,
  type FeedQuery,
  type FeedbackRequest,
  type ProfileInput,
  feedEventResponseSchema,
  feedResponseSchema,
  feedbackResponseSchema,
  mutationResponseSchema,
  profileResponseSchema,
  savedResponseSchema,
  safetyResponseSchema,
} from "./contracts.ts";
import { ApiError } from "./api-error.ts";
import { MockApiClient } from "./mock-api.ts";

// Real authentication and same-origin mutation protection are MUY-26's responsibility.
// Never pass a service-role key to this client.
export function createHttpApiClient(fetcher: typeof fetch = fetch): ApiClient {
  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetcher(path, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      ...init,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      // Do not reflect raw text, server traces or arbitrary error bodies into the UI.
      throw new ApiError(
        response.status,
        "HTTP_ERROR",
        `Request failed (${response.status})`,
      );
    }
    return response.json();
  }
  function queryString(query: FeedQuery = {}) {
    const params = new URLSearchParams();
    if (query.cursor) params.set("cursor", query.cursor);
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    return params.size ? `?${params}` : "";
  }
  return {
    async getProfile() {
      return profileResponseSchema.parse(await request("/api/profile"));
    },
    async saveProfile(input: ProfileInput) {
      return profileResponseSchema.parse(
        await request("/api/profile", {
          method: "PUT",
          body: JSON.stringify(input),
        }),
      );
    },
    async getFeed(query: FeedQuery = {}) {
      return feedResponseSchema.parse(
        await request(`/api/feed${queryString(query)}`),
      );
    },
    async recordFeedEvent(input: FeedEventRequest) {
      return feedEventResponseSchema.parse(
        await request("/api/feed/events", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      );
    },
    async sendFeedback(input: FeedbackRequest) {
      return feedbackResponseSchema.parse(
        await request("/api/feedback", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      );
    },
    async getSaved(query: FeedQuery = {}) {
      return savedResponseSchema.parse(
        await request(`/api/saved${queryString(query)}`),
      );
    },
    async reset() {
      return mutationResponseSchema.parse(
        await request("/api/profile/reset", { method: "POST" }),
      );
    },
    async deleteProfile() {
      return mutationResponseSchema.parse(
        await request("/api/profile", { method: "DELETE" }),
      );
    },
    async getSafety() {
      return safetyResponseSchema.parse(await request("/api/safety"));
    },
  };
}

export function createApiClient(mode: "mock" | "http" = "mock"): ApiClient {
  return mode === "mock" ? new MockApiClient() : createHttpApiClient();
}
