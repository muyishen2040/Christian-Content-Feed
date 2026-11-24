"""Shared pieces for source importers: polite fetching, a first-pass classifier, row building and
batch validation. The standard library only. Nothing here writes to a database.

Rules this module enforces for every importer that uses it:
- robots.txt is read first. A URL is fetched only if it is allowed for our own agent AND for the
  well-known AI crawlers, so a site that blocks AI crawlers is not read.
- Requests are rate limited and retries are bounded.
- Page text may be read transiently to classify an item. It is never returned in a row, a batch,
  a log line or an error message.
- Items that look like crisis content are held out of the batch entirely (counted, never emitted
  as rows) so they cannot reach the feed; sermons, announcements and excluded sources are rejected.
- Every row is an unreviewed draft: review `pending`, rights `pending`, publication `draft`.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

USER_AGENT = "ChristianContentFeedImporter/0.1 (link-out catalog; metadata only)"
OUR_AGENT = "ChristianContentFeedImporter"
# robots.txt rules for any of these block us too: a site that blocks AI crawlers has said no.
AI_CRAWLER_AGENTS = ("GPTBot", "ClaudeBot", "anthropic-ai", "CCBot", "Google-Extended", "PerplexityBot")

REVIEW_STATUSES = {"pending", "approved", "rejected"}
RIGHTS_STATUSES = {"pending", "approved", "rejected", "revoked"}
PUBLICATION_STATUSES = {"draft", "published", "unpublished"}

PLACEHOLDER_EXCERPT = "來源連結見證，摘要待人工撰寫。"

_CRISIS = re.compile(r"自殺|輕生|尋死|自殘|割腕|想死|不想活|憂鬱症|家暴|性侵|虐待")
_EXCLUDED_DOCTRINE = re.compile(r"真耶穌教會|真耶稣教会|全能神|東方閃電|东方闪电")
_NOT_TESTIMONY = re.compile(r"查經|講道|主日信息|證道|公告|報名|招募|課程|研討會|週報|代禱事項|如何.{0,6}見證|見證.{0,4}(指南|教學)")


class FetchError(OSError):
    """A fetch failed. `status` is the HTTP status, or None for a network error. Safe to log."""

    def __init__(self, message: str, status: int | None = None, code: str | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code  # machine code from a JSON error body (for example a WordPress REST code), never the body


class RobotsDisallowed(Exception):
    """robots.txt (for us or for an AI crawler) does not allow this URL. Never retried."""


def _error_code(body: bytes) -> str | None:
    """The short `code` field of a JSON error body, or None. Nothing else from the body is kept."""
    try:
        code = json.loads(body.decode("utf-8", errors="replace")).get("code")
    except (ValueError, AttributeError):
        return None
    return code if isinstance(code, str) and len(code) <= 64 else None


def http_get(url: str, timeout: float = 30.0) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (https URLs only, checked by Fetcher)
            return resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        raise FetchError(f"HTTP {exc.code}", exc.code, _error_code(exc.read(65536))) from None
    except OSError as exc:
        raise FetchError(type(exc).__name__) from None


class RobotsGuard:
    def __init__(self, robots_text: str) -> None:
        self._parser = RobotFileParser()
        self._parser.parse(robots_text.splitlines())

    def allowed(self, url: str) -> bool:
        return all(self._parser.can_fetch(agent, url) for agent in (OUR_AGENT, *AI_CRAWLER_AGENTS))


class Fetcher:
    """Rate-limited GET with bounded retries and a robots.txt check per host."""

    def __init__(
        self,
        get: Callable[[str], str] = http_get,
        delay: float = 1.0,
        retries: int = 2,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._get, self.delay, self.retries, self._sleep = get, delay, retries, sleep
        self._guards: dict[str, RobotsGuard] = {}
        self._first = True

    def _guard(self, url: str) -> RobotsGuard:
        parts = urlparse(url)
        host = f"{parts.scheme}://{parts.netloc}"
        if host not in self._guards:
            try:
                text = self._request(host + "/robots.txt")
            except FetchError as exc:
                if exc.status != 404:  # 404 means "no rules"; anything else, do not guess
                    raise
                text = ""
            self._guards[host] = RobotsGuard(text)
        return self._guards[host]

    def _request(self, url: str) -> str:
        if urlparse(url).scheme != "https":
            raise FetchError("only https URLs are fetched")
        last: FetchError | None = None
        for attempt in range(self.retries + 1):
            if not self._first:
                self._sleep(self.delay * (attempt or 1))
            self._first = False
            try:
                return self._get(url)
            except FetchError as exc:
                last = exc
                if exc.status is not None and exc.status < 500 and exc.status != 429:
                    break  # a definite answer such as 404; retrying will not change it
        assert last is not None
        raise last

    def get(self, url: str) -> str:
        if not url.endswith("/robots.txt") and not self._guard(url).allowed(url):
            raise RobotsDisallowed("blocked by robots.txt")
        return self._request(url)


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def normalize_text(value: str) -> str:
    return clean_text(unicodedata.normalize("NFKC", value))


def stable_hash(*parts: str) -> str:
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class Verdict:
    decision: str  # "candidate" (becomes a draft row), "reject", or "hold" (crisis-adjacent)
    hint: str      # "likely_testimony" or "needs_review"; meaningful only for candidates
    reason: str    # a fixed label, never page text


def classify(title: str, description: str = "") -> Verdict:
    """First-pass filter. `description` is page text read transiently: it is only matched against
    patterns here and is never stored, returned or logged. A person still has to confirm every
    candidate by reading it; this only removes items that clearly should not be rows."""
    text = f"{title}\n{description}"
    if _EXCLUDED_DOCTRINE.search(text):
        return Verdict("reject", "needs_review", "excluded_source")
    if _CRISIS.search(text):
        return Verdict("hold", "needs_review", "crisis_adjacent")
    if _NOT_TESTIMONY.search(title):
        return Verdict("reject", "needs_review", "not_a_testimony")
    if "見證" in title or len(re.findall("我", description)) >= 2:
        return Verdict("candidate", "likely_testimony", "ok")
    return Verdict("candidate", "needs_review", "ok")


def to_row(*, source_key: str, source_name: str, external_id: str, content_hash: str, title: str,
           url: str, hint: str) -> dict:
    """Row for public.testimonies without id and source_id (the loader resolves source_id)."""
    return {
        "source_key": source_key,  # loader replaces this with source_id
        "external_id": external_id,
        "content_hash": content_hash,
        "content_type": "testimony",
        "title": title,
        "excerpt": PLACEHOLDER_EXCERPT,
        "body": None,
        "source_name": source_name,
        "source_url": url,
        "topics": [],
        "review_status": "pending",
        "rights_status": "pending",
        "publication_status": "draft",
        "published_at": None,
        "import_hint": hint,  # not a table column; the loader drops it
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
        if r.get("body") is not None:
            problems.append(f"{where}: body text must not be stored")
        if "author" in r:
            problems.append(f"{where}: author names must not be stored")
        if r["content_hash"] in hashes:
            problems.append(f"{where}: duplicate content_hash")
        hashes.add(r["content_hash"])
        if r["external_id"] in ext:
            problems.append(f"{where}: duplicate external_id")
        ext.add(r["external_id"])
    return problems


def new_stats() -> dict:
    return {"rows": 0, "rejected": {}, "held_for_review": [], "failed_items": [], "complete": True}


def record_verdict(stats: dict, item_id: str, verdict: Verdict) -> bool:
    """Count a reject or hold. Returns True when the item should become a row."""
    if verdict.decision == "reject":
        stats["rejected"][verdict.reason] = stats["rejected"].get(verdict.reason, 0) + 1
        return False
    if verdict.decision == "hold":
        stats["held_for_review"].append(item_id)  # an id only, never a title or text
        return False
    return True


def record_failure(stats: dict, item_id: str, reason: str) -> None:
    stats["failed_items"].append({"item": item_id, "reason": reason})
    stats["complete"] = False


def finish_cli(batch: dict, problems: list[str], out: Path | None) -> int:
    """Print a non-personal summary, optionally write the batch, and return the exit code."""
    s = batch["stats"]
    hints = sum(r["import_hint"] == "likely_testimony" for r in batch["testimonies"])
    print(
        f"rows={s['rows']} likely_testimony={hints} rejected={sum(s['rejected'].values())} "
        f"held_for_review={len(s['held_for_review'])} failed={len(s['failed_items'])} "
        f"complete={s['complete']} problems={len(problems)}",
        file=sys.stderr,
    )
    for f in s["failed_items"][:20]:
        print(f"FAILED: {f['item']}: {f['reason']}", file=sys.stderr)
    for p in problems[:20]:
        print("PROBLEM:", p, file=sys.stderr)
    if out:
        out.write_text(json.dumps(batch, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 1 if problems or not s["complete"] else 0
