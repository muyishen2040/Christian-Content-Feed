"""Normalize, deduplicate and tag importer batches before they reach the loader (MUY-17).

    python -m pipeline.enrich batch.json --out enriched.json [--known other_batch.json ...]
                              [--review-out review_queue.json]

Input and output are the batch shape described in importers/base.py, so `pipeline.loader` accepts
the output unchanged. Pure and deterministic: no network, no database, no clock. Re-running on its
own output gives the same output.

What it does to each row:
- cleans `title` (width, whitespace, repeated punctuation); the importer's title is kept in the
  non-column field `raw_title` (the loader drops it). A non-placeholder `excerpt` is only whitespace
  cleaned; an uncertain excerpt is never rewritten.
- collapses rows whose normalized URL is the same into one record (the first by external_id wins;
  ids of the collapsed rows are counted in stats, nothing else changes). Rows whose titles match
  only loosely (after Simplified/Traditional folding) are NOT removed: both stay and the pair goes
  to `stats.review_queue` for a person.
- sets `topics` from the fixed vocabulary in taxonomy.py; no match leaves `topics` empty and counts
  it as untagged. Human-set topics already on a row are kept.
- sets the non-column `review_flags` (`crisis_adjacent`, `possible_duplicate`, `untagged`). A title
  that matches crisis patterns is held out of the batch (id only in `stats.held_for_review`).

What it never does: touch statuses, hashes, external ids, URLs, or rights; store body text or
author names (a row carrying either is refused); publish; log titles, URLs or keys.
"""

from __future__ import annotations

import argparse
import copy
import difflib
import json
import re
import sys
import unicodedata
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pipeline.importers import common
from pipeline.taxonomy import TAXONOMY, UNTAGGED

# Common Simplified -> Traditional folds, enough to match the same title across sources. This is a
# matching aid only: displayed titles are never converted. Anything not listed is left as is.
_FOLD_PAIRS = (
    "见見 够夠 证證 师師 灵靈 恩恩 圣聖 经經 书書 门門 们們 这這 个個 为為 来來 时時 会會 学學 爱愛 称稱 让讓 将將 对對 动動 发發 经經 实實 现現 开開 关關 觉覺 觉覺 话話 说說 请請 谢謝 导導 带帶 兴興 乐樂 欢歡 难難 历歷 变變 后後 与與 总總 过過 还還 点點 种種 里裡 间間 头頭 样樣 从從 无無 众眾 为為 应應 该該 给給 样樣 条條 听聽 见見 觉覺 医醫 愈癒 疗療 苦苦 药藥 术術 战戰 惧懼 忧憂 压壓 抚撫 释釋 赎贖 误誤 怀懷 孙孫 儿兒 亲親 妈媽 爷爺 妇婦 岁歲 烦煩 脑腦 恶惡 爱愛 悔悔 归歸 决決 担擔 负負 责責 恳懇 愿願 祷禱 赞讚 荣榮 华華 灭滅 复復 兴興 众眾 传傳 队隊 团團 场場 岛島 湾灣 台臺 线線 网網 络絡 视視 题題 问問 答答 际際 国國 业業 务務 员員 联聯 结結 缘緣 创創 补補 终終 阶階 级級 渐漸 积積 极極 简簡 单單 严嚴 价價 贵貴 费費 贷貸 财財 赚賺 买買 卖賣 钱錢 银銀 铁鐵 针針 镇鎮 阴陰 阳陽 隐隱 雾霧 灯燈 烧燒 灾災 热熱 爸爸 咒咒 诅詛 祸禍 祝祝 赐賜 获獲 轻輕 车車 轮輪 转轉 软軟 较較 辈輩 边邊 远遠 违違 选選 递遞 适適 进進 运運 迟遲 邻鄰 郑鄭 释釋 针針 阅閱 队隊 陈陳 随隨 难難 雏雛 显顯 顾顧 颂頌 预預 领領 频頻 饶饒 饥饑 饭飯 饮飲 驱驅 骂罵 鸟鳥 鸡雞 麦麥 黄黃 齐齊 齿齒"
).split()
_FOLD = {p[0]: p[1] for p in _FOLD_PAIRS if len(p) == 2 and p[0] != p[1]}

