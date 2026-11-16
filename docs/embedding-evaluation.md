# Chinese embedding comparison

Use `BAAI/bge-small-zh-v1.5` for development. On a small fictional fixture it was
faster and ranked provisional labels higher than `intfloat/multilingual-e5-small`,
but it also made a meaningful perspective error. These results do not validate a pilot.

## Method

On 2026-11-15, two model processes ran sequentially on CPU with two PyTorch threads,
cached model files, three passes, and the same 24 fictional stories and 24 fictional
queries (12 Traditional and 12 Simplified Chinese).

The test used an Intel Core Ultra 7 155H laptop with approximately 32 GB RAM, Windows 11,
and Python 3.12.10. Latency excludes network, safety screening, database search, and load.

Labels are based on the fixture's topics, except for two perspective-specific forgiveness
queries. They were authored with the examples, not independently reviewed. Relevant
cross-topic stories may be scored as incorrect.

Treat the metrics as an early signal, not a reliable estimate of testimony discovery.
The fixture is not approved publisher content and needs independent language, relevance,
fairness, and safety review before it can support a pilot decision.

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

Each script group contains only 12 queries. Timings are from one local run, not a
production benchmark or capacity estimate. Cached load excludes downloads; startup
includes library imports. Peak RSS includes batch encoding and is not steady-state memory.

See [the evaluation guide](../ml-service/evaluation/README.md) for settings, pinned
revisions, and instructions to generate rankings. A new run may produce different
timings or rankings.

## Examples to review

- **Correct direction:** for a query about uncertainty after a layoff (`job_transition-q1`), BGE ranked both job-transition stories first and second.
- **Perspective error:** for a person hurt by a friend's betrayal (`forgiveness-q1`), BGE ranked the story about a person who hurt someone else first. The more directly relevant story ranked second. A shared topic does not guarantee a helpful perspective.
- **Missed context:** for a Simplified Chinese query about loneliness after moving (`relocation-q2`), E5's top five did not include either of the two provisionally labeled relocation stories. Other items in the pool still require human judgment.
- **False lead:** for a Traditional Chinese query about bills and rent (`financial-q1`), BGE's first result was a caregiving story; the financial-pressure story came second.

A model-blind review covered 56 of 167 pooled query/story pairs, including seven
complete query pools and part of an eighth. In those seven complete pools, the reviewer
marked the first BGE result relevant seven times and the first E5 result four times.

These counts describe a small, non-random sample, not full-dataset performance. Use
permission-reviewed representative content and a broader range of situations to assess
relevance and safety before a pilot.

## Longer example situations

Eight longer fictional situations were also tested against the same story catalog.
The [evaluation guide](../ml-service/evaluation/README.md) explains how to regenerate
their rankings; these examples do not change the metrics above.

Both models ranked a caregiving story first for someone exhausted while caring for her
mother. For someone betrayed by a friend, both ranked a story from the person who caused
harm first. Neither found a close match for earthquake-related housing loss.

These exploratory results illustrate why ranking alone cannot establish relevance and
why a curated fallback is needed. Cosine scores are model-specific, not probabilities,
and should not be compared across models.

## MVP implementation decision

- Use BGE with 512-dimensional, normalized vectors, the Chinese retrieval instruction on queries, CLS pooling and the pinned model revision from the evaluation guide. Store model/version metadata with each embedding. Documents and queries must use the same model and compatible version.
- Represent an item with its title and the beginning of the testimony within the token limit, where the source permits processing. This representation and long testimonies were not evaluated here.
- If moving to E5, use its `query: ` and `passage: ` prefixes and mean pooling; its 384-dimensional vectors require a compatible schema/index and re-embedding the catalog. Scores and thresholds are not interchangeable.
- On inference failure, return a diverse editorially curated starter feed. A flagged crisis description must not be used for personalization or stored; the embedding benchmark does not validate the safety detector.
- Before the pilot, have a human judge real-world relevance, run safety-specific evaluations, measure on the actual target instance and check end-to-end response time under expected concurrency. This experiment does not establish which instance size is sufficient.

Sources for pooling and input prefixes: [BAAI model card](https://huggingface.co/BAAI/bge-small-zh-v1.5), [E5 model card](https://huggingface.co/intfloat/multilingual-e5-small).
