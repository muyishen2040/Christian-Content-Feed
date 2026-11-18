import Link from "next/link";
import type { Metadata } from "next";
import { SavedExperience } from "@/components/saved-experience";

export const metadata: Metadata = { title: "我的收藏 · 見證故事" };

export default function SavedPage() {
  return (
    <div className="app-shell">
      <header className="feed-header">
        <Link
          href="/"
          className="feed-wordmark"
          aria-label="見證故事，回到動態"
        >
          <span className="wordmark-line" aria-hidden="true" />
          見證故事
        </Link>
        <Link className="feed-settings-link" href="/personalize">
          調整推薦
        </Link>
      </header>
      <main className="feed-layout">
        <Link href="/" className="article-back">
          ← 返回故事
        </Link>
        <div className="feed-intro">
          <p className="feed-kicker">留下想再讀的故事</p>
          <h1 className="feed-heading">我的收藏</h1>
          <p className="feed-subtitle">在這裡，慢慢重溫陪伴過你的故事</p>
        </div>
        <SavedExperience />
      </main>
    </div>
  );
}
