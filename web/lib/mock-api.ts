import {
  type ApiClient,
  type FeedEventRequest,
  type FeedEventResponse,
  type FeedQuery,
  type FeedResponse,
  type FeedbackRequest,
  type FeedbackResponse,
  type MutationResponse,
  type ProfileInput,
  type ProfileResponse,
  type SafetyResponse,
  type SavedResponse,
  feedEventRequestSchema,
  feedbackRequestSchema,
  feedQuerySchema,
  profileInputSchema,
} from "./contracts.ts";
import { ApiError } from "./api-error.ts";
import { mockStories } from "./mock-data.ts";

type FeedbackState = {
  reaction: "interested" | "not_for_me" | null;
  saved: boolean;
};
const emptyState = (): FeedbackState => ({ reaction: null, saved: false });
type PageScope = "feed" | "saved";
type PageVariant = "baseline" | "personalized";

function encodeCursor(
  offset: number,
  scope: PageScope,
  variant: PageVariant,
): string {
  // Opaque to clients, not a security boundary. Real backend must use a signed,
  // ranking-snapshot cursor; do not decode or interpret this in UI components.
  const bytes = btoa(JSON.stringify({ v: 1, offset, scope, variant }));
  return bytes.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeCursor(
  cursor: string,
  scope: PageScope,
  variant: PageVariant,
): number {
  try {
    if (!/^[a-zA-Z0-9_-]+$/.test(cursor)) throw new Error("Invalid alphabet");
    const data: unknown = JSON.parse(
      atob(cursor.replaceAll("-", "+").replaceAll("_", "/")),
    );
    if (typeof data !== "object" || data === null)
      throw new Error("Invalid object");
    const c = data as Record<string, unknown>;
    if (
      c.v !== 1 ||
      c.scope !== scope ||
      c.variant !== variant ||
      typeof c.offset !== "number" ||
      !Number.isSafeInteger(c.offset) ||
      c.offset < 0
    ) {
      throw new Error("Cursor mismatch");
    }
    return c.offset;
  } catch {
    throw new ApiError(400, "INVALID_CURSOR", "Invalid pagination cursor");
  }
}

function page<T>(
  items: T[],
  query: FeedQuery,
  scope: PageScope,
  variant: PageVariant,
): { items: T[]; nextCursor: string | null; start: number } {
  const { cursor, limit } = feedQuerySchema.parse(query);
  const start = cursor ? decodeCursor(cursor, scope, variant) : 0;
  if (start > items.length) {
    throw new ApiError(
      400,
      "INVALID_CURSOR",
      "Cursor points outside the result set",
    );
  }
  const slice = items.slice(start, start + limit);
  return {
    items: slice,
    nextCursor:
      start + limit < items.length
        ? encodeCursor(start + limit, scope, variant)
        : null,
    start,
  };
}

type MockOptions = { detectSupport?: (description: string) => boolean };

// Test adapter only. It never writes personal text to a database or localStorage.
export class MockApiClient implements ApiClient {
  private profile: ProfileInput | null = null;
  private readonly feedback = new Map<string, FeedbackState>();
  private readonly replies = new Map<
    string,
    { payload: string; response: FeedbackResponse }
  >();
  private readonly undoable = new Map<
    string,
    { testimonyId: string; previous: FeedbackState }
  >();
  private readonly lastEvent = new Map<string, string>();
  private readonly batches = new Map<
    string,
    { variant: PageVariant; ranks: Map<string, number> }
  >();
  private readonly feedEvents = new Map<string, string>();
  private readonly detectSupport: (description: string) => boolean;

  constructor(options: MockOptions = {}) {
    // Deterministic mock injection for UI tests, NOT a real crisis detector.
    this.detectSupport = options.detectSupport ?? (() => false);
  }

  async getProfile(): Promise<ProfileResponse> {
    return {
      profile: this.profile ? { ...this.profile } : null,
      safetyState: "normal",
      feedMode: this.profile ? "personalized" : "default",
    };
  }

  async saveProfile(input: ProfileInput): Promise<ProfileResponse> {
    const parsed = profileInputSchema.parse(input);
    if (parsed.description && this.detectSupport(parsed.description)) {
      // Drop the submitted description and previous preferences for this mock
      // session; a flagged input must never influence recommendations.
      this.profile = null;
      return { profile: null, safetyState: "support", feedMode: "support" };
    }
    // Age/gender are optional UI fields, not retained or used for scoring.
    const sanitized: ProfileInput = {
      description: parsed.consentKeepText ? parsed.description : null,
      topics: [...parsed.topics],
      consentStorePreferences: parsed.consentStorePreferences,
      consentKeepText: parsed.consentKeepText,
    };
    this.profile = parsed.consentStorePreferences ? sanitized : null;
    return {
      profile: sanitized,
      safetyState: "normal",
      feedMode:
        parsed.description || parsed.topics.length ? "personalized" : "default",
    };
  }

  async getFeed(query: FeedQuery = {}): Promise<FeedResponse> {
    const variant: PageVariant = this.profile ? "personalized" : "baseline";
    const available = mockStories.filter(
      (story) => this.feedback.get(story.id)?.reaction !== "not_for_me",
    );
    const chunk = page(available, query, "feed", variant);
    const batchId = crypto.randomUUID();
    const items = chunk.items.map((story, offset) => ({
      ...story,
      rank: chunk.start + offset + 1,
    }));
    this.batches.set(batchId, {
      variant,
      ranks: new Map(items.map((item) => [item.id, item.rank])),
    });
    return {
      items,
      nextCursor: chunk.nextCursor,
      batchId,
      feedVariant: variant,
      safetyState: "normal",
      mock: true,
    };
  }

  async recordFeedEvent(raw: FeedEventRequest): Promise<FeedEventResponse> {
    const input = feedEventRequestSchema.parse(raw);
    const key = JSON.stringify(input);
    const previous = this.feedEvents.get(input.eventId);
    if (previous) {
      if (previous !== key)
        throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Event ID reused");
      return { eventId: input.eventId, accepted: true };
    }
    const batch = this.batches.get(input.batchId);
    if (
      !batch ||
      batch.variant !== input.feedVariant ||
      batch.ranks.get(input.testimonyId) !== input.rank
    ) {
      throw new ApiError(
        400,
        "INVALID_EVENT",
        "Event does not match a served batch",
      );
    }
    // UI must send impression only after viewability threshold is met.
    this.feedEvents.set(input.eventId, key);
    return { eventId: input.eventId, accepted: true };
  }

  async sendFeedback(raw: FeedbackRequest): Promise<FeedbackResponse> {
    const input = feedbackRequestSchema.parse(raw);
    const payload = JSON.stringify(input);
    const existing = this.replies.get(input.requestId);
    if (existing) {
      if (existing.payload !== payload) {
        throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Request ID reused");
      }
      return existing.response;
    }
    if (!mockStories.some((story) => story.id === input.testimonyId)) {
      throw new ApiError(404, "TESTIMONY_NOT_FOUND", "Unknown testimony");
    }

    const before = {
      ...(this.feedback.get(input.testimonyId) ?? emptyState()),
    };
    const after = { ...before };
    if (input.action === "undo") {
      const target = this.undoable.get(input.undoEventId!);
      if (
        !target ||
        target.testimonyId !== input.testimonyId ||
        this.lastEvent.get(input.testimonyId) !== input.undoEventId
      ) {
        throw new ApiError(
          409,
          "UNDO_CONFLICT",
          "Only the latest feedback can be undone",
        );
      }
      after.reaction = target.previous.reaction;
      after.saved = target.previous.saved;
    } else if (input.action === "interested" || input.action === "not_for_me") {
      after.reaction = input.action;
    } else if (input.action === "save") {
      after.saved = true;
    } else if (input.action === "unsave") {
      after.saved = false;
    }

    this.feedback.set(input.testimonyId, after);
    const response: FeedbackResponse = {
      // Distinct from the idempotency requestId, matching public.feedback.id.
      eventId: crypto.randomUUID(),
      testimonyId: input.testimonyId,
      reaction: after.reaction,
      saved: after.saved,
    };
    this.replies.set(input.requestId, { payload, response });
    if (input.action !== "undo") {
      this.undoable.set(response.eventId, {
        testimonyId: input.testimonyId,
        previous: before,
      });
    }
    this.lastEvent.set(input.testimonyId, response.eventId);
    return response;
  }

  async getSaved(query: FeedQuery = {}): Promise<SavedResponse> {
    const saved = mockStories.filter(
      (story) => this.feedback.get(story.id)?.saved,
    );
    const { items, nextCursor } = page(saved, query, "saved", "baseline");
    return { items, nextCursor };
  }

  async reset(): Promise<MutationResponse> {
    this.profile = null;
    this.feedback.clear();
    this.replies.clear();
    this.undoable.clear();
    this.lastEvent.clear();
    this.batches.clear();
    this.feedEvents.clear();
    return { ok: true };
  }

  async deleteProfile(): Promise<MutationResponse> {
    return this.reset();
  }

  async getSafety(): Promise<SafetyResponse> {
    return { state: "normal", resources: [] };
  }
}
