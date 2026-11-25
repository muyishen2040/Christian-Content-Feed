import json
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

sys.path.insert(0, str(Path(__file__).parents[2]))

from pipeline import loader  # noqa: E402
from pipeline.importers import donghu  # noqa: E402
from pipeline.importers.common import FetchError, Fetcher  # noqa: E402
from pipeline.tests.test_loader import FakeStore  # noqa: E402

FIX = Path(__file__).parents[1] / "fixtures" / "donghu"
POSTS = (FIX / "posts.json").read_text(encoding="utf-8")
CATEGORIES = (FIX / "categories.json").read_text(encoding="utf-8")


def batch():
    return donghu.build_batch(donghu.parse_posts(POSTS))


def test_category_is_found_by_exact_name_only():
    assert donghu.category_id(CATEGORIES) == 67
    with pytest.raises(donghu.ApiError, match="found 0"):
        donghu.category_id('[{"id": 1, "name": "見證分享活動"}]')
    with pytest.raises(donghu.ApiError, match="found 2"):
        donghu.category_id('[{"id": 1, "name": "見證分享"}, {"id": 2, "name": "見證分享"}]')
    with pytest.raises(donghu.ApiError):
        donghu.category_id("<html>")


def test_titles_lose_the_generic_prefix_and_html_entities():
    assert donghu.clean_title("《見證分享》虛構的恩典") == "虛構的恩典"
    assert donghu.clean_title("《見證分享》虛構的平安&#8211;同在") == "虛構的平安–同在"
    assert donghu.clean_title("虛構的培靈會迴響") == "虛構的培靈會迴響"
    assert donghu.clean_title("《見證分享》") == "《見證分享》"  # never leaves an empty title


def test_batch_rows_rejects_holds_and_bad_links():
    b = batch()
    s = b["stats"]
    assert [r["external_id"] for r in b["testimonies"]] == ["donghu-910001", "donghu-910002", "donghu-910003"]
    assert [r["title"] for r in b["testimonies"]] == ["虛構的恩典", "虛構的培靈會迴響", "虛構的平安–同在"]
    # The generic 《見證分享》 prefix is on every post, so it says nothing. After it is removed, only a
    # title that itself says 見證 is "likely"; the rest need a person to read them.
    assert [r["import_hint"] for r in b["testimonies"]] == ["needs_review"] * 3
    named = donghu.build_batch([{"id": 1, "link": "https://dhchurch.org.tw/p/1/", "title": "《見證分享》北中門見證"}])
    assert named["testimonies"][0]["import_hint"] == "likely_testimony"
    assert s["rejected"] == {"not_a_testimony": 1} and s["held_for_review"] == ["donghu-910005"]
    assert s["failed_items"] == [{"item": "donghu-910006", "reason": "link is not an https dhchurch.org.tw URL"}]
    assert s["requested"] == 6  # the duplicate post id counts once
    assert s["complete"] is False


def test_held_and_rejected_titles_never_appear_in_the_batch():
    text = json.dumps(batch(), ensure_ascii=False)
    assert "憂鬱症" not in text and "講道" not in text and "evil.example.com" not in text


def test_ids_and_hashes_are_stable_regardless_of_order_and_duplicates():
    posts = donghu.parse_posts(POSTS)
    assert donghu.build_batch(posts) == donghu.build_batch(list(reversed(posts)))
    assert len({r["content_hash"] for r in batch()["testimonies"]}) == 3


def test_complete_batch_validates_and_loads_as_drafts():
    posts = [p for p in donghu.parse_posts(POSTS) if p["id"] in {910001, 910002, 910003}]
    b = donghu.build_batch(posts)
    problems = donghu.validate_batch(b)
    assert b["stats"]["complete"] and problems == []
    store = FakeStore()
    first = loader.load_batch(b, store, donghu.SOURCE_KEY, apply=True, problems=problems)
    again = loader.load_batch(b, store, donghu.SOURCE_KEY, apply=True, problems=problems)
    assert first.inserted == 3 and again.inserted == 0
    assert {(t["review_status"], t["rights_status"], t["publication_status"]) for t in store.testimonies} == {("pending", "pending", "draft")}
    assert all(t["body"] is None and t["source_url"].startswith("https://dhchurch.org.tw/") for t in store.testimonies)


