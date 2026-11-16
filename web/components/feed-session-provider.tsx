"use client";

import {
  createContext,
  useCallback,
  useContext,
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
} from "@/lib/contracts";
import {
  feedEventFor,
  mergeFeedPage,
  type FeedEntry,
} from "@/lib/feed-pagination";

type FeedStatus = "idle" | "loading" | "ready" | "error";
type PreviewReaction = "interested" | "not_for_me" | null;
type PreviewFeedback = { reaction: PreviewReaction; saved: boolean };

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
  previewFeedback: Record<string, PreviewFeedback>;
  updatePreviewFeedback: (id: string, values: Partial<PreviewFeedback>) => void;
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
  const [previewFeedback, setPreviewFeedback] = useState<
    Record<string, PreviewFeedback>
  >({});
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
      setPreviewFeedback({});
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

  const updatePreviewFeedback = useCallback(
    (id: string, values: Partial<PreviewFeedback>) => {
      setPreviewFeedback((current) => ({
        ...current,
        [id]: {
          ...(current[id] ?? { reaction: null, saved: false }),
          ...values,
        },
      }));
    },
    [],
  );

  const contextValue: FeedSession = {
    ...state,
    loadMore,
    saveOnboarding,
    rememberPosition,
    readPosition,
    lookup,
    recordEvent,
    previewFeedback,
    updatePreviewFeedback,
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
