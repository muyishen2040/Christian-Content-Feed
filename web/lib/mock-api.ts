import {
  type ApiClient, type FeedQuery, type FeedResponse,
  type FeedbackRequest, type FeedbackResponse, type MutationResponse,
  type ProfileInput, type ProfileResponse, type SafetyResponse,
  type SavedResponse, feedbackRequestSchema, feedQuerySchema,
  profileInputSchema,
} from "./contracts";
import { mockStories } from "./mock-data";

type FeedbackState = { reaction: "interested" | "not_for_me" | null; saved: boolean };
const emptyState = (): FeedbackState => ({ reaction: null, saved: false });

function page<T extends { id: string }>(items: T[], query: FeedQuery) {
  const { cursor, limit } = feedQuerySchema.parse(query);
  const index = cursor ? items.findIndex((item) => item.id === cursor) : -1;
  if (cursor && index < 0) throw new Error("Invalid cursor");
  const start = index + 1;
  const slice = items.slice(start, start + limit);
  return { items: slice, nextCursor: start + limit < items.length ? slice.at(-1)!.id : null };
}

export class MockApiClient implements ApiClient {
  private profile: ProfileInput | null = null;
  private feedback = new Map<string, FeedbackState>();
  private replies = new Map<string, FeedbackResponse>();
  private undoable = new Map<string, { testimonyId: string; previous: FeedbackState }>();
  private lastEvent = new Map<string, string>();

  async saveProfile(input: ProfileInput): Promise<ProfileResponse> {
    this.profile = profileInputSchema.parse(input);
    return { profile: this.profile };
  }

  async getFeed(query: FeedQuery = {}): Promise<FeedResponse> {
    return { ...page(mockStories, query), safetyState: "normal", mock: true };
  }

  async sendFeedback(raw: FeedbackRequest): Promise<FeedbackResponse> {
    const input = feedbackRequestSchema.parse(raw);
    const existing = this.replies.get(input.requestId);
    if (existing) return existing;
    if (!mockStories.some((story) => story.id === input.testimonyId)) {
      throw new Error("Unknown testimony");
    }
    const before = { ...(this.feedback.get(input.testimonyId) ?? emptyState()) };
    let after = { ...before };
    if (input.action === "undo") {
      const target = this.undoable.get(input.undoEventId!);
      if (!target || target.testimonyId !== input.testimonyId ||
          this.lastEvent.get(input.testimonyId) !== input.undoEventId) {
        throw new Error("Only the latest action can be undone");
      }
      after = { ...target.previous };
    } else if (input.action === "interested" || input.action === "not_for_me") {
      after.reaction = input.action;
    } else if (input.action === "save") {
      after.saved = true;
    } else if (input.action === "unsave") {
      after.saved = false;
    }
    this.feedback.set(input.testimonyId, after);
    const reply: FeedbackResponse = {
      eventId: input.requestId, testimonyId: input.testimonyId,
      reaction: after.reaction, saved: after.saved,
    };
    this.replies.set(input.requestId, reply);
    if (input.action !== "undo") this.undoable.set(input.requestId, {
      testimonyId: input.testimonyId, previous: before,
    });
    this.lastEvent.set(input.testimonyId, input.requestId);
    return reply;
  }

  async getSaved(query: FeedQuery = {}): Promise<SavedResponse> {
    return page(mockStories.filter((story) => this.feedback.get(story.id)?.saved), query);
  }

  async reset(): Promise<MutationResponse> {
    this.profile = null;
    this.feedback.clear();
    this.replies.clear();
    this.undoable.clear();
    this.lastEvent.clear();
    return { ok: true };
  }

  async deleteProfile(): Promise<MutationResponse> {
    return this.reset();
  }

  async getSafety(): Promise<SafetyResponse> {
    return { state: "normal", resources: [] };
  }
}
