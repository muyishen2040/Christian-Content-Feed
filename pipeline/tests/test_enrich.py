import copy
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[2]))

from pipeline import enrich, loader  # noqa: E402
from pipeline.importers import common  # noqa: E402
from pipeline.taxonomy import TAXONOMY  # noqa: E402
from pipeline.tests.test_loader import FakeStore  # noqa: E402


def row(ext, title, url, source_key="src_a", **extra):
    r = common.to_row(source_key=source_key, source_name="測試來源", external_id=ext,
                      content_hash=common.stable_hash(source_key, ext), title=title, url=url, hint="needs_review")
    r.update(extra)
    return r


def batch(*rows):
    return {"source": {"name": "測試來源", "homepage_url": None, "rights_status": "pending",
                       "rights_evidence_url": None, "private_import_notes": None},
            "testimonies": list(rows), "stats": {"rows": len(rows), "rejected": {}, "held_for_review": [],
                                                  "failed_items": [], "complete": True}}


@pytest.mark.parametrize("raw,expected", [
    ("  我的  見證  ", "我的見證"),
    ("Ｇｏｄ　是愛 ２０２４", "God 是愛 2024"),
    ("神的恩典！！！", "神的恩典！"),
    ("神​的﻿恩典", "神的恩典"),
    ("Jesus   saves\n me", "Jesus saves me"),
    ("「放手」，讓上帝動工", "「放手」，讓上帝動工"),
])
def test_clean_title(raw, expected):
    assert enrich.clean_title(raw) == expected


def test_clean_title_keeps_script():
    assert enrich.clean_title("见证神的恩典") == "见证神的恩典"


def test_title_key_folds_script_width_and_punctuation():
    assert enrich.title_key("见证：神的恩典！") == enrich.title_key("見證 神的恩典")
    assert enrich.title_key("ＧＯＤ 是爱") == enrich.title_key("god是愛")


def test_normalize_url():
    a = enrich.normalize_url("http://WWW.Example.org/a/b/?utm_source=x&id=2&b=1#frag")
    assert a == "https://example.org/a/b?b=1&id=2"
    assert enrich.normalize_url("https://example.org/a/b?id=2&b=1") == a
    assert enrich.normalize_url("https://example.org:8443/a") != enrich.normalize_url("https://example.org/a")


def test_duplicate_urls_collapse_to_one_record():
    b = batch(row("b", "標題乙乙乙乙", "https://x.org/s/1?utm_campaign=z"), row("a", "標題甲甲甲甲", "http://www.x.org/s/1/"))
    out, queue = enrich.enrich_batch(b)
    assert [r["external_id"] for r in out["testimonies"]] == ["a"]
    assert out["stats"]["duplicates_collapsed"] == ["b"] and queue == []


def test_duplicate_of_known_batch_row_collapses_and_is_not_added():
    known = batch(row("k1", "別的標題一二三", "https://x.org/s/1", source_key="src_b"))
    out, _ = enrich.enrich_batch(batch(row("a", "另一個標題", "https://x.org/s/1/")), [known])
    assert out["testimonies"] == [] and out["stats"]["duplicates_collapsed"] == ["a"]


def test_same_title_different_url_and_script_is_queued_not_removed():
    known = batch(row("k1", "神的恩典夠用", "https://a.org/1", source_key="src_b"))
    out, queue = enrich.enrich_batch(batch(row("a", "神的恩典够用！", "https://c.org/9")), [known])
    assert len(out["testimonies"]) == 1
    assert out["testimonies"][0]["review_flags"].count("possible_duplicate") == 1
    assert queue == [{"external_id": "a", "matches_external_id": "k1", "source_key": "src_a",
                      "matches_source_key": "src_b", "reason": "same_title"}]
    assert out["stats"]["review_queue"] == queue


def test_near_title_is_queued_and_different_or_short_titles_are_not():
    b = batch(row("a", "我如何由小惡魔變身為好孩子", "https://x.org/1"),
              row("b", "我如何由小惡魔變身為好孩子啊", "https://x.org/2"),
              row("c", "完全不同的主題在這裡", "https://x.org/3"),
              row("d", "見證", "https://x.org/4"), row("e", "見證", "https://x.org/5"))
    _, queue = enrich.enrich_batch(b)
    assert [(q["external_id"], q["matches_external_id"], q["reason"]) for q in queue] == [("b", "a", "similar_title")]


@pytest.mark.parametrize("title,slug", [
    ("癌症中的醫治", "healing"), ("癌症中的医治", "healing"),
    ("饶恕我的父亲", "forgiveness"), ("饒恕我的父親", "forgiveness"),
    ("第二個生日的見證", "conversion"),
])
def test_tag_assignment(title, slug):
    assert slug in enrich.tag_title(title)


def test_untagged_is_an_explicit_outcome_not_a_topic():
    out, _ = enrich.enrich_batch(batch(row("a", "天空很藍的一天", "https://x.org/1")))
    r = out["testimonies"][0]
    assert r["topics"] == [] and "untagged" in r["review_flags"] and out["stats"]["untagged"] == 1


def test_existing_human_topics_are_kept():
    out, _ = enrich.enrich_batch(batch(row("a", "癌症中的醫治", "https://x.org/1", topics=["custom"])))
    assert out["testimonies"][0]["topics"] == ["custom"]


def test_taxonomy_is_small_and_slugs_are_safe():
    assert 10 <= len(TAXONOMY) <= 15
    assert all(s.replace("_", "").isalpha() and s.islower() and s != "untagged" for s in TAXONOMY)


def test_crisis_title_is_held_out_with_id_only():
    out, _ = enrich.enrich_batch(batch(row("a", "我曾經想自殺", "https://x.org/1"), row("b", "平安的見證", "https://x.org/2")))
    assert [r["external_id"] for r in out["testimonies"]] == ["b"]
    assert out["stats"]["held_for_review"] == ["a"]


