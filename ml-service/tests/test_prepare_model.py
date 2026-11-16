import hashlib
from io import BytesIO

import pytest

import prepare_model


def test_preparation_verifies_download_and_reuses_it(tmp_path, monkeypatch):
    content = b"fictional-model-data"
    checksum = hashlib.sha256(content).hexdigest()
    monkeypatch.setattr(prepare_model, "ASSETS", tmp_path)
    monkeypatch.setattr(prepare_model, "FILES", {"model.onnx": ("https://example.invalid/model", checksum)})
    monkeypatch.setattr(prepare_model, "urlopen", lambda *args, **kwargs: BytesIO(content))

    prepare_model.main()
    assert (tmp_path / "model.onnx").read_bytes() == content

    def must_not_download(*args, **kwargs):
        raise AssertionError("verified model was downloaded again")

    monkeypatch.setattr(prepare_model, "urlopen", must_not_download)
    prepare_model.main()


def test_bad_download_does_not_replace_existing_asset(tmp_path, monkeypatch):
    target = tmp_path / "model.onnx"
    target.write_bytes(b"existing-file")
    checksum = hashlib.sha256(b"expected-model").hexdigest()
    monkeypatch.setattr(prepare_model, "ASSETS", tmp_path)
    monkeypatch.setattr(prepare_model, "FILES", {"model.onnx": ("https://example.invalid/model", checksum)})
    monkeypatch.setattr(prepare_model, "urlopen", lambda *args, **kwargs: BytesIO(b"wrong-model"))

    with pytest.raises(RuntimeError, match="Integrity check failed"):
        prepare_model.main()
    assert target.read_bytes() == b"existing-file"
