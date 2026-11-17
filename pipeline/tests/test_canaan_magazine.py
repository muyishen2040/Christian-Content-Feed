import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[2]))

from pipeline.importers import canaan_magazine as m  # noqa: E402

FIXTURE = Path(__file__).parents[1] / "fixtures" / "canaan_magazine_range_sample.html"


def fixture_html() -> str:
    return FIXTURE.read_text(encoding="utf-8")


def test_parses_articles_and_skips_header_and_cover_rows():
    entries = m.parse_catalog(fixture_html())
    assert [e.title for e in entries] == [
        "虛構的見證：從迷路到回家",
        "編輯室報告",
        "暑期營會回顧",
        "暑期營會回顧",
        "感恩的一年 （無連結）",
        "蒙恩 的 日子",
    ]
    assert entries[0].issue == 900 and entries[0].date == "2030.1" and entries[0].page == "1"


def test_ideographic_space_in_a_title_collapses_to_one_normal_space():
    titles = [e.title for e in m.parse_catalog(fixture_html())]
    assert "感恩的一年 （無連結）" in titles  # the fixture has U+3000 here


def test_titles_keep_the_sources_own_punctuation():
    # NFKC would turn the fullwidth colon into ':' and must only be used for the hash.
    assert m.parse_catalog(fixture_html())[0].title == "虛構的見證：從迷路到回家"


def test_missing_link_is_none_and_http_links_become_https():
    entries = {e.title: e for e in m.parse_catalog(fixture_html())}
    assert entries["感恩的一年 （無連結）"].pdf_url is None
    assert entries["蒙恩 的 日子"].pdf_url == "https://example.invalid/901-7.pdf?dl=0"


def test_rows_match_the_testimonies_table_and_are_never_published():
    batch = m.build_batch({1: fixture_html()})
    assert m.validate_batch(batch) == []
    for row in batch["testimonies"]:
        assert row["content_type"] == "testimony"
        assert row["review_status"] == "pending"
        assert row["rights_status"] == "pending"
        assert row["publication_status"] == "draft"
        assert row["published_at"] is None and row["body"] is None
        assert row["excerpt"].strip() and row["source_name"] == m.SOURCE_NAME


def test_source_row_leaves_rights_pending():
    source = m.to_source_row()
    assert source["rights_status"] == "pending"
    assert source["name"].strip()


def test_no_author_names_in_output():
    text = repr(m.build_batch({1: fixture_html()}))
    for author in ("虛構作者甲", "虛構作者乙", "虛構作者丙", "虛構作者丁", "虛構作者戊"):
        assert author not in text


def test_exact_duplicate_rows_collapse_and_are_counted():
    batch = m.build_batch({1: fixture_html()})
    assert len(batch["testimonies"]) == 5
    assert batch["stats"] == {"rows": 5, "exact_duplicates_skipped": 1}


def test_import_is_idempotent_and_hashes_are_stable():
    first = m.build_batch({1: fixture_html()})
    second = m.build_batch({1: fixture_html()})
    assert first == second
    assert len({r["content_hash"] for r in first["testimonies"]}) == len(first["testimonies"])


def test_hash_ignores_whitespace_differences_in_the_title():
    a = m.CatalogEntry(1, "2030.1", "蒙恩 的 日子", "7", None, 1)
    b = m.CatalogEntry(1, "2030.1", "蒙恩   的   日子", "7", None, 1)
    assert m.content_hash(a) == m.content_hash(b)


def test_import_hint_is_a_guess_for_a_human_to_check():
    hints = {r["title"]: r["import_hint"] for r in m.build_batch({1: fixture_html()})["testimonies"]}
    assert hints["虛構的見證：從迷路到回家"] == "maybe_testimony"
    assert hints["編輯室報告"] == "unlikely"


def test_validator_rejects_published_rows_and_duplicate_hashes():
    batch = m.build_batch({1: fixture_html()})
    batch["testimonies"][0]["publication_status"] = "published"
    batch["testimonies"][1]["content_hash"] = batch["testimonies"][0]["content_hash"]
    problems = m.validate_batch(batch)
    assert any("never publish" in p for p in problems)
    assert any("duplicate content_hash" in p for p in problems)
