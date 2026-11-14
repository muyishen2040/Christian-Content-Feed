import { z } from "zod";

export const storySchema = z.object({
  id: z.string().min(1),
  contentType: z.literal("testimony"),
  title: z.string().min(1),
  excerpt: z.string().min(1),
  sourceName: z.string().min(1),
  sourceUrl: z.string().url().nullable(),
  topics: z.array(z.string()).default([]),
  publishedAt: z.string().datetime(),
  isMock: z.boolean(),
}).strict();

export const profileInputSchema = z.object({
  description: z.string().trim().max(2000).nullable(),
  topics: z.array(z.string().trim().min(1).max(60)).max(12),
  consentToPersonalization: z.boolean(),
}).strict();

export const profileResponseSchema = z.object({
  profile: profileInputSchema.nullable(),
}).strict();

export const feedQuerySchema = z.object({
  cursor: z.string().min(1).nullable().optional(),
  limit: z.coerce.number().int().min(1).max(20).default(2),
}).strict();

export const feedResponseSchema = z.object({
  items: z.array(storySchema),
  nextCursor: z.string().nullable(),
  safetyState: z.enum(["normal", "support"]),
  mock: z.boolean(),
}).strict();

export const feedbackRequestSchema = z.object({
  testimonyId: z.string().min(1),
  action: z.enum(["interested", "not_for_me", "save", "unsave", "undo"]),
  requestId: z.string().uuid(),
  undoEventId: z.string().uuid().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.action === "undo" && !value.undoEventId) {
    ctx.addIssue({ code: "custom", path: ["undoEventId"], message: "undo requires undoEventId" });
  }
  if (value.action !== "undo" && value.undoEventId) {
    ctx.addIssue({ code: "custom", path: ["undoEventId"], message: "undoEventId is only valid for undo" });
  }
});

export const feedbackResponseSchema = z.object({
  eventId: z.string().uuid(),
  testimonyId: z.string(),
  reaction: z.enum(["interested", "not_for_me"]).nullable(),
  saved: z.boolean(),
}).strict();

export const savedResponseSchema = z.object({
  items: z.array(storySchema),
  nextCursor: z.string().nullable(),
}).strict();

export const mutationResponseSchema = z.object({
  ok: z.literal(true),
}).strict();

export const safetyResponseSchema = z.object({
  state: z.enum(["normal", "support"]),
  resources: z.array(z.object({
    label: z.string(),
    url: z.string().url(),
  }).strict()),
}).strict();

export type Story = z.infer<typeof storySchema>;
export type ProfileInput = z.infer<typeof profileInputSchema>;
export type ProfileResponse = z.infer<typeof profileResponseSchema>;
export type FeedResponse = z.infer<typeof feedResponseSchema>;
export type FeedbackRequest = z.infer<typeof feedbackRequestSchema>;
export type FeedbackResponse = z.infer<typeof feedbackResponseSchema>;
export type SavedResponse = z.infer<typeof savedResponseSchema>;
export type SafetyResponse = z.infer<typeof safetyResponseSchema>;
export type MutationResponse = z.infer<typeof mutationResponseSchema>;

export type FeedQuery = { cursor?: string | null; limit?: number };

// This interface is shared by mock and real adapters; UI components only depend on this type.
export interface ApiClient {
  saveProfile(input: ProfileInput): Promise<ProfileResponse>;
  getFeed(query?: FeedQuery): Promise<FeedResponse>;
  sendFeedback(input: FeedbackRequest): Promise<FeedbackResponse>;
  getSaved(query?: FeedQuery): Promise<SavedResponse>;
  reset(): Promise<MutationResponse>;
  deleteProfile(): Promise<MutationResponse>;
  getSafety(): Promise<SafetyResponse>;
}
