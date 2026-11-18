"use client";

import Link from "next/link";
import { useFeedSession } from "./feed-session-provider";
import { TestimonyCard } from "./ui/testimony-card";
import { FeedbackActions } from "./ui/feedback-actions";

export function SavedExperience() {
  const feed = useFeedSession();
  if (feed.savedLoading)
    return (
      <p className="feed-state" role="status">
        正在載入收藏…
      </p>
    );
  if (feed.savedError)
    return (
      <div className="feed-state" role="alert">
        <p>{feed.savedError}</p>
        <button
          className="ui-button ui-button--secondary"
          onClick={() => void feed.refreshSaved()}
        >
          重試
        </button>
      </div>
    );
  if (!feed.savedStories.length)
    return (
      <div className="feed-state">
        <h2>還沒有收藏的故事</h2>
        <p>遇到想再讀的故事時，可以點選書籤。</p>
        <Link className="ui-button ui-button--primary" href="/">
          探索故事
        </Link>
      </div>
    );
  return (
    <>
      <div className="story-grid" data-testid="saved-grid">
        {feed.savedStories.map((story, index) => {
          const state = feed.feedback[story.id] ?? {
            reaction: null,
            saved: true,
            busy: false,
            error: null,
          };
          return (
            <TestimonyCard
              key={story.id}
              story={story}
              number={index + 1}
              actions={
                <>
                  <FeedbackActions
                    label={`${story.title}的回饋`}
                    reaction={state.reaction}
                    saved={state.saved}
                    busy={state.busy}
                    onInterested={() =>
                      void feed.sendFeedback(story, "interested")
                    }
                    onNotForMe={() =>
                      void feed.sendFeedback(story, "not_for_me")
                    }
                    onSave={() =>
                      void feed.sendFeedback(
                        story,
                        state.saved ? "unsave" : "save",
                      )
                    }
                  />
                  {state.error ? (
                    <p className="feedback-error" role="alert">
                      {state.error}
                    </p>
                  ) : null}
                </>
              }
            />
          );
        })}
      </div>
      {feed.dataSource === "mock" ? (
        <p className="feed-disclaimer">開發預覽：收藏僅保留於本次瀏覽。</p>
      ) : null}
    </>
  );
}
