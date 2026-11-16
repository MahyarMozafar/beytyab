"""Make the language model small enough for a phone.

The model knows about 250,000 word pieces from 100 languages. Almost all
of its file size is one big table with one row per word piece. This site
only reads Persian, so we keep the rows a Persian reader can ever need
and throw the rest away (vocabulary pruning).

What is kept:
  - the special pieces (<s>, <pad>, </s>, <unk>, <mask>)
  - every piece written only with the letters cleaned Persian text can
    hold. tools/normalize.py turns Arabic letter forms into Persian ones
    and removes vowel marks before the model reads anything, so a piece
    with an Arabic "ي" or "ك", an Urdu or Pashto letter or a vowel mark can
    never be asked for. Those rows are dead weight (about 6,000 of them).
  - digits and everyday punctuation
  - Latin pieces of one or two letters (a stray English word is then split
    into small pieces and does not become <unk>)
  - every piece that really appears in the poems and their summaries
  - the pieces of the words "query:" and "passage:" that e5 models need

The model's answers for Persian text stay exactly the same, because the
kept rows are copied unchanged. The script checks this at the end.

Usage:
    python tools/prune_model.py
"""
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

import numpy as np
import onnx
from onnx import numpy_helper
from tokenizers import Tokenizer

from corpus import RAW, ROOT, load_couplets, verse_text
from embedder import Embedder
from eval import QUERIES
from normalize import normalize

SRC = ROOT / "models" / "src"
OUT = ROOT / "models" / "e5-small-fa"
TABLE = "embeddings.word_embeddings.weight_quantized"

# The letters that are left after normalize(): no ي ك ة ى ئ أ إ ؤ ۀ, no marks.
PERSIAN = re.compile("^▁?[ءآابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهی\u200c]+$")
NO_LETTERS = re.compile("^▁?[0-9۰-۹٠-٩ -/:-@\\[-`{-~،؛؟«»…–—٪٫٬]*$")
SHORT_LATIN = re.compile(r"^▁?[A-Za-z]{1,2}$")

# Everyday sentences that are in no poem. The pruned tokenizer must split
# them exactly like the full one (checked at the end).
MODERN = [
    "امروز توی مترو خیلی خسته بودم و دلم می‌خواست فقط بخوابم",
    "کنکور دارم و استرس دارم که قبول نشوم",
    "با بهترین دوستم دعوا کردم و نمی‌دانم چطور آشتی کنم",
    "پدرم بیمارستان بستری شده و خیلی نگرانش هستم",
    "می‌خواهم مهاجرت کنم ولی دلم برای خانواده‌ام تنگ می‌شود",
    "حقوقم کم است و اجاره‌خانه هر ماه گران‌تر می‌شود",
    "عاشق همکلاسی‌ام شده‌ام اما خجالت می‌کشم به او بگویم",
    "تولد مادرم است و می‌خواهم یک پیام قشنگ برایش بفرستم",
    "از شبکه‌های اجتماعی و گوشی موبایل خسته شده‌ام",
    "تیم فوتبال ما باخت و حالم گرفته است",
    "کسب‌وکارم ورشکست شد و باید از صفر شروع کنم",
    "دکتر گفت باید ورزش کنم و سیگار را کنار بگذارم",
    "احساس می‌کنم هیچ‌کس حرف من را نمی‌فهمد",
    "بعد از سال‌ها دوست قدیمی‌ام را دیدم و خیلی خوشحال شدم",
    "از دروغ و ریاکاری آدم‌ها دلم گرفته",
    "فردا مصاحبهٔ کاری دارم و امیدوارم موفق شوم",
    "زندگی خیلی سریع می‌گذرد و من هنوز به آرزوهایم نرسیده‌ام",
    "بچه‌ام تازه به دنیا آمده و از خوشحالی گریه می‌کنم",
    "دلم یک سفر به شمال و صدای دریا می‌خواهد",
    "خدایا شکرت که امروز هم سالم هستم",
]


def corpus_texts() -> list[str]:
    """Every text the model will read while building the search data."""
    texts: list[str] = []
    for index_file in sorted(RAW.glob("*.json")):
        for c in load_couplets(index_file.stem):
            texts.append("passage: " + verse_text(c))
            if c["summary"]:
                texts.append("passage: " + normalize(c["summary"]))
    texts += ["query: " + normalize(q) for q in QUERIES]
    return texts