def fake_site(post_pages, robots="User-agent: *\nDisallow:\n"):
    calls = []

    def get(url):
        calls.append(url)
        if url.endswith("/robots.txt"):
            return robots
        parts = urlparse(url)
        if parts.path.endswith("/categories"):
            return CATEGORIES
        q = parse_qs(parts.query)
        assert q["_fields"] == ["id,link,title"] and q["categories"] == ["67"]  # no body is ever requested
        n = int(q["page"][0])
        if n > len(post_pages):
            raise FetchError("HTTP 400", 400, donghu.PAST_END_CODE)
        return json.dumps(post_pages[n - 1])

    return Fetcher(get=get, delay=0, retries=0, sleep=lambda s: None), calls


def post(i):
    return {"id": i, "link": f"https://dhchurch.org.tw/p/{i}/", "title": {"rendered": f"《見證分享》虛構{i}"}}


def test_fetch_pages_through_the_api_without_requesting_bodies():
    full = [post(i) for i in range(1, donghu.PER_PAGE + 1)]
    fetcher, calls = fake_site([full, [post(1000)]])
    posts, failures = donghu.fetch_posts(fetcher)
    assert len(posts) == donghu.PER_PAGE + 1 and failures == []
    assert len([c for c in calls if "/posts?" in c]) == 2


def test_a_full_last_page_then_a_400_ends_cleanly():
    full = [post(i) for i in range(1, donghu.PER_PAGE + 1)]
    fetcher, _ = fake_site([full])
    posts, failures = donghu.fetch_posts(fetcher)
    assert len(posts) == donghu.PER_PAGE and failures == []


def test_a_failed_page_is_reported_and_marks_the_batch_incomplete(tmp_path, capsys):
    def get(url):
        if url.endswith("/robots.txt"):
            return "User-agent: *\nDisallow:\n"
        if "/categories" in url:
            return CATEGORIES
        raise FetchError("HTTP 500", 500)

    fetcher = Fetcher(get=get, delay=0, retries=0, sleep=lambda s: None)
    assert donghu.main(["--out", str(tmp_path / "b.json")], fetcher=fetcher) == 2  # nothing fetched: refused


def test_cli_refuses_when_robots_blocks_ai_crawlers():
    fetcher, calls = fake_site([[post(1)]], robots="User-agent: anthropic-ai\nDisallow: /\n")
    assert donghu.main([], fetcher=fetcher) == 2
    assert not any("/posts?" in c for c in calls)


def test_cli_reads_a_saved_file_and_exits_nonzero_for_an_incomplete_batch(tmp_path):
    assert donghu.main(["--from-file", str(FIX / "posts.json"), "--out", str(tmp_path / "b.json")]) == 1
    ok = tmp_path / "ok.json"
    ok.write_text(json.dumps([post(1), post(2)], ensure_ascii=False), encoding="utf-8")
    assert donghu.main(["--from-file", str(ok)]) == 0
    bad = tmp_path / "bad.json"
    bad.write_text("not json", encoding="utf-8")
    assert donghu.main(["--from-file", str(bad)]) == 2


def test_a_different_400_is_a_failure_not_the_end_of_the_import():
    full = [post(i) for i in range(1, donghu.PER_PAGE + 1)]

    def get(url):
        if url.endswith("/robots.txt"):
            return "User-agent: *\nDisallow:\n"
        if "/categories" in url:
            return CATEGORIES
        if "&page=1&" in url:
            return json.dumps(full)
        raise FetchError("HTTP 400", 400, "rest_invalid_param")

    posts, failures = donghu.fetch_posts(Fetcher(get=get, delay=0, retries=0, sleep=lambda s: None))
    assert len(posts) == donghu.PER_PAGE and failures and failures[0]["item"] == "donghu-page-2"
