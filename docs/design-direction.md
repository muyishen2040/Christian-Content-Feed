# Feed-first visual design and implementation guide

## Product and scope

Christian Content Feed is a Traditional Chinese reading and discovery interface for Christian personal testimonies. Visitors should be able to browse story previews, open an individual story, and eventually follow an attributed link to the original publisher. The interface emphasizes calm, readable content rather than video autoplay or a marketing landing page.

This document describes the **frontend design system and its current demonstration**. It is not a claim that the site has a working personalized recommendation backend, published testimony catalog, persistent Saved collection, or production rights clearance.

### Design direction

- **Product:** A mobile-first discovery feed for source-attributed, Traditional Chinese testimonies.
- **Character:** Quiet, warm, thoughtful, and human.
- **Visual metaphor:** Reading journal — paper, dark ink, generous space, and small chapter markers.
- **Primary focus:** A compelling story title and short editorial summary over an illustrative image.
- **Recognizable detail:** A restrained moss-green line at the wordmark, repeated through functional accents.

The application opens directly to the feed at `/`. An image card links to `/stories/[id]`, a readable article-detail demonstration with a return link. There is deliberately no separate promotional homepage.

## What is implemented

| Location | Responsibility |
| --- | --- |
| `web/app/page.tsx` | Feed entry point, header, introductory copy, four fictional examples, and a disclosure |
| `web/app/stories/[id]/page.tsx` | Individual story preview with simulated article content, attribution state, and return navigation |
| `web/components/ui/testimony-card.tsx` | Image-led story preview with accessible detail-page navigation |
| `web/components/ui/feedback-actions.tsx` | Accessible Interested / Not for me / Saved toggle controls |
| `web/components/preview-experience.tsx` | In-memory feedback state for visual demonstrations only |
| `web/components/ui/button.tsx`, `field.tsx`, `typography.tsx` | Shared buttons, labels, inputs, and type hierarchy |
| `web/data/mock-articles.ts`, `web/lib/mock-data.ts` | Entirely fictional testing and preview content |
| `web/app/globals.css` | Visual tokens, responsive layout, image backgrounds, and interaction states |

The current feedback buttons only change React component state. They do not save data across refreshes or affect ranking. The detail route renders original fictional fixture paragraphs, not a copied article. There is no source URL for the fictional examples.

## Design tokens

The CSS custom properties in `web/app/globals.css` are the source of truth. Tailwind v4 aliases are declared through `@theme inline`.

| Role | CSS token | Value / use |
| --- | --- | --- |
| Page background | `--ui-bg` | `#f7f5f0`, warm paper |
| Card / surface | `--ui-surface` | `#fffdf9` |
| Primary ink | `--ui-text` | `#242923` |
| Secondary ink | `--ui-text-secondary` | `#515a51` |
| Hairline | `--ui-border` | `#d9ded3` |
| Action accent | `--ui-accent` | `#3b5d49`, muted moss |
| Keyboard focus | `--ui-focus` | `#3b5d49`, 3px outline |
| Body font | `--ui-font-body` | Noto Sans TC, system Chinese sans-serif fallbacks |
| Display font | `--ui-font-display` | Chiron Sung HK, serif fallbacks |
| Button radius | `--ui-radius-button` | 10px |
| Card radius | `--ui-radius-card` | 16px |
| Motion | `--ui-motion` | 160ms; reduced-motion preference overrides it |

Use shared tokens and components rather than adding arbitrary page-specific colors, font families, or interaction patterns.

### Traditional Chinese font selection

| Typeface | Character | Intended use |
| --- | --- | --- |
| **Chiron Sung HK (昭源宋體)** | Editorial Traditional Chinese serif | Card titles, article headings, and article paragraphs |
| **Noto Sans TC** | Clear, neutral Traditional Chinese sans | Navigation, buttons, notices, and metadata |
| LXGW WenKai TC (霞鶩文楷) | Informal, handwritten Kai | Consider only for occasional display accents |
| Iansui (芫荽) | Expressive handwriting style | Consider only for limited decorative accents |

The implemented CSS requests Chiron Sung HK and Noto Sans TC via Google Fonts with `display=swap` and system fallbacks. Physical-device testing should check Traditional Chinese glyph shape, network load, and fallback behavior. The project does **not** ship third-party font binaries.

