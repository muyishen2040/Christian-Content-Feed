"use client";

import { Bookmark, ThumbsDown, ThumbsUp } from "lucide-react";

type Reaction = "interested" | "not_for_me" | null;
type FeedbackActionsProps = {
  reaction: Reaction;
  saved: boolean;
  onInterested: () => void;
  onNotForMe: () => void;
  onSave: () => void;
  busy?: boolean;
  label?: string;
};

export function FeedbackActions({
  reaction,
  saved,
  onInterested,
  onNotForMe,
  onSave,
  busy = false,
  label = "故事回饋",
}: FeedbackActionsProps) {
  return (
    <div
      role="group"
      aria-label={label}
      aria-busy={busy}
      className="feedback-group"
    >
      <button
        type="button"
        className="feedback-action"
        aria-pressed={reaction === "interested"}
        aria-label="感興趣"
        title="感興趣"
        disabled={busy || reaction === "interested"}
        onClick={onInterested}
      >
        <ThumbsUp size={18} strokeWidth={1.5} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="feedback-action"
        aria-pressed={reaction === "not_for_me"}
        aria-label="不適合我"
        title="不適合我"
        disabled={busy || reaction === "not_for_me"}
        onClick={onNotForMe}
      >
        <ThumbsDown size={18} strokeWidth={1.5} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="feedback-action"
        aria-pressed={saved}
        aria-label={saved ? "已收藏" : "收藏"}
        title={saved ? "取消收藏" : "收藏"}
        disabled={busy}
        onClick={onSave}
      >
        <Bookmark
          size={18}
          strokeWidth={1.5}
          fill={saved ? "currentColor" : "none"}
          aria-hidden="true"
        />
      </button>
      {busy ? (
        <span className="visually-hidden" role="status">
          正在更新
        </span>
      ) : null}
    </div>
  );
}
