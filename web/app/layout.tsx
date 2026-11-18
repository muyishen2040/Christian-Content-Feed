import type { Metadata } from "next";
import { FeedSessionProvider } from "@/components/feed-session-provider";
import { FeedbackNotice } from "@/components/feedback-notice";
import "./globals.css";

export const metadata: Metadata = {
  title: "見證故事 · 開發預覽",
  description: "繁體中文基督徒見證故事探索",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-Hant">
      <body>
        <FeedSessionProvider>
          {children}
          <FeedbackNotice />
        </FeedSessionProvider>
      </body>
    </html>
  );
}
