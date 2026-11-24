import json
import sys
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[2]))

from pipeline import loader  # noqa: E402
from pipeline.importers import canaan_magazine as canaan  # noqa: E402

FIXTURE = Path(__file__).parents[1] / "fixtures" / "canaan_magazine_range_sample.html"
SOURCE_KEY = canaan.SOURCE_KEY


class FakeStore:
    """In-memory stand-in for public.sources and public.testimonies. It enforces the same unique
    constraints and the published_requires_approval check, so the loader is tested against the
    rules the real table applies."""

    def __init__(self) -> None:
        self.sources: dict[str, dict] = {}
        self.testimonies: list[dict] = []
        self.reject_external_ids: set[str] = set()
        self.calls = 0

    def find_source_id(self, name):
        return next((i for i, s in self.sources.items() if s["name"] == name), None)

    def create_source(self, row):
        self.calls += 1
        sid = str(uuid.uuid4())
        self.sources[sid] = dict(row)
        return sid

    def existing_keys(self, source_id):
        rows = [t for t in self.testimonies if t["source_id"] == source_id]
        return {t["external_id"] for t in rows}, {t["content_hash"] for t in rows}

    def insert_testimonies(self, rows):
        self.calls += 1
        staged = list(self.testimonies)
        for r in rows:
            if r["external_id"] in self.reject_external_ids:
                raise loader.StoreError("POST /testimonies failed with HTTP 400")
            if any(t["content_hash"] == r["content_hash"] or
                   (t["source_id"] == r["source_id"] and t["external_id"] == r["external_id"]) for t in staged):
                raise loader.StoreError("POST /testimonies failed with HTTP 409")
            if r["publication_status"] == "published" and not (
                r["review_status"] == "approved" and r["rights_status"] == "approved"
            ):
                raise loader.StoreError("POST /testimonies failed with HTTP 400")
            staged.append(dict(r))
        self.testimonies = staged


def sample_batch() -> dict:
    """Real importer output for the synthetic catalog fixture (six rows, one exact duplicate)."""
    return canaan.build_batch({1: FIXTURE.read_text(encoding="utf-8")})


def run(batch, store, **kw):
    return loader.load_batch(batch, store, SOURCE_KEY, problems=canaan.validate_batch(batch), **kw)


def test_dry_run_writes_nothing_and_reports_what_would_load():
    store = FakeStore()
    batch = sample_batch()
    result = run(batch, store)
    assert result.dry_run and result.would_insert == len(batch["testimonies"]) and result.inserted == 0
    assert store.sources == {} and store.testimonies == [] and store.calls == 0


def test_apply_inserts_rows_as_unreviewed_drafts_for_a_pending_source():
    store = FakeStore()
    batch = sample_batch()
    result = run(batch, store, apply=True)
    assert result.inserted == len(batch["testimonies"]) == len(store.testimonies)
    assert result.source_created
    (source,) = store.sources.values()
    assert source["rights_status"] == "pending"
    for t in store.testimonies:
        assert (t["review_status"], t["rights_status"], t["publication_status"]) == ("pending", "pending", "draft")
        assert t["published_at"] is None and t["source_id"] in store.sources
        assert "import_hint" not in t and "source_key" not in t and t.get("body") is None


def test_rerunning_the_same_import_creates_no_duplicates():
    store = FakeStore()
    batch = sample_batch()
    first = run(batch, store, apply=True)
    second = run(batch, store, apply=True)
    assert second.inserted == 0 and second.skipped_existing == first.inserted
    assert len(store.testimonies) == first.inserted and len(store.sources) == 1
    assert len({t["content_hash"] for t in store.testimonies}) == len(store.testimonies)


def test_reimport_never_overwrites_a_persons_review_decisions_or_summary():
    store = FakeStore()
    batch = sample_batch()
    run(batch, store, apply=True)
    target = store.testimonies[0]
    target.update(excerpt="Our own summary.", review_status="approved", rights_status="approved",
                  publication_status="published", published_at="2030-01-01T00:00:00Z")
    (sid,) = store.sources
    store.sources[sid]["rights_status"] = "approved"
    run(batch, store, apply=True)
    assert store.testimonies[0]["excerpt"] == "Our own summary."
    assert store.testimonies[0]["publication_status"] == "published"
    assert store.sources[sid]["rights_status"] == "approved"


def test_a_batch_that_says_approved_or_published_is_still_written_as_a_draft():
    store = FakeStore()
    batch = sample_batch()
    batch["source"]["rights_status"] = "approved"
    for r in batch["testimonies"]:
        r.update(review_status="approved", rights_status="approved", publication_status="published")
    # Validation would normally catch this; the loader must hold even if it is bypassed.
    loader.load_batch(batch, store, SOURCE_KEY, apply=True, problems=[])
    assert {t["publication_status"] for t in store.testimonies} == {"draft"}
    assert {t["rights_status"] for t in store.testimonies} == {"pending"}
    assert next(iter(store.sources.values()))["rights_status"] == "pending"


def test_incomplete_batch_is_refused_before_any_write():
    store = FakeStore()
    batch = canaan.build_batch({1: FIXTURE.read_text(encoding="utf-8")},
                               failures=[{"range": 2, "reason": "range 2: fetch failed"}])
    with pytest.raises(loader.LoadRefused, match=r"incomplete.*\[2\]"):
        run(batch, store, apply=True)
    assert store.calls == 0 and store.testimonies == []


def test_invalid_or_empty_batch_is_refused():
    store = FakeStore()
    batch = sample_batch()
    batch["testimonies"][0]["publication_status"] = "published"
    with pytest.raises(loader.LoadRefused, match="validation"):
        run(batch, store, apply=True)
    empty = canaan.build_batch({})
    with pytest.raises(loader.LoadRefused):
        loader.load_batch(empty, store, SOURCE_KEY, apply=True, problems=[])
    assert store.calls == 0


