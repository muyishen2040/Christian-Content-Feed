# Content pipeline

Source-specific importers for approved sources. They produce JSON batches shaped like the Supabase `sources` and `testimonies` tables (MUY-12). They never write to a database and never publish anything: every row is `review_status = pending`, `rights_status = pending`, `publication_status = draft`.

## Testimony text and rights

The product needs the original article text for review and downstream processing. Store raw text only after a person records permission for that storage and its intended use; a public page or permissive robots.txt is not a license. Review permissions separately for extraction, storage, display, and embeddings, including any privacy or author-consent requirements. A draft status alone is not permission to store the text.

Record the source name, original URL, rights evidence, and reviewer decision alongside each candidate. Keep raw text in private working files or a suitably restricted database, and out of Git, public fixtures, and logs. Continue to leave unknown-rights items unpublished. Do not create separate author-name fields unless separately authorized and needed; review names and other personal details that already appear in the raw text.

The current schema has one nullable `testimonies.body` text column. It can hold the original extracted text when storage is authorized, but has no separate raw and processed fields. Preserve the original before making OCR corrections or formatting changes; a future schema and pipeline change must add separate storage before both versions can be kept in the database. Do not encode an invented JSON structure into `body`.

The public `published_testimonies` view exposes metadata only, not `body`. An approved article cannot yet be read in full through the app; displaying it requires a separately reviewed API and UI with access controls and display rights. This policy change does not modify the database, importers, or app.

## Work boundaries

[MUY-16](https://linear.app/muyishen4020/issue/MUY-16) covers the metadata loader and its staging verification. [MUY-50](https://linear.app/muyishen4020/issue/MUY-50) adds metadata-only discovery for 水深之處 and 東湖禮拜堂. Its title and description filters do not replace full-article or human review; imported candidates remain unpublished drafts.

[MUY-51](https://linear.app/muyishen4020/issue/MUY-51) covers extracting and preserving permitted HTML article text, safe enrichment of existing drafts, and content-based review. [MUY-49](https://linear.app/muyishen4020/issue/MUY-49) covers Canaan PDF/OCR. Coordinate shared normalization and tagging with [MUY-17](https://linear.app/muyishen4020/issue/MUY-17).

## Importers

### `importers/canaan_magazine.py` — 迦南會北部大專團契・靈友雙月刊

Source page: https://www.canaan.org.tw/experimental/drupal/node/157 (a table of contents for the bi-monthly magazine, issues 1-350, served as seven range pages).

```sh
# Dry run: fetch the seven catalog pages (1 request per second), validate, print a summary.
python -m pipeline.importers.canaan_magazine

# Write the batch to a file instead of only validating.
python -m pipeline.importers.canaan_magazine --out batch.json

# Work offline from saved range pages (range1.html ... range7.html).
python -m pipeline.importers.canaan_magazine --from-dir saved_pages --out batch.json
```

Each row maps like this:

| `testimonies` column | Value |
|---|---|
| `external_id` | `ly<issue>-p<page>-<10-character digest of the title>`; stable when rows are reordered or an article is inserted |
| `content_hash` | sha256 of source, issue, page and normalized title (stable between runs) |
| `title` | article title as written in the catalog |
| `excerpt` | bibliographic line only: issue, date and page. A person must replace it with our own summary |
| `body` | always null in this catalog-only importer; it does not extract PDF text |
| `source_name` | 迦南會北部大專團契・靈友雙月刊 |
| `source_url` | the article's own PDF link on Dropbox |
| `topics` | empty |
| statuses | `pending`, `pending`, `draft` |

Limits to know about:

- The importer reads the catalog tables only. It does not download or read the PDFs.
- Author names are discarded and never stored.
- The catalog has no usable category, so it cannot tell testimonies from other articles. `import_hint` (`maybe_testimony` or `unlikely`) is a keyword guess from the title that a person must check by reading the article. `import_hint` is not a table column; a loader drops it.
- Articles are PDFs, not web text pages.
- The source's rights are `pending`: no reuse terms or copyright notice were found and robots.txt returns 404. Confirm permission for storage before saving full text, and approve the relevant rights before publication or embeddings.
- Exact duplicate catalog rows (same issue, page and title) collapse to one row and are counted in `stats.exact_duplicates_skipped`.
- A range that cannot be fetched (after 2 retries, one request per second) or that is not a catalog page (for example an HTTP 200 error page) is reported by number in `stats.failed_ranges`, the batch is marked `complete: false`, the other ranges still load, and the exit code is 1. A loader must refuse a batch that is not complete.

The draft-only database loader is proposed in [PR #16](https://github.com/muyishen2040/Christian-Content-Feed/pull/16). Consult its final merged instructions and staging verification before using it. Article-text extraction and enrichment are follow-up work.

## Tests

```sh
python -m pytest pipeline/tests
```

`fixtures/canaan_magazine_range_sample.html` is synthetic and imitates the catalog's malformed markup. `fixtures/approved_sample.json` is the 10-source sample for human review (see `fixtures/REVIEW.md`).
