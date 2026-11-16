import logging

import pytest
from fastapi.testclient import TestClient

from app import DIMENSION, EXPORT_REVISION, MAX_REQUEST_BYTES, MODEL_NAME, MODEL_REVISION, create_app

TOKEN = "test-token-" + "x" * 32


class FakeEncoder:
    def encode(self, text, kind):
        if text == "simulate-model-failure":
            raise RuntimeError("sensitive-error-sentinel")
        return [1.0] + [0.0] * (DIMENSION - 1)


@pytest.fixture
def client():
    with TestClient(create_app(token=TOKEN, encoder_factory=FakeEncoder), raise_server_exceptions=False) as client:
        yield client


def test_service_health_and_authenticated_contract(client):
    assert client.get("/health").json() == {"status": "ok"}
    response = client.post("/embed", headers={"Authorization": f"Bearer {TOKEN}"}, json={"text": "fictional", "kind": "query"})
    assert response.status_code == 200
    body = response.json()
    assert body["model"] == MODEL_NAME
    assert body["revision"] == MODEL_REVISION
    assert body["export_revision"] == EXPORT_REVISION
    assert body["dimension"] == DIMENSION
    assert len(body["vector"]) == DIMENSION
    assert sum(value * value for value in body["vector"]) == pytest.approx(1.0)


def test_authentication_is_required(client):
    for authorization in (None, "Bearer wrong", TOKEN):
        headers = {"Authorization": authorization} if authorization else {}
        response = client.post("/embed", headers=headers, json={"text": "fictional", "kind": "query"})
        assert response.status_code == 401


@pytest.mark.parametrize("payload", [
    {"text": "", "kind": "query"},
    {"text": "   ", "kind": "query"},
    {"text": "x" * 8001, "kind": "passage"},
    {"text": "fictional", "kind": "other"},
    {"text": 123, "kind": "query"},
    {"text": "fictional", "kind": "query", "extra": "value"},
])
def test_rejects_invalid_inputs_with_generic_errors(client, payload):
    response = client.post("/embed", headers={"Authorization": f"Bearer {TOKEN}"}, json=payload)
    assert response.status_code == 422
    assert response.json() == {"detail": "Invalid embedding request"}


def test_input_and_exception_are_not_logged_or_returned(client, caplog):
    caplog.set_level(logging.DEBUG)
    headers = {"Authorization": f"Bearer {TOKEN}"}
    sentinel = "private-test-sentinel"
    success = client.post("/embed", headers=headers, json={"text": sentinel, "kind": "passage"})
    rejected = client.post("/embed", headers=headers, json={"text": sentinel * 1000, "kind": "query"})
    failure = client.post("/embed", headers=headers, json={"text": "simulate-model-failure", "kind": "query"})
    assert (success.status_code, rejected.status_code, failure.status_code) == (200, 422, 503)
    assert failure.json() == {"detail": "Embedding unavailable"}
    for text in (sentinel, "simulate-model-failure", "sensitive-error-sentinel", TOKEN):
        assert text not in caplog.text
        assert all(text not in response.text for response in (success, rejected, failure))


def test_request_body_is_bounded_before_json_parsing(client):
    response = client.post(
        "/embed",
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        content=b"x" * (MAX_REQUEST_BYTES + 1),
    )
    assert response.status_code == 413
    assert response.json() == {"detail": "Request too large"}


def test_service_refuses_missing_or_weak_secret():
    with pytest.raises(RuntimeError, match="at least 32 bytes"):
        with TestClient(create_app(token="weak", encoder_factory=FakeEncoder)):
            pass
