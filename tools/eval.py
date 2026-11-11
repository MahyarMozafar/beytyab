"""Check search quality: run test sentences and print the best couplets.

Usage:
    python tools/eval.py hafez                 # default model, verse text
    python tools/eval.py hafez --mode both     # verse + summary
    python tools/eval.py hafez --model models/src/onnx/model.onnx

Modes (what text is turned into a vector for each couplet):
    verse    only the two half-lines
    summary  only the plain-language summary
    both     one vector from verse + summary together
    blend    two vectors (verse, summary); the score is their average
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

from corpus import ROOT, load_couplets, verse_text
from embedder import Embedder
from normalize import normalize

# Everyday sentences a visitor might write. Not poetry words on purpose.
QUERIES = [
    "دلم برای کسی که دور است تنگ شده",
    "از دوستی که به من خیانت کرد ناراحتم",
    "امیدوارم روزهای سخت تمام شود",
    "عاشق شده‌ام و نمی‌توانم به او بگویم",
    "عمر زود می‌گذرد باید قدر لحظه را دانست",
    "از آدم‌های دورو و ریاکار خسته‌ام",
    "صبر کن همه چیز درست می‌شود",
    "پول و مقام ارزش ندارد",
    "امشب خیلی تنها هستم",
    "بهار آمده و حالم خوب است",
    "از خدا می‌خواهم کمکم کند",
    "کسی که دوستش داشتم مرا ترک کرد",
    "نباید به حرف مردم اهمیت داد",
    "پیر شده‌ام و جوانی‌ام رفت",
    "می‌خواهم سفر کنم و از این شهر بروم",
    "به دیگران خوبی کن",
    "راز دلم را به هیچ‌کس نمی‌توانم بگویم",
    "دنیا وفا ندارد",
    "خوشحالم که دوباره او را دیدم",
    "شب تا صبح از فکر او خوابم نبرد",
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("collections", nargs="+")
    parser.add_argument("--model", default="models/src/onnx/model_quantized.onnx")
    parser.add_argument("--tokenizer", default="models/src/tokenizer.json")
    parser.add_argument(
        "--mode", default="verse", choices=["verse", "summary", "both", "blend"]
    )
    parser.add_argument("--top", type=int, default=5)
    parser.add_argument(
        "--no-prefix",
        action="store_true",
        help="for models that do not use the e5 'query:' / 'passage:' words",
    )
    args = parser.parse_args()

    couplets = [c for name in args.collections for c in load_couplets(name)]
    embedder = Embedder(ROOT / args.model, ROOT / args.tokenizer)

    verses = [verse_text(c) for c in couplets]
    summaries = [normalize(c["summary"] or "") or verse_text(c) for c in couplets]

    passage_word = "" if args.no_prefix else "passage: "
    query_word = "" if args.no_prefix else "query: "

    def passages(texts: list[str]) -> np.ndarray:
        return embedder.embed([f"{passage_word}{t}" for t in texts])

    if args.mode == "verse":
        vectors = [passages(verses)]
    elif args.mode == "summary":
        vectors = [passages(summaries)]
    elif args.mode == "both":
        vectors = [passages([f"{v} {s}" for v, s in zip(verses, summaries)])]
    else:
        vectors = [passages(verses), passages(summaries)]

    queries = embedder.embed([f"{query_word}{normalize(q)}" for q in QUERIES])
    scores = sum(queries @ v.T for v in vectors) / len(vectors)

    print(f"{len(couplets)} couplets | model {args.model} | mode {args.mode}\n")
    for q, row in zip(QUERIES, scores):
        print(f"? {q}")
        for i in np.argsort(-row)[: args.top]:
            c = couplets[i]
            print(f"   {row[i]:.3f}  {c['m1']} / {c['m2']}   [{c['title']}]")
        print()


if __name__ == "__main__":
    main()
