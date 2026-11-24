"""Importer for 東湖禮拜堂 (https://dhchurch.org.tw), one of our two primary text sources.

The site is WordPress. Its REST API returns, for one category, only each post's id, link, title and
date (`_fields=id,link,title,date`), so no post body is ever requested.

- Only the 見證分享 category is read, because it sits beside event posts and sermons. The category id
  is looked up by exact name and the import refuses to run if it is not exactly one category.
- Titles carry a generic 《見證分享》 prefix that is removed. Titles can still contain a person's name;
  a person must check each one before it is approved (no author names are stored).
- Items are classified by title with `common.classify`: sermons and announcements are rejected and
  crisis-adjacent titles are held out of the batch.
- Rows are unreviewed drafts with a placeholder excerpt and no topics (our own summary is a later
  step, MUY-49). `external_id` is `donghu-<post id>`; `content_hash` depends only on source and id.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlencode, urlparse

from pipeline.importers import common
from pipeline.importers.common import Fetcher, FetchError, RobotsDisallowed, clean_text

BASE = "https://dhchurch.org.tw"
API = BASE + "/wp-json/wp/v2"
CATEGORY_NAME = "見證分享"
SOURCE_KEY = "donghu"
SOURCE_NAME = "東湖禮拜堂"
PER_PAGE = 100
MAX_PAGES = 50  # hard bound: 5,000 posts

validate_batch = common.validate_batch

_PREFIX = re.compile(r"^\s*[《〈]\s*見證分享\s*[》〉]\s*[-－–—:：]*\s*")


class ApiError(Exception):
    """The API answered with something unexpected. The message is a fixed label."""


def clean_title(raw: str) -> str:
    title = clean_text(html.unescape(raw))
    return clean_text(_PREFIX.sub("", title)) or title


def category_id(payload_text: str) -> int:
    """The id of the one category named exactly 見證分享."""
    try:
        matches = [c for c in json.loads(payload_text) if c.get("name") == CATEGORY_NAME]
    except (ValueError, AttributeError):
        raise ApiError("categories response is not JSON") from None
    if len(matches) != 1:
        raise ApiError(f"expected exactly one category named {CATEGORY_NAME}, found {len(matches)}")
    return int(matches[0]["id"])


def parse_posts(payload_text: str) -> list[dict]:
    try:
        posts = json.loads(payload_text)
        return [{"id": int(p["id"]), "link": p["link"], "title": p["title"]["rendered"]} for p in posts]
    except (ValueError, KeyError, TypeError):
        raise ApiError("posts response is malformed") from None


def to_source_row() -> dict:
    return {
        "name": SOURCE_NAME,
        "homepage_url": BASE,
        "rights_status": "pending",
        "rights_evidence_url": None,
        "private_import_notes": (
            "robots.txt (Yoast) has an empty Disallow; footer is a copyright line with no reuse terms. "
            "Only the 見證分享 category is read, via the WordPress REST API (id, link, title only). "
            "Public availability is not permission. Link-out only. Approve rights before publishing."
        ),
    }


def build_batch(posts: list[dict], failures: list[dict] | None = None) -> dict:
    stats = common.new_stats()
    for f in failures or []:
        common.record_failure(stats, f["item"], f["reason"])
    rows: list[dict] = []
    seen: set[int] = set()
    for post in sorted(posts, key=lambda p: p["id"]):
        if post["id"] in seen:
            continue
        seen.add(post["id"])
        item = f"donghu-{post['id']}"
        title = clean_title(post["title"])
        url = post["link"]
        if urlparse(url).netloc != urlparse(BASE).netloc or urlparse(url).scheme != "https":
            common.record_failure(stats, item, "link is not an https dhchurch.org.tw URL")
            continue
        verdict = common.classify(title)
        if not common.record_verdict(stats, item, verdict):
            continue
        rows.append(common.to_row(
            source_key=SOURCE_KEY, source_name=SOURCE_NAME, external_id=item,
            content_hash=common.stable_hash(SOURCE_KEY, str(post["id"])),
            title=title, url=url, hint=verdict.hint,  # the category alone is not proof: see needs_review
        ))
    stats["rows"] = len(rows)
    stats["requested"] = len(seen)
    stats["held_for_review"].sort()
    stats["failed_items"].sort(key=lambda f: f["item"])
    return {"source": to_source_row(), "testimonies": rows, "stats": stats}


PAST_END_CODE = "rest_post_invalid_page_number"


def fetch_posts(fetcher: Fetcher) -> tuple[list[dict], list[dict]]:
    """Fetch every post in the 見證分享 category, one bounded page at a time."""
    cat = category_id(fetcher.get(f"{API}/categories?" + urlencode({"search": CATEGORY_NAME, "_fields": "id,name"})))
    posts: list[dict] = []
    for page in range(1, MAX_PAGES + 1):
        query = urlencode({"categories": cat, "per_page": PER_PAGE, "page": page,
                           "orderby": "id", "order": "asc", "_fields": "id,link,title"})
        try:
            batch = parse_posts(fetcher.get(f"{API}/posts?{query}"))
        except FetchError as exc:
            # WordPress answers 400 `rest_post_invalid_page_number` for a page past the last. Any other
            # 400 is a real failure and must leave the batch incomplete, not look like a clean end.
            if exc.status == 400 and exc.code == PAST_END_CODE and page > 1:
                return posts, []
            return posts, [{"item": f"donghu-page-{page}", "reason": f"fetch failed ({exc})"}]
        posts.extend(batch)
        if len(batch) < PER_PAGE:
            return posts, []
    return posts, [{"item": "donghu-pages", "reason": f"more than {MAX_PAGES} pages"}]


def main(argv: list[str] | None = None, fetcher: Fetcher | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--from-file", type=Path, help="read a saved posts JSON array instead of fetching")
    ap.add_argument("--out", type=Path, help="write the JSON batch here instead of only printing a summary")
    ap.add_argument("--delay", type=float, default=1.0, help="seconds between requests (default 1)")
    ap.add_argument("--retries", type=int, default=2, help="retries per request after a failed fetch (default 2)")
    args = ap.parse_args(argv)

    try:
        if args.from_file:
            posts, failures = parse_posts(args.from_file.read_text(encoding="utf-8")), []
        else:
            posts, failures = fetch_posts(fetcher or Fetcher(delay=args.delay, retries=args.retries))
    except (ApiError, FetchError, RobotsDisallowed, OSError) as exc:
        print(f"REFUSED: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2
    if not posts:
        print("REFUSED: no posts found", file=sys.stderr)
        return 2
    batch = build_batch(posts, failures)
    return common.finish_cli(batch, validate_batch(batch), args.out)


if __name__ == "__main__":
    raise SystemExit(main())
