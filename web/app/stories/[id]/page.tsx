import Link from "next/link";
import type { Metadata } from "next";
import { mockStories } from "@/lib/mock-data";
import { StoryReadingView } from "@/components/story-reading-view";

type PageProps = { params: Promise<{ id: string }> };

export function generateStaticParams() {
  return mockStories.map((story) => ({ id: story.id }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const story = mockStories.find((item) => item.id === id);
  return {
    title: story ? `${story.title} · 見證故事` : "見證故事 · 閱讀",
  };
}

export default async function StoryDetailPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <div className="app-shell">
      <header className="feed-header">
        <Link className="feed-wordmark" href="/" aria-label="見證故事，回到動態">
          <span className="wordmark-line" aria-hidden="true" />
          見證故事
        </Link>
        <span className="feed-header-status">故事探索</span>
      </header>
      <StoryReadingView storyId={id} />
    </div>
  );
}
