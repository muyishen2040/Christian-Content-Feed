"""Development-only service skeleton. No inference or request logging."""

from fastapi import FastAPI

app = FastAPI(title="Embedding service scaffold")


@app.get("/health")
def health():
    return {"status": "ok"}
