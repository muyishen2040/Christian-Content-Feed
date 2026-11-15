"use client";

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
  reaction, saved, onInterested, onNotForMe, onSave, busy = false,
  label = "故事回饋",
}: FeedbackActionsProps) {
  return (
    <div role="group" aria-label={label} className="feedback-group">
      <button type="button" className="feedback-action" aria-pressed={reaction === "interested"}
        disabled={busy} onClick={onInterested}>
        感興趣
      </button>
      <button type="button" className="feedback-action" aria-pressed={reaction === "not_for_me"}
        disabled={busy} onClick={onNotForMe}>
        不適合我
      </button>
      <button type="button" className="feedback-action" aria-pressed={saved}
        disabled={busy} onClick={onSave}>
        {saved ? "已收藏" : "收藏"}
      </button>
    </div>
  );
}
