"""Importer for 水深之處 (https://www.luke54.org), one of our two primary text sources.

How it works
- Reads the sitemap (about 14,500 article URLs, no titles) and picks article ids, newest first.
- Fetches each article page and reads only its `<head>` metadata: `og:title` and `og:description`.
  It never reads, keeps or logs the article body, and never reads the author meta tag.
- The description is page text. It is used transiently by `common.classify` and then dropped; it is
  never put in a row, a batch, a log line or an error.
- Classification is content-based, not title-based: about 90% of titles do not start with `見證`,
  so the prefix is only a hint. Sermons and announcements are rejected, crisis-adjacent and excluded
  sources are held out of the batch (see `common.classify`). A person still reads every candidate.
- Rows are unreviewed drafts with a placeholder excerpt and no topics. Our own summary and tags are
  a later step (MUY-49); nothing here writes one.
- `external_id` is `luke54-<article id>` and `content_hash` depends only on the source and the id,
  so reruns give identical values even if a title is edited.

A full run is about 14,500 requests at one per second, so use `--limit` (newest N articles).
Any article that cannot be fetched or parsed is reported by id and marks the batch incomplete;
the loader refuses incomplete batches, so rerun it (the loader skips rows it already has).
"""

from __future__ import annotations

import argparse
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from typing import Callable

from pipeline.importers import common
from pipeline.importers.common import Fetcher, FetchError, RobotsDisallowed, clean_text

BASE = "https://www.luke54.org"
SITEMAP_URL = f"{BASE}/sitemap.xml"
ARTICLE_URL = BASE + "/articles/{id}"
SOURCE_KEY = "luke54"
SOURCE_NAME = "水深之處 (luke54.org)"

validate_batch = common.validate_batch

_ARTICLE_LOC = re.compile(r"<loc>\s*https://www\.luke54\.org/articles/(\d+)\s*</loc>")
_TITLE_WRAPPER = re.compile(r"^見證｜【(.+)】$")


class ArticleError(Exception):
    """A page has no usable og:title. The message is a fixed label, never page text."""


def parse_sitemap(xml_text: str) -> list[int]:
    """Article ids from the sitemap, newest (highest id) first, without duplicates."""
    return sorted({int(m) for m in _ARTICLE_LOC.findall(xml_text)}, reverse=True)


class _HeadMeta(HTMLParser):
    """Reads og:title and og:description from <head> only, then stops. Never looks at the body."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, str] = {}
        self.done = False

    def handle_starttag(self, tag, attrs):
        if self.done:
            return
        if tag == "meta":
            a = dict(attrs)
            if a.get("property") in {"og:title", "og:description"} and a.get("content") is not None:
                self.meta[a["property"]] = a["content"]
        elif tag == "body":
            self.done = True

    def handle_endtag(self, tag):
        if tag == "head":
            self.done = True


def parse_article(html_text: str) -> tuple[str, str, str]:
    """Return (title, description, hint_prefix). The description is for transient use only."""
    parser = _HeadMeta()
    parser.feed(html_text)
    parser.close()
    raw = clean_text(parser.meta.get("og:title", ""))
    if not raw:
        raise ArticleError("no og:title")
    wrapped = _TITLE_WRAPPER.match(raw)
    title = clean_text(wrapped.group(1)) if wrapped else raw
    return title, parser.meta.get("og:description", ""), "見證" if wrapped else ""


def to_source_row() -> dict:
    return {
        "name": SOURCE_NAME,
        "homepage_url": BASE,
        "rights_status": "pending",
        "rights_evidence_url": None,
        "private_import_notes": (
            "robots.txt allows /articles and disallows /api and /admin; footer 'All rights reserved'; "
            "the About page says content is for believers to read and share freely; no licence. "
            "Public availability is not permission. Link-out only: title, our own summary and tags. "
            "Approve rights before publishing."
        ),
    }


def build_batch(ids: list[int], pages: dict[int, str], failures: list[dict] | None = None) -> dict:
    """Build a batch from fetched article pages. Deterministic: the same pages give the same rows,
    ids and hashes in any order. Rejected and held items are counted, never emitted as rows."""
    stats = common.new_stats()
    for f in failures or []:
        common.record_failure(stats, f["item"], f["reason"])
    rows: list[dict] = []
    for article_id in sorted(pages):
        item = f"luke54-{article_id}"
        try:
            title, description, prefix = parse_article(pages[article_id])
        except ArticleError as exc:
            common.record_failure(stats, item, str(exc))
            continue
        verdict = common.classify(prefix + title, description)  # prefix keeps 見證 as a hint
        del description  # transient: never kept past classification
        if not common.record_verdict(stats, item, verdict):
            continue
        rows.append(common.to_row(
            source_key=SOURCE_KEY, source_name=SOURCE_NAME, external_id=item,
            content_hash=common.stable_hash(SOURCE_KEY, str(article_id)),
            title=title, url=ARTICLE_URL.format(id=article_id), hint=verdict.hint,
        ))
    stats["rows"] = len(rows)
    stats["requested"] = len(ids)
    stats["held_for_review"].sort()
    stats["failed_items"].sort(key=lambda f: f["item"])
    return {"source": to_source_row(), "testimonies": rows, "stats": stats}


def fetch_articles(ids: list[int], fetcher: Fetcher) -> tuple[dict[int, str], list[dict]]:
    pages: dict[int, str] = {}
    failures: list[dict] = []
    for article_id in ids:
        try:
            pages[article_id] = fetcher.get(ARTICLE_URL.format(id=article_id))
        except RobotsDisallowed:
            failures.append({"item": f"luke54-{article_id}", "reason": "blocked by robots.txt"})
        except FetchError as exc:
            failures.append({"item": f"luke54-{article_id}", "reason": f"fetch failed ({exc})"})
    return pages, failures


def main(argv: list[str] | None = None, fetcher: Fetcher | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--limit", type=int, default=100, help="newest N articles from the sitemap (default 100)")
    ap.add_argument("--from-dir", type=Path, help="read sitemap.xml and article<ID>.html from a directory instead of fetching")
    ap.add_argument("--out", type=Path, help="write the JSON batch here instead of only printing a summary")
    ap.add_argument("--delay", type=float, default=1.0, help="seconds between requests (default 1)")
    ap.add_argument("--retries", type=int, default=2, help="retries per request after a failed fetch (default 2)")
    args = ap.parse_args(argv)
    if args.limit < 1:
        ap.error("--limit must be at least 1")

    pages: dict[int, str] = {}
    failures: list[dict] = []
    if args.from_dir:
        ids = parse_sitemap((args.from_dir / "sitemap.xml").read_text(encoding="utf-8"))[: args.limit]
        for i in ids:
            try:
                pages[i] = (args.from_dir / f"article{i}.html").read_text(encoding="utf-8")
            except OSError:
                failures.append({"item": f"luke54-{i}", "reason": "cannot read file"})
    else:
        fetcher = fetcher or Fetcher(delay=args.delay, retries=args.retries)
        try:
            ids = parse_sitemap(fetcher.get(SITEMAP_URL))[: args.limit]
        except (FetchError, RobotsDisallowed) as exc:
            print(f"REFUSED: sitemap unavailable ({exc})", file=sys.stderr)
            return 2
        pages, failures = fetch_articles(ids, fetcher)

    if not ids:
        print("REFUSED: the sitemap listed no articles", file=sys.stderr)
        return 2
    batch = build_batch(ids, pages, failures)
    return common.finish_cli(batch, validate_batch(batch), args.out)


if __name__ == "__main__":
    raise SystemExit(main())
