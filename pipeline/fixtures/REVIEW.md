# Reviewing the 10-source testimony sample

Data: `approved_sample.json` (10 records, 10 distinct sources, checked 2026-11-15). Each record is a link-out: title, source, original URL, our own summary and tags. Nothing here has been reviewed by a person yet.

## For each record, check
- [ ] Open the URL: it loads and is the testimony named in the title.
- [ ] It is a first-person story about God's work in the writer's life (not a sermon, news item or announcement).
- [ ] No crisis-adjacent content (suicide, self-harm, abuse) in that testimony.
- [ ] Source is not 真耶穌教會 or 全能神 (Eastern Lightning).
- [ ] Our summary is in our own words, short, with no author name or sensitive health detail.
- [ ] Rights status "link_out" is acceptable (see open decisions).

Then fill the record's `review` block (`reviewer`, `decision`, `reason`, `reviewed_on`) and update `_meta.review_status`.

## Records and flags
| # | Source | Title | URL level | Flags |
|---|---|---|---|---|
| 1 | 水深之處 (luke54.org) | 我如何由小惡魔「變身」為好孩子 | item | - |
| 2 | 東湖禮拜堂 | 天黑的咒詛 | item | - |
| 3 | 生命之道靈糧堂 | 上帝是我隨時的幫助 | item | - |
| 4 | 台北真理堂愛說故事 | 放手，讓上帝動工 | item | ND licence: our generated summary may count as an adaptation; NC: app must be non-commercial. For MUY-43 / Samuel. |
| 5 | 貴格會宜蘭天恩教會 | 恢復和前夫的關係 | item | Source page uses stock images ('圖 網路示意'): do not use thumbnails. |
| 6 | 德生教會 | 第二個生日的見證 | item | Source page title includes the author's name; do not store it. |
| 7 | 台灣聖經網 | 那張沒有被遺忘的傳單 | item | Rights weaker than church-run sources: the site publishes testimonies submitted by individuals ('刊登其他見證'), so the copyright holder is the author.; Last modified 2026-06-02.; The page shows the author's pseudonym; do not store it.; An earlier candidate from this site (ID 8528) was rejected: the author describes several suicide attempts. |
| 8 | 基督門徒訓練神學院 | 撇下一切跟隨主 | item | Seminary student calling testimony; the story mentions a family member's illness, so keep the summary generic. |
| 9 | 迦南臺灣基督教會 | 神啊，祢要我學習什麼？ | item | Church is in the US (San Jose). |
| 10 | 基督教浸禮聖經會太平會幕堂 | 受洗見證文 | item | Source page title includes the author's name; do not store it.; Post is from 2017. |

## Open decisions (not for the reviewer to guess)
1. Does generating our own summary satisfy the PRD rights wording? (Samuel / MUY-43)
2. ttlctestimony.blogspot.com is CC BY-NC-ND: does a summary count as an adaptation, and is the app non-commercial? (MUY-43)
3. 台灣聖經網 testimonies are submitted by individuals, so the author holds the copyright and no reuse terms are stated. Keep or drop? (MUY-43)

No legal review has been done.
