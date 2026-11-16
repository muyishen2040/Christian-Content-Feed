# Embedding service

The service uses the full-precision ONNX export of BGE small Chinese to produce
normalized 512-dimensional vectors. The inference endpoint requires a bearer token.
Use fictional input until privacy, access, and safety safeguards have been verified.

## Install and prepare

Activate the Python 3.12 environment described in [setup.md](setup.md), then run:

```sh
python -m pip install -r ml-service/requirements.txt -r ml-service/requirements-test.txt
python ml-service/prepare_model.py
```

The preparation script downloads the pinned ONNX model and tokenizer, verifies their
SHA-256 hashes, and stores them in the Git-ignored `ml-service/model_assets/`.
Inference runs locally with ONNX Runtime and does not send text to a model provider.

The graph comes from `Xenova/bge-small-zh-v1.5` at
`fcecc3c5fef6becfa2b2bdda15c1c938857be534`. The tokenizer comes from
`BAAI/bge-small-zh-v1.5` at `7999e1d3359715c523056ef9478215996d62a620`.

## Run locally

Generate a temporary secret in PowerShell, then start the service on your computer:

```powershell
$env:EMBEDDING_SERVICE_TOKEN = python -c "import secrets; print(secrets.token_urlsafe(32))"
Set-Location ml-service
python -m uvicorn app:app --host 127.0.0.1 --port 8000 --no-access-log --log-level warning
```

The token must contain at least 32 bytes. Send a fictional request to `POST /embed`
with an `Authorization: Bearer <token>` header:

```json
{"text":"希望認識新朋友","kind":"query"}
```

Use `query` for a reader description or `passage` for approved testimony text.
The service adds BGE's retrieval instruction to queries and truncates model input to
512 tokens. Request text is limited to 8,000 characters and the HTTP body to 128 KiB.

The response includes `vector`, `dimension`, `model`, `revision`, and
`export_revision`. `GET /health` reports startup status. Validation errors do
not echo submitted text.

Run the tests from the repository root:

```sh
python -m pytest ml-service/tests
```

Contract tests use a fake encoder. Reference-model tests run when model assets are present.

## Deploy and protect

`ml-service/vercel.json` configures a separate FastAPI project and downloads verified
assets during the build. Use HTTPS, keep deployment protection enabled, and configure
separate secrets and Trusted Sources rules for each caller and environment.

Set `EMBEDDING_SERVICE_TOKEN` as a server-side secret in the service and its caller;
never put it in browser code, URLs, or logs. Set the caller's
`EMBEDDING_SERVICE_URL` and enable `EMBEDDING_SERVICE_USE_VERCEL_OIDC` when protected.

The server-only client in `web/lib/embedding-client.ts` checks the model version and
vector and returns a fallback on failure. It times out after eight seconds. Call it for
personalization only after the description has passed the required safety check.

Configure rate limits for the public caller and the service. An IP-based service limit
may group many users behind one server-side caller; the model lock is not a rate limiter.
Verify application, proxy, platform, and exception logs do not contain submitted text.

Review hosting privacy and retention settings, usage limits, and expected load before
accepting personal text. The service does not handle consent or crisis detection.
See the [Vercel Python runtime](https://vercel.com/docs/functions/runtimes/python)
and [Hobby plan](https://vercel.com/docs/plans/hobby) documentation.

## Rotate credentials

Update the service and caller secrets for the same environment, redeploy both, and test
with fictional input. Verify the new token works and the old one is rejected. The service
accepts one token at a time, so coordinated rotation can briefly interrupt inference.

Use the curated-feed fallback during an interruption. If deployment fails, restore the
last known-good code and matching secrets, then test again. Disable compromised tokens
promptly.
