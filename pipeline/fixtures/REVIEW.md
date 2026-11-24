# Reviewing candidate testimony links

## Purpose and current status

`approved_sample.json` contains **10 candidate Traditional Chinese testimony links from 10 distinct sources**. Despite the historical filename, the dataset is a **candidate fixture**, not a list of cleared or publishable stories.

Each candidate contains a title, publisher/source name, original URL, a short draft synopsis written for the app, topical tags, and notes about potential rights or content issues. The fixture does not include copied full articles or author-name fields. A link being publicly accessible, or a website's `robots.txt` permitting crawling, does **not** establish permission to reuse text or images.

**Review status: pending.** An independent reviewer must verify each source and approve content and usage rights before any entry becomes visible in a real user-facing feed. The `rights_status: "link_out"` field describes a proposed display mode; it is **not a license grant or evidence of legal clearance**.

## Review checklist for each candidate

- [ ] **Identity and accuracy:** Open the record's `url` and confirm that the page exists, the title matches, and the linked item is a first-person Christian testimony rather than a sermon, announcement, or news article.
- [ ] **Source suitability:** Confirm the publisher and original author or rights holder where necessary. Exclude the sources specified by the current dataset criteria (真耶穌教會 and 全能神).
- [ ] **Content safety:** Evaluate the article for self-harm, abuse, or other sensitive content requiring exclusion or additional handling. Do not equate an absence of machine-detected terms with a completed editorial review.
- [ ] **Synopsis:** Check the draft summary against the original page for accuracy, concision, and unnecessary personal or health details. Ensure any published synopsis is permitted under applicable rights and policies.
- [ ] **Rights:** Confirm permissions for extraction and raw-text storage, linking, titles/summaries, full-text display, thumbnails, and embeddings as applicable. Record each decision and its scope in a traceable rights register. Do not store full text before its storage permission is confirmed; leave records unpublished when display rights are uncertain.
- [ ] **Publication decision:** Set the record's `review` fields (`reviewer`, `decision`, `reason`, `reviewed_on`) with a substantive explanation and supporting link or evidence. Do not mark the fixture as publishable until all required checks have passed.

### Candidate-specific concerns

| Source | Candidate | Follow-up required |
| --- | --- | --- |
| 水深之處 (luke54.org) | 我如何由小惡魔「變身」為好孩子 | Confirm publisher reuse terms for preview text |
| 東湖禮拜堂 | 天黑的咒詛 | Confirm title, synopsis, and display rights |
| 生命之道靈糧堂 | 上帝是我隨時的幫助 | Review publisher reuse terms and safety context |
| 台北真理堂愛說故事 | 放手，讓上帝動工 | **Potential CC BY-NC-ND restriction**: independently assess whether the proposed summary constitutes an adaptation and whether the intended app use is permitted |
| 貴格會宜蘭天恩教會 | 恢復和前夫的關係 | Site image is described as illustrative; **do not copy it as an original story thumbnail** |
| 德生教會 | 第二個生日的見證 | Original title includes an author's name; minimize unnecessary personal details |
| 台灣聖經網 | 那張沒有被遺忘的傳單 | User-submitted testimony; identify rights holder and verify applicable republication/synopsis rights |
| 基督門徒訓練神學院 | 撇下一切跟隨主 | Keep family illness details out of the short preview |
| 迦南臺灣基督教會 | 神啊，祢要我學習什麼？ | Confirm original source, publisher and use terms |
| 基督教浸禮聖經會太平會幕堂 | 受洗見證文 | Page title contains an author's name; review synopsis and publisher terms |

All source URLs and existing notes live in `approved_sample.json`. The table here is a quick review index, not substitute rights evidence.

## Open publication decisions

1. **Text and summaries:** Linking, storing raw text, displaying a full article, and creating embeddings are separate uses. Determine and record which uses are allowed.
2. **No-derivatives or noncommercial terms:** Do not assume a generated or rewritten summary is permitted under a CC BY-NC-ND notice. Resolve and record the applicable terms before use.
3. **User-submitted testimonies:** Publisher hosting does not necessarily prove publisher ownership or licensing authority. Confirm who can authorize reuse, or leave the candidate out.
4. **Images:** Use independently licensed editorial illustrations or images for which the project has explicit display permission. Never imply that a stock image portrays the actual testimony author or event.

## Data and testing

The test file `pipeline/tests/test_approved_sample.py` checks fixture shape, distinct sources, URLs, summary size, and exclusion rules. **Passing these tests cannot validate publisher permissions, factual accuracy, editorial suitability, or the legal status of a synopsis.**

After documentary review, a reviewer should record a clear per-source decision with date and rationale. Only then should an application importer select eligible records for publication. Pending records must remain out of the public feed.
