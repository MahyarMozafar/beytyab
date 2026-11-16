"""Build the Fal-e Hafez reading for every ghazal: data/site/hafez-fal.json.

A reader who takes a fal wants two things besides the poem:
  1. what the ghazal says as a whole, in plain Persian;
  2. the mood of the fal: is it a bright one, or one that asks for patience
     or care?

(1) is Ganjoor's summary of the poem (tools/fetch_summaries.py).
(2) is read from the words of the summary. Each mood has a list of word
stems ("شاد", "فراق", "ریا" ...); the mood whose words appear most wins.
The language model only breaks ties: it compares the summary with a few
short descriptions of each mood. A fal is called "care" only when the
signs are strong, because a wrong warning is worse than a wrong blessing.
Each mood has a few ready sentences, written for the reader; the page
shows one of them.

Nobody checked the 495 readings by hand, and the page says so.

Run:  python tools/make_fal.py
"""
from __future__ import annotations

import json
import math
from collections import Counter

import numpy as np

from corpus import RAW, ROOT, clean_summary
from embedder import Embedder
from normalize import normalize

MODEL = ROOT / "models" / "e5-small-fa"
TARGET = ROOT / "data" / "site" / "hafez-fal.json"

# omen: 3 = bright, 2 = hopeful, 1 = patience, 0 = care
MOODS = [
    {
        "key": "joy",
        "words": ["شاد", "خوش", "لذت", "بهار", "جشن", "عیش", "طرب", "وصال", "کامیاب", "مژده", "سرور", "نشاط", "بخت", "سعادت", "شکر"],
        "omen": 3,
        "label": "فال روشن",
        "about": [
            "شادی و خوشی و جشن و بهار و می و مستی و لحظه‌های خوش زندگی",
            "رسیدن به یار و وصال معشوق و برآورده شدن آرزو و کامیابی",
            "مژده و خبر خوش و بخت بلند و روزگار خوب",
        ],
        "lines": [
            "فالت روشن است. خوشی و گشایشی که منتظرش بودی نزدیک است؛ قدر این روزها را بدان و شادی‌ات را با دیگران قسمت کن.",
            "نیت تو نیک است و بخت با تو یار. روزهای خوشی در راه است؛ با دل شاد قدم بردار.",
            "حافظ به تو مژده می‌دهد. آنچه در دل داری شدنی است؛ دم را غنیمت بدان و شکرگزار باش.",
        ],
    },
    {
        "key": "hope",
        "words": ["امید", "گشایش", "دعا", "لطف", "رحمت", "توکل", "عنایت", "بازگشت", "نوید", "دلدار", "فرج", "بشارت", "آرزو"],
        "omen": 2,
        "label": "فال امیدوار",
        "about": [
            "امید به آینده و پایان غم و گذشتن روزهای سخت و آمدن گشایش",
            "دلداری دادن و اینکه غم نمی‌ماند و یار بازمی‌گردد",
            "توکل به خدا و امید به لطف و رحمت او و دعا",
        ],
        "lines": [
            "فالت امیدبخش است. سختی این روزها ماندنی نیست و گشایش در راه است؛ امیدت را از دست نده.",
            "دل قوی دار. آنچه امروز گره خورده به‌زودی باز می‌شود؛ به خدا توکل کن و ناامید نشو.",
            "خبر خوبی در راه است، هرچند کمی دیرتر از آنچه می‌خواهی. امید را نگه دار.",
        ],
    },
    {
        "key": "love",
        "words": ["عشق", "عاشق", "معشوق", "محبوب", "زیبای", "دلبر", "زلف", "چهره", "دلداد", "شیفت", "جمال"],
        "omen": 2,
        "label": "فال دلدادگی",
        "about": [
            "عشق و دلدادگی و زیبایی معشوق و ستایش چهره و زلف یار",
            "اشتیاق عاشق و وفاداری در عشق و دل سپردن به محبوب",
            "عشق راه سختی دارد اما ارزشش را دارد",
        ],
        "lines": [
            "فالت از دلدادگی می‌گوید. دلت جایی گیر است؛ اگر راست و وفادار بمانی، این مهر به جای خوبی می‌رسد.",
            "در دل تو مهری هست که ارزش ماندن دارد. با صداقت پیش برو و عجله نکن.",
            "حافظ راه دل را نشانت می‌دهد. به حرف دلت گوش کن، اما وفا و حوصله را هم از یاد نبر.",
        ],
    },
    {
        "key": "patience",
        "words": ["فراق", "هجر", "دوری", "دلتنگ", "غم", "اندوه", "درد", "رنج", "صبر", "انتظار", "تنهای", "بی‌وفا", "جدای", "ناکام", "حسرت", "اشک", "گریه", "ناله"],
        "omen": 1,
        "label": "فال صبر",
        "about": [
            "دوری و هجران و فراق یار و دلتنگی و انتظار",
            "غم و اندوه و درد و رنج عاشق و بی‌وفایی معشوق",
            "صبر و تحمل در برابر سختی‌ها و ناکامی",
        ],
        "lines": [
            "فالت می‌گوید صبر کن. این روزها دلتنگی و انتظار هست، اما اگر شکیبا بمانی به خواسته‌ات می‌رسی.",
            "راهی که در آن هستی آسان نیست و زمان می‌خواهد. شتاب نکن؛ صبر، کار تو را درست می‌کند.",
            "دلت گرفته است و حق داری. حافظ می‌گوید این هم می‌گذرد؛ تحمل کن و دل از امید نبر.",
        ],
    },
    {
        "key": "care",
        "words": ["ریا", "دورو", "فریب", "زاهد", "ناپایدار", "فانی", "مرگ", "هشدار", "غرور", "غفلت", "نصیحت", "پند", "بی‌اعتبار", "گذرا", "حسود", "دشمن", "ملامت", "تزویر"],
        "omen": 0,
        "label": "فال احتیاط",
        "about": [
            "هشدار درباره ریا و دورویی و فریب مردم و زاهدان ریاکار",
            "ناپایداری دنیا و گذر عمر و مرگ و بی‌اعتباری مال و مقام",
            "پند و نصیحت و پرهیز از غرور و غفلت و اعتماد نکردن به روزگار",
        ],
        "lines": [
            "فالت می‌گوید با احتیاط قدم بردار. به هر حرف و هر کسی زود دل نبند و در این کار عجله نکن.",
            "حافظ هشدار می‌دهد: ظاهر کار فریبنده است. بیشتر فکر کن، با آدم دانا مشورت کن و بعد تصمیم بگیر.",
            "این نیت کمی دقت بیشتر می‌خواهد. غرور و شتاب را کنار بگذار تا پشیمان نشوی.",
        ],
    },
    {
        "key": "wisdom",
        "words": ["رند", "آزاد", "قناعت", "رضا", "میخانه", "پیر مغان", "حقیقت", "عرفان", "معرفت", "رها", "خرابات", "درویش", "تسلیم", "سلوک"],
        "omen": 2,
        "label": "فال رهایی",
        "about": [
            "رندی و آزادگی و رها بودن از قید و بند و قضاوت مردم",
            "قناعت و رضا به قسمت و دل نبستن به دنیا و آرامش درون",
            "راه عرفان و پیر مغان و میخانه و رسیدن به حقیقت",
        ],
        "lines": [
            "فالت می‌گوید رها باش. به حرف مردم کمتر فکر کن و به آنچه داری راضی باش؛ آرامش از همین‌جا می‌آید.",
            "گره کار تو با سخت گرفتن باز نمی‌شود. دل را سبک کن و کار را به خدا بسپار.",
            "حافظ تو را به سادگی و آزادگی می‌خواند. از قید چیزهای کوچک بگذر تا راهت باز شود.",
        ],
    },
]


