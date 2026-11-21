# Content pipeline

Source-specific importers for approved sources. They produce JSON batches shaped like the Supabase `sources` and `testimonies` tables (MUY-12). Importers never write to a database and never publish anything (`loader.py` is the only writer, see below): every row is `review_status = pending`, `rights_status = pending`, `publication_status = draft`.

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

## Loader: `loader.py`

Loads a batch written by an importer (`--out`) into the `sources` and `testimonies` tables.

```sh
# Dry run (default): validate the batch and report what would load. No database is contacted.
python -m pipeline.loader batch.json --source-key canaan-lingyou

# Write to STAGING only. Credentials come from the environment, never from arguments.
export SUPABASE_URL=https://<staging-ref>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=...   # staging service-role key; never commit or paste it
python -m pipeline.loader batch.json --source-key canaan-lingyou --apply --confirm-host <staging-ref>.supabase.co
```

What it guarantees (each has a test in `tests/test_loader.py`):

- **Incomplete or invalid batches are refused** before any write (exit code 2).
- **Always drafts.** Rows are written as review `pending`, rights `pending`, publication `draft`, whatever the batch says. A new source starts with rights `pending`. The loader never publishes or approves.
- **Idempotent.** A row whose `(source, external_id)` or `content_hash` already exists is skipped, so a re-run creates no duplicates. Existing rows and sources are never updated, so a later review decision, rights decision or hand-written summary is never overwritten.
- **One bad row does not stop the batch.** Chunks of 100 are retried row by row; a rejected row is reported as `source_key` plus `external_id` (exit code 1) and the rest still load. A later run picks it up.
- **Logs are non-personal.** One JSON line of counts and failed `external_id`s. No titles, summaries, URLs or keys. HTTP error bodies are never included.
- **Wrong-environment guard.** `--apply` needs `--confirm-host` to equal the host in `SUPABASE_URL`, and the URL must be https (http only for localhost).

To add a source, write an importer that follows `importers/base.py` and register it in `loader.main`'s `adapters` map.

### Hosted staging verification (MUY-16 Definition of Done)

Run against the staging project from MUY-46 after its migrations are applied. Use staging credentials and a **synthetic** batch only (for example `fixtures/canaan_magazine_range_sample.html` via `--from-dir`).

1. Build a synthetic batch: `python -m pipeline.importers.canaan_magazine --range 1 --from-dir <dir with range1.html> --out batch.json`.
2. Dry run, then `--apply`. Expect `inserted` equal to the row count.
3. Run `--apply` again. Expect `inserted: 0` and `skipped_existing` equal to the row count; confirm the table row count did not change.
4. Edit the batch so `stats.complete` is false (or build it with a missing range). Expect `REFUSED` and no new rows.
5. In the staging dashboard, confirm every loaded row is `pending`/`pending`/`draft` and that none is visible to the anon key.
6. Record the date, counts and result in the MUY-16 ticket. Do not record keys.

Not yet written: adapters for luke54.org and 東湖禮拜堂 (text pages; MUY-16 still open), and OCR for the Canaan PDFs (MUY-49).

## Tests

```sh
python -m pytest pipeline/tests
```

`fixtures/canaan_magazine_range_sample.html` is synthetic and imitates the catalog's malformed markup. `fixtures/approved_sample.json` is the 10-source sample for human review (see `fixtures/REVIEW.md`).
