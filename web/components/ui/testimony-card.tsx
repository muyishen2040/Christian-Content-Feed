import Link from "next/link";
import type { ReactNode } from "react";
import type { Story } from "@/lib/contracts";

type TestimonyCardProps = {
  story: Story;
  number?: number;
  actions?: ReactNode;
};

export function TestimonyCard({ story, number = 1, actions }: TestimonyCardProps) {
  const scene = (number - 1) % 4;
  return (
    <article className="story-card story-card--image" data-testid="testimony-card">
      <Link
        href={`/stories/${story.id}`}
        className={`story-cover story-cover--${scene}`}
        aria-label={`閱讀故事：${story.title}`}
        data-testid="story-open"
      >
        <span className="story-cover-top">
          <span className="story-cover-chapter">{String(number).padStart(2, "0")} / 故事</span>
          <span className="story-cover-demo">示意影像</span>
        </span>
        <span className="story-cover-copy">
          <span className="story-cover-source">{story.sourceName}</span>
          <span className="story-cover-title">{story.title}</span>
          <span className="story-cover-description">{story.summary}</span>
          <span className="story-cover-read">閱讀這段故事 <span aria-hidden="true">↗</span></span>
        </span>
      </Link>
      {actions ? <div className="story-feedback">{actions}</div> : null}
    </article>
  );
}
