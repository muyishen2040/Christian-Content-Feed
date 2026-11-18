import json
from pathlib import Path
from urllib.parse import urlparse

SAMPLE = Path(__file__).parents[1] / "fixtures" / "approved_sample.json"
REQUIRED = {"id", "source", "title", "url", "url_level", "language", "preview", "tags", "rights_status", "rights_evidence", "flags"}
EXCLUDED_HOSTS = {"joy.org.tw", "www.joy.org.tw", "testifygod.com", "www.testifygod.com", "www.goodtv.tv", "www.breadoflife.taipei"}


def load():
    return json.loads(SAMPLE.read_text(encoding="utf-8"))["records"]


def test_ten_records_from_ten_distinct_sources():
    records = load()
    assert len(records) == 10
    assert len({r["source"] for r in records}) == 10
    assert len({urlparse(r["url"]).netloc for r in records}) == 10
    assert len({r["id"] for r in records}) == 10


def test_every_record_has_required_link_out_fields():
    for r in load():
        assert REQUIRED <= r.keys(), r["id"]
        assert r["url"].startswith("https://"), r["id"]
        assert r["rights_status"] == "link_out", r["id"]
        assert r["url_level"] in {"item", "item_anchor", "page"}, r["id"]
        assert r["preview"].strip() and r["tags"], r["id"]


def test_summaries_are_short_and_not_pasted_source_text():
    for r in load():
        assert len(r["preview"]) <= 80, r["id"]


def test_at_most_one_record_lacks_its_own_testimony_url():
    weak = [r["id"] for r in load() if r["url_level"] != "item"]
    assert len(weak) <= 1, weak


def test_every_record_has_an_empty_review_block_for_the_reviewer():
    for r in load():
        assert set(r["review"]) == {"reviewer", "decision", "reason", "reviewed_on"}, r["id"]


def test_no_excluded_sources():
    for r in load():
        assert urlparse(r["url"]).netloc not in EXCLUDED_HOSTS, r["id"]
