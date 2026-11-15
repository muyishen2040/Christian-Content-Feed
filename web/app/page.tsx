import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Eyebrow, SectionTitle } from "@/components/ui/typography";
import { PreviewExperience } from "@/components/preview-experience";
import { mockStories } from "@/lib/mock-data";

export default function Home() {
  return (
    <main className="page-frame">
      <header className="site-header">
        <Link
          className="site-wordmark"
          href="/"
          aria-label="見證故事，回到首頁"
        >
          <span className="wordmark-line" aria-hidden="true" />
          見證故事
        </Link>
        <span className="site-header-note">介面展示版本</span>
      </header>

      <section className="hero-grid" aria-labelledby="home-title">
        <div className="hero-copy">
          <Eyebrow>在不同的人生片刻，讀見一點光</Eyebrow>
          <h1 id="home-title" className="hero-title">
            故事，
            <br />
            陪你走一段路
          </h1>
          <p className="hero-description">
            每個人的經歷都不相同。有時候，一段真實的生命故事，
            會陪我們重新看見盼望。
          </p>
          <div className="hero-actions">
            <ButtonLink href="#stories">看看示意故事</ButtonLink>
            <ButtonLink href="#preview-note" variant="secondary">
              關於這個展示
            </ButtonLink>
          </div>
        </div>
        <aside className="hero-note" aria-label="設計理念">
          <span className="hero-note-index">一段話 · 一段路</span>
          <p className="hero-note-quote">
            不急著尋找答案，
            <br />
            先從一個故事開始。
          </p>
          <p className="hero-note-footer">
            讓文字留一點空間，也讓讀的人慢慢往前走
          </p>
        </aside>
      </section>

      <section id="stories" aria-labelledby="stories-title">
        <div className="section-header">
          <div>
            <Eyebrow>故事預覽</Eyebrow>
            <SectionTitle id="stories-title">從這裡開始閱讀</SectionTitle>
          </div>
          <p className="section-note">
            示例內容只用於展示排版與互動，不代表已獲授權的真實故事
          </p>
        </div>
        <PreviewExperience stories={mockStories.slice(0, 4)} />
      </section>

      <aside
        id="preview-note"
        className="preview-disclaimer"
        style={{ marginTop: 32 }}
      >
        <strong>開發預覽：</strong> 所有故事、來源名稱及互動都是虛構測試資料。
        點選「感興趣」或「收藏」只會暫時改變畫面，不會儲存資料。
        正式版將顯示經來源確認、具原始出處的見證。
      </aside>

      <footer className="site-footer">
        Christian Content Feed · 介面開發展示
      </footer>
    </main>
  );
}
