# MUY-21: preliminary Chinese embedding comparison

**Status: preliminary; independent relevance review and an AWS measurement are still needed.** Retain `BAAI/bge-small-zh-v1.5` as the candidate for local development, rather than treating this experiment as approval for the pilot. On this small synthetic fixture it was both faster and ranked the provisional labels higher than `intfloat/multilingual-e5-small`, but it also made a meaningful perspective error. No real user descriptions or third-party AI inference services were used.

## Method

On 2026-11-15, two model processes were run sequentially with CPU inference limited to two PyTorch threads, cached model files, three passes, and the same 24 fictional stories and 24 fictional queries (12 Traditional and 12 Simplified Chinese). Hardware was an HP Pavilion Plus Laptop 14-ew1xxx, Intel Core Ultra 7 155H, approximately 32 GB RAM, Windows 11 and Python 3.12.10. Measured latency excludes network, API calls, safety screening, database search, queueing and load. A laptop CPU with two threads is **not** an EC2 two-vCPU instance.

The provisional labels come from the fixture's topic groupings, except for two perspective-specific forgiveness queries; they were authored with the examples and were **not independently reviewed by a human**. Treat the metrics as a reproducibility check and an early signal, not a reliable estimate for actual testimony discovery. Cross-topic relevant stories may be scored as incorrect. The fixture was not drawn from approved publisher content and needs independent language, relevance, fairness and safety review before it can support a pilot decision.

| Measure | BGE small Chinese v1.5 | Multilingual E5 small |
| --- | ---: | ---: |
| Vector dimensions | 512 | 384 |
| Recall@5, provisional | 0.979 | 0.833 |
| MRR@5, provisional | 0.958 | 0.842 |
| NDCG@5, provisional | 0.921 | 0.767 |
| NDCG@5, Traditional queries | 0.866 | 0.659 |
| NDCG@5, Simplified queries | 0.976 | 0.875 |
| Query encoding p50 / p95 | 20.71 / 26.54 ms | 32.28 / 43.78 ms |
| Cached model/tokenizer load | 0.666 s | 1.836 s |
| Imports through first query | 8.015 s | 9.227 s |
| Sampled peak process RSS | 359.8 MiB | 624.9 MiB |

There are only 12 queries in each script group. The timings are one local run, not cloud capacity, a production benchmark, a fairness conclusion or an SLA. Cached load excludes downloading weights; startup begins inside the script before importing the ML libraries. Peak RSS includes batch encoding all stories and is not steady-state service memory. See [the evaluation guide](../ml-service/evaluation/README.md), the [BGE results](../ml-service/evaluation/results/bge.json), and the [E5 results](../ml-service/evaluation/results/e5.json) for settings, model revisions, per-query rankings and limitations.

## Examples to review

- **Correct direction:** for a query about uncertainty after a layoff (`job_transition-q1`), BGE ranked both job-transition stories first and second.
- **Perspective error:** for a person hurt by a friend's betrayal (`forgiveness-q1`), BGE ranked the story about a person who hurt someone else first. The more directly relevant story ranked second. A shared topic does not guarantee a helpful perspective.
- **Missed context:** for a Simplified Chinese query about loneliness after moving (`relocation-q2`), E5's top five did not include either of the two provisionally labeled relocation stories. Other items in the pool still require human judgment.
- **False lead:** for a Traditional Chinese query about bills and rent (`financial-q1`), BGE's first result was a caregiving story; the financial-pressure story came second.

The [blind review sheet](../ml-service/evaluation/review/unreviewed-pairs.csv) contains 167 model-blind pooled query/story pairs with **empty** relevance labels. A Chinese-speaking human reviewer should complete the sheet before the results are represented as human-judged. The guide explains how to score the reviewed pool and its limitations. Use a separate, permission-reviewed set of real catalog descriptions and a broader set of life situations for a later pilot evaluation.

## Implementation decision for the prototype

- Use BGE as the **provisional** candidate with 512-dimensional, normalized vectors, the Chinese retrieval instruction on queries, CLS pooling and the pinned model revision from the evaluation guide. Store model/version metadata with each embedding. Documents and queries must use the same model and compatible version.
- If moving to E5, use its `query: ` and `passage: ` prefixes and mean pooling; its 384-dimensional vectors require a compatible schema/index and re-embedding the catalog. Scores and thresholds are not interchangeable.
- On inference failure, return a diverse editorially curated starter feed. A flagged crisis description must not be used for personalization or stored; the embedding benchmark does not validate the safety detector.
- Before the pilot, have a human judge real-world relevance, run safety-specific evaluations, measure on the actual target instance and check end-to-end response time under expected concurrency. This experiment does not establish which instance size is sufficient.

## Illustrative hosting cost

AWS's [T3 instance table](https://aws.amazon.com/ec2/instance-types/t3/) lists Linux On-Demand in US East (N. Virginia) at **$0.0209/hour for t3.small** (2 vCPUs, 2 GiB) and **$0.0418/hour for t3.medium** (2 vCPUs, 4 GiB). At 730 hours/month, that is approximately **$15.26** and **$30.51** respectively for instance compute alone, before any eligible credits. These are examples, not sizing recommendations. EBS storage, public IPv4, data transfer, monitoring, taxes, and potentially CPU surplus credits are additional. T3 unlimited instances can incur surplus CPU charges for sustained usage above their baseline. Check current regional prices and actual workload measurements with the [AWS Pricing Calculator](https://calculator.aws/) before deployment.

Sources for pooling and input prefixes: [BAAI model card](https://huggingface.co/BAAI/bge-small-zh-v1.5), [E5 model card](https://huggingface.co/intfloat/multilingual-e5-small).