Typeface sources: [Chiron Sung HK](https://github.com/chiron-fonts/chiron-sung-hk), [Noto fonts](https://notofonts.github.io/noto-docs/website/use/), [LXGW WenKai TC](https://github.com/lxgw/LxgwWenkaiTC), and [Iansui](https://github.com/ButTaiwan/iansui).

## Feed and article visual rules

- The feed uses one vertical column, capped at approximately 620px even on desktop; this preserves the feel of reading instead of presenting a dense card grid.
- Each preview is a complete link to its internal detail page. The title, summary, and publisher label remain accessible in HTML even when its background image is unavailable.
- Four distinct photographic backgrounds provide atmosphere. A dark gradient beneath white overlaid text improves legibility; the imagery is **illustrative, not a depiction of a real testimony or person**.
- The article view is narrower than the feed, with serif text, long line spacing, and a prominent path back to the feed.
- Screens include an explicit notice that stories, text, and images are demonstrations.

### Image provenance and release requirement

The CSS backgrounds are loaded from Pexels. They should be treated as demo-only external imagery rather than automatically approved production assets:

1. [Warm Sunset Through Sheer Window Curtains — Ivett M](https://www.pexels.com/photo/warm-sunset-through-sheer-window-curtains-40735592/)
2. [Serene Mountain Sunrise with Misty Valleys — Diogo Miranda](https://www.pexels.com/photo/serene-mountain-sunrise-with-misty-valleys-30322590/)
3. [Tranquil Forest Pathway in Summer Sunlight — Sergej](https://www.pexels.com/photo/tranquil-forest-pathway-in-summer-sunlight-33314069/)
4. [Sunlight Reflecting on Ocean Waves — Ty Nguyễn](https://www.pexels.com/photo/sunlight-reflecting-on-ocean-waves-32039473/)

Before displaying actual testimony records, verify rights and source attribution, use a permitted image (or a text-first fallback), and avoid presenting atmospheric stock photography as an authentic photo of the author or the event. Check the image license and availability independently before redistributing images.

## Accessibility and responsive behavior

- Phone gutters are 16px at narrow sizes; the feed stays one column.
- Interactive feedback controls have at least 44px target height; selected toggle states use `aria-pressed` rather than color alone.
- Keyboard focus uses a visible outline. Links and buttons retain native semantic elements.
- Chinese text wraps without horizontal scrolling. Article body uses increased line spacing for sustained reading.
- Animation and scrolling behavior respect `prefers-reduced-motion`.
- Decorative CSS backgrounds are not announced as content by screen readers.

The browser workflow `.github/workflows/design-smoke.yml` builds the application, starts a local Next.js server, and runs `web/scripts/check-design-layout.mjs`. Its Playwright assertions exercise 320px, 375px, 768px, and 1280px viewports; check feed-to-article navigation and return; verify distinct backgrounds, mock feedback toggles, keyboard focus, and lack of horizontal overflow; and upload feed/article screenshots.

For local work, install the web dependencies in `web/`, run `npm run dev`, and open `http://localhost:3000`. The browser screenshot script additionally requires Playwright and its Chromium browser; the GitHub workflow installs those dependencies in isolation. After changes, run `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` from `web/`.

## Design review and next implementation work

The design was reviewed using the nine areas described by the [Unslop](https://github.com/heydamir/unslop) methodology:

1. **Spacing:** consistent margins and breathable card copy.
2. **Color:** warm neutrals and a single functional accent.
3. **Icons:** minimal geometric markers instead of decorative icon clutter.
4. **Copy:** clear Traditional Chinese labels and unambiguous fictional-content notices.
5. **Typography:** editorial serif for story reading; neutral sans for controls.
6. **Layout:** a direct-to-feed vertical flow and separate focused article page.
7. **Details:** consistent buttons, subtle borders, and visible control states.
8. **Visuals:** distinct atmosphere imagery with explicit illustrative labeling.
9. **Motion:** restrained transitions and reduced-motion handling.

These notes describe the **current code**, not a claim that production content or usability research is complete. Reviewers should inspect the generated screenshots on both narrow and wide screens and test Chinese glyph readability on a physical phone.

To make this into a functional product, subsequent work must replace fictional data with permission-reviewed testimonies, use the typed feed API, implement pagination and return-to-feed scroll restoration, record impressions only after a measured visibility threshold, connect feedback to user-owned persistence, and handle empty/loading/error states. The article page must link to an authorized publisher original or show content only when redistribution rights are established. None of these capabilities should be inferred from the design demo.

## Skill attribution

The instructions in `web/.agents/skills/unslop/` are based on **Unslop** by Damir Sokolovsky, distributed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The vendored `NOTICE.md` identifies the upstream project and applicable attribution. The application-specific design rules and screenshot review process are recorded here; no association with the original author is implied.
