"""Read the downloaded poems and join their lines into couplets (beyt)."""
from __future__ import annotations

import json
from pathlib import Path

from normalize import normalize

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"


def load_couplets(collection: str) -> list[dict]:
    """Return every couplet of one collection, in book order.

    Each couplet: poem id, poem title, url, couplet number, the two
    half-lines as written (m1, m2), and the plain-language summary if the
    source has one.
    """
    index = json.loads((RAW / f"{collection}.json").read_text(encoding="utf-8"))
    couplets: list[dict] = []
    for entry in index["poems"]:
        file = RAW / "poems" / f"{entry['id']}.json"
        if not file.exists():
            continue
        poem = json.loads(file.read_text(encoding="utf-8"))
        groups: dict[int, list[dict]] = {}
        for verse in sorted(poem["verses"], key=lambda v: v["o"]):
            groups.setdefault(verse["c"], []).append(verse)
        for number, lines in groups.items():
            texts = [v["t"].strip() for v in lines if v["t"] and v["t"].strip()]
            if not texts:
                continue
            summary = next((v["s"] for v in lines if v["s"]), None)
            couplets.append(
                {
                    "poet": index["poet"],
                    "book": index["book"],
                    "poem": poem["id"],
                    "title": poem["title"],
                    "path": entry["path"],
                    "url": poem["url"],
                    "n": number,
                    "m1": texts[0],
                    "m2": " ".join(texts[1:]),
                    "summary": summary.strip() if summary else None,
                }
            )
    return couplets


def verse_text(couplet: dict) -> str:
    """The couplet as plain normalized text (what the model reads)."""
    return normalize(f"{couplet['m1']} {couplet['m2']}")