def test_one_rejected_row_is_reported_by_id_and_the_rest_still_load():
    store = FakeStore()
    batch = sample_batch()
    bad = batch["testimonies"][2]["external_id"]
    store.reject_external_ids = {bad}
    result = run(batch, store, apply=True)
    assert [f["external_id"] for f in result.failed] == [bad]
    assert result.failed[0]["source_key"] == SOURCE_KEY
    assert result.inserted == len(batch["testimonies"]) - 1
    assert bad not in {t["external_id"] for t in store.testimonies}


def test_failed_rows_load_on_a_later_run_without_duplicating_the_others():
    store = FakeStore()
    batch = sample_batch()
    store.reject_external_ids = {batch["testimonies"][0]["external_id"]}
    run(batch, store, apply=True)
    store.reject_external_ids = set()
    again = run(batch, store, apply=True)
    assert again.inserted == 1 and not again.failed
    assert len(store.testimonies) == len(batch["testimonies"])


def test_large_batches_are_written_in_bounded_chunks(monkeypatch):
    monkeypatch.setattr(loader, "CHUNK", 2)
    store = FakeStore()
    batch = sample_batch()
    result = run(batch, store, apply=True)
    # one create_source call plus ceil(n / 2) insert calls
    assert store.calls == 1 + -(-len(batch["testimonies"]) // 2) and result.inserted == len(batch["testimonies"])


def test_log_line_has_counts_and_ids_but_no_titles_or_urls():
    store = FakeStore()
    batch = sample_batch()
    store.reject_external_ids = {batch["testimonies"][0]["external_id"]}
    line = run(batch, store, apply=True).log_line()
    data = json.loads(line)
    assert data["inserted"] == len(batch["testimonies"]) - 1 and data["failed"] == 1
    for r in batch["testimonies"]:
        assert r["title"] not in line and r["excerpt"] not in line
        assert not r["source_url"] or r["source_url"] not in line


def test_write_needs_credentials_https_and_a_matching_host(monkeypatch):
    for var in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
        monkeypatch.delenv(var, raising=False)
    with pytest.raises(loader.LoadRefused, match="SUPABASE_URL"):
        loader._store_from_env("x.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")
    monkeypatch.setenv("SUPABASE_URL", "http://x.supabase.co")
    with pytest.raises(loader.LoadRefused, match="https"):
        loader._store_from_env("x.supabase.co")
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
    with pytest.raises(loader.LoadRefused, match="confirm-host"):
        loader._store_from_env("other.supabase.co")
    with pytest.raises(loader.LoadRefused, match="confirm-host"):
        loader._store_from_env(None)
    assert isinstance(loader._store_from_env("x.supabase.co"), loader.RestStore)


def test_cli_dry_run_reads_a_batch_file_and_exits_zero(tmp_path, capsys):
    path = tmp_path / "batch.json"
    path.write_text(json.dumps(sample_batch(), ensure_ascii=False), encoding="utf-8")
    assert loader.main([str(path), "--source-key", SOURCE_KEY]) == 0
    assert json.loads(capsys.readouterr().out)["dry_run"] is True


def test_cli_refuses_incomplete_batch_unknown_source_and_unconfirmed_apply(tmp_path, monkeypatch, capsys):
    incomplete = canaan.build_batch({1: FIXTURE.read_text(encoding="utf-8")},
                                    failures=[{"range": 3, "reason": "x"}])
    path = tmp_path / "batch.json"
    path.write_text(json.dumps(incomplete, ensure_ascii=False), encoding="utf-8")
    assert loader.main([str(path), "--source-key", SOURCE_KEY]) == 2
    assert loader.main([str(path), "--source-key", "nope"]) == 2
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")
    assert loader.main([str(path), "--source-key", SOURCE_KEY, "--apply"]) == 2
    assert "test-key" not in capsys.readouterr().err


class _Resp:
    def __init__(self, payload): self._p = json.dumps(payload).encode()
    def read(self): return self._p
    def __enter__(self): return self
    def __exit__(self, *a): return False


def test_rest_store_sends_expected_requests_and_never_leaks_error_bodies(monkeypatch):
    seen = []

    def fake_urlopen(req, timeout):
        seen.append((req.get_method(), req.full_url, req.get_header("Prefer"), req.data))
        if req.get_method() == "POST" and req.full_url.endswith("/testimonies"):
            import io, urllib.error
            raise urllib.error.HTTPError(req.full_url, 409, "dup", {}, io.BytesIO(b'{"details":"secret title"}'))
        if "/sources" in req.full_url and req.get_method() == "GET":
            return _Resp([{"id": "s1"}])
        return _Resp([{"external_id": "a", "content_hash": "h"}])

    monkeypatch.setattr(loader.urllib.request, "urlopen", fake_urlopen)
    store = loader.RestStore("https://x.supabase.co/", "test-key")
    assert store.find_source_id("name") == "s1"
    assert store.existing_keys("s1") == ({"a"}, {"h"})
    with pytest.raises(loader.StoreError) as err:
        store.insert_testimonies([{"external_id": "a"}])
    assert "409" in str(err.value) and "secret title" not in str(err.value)
    assert seen[0][1].startswith("https://x.supabase.co/rest/v1/sources?")
    assert seen[-1][2] == "return=minimal"


def test_dry_run_log_says_it_did_not_check_the_database():
    dry = json.loads(run(sample_batch(), FakeStore()).log_line())
    assert dry["database_checked"] is False and "upper bound" in dry["note"]
    applied = json.loads(run(sample_batch(), FakeStore(), apply=True).log_line())
    assert "database_checked" not in applied
