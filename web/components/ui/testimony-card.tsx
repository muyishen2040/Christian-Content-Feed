import type { ReactNode } from "react";
import type { Story } from "@/lib/contracts";

type TestimonyCardProps = {
  story: Story;
  number?: number;
  actions?: ReactNode;
};

export function TestimonyCard({ story, number, actions }: TestimonyCardProps) {
  return (
    <article className="story-card" data-testid="testimony-card">
      <div className="story-card-meta">
        {number !== undefined && (
          <span className="story-number">
            {String(number).padStart(2, "0")}
          </span>
        )}
        <span>{story.sourceName}</span>
        <span aria-hidden="true">·</span>
        <span>見證故事</span>
      </div>
      <div>
        <h3 className="story-title">{story.title}</h3>
        <p className="story-summary">{story.summary}</p>
      </div>
      {actions}
      <div className="story-card-footer">
        <span className="mock-label">
          {story.isMock ? "此內容為虛構示例" : "原始來源"}
        </span>
        {story.sourceUrl ? (
          <a
            className="source-link"
            href={story.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`前往原始故事：${story.title}`}
          >
            閱讀原文
          </a>
        ) : (
          <span className="mock-label">尚無原文連結</span>
        )}
      </div>
    </article>
  );
}
