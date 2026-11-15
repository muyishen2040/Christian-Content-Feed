"""Prepare blind pair judgments and score the same saved rankings after review."""

import argparse
import csv
import json
import random
import statistics
from pathlib import Path

from evaluate import FIXTURE, fixture_digest, flatten_fixture, score_ranking

FIELDS = ["query_code", "query_text", "story_code", "story_text", "relevant_0_or_1", "notes"]


def load_inputs(result_paths):
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    documents, queries = flatten_fixture(fixture)
    results = [json.loads(path.read_text(encoding="utf-8")) for path in result_paths]
    expected_queries = {item["id"] for item in queries}
    doc_ids = {item["id"] for item in documents}
    for result in results:
        if (result["fixture"] != fixture["name"]
                or result.get("fixture_sha256") != fixture_digest(fixture)
                or {r["query_id"] for r in result["rankings"]} != expected_queries
                or len(result["rankings"]) != len(expected_queries)):
            raise ValueError("Result files must cover the same fixture and queries")
        if any(not set(row["top_5"]).issubset(doc_ids) for row in result["rankings"]):
            raise ValueError("Result file contains unknown document IDs")
    return fixture, documents, queries, results


def make_rows(documents, queries, results):
    doc_codes = {doc["id"]: f"s{i:02d}" for i, doc in enumerate(documents, 1)}
    doc_text = {doc["id"]: doc["text"] for doc in documents}
    rankings = [{item["query_id"]: item for item in result["rankings"]} for result in results]
    rows = []
    for number, query in enumerate(queries, 1):
        pooled = set(query["relevant_ids"])
        for ranking in rankings:
            pooled.update(ranking[query["id"]]["top_5"])
        # Sort before seeded shuffling so results do not depend on Python's hash seed.
        doc_ids = sorted(pooled)
        random.Random(21021 + number).shuffle(doc_ids)
        for doc_id in doc_ids:
            rows.append({
                "query_code": f"q{number:02d}", "query_text": query["text"],
                "story_code": doc_codes[doc_id], "story_text": doc_text[doc_id],
                "relevant_0_or_1": "", "notes": "",
            })
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["prepare", "score"])
    parser.add_argument("--results", nargs="+", required=True, type=Path)
    parser.add_argument("--review", type=Path, required=True)
    args = parser.parse_args()
    _, documents, queries, results = load_inputs(args.results)
    expected = make_rows(documents, queries, results)
    if args.action == "prepare":
        if args.review.exists():
            raise SystemExit("Review file already exists; choose a new path to avoid overwriting judgments")
        args.review.parent.mkdir(parents=True, exist_ok=True)
        with args.review.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=FIELDS)
            writer.writeheader()
            writer.writerows(expected)
        print(f"Prepared {len(expected)} unlabeled query/story pairs at {args.review}")
        return

    with args.review.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    expected_pairs = {(r["query_code"], r["story_code"]) for r in expected}
    expected_text = {(r["query_code"], r["story_code"]): (r["query_text"], r["story_text"]) for r in expected}
    pairs = [(r["query_code"], r["story_code"]) for r in rows]
    if len(pairs) != len(set(pairs)) or set(pairs) != expected_pairs:
        raise SystemExit("Review must contain exactly the generated pairs, without duplicates")
    if any((r["query_text"], r["story_text"]) != expected_text[(r["query_code"], r["story_code"])] for r in rows):
        raise SystemExit("Review text must match the generated fixture")
    if any(r["relevant_0_or_1"].strip() not in {"0", "1"} for r in rows):
        raise SystemExit("Every pair must be independently reviewed and labeled 0 or 1")
    judgments = {(r["query_code"], r["story_code"]): int(r["relevant_0_or_1"].strip()) for r in rows}
    doc_codes = {doc["id"]: f"s{i:02d}" for i, doc in enumerate(documents, 1)}
    for result in results:
        rankings = {item["query_id"]: item for item in result["rankings"]}
        scores, no_relevant = [], []
        for number, query in enumerate(queries, 1):
            qcode = f"q{number:02d}"
            relevant = {doc["id"] for doc in documents if judgments.get((qcode, doc_codes[doc["id"]])) == 1}
            if not relevant:
                no_relevant.append(qcode)
                continue
            scores.append(score_ranking(rankings[query["id"]]["top_5"], relevant, 5))
        averages = {key: round(statistics.mean(row[key] for row in scores), 4) for key in ("recall", "mrr", "ndcg")} if scores else {}
        print(json.dumps({"model": result["model"], "scored_queries": len(scores), "no_relevant_in_pool": no_relevant, "metrics_at_5": averages}, ensure_ascii=False))


if __name__ == "__main__":
    main()
