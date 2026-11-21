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

### `importers/luke54.py` — 水深之處 (luke54.org)

```sh
# Dry run on the newest 100 articles (1 request per second). A full run is ~14,500 requests: use --limit.
python -m pipeline.importers.luke54 --limit 100 --out batch.json

# Offline, from saved files (sitemap.xml and article<ID>.html) in a directory.
python -m pipeline.importers.luke54 --from-dir saved_pages --limit 50
```

- Takes article ids from the sitemap, then reads only each page's `<head>` (`og:title`, `og:description`). It never reads the body or the author tag.
- The description is read transiently to classify and is dropped; it is never in a row, batch, log or error.
- `external_id` is `luke54-<article id>`; `content_hash` depends only on the source and id, so reruns are identical even if a title is edited.
- Any article that fails to load is reported by id and marks the batch incomplete (the loader refuses it). Rerun it; the loader skips rows it already has.

### `importers/donghu.py` — 東湖禮拜堂 (dhchurch.org.tw)

```sh
python -m pipeline.importers.donghu --out batch.json
```

- Uses the WordPress REST API for the 見證分享 category only (found by exact name; the run refuses if it is not exactly one category). It requests `id,link,title` only, so no post body is ever fetched.
- Removes the generic 《見證分享》 prefix. A title can still contain a person's name: **a person must check each title before approval** (no author names are stored).
- `external_id` is `donghu-<post id>`.

### Shared rules (`importers/common.py`)

- **robots.txt first.** A URL is fetched only if robots.txt allows it for our agent *and* for GPTBot, ClaudeBot, anthropic-ai, CCBot, Google-Extended and PerplexityBot. A missing robots.txt (404) means no rules; any other error refuses.
- **Polite.** https only, one request per `--delay` seconds, bounded retries (5xx, 429 and network errors; a 404 is not retried).
- **First-pass classifier** (`common.classify`), applied to the title and, for luke54, the transient description:
  - excluded-source words (真耶穌教會, 全能神, 東方閃電) → rejected;
  - crisis words (自殺, 輕生, 自殘, 憂鬱症, 家暴, 性侵 and similar) → **held out of the batch**, listed by id only in `stats.held_for_review` for a person to look at, never as a row;
  - sermon, announcement, signup and how-to-testify titles → rejected;
  - everything else is a draft candidate, `import_hint` `likely_testimony` (the title says 見證, or the description is first person) or `needs_review`.
  - This is a keyword filter, not a judgment. A person still reads every candidate.
- **Rows** are drafts with a placeholder excerpt and no topics. Our own summary and tags are a later step (MUY-49); these importers do not write one.
- If Python reports `CERTIFICATE_VERIFY_FAILED` on macOS, the python.org install is missing its CA bundle: run its `Install Certificates.command`, or set `SSL_CERT_FILE=/etc/ssl/cert.pem` for the run. Do not disable verification.

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

Not yet written: our own summaries and topic tags, and OCR for the Canaan PDFs (MUY-49).

## Tests

```sh
python -m pytest pipeline/tests
```

`fixtures/luke54/` and `fixtures/donghu/` are synthetic too (fictional titles; crisis and excluded-source words are placed in article bodies on purpose, to prove bodies are not read). `fixtures/canaan_magazine_range_sample.html` is synthetic and imitates the catalog's malformed markup. `fixtures/approved_sample.json` is the 10-source sample for human review (see `fixtures/REVIEW.md`).
