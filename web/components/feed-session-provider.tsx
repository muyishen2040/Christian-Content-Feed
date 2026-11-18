"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createApiClient } from "@/lib/api-client";
import type {
  ApiClient,
  FeedEventRequest,
  FeedResponse,
  ProfileInput,
  ProfileResponse,
  Story,
  FeedbackRequest,
} from "@/lib/contracts";
import {
  feedEventFor,
  mergeFeedPage,
  type FeedEntry,
} from "@/lib/feed-pagination";

type FeedStatus = "idle" | "loading" | "ready" | "error";
type FeedbackState = {
  reaction: "interested" | "not_for_me" | null;
  saved: boolean;
  busy: boolean;
  error: string | null;
};
type FeedbackAction = Exclude<FeedbackRequest["action"], "undo">;
type UndoTarget = { story: Story; eventId: string; action: FeedbackAction };

type FeedState = {
  entries: FeedEntry[];
  status: FeedStatus;
  hasLoaded: boolean;
  nextCursor: string | null;
  error: string | null;
  isMock: boolean;
  safetyState: FeedResponse["safetyState"];
};

type FeedSession = FeedState & {
  loadMore: () => Promise<void>;
  saveOnboarding: (input: ProfileInput) => Promise<ProfileResponse>;
  rememberPosition: (top: number) => void;
  readPosition: () => number;
  lookup: (id: string) => FeedEntry | undefined;
  recordEvent: (entry: FeedEntry, name: FeedEventRequest["eventName"]) => void;
  feedback: Record<string, FeedbackState>;
  sendFeedback: (story: Story, action: FeedbackAction) => Promise<void>;
  undoFeedback: () => Promise<void>;
  dismissUndo: () => void;
  undoTarget: UndoTarget | null;
  savedStories: Story[];
  savedLoading: boolean;
  savedError: string | null;
  refreshSaved: () => Promise<void>;
  dataSource: "mock" | "http";
};

const FeedSessionContext = createContext<FeedSession | null>(null);
const PAGE_SIZE = 4;

// Explicit opt-in only. Production deployments must not silently fall back to
// fictional content when a real API fails.
const configuredDataSource =
  process.env.NEXT_PUBLIC_FEED_API_MODE === "http" ? "http" : "mock";

