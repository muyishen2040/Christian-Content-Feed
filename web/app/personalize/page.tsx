import Link from "next/link";
import type { Metadata } from "next";
import { OnboardingForm } from "@/components/onboarding-form";

export const metadata: Metadata = {
  title: "個人化故事推薦 · 見證故事",
  description: "自願分享近況，或略過設定直接探索見證故事",
};

export default function PersonalizePage() {
  return (
    <div className="app-shell">
      <header className="feed-header">
        <Link className="feed-wordmark" href="/" aria-label="見證故事，回到動態">
          <span className="wordmark-line" aria-hidden="true" />
          見證故事
        </Link>
        <span className="feed-header-status">個人化探索</span>
      </header>
      <main className="onboarding-layout">
        <Link href="/" className="article-back">← 返回故事</Link>
        <OnboardingForm />
      </main>
    </div>
  );
}
