import Link from "next/link";
import { PreviewExperience } from "@/components/preview-experience";
import { mockStories } from "@/lib/mock-data";

export default function FeedPage() {
  return (
    <div className="app-shell">
      <header className="feed-header">
        <Link
          className="feed-wordmark"
          href="/"
          aria-label="見證故事，探索動態"
        >
          <span className="wordmark-line" aria-hidden="true" />
          見證故事
        </Link>
        <span className="feed-header-status">故事探索 · 示意版</span>
      </header>
      <main id="feed" className="feed-layout">
        <div className="feed-intro">
          <p className="feed-kicker">在生活裡，遇見不一樣的光</p>
          <h1 className="feed-heading">為你挑選的故事</h1>
          <p className="feed-subtitle">滑動看看，哪個故事陪你走一段路</p>
        </div>
        <PreviewExperience stories={mockStories.slice(0, 4)} />
        <p className="feed-disclaimer" role="note">
          開發預覽：所有故事與圖片均為示意，不代表真實見證或來源。互動不會儲存。
        </p>
      </main>
    </div>
  );
}
