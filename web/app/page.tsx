import Link from "next/link";
import { FeedExperience } from "@/components/feed-experience";

export default function FeedPage() {
  return (
    <div className="app-shell">
      <header className="feed-header">
        <Link className="feed-wordmark" href="/" aria-label="見證故事，探索動態">
          <span className="wordmark-line" aria-hidden="true" />
          見證故事
        </Link>
        <span className="feed-header-status">故事探索</span>
      </header>
      <main id="feed" className="feed-layout">
        <div className="feed-intro">
          <p className="feed-kicker">在生活裡，遇見不一樣的光</p>
          <h1 className="feed-heading">為你挑選的故事</h1>
          <p className="feed-subtitle">滑動看看，哪個故事陪你走一段路</p>
        </div>
        <FeedExperience />
      </main>
    </div>
  );
}
