import Link from "next/link";
import { FeedExperience } from "@/components/feed-experience";
import { WelcomePrompt } from "@/components/welcome-prompt";

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
        <nav className="feed-nav" aria-label="主要導覽">
          <Link className="feed-settings-link" href="/saved">
            我的收藏
          </Link>
          <Link className="feed-settings-link" href="/personalize">
            調整推薦
          </Link>
        </nav>
      </header>
      <main id="feed" className="feed-layout">
        <div className="feed-intro">
          <p className="feed-kicker">在生活裡，遇見不一樣的光</p>
          <h1 className="feed-heading">為你挑選的故事</h1>
          <p className="feed-subtitle">滑動看看，哪個故事陪你走一段路</p>
        </div>
        <WelcomePrompt />
        <FeedExperience />
        <footer className="feed-help-footer">
          <Link href="/support">現在需要幫助？</Link>
        </footer>
      </main>
    </div>
  );
}
