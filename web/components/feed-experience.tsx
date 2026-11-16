"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useFeedSession } from "./feed-session-provider";
import { StoryVisibility } from "./story-visibility";
import { TestimonyCard } from "./ui/testimony-card";
import { FeedbackActions } from "./ui/feedback-actions";
import type { FeedEntry } from "@/lib/feed-pagination";

function FeedContent() {
  const feed = useFeedSession();
  const pathname = usePathname();
  const {
    recordEvent,
    loadMore,
    status,
    hasLoaded,
    readPosition,
    rememberPosition,
    nextCursor,
  } = feed;
  const restoring = useRef(false);
  const loadTrigger = useRef<HTMLDivElement>(null);
  const onImpression = useCallback(
    (entry: FeedEntry) => recordEvent(entry, "impression"),
    [recordEvent],
  );

  useEffect(() => {
    if (status === "idle") void loadMore();
  }, [status, loadMore]);

  // Remember only a numeric viewport offset for a feed -> detail -> feed trip.
  // The provider retains loaded pages while sessionStorage handles page caching
  // and browsers that remount the route on navigation.
  useLayoutEffect(() => {
    if (pathname !== "/" || !hasLoaded) return;
    const stored = window.sessionStorage.getItem(
      "testimony-feed:scroll-position",
    );
    const numeric = stored === null ? NaN : Number(stored);
    const target =
      Number.isFinite(numeric) && numeric > 0 ? numeric : readPosition();
    if (!Number.isFinite(target) || target <= 0) return;

    restoring.current = true;
    const restore = () => window.scrollTo({ top: target, behavior: "instant" });
    restore();
    const frame = window.requestAnimationFrame(restore);
    const retry = window.setTimeout(restore, 80);
    const finish = window.setTimeout(() => {
      restore();
      window.sessionStorage.removeItem("testimony-feed:scroll-position");
      restoring.current = false;
    }, 180);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(retry);
      window.clearTimeout(finish);
      restoring.current = false;
    };
  }, [pathname, hasLoaded, readPosition]);

  useEffect(() => {
    const remember = () => {
      if (!restoring.current) rememberPosition(window.scrollY);
    };
    window.addEventListener("scroll", remember, { passive: true });
    return () => window.removeEventListener("scroll", remember);
  }, [rememberPosition]);

  useEffect(() => {
    const trigger = loadTrigger.current;
    if (!trigger || !nextCursor || status !== "ready") return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && document.visibilityState === "visible") {
          void loadMore();
        }
      },
      { rootMargin: "160px" },
    );
    observer.observe(trigger);
    return () => observer.disconnect();
  }, [loadMore, nextCursor, status]);

  if (
    !feed.hasLoaded &&
    (feed.status === "loading" || feed.status === "idle")
  ) {
    return (
      <div
        className="feed-loading"
        role="status"
        aria-live="polite"
        data-testid="feed-loading"
      >
        <div className="feed-loading-card" aria-hidden="true" />
        <p>正在準備故事…</p>
      </div>
    );
  }

  if (feed.entries.length === 0 && feed.status === "error") {
    return (
      <div className="feed-state" role="alert" data-testid="feed-error">
        <h2>暫時無法取得故事</h2>
        <p>{feed.error}</p>
        <button
          className="ui-button ui-button--primary"
          onClick={() => void feed.loadMore()}
        >
          重試載入
        </button>
      </div>
    );
  }

  if (feed.hasLoaded && feed.entries.length === 0) {
    return (
      <div className="feed-state" data-testid="feed-empty">
        <h2>目前沒有可顯示的故事</h2>
        <p>請稍後再來看看。</p>
      </div>
    );
  }

  return (
    <>
      {feed.safetyState === "support" ? (
        <aside className="feed-support-note" role="status">
          如果你正經歷艱難時刻，除了閱讀故事，也可以尋求身邊可信任的人陪伴與支持。
        </aside>
      ) : null}
      {feed.entries[0]?.feedVariant === "baseline" ? (
        <p className="feed-collection-note">精選故事 · 從這裡開始探索</p>
      ) : null}
      <div className="story-grid" data-testid="story-grid">
        {feed.entries.map((entry, index) => {
          const story = entry.story;
          const selected = feed.previewFeedback[story.id] ?? {
            reaction: null,
            saved: false,
          };
          return (
            <StoryVisibility
              key={story.id}
              entry={entry}
              onImpression={onImpression}
            >
              <TestimonyCard
                story={story}
                number={story.rank || index + 1}
                onOpen={() => {
                  const top = Math.max(0, window.scrollY);
                  feed.rememberPosition(top);
                  window.sessionStorage.setItem(
                    "testimony-feed:scroll-position",
                    String(top),
                  );
                  feed.recordEvent(entry, "open");
                }}
                onExternalOpen={() => feed.recordEvent(entry, "click")}
                actions={
                  feed.isMock ? (
                    <FeedbackActions
                      label={`${story.title}的回饋`}
                      reaction={selected.reaction}
                      saved={selected.saved}
                      onInterested={() =>
                        feed.updatePreviewFeedback(story.id, {
                          reaction:
                            selected.reaction === "interested"
                              ? null
                              : "interested",
                        })
                      }
                      onNotForMe={() =>
                        feed.updatePreviewFeedback(story.id, {
                          reaction:
                            selected.reaction === "not_for_me"
                              ? null
                              : "not_for_me",
                        })
                      }
                      onSave={() =>
                        feed.updatePreviewFeedback(story.id, {
                          saved: !selected.saved,
                        })
                      }
                    />
                  ) : undefined
                }
              />
            </StoryVisibility>
          );
        })}
      </div>
      {feed.isMock ? (
        <p className="feed-disclaimer" role="note">
          開發預覽：所有故事與圖片均為示意，不代表真實見證或來源。互動不會儲存。
        </p>
      ) : null}
      {feed.status === "error" ? (
        <div className="feed-pagination-status" role="alert">
          <p>{feed.error}</p>
          <button
            type="button"
            className="ui-button ui-button--secondary"
            onClick={() => void feed.loadMore()}
          >
            再試一次
          </button>
        </div>
      ) : null}
      {feed.status === "loading" ? (
        <p className="feed-pagination-status" role="status">
          正在載入更多故事…
        </p>
      ) : null}
      {feed.nextCursor && feed.status !== "loading" ? (
        <div className="feed-pagination-status">
          <button
            type="button"
            className="ui-button ui-button--secondary"
            data-testid="load-more"
            onClick={() => void feed.loadMore()}
          >
            載入更多故事
          </button>
        </div>
      ) : null}
      <div
        ref={loadTrigger}
        className="feed-load-sentinel"
        aria-hidden="true"
      />
      {feed.hasLoaded && !feed.nextCursor && feed.status === "ready" ? (
        <p className="feed-end-note">已顯示目前所有故事</p>
      ) : null}
    </>
  );
}

export function FeedExperience() {
  return <FeedContent />;
}
