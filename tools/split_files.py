"""Cut the big site files into 1 MB parts (and put them together again).

Why: many visitors are on a weak connection that drops. One 27 MB file
either arrives whole or not at all, and after a drop it starts again from
zero. In 1 MB parts, every finished part is kept by the browser, so the
download goes on from where it stopped, even on the next visit.

Every file in BIG that is larger than one part is written as
    <file>.p000, <file>.p001, ...
and data/site/manifest.json gets a "parts" table (file -> number of parts)
and a "files" number that changes whenever a file changes, so browsers
throw old parts away.

The whole files are not in git (see .gitignore); the parts are. After a
fresh clone run:  python tools/split_files.py --join

Run after tools/pack.py or tools/prune_model.py:
    python tools/split_files.py
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "data" / "site" / "manifest.json"
PART = 1024 * 1024

BIG = [
    "models/e5-small-fa/onnx/model_quantized.onnx",
    "js/vendor/ort/ort-wasm-simd-threaded.wasm",
    "data/site/hafez.bin",
    "data/site/hafez.json",
    "data/site/saadi-ghazal.bin",
    "data/site/saadi-ghazal.json",
    "data/site/saadi-boostan.bin",
    "data/site/saadi-boostan.json",
    "data/site/moulavi-masnavi.bin",
    "data/site/moulavi-masnavi.json",
]


def old_parts(path: Path) -> list[Path]:
    return sorted(path.parent.glob(path.name + ".p[0-9][0-9][0-9]"))


def split() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    parts: dict[str, int] = {}
    digest = hashlib.sha256()
    for name in BIG:
        path = ROOT / name
        data = path.read_bytes()
        digest.update(name.encode() + hashlib.sha256(data).digest())
        for stale in old_parts(path):
            stale.unlink()
        if len(data) <= PART:
            continue
        count = -(-len(data) // PART)
        for i in range(count):
            (path.parent / f"{path.name}.p{i:03d}").write_bytes(data[i * PART : (i + 1) * PART])
        parts[name] = count
        print(f"{name}: {len(data) / 1e6:.1f} MB -> {count} parts")
    manifest["parts"] = parts
    manifest["files"] = digest.hexdigest()[:10]
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"files version {manifest['files']}")


def join() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    for name, count in manifest.get("parts", {}).items():
        path = ROOT / name
        data = b"".join((path.parent / f"{path.name}.p{i:03d}").read_bytes() for i in range(count))
        path.write_bytes(data)
        print(f"{name}: {len(data) / 1e6:.1f} MB from {count} parts")


if __name__ == "__main__":
    join() if "--join" in sys.argv else split()