_ZERO_WIDTH = dict.fromkeys(map(ord, "​‌‍⁠﻿­"), None)
_CJK = r"㐀-鿿豈-﫿"
_SPACE_BETWEEN_CJK = re.compile(rf"(?<=[{_CJK}])\s+(?=[{_CJK}])")
_REPEAT_PUNCT = re.compile(r"([!?！？。，、；：…~～.\-—])\1{1,}")
_TRACKING = re.compile(r"^(utm_.*|fbclid|gclid|mc_cid|mc_eid|ref|share)$", re.I)
_DROP_IN_KEY = re.compile(r"[\s\W_]+", re.UNICODE)
NEAR_RATIO = 0.88  # similarity needed to queue a pair for review; deliberately high (conservative)
MIN_KEY_LEN = 6    # shorter title keys are too generic to compare loosely


class EnrichRefused(Exception):
    """A row breaks a pipeline guarantee. The message names an id, never row contents."""


def clean_title(value: str) -> str:
    """Display title: width-normalized letters and digits, one-space whitespace, no stray spaces
    between Chinese characters, repeated punctuation collapsed. Traditional/Simplified is untouched."""
    out = []
    for ch in value:
        # Fullwidth ASCII forms (Ａ-Ｚ, ０-９, ...) and the ideographic space become plain ASCII; CJK
        # punctuation such as ，。「」 is kept as written.
        cp = ord(ch)
        if 0xFF10 <= cp <= 0xFF19 or 0xFF21 <= cp <= 0xFF3A or 0xFF41 <= cp <= 0xFF5A:
            ch = unicodedata.normalize("NFKC", ch)
        out.append(ch)
    text = "".join(out).translate(_ZERO_WIDTH).replace("　", " ")
    text = common.clean_text(text)
    text = _SPACE_BETWEEN_CJK.sub("", text)
    return _REPEAT_PUNCT.sub(r"\1", text)


def title_key(value: str) -> str:
    """Matching key: NFKC, case-folded, Simplified folded to Traditional, no spaces or punctuation."""
    text = unicodedata.normalize("NFKC", value).casefold().translate(_ZERO_WIDTH)
    text = "".join(_FOLD.get(c, c) for c in text)
    return _DROP_IN_KEY.sub("", text)


