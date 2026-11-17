"""Importer for the 靈友雙月刊 catalog of 迦南會北部大專團契 (canaan.org.tw).

The source page https://www.canaan.org.tw/experimental/drupal/node/157 is an index. It links to
seven range pages (`/code/mag-show.php?range=1..7`, issues 1-350). Each range page is a table of
contents: one row per article with issue, date, title, author, page, category and a PDF link.

What this importer does
- Reads only those catalog pages (titles, dates, page numbers, links). It never downloads the PDFs.
- Maps every row to the shape of the Supabase `testimonies` table (see supabase/migrations on the
  MUY-12 branch), always as an unreviewed, unpublished draft.
- Drops author names: they are not stored (project rule), and the table has no author column.

What it cannot do
- Decide which articles are testimonies. The catalog has no usable category. `import_hint` is a
  keyword guess from the title and a human must read the article before it is approved.
- Write a real excerpt. `excerpt` is NOT NULL in the table, so it holds a factual bibliographic
  line until a person replaces it with our own summary.

The standard library only. Nothing here writes to a database; the output is a JSON batch.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
import unicodedata
import urllib.request
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path

CATALOG_BASE = "https://www.canaan.org.tw/code/mag-show.php?range={n}"
CATALOG_RANGES = range(1, 8)  # ranges 1..7 = issues 1-350
INDEX_URL = "https://www.canaan.org.tw/experimental/drupal/node/157"
HOMEPAGE_URL = "https://www.canaan.org.tw/experimental/drupal/"

SOURCE_KEY = "canaan-lingyou"
SOURCE_NAME = "迦南會北部大專團契・靈友雙月刊"
USER_AGENT = "ChristianContentFeedImporter/0.1 (catalog pages only; no PDF downloads)"

# Same sets as the CHECK constraints in the testimonies table.
REVIEW_STATUSES = {"pending", "approved", "rejected"}
RIGHTS_STATUSES = {"pending", "approved", "rejected", "revoked"}
PUBLICATION_STATUSES = {"draft", "published", "unpublished"}

_DATE = re.compile(r"^\d{4}\.\d{1,2}(\.\d{1,2})?$")
_HINT = re.compile(r"見證|蒙恩|信主|得救|受洗|歸主|恩典|感恩|經歷|生命的|我的")


@dataclass(frozen=True)
class CatalogEntry:
    issue: int
    date: str
    title: str
    page: str
    pdf_url: str | None
    seq: int  # position of the row among rows with the same issue and page


class _CatalogParser(HTMLParser):
    """Lenient parser for the catalog's malformed HTML (unclosed <td>, unquoted href values)."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[dict]] = []
        self._row: list[dict] | None = None
        self._cell: dict | None = None

    def _close_cell(self) -> None:
        if self._row is not None and self._cell is not None:
            self._cell["text"] = re.sub(r"\s+", " ", "".join(self._cell["parts"])).strip()
            self._row.append(self._cell)
        self._cell = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "tr":
            self._close_cell()
            self._row = []
        elif tag == "td" and self._row is not None:
            self._close_cell()
            self._cell = {"parts": [], "href": None}
        elif tag == "a" and self._cell is not None and self._cell["href"] is None:
            self._cell["href"] = dict(attrs).get("href")

    def handle_endtag(self, tag: str) -> None:
        if tag == "tr":
            self._close_cell()
            if self._row:
                self.rows.append(self._row)
            self._row = None
        elif tag == "td":
            self._close_cell()

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell["parts"].append(data)


def clean_text(value: str) -> str:
    """Collapse whitespace only. Stored titles keep the source's own characters and punctuation."""
    return re.sub(r"\s+", " ", value).strip()


def normalize_text(value: str) -> str:
    """NFKC plus collapsed whitespace. Used only to build the content hash, never for display."""
    return clean_text(unicodedata.normalize("NFKC", value))


def parse_catalog(html_text: str) -> list[CatalogEntry]:
    """Parse one catalog range page into entries. Author cells are read past and discarded."""
    parser = _CatalogParser()
    parser.feed(html_text)
    parser.close()
    entries: list[CatalogEntry] = []
    seen: dict[tuple[int, str], int] = {}
    for row in parser.rows:
        if len(row) < 5:
            continue
        issue_text, date_text, title_cell, _author, page_cell = row[0], row[1], row[2], row[3], row[4]
        if not issue_text["text"].isdigit() or not _DATE.match(date_text["text"]):
            continue  # header row, cover-image row, or anything else that is not an article
        title = clean_text(title_cell["text"])
        if not title:
            continue
        issue = int(issue_text["text"])
        page = clean_text(page_cell["text"])
        key = (issue, page)
        seen[key] = seen.get(key, 0) + 1
        entries.append(
            CatalogEntry(
                issue=issue,
                date=date_text["text"],
                title=title,
                page=page,
                pdf_url=_https(title_cell["href"]),
                seq=seen[key],
            )
        )
    return entries


def _https(url: str | None) -> str | None:
    if not url:
        return None
    url = url.strip().replace("&amp;", "&")
    return "https://" + url[len("http://"):] if url.startswith("http://") else url


def content_hash(entry: CatalogEntry) -> str:
    """Stable per (source, issue, page, title). Does not depend on the author or on fetch time."""
    basis = "|".join([SOURCE_KEY, str(entry.issue), entry.page, normalize_text(entry.title)])
    return hashlib.sha256(basis.encode("utf-8")).hexdigest()


