"""The contract every source importer follows, so the loader can stay source-agnostic.

An importer turns a source into a *batch*: a plain dict with the shape below. It never writes to a
database. `pipeline/loader.py` is the only code that does, and only from a validated, complete batch.

    {
      "source":      {name, homepage_url, rights_status, rights_evidence_url, private_import_notes},
      "testimonies": [{source_key, external_id, content_hash, title, excerpt, source_name, ...}],
      "stats":       {rows, complete, failed_ranges, ...},
    }

Rules an importer must keep (the loader enforces them again before writing):
- every row is `review_status=pending`, `rights_status=pending`, `publication_status=draft`;
- no body text and no author names;
- `external_id` and `content_hash` are stable, so re-running the importer gives the same rows.
"""

from __future__ import annotations

from typing import Protocol


class SourceAdapter(Protocol):
    """A source-specific importer. Add one module per source and expose these three names."""

    SOURCE_KEY: str

    def build_batch(self, *args, **kwargs) -> dict:
        """Return a batch for this source. Must not touch a database."""

    def validate_batch(self, batch: dict) -> list[str]:
        """Return a list of problems with the batch; an empty list means it is valid."""