def unit(matrix: np.ndarray) -> np.ndarray:
    return matrix / np.linalg.norm(matrix, axis=1, keepdims=True)


def main() -> None:
    embedder = Embedder(MODEL / "onnx" / "model_quantized.onnx", MODEL / "tokenizer.json")
    entries = json.loads((RAW / "hafez.json").read_text(encoding="utf-8"))["poems"]
    summaries = [
        clean_summary((RAW / "summaries" / f"{e['id']}.txt").read_text(encoding="utf-8")) or ""
        for e in entries
    ]

    poem_vectors = unit(embedder.embed(["query: " + normalize(s) for s in summaries]))
    mood_vectors = []
    for mood in MOODS:
        vectors = unit(embedder.embed(["query: " + normalize(t) for t in mood["about"]]))
        mood_vectors.append(vectors)

    # The model's opinion, used only to break ties. All texts from this
    # model sit close together, so each mood's average score is taken off
    # first; what is left says which mood stands out for this poem.
    near = np.stack([(poem_vectors @ v.T).max(axis=1) for v in mood_vectors], axis=1)
    near = near - near.mean(axis=0, keepdims=True)
    near = near / near.std()

    # The main vote: how many of a mood's words are in the summary. A word
    # in the first sentence (what the poem is about) counts double.
    # A word that is in almost every summary ("عشق") says little, so each
    # word weighs less the more summaries hold it.
    care = next(i for i, m in enumerate(MOODS) if m["key"] == "care")
    texts = [normalize(summary) for summary in summaries]
    weight = {}
    for mood in MOODS:
        for word in mood["words"]:
            word = normalize(word)
            holders = sum(1 for text in texts if word in text)
            weight[word] = math.log(len(texts) / (1 + holders))
    choice = []
    for row, text in enumerate(texts):
        opening = text.split(".")[0]
        votes = np.zeros(len(MOODS))
        for i, mood in enumerate(MOODS):
            for word in mood["words"]:
                word = normalize(word)
                votes[i] += weight[word] * (min(text.count(word), 3) + (1 if word in opening else 0))
        votes = votes / max(votes.sum(), 1) * 6 + 0.5 * near[row]
        # a warning needs a clear lead over every other mood
        if votes.argmax() == care:
            others = np.delete(votes, care)
            if votes[care] - others.max() < 0.8:
                votes[care] = -1
        choice.append(int(votes.argmax()))
    choice = np.array(choice)

    poems = [[int(choice[i]), " ".join(summaries[i].split())] for i in range(len(entries))]
    moods = [{k: m[k] for k in ("omen", "label", "lines")} for m in MOODS]
    TARGET.write_text(
        json.dumps({"moods": moods, "poems": poems}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    counts = Counter(MOODS[c]["key"] for c in choice)
    print(f"{len(poems)} readings -> {TARGET.relative_to(ROOT)} ({TARGET.stat().st_size / 1e3:.0f} kB)")
    print("moods:", dict(counts))
    for i in (0, 2, 21, 36, 142, 183, 243, 373, 469, 100, 200, 300, 400, 50, 77, 151, 222, 265, 333, 444, 480):
        print(f"  {i + 1}: {MOODS[choice[i]]['label']} | {' '.join(summaries[i].split())[:150]}")


if __name__ == "__main__":
    main()
