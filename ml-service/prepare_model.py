"""Fetch pinned public model assets at build time, with integrity checks."""

import hashlib
import os
import tempfile
from pathlib import Path
from urllib.request import urlopen

ASSETS = Path(__file__).resolve().parent / "model_assets"
FILES = {
    "model.onnx": (
        "https://huggingface.co/Xenova/bge-small-zh-v1.5/resolve/fcecc3c5fef6becfa2b2bdda15c1c938857be534/onnx/model.onnx",
        "69a0b846f4f116b5e6aabf9546ea6754d02264f3211a13a1bd69b31b8040749a",
    ),
    "tokenizer.json": (
        "https://huggingface.co/BAAI/bge-small-zh-v1.5/resolve/7999e1d3359715c523056ef9478215996d62a620/tokenizer.json",
        "48cea5d44424912a6fd1ea647bf4fe50b55ab8b1e5879c3275f80e339e8fae26",
    ),
}


def digest(path: Path) -> str:
    checksum = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            checksum.update(chunk)
    return checksum.hexdigest()


def main():
    ASSETS.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=ASSETS) as temp:
        for name, (url, expected_hash) in FILES.items():
            target = ASSETS / name
            if target.is_file() and digest(target) == expected_hash:
                print(f"Verified cached {name}")
                continue
            download = Path(temp) / name
            with urlopen(url, timeout=120) as response, download.open("wb") as output:
                checksum = hashlib.sha256()
                for chunk in iter(lambda: response.read(1024 * 1024), b""):
                    checksum.update(chunk)
                    output.write(chunk)
            if checksum.hexdigest() != expected_hash:
                raise RuntimeError(f"Integrity check failed for {name}")
            os.replace(download, target)
            print(f"Downloaded and verified {name}")


if __name__ == "__main__":
    main()