export function FeedSessionProvider({ children }: { children: ReactNode }) {
  const client = useMemo<ApiClient>(
    () => createApiClient(configuredDataSource),
    [],
  );
  const [state, setState] = useState<FeedState>({
    entries: [],
    status: "idle",
    hasLoaded: false,
    nextCursor: null,
    error: null,
    isMock: configuredDataSource === "mock",
    safetyState: "normal",
  });
  const [feedback, setFeedback] = useState<Record<string, FeedbackState>>({});
  const [savedStories, setSavedStories] = useState<Story[]>([]);
  const [savedLoading, setSavedLoading] = useState(true);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [undoTarget, setUndoTarget] = useState<UndoTarget | null>(null);
  const pendingFeedback = useRef(new Set<string>());
  const retryFeedback = useRef(new Map<string, FeedbackRequest>());
  const feedbackSequence = useRef(0);
  const latestNoticeSequence = useRef(0);
  const savedGeneration = useRef(0);
  const fetching = useRef<number | null>(null);
  const generation = useRef(0);
  const savedPosition = useRef(0);
  const pageViewId = useRef<string | null>(null);
  const recordedImpressions = useRef(new Set<string>());

  const loadMore = useCallback(async () => {
    const requestGeneration = generation.current;
    if (
      fetching.current === requestGeneration ||
      (state.hasLoaded && !state.nextCursor)
    )
      return;
    fetching.current = requestGeneration;
    const cursor = state.hasLoaded
      ? (state.nextCursor ?? undefined)
      : undefined;
    setState((previous) => ({ ...previous, status: "loading", error: null }));
    try {
      const response = await client.getFeed({ limit: PAGE_SIZE, cursor });
      if (generation.current !== requestGeneration) return;
      setState((previous) => {
        const merged = mergeFeedPage(previous.entries, response);
        // A buggy cursor or endlessly repeated page must never create an
        // infinite loop of network requests.
        const stalled =
          response.nextCursor === cursor ||
          (response.nextCursor !== null &&
            previous.hasLoaded &&
            merged.length === previous.entries.length);
        return {
          entries: merged,
          status: "ready",
          hasLoaded: true,
          nextCursor: stalled ? null : response.nextCursor,
          error: null,
          isMock: response.mock,
          safetyState: response.safetyState,
        };
      });
    } catch {
      if (generation.current !== requestGeneration) return;
      // Never include arbitrary API bodies or private user text in UI errors.
      setState((previous) => ({
        ...previous,
        status: "error",
        error: "故事暫時無法載入，請重試或稍後再來。",
      }));
    } finally {
      if (fetching.current === requestGeneration) fetching.current = null;
    }
  }, [client, state.hasLoaded, state.nextCursor]);

  const saveOnboarding = useCallback(
    async (input: ProfileInput): Promise<ProfileResponse> => {
      // Only commit the feed refresh if the profile request succeeded.
      // Invalidate any older request so stale results cannot overwrite it.
      const response = await client.saveProfile(input);
      generation.current += 1;
      fetching.current = null;
      savedPosition.current = 0;
      pageViewId.current = null;
      recordedImpressions.current.clear();
      setState({
        entries: [],
        status: "idle",
        hasLoaded: false,
        nextCursor: null,
        error: null,
        isMock: configuredDataSource === "mock",
        safetyState: response.safetyState,
      });
      return response;
    },
    [client],
  );

  const rememberPosition = useCallback((top: number) => {
    savedPosition.current = Math.max(0, top);
  }, []);
  const readPosition = useCallback(() => savedPosition.current, []);
  const lookup = useCallback(
    (id: string) => state.entries.find((entry) => entry.story.id === id),
    [state.entries],
  );

  const recordEvent = useCallback(
    (entry: FeedEntry, name: FeedEventRequest["eventName"]) => {
      if (typeof window === "undefined") return;
      pageViewId.current ??= crypto.randomUUID();
      const impressionKey = entry.story.id;
      if (name === "impression") {
        if (recordedImpressions.current.has(impressionKey)) return;
        recordedImpressions.current.add(impressionKey);
      }
      const event = feedEventFor(
        entry,
        pageViewId.current,
        name,
        crypto.randomUUID(),
      );
      // Measurement must never delay navigation or block reading.
      void client.recordFeedEvent(event).catch(() => {
        // A missing telemetry endpoint or network failure must not expose
        // message payloads to logs or disrupt the reader.
      });
    },
    [client],
  );

  const refreshSaved = useCallback(async () => {
    const version = ++savedGeneration.current;
    setSavedLoading(true);
    setSavedError(null);
    try {
      const stories: Story[] = [];
      const cursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const response = await client.getSaved({ limit: 20, cursor });
        stories.push(...response.items);
        cursor = response.nextCursor ?? undefined;
        if (cursor && cursors.has(cursor))
          throw new Error("Repeated saved cursor");
        if (cursor) cursors.add(cursor);
      } while (cursor);
      if (version !== savedGeneration.current) return;
      setSavedStories(stories);
      const ids = new Set(stories.map((story) => story.id));
      setFeedback((current) => {
        const next = { ...current };
        for (const [id, value] of Object.entries(next))
          next[id] = { ...value, saved: ids.has(id) };
        for (const story of stories)
          next[story.id] = {
            ...(next[story.id] ?? { reaction: null, busy: false, error: null }),
            saved: true,
          };
        return next;
      });
    } catch {
      if (version === savedGeneration.current)
        setSavedError("目前無法載入收藏，請稍後再試。");
    } finally {
      if (version === savedGeneration.current) setSavedLoading(false);
    }
  }, [client]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void refreshSaved();
    });
    return () => {
      active = false;
      savedGeneration.current += 1;
    };
  }, [refreshSaved]);

  const applyFeedback = useCallback(
    async (
      story: Story,
      action: FeedbackAction | "undo",
      undoEventId?: string,
    ) => {
      if (pendingFeedback.current.has(story.id)) return;
      pendingFeedback.current.add(story.id);
      const sequence = ++feedbackSequence.current;
      const previousRequest = retryFeedback.current.get(story.id);
      const request: FeedbackRequest =
        previousRequest?.action === action &&
        previousRequest.undoEventId === undoEventId
          ? previousRequest
          : {
              testimonyId: story.id,
              action,
              requestId: crypto.randomUUID(),
              ...(undoEventId ? { undoEventId } : {}),
            };
      retryFeedback.current.set(story.id, request);
      setFeedback((current) => ({
        ...current,
        [story.id]: {
          ...(current[story.id] ?? { reaction: null, saved: false }),
          busy: true,
          error: null,
        },
      }));
      try {
        const result = await client.sendFeedback(request);
        if (result.testimonyId !== story.id)
          throw new Error("Mismatched feedback response");
        retryFeedback.current.delete(story.id);
        savedGeneration.current += 1;
        setSavedLoading(false);
        setFeedback((current) => ({
          ...current,
          [story.id]: {
            reaction: result.reaction,
            saved: result.saved,
            busy: false,
            error: null,
          },
        }));
        setSavedStories((current) =>
          result.saved
            ? [story, ...current.filter((item) => item.id !== story.id)]
            : current.filter((item) => item.id !== story.id),
        );
        if (action === "undo") {
          setUndoTarget((current) =>
            current?.story.id === story.id && current.eventId === undoEventId
              ? null
              : current,
          );
        } else if (sequence > latestNoticeSequence.current) {
          latestNoticeSequence.current = sequence;
          setUndoTarget({ story, eventId: result.eventId, action });
        }
      } catch {
        setFeedback((current) => ({
          ...current,
          [story.id]: {
            ...(current[story.id] ?? { reaction: null, saved: false }),
            busy: false,
            error: "無法更新，請再試一次。",
          },
        }));
      } finally {
        pendingFeedback.current.delete(story.id);
      }
    },
    [client],
  );

  const sendFeedback = useCallback(
    (story: Story, action: FeedbackAction) => applyFeedback(story, action),
    [applyFeedback],
  );
  const undoFeedback = useCallback(async () => {
    if (undoTarget)
      await applyFeedback(undoTarget.story, "undo", undoTarget.eventId);
  }, [applyFeedback, undoTarget]);

  const contextValue: FeedSession = {
    ...state,
    loadMore,
    saveOnboarding,
    rememberPosition,
    readPosition,
    lookup,
    recordEvent,
    feedback,
    sendFeedback,
    undoFeedback,
    dismissUndo: () => setUndoTarget(null),
    undoTarget,
    savedStories,
    savedLoading,
    savedError,
    refreshSaved,
    dataSource: configuredDataSource,
  };

  return (
    <FeedSessionContext.Provider value={contextValue}>
      {children}
    </FeedSessionContext.Provider>
  );
}

export function useFeedSession(): FeedSession {
  const context = useContext(FeedSessionContext);
  if (!context) {
    throw new Error("FeedSessionProvider must wrap the feed and story routes");
  }
  return context;
}
