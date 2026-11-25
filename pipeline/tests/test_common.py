import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[2]))

from pipeline.importers import common  # noqa: E402
from pipeline.importers.common import FetchError, Fetcher, RobotsDisallowed  # noqa: E402


def make_fetcher(responses, delay=1.0, retries=2):
    """responses: url -> text, or an exception, or a list of those (used in order)."""
    calls: list[str] = []
    sleeps: list[float] = []
    queues = {u: (list(v) if isinstance(v, list) else [v]) for u, v in responses.items()}

    def get(url):
        calls.append(url)
        if url not in queues:
            raise FetchError("HTTP 404", 404)
        item = queues[url].pop(0) if len(queues[url]) > 1 else queues[url][0]
        if isinstance(item, Exception):
            raise item
        return item

    return Fetcher(get=get, delay=delay, retries=retries, sleep=sleeps.append), calls, sleeps


# ---- robots.txt ----

def test_robots_blocking_an_ai_crawler_blocks_us_too():
    guard = common.RobotsGuard("User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow:\n")
    assert not guard.allowed("https://x.test/articles/1")


def test_robots_blocking_our_own_agent_or_a_path_blocks_us():
    assert not common.RobotsGuard("User-agent: ChristianContentFeedImporter\nDisallow: /\n").allowed("https://x.test/a")
    assert not common.RobotsGuard("User-agent: *\nDisallow: /api/\n").allowed("https://x.test/api/x")
    assert common.RobotsGuard("User-agent: *\nDisallow: /api/\n").allowed("https://x.test/articles/1")


def test_missing_robots_txt_means_no_rules_but_other_errors_refuse():
    fetcher, calls, _ = make_fetcher({"https://x.test/page": "ok"})  # robots.txt -> 404
    assert fetcher.get("https://x.test/page") == "ok"
    fetcher, _, _ = make_fetcher({"https://x.test/robots.txt": FetchError("HTTP 500", 500), "https://x.test/page": "ok"}, retries=0)
    with pytest.raises(FetchError):
        fetcher.get("https://x.test/page")


def test_a_disallowed_url_is_never_requested():
    fetcher, calls, _ = make_fetcher({
        "https://x.test/robots.txt": "User-agent: ClaudeBot\nDisallow: /articles\n",
        "https://x.test/articles/1": "secret",
    })
    with pytest.raises(RobotsDisallowed):
        fetcher.get("https://x.test/articles/1")
    assert "https://x.test/articles/1" not in calls


def test_robots_is_fetched_once_per_host():
    fetcher, calls, _ = make_fetcher({"https://x.test/robots.txt": "User-agent: *\nDisallow:\n",
                                      "https://x.test/a": "a", "https://x.test/b": "b"})
    fetcher.get("https://x.test/a")
    fetcher.get("https://x.test/b")
    assert calls.count("https://x.test/robots.txt") == 1


# ---- rate limit and retries ----

def test_requests_are_spaced_by_the_delay_and_never_start_with_a_sleep():
    fetcher, _, sleeps = make_fetcher({"https://x.test/robots.txt": "User-agent: *\nDisallow:\n",
                                       "https://x.test/a": "a", "https://x.test/b": "b"}, delay=2.0)
    fetcher.get("https://x.test/a")
    fetcher.get("https://x.test/b")
    assert sleeps and all(s == 2.0 for s in sleeps) and len(sleeps) == 2  # robots->a, a->b


def test_server_errors_are_retried_a_bounded_number_of_times():
    fetcher, calls, _ = make_fetcher({"https://x.test/robots.txt": "User-agent: *\nDisallow:\n",
                                      "https://x.test/a": FetchError("HTTP 503", 503)}, retries=2)
    with pytest.raises(FetchError):
        fetcher.get("https://x.test/a")
    assert calls.count("https://x.test/a") == 3


def test_a_transient_error_then_success_returns_the_page():
    fetcher, _, _ = make_fetcher({"https://x.test/robots.txt": "User-agent: *\nDisallow:\n",
                                  "https://x.test/a": [FetchError("URLError"), "ok"]})
    assert fetcher.get("https://x.test/a") == "ok"


def test_a_404_is_not_retried_and_http_is_refused():
    fetcher, calls, _ = make_fetcher({"https://x.test/robots.txt": "User-agent: *\nDisallow:\n"})
    with pytest.raises(FetchError):
        fetcher.get("https://x.test/missing")
    assert calls.count("https://x.test/missing") == 1
    with pytest.raises(FetchError, match="https"):
        fetcher.get("http://x.test/a")


# ---- classifier ----

@pytest.mark.parametrize("title,desc,decision,hint,reason", [
    ("見證｜虛構的故事", "", "candidate", "likely_testimony", "ok"),
    ("虛構的旅程", "我走過。我感恩。", "candidate", "likely_testimony", "ok"),
    ("虛構的報導", "沒有第一人稱。", "candidate", "needs_review", "ok"),
    ("主日信息：虛構", "我們禱告。我們讀經。", "reject", "needs_review", "not_a_testimony"),
    ("如何分享你的見證", "", "reject", "needs_review", "not_a_testimony"),
    ("虛構的全能神", "", "reject", "needs_review", "excluded_source"),
    ("虛構見證", "我曾想死。", "hold", "needs_review", "crisis_adjacent"),
])
def test_classifier_decisions(title, desc, decision, hint, reason):
    v = common.classify(title, desc)
    assert (v.decision, v.hint, v.reason) == (decision, hint, reason)


def test_excluded_source_beats_crisis_and_crisis_beats_a_sermon_title():
    assert common.classify("全能神 自殺").reason == "excluded_source"
    assert common.classify("主日信息：自殺").decision == "hold"


def test_verdict_reasons_are_fixed_labels_not_page_text():
    v = common.classify("見證", "我自殺的故事我我")
    assert v.reason == "crisis_adjacent" and "自殺" not in v.reason


# ---- validation ----

def row(**kw):
    base = common.to_row(source_key="s", source_name="S", external_id="e1", content_hash="h1",
                         title="t", url="https://x.test/1", hint="needs_review")
    return {**base, **kw}


def test_validate_flags_published_body_author_and_duplicates():
    assert common.validate_batch({"testimonies": [row()]}) == []
    bad = {"testimonies": [row(publication_status="published"), row(body="text", author="a")]}
    problems = " ".join(common.validate_batch(bad))
    for expected in ("never publish", "body text", "author names", "duplicate content_hash", "duplicate external_id"):
        assert expected in problems


def test_to_row_is_an_unreviewed_draft_with_a_placeholder_excerpt():
    r = row()
    assert (r["review_status"], r["rights_status"], r["publication_status"]) == ("pending", "pending", "draft")
    assert r["body"] is None and r["excerpt"] == common.PLACEHOLDER_EXCERPT and r["topics"] == []
