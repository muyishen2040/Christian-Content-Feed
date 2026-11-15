# MUY-35 · Mobile design direction

## Five-line direction

- **Product:** A Traditional Chinese mobile reading experience for discovering source-attributed Christian testimonies related to life's difficulties and hopes.
- **Character:** Quiet, thoughtful, human.
- **World:** A personal reading journal — paper, ink, generous margins, and small chapter marks.
- **Moment:** The story title and original editorial summary appear on an atmospheric image card; no homepage or promotional hero blocks the feed.
- **Signature:** A restrained moss editorial rule beside the wordmark, plus simple chapter numbers inside the cover.

## Tokens, behavior and usage

| Role | Token | Value |
| --- | --- | --- |
| Page paper | `--ui-bg` | `#f7f5f0` |
| Raised paper | `--ui-surface` | `#fffdf9` |
| Ink | `--ui-text` | `#242923` |
| Secondary text | `--ui-text-secondary` | `#515a51` |
| Hairline | `--ui-border` | `#d9ded3` |
| Moss action | `--ui-accent` | `#3b5d49` |
| Focus | `--ui-focus` | `#3b5d49`, 3px outline |
| Body | `--ui-font-body` | Local system / Noto Sans TC fallbacks |
| Display | `--ui-font-display` | Chiron Sung HK / Noto Serif TC fallbacks |
| Spacing | 4px rhythm | 8 / 12 / 16 / 20 / 24 / 32 / 48 / 72 |
| Button | `--ui-radius-button` | 10px, 48px minimum height |
| Card | `--ui-radius-card` | 16px, 20–24px padding |
| Feedback | `.feedback-action` | 44px minimum height, `aria-pressed` |
| Motion | `--ui-motion` | 160ms neutral transitions |

Tailwind 4 maps the design variables into the theme (`bg-paper`, `text-ink`, `text-moss`, `font-display`). All pages should reuse these rather than introducing one-off colors.

Typography: 36–62px responsive display headline, 26–36px section titles, ~23px story titles, 15–17px body text, 12–13px factual metadata only. Keep long Traditional Chinese prose legible at 1.7–1.9 line height. Do not use narrow columns for full stories or justify every line.

The *story content* carries the hierarchy. For the demonstration feed each card uses atmospheric stock photography as a clearly marked **illustrative background**, with a high-contrast scrim and the story title/summary overlaid. This photography does not depict the subject or events of a real testimony. Before any production feed, use only approved publisher thumbnails or correctly licensed generic artwork, and retain stable text-only fallback cards. No forced autoplay, stock-photo testimony portraits posing as real people, or invented publisher identity. `sourceUrl=null` is allowed for clearly fictional mock records only; real stories must have a verifiable original URL.

Mobile-first: page gutters 16px on <=420px phones, 20px otherwise; one-column vertical feed at all sizes (max 620px) to emphasize reading rather than a homepage grid. Controls have 44–48px tap targets. Native Chinese text wrapping should not create horizontal scrolling at 320px/375px/768px/1440px. Keyboard focus is visible on links, inputs, and buttons; selected feedback uses `aria-pressed`, not color alone. Avoid animation for visitors requesting reduced motion.

## Components

- `Button` / `ButtonLink`: primary, secondary, quiet; proper semantics instead of clickable divs.
- `TextField`: bound label, hint/error via `aria-describedby`, invalid state and focus.
- `Eyebrow`, `SectionTitle`: restrained typographic hierarchy.
- `TestimonyCard`: full image-backed preview linking to an internal detail page. In this design-demo only, photos are illustrative and do not assert publisher ownership.
- `/stories/[id]`: fictional article preview with a return-to-feed link and no fabricated original-source action. Real story display rights and external links belong to MUY-37.
- `FeedbackActions`: accessible toggle state and names, caller owns behavior.
- `PreviewExperience`: **local-only illustrative state**; FE-02–04 must replace with real API interactions.

## Unslop / layout review

The original `web/app/page.tsx` was a functional but generic stack: a centered heading, repeated equal white cards, and little reading hierarchy. It had no fake hype or decorative images; the audit calls this **light slop**, not a broken UI. Read the real page in a browser and compare at phone and desktop widths; screenshots from the Playwright layout workflow are attached to the CI run where available.

