import json
from pathlib import Path


def test_example_fixture_is_explicitly_fictional():
    fixture = json.loads((Path(__file__).parents[1] / "fixtures" / "example.json").read_text(encoding="utf-8"))
    assert fixture["fictional"] is True
    assert fixture["id"] and fixture["title"] and fixture["preview"]
