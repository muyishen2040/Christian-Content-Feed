import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { mockStories } from "@/lib/mock-data";
import { mockArticleParagraphs } from "@/data/mock-articles";

type PageProps = { params: Promise<{ id: string }> };

export function generateStaticParams() {
  return mockStories.map((story) => ({ id: story.id }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const story = mockStories.find((item) => item.id === id);
  return { title: story ? `${story.title} · 見證故事` : "找不到故事 · 見證故事" };
}

export default async function StoryDetailPage({ params }: PageProps) {
  const { id } = await params;
  const story = mockStories.find((item) => item.id === id);
  if (!story) notFound();
  const scene = mockStories.findIndex((item) => item.id === id) % 4;
  const paragraphs = mockArticleParagraphs[id] ?? [];

  return (
    <div className="app-shell">
      <header className="feed-header">
        <Link className="feed-wordmark" href="/" aria-label="見證故事，回到動態">
          <span className="wordmark-line" aria-hidden="true" />
          見證故事
        </Link>
        <span className="feed-header-status">故事探索 · 示意版</span>
      </header>
      <main className="article-layout">
        <Link href="/" className="article-back">← 返回故事</Link>
        <div className={`article-cover story-cover--${scene}`} role="img"
          aria-label="示意氛圍圖片，非故事人物或場景照片">
          <span className="article-cover-label">示意影像 · 非真實見證照片</span>
        </div>
        <article className="article-content">
          <p className="article-eyebrow">生命故事　·　虛構示例</p>
          <h1 className="article-title">{story.title}</h1>
          <p className="article-lead">{story.summary}</p>
          <div className="article-rule" aria-hidden="true" />
          {paragraphs.map((paragraph, i) => <p key={i} className="article-paragraph">{paragraph}</p>)}
          <aside className="article-notice">
            這篇是為展示閱讀介面而撰寫的虛構內容，非真實人物見證。
            正式版僅呈現已確認使用權的內容，並提供原始來源。
          </aside>
          {story.sourceUrl ? (
            <a className="article-original" href={story.sourceUrl} target="_blank" rel="noopener noreferrer">
              閱讀原始來源 ↗
            </a>
          ) : <p className="article-source">目前沒有真實來源連結</p>}
        </article>
        <Link href="/" className="article-back article-back--bottom">← 繼續探索故事</Link>
      </main>
    </div>
  );
}
