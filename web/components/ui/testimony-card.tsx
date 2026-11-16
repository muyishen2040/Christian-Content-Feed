import Link from "next/link";
import type { ReactNode } from "react";
import type { Story } from "@/lib/contracts";
import { storyVisual } from "@/lib/story-visual";

type TestimonyCardProps = {
  story: Story;
  number?: number;
  actions?: ReactNode;
  onOpen?: () => void;
  onExternalOpen?: () => void;
};

export function TestimonyCard({
  story,
  number = 1,
  actions,
  onOpen,
  onExternalOpen,
}: TestimonyCardProps) {
  const visual = storyVisual(story, number);
  return (
    <article
      className="story-card story-card--image"
      data-testid="testimony-card"
    >
      <Link
        href={`/stories/${story.id}`}
        className={`story-cover ${visual.className}`}
        style={
          visual.backgroundImage
            ? { backgroundImage: visual.backgroundImage }
            : undefined
        }
        onClick={onOpen}
        aria-label={`閱讀故事：${story.title}`}
        data-testid="story-open"
      >
        <span className="story-cover-top">
          <span className="story-cover-chapter">
            {String(number).padStart(2, "0")} / 見證
          </span>
          {story.isMock ? (
            <span className="story-cover-demo">示意影像</span>
          ) : visual.hasImage ? (
            <span className="story-cover-demo">授權封面</span>
          ) : (
            <span className="story-cover-demo">純文字封面</span>
          )}
        </span>
        <span className="story-cover-copy">
          <span className="story-cover-source">
            {story.sourceName} · 見證故事
          </span>
          <span className="story-cover-title">{story.title}</span>
          <span className="story-cover-description">{story.summary}</span>
          <span className="story-cover-read">
            閱讀故事摘要 <span aria-hidden="true">↗</span>
          </span>
        </span>
      </Link>
      <div className="story-original-actions">
        {story.sourceUrl ? (
          <a
            href={story.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onExternalOpen}
            aria-label={`前往原始見證：${story.title}`}
          >
            前往原始見證 ↗
          </a>
        ) : (
          <span>示意故事，無原始來源</span>
        )}
        <span>
          {story.contentType === "testimony" ? "文章" : story.contentType}
        </span>
      </div>
      {actions ? <div className="story-feedback">{actions}</div> : null}
    </article>
  );
}
