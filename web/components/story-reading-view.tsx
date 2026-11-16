"use client";

import Link from "next/link";
import { useFeedSession } from "./feed-session-provider";
import { mockStories } from "@/lib/mock-data";
import { mockArticleParagraphs } from "@/data/mock-articles";
import { storyVisual } from "@/lib/story-visual";

export function StoryReadingView({ storyId }: { storyId: string }) {
  const session = useFeedSession();
  const entry = session.lookup(storyId);
  const story =
    entry?.story ??
    (session.dataSource === "mock"
      ? mockStories.find((item) => item.id === storyId)
      : undefined);

  if (!story) {
    return (
      <main className="article-layout">
        <Link href="/" className="article-back">← 返回故事</Link>
        <div className="feed-state" role="status">
          <h1>無法載入這則故事</h1>
          <p>目前沒有這則故事的完整資料。請回到動態重新開啟。</p>
          <Link className="ui-button ui-button--primary" href="/">返回故事動態</Link>
        </div>
      </main>
    );
  }

  const rank = entry?.story.rank ?? mockStories.findIndex((item) => item.id === storyId) + 1;
  const visual = storyVisual(story, Math.max(1, rank));
  const paragraphs =
    story.isMock ? mockArticleParagraphs[story.id] ?? [] : [];

  return (
    <main className="article-layout">
      <Link href="/" className="article-back">← 返回故事</Link>
      <div
        className={`article-cover ${visual.className}`}
        style={visual.backgroundImage ? { backgroundImage: visual.backgroundImage } : undefined}
        role="img"
        aria-label={visual.hasImage ? "故事氣氛示意圖片，非見證人物或場景的實況照" : "文字閱讀封面"}
      >
        {visual.hasImage && <span className="article-cover-label">示意影像 · 非見證實況</span>}
      </div>
      <article className="article-content">
        <p className="article-eyebrow">
          {story.isMock ? "生命故事　·　虛構示例" : `生命故事　·　${story.sourceName}`}
        </p>
        <h1 className="article-title">{story.title}</h1>
        <p className="article-lead">{story.summary}</p>
        <div className="article-rule" aria-hidden="true" />
        {paragraphs.map((paragraph, index) => (
          <p key={index} className="article-paragraph">{paragraph}</p>
        ))}
        {story.isMock ? (
          <aside className="article-notice">
            這篇是為展示閱讀介面而撰寫的虛構內容，非真實人物見證。
            正式版僅呈現已確認使用權的內容，並提供原始來源。
          </aside>
        ) : (
          <p className="article-source">
            本頁僅提供經審核的摘要。請前往原始網站閱讀完整見證。
          </p>
        )}
        {story.sourceUrl ? (
          <a
            className="article-original"
            href={story.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => { if (entry) session.recordEvent(entry, "click"); }}
          >
            前往原始見證 ↗
          </a>
        ) : (
          <p className="article-source">目前沒有真實來源連結</p>
        )}
      </article>
      <Link href="/" className="article-back article-back--bottom">
        ← 繼續探索故事
      </Link>
    </main>
  );
}
