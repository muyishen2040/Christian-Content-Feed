# MUY-35 · Mobile design direction

## Five-line direction

- **Product:** A Traditional Chinese mobile reading experience for discovering source-attributed Christian testimonies related to life's difficulties and hopes.
- **Character:** Quiet, thoughtful, human.
- **World:** A personal reading journal — paper, ink, generous margins, and small chapter marks.
- **Moment:** The testimony title and original editorial summary are the emphasis; one deliberately typeset note introduces the content without pretending to be a real person's quote.
- **Signature:** A narrow green editorial rule with chapter-number treatment, repeated sparingly beside the wordmark and stories.

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
| Display | `--ui-font-display` | Noto Serif TC / Songti TC fallbacks |
| Spacing | 4px rhythm | 8 / 12 / 16 / 20 / 24 / 32 / 48 / 72 |
| Button | `--ui-radius-button` | 10px, 48px minimum height |
| Card | `--ui-radius-card` | 16px, 20–24px padding |
| Feedback | `.feedback-action` | 44px minimum height, `aria-pressed` |
| Motion | `--ui-motion` | 160ms neutral transitions |

Tailwind 4 maps the design variables into the theme (`bg-paper`, `text-ink`, `text-moss`, `font-display`). All pages should reuse these rather than introducing one-off colors.

Typography: 36–62px responsive display headline, 26–36px section titles, ~23px story titles, 15–17px body text, 12–13px factual metadata only. Keep long Traditional Chinese prose legible at 1.7–1.9 line height. Do not use narrow columns for full stories or justify every line.

The *story content* carries the hierarchy. Story cards are always text-first: title, original editorial summary, source, then an original-source link when permission and URL exist. No forced autoplay, guessed thumbnails, stock-photo testimony portraits, exaggerated gradients, or invented publisher identity. `sourceUrl=null` is allowed for clearly fictional mock records only; real stories must have a verifiable original URL.

Mobile-first: page gutters 16px on <=420px phones, 20px otherwise; one-column feed below 760px, two columns above. Controls have 44–48px tap targets. Native Chinese text wrapping should not create horizontal scrolling at 320px/375px/768px/1440px. Keyboard focus is visible on links, inputs, and buttons; selected feedback uses `aria-pressed`, not color alone. Avoid animation for visitors requesting reduced motion.

## Components

- `Button` / `ButtonLink`: primary, secondary, quiet; proper semantics instead of clickable divs.
- `TextField`: bound label, hint/error via `aria-describedby`, invalid state and focus.
- `Eyebrow`, `SectionTitle`: restrained typographic hierarchy.
- `TestimonyCard`: a story source link is shown only when `sourceUrl` is present; suitable for real content as well as explicit mocks.
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
