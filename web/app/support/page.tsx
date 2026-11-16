import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "即時支持 · 見證故事",
  description: "尋求即時協助並繼續安全地探索故事",
};

export default function SupportPage() {
  return (
    <div className="app-shell">
      <header className="feed-header">
        <Link
          className="feed-wordmark"
          href="/"
          aria-label="見證故事，回到動態"
        >
          <span className="wordmark-line" aria-hidden="true" />
          見證故事
        </Link>
        <span className="feed-header-status">關心與支持</span>
      </header>
      <main className="support-layout">
        <p className="onboarding-kicker">你不必獨自面對</p>
        <h1>需要有人陪你走過此刻嗎？</h1>
        <p>
          如果你正面臨很難受的情況，可以先找一位信任的人談談，
          或聯繫所在地的心理健康與危機支援服務。
        </p>
        <p>若你或其他人正處於立即危險中，請立即聯繫當地的緊急服務。</p>
        <div className="support-action-row">
          <Link href="/" className="ui-button ui-button--primary">
            先看看故事
          </Link>
          <Link href="/personalize" className="ui-button ui-button--quiet">
            返回設定
          </Link>
        </div>
        <p className="support-disclosure">
          此頁提供一般性支持資訊，並不能取代專業或緊急協助。
          依地區提供的具體支援資源仍在開發中。
        </p>
      </main>
    </div>
  );
}
