import json
import math
import unittest

from evaluate import FIXTURE, fixture_digest, flatten_fixture, score_ranking
from review import make_rows


class EvaluationTests(unittest.TestCase):
    def test_fixture_digest_is_independent_of_json_formatting(self):
        value = {"topic": "朋友", "queries": ["a", "b"]}
        self.assertEqual(fixture_digest(value), fixture_digest(json.loads(json.dumps(value, indent=2))))

    def test_ranking_metrics_respect_rank_and_missing_relevant_items(self):
        scores = score_ranking(["wrong", "a", "b", "c"], ["a", "c"], 3)
        self.assertEqual(scores["recall"], 0.5)
        self.assertEqual(scores["mrr"], 0.5)
        self.assertAlmostEqual(scores["ndcg"], (1 / math.log2(3)) / (1 + 1 / math.log2(3)))

    def test_fixture_has_unique_ids_and_valid_judgments(self):
        fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        documents, queries = flatten_fixture(fixture)
        document_ids = {item["id"] for item in documents}
        query_ids = {item["id"] for item in queries}
        self.assertEqual(len(document_ids), len(documents))
        self.assertEqual(len(query_ids), len(queries))
        self.assertGreaterEqual(len(queries), 20)
        for query in queries:
            self.assertTrue(set(query["relevant_ids"]).issubset(document_ids))
            self.assertGreaterEqual(len(query["relevant_ids"]), 1)

    def test_forgiveness_judgments_distinguish_harmed_and_harming(self):
        fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        _, queries = flatten_fixture(fixture)
        by_id = {query["id"]: query for query in queries}
        self.assertEqual(by_id["forgiveness-q1"]["relevant_ids"], ["forgiveness-d1"])
        self.assertEqual(by_id["forgiveness-q2"]["relevant_ids"], ["forgiveness-d2"])

    def test_blind_review_pool_includes_both_rankings_and_target(self):
        docs = [{"id": f"d{i}", "text": f"story {i}"} for i in range(1, 5)]
        queries = [{"id": "query", "text": "situation", "relevant_ids": ["d1"]}]
        results = [
            {"rankings": [{"query_id": "query", "top_5": ["d2", "d3"]}]},
            {"rankings": [{"query_id": "query", "top_5": ["d3", "d4"]}]},
        ]
        rows = make_rows(docs, queries, results)
        self.assertEqual({r["story_code"] for r in rows}, {"s01", "s02", "s03", "s04"})
        self.assertTrue(all(r["relevant_0_or_1"] == "" for r in rows))
        self.assertEqual(rows, make_rows(docs, queries, results))

    def test_qualitative_results_match_fictional_fixtures(self):
        root = FIXTURE.parent.parent
        fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        scenarios = json.loads((root / "fixtures" / "qualitative-scenarios.json").read_text(encoding="utf-8"))
        results = json.loads((root / "results" / "qualitative.json").read_text(encoding="utf-8"))
        docs, _ = flatten_fixture(fixture)
        by_id = {doc["id"]: doc["text"] for doc in docs}
        self.assertEqual(results["story_fixture_sha256"], fixture_digest(fixture))
        self.assertEqual(results["scenarios_sha256"], fixture_digest(scenarios))
        scenario_ids = {case["id"] for case in scenarios["scenarios"]}
        self.assertGreaterEqual(len(scenario_ids), 8)
        for model in ("bge", "e5"):
            rankings = results["results"][model]["rankings"]
            self.assertEqual(set(rankings), scenario_ids)
            for rows in rankings.values():
                self.assertEqual(len(rows), 3)
                self.assertEqual(len({row["story_id"] for row in rows}), 3)
                for row in rows:
                    self.assertEqual(row["text"], by_id[row["story_id"]])


if __name__ == "__main__":
    unittest.main()
