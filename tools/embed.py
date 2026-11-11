"""Turn every couplet of a collection into a meaning vector.

Usage:
    python tools/embed.py hafez saadi-ghazal      # some collections
    python tools/embed.py all                     # every downloaded one

The model reads the couplet together with its plain-language summary
("passage: <verse> <summary>"). In the quality test this gave clearly
better matches than the verse alone.

Output: data/build/<collection>.npy  (float32, one row per couplet, in
the same order as corpus.load_couplets). A finished collection is
skipped on the next run; delete its file to build it again.
"""
from __future__ import annotations

import sys
import time

import numpy as np

from corpus import RAW, ROOT, load_couplets, verse_text
from embedder import Embedder
from normalize import normalize

MODEL = ROOT / "models" / "e5-small-fa"
BUILD = ROOT / "data" / "build"


def passage_text(couplet: dict) -> str:
    summary = normalize(couplet["summary"] or "")
    return f"passage: {verse_text(couplet)} {summary}".strip()


def main() -> None:
    BUILD.mkdir(parents=True, exist_ok=True)
    wanted = sys.argv[1:] or ["all"]
    if wanted == ["all"]:
        wanted = sorted(f.stem for f in RAW.glob("*.json"))
    embedder = Embedder(MODEL / "onnx" / "model_quantized.onnx", MODEL / "tokenizer.json")
    for name in wanted:
        target = BUILD / f"{name}.npy"
        if target.exists():
            print(f"{name}: already built")
            continue
        couplets = load_couplets(name)
        started = time.time()
        vectors = embedder.embed([passage_text(c) for c in couplets])
        np.save(target, vectors)
        print(f"{name}: {len(couplets)} couplets in {time.time() - started:.0f}s")


if __name__ == "__main__":
    main()
