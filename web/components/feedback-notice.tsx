"use client";

import { useFeedSession } from "./feed-session-provider";
import { X } from "lucide-react";

export function FeedbackNotice() {
  const { undoTarget, undoFeedback, dismissUndo, feedback } = useFeedSession();
  if (!undoTarget) return null;
  const { story, action } = undoTarget;
  const state = feedback[story.id];
  const message =
    action === "not_for_me"
      ? "已隱藏這則故事"
      : action === "save"
        ? "已加入收藏"
        : action === "unsave"
          ? "已移除收藏"
          : "已記下你的喜好";
  return (
    <div className="feedback-notice" role="status" aria-live="polite">
      <span>{state?.error ?? message}</span>
      <button
        type="button"
        disabled={state?.busy}
        onClick={() => void undoFeedback()}
      >
        復原
      </button>
      <button
        type="button"
        className="feedback-notice-close"
        aria-label="關閉通知"
        onClick={dismissUndo}
      >
        <X size={18} strokeWidth={1.5} aria-hidden="true" />
      </button>
    </div>
  );
}
