import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Christian Content Feed · 開發預覽",
  description: "見證故事探索應用的開發預覽",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
