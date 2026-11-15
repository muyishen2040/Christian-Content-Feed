# Chinese embedding evaluation (MUY-21)

This experiment compares `BAAI/bge-small-zh-v1.5` and `intfloat/multilingual-e5-small` locally on CPU. It does not call a hosted AI API. Downloads from Hugging Face contain model files only; the examples are encoded locally. The fixture contains entirely fictional stories and fictional queries, not actual testimonies or user descriptions.

## Important limitation

The aggregate 24-query metrics use provisional topic-based labels, not independent human judgments; both models are evaluated on the same data, but the numbers are exploratory and may overestimate real-world relevance. A separate partial human review and the MVP model decision are summarized in [the evaluation notes](../../docs/embedding-evaluation.md). Before the pilot, assess representative, rights-approved content for relevance and safety, including cross-topic matches and nuanced or potentially harmful recommendations. Do not publish these fictional stories as real testimonies.

## Setup

From the repository root, create and activate a separate Python 3.12 environment. On Windows, use `.venv\Scripts\Activate.ps1`; on macOS/Linux, use `source .venv/bin/activate`.

```sh
python -m venv .venv
python -m pip install -r ml-service/evaluation/requirements.txt
python -m unittest discover -s ml-service/evaluation -p 'test_*.py'
```

For Linux CPU-only installations, obtain a compatible CPU-only PyTorch build as described by [PyTorch](https://pytorch.org/get-started/locally/) before installing the remaining dependencies. The pinned revisions in `evaluate.py` select model weights, not remote Python code (`trust_remote_code=False`). The first run downloads model files; do not commit the cache, model weights or environment. Access to the models and their licenses should be independently verified before deployment.

## Run

```sh
python ml-service/evaluation/evaluate.py --model bge --threads 2 --repetitions 3 --output ml-service/evaluation/results/bge.json
python ml-service/evaluation/evaluate.py --model e5 --threads 2 --repetitions 3 --output ml-service/evaluation/results/e5.json
```

For comparable cached-load measurements, run each command once to download/cache the weights, then repeat with `--offline`, writing to the same result path. Run each model in a separate process with the same settings and an otherwise idle machine. The JSON includes per-query top-five IDs so reviewers can inspect failures without storing the full text twice.

## Measurement and interpretation

- Each of 12 fictional topics has two stories and two queries: one Traditional and one Simplified Chinese. Both stories in a topic are provisionally labeled relevant except for the forgiveness cases, where the perspectives of someone harmed and someone causing harm are labeled separately. All other stories are treated as not relevant for scoring. This overlooks cross-topic relevance.
- Retrieval uses normalized embeddings and cosine similarity. Report binary Recall@5, MRR@5, and NDCG@5 overall and by query script. These are descriptive on a tiny synthetic dataset, not statistically reliable estimates of actual relevance.
- For BGE, use the model card's Chinese retrieval instruction on queries and CLS pooling. For E5, use `query: ` / `passage: ` prefixes and attention-mask mean pooling. Both models use a maximum of 512 tokens.
- Run a single query immediately after loading, then precompute passage embeddings and time each query individually across repeated passes. Model-load and startup times include cached model/tokenizer loading and library imports, respectively, but not network downloads when `--offline` is set. Startup starts after argument parsing and includes the first query; it is not the boot time of a deployed HTTP service.
- Report median and interpolated 95th percentile per-query encoding latency, not network/queue/database latency. Process RSS is sampled after the ML imports, including model loading and batched passage encoding; short peaks may be missed and it is not steady-state service memory. Both metrics are specific to the test machine and thread count.
- Store benchmark settings and model revisions with the results. Re-embedding is required if the model or version changes; vector dimensions and thresholds must not be assumed to be interchangeable.

Model cards: [BGE](https://huggingface.co/BAAI/bge-small-zh-v1.5), [multilingual E5](https://huggingface.co/intfloat/multilingual-e5-small).

## Explore realistic situations

Eight longer, fictional composite situations are provided in `fixtures/qualitative-scenarios.json`. They reuse the fictional 24-story catalog, so their rankings illustrate how each model orders examples and where the catalog has gaps; they are not independent human relevance judgments or a test on real testimonies. Generate their top-three rankings locally with the cached model revisions:

```sh
python ml-service/evaluation/qualitative.py --output ml-service/evaluation/results/qualitative.json
```

The JSON includes cosine similarities for reproducibility. They are model-specific similarity scores, not probabilities; do not compare their absolute values across models or use them as relevance thresholds without calibration.

## Independent review

Generate a model-blind worksheet of 167 fictional query/story pairs from the saved model results:

```sh
python ml-service/evaluation/review.py prepare --results ml-service/evaluation/results/bge.json ml-service/evaluation/results/e5.json --review ml-service/evaluation/review/unreviewed-pairs.csv
```

For each row, a Chinese-speaking reviewer should set `relevant_0_or_1` to `1` if the story is useful for the described situation or `0` if it is not; add context in `notes`. Do not infer relevance from topic alone. Reviewers should not inspect the model rankings first. Record reviewer identity, date, and review process separately; the blank file is not evidence of review. The default worksheet path is ignored by Git; keep any copies of responses local as well.

After every row is labeled, compare the same saved rankings using the reviewed labels:

```sh
python ml-service/evaluation/review.py score --results ml-service/evaluation/results/bge.json ml-service/evaluation/results/e5.json --review path/to/completed-review.csv
```

This scores the union of each model's top five and the initial provisional positives, not all possible pairs. The script rejects missing or duplicate rows and changed example text. Queries with no relevant story in the pool are listed and excluded from the aggregate metrics rather than assigned an invented score. No outside-the-pool match can be detected, so this remains a small, incomplete judgment set. For a new run with unchanged fixture, use `review.py prepare` with the same `--results` arguments and a **new** `--review` path; it refuses to overwrite an existing file.
