"""Write test cases for the JavaScript tokenizer and text cleaner.

Usage:
    python tools/make_tokenizer_cases.py out.json

Each case holds a raw text, the cleaned text and the piece numbers the
Python tokenizer gives. tools/test_tokenizer.mjs must reproduce them.
"""
from __future__ import annotations

import json
import sys

from tokenizers import Tokenizer

from corpus import RAW, ROOT, load_couplets
from eval import QUERIES
from normalize import normalize

EXTRA = [
    "سلام،دنیا! ۱۲۳ abc",
    "خانهٔ دوست کجاست؟",
    "می‌خواهم   بروم",
    "«دل» ؟ hello WORLD",
    "😀 دلم گرفته",
    "كتاب علي",
    "اَلا یا اَیُّهَا السّاقی",
    "ﷲ ﻻ",
]


def main() -> None:
    tokenizer = Tokenizer.from_file(str(ROOT / "models" / "e5-small-fa" / "tokenizer.json"))
    tokenizer.enable_truncation(max_length=128)
    raw: list[str] = list(QUERIES) + EXTRA
    for index_file in sorted(RAW.glob("*.json")):
        couplets = load_couplets(index_file.stem)
        for c in couplets[:: max(1, len(couplets) // 1500)]:
            raw.append(f"{c['m1']} {c['m2']}")
            if c["summary"]:
                raw.append(c["summary"])
    cases = []
    for text in raw:
        clean = normalize(text)
        cases.append({"raw": text, "clean": clean, "ids": tokenizer.encode("query: " + clean).ids})
    with open(sys.argv[1], "w", encoding="utf-8") as out:
        json.dump(cases, out, ensure_ascii=False)
    print(len(cases), "cases")


if __name__ == "__main__":
    main()
