# Local development

Requires Node.js 22 or newer, npm, Git, and Python 3.12. No credentials or external services are needed for the mock app.

## Web

From a fresh clone:

```sh
cd web
npm ci
npm run dev
```

Open http://localhost:3000. Use `npm run format:check`, `npm run lint`, `npm run typecheck`, and `npm run build` for checks. The sample stories are fictional and have no publisher links.

## Python

From the repository root, create a virtual environment and install the pinned direct dependencies:

```sh
python -m venv .venv
```

Activate it with `source .venv/bin/activate` on macOS/Linux or `.venv\Scripts\Activate.ps1` in PowerShell. Then run:

```sh
python -m pip install -r pipeline/requirements.txt -r ml-service/requirements.txt
python -m pytest pipeline/tests
python -m pytest ml-service/tests
```

To start the placeholder ML service, run from `ml-service/`:

```sh
python -m uvicorn app:app --reload
```

The health endpoint is http://localhost:8000/health. There is no embedding model or ingestion implementation yet. `.env.example` documents future configuration; copying it is not required for this scaffold. Never commit credentials or personal descriptions.
