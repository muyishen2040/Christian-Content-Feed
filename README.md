# Christian Content Feed

Shared foundation for a Traditional Chinese testimony discovery app. The web app currently displays fictional mock content; it does not connect to a database or personalization service.

See [local setup](docs/setup.md). Use npm for the web app and Python 3.12 for the Python components.

| Directory | Purpose |
| --- | --- |
| `web/` | Next.js frontend |
| `pipeline/` | Future content import pipeline and example fixture |
| `ml-service/` | FastAPI embedding service skeleton |
| `supabase/` | Future shared database configuration and migrations |
| `docs/` | Collaboration and setup documentation |
