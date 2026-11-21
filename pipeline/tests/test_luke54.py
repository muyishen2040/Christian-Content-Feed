import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[2]))

from pipeline import loader  # noqa: E402
from pipeline.importers import common, luke54  # noqa: E402
from pipeline.importers.common import FetchError, Fetcher  # noqa: E402
from pipeline.tests.test_loader import FakeStore  # noqa: E402

FIX = Path(__file__).parents[1] / "fixtures" / "luke54"
DESCRIPTIONS = ["我是虛構的人物", "我曾經迷路", "沒有第一人稱", "我走過虛構的低谷"]
AUTHOR = "synthetic-author"


def pages(ids=None):
    ids = ids or luke54.parse_sitemap((FIX / "sitemap.xml").read_text(encoding="utf-8"))
    return ids, {i: (FIX / f"article{i}.html").read_text(encoding="utf-8") for i in ids}


def batch():
    ids, p = pages()
    return luke54.build_batch(ids, p)


def test_sitemap_gives_unique_article_ids_newest_first_and_ignores_other_urls():
    ids = luke54.parse_sitemap((FIX / "sitemap.xml").read_text(encoding="utf-8"))
    assert ids == [900007, 900006, 900005, 900004, 900003, 900002, 900001]


def test_title_wrapper_is_stripped_and_prefix_kept_as_a_hint():
    html = (FIX / "article900001.html").read_text(encoding="utf-8")
    title, desc, prefix = luke54.parse_article(html)
    assert title == "虛構的見證：從迷路到回家" and prefix == "見證" and desc.startswith("我是虛構")
    assert luke54.parse_article((FIX / "article900002.html").read_text(encoding="utf-8"))[0::2] == ("走過虛構的曠野", "")


def test_only_the_head_is_read_so_a_meta_tag_in_the_body_is_ignored():
    html = ('<html><head><meta property="og:title" content="虛構的標題"/></head>'
            '<body><meta property="og:title" content="全能神 想死"/>'
            '<meta property="og:description" content="我 我 我"/></body></html>')
    assert luke54.parse_article(html) == ("虛構的標題", "", "")
    no_head_title = '<html><head></head><body><meta property="og:title" content="只在內文"/></body></html>'
    with pytest.raises(luke54.ArticleError):
        luke54.parse_article(no_head_title)


def test_a_page_without_og_title_is_an_error():
    with pytest.raises(luke54.ArticleError):
        luke54.parse_article((FIX / "article900007.html").read_text(encoding="utf-8"))


def test_batch_has_candidates_counts_rejects_holds_and_failures():
    b = batch()
    s = b["stats"]
    assert [r["external_id"] for r in b["testimonies"]] == ["luke54-900001", "luke54-900002", "luke54-900003"]
    assert [r["import_hint"] for r in b["testimonies"]] == ["likely_testimony", "likely_testimony", "needs_review"]
    assert s["rejected"] == {"not_a_testimony": 1, "excluded_source": 1}
    assert s["held_for_review"] == ["luke54-900005"]
    assert s["failed_items"] == [{"item": "luke54-900007", "reason": "no og:title"}]
    assert s["complete"] is False  # one unparseable page: the loader must refuse this batch


def test_crisis_and_excluded_items_are_never_rows_and_never_in_the_batch_text():
    text = json.dumps(batch(), ensure_ascii=False)
    for needle in ("想死", "全能神", "講道", "900004", "900006"):
        assert needle not in text
    assert "luke54-900005" in text  # held items are listed by id only, for a person to look at


def test_body_text_description_and_author_never_reach_the_batch():
    text = json.dumps(batch(), ensure_ascii=False)
    for needle in ("BODYMARKER", AUTHOR, *DESCRIPTIONS):
        assert needle not in text
    # The body of article 900001 contains crisis and excluded-source words. The importer must not
    # read the body, so that article is still a candidate.
    assert "luke54-900001" in text


def test_rows_are_unreviewed_drafts_that_link_to_the_article_and_validate_when_complete():
    ids, p = pages([900001, 900002, 900003])
    b = luke54.build_batch(ids, p)
    assert b["stats"]["complete"] and luke54.validate_batch(b) == []
    for r in b["testimonies"]:
        assert r["source_url"] == f"https://www.luke54.org/articles/{r['external_id'].split('-')[1]}"
        assert (r["review_status"], r["rights_status"], r["publication_status"]) == ("pending", "pending", "draft")
        assert r["body"] is None and r["source_name"] == luke54.SOURCE_NAME
    assert b["source"]["rights_status"] == "pending"