@pytest.mark.parametrize("bad", [{"body": "全文"}, {"author": "某某"}, {"review_status": "approved"},
                                 {"publication_status": "published"}])
def test_rows_that_break_guarantees_are_refused(bad):
    with pytest.raises(enrich.EnrichRefused) as e:
        enrich.enrich_batch(batch(row("a", "標題一二三四五", "https://x.org/1", **bad)))
    assert "全文" not in str(e.value) and "某某" not in str(e.value)


def test_deterministic_idempotent_and_input_untouched():
    b = batch(row("b", "  神的  恩典夠用 ", "https://x.org/2?utm_a=1"), row("a", "癌症中的醫治", "https://x.org/1"))
    before = copy.deepcopy(b)
    out1, q1 = enrich.enrich_batch(b)
    assert b == before
    assert json.dumps(enrich.enrich_batch(copy.deepcopy(b))[0], sort_keys=True) == json.dumps(out1, sort_keys=True)
    out2, q2 = enrich.enrich_batch(out1)
    assert out2 == out1 and q1 == q2
    assert {r["raw_title"] for r in out1["testimonies"]} == {"  神的  恩典夠用 ", "癌症中的醫治"}


def test_statuses_hashes_and_ids_are_untouched():
    b = batch(row("a", "癌症中的醫治", "https://x.org/1"))
    r0 = b["testimonies"][0]
    r1 = enrich.enrich_batch(b)[0]["testimonies"][0]
    for k in ("external_id", "content_hash", "source_url", "review_status", "rights_status",
              "publication_status", "published_at", "body", "excerpt"):
        assert r1[k] == r0[k]


def test_enriched_batch_loads_as_drafts_and_non_columns_are_dropped():
    out, _ = enrich.enrich_batch(batch(row("a", "癌症中的醫治", "https://x.org/1")))
    assert common.validate_batch(out) == []
    store = FakeStore()
    assert loader.load_batch(out, store, "src_a", apply=True).inserted == 1
    t = store.testimonies[0]
    assert t["topics"] == ["healing"] and t["review_status"] == "pending" and t["publication_status"] == "draft"
    assert "raw_title" not in t and "review_flags" not in t
    assert loader.load_batch(out, store, "src_a", apply=True).inserted == 0


def test_cli_writes_outputs_and_logs_counts_only(tmp_path, capsys):
    p = tmp_path / "b.json"
    p.write_text(json.dumps(batch(row("a", "癌症中的醫治", "https://x.org/1"))), encoding="utf-8")
    assert enrich.main([str(p), "--out", str(tmp_path / "o.json"), "--review-out", str(tmp_path / "q.json")]) == 0
    printed = capsys.readouterr().out
    assert "癌症" not in printed and "x.org" not in printed and '"rows": 1' in printed
    assert json.loads((tmp_path / "q.json").read_text()) == []


def test_missing_or_blank_url_is_flagged_not_dropped_or_crashing():
    b = batch(row("a", "沒有連結的文章一", None), row("b", "沒有連結的文章二", "  "), row("c", "有連結的文章三", "https://x.org/1"))
    out, _ = enrich.enrich_batch(b)
    flags = {r["external_id"]: r["review_flags"] for r in out["testimonies"]}
    assert "missing_url" in flags["a"] and "missing_url" in flags["b"] and "missing_url" not in flags["c"]
    assert out["stats"]["duplicates_collapsed"] == []  # two url-less rows are not "the same URL"
    assert enrich.normalize_url("http://x.org:badport/a") == ""


def test_enrichment_runs_on_the_real_canaan_fixture():
    from pipeline.importers import canaan_magazine as m
    html = (Path(__file__).parents[1] / "fixtures" / "canaan_magazine_range_sample.html").read_text(encoding="utf-8")
    src = m.build_batch({1: html})
    assert any(not r["source_url"] for r in src["testimonies"])  # the fixture has an entry without a link
    out, _ = enrich.enrich_batch(src)
    assert any("missing_url" in r["review_flags"] for r in out["testimonies"])
    assert len(out["testimonies"]) + len(out["stats"]["held_for_review"]) \
        + sum(out["stats"]["rejected"].values()) + len(out["stats"]["duplicates_collapsed"]) >= len(src["testimonies"])
    assert enrich.enrich_batch(out)[0] == out


def test_sidecar_keeps_original_title_and_flags_without_urls_or_text(tmp_path):
    p = tmp_path / "b.json"
    p.write_text(json.dumps(batch(row("a", "  癌症中的醫治 ", "https://x.org/1"))), encoding="utf-8")
    assert enrich.main([str(p), "--out", str(tmp_path / "o.json"), "--sidecar-out", str(tmp_path / "s.json")]) == 0
    side = json.loads((tmp_path / "s.json").read_text(encoding="utf-8"))
    assert side["rows"]["a"] == {"source_key": "src_a", "raw_title": "  癌症中的醫治 ", "review_flags": []}
    assert "x.org" not in json.dumps(side)


def test_working_files_are_ignored_and_no_batch_is_tracked():
    import subprocess
    root = Path(__file__).parents[2]
    for path in ("pipeline/work/b.json", "x.sidecar.json", "x.enriched.json"):
        code = subprocess.run(["git", "check-ignore", "-q", path], cwd=root).returncode
        if code == 128:
            pytest.skip("not a git checkout")
        assert code == 0, path
    tracked = subprocess.run(["git", "ls-files", "pipeline"], cwd=root, capture_output=True, text=True).stdout.split()
    assert not [f for f in tracked if f.endswith((".sidecar.json", ".enriched.json")) or "/work/" in f]