def import_hint(entry: CatalogEntry) -> str:
    """Keyword guess only. 'maybe_testimony' still needs a person to read the article."""
    return "maybe_testimony" if _HINT.search(entry.title) else "unlikely"


def to_source_row() -> dict:
    """Row for public.sources. Rights stay 'pending': no reuse terms were found on the site."""
    return {
        "name": SOURCE_NAME,
        "homepage_url": HOMEPAGE_URL,
        "rights_status": "pending",
        "rights_evidence_url": None,
        "private_import_notes": (
            "Catalog index at " + INDEX_URL + ". robots.txt returns 404 (no restrictions stated). "
            "No copyright or reuse terms found. Articles are PDFs on Dropbox; this importer reads "
            "only the catalog tables. Link-out only. Approve rights before publishing."
        ),
    }


def to_testimony_row(entry: CatalogEntry) -> dict:
    """Row for public.testimonies, without id and source_id (the loader resolves source_id)."""
    when = entry.date
    return {
        "source_key": SOURCE_KEY,  # loader replaces this with source_id
        "external_id": f"ly{entry.issue}-p{entry.page or '0'}-{entry.seq}",
        "content_hash": content_hash(entry),
        "content_type": "testimony",
        "title": entry.title,
        "excerpt": f"《靈友》第{entry.issue}期（{when}）第{entry.page or '?'}頁。摘要待人工撰寫。",
        "body": None,
        "source_name": SOURCE_NAME,
        "source_url": entry.pdf_url,
        "topics": [],
        "review_status": "pending",
        "rights_status": "pending",
        "publication_status": "draft",
        "published_at": None,
        "import_hint": import_hint(entry),  # not a table column; the loader drops it
    }


def validate_batch(batch: dict) -> list[str]:
    """Check a batch against the testimonies table constraints. Returns a list of problems."""
    problems: list[str] = []
    hashes: set[str] = set()
    ext: set[str] = set()
    for i, r in enumerate(batch["testimonies"]):
        where = f"row {i} ({r.get('external_id')})"
        for col in ("title", "excerpt", "source_name", "content_hash"):
            if not str(r.get(col) or "").strip():
                problems.append(f"{where}: empty {col}")
        if r["content_type"] != "testimony":
            problems.append(f"{where}: content_type")
        if r["review_status"] not in REVIEW_STATUSES or r["rights_status"] not in RIGHTS_STATUSES:
            problems.append(f"{where}: bad status")
        if r["publication_status"] not in PUBLICATION_STATUSES:
            problems.append(f"{where}: bad publication_status")
        if r["publication_status"] == "published" or r["published_at"] is not None:
            problems.append(f"{where}: importer must never publish")
        if r["content_hash"] in hashes:
            problems.append(f"{where}: duplicate content_hash")
        hashes.add(r["content_hash"])
        if r["external_id"] in ext:
            problems.append(f"{where}: duplicate external_id")
        ext.add(r["external_id"])
    return problems


def build_batch(pages: dict[int, str]) -> dict:
    """Rows are idempotent: the same pages always give the same rows and hashes. Exact duplicates
    (same issue, page and title, e.g. an article listed twice) collapse to the first row."""
    rows: list[dict] = []
    seen: set[str] = set()
    skipped = 0
    for n in sorted(pages):
        for entry in parse_catalog(pages[n]):
            row = to_testimony_row(entry)
            if row["content_hash"] in seen:
                skipped += 1
                continue
            seen.add(row["content_hash"])
            rows.append(row)
    return {
        "source": to_source_row(),
        "testimonies": rows,
        "stats": {"rows": len(rows), "exact_duplicates_skipped": skipped},
    }


def fetch_range(n: int, timeout: float = 30.0) -> str:
    req = urllib.request.Request(CATALOG_BASE.format(n=n), headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (fixed https URL)
        return resp.read().decode("utf-8", errors="replace")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--range", type=int, action="append", choices=list(CATALOG_RANGES),
                    help="catalog range 1-7 (repeatable). Default: all seven.")
    ap.add_argument("--from-dir", type=Path, help="read range<N>.html files from a directory instead of fetching")
    ap.add_argument("--out", type=Path, help="write the JSON batch here instead of printing a summary")
    ap.add_argument("--delay", type=float, default=1.0, help="seconds between requests (default 1)")
    args = ap.parse_args(argv)

    ranges = args.range or list(CATALOG_RANGES)
    pages: dict[int, str] = {}
    for k, n in enumerate(ranges):
        if args.from_dir:
            pages[n] = (args.from_dir / f"range{n}.html").read_text(encoding="utf-8", errors="replace")
        else:
            if k:
                time.sleep(args.delay)
            pages[n] = fetch_range(n)

    batch = build_batch(pages)
    problems = validate_batch(batch)
    hints = sum(r["import_hint"] == "maybe_testimony" for r in batch["testimonies"])
    skipped = batch["stats"]["exact_duplicates_skipped"]
    print(f"rows={len(batch['testimonies'])} maybe_testimony={hints} duplicates_skipped={skipped} problems={len(problems)}", file=sys.stderr)
    for p in problems[:20]:
        print("PROBLEM:", p, file=sys.stderr)
    if args.out:
        args.out.write_text(json.dumps(batch, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
