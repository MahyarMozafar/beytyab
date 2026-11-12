"""Write the expected answers for the in-browser engine test.

Usage:
    python tools/make_engine_cases.py

For each test sentence it stores the vector Python gets and the best
couplet in the packed site data. tests/engine.html must get the same.
"""
from __future__ import annotations

import json

import numpy as np

from corpus import ROOT
from embedder import Embedder
from eval import QUERIES
from normalize import normalize

MODEL = ROOT / "models" / "e5-small-fa"
SITE_DIR = ROOT / "data" / "site"


def main() -> None:
    manifest = json.loads((SITE_DIR / "manifest.json").read_text(encoding="utf-8"))
    embedder = Embedder(MODEL / "onnx" / "model_quantized.onnx", MODEL / "tokenizer.json")
    queries = embedder.embed(["query: " + normalize(q) for q in QUERIES])
    best = [(-1e9, "", 0)] * len(QUERIES)
    for info in manifest["collections"]:
        packed = np.frombuffer((SITE_DIR / f"{info['name']}.bin").read_bytes(), dtype=np.int8)
        scores = queries @ packed.reshape(-1, manifest["dim"]).astype(np.float32).T
        for i, row in enumerate(scores):
            top = int(row.argmax())
            if row[top] > best[i][0]:
                best[i] = (float(row[top]), info["name"], top)
    cases = [
        {"text": q, "vector": [round(float(x), 5) for x in v], "collection": b[1], "row": b[2]}
        for q, v, b in zip(QUERIES, queries, best)
    ]
    out = ROOT / "tests" / "engine-cases.json"
    out.write_text(json.dumps(cases, ensure_ascii=False), encoding="utf-8")
    print(len(cases), "cases ->", out.relative_to(ROOT))


if __name__ == "__main__":
    main()
