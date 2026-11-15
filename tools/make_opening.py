"""Pick a few Hafez ghazals for the pages that turn while the book opens.

The opening animation lifts a block of pages and a few loose pages. Those
pages should look like a real divan, not blank paper, and they are needed
before the big poem files are downloaded. So this script writes a small
JavaScript file (js/opening-poems.js) with the first couplets of some
well-known ghazals, taken from the packed site data.

Run:  python tools/make_opening.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "data" / "site" / "hafez.json"
TARGET = ROOT / "js" / "opening-poems.js"

# Ghazal numbers (as in Ganjoor) of poems most readers know.
WANTED = [1, 3, 22, 37, 77, 143, 152, 184, 244, 266, 374, 470]
COUPLETS = 5
LONGEST_LINE = 40  # letters; longer half-lines do not fit a phone page


def main():
    data = json.loads(SOURCE.read_text(encoding="utf-8"))
    by_poem = {}
    for poem, m1, m2, _meaning in data["couplets"]:
        by_poem.setdefault(poem, []).append([m1, m2])

    poems = []
    for number in WANTED:
        index = number - 1
        title, _url = data["poems"][index]
        lines = by_poem.get(index, [])[:COUPLETS]
        if len(lines) < COUPLETS:
            continue
        if any(len(half) > LONGEST_LINE for line in lines for half in line):
            continue
        poems.append({"poet": "حافظ", "title": title, "lines": lines})

    body = json.dumps(poems, ensure_ascii=False, indent=2)
    TARGET.write_text(
        "// Made by tools/make_opening.py. Do not edit by hand.\n"
        "// The first couplets of a few Hafez ghazals, shown on the pages that\n"
        "// turn while the book opens.\n"
        f"export const OPENING_POEMS = {body};\n",
        encoding="utf-8",
    )
    print(f"{len(poems)} poems -> {TARGET.relative_to(ROOT)} ({TARGET.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