def modern_texts() -> list[str]:
    return ["query: " + normalize(q) for q in MODERN]


def choose_ids(vocab: list[list], tokenizer: Tokenizer, texts: list[str]) -> list[int]:
    keep = {0, 1, 2, 3}
    for i, (piece, _score) in enumerate(vocab):
        if PERSIAN.match(piece) or NO_LETTERS.match(piece) or SHORT_LATIN.match(piece):
            keep.add(i)
    for start in range(0, len(texts), 2000):
        for enc in tokenizer.encode_batch(texts[start : start + 2000]):
            keep.update(enc.ids)
    return sorted(keep)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "onnx").mkdir(exist_ok=True)

    tok_json = json.loads((SRC / "tokenizer.json").read_text(encoding="utf-8"))
    vocab = tok_json["model"]["vocab"]
    old_tokenizer = Tokenizer.from_file(str(SRC / "tokenizer.json"))
    texts = corpus_texts()

    mask_old_id = next(a["id"] for a in tok_json["added_tokens"] if a["content"] == "<mask>")
    keep = [i for i in choose_ids(vocab, old_tokenizer, texts) if i < len(vocab)]
    new_id = {old: new for new, old in enumerate(keep)}
    print(f"word pieces: {len(vocab)} -> {len(keep)}")

    # 1. tokenizer: same pieces and scores, new row numbers
    tok_json["model"]["vocab"] = [vocab[i] for i in keep]
    for added in tok_json["added_tokens"]:
        if added["id"] == mask_old_id:
            added["id"] = len(keep)  # <mask> sits right after the vocab
        else:
            added["id"] = new_id[added["id"]]
    (OUT / "tokenizer.json").write_text(
        json.dumps(tok_json, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )

    # 2. model: keep only the chosen rows of the word table
    model = onnx.load(str(SRC / "onnx" / "model_quantized.onnx"))
    for init in model.graph.initializer:
        if init.name == TABLE:
            table = numpy_helper.to_array(init)
            rows = keep + [mask_old_id]  # table has a row for <mask> too
            small = np.ascontiguousarray(table[rows])
            init.CopyFrom(numpy_helper.from_array(small, TABLE))
            print(f"word table: {table.shape} -> {small.shape}")
            break
    else:
        raise SystemExit("word table not found in the model")
    onnx.save(model, str(OUT / "onnx" / "model_quantized.onnx"))

    # 3. small config files
    config = json.loads((SRC / "config.json").read_text(encoding="utf-8"))
    config["vocab_size"] = len(keep) + 1
    (OUT / "config.json").write_text(json.dumps(config, indent=2), encoding="utf-8")
    for name in ("tokenizer_config.json", "special_tokens_map.json"):
        shutil.copy(SRC / name, OUT / name)

    # 4. proof: same pieces and same vectors as the full model
    new_tokenizer = Tokenizer.from_file(str(OUT / "tokenizer.json"))
    step = max(1, len(texts) // 3000)
    sample = texts[::step] + texts[-len(QUERIES) :]
    different = 0
    for a, b in zip(old_tokenizer.encode_batch(sample), new_tokenizer.encode_batch(sample)):
        if a.tokens != b.tokens or [new_id[i] for i in a.ids] != b.ids:
            different += 1
    print(f"texts split differently: {different} of {len(sample)}")

    # sentences that were NOT used to choose the pieces
    unseen = modern_texts()
    missing = 0
    for a, b in zip(old_tokenizer.encode_batch(unseen), new_tokenizer.encode_batch(unseen)):
        if a.tokens != b.tokens:
            missing += 1
            print("   split differently:", a.tokens, "->", b.tokens)
    print(f"unseen modern sentences split differently: {missing} of {len(unseen)}")

    full = Embedder(SRC / "onnx" / "model_quantized.onnx", SRC / "tokenizer.json")
    small_model = Embedder(OUT / "onnx" / "model_quantized.onnx", OUT / "tokenizer.json")
    check = sample[-300:]
    gap = float(np.abs(full.embed(check) - small_model.embed(check)).max())
    print(f"biggest difference between vectors: {gap:.2e}")

    for file in sorted(OUT.rglob("*")):
        if file.is_file():
            print(f"  {file.relative_to(ROOT)}  {file.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
