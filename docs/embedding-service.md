# Embedding service

MUY-22 is in progress. The service uses the full-precision ONNX export of BGE small Chinese and returns normalized 512-dimensional vectors. A bearer token protects the inference endpoint. Use fictional input until deployment, privacy, and safety checks are complete.

## Install and prepare

From the repository root, activate the Python 3.12 virtual environment described in [setup.md](setup.md), then run:

```sh
python -m pip install -r ml-service/requirements.txt -r ml-service/requirements-test.txt
python ml-service/prepare_model.py
```

The preparation script downloads the pinned public ONNX export and tokenizer and verifies their SHA-256 hashes. Assets live in the Git-ignored `ml-service/model_assets/` directory; no model weights are committed. At inference time the service reads local files and does not send text to a model provider. Python inference uses ONNX Runtime and does not require PyTorch or Transformers.

The ONNX graph is from `Xenova/bge-small-zh-v1.5` at revision `fcecc3c5fef6becfa2b2bdda15c1c938857be534`; the original tokenizer is from `BAAI/bge-small-zh-v1.5` at revision `7999e1d3359715c523056ef9478215996d62a620`. On the local fictional fixture, the ONNX output and tokenization matched the reference model closely, with the same ordered top five for all 24 queries. This small comparison is not pilot validation.

## Run locally

In PowerShell, generate a temporary secret, then run the service bound to your own computer:

```powershell
$env:EMBEDDING_SERVICE_TOKEN = python -c "import secrets; print(secrets.token_urlsafe(32))"
Set-Location ml-service
python -m uvicorn app:app --host 127.0.0.1 --port 8000 --no-access-log --log-level warning
```

The service refuses to start with a missing or short secret. In another terminal, set the same `EMBEDDING_SERVICE_TOKEN` value without committing it; do not expose it in shared scripts. Send a fictional request with an `Authorization: Bearer <token>` header:

```json
{"text":"希望認識新朋友", "kind":"query"}
```

`POST /embed` returns `vector`, `dimension`, `model`, `revision`, and `export_revision`. `kind` is `query` for a reader's description and `passage` for an approved testimony representation. For queries the service adds BGE's retrieval instruction. Model input is truncated at 512 tokens including special tokens and the instruction; request text is bounded at 8,000 characters and the HTTP body at 128 KiB. `GET /health` returns status after startup. Invalid requests return generic errors without echoing text. Tests use a fake encoder so normal CI does not download model weights.

For local checks:

```sh
python -m pytest ml-service/tests
```

## Credentials and recovery

Use a randomly generated service token with at least 32 bytes and store it as a server-side Vercel secret, never in browser code. Use different values for preview and production. Configure the corresponding caller with the same token, its environment-specific service URL, and OIDC enabled for protected Vercel deployments. The receiving service must trust only the intended caller and environment. Do not place the token in URLs, source files, or logs.

To rotate a token, update the service and caller secrets for the same environment, redeploy both, and verify with fictional input that authorized requests succeed and the old token is rejected. The service currently accepts one token at a time, so a coordinated rotation can cause a temporary interruption; the caller must use the curated-feed fallback during that period. If the new deployments fail, redeploy the prior known-good code and matching secrets, then test again. Disable any compromised token promptly.

## Vercel test and pilot safeguards

`ml-service/vercel.json` configures a separate FastAPI project and downloads verified assets at build time. The protected `christian-feed-embedding-test` preview was built on Vercel using fictional input on 2026-11-15. The build log reported a 256.96 MB bundle before Vercel's optimization. The deployed service returned a normalized 512-dimensional vector matching local ONNX inference, rejected a request without the application token, and returned generic errors for invalid and oversized requests. Three warm authenticated requests took 81.6–93.7 ms end-to-end from the test computer. A separate instrumented preview recorded one model initialization of 1.45 seconds and 233.4 MiB peak process memory after a short inference. These limited measurements are not latency, memory, or cost guarantees; projected usage remains unverified. The tested fictional sentinel was not found in the available runtime logs. The test project is separate from the website and has Vercel deployment protection enabled.

A separate Next.js smoke-test preview successfully called the embedding preview with a short-lived Vercel OIDC token and the application token. The service project trusts only that smoke-test project's preview environment for the test. The real website has not been connected: its preview and production Trusted Sources rules and secrets require separate, environment-specific configuration. The caller helper is `web/lib/embedding-client.ts`; it returns a fallback on service errors and must only receive a personalization query after the safety check.

Vercel's published Hobby allowances include 4 active CPU-hours, 360 GB-hours of provisioned memory, and 1 million function invocations per month. These are shared usage allowances, not a capacity estimate for this model. Peak process memory is not the same as provisioned memory, and startup frequency, input length, concurrent traffic, and other projects affect actual usage. Check the team's usage dashboard during a realistic fictional-data pilot before relying on these limits. Hobby is restricted to personal, non-commercial use; confirm the intended use fits the plan.

Before a pilot, configure and verify the real website's protected service-to-service access, deployment-level rate limits, credential rotation, and verification that application, proxy, platform, and exception logs never contain request text. The client has an eight-second timeout. The in-process model lock is not a rate limiter across requests or instances. A per-IP limit at the embedding service may group multiple users behind the same server-side caller, so limits also need to be designed around the public caller. Confirm privacy and retention settings for the chosen host. The service alone does not perform crisis detection or consent handling.

Sources: [Vercel Python runtime](https://vercel.com/docs/functions/runtimes/python), [Vercel Hobby plan](https://vercel.com/docs/plans/hobby).
