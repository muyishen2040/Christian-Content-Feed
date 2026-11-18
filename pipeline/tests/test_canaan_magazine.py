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
    assert batch["stats"]["rows"] == 5
    assert batch["stats"]["exact_duplicates_skipped"] == 1
    assert batch["stats"]["complete"] is True and batch["stats"]["failed_ranges"] == []


def test_import_is_idempotent_and_hashes_are_stable():
    first = m.build_batch({1: fixture_html()})
    second = m.build_batch({1: fixture_html()})
    assert first == second
    assert len({r["content_hash"] for r in first["testimonies"]}) == len(first["testimonies"])


def test_hash_ignores_whitespace_differences_in_the_title():
    a = m.CatalogEntry(1, "2030.1", "蒙恩 的 日子", "7", None)
    b = m.CatalogEntry(1, "2030.1", "蒙恩   的   日子", "7", None)
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


# ---- Stable ids (rows reordered or inserted) ------------------------------------------------

DATA_ROW_START = "<tr><td><a href=http"


def with_rows_reordered_and_inserted(html: str) -> str:
    lines = html.splitlines()
    idx = [i for i, line in enumerate(lines) if line.startswith(DATA_ROW_START)]
    rows = [lines[i] for i in idx]
    new_row = (
        "<tr><td><a href=https://example.invalid/issue900.pdf?dl=0>900</a><td>2030.1</td>"
        "<td><a href=https://example.invalid/900-9b.pdf?dl=0>新插入的虛構文章</a></td><td>虛構作者己</td>"
        "<td><a href=https://example.invalid/900-9b.pdf?dl=0>9</a></td><td></td><td></td></tr>"
    )
    shuffled = [new_row] + list(reversed(rows))
    for i, row in zip(idx, shuffled):
        lines[i] = row
    lines.insert(idx[-1] + 1, shuffled[-1] if len(shuffled) > len(idx) else new_row)
    return "\n".join(lines)


def ids_by_title(batch: dict) -> dict[str, tuple[str, str]]:
    return {r["title"]: (r["external_id"], r["content_hash"]) for r in batch["testimonies"]}


def test_ids_do_not_change_when_rows_are_reordered_or_an_article_is_inserted():
    original = ids_by_title(m.build_batch({1: fixture_html()}))
    changed_html = with_rows_reordered_and_inserted(fixture_html())
    assert changed_html != fixture_html()
    changed = ids_by_title(m.build_batch({1: changed_html}))
    assert "新插入的虛構文章" in changed  # the new article exists
    for title, ids in original.items():
        assert changed[title] == ids, title


def test_same_page_articles_get_distinct_ids_without_a_position_counter():
    batch = m.build_batch({1: fixture_html()})
    ids = [r["external_id"] for r in batch["testimonies"]]
    assert len(ids) == len(set(ids))
    assert all(i.startswith("ly9") for i in ids)


# ---- Failures are reported, never silent ----------------------------------------------------

def no_sleep(_seconds: float) -> None:
    pass


def test_http_200_error_page_is_a_reported_failure():
    batch = m.build_batch({3: "<html><body><h1>Service unavailable</h1></body></html>"})
    assert batch["testimonies"] == []
    assert batch["stats"]["complete"] is False
    assert batch["stats"]["failed_ranges"] == [{"range": 3, "reason": "range 3: response is not a catalog page"}]


def test_catalog_page_with_no_articles_is_a_reported_failure():
    empty = "<html><body><table><tr><td><B>期數</B></td><td><B>題目</B></td></tr></table></body></html>"
    batch = m.build_batch({5: empty})
    assert batch["stats"]["failed_ranges"][0]["range"] == 5
    assert batch["stats"]["complete"] is False


def test_failed_fetch_is_recorded_and_other_ranges_still_load():
    def fetcher(n: int) -> str:
        if n == 2:
            raise TimeoutError("timed out")
        return fixture_html()

    pages, failures = m.fetch_pages([1, 2, 3], fetcher=fetcher, retries=1, delay=0, sleep=no_sleep)
    assert sorted(pages) == [1, 3]
    assert [f["range"] for f in failures] == [2]
    assert "TimeoutError" in failures[0]["reason"]
    batch = m.build_batch(pages, failures)
    assert batch["stats"]["complete"] is False
    assert batch["stats"]["failed_ranges"][0]["range"] == 2
    assert batch["stats"]["rows"] == 5  # ranges 1 and 3 hold the same fixture; duplicates collapse


def test_fetch_retries_are_bounded_and_a_later_success_is_used():
    calls: list[int] = []

    def flaky(n: int) -> str:
        calls.append(n)
        if len(calls) < 3:
            raise OSError("temporary")
        return fixture_html()

    pages, failures = m.fetch_pages([1], fetcher=flaky, retries=2, delay=0, sleep=no_sleep)
    assert failures == [] and 1 in pages and len(calls) == 3

    calls.clear()

    def always_down(n: int) -> str:
        calls.append(n)
        raise OSError("down")

    pages, failures = m.fetch_pages([1], fetcher=always_down, retries=2, delay=0, sleep=no_sleep)
    assert pages == {} and len(failures) == 1 and len(calls) == 3  # 1 try + 2 retries, then stop


def test_main_exits_nonzero_on_an_http_200_error_page(monkeypatch):
    monkeypatch.setattr(m, "fetch_range", lambda n, timeout=30.0: "<html>Service unavailable</html>")
    assert m.main(["--range", "1", "--delay", "0", "--retries", "0"]) == 1


def test_main_exits_nonzero_on_a_timeout_and_names_the_range(monkeypatch, capsys):
    def boom(n, timeout=30.0):
        raise TimeoutError("timed out")

    monkeypatch.setattr(m, "fetch_range", boom)
    assert m.main(["--range", "2", "--delay", "0", "--retries", "0"]) == 1
    assert "range 2" in capsys.readouterr().err


def test_main_exits_zero_when_every_range_loads(monkeypatch):
    monkeypatch.setattr(m, "fetch_range", lambda n, timeout=30.0: fixture_html())
    assert m.main(["--range", "1", "--delay", "0"]) == 0
