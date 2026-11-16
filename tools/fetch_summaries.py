"""Download Ganjoor's plain-Persian summary of every Hafez ghazal.

Ganjoor keeps, next to each poem, a short summary of what the whole poem
says (machine-written, like the couplet summaries). The Fal page shows it,
so that a reader who does not follow the old language still gets the
message of the ghazal.

One small file per poem is saved in data/raw/summaries/<id>.txt, so the
script can be stopped and started again.

Run:  python tools/fetch_summaries.py
"""
from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor

from fetch_poems import API, RAW, get_json

OUT = RAW / "summaries"
QUERY = (
    "?verseDetails=false&catInfo=false&catPoems=false&rhymes=false&recitations=false"
    "&images=false&songs=false&comments=false&navigation=false&relatedpoems=false"
)


def fetch(entry: dict) -> bool:
    target = OUT / f"{entry['id']}.txt"
    if target.exists():
        return False
    poem = get_json(f"{API}/poem/{entry['id']}{QUERY}")
    target.write_text((poem.get("poemSummary") or "").strip(), encoding="utf-8")
    return True


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    entries = json.loads((RAW / "hafez.json").read_text(encoding="utf-8"))["poems"]
    done = 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        for _ in pool.map(fetch, entries):
            done += 1
            if done % 100 == 0:
                print(f"  {done}/{len(entries)}", flush=True)
    empty = sum(1 for e in entries if not (OUT / f"{e['id']}.txt").read_text(encoding="utf-8"))
    print(f"finished: {len(entries)} poems, {empty} without a summary")


if __name__ == "__main__":
    main()