def normalize_url(url: str) -> str:
    """Canonical form for duplicate detection: https, lowercase host without www, no fragment,
    tracking parameters removed, remaining parameters sorted, no trailing slash."""
    parts = urlsplit(url.strip())
    host = (parts.hostname or "").lower().removeprefix("www.")
    if parts.port and parts.port not in (80, 443):
        host = f"{host}:{parts.port}"
    query = urlencode(sorted((k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if not _TRACKING.match(k)))
    path = re.sub(r"/{2,}", "/", parts.path).rstrip("/")
    return urlunsplit(("https", host, path, query, ""))


def tag_title(title: str) -> list[str]:
    """Topic slugs whose keywords appear in the title, in vocabulary order. [] means untagged."""
    key = title_key(title)
    return [slug for slug, (_, _, words) in TAXONOMY.items() if any(title_key(w) in key for w in words)]


def _check_row(row: dict) -> None:
    rid = row.get("external_id", "?")
    if row.get("body") is not None:
        raise EnrichRefused(f"{rid}: body text must not be stored")
    if any(k in row for k in ("author", "authors", "author_name")):
        raise EnrichRefused(f"{rid}: author names must not be stored")
    if row.get("review_status", "pending") != "pending" or row.get("publication_status", "draft") != "draft" \
            or row.get("published_at") is not None:
        raise EnrichRefused(f"{rid}: only unreviewed drafts are accepted")


def enrich_batch(batch: dict, known: list[dict] | None = None) -> tuple[dict, list[dict]]:
    """Return (enriched batch, review queue). `known` rows (from other batches) are used only for
    matching and never added to the output. The input is not modified."""
    out = copy.deepcopy(batch)
    stats = out.setdefault("stats", {})
    queue: list[dict] = []
    stats.setdefault("held_for_review", [])
    collapsed: list[str] = list(stats.get("duplicates_collapsed", []))

    rows = sorted(out.get("testimonies", []), key=lambda r: r["external_id"])
    for r in rows:
        _check_row(r)

    seen_urls: dict[str, str] = {}
    # Matching pool: (external_id, source_key, title key) for known rows, then rows kept so far.
    pool: list[tuple[str, str, str]] = []
    for k in known or []:
        for r in sorted(k.get("testimonies", []), key=lambda r: r["external_id"]):
            seen_urls.setdefault(normalize_url(r["source_url"]), r["external_id"])
            pool.append((r["external_id"], r.get("source_key", ""), title_key(r.get("raw_title") or r["title"])))

    kept: list[dict] = []
    untagged = 0
    for r in rows:
        raw = r.get("raw_title") or r["title"]
        title = clean_title(raw)
        if not title:
            raise EnrichRefused(f"{r['external_id']}: empty title after cleaning")
        url_key = normalize_url(r["source_url"])
        if url_key in seen_urls:
            collapsed.append(r["external_id"])
            continue
        seen_urls[url_key] = r["external_id"]

        verdict = common.classify(title)
        if verdict.decision == "hold":
            if r["external_id"] not in stats["held_for_review"]:
                stats["held_for_review"].append(r["external_id"])
            continue
        if verdict.decision == "reject":
            stats.setdefault("rejected", {})
            stats["rejected"][verdict.reason] = stats["rejected"].get(verdict.reason, 0) + 1
            continue

        key = title_key(title)
        flags: list[str] = []
        for other_id, other_src, other_key in pool:
            if min(len(key), len(other_key)) < MIN_KEY_LEN:
                continue
            ratio = 1.0 if key == other_key else difflib.SequenceMatcher(None, key, other_key).ratio()
            if ratio >= NEAR_RATIO:
                flags.append("possible_duplicate")
                queue.append({
                    "external_id": r["external_id"], "matches_external_id": other_id,
                    "source_key": r.get("source_key", ""), "matches_source_key": other_src,
                    "reason": "same_title" if ratio == 1.0 else "similar_title",
                })
        pool.append((r["external_id"], r.get("source_key", ""), key))

        topics = list(r.get("topics") or []) or tag_title(title)
        if not topics:
            flags.append(UNTAGGED)
            untagged += 1

        r["raw_title"] = raw
        r["title"] = title
        if r.get("excerpt"):
            r["excerpt"] = common.clean_text(r["excerpt"])
        r["topics"] = topics
        r["review_flags"] = sorted(set(flags))  # not a table column; the loader drops it
        kept.append(r)

    out["testimonies"] = kept
    stats["rows"] = len(kept)
    stats["duplicates_collapsed"] = sorted(set(collapsed))
    stats["untagged"] = sum(UNTAGGED in r["review_flags"] for r in kept)
    stats["review_queue"] = queue
    return out, queue


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("batch", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--known", type=Path, nargs="*", default=[], help="other batches to match against")
    ap.add_argument("--review-out", type=Path, help="write the review queue (ids only) here")
    args = ap.parse_args(argv)
    read = lambda p: json.loads(p.read_text(encoding="utf-8"))  # noqa: E731
    try:
        out, queue = enrich_batch(read(args.batch), [read(p) for p in args.known])
    except EnrichRefused as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2
    args.out.write_text(json.dumps(out, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    if args.review_out:
        args.review_out.write_text(json.dumps(queue, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    s = out["stats"]
    print(json.dumps({
        "job": "testimony_enrich", "rows": s["rows"], "collapsed": len(s["duplicates_collapsed"]),
        "review_queue": len(queue), "untagged": s["untagged"], "held_for_review": len(s["held_for_review"]),
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
