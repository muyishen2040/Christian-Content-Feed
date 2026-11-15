"""Reproducible, local-only retrieval benchmark for fictional Chinese examples."""

import argparse
import hashlib
import json
import math
import platform
import statistics
import threading
import time
from pathlib import Path


MODELS = {
    "bge": {
        "repo": "BAAI/bge-small-zh-v1.5",
        "revision": "7999e1d3359715c523056ef9478215996d62a620",
        "query_prefix": "为这个句子生成表示以用于检索相关文章：",
        "passage_prefix": "",
        "pooling": "cls",
    },
    "e5": {
        "repo": "intfloat/multilingual-e5-small",
        "revision": "614241f622f53c4eeff9890bdc4f31cfecc418b3",
        "query_prefix": "query: ",
        "passage_prefix": "passage: ",
        "pooling": "mean",
    },
}
FIXTURE = Path(__file__).parent / "fixtures" / "synthetic-zh.json"


def fixture_digest(fixture):
    """Hash canonical JSON so Windows and Linux checkout line endings agree."""
    canonical = json.dumps(fixture, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def score_ranking(ranked_ids, relevant_ids, k):
    """Binary-relevance recall, reciprocal rank and normalized discounted gain."""
    relevant = set(relevant_ids)
    if not relevant:
        raise ValueError("Each query must have at least one relevant item")
    top = ranked_ids[:k]
    hits = [int(item in relevant) for item in top]
    recall = sum(hits) / len(relevant)
    reciprocal = next((1 / (i + 1) for i, hit in enumerate(hits) if hit), 0.0)
    dcg = sum(hit / math.log2(i + 2) for i, hit in enumerate(hits))
    ideal = sum(1 / math.log2(i + 2) for i in range(min(k, len(relevant))))
    return {"recall": recall, "mrr": reciprocal, "ndcg": dcg / ideal}


def flatten_fixture(fixture):
    documents, queries = [], []
    for topic in fixture["topics"]:
        ids = []
        for index, content in enumerate(topic["documents"], 1):
            identifier = f"{topic['id']}-d{index}"
            ids.append(identifier)
            documents.append({"id": identifier, "text": content})
        for index, content in enumerate(topic["queries"], 1):
            judgment = topic.get("relevant_documents_by_query")
            if judgment and (
                len(judgment) != len(topic["queries"])
                or not judgment[index - 1]
                or any(i < 1 or i > len(ids) for i in judgment[index - 1])
                or len(set(judgment[index - 1])) != len(judgment[index - 1])
            ):
                raise ValueError(f"Invalid judgments for topic {topic['id']}")
            relevant_ids = [ids[i - 1] for i in judgment[index - 1]] if judgment else ids[:]
            queries.append({
                "id": f"{topic['id']}-q{index}", "text": content,
                "script": "traditional" if index == 1 else "simplified",
                "relevant_ids": relevant_ids,
            })
    return documents, queries


def percentile(values, p):
    ordered = sorted(values)
    index = (len(ordered) - 1) * p
    lo = int(index)
    hi = min(lo + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (index - lo)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", choices=MODELS, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--repetitions", type=int, default=3)
    parser.add_argument("--offline", action="store_true", help="Use only previously cached model files")
    args = parser.parse_args()
    if args.threads < 1 or args.repetitions < 1:
        parser.error("threads and repetitions must be positive")

    # Start measurement before importing the ML libraries; use one process per model.
    process_start = time.perf_counter()
    import psutil
    import torch
    import transformers
    from transformers import AutoModel, AutoTokenizer

    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    process = psutil.Process()
    peak_rss = [process.memory_info().rss]
    stop = threading.Event()

    def sample_memory():
        while not stop.wait(0.02):
            peak_rss[0] = max(peak_rss[0], process.memory_info().rss)

    sampler = threading.Thread(target=sample_memory, daemon=True)
    sampler.start()
    try:
        config = MODELS[args.model]
        load_start = time.perf_counter()
        options = {"revision": config["revision"], "local_files_only": args.offline, "trust_remote_code": False}
        tokenizer = AutoTokenizer.from_pretrained(config["repo"], **options)
        model = AutoModel.from_pretrained(config["repo"], use_safetensors=True, **options)
        model.eval()
        load_seconds = time.perf_counter() - load_start

        def encode(texts):
            tokens = tokenizer(texts, padding=True, truncation=True, max_length=512, return_tensors="pt")
            with torch.inference_mode():
                hidden = model(**tokens).last_hidden_state
                if config["pooling"] == "cls":
                    vectors = hidden[:, 0]
                else:
                    mask = tokens["attention_mask"].unsqueeze(-1)
                    vectors = (hidden * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1)
                return torch.nn.functional.normalize(vectors, p=2, dim=1)

        fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        documents, queries = flatten_fixture(fixture)
        first_start = time.perf_counter()
        encode([config["query_prefix"] + queries[0]["text"]])
        first_ms = (time.perf_counter() - first_start) * 1000
        startup_seconds = time.perf_counter() - process_start
        doc_vectors = encode([config["passage_prefix"] + item["text"] for item in documents])
        latencies, ranking_results = [], []
        for repetition in range(args.repetitions):
            for query in queries:
                start = time.perf_counter()
                vector = encode([config["query_prefix"] + query["text"]])
                latencies.append((time.perf_counter() - start) * 1000)
                if repetition == 0:
                    scores = (vector @ doc_vectors.T)[0]
                    ranked_indices = torch.argsort(scores, descending=True).tolist()
                    ranked_ids = [documents[i]["id"] for i in ranked_indices]
                    ranking_results.append({
                        "query_id": query["id"],
                        "script": query["script"],
                        "relevant_ids": query["relevant_ids"],
                        "top_5": ranked_ids[:5],
                        "metrics_at_5": score_ranking(ranked_ids, query["relevant_ids"], 5),
                    })
        metrics = {
            metric: statistics.mean(item["metrics_at_5"][metric] for item in ranking_results)
            for metric in ("recall", "mrr", "ndcg")
        }
        by_script = {
            script: {
                metric: round(statistics.mean(
                    item["metrics_at_5"][metric] for item in ranking_results if item["script"] == script
                ), 4)
                for metric in ("recall", "mrr", "ndcg")
            }
            for script in ("traditional", "simplified")
        }
        peak_rss[0] = max(peak_rss[0], process.memory_info().rss)
        output = {
            "model": config["repo"], "revision": config["revision"],
            "fixture": fixture["name"], "fixture_sha256": fixture_digest(fixture),
            "judgment_status": fixture["judgment_status"],
            "dimension": int(doc_vectors.shape[1]), "pooling": config["pooling"],
            "documents": len(documents), "queries": len(queries), "threads": args.threads,
            "repetitions": args.repetitions, "offline_model_load": args.offline,
            "model_load_seconds": round(load_seconds, 3),
            "startup_through_first_query_seconds": round(startup_seconds, 3),
            "first_query_ms": round(first_ms, 2),
            "query_latency_ms": {"p50": round(percentile(latencies, 0.5), 2), "p95": round(percentile(latencies, 0.95), 2)},
            "peak_process_rss_mib": round(peak_rss[0] / 1024**2, 1),
            "metrics_at_5": {key: round(value, 4) for key, value in metrics.items()},
            "metrics_by_script_at_5": by_script,
            "environment": {"platform": platform.platform(), "processor": platform.processor(), "python": platform.python_version(), "torch": torch.__version__, "transformers": transformers.__version__},
            "rankings": ranking_results,
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({key: value for key, value in output.items() if key != "rankings"}, ensure_ascii=False, indent=2))
    finally:
        stop.set()
        sampler.join()


if __name__ == "__main__":
    main()
