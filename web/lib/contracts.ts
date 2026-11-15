import { z } from "zod";

const uuid = z.string().uuid();
export const feedVariantSchema = z.enum(["baseline", "personalized"]);
export const safetyStateSchema = z.enum(["normal", "support"]);

// For published content, publisher URL and attribution are mandatory.
// summary is our permission-reviewed, original editorial text (never source text by default).
export const storySchema = z
  .object({
    id: uuid,
    contentType: z.literal("testimony"),
    title: z.string().min(1),
    summary: z.string().min(1),
    sourceName: z.string().min(1),
    sourceUrl: z.url().nullable(),
    topics: z.array(z.string()),
    publishedAt: z.iso.datetime(),
    isMock: z.boolean(),
  })
  .strict()
  .superRefine((story, ctx) => {
    if (!story.isMock && !story.sourceUrl) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceUrl"],
        message: "Published testimony requires an original-source URL",
      });
    }
  });

export const ageRangeSchema = z.enum([
  "18-24",
  "25-34",
  "35-44",
  "45-54",
  "55-64",
  "65+",
  "prefer_not_to_say",
]);
export const genderSchema = z.enum([
  "woman",
  "man",
  "nonbinary",
  "self_describe",
  "prefer_not_to_say",
]);

export const profileInputSchema = z
  .object({
    description: z.string().trim().max(2000).nullable(),
    topics: z.array(z.string().trim().min(1).max(60)).max(12),
    ageRange: ageRangeSchema.optional(),
    gender: genderSchema.optional(),
    consentStorePreferences: z.boolean(),
    consentKeepText: z.boolean(),
  })
  .strict()
  .superRefine((profile, ctx) => {
    if (profile.consentKeepText && !profile.consentStorePreferences) {
      ctx.addIssue({
        code: "custom",
        path: ["consentKeepText"],
        message: "Keeping text requires explicit preference-storage consent",
      });
    }
  });

export const profileResponseSchema = z
  .object({
    profile: profileInputSchema.nullable(),
    safetyState: safetyStateSchema,
    feedMode: z.enum(["personalized", "default", "support"]),
  })
  .strict();

export const feedQuerySchema = z
  .object({
    cursor: z.string().min(1).max(4096).optional(),
    limit: z.coerce.number().int().min(1).max(20).default(2),
  })
  .strict();

export const feedItemSchema = storySchema.safeExtend({
  rank: z.number().int().positive(),
});

export const feedResponseSchema = z
  .object({
    items: z.array(feedItemSchema),
    nextCursor: z.string().nullable(),
    batchId: uuid,
    feedVariant: feedVariantSchema,
    safetyState: safetyStateSchema,
    mock: z.boolean(),
  })
  .strict();

export const feedbackRequestSchema = z
  .object({
    testimonyId: uuid,
    action: z.enum(["interested", "not_for_me", "save", "unsave", "undo"]),
    requestId: uuid,
    // Refers to feedback.id, not the original requestId.
    undoEventId: uuid.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === "undo" && !value.undoEventId) {
      ctx.addIssue({
        code: "custom",
        path: ["undoEventId"],
        message: "Undo requires undoEventId",
      });
    }
    if (value.action !== "undo" && value.undoEventId) {
      ctx.addIssue({
        code: "custom",
        path: ["undoEventId"],
        message: "undoEventId is only valid for undo",
      });
    }
  });

export const feedbackResponseSchema = z
  .object({
    eventId: uuid,
    testimonyId: uuid,
    reaction: z.enum(["interested", "not_for_me"]).nullable(),
    saved: z.boolean(),
  })
  .strict();

export const feedEventRequestSchema = z
  .object({
    eventId: uuid,
    testimonyId: uuid,
    batchId: uuid,
    pageViewId: uuid,
    rank: z.number().int().positive(),
    feedVariant: feedVariantSchema,
    eventName: z.enum(["impression", "open", "click"]),
  })
  .strict();

export const feedEventResponseSchema = z
  .object({
    accepted: z.literal(true),
    eventId: uuid,
  })
  .strict();

export const savedResponseSchema = z
  .object({
    items: z.array(storySchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

export const mutationResponseSchema = z
  .object({ ok: z.literal(true) })
  .strict();

export const safetyResponseSchema = z
  .object({
    state: safetyStateSchema,
    resources: z.array(z.object({ label: z.string(), url: z.url() }).strict()),
  })
  .strict();

export type Story = z.infer<typeof storySchema>;
export type ProfileInput = z.infer<typeof profileInputSchema>;
export type ProfileResponse = z.infer<typeof profileResponseSchema>;
export type FeedResponse = z.infer<typeof feedResponseSchema>;
export type FeedbackRequest = z.infer<typeof feedbackRequestSchema>;
export type FeedbackResponse = z.infer<typeof feedbackResponseSchema>;
export type FeedEventRequest = z.infer<typeof feedEventRequestSchema>;
export type FeedEventResponse = z.infer<typeof feedEventResponseSchema>;
export type SavedResponse = z.infer<typeof savedResponseSchema>;
export type SafetyResponse = z.infer<typeof safetyResponseSchema>;
export type MutationResponse = z.infer<typeof mutationResponseSchema>;
export type FeedQuery = { cursor?: string; limit?: number };

// All methods are contracts. Only the development-only mock GET /api/feed route
// is exposed by MUY-13. Real handlers are owned by MUY-26 to MUY-34.
export interface ApiClient {
  getProfile(): Promise<ProfileResponse>;
  saveProfile(input: ProfileInput): Promise<ProfileResponse>;
  getFeed(query?: FeedQuery): Promise<FeedResponse>;
  recordFeedEvent(input: FeedEventRequest): Promise<FeedEventResponse>;
  sendFeedback(input: FeedbackRequest): Promise<FeedbackResponse>;
  getSaved(query?: FeedQuery): Promise<SavedResponse>;
  reset(): Promise<MutationResponse>;
  deleteProfile(): Promise<MutationResponse>;
  getSafety(): Promise<SafetyResponse>;
}