def test_ids_and_hashes_are_stable_across_order_and_title_edits():
    ids, p = pages([900001, 900002, 900003])
    first = luke54.build_batch(ids, p)
    again = luke54.build_batch(list(reversed(ids)), dict(reversed(list(p.items()))))
    assert first == again
    edited = dict(p)
    edited[900002] = edited[900002].replace("走過虛構的曠野", "改過的標題")
    changed = luke54.build_batch(ids, edited)
    assert [r["content_hash"] for r in changed["testimonies"]] == [r["content_hash"] for r in first["testimonies"]]
    assert [r["external_id"] for r in changed["testimonies"]] == [r["external_id"] for r in first["testimonies"]]


def test_a_fetch_failure_is_reported_by_id_and_the_rest_still_build():
    ids, p = pages([900001, 900002])
    b = luke54.build_batch(ids + [900003], p, failures=[{"item": "luke54-900003", "reason": "fetch failed (HTTP 500)"}])
    assert len(b["testimonies"]) == 2 and b["stats"]["complete"] is False
    assert b["stats"]["failed_items"] == [{"item": "luke54-900003", "reason": "fetch failed (HTTP 500)"}]


def fake_site(missing=()):
    robots = "User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin/\n"
    sitemap = (FIX / "sitemap.xml").read_text(encoding="utf-8")
    calls = []

    def get(url):
        calls.append(url)
        if url.endswith("/robots.txt"):
            return robots
        if url == luke54.SITEMAP_URL:
            return sitemap
        i = int(url.rsplit("/", 1)[1])
        if i in missing:
            raise FetchError("HTTP 404", 404)
        return (FIX / f"article{i}.html").read_text(encoding="utf-8")

    return Fetcher(get=get, delay=0, retries=0, sleep=lambda s: None), calls


def test_cli_fetches_through_the_polite_fetcher_and_honors_limit(tmp_path, capsys):
    fetcher, calls = fake_site()
    out = tmp_path / "b.json"
    code = luke54.main(["--limit", "3", "--out", str(out)], fetcher=fetcher)
    assert code == 1  # newest three are 900007 (no title), 900006, 900005
    articles = [c for c in calls if "/articles/" in c]
    assert articles == [f"https://www.luke54.org/articles/{i}" for i in (900007, 900006, 900005)]
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["stats"]["requested"] == 3 and data["stats"]["complete"] is False
    err = capsys.readouterr().err
    assert "BODYMARKER" not in err and "想死" not in err


def test_cli_reports_a_404_article_by_id_and_exits_nonzero(tmp_path, capsys):
    fetcher, _ = fake_site(missing={900001})
    assert luke54.main(["--limit", "7"], fetcher=fetcher) == 1
    assert "luke54-900001" in capsys.readouterr().err


def test_cli_refuses_when_robots_blocks_the_articles():
    fetcher = Fetcher(get=lambda u: "User-agent: GPTBot\nDisallow: /\n" if u.endswith("robots.txt") else "x",
                      delay=0, retries=0, sleep=lambda s: None)
    assert luke54.main(["--limit", "2"], fetcher=fetcher) == 2


def test_cli_works_offline_from_a_directory(tmp_path):
    assert luke54.main(["--from-dir", str(FIX), "--limit", "3", "--out", str(tmp_path / "b.json")]) == 1


def test_complete_batch_loads_through_the_loader_as_drafts_and_rerun_adds_nothing():
    ids, p = pages([900001, 900002, 900003])
    b = luke54.build_batch(ids, p)
    store = FakeStore()
    problems = luke54.validate_batch(b)
    first = loader.load_batch(b, store, luke54.SOURCE_KEY, apply=True, problems=problems)
    second = loader.load_batch(b, store, luke54.SOURCE_KEY, apply=True, problems=problems)
    assert first.inserted == 3 and second.inserted == 0 and second.skipped_existing == 3
    assert {t["publication_status"] for t in store.testimonies} == {"draft"}


def test_incomplete_luke54_batch_is_refused_by_the_loader():
    b = batch()
    with pytest.raises(loader.LoadRefused, match="incomplete"):
        loader.load_batch(b, FakeStore(), luke54.SOURCE_KEY, apply=True, problems=luke54.validate_batch(b))


def test_both_new_adapters_are_registered_with_the_loader_cli(tmp_path):
    ids, p = pages([900001])
    path = tmp_path / "b.json"
    path.write_text(json.dumps(luke54.build_batch(ids, p), ensure_ascii=False), encoding="utf-8")
    assert loader.main([str(path), "--source-key", "luke54"]) == 0
    assert loader.main([str(path), "--source-key", "donghu"]) == 0
    assert common.validate_batch  # shared validator is what both adapters expose
