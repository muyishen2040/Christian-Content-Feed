"""Load an importer batch into Supabase (the `sources` and `testimonies` tables from MUY-12).

Safety properties, each covered by a test in pipeline/tests/test_loader.py:
- Dry run is the default. Nothing is written unless `--apply` is passed.
- A batch that is incomplete or fails validation is refused before any write.
- Rows always land as unreviewed drafts: review `pending`, rights `pending`, publication `draft`,
  `published_at` null. The loader never publishes and never approves, whatever the batch says.
- Idempotent: a row whose (source, external_id) or content_hash already exists is skipped. Existing
  rows are never updated, so a person's later review decision, rights decision or hand-written
  summary is never overwritten by a re-import.
- An existing source is reused as is; its `rights_status` is never changed by an import.
- One bad row is reported by source and external_id and the rest of the batch still loads.
- Logs are structured counts and ids only: no titles, summaries, URLs or keys.
- A write needs `--confirm-host` to equal the host in SUPABASE_URL, so a wrong environment is
  refused. The service-role key is read from SUPABASE_SERVICE_ROLE_KEY and never printed.

Use staging credentials only (see MUY-46). The standard library only.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

CHUNK = 100
# Columns of public.testimonies the loader may set. Anything else in a batch row is dropped
# (for example `source_key` and `import_hint`).
TESTIMONY_COLUMNS = (
    "external_id", "content_hash", "content_type", "title", "excerpt", "body",
    "source_name", "source_url", "topics",
)
SOURCE_COLUMNS = ("name", "homepage_url", "rights_status", "rights_evidence_url", "private_import_notes")


class LoadRefused(Exception):
    """The batch must not be written. The message is safe to log."""


class StoreError(Exception):
    """A single write failed. The message is safe to log (no row contents)."""


class Store(Protocol):
    def find_source_id(self, name: str) -> str | None: ...
    def create_source(self, row: dict) -> str: ...
    def existing_keys(self, source_id: str) -> tuple[set[str], set[str]]:
        """Return (external_ids, content_hashes) already stored for this source."""
    def insert_testimonies(self, rows: list[dict]) -> None:
        """Insert rows in one request; raise StoreError if any row is rejected."""


@dataclass
class LoadResult:
    dry_run: bool
    source_key: str
    source_created: bool = False
    rows_in_batch: int = 0
    would_insert: int = 0
    inserted: int = 0
    skipped_existing: int = 0
    failed: list[dict] = field(default_factory=list)

    def log_line(self) -> str:
        """One structured, non-personal log line."""
        return json.dumps(
            {
                "job": "testimony_load",
                "source_key": self.source_key,
                "dry_run": self.dry_run,
                "source_created": self.source_created,
                "rows_in_batch": self.rows_in_batch,
                "would_insert": self.would_insert,
                "inserted": self.inserted,
                "skipped_existing": self.skipped_existing,
                "failed": len(self.failed),
                "failed_external_ids": [f["external_id"] for f in self.failed][:20],
            },
            sort_keys=True,
        )


def check_batch(batch: dict, problems: list[str]) -> None:
    """Refuse anything that could write a wrong or unsafe row."""
    stats = batch.get("stats") or {}
    if not stats.get("complete", False):
        failed = [f.get("range") for f in stats.get("failed_ranges", [])]
        raise LoadRefused(f"batch is incomplete (failed ranges: {failed}); nothing written")
    if problems:
        raise LoadRefused(f"batch failed validation with {len(problems)} problem(s); nothing written")
    if not batch.get("testimonies"):
        raise LoadRefused("batch has no rows; nothing written")
    if not str((batch.get("source") or {}).get("name") or "").strip():
        raise LoadRefused("batch source has no name; nothing written")


def to_db_row(row: dict, source_id: str) -> dict:
    """Map a batch row to a testimonies insert. Status columns are forced, never copied."""
    out = {k: row[k] for k in TESTIMONY_COLUMNS if k in row}
    out["source_id"] = source_id
    out.update(review_status="pending", rights_status="pending", publication_status="draft", published_at=None)
    return out


def load_batch(batch: dict, store: Store, source_key: str, apply: bool = False, problems: list[str] | None = None) -> LoadResult:
    check_batch(batch, problems or [])
    result = LoadResult(dry_run=not apply, source_key=source_key, rows_in_batch=len(batch["testimonies"]))

    source_row = {k: batch["source"].get(k) for k in SOURCE_COLUMNS}
    source_id = store.find_source_id(source_row["name"])
    if source_id is None:
        result.source_created = True
        # A new source always starts with rights pending, whatever the importer said.
        source_row["rights_status"] = "pending"
        if apply:
            source_id = store.create_source(source_row)
    seen_ext, seen_hash = store.existing_keys(source_id) if source_id else (set(), set())

    todo: list[dict] = []
    for row in batch["testimonies"]:
        if row["external_id"] in seen_ext or row["content_hash"] in seen_hash:
            result.skipped_existing += 1
            continue
        seen_ext.add(row["external_id"])
        seen_hash.add(row["content_hash"])
        todo.append(row)
    result.would_insert = len(todo)
    if not apply:
        return result

    for start in range(0, len(todo), CHUNK):
        chunk = todo[start:start + CHUNK]
        try:
            store.insert_testimonies([to_db_row(r, source_id) for r in chunk])
            result.inserted += len(chunk)
        except StoreError:
            # Retry one by one so a single bad row does not lose the rest of its chunk.
            for r in chunk:
                try:
                    store.insert_testimonies([to_db_row(r, source_id)])
                    result.inserted += 1
                except StoreError as exc:
                    result.failed.append({"source_key": source_key, "external_id": r["external_id"], "reason": str(exc)})
    return result


class RestStore:
    """Supabase PostgREST over HTTPS with the service-role key. Used only with `--apply`."""

    def __init__(self, base_url: str, service_key: str, timeout: float = 30.0) -> None:
        self.base = base_url.rstrip("/") + "/rest/v1"
        self.timeout = timeout
        self._headers = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        }

    def _request(self, method: str, path: str, body: object | None = None, prefer: str | None = None):
        headers = dict(self._headers)
        if prefer:
            headers["Prefer"] = prefer
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:  # noqa: S310 (https URL checked in main)
                raw = resp.read()
        except urllib.error.HTTPError as exc:
            exc.read()  # never include the response body: it can echo row contents
            raise StoreError(f"{method} {path.split('?')[0]} failed with HTTP {exc.code}") from None
        except OSError as exc:
            raise StoreError(f"{method} {path.split('?')[0]} failed ({type(exc).__name__})") from None
        return json.loads(raw) if raw else None

    def find_source_id(self, name: str) -> str | None:
        q = urllib.parse.urlencode({"select": "id", "name": f"eq.{name}", "limit": "1"})
        rows = self._request("GET", f"/sources?{q}")
        return rows[0]["id"] if rows else None

    def create_source(self, row: dict) -> str:
        rows = self._request("POST", "/sources", [row], prefer="return=representation")
        return rows[0]["id"]

    def existing_keys(self, source_id: str) -> tuple[set[str], set[str]]:
        ext: set[str] = set()
        hashes: set[str] = set()
        offset = 0
        while True:
            q = urllib.parse.urlencode({
                "select": "external_id,content_hash", "source_id": f"eq.{source_id}",
                "order": "id", "limit": "1000", "offset": str(offset),
            })
            page = self._request("GET", f"/testimonies?{q}")
            for r in page:
                if r.get("external_id"):
                    ext.add(r["external_id"])
                hashes.add(r["content_hash"])
            if len(page) < 1000:
                return ext, hashes
            offset += 1000

    def insert_testimonies(self, rows: list[dict]) -> None:
        self._request("POST", "/testimonies", rows, prefer="return=minimal")


def _store_from_env(confirm_host: str | None) -> RestStore:
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    parsed = urllib.parse.urlparse(url)
    if not url or not key:
        raise LoadRefused("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (staging values) to write")
    local = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    if parsed.scheme != "https" and not (local and parsed.scheme == "http"):
        raise LoadRefused("SUPABASE_URL must be https (http is allowed only for localhost)")
    if confirm_host != parsed.hostname:
        raise LoadRefused("--confirm-host must equal the host in SUPABASE_URL; nothing written")
    return RestStore(url, key)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("batch", type=Path, help="JSON batch written by an importer (--out)")
    ap.add_argument("--source-key", required=True, help="the importer's SOURCE_KEY, used in logs only")
    ap.add_argument("--apply", action="store_true", help="write to the database (default is a dry run)")
    ap.add_argument("--confirm-host", help="must equal the host in SUPABASE_URL when using --apply")
    args = ap.parse_args(argv)

    from pipeline.importers import canaan_magazine, donghu, luke54

    # Register each new importer here.
    adapters = {m.SOURCE_KEY: m for m in (canaan_magazine, donghu, luke54)}
    if args.source_key not in adapters:
        print(f"REFUSED: unknown source key {args.source_key!r}; known: {sorted(adapters)}", file=sys.stderr)
        return 2
    batch = json.loads(args.batch.read_text(encoding="utf-8"))

    try:
        problems = adapters[args.source_key].validate_batch(batch)
        store: Store = _store_from_env(args.confirm_host) if args.apply else _NoStore()
        result = load_batch(batch, store, args.source_key, apply=args.apply, problems=problems)
    except LoadRefused as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2
    print(result.log_line())
    for f in result.failed:
        print(f"FAILED: {f['source_key']} {f['external_id']}: {f['reason']}", file=sys.stderr)
    return 1 if result.failed else 0


class _NoStore:
    """Dry run without a database: nothing exists yet, so every row would be inserted."""

    def find_source_id(self, name: str) -> str | None:
        return None

    def create_source(self, row: dict) -> str:  # pragma: no cover - never called in a dry run
        raise AssertionError("dry run must not write")

    def existing_keys(self, source_id: str) -> tuple[set[str], set[str]]:
        return set(), set()

    def insert_testimonies(self, rows: list[dict]) -> None:  # pragma: no cover
        raise AssertionError("dry run must not write")


if __name__ == "__main__":
    raise SystemExit(main())
