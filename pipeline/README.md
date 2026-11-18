# Content pipeline

Source-specific importers for approved sources. They produce JSON batches shaped like the Supabase `sources` and `testimonies` tables (MUY-12). They never write to a database and never publish anything: every row is `review_status = pending`, `rights_status = pending`, `publication_status = draft`.

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
| `body` | always null |
| `source_name` | 迦南會北部大專團契・靈友雙月刊 |
| `source_url` | the article's own PDF link on Dropbox |
| `topics` | empty |
| statuses | `pending`, `pending`, `draft` |

Limits to know about:

- The importer reads the catalog tables only. It does not download or read the PDFs.
- Author names are discarded and never stored.
- The catalog has no usable category, so it cannot tell testimonies from other articles. `import_hint` (`maybe_testimony` or `unlikely`) is a keyword guess from the title that a person must check by reading the article. `import_hint` is not a table column; a loader drops it.
- Articles are PDFs, not web text pages.
- The source's rights are `pending`: no reuse terms or copyright notice were found and robots.txt returns 404. Approve the source's rights before anything is published.
- Exact duplicate catalog rows (same issue, page and title) collapse to one row and are counted in `stats.exact_duplicates_skipped`.
- A range that cannot be fetched (after 2 retries, one request per second) or that is not a catalog page (for example an HTTP 200 error page) is reported by number in `stats.failed_ranges`, the batch is marked `complete: false`, the other ranges still load, and the exit code is 1. A loader must refuse a batch that is not complete.

A loader that upserts the batch into Supabase (resolving `source_id` from `source_key`) is not written yet. It depends on MUY-12 landing and on a service-role key.

## Tests

```sh
python -m pytest pipeline/tests
```

`fixtures/canaan_magazine_range_sample.html` is synthetic and imitates the catalog's malformed markup. `fixtures/approved_sample.json` is the 10-source sample for human review (see `fixtures/REVIEW.md`).
