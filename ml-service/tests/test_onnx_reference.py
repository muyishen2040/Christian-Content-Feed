"""Compare inference with small, fictional PyTorch reference outputs when assets exist."""

import math
from pathlib import Path

import pytest

from app import BGEEncoder

ASSETS = Path(__file__).resolve().parents[1] / "model_assets"
pytestmark = pytest.mark.skipif(
    not (ASSETS / "model.onnx").is_file() or not (ASSETS / "tokenizer.json").is_file(),
    reason="model assets are downloaded separately",
)


@pytest.mark.parametrize(
    ("text", "kind", "reference"),
    [
        ("我照顧家人感到疲憊", "query", [-0.04727244, -0.03222596, -0.04659733, -0.02472613, 0.02864207, 0.04251367, -0.08511000, 0.06710915, 0.05282504, -0.06214181, 0.06809130, -0.19811286]),
        ("搬到新城市後，她在教會找到支持。", "passage", [-0.05542610, 0.06641975, 0.05587139, 0.02469832, 0.04097783, -0.01886193, -0.02518574, -0.00687255, 0.04302648, -0.02120833, 0.07601561, -0.23765421]),
    ],
)
def test_onnx_agrees_with_pinned_pytorch_reference(text, kind, reference):
    vector = BGEEncoder().encode(text, kind)
    assert len(vector) == 512
    assert math.sqrt(sum(value * value for value in vector)) == pytest.approx(1.0, abs=1e-5)
    assert vector[: len(reference)] == pytest.approx(reference, abs=1e-5)
