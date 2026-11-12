"""Pack the poems and their vectors into the small files the site loads.

Usage:
    python tools/pack.py

For every collection in SITE it writes two files in data/site/:
    <name>.json  the couplets a visitor reads (text, meaning, poem title)
    <name>.bin   one row of 384 signed bytes per couplet (the vector)
and one data/site/manifest.json that lists them.

Vectors are stored as 8-bit numbers. All collections share one scale, so
scores from different poets can be compared directly.
"""
from __future__ import annotations

import json
import re

import numpy as np

from corpus import ROOT, load_couplets

BUILD = ROOT / "data" / "build"
SITE_DIR = ROOT / "data" / "site"

# Order = loading order in the browser. Hafez first: small and most loved.
SITE = [
    ("hafez", "حافظ", "غزلیات"),
    ("saadi-ghazal", "سعدی", "دیوان اشعار"),
    ("saadi-boostan", "سعدی", "بوستان"),
    ("moulavi-masnavi", "مولانا", "مثنوی معنوی"),
]

# Vowel marks are removed for display (the source has them on some poems
# only). The doubling mark (shadda) stays: it helps reading.
DISPLAY_MARKS = re.compile("[\u064b-\u0650\u0652-\u065f\u0670]")
SPACES = re.compile(r"\s+")


def display(text: str | None) -> str:
    if not text:
        return ""
    text = DISPLAY_MARKS.sub("", text.replace("\u00a0", " "))
    return SPACES.sub(" ", text).strip()


def poem_label(couplet: dict) -> str:
    """Where the couplet is from, e.g. 'دفتر اول، بخش ۱'."""
    parts = [p for p in couplet["path"][1:]] + [couplet["title"]]
    return "، ".join(display(p) for p in parts)


def main() -> None:
    SITE_DIR.mkdir(parents=True, exist_ok=True)
    vectors = {name: np.load(BUILD / f"{name}.npy") for name, _, _ in SITE}
    scale = float(max(np.abs(v).max() for v in vectors.values()))
    model_dir = ROOT / "models" / "e5-small-fa"
    manifest = {
        "dim": 384,
        "scale": scale,
        # File sizes let the page show a true loading bar.
        "modelBytes": (model_dir / "onnx" / "model_quantized.onnx").stat().st_size,
        "tokenizerBytes": (model_dir / "tokenizer.json").stat().st_size,
        "engineBytes": (ROOT / "js" / "vendor" / "ort" / "ort-wasm-simd-threaded.wasm").stat().st_size,
        "collections": [],
    }

    for name, poet_name, book in SITE:
        couplets = load_couplets(name)
        matrix = vectors[name]
        assert len(couplets) == len(matrix), name

        poems: list[list[str]] = []
        poem_index: dict[int, int] = {}
        rows: list[list] = []
        for c in couplets:
            if c["poem"] not in poem_index:
                poem_index[c["poem"]] = len(poems)
                poems.append([poem_label(c), c["url"]])
            rows.append(
                [poem_index[c["poem"]], display(c["m1"]), display(c["m2"]), display(c["summary"])]
            )

        packed = np.clip(np.round(matrix / scale * 127), -127, 127).astype(np.int8)
        (SITE_DIR / f"{name}.bin").write_bytes(packed.tobytes())
        (SITE_DIR / f"{name}.json").write_text(
            json.dumps({"poems": poems, "couplets": rows}, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        size = (SITE_DIR / f"{name}.bin").stat().st_size + (SITE_DIR / f"{name}.json").stat().st_size
        manifest["collections"].append(
            {
                "name": name,
                "poet": c["poet"],
                "poetName": poet_name,
                "book": book,
                "count": len(rows),
                "bytes": size,
            }
        )
        print(f"{name}: {len(rows)} couplets, {len(poems)} poems, {size / 1e6:.1f} MB")

    (SITE_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print(f"scale {scale:.4f}")


if __name__ == "__main__":
    main()
