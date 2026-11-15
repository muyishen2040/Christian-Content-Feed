"""Rank fictional stories for realistic fictional situations with cached local models."""

import argparse
import json
from pathlib import Path

import torch
from transformers import AutoModel, AutoTokenizer

from evaluate import FIXTURE, MODELS, fixture_digest, flatten_fixture

SCENARIOS = Path(__file__).parent / "fixtures" / "qualitative-scenarios.json"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    torch.set_num_threads(2)
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    situations = json.loads(SCENARIOS.read_text(encoding="utf-8"))
    documents, _ = flatten_fixture(fixture)
    output = {
        "scenarios": situations,
        "scenarios_sha256": fixture_digest(situations),
        "story_fixture": fixture["name"],
        "story_fixture_sha256": fixture_digest(fixture),
        "results": {},
    }
    for name, config in MODELS.items():
        options = {"revision": config["revision"], "local_files_only": True, "trust_remote_code": False}
        tokenizer = AutoTokenizer.from_pretrained(config["repo"], **options)
        model = AutoModel.from_pretrained(config["repo"], use_safetensors=True, **options)
        model.eval()

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

        corpus = encode([config["passage_prefix"] + item["text"] for item in documents])
        results = {}
        for case in situations["scenarios"]:
            query = encode([config["query_prefix"] + case["text"]])
            scores = (query @ corpus.T)[0]
            indices = torch.argsort(scores, descending=True).tolist()[:3]
            results[case["id"]] = [
                {"story_id": documents[index]["id"], "text": documents[index]["text"], "cosine": round(float(scores[index]), 4)}
                for index in indices
            ]
        output["results"][name] = {"model": config["repo"], "revision": config["revision"], "rankings": results}
        del model, tokenizer, corpus
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(situations['scenarios'])} fictional scenarios and top-three rankings to {args.output}")


if __name__ == "__main__":
    main()