Nine-pass changes:
1. **Spacing:** consistent 4px rhythm; quiet header; more room around story titles.
2. **Color:** warm paper neutrals and one moss accent, no gradients.
3. **Icons:** no unnecessary icons or emoji; chapter line is geometric and understated.
4. **Copy:** preserve the existing headline and explain that all sample stories are fictional.
5. **Type:** serif display only for reading-level headings, accessible body copy for the rest.
6. **Layout:** asymmetrical hero and text-first responsive card grid; one column on phones.
7. **Details:** subtle hairlines, nested radii, no neon or decorative badges.
8. **Visuals:** no fake testimony images or stock portraits without source permission.
9. **Motion:** subtle color transitions, disabled for reduced-motion preferences.

### Audit decisions / remaining review gate

- Current site is a **design showcase**, not a complete onboarding/feed. The mock interaction state is browser memory only and cannot be mistaken for saved preferences.
- Before merging: inspect actual before/after screenshots from CI; confirm no horizontal overflow at phone/desktop widths, legible Chinese line breaks, focus indicator, and tap targets. Keep any visual findings or follow-up notes in the PR.
- After merging: FE-02 and FE-03 should reuse the components and tokens. Do not infer rights or source thumbnails from mock data.

## Skill attribution

The adapted Unslop skill in `web/.agents/skills/unslop/` is based on [Unslop by Damir Sokolovsky](https://github.com/heydamir/unslop), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). See the local `NOTICE.md` for source, modifications, and attribution.

## Feed-first product navigation (November 2026 revision)

- Root `/` is the feed itself; there is no separate marketing homepage.
- Tapping a card navigates to `/stories/[id]`, a demo article layout. A clear return link leads to the feed. The real feed must additionally preserve scroll position, fetch paginated recommendations, and link to approved originals under MUY-37.
- The example article text is fully fictional, written specifically as UI fixture copy. Never present it as a Christian witness's actual testimony.

## Traditional Chinese font survey

| Family | Style | Decision |
| --- | --- | --- |
| **Chiron Sung HK (昭源宋體)** | Refined, balanced serif for Traditional Chinese | **Selected** for card and article titles and longer article passages, with Noto Serif TC fallback; SIL OFL 1.1 |
| **Noto Sans TC** | Legible neutral sans; native traditional glyphs | **Selected** for navigation, controls and supporting text; SIL OFL |
| LXGW WenKai TC (霞鶩文楷) | Friendly handwritten Kai style | Good accent option, not selected for dense UI |
| Iansui (芫荽) | Distinctly Taiwanese handwriting style | Too playful for full reading interface; accent only |

The selected Google Fonts styles are fetched as a CSS webfont with `display=swap` and system fallbacks. Test actual network/performance and Taiwan/HK glyph preferences on physical phones before launch; optimize font subsets or self-host later if third-party font requests are undesirable. Do not commit third-party font binaries without checking licenses.

Research: https://github.com/chiron-fonts/chiron-sung-hk, https://notofonts.github.io/noto-docs/website/use/, https://github.com/lxgw/LxgwWenkaiTC, https://github.com/ButTaiwan/iansui.

## Illustrative photo credits (demo only)

The four CSS backgrounds in `web/app/globals.css` are fetched from Pexels. They are **not** source content, person portraits, or evidence that the fictional testimony happened. They are visibly marked `示意影像`. License terms and availability should be rechecked for redistribution, and these externally loaded photos should be replaced with local/approved assets prior to release.

1. [Ivett M — Warm Sunset Through Sheer Window Curtains](https://www.pexels.com/photo/warm-sunset-through-sheer-window-curtains-40735592/)
2. [Diogo Miranda — Serene Mountain Sunrise with Misty Valleys](https://www.pexels.com/photo/serene-mountain-sunrise-with-misty-valleys-30322590/)
3. [Sergej — Tranquil Forest Pathway in Summer Sunlight](https://www.pexels.com/photo/tranquil-forest-pathway-in-summer-sunlight-33314069/)
4. [Ty Nguyễn — Sunlight Reflecting on Ocean Waves](https://www.pexels.com/photo/sunlight-reflecting-on-ocean-waves-32039473/)

Images are decorative CSS backgrounds and are not announced by screen readers; the meaningful story text is available separately in the markup. The scrim ensures white text remains readable. Actual thumbnails must be permission-reviewed; fallback to stable text-only styles when missing.
