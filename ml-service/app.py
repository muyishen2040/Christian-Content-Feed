"""Authenticated embedding API. The model and request text stay in this process."""

import hmac
import math
import os
from contextlib import asynccontextmanager
from pathlib import Path
from threading import Lock
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

MODEL_NAME = "BAAI/bge-small-zh-v1.5"
MODEL_REVISION = "7999e1d3359715c523056ef9478215996d62a620"
EXPORT_REVISION = "fcecc3c5fef6becfa2b2bdda15c1c938857be534"
DIMENSION = 512
QUERY_PREFIX = "为这个句子生成表示以用于检索相关文章："
MAX_REQUEST_BYTES = 128 * 1024


class BodyLimitMiddleware:
    """Bound request bytes before JSON parsing, including streamed requests."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["path"] != "/embed":
            return await self.app(scope, receive, send)
        length = 0

        async def bounded_receive():
            nonlocal length
            message = await receive()
            if message["type"] == "http.request":
                length += len(message.get("body", b""))
                if length > MAX_REQUEST_BYTES:
                    raise HTTPException(status_code=413, detail="Request too large")
            return message

        return await self.app(scope, bounded_receive, send)


class EmbeddingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    text: str = Field(min_length=1, max_length=8000)
    kind: Literal["query", "passage"]

    @field_validator("text")
    @classmethod
    def nonempty_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("text must not be blank")
        return value


class EmbeddingResponse(BaseModel):
    vector: list[float]
    model: str
    revision: str
    export_revision: str
    dimension: int


class BGEEncoder:
    """Run the pinned full-precision ONNX export with the original tokenizer."""

    def __init__(self):
        import onnxruntime as ort
        from tokenizers import Tokenizer

        assets = Path(__file__).resolve().parent / "model_assets"
        self.tokenizer = Tokenizer.from_file(str(assets / "tokenizer.json"))
        self.tokenizer.enable_truncation(max_length=512)
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        self.session = ort.InferenceSession(str(assets / "model.onnx"), sess_options=options, providers=["CPUExecutionProvider"])
        self.lock = Lock()

    def encode(self, text: str, kind: str) -> list[float]:
        content = QUERY_PREFIX + text if kind == "query" else text
        import numpy as np

        with self.lock:
            encoded = self.tokenizer.encode(content)
            tokens = {"input_ids": encoded.ids, "attention_mask": encoded.attention_mask, "token_type_ids": encoded.type_ids}
            inputs = {item.name: np.asarray([tokens[item.name]], dtype=np.int64) for item in self.session.get_inputs()}
            output = self.session.run(None, inputs)[0][0, 0]
            norm = float(np.linalg.norm(output))
            if not math.isfinite(norm) or norm == 0:
                raise ValueError("invalid model output")
            return (output / norm).tolist()


def create_app(*, token: str | None = None, encoder_factory=BGEEncoder) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI):
        secret = token if token is not None else os.environ.get("EMBEDDING_SERVICE_TOKEN", "")
        if len(secret.encode("utf-8")) < 32:
            raise RuntimeError("EMBEDDING_SERVICE_TOKEN must be at least 32 bytes")
        application.state.secret = secret.encode("utf-8")
        application.state.encoder = encoder_factory()
        yield

    application = FastAPI(title="Embedding service", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    application.add_middleware(BodyLimitMiddleware)

    @application.exception_handler(RequestValidationError)
    async def invalid_request(_request: Request, _error: RequestValidationError):
        # FastAPI's default error includes rejected input, which may be sensitive.
        return JSONResponse(status_code=422, content={"detail": "Invalid embedding request"})

    def authenticate(request: Request):
        header = request.headers.get("authorization", "")
        supplied = header.removeprefix("Bearer ") if header.startswith("Bearer ") else ""
        if not supplied or not hmac.compare_digest(supplied.encode("utf-8"), request.app.state.secret):
            raise HTTPException(status_code=401, detail="Unauthorized", headers={"WWW-Authenticate": "Bearer"})

    @application.get("/health")
    def health():
        return {"status": "ok"}

    @application.post("/embed", response_model=EmbeddingResponse, dependencies=[Depends(authenticate)])
    def embed(payload: EmbeddingRequest, request: Request):
        try:
            vector = request.app.state.encoder.encode(payload.text, payload.kind)
            if len(vector) != DIMENSION or not all(math.isfinite(value) for value in vector):
                raise ValueError("invalid vector")
        except Exception:
            # Do not log the exception: model or tokenizer errors can include input text.
            raise HTTPException(status_code=503, detail="Embedding unavailable") from None
        return EmbeddingResponse(vector=vector, model=MODEL_NAME, revision=MODEL_REVISION, export_revision=EXPORT_REVISION, dimension=DIMENSION)

    return application


app = create_app()
