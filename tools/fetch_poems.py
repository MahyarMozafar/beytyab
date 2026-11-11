"""Download poems from the Ganjoor open API and cache them as JSON.

Usage:
    python tools/fetch_poems.py hafez            # one collection
    python tools/fetch_poems.py all              # everything in COLLECTIONS

Every poem is saved once in data/raw/poems/<id>.json, so the script can be
stopped and started again without downloading the same poem twice.
A small index per collection is written to data/raw/<name>.json.
"""
from __future__ import annotations

import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

API = "https://api.ganjoor.net/api/ganjoor"
ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
POEMS = RAW / "poems"
HEADERS = {"User-Agent": "beytyab-poem-fetch/1.0"}
POEM_QUERY = (
    "?verseDetails=true&catInfo=false&rhymes=false&recitations=false"
    "&images=false&songs=false&comments=false&navigation=false"
)

# name -> (poet key, Ganjoor category id, book title shown to visitors)
COLLECTIONS = {
    "hafez": ("hafez", 24, "غزلیات حافظ"),
    "saadi-ghazal": ("saadi", 119, "دیوان سعدی"),
    "saadi-boostan": ("saadi", 123, "بوستان سعدی"),
    "moulavi-masnavi": ("moulavi", 103, "مثنوی معنوی"),
    "moulavi-shams": ("moulavi", 98, "دیوان شمس"),
}

session = requests.Session()
session.headers.update(HEADERS)


def get_json(url: str, tries: int = 5) -> dict:
    """GET a URL and return JSON, waiting longer after each failure."""
    for attempt in range(tries):
        try:
            res = session.get(url, timeout=40)
            if res.status_code == 200:
                return res.json()
            if res.status_code == 404:
                raise FileNotFoundError(url)
        except requests.RequestException:
            pass
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"could not download {url}")


def list_poems(cat_id: int, trail: tuple[str, ...] = ()) -> list[dict]:
    """Walk a category and all its sub-categories; return every poem in it."""
    cat = get_json(f"{API}/cat/{cat_id}?poems=true")["cat"]
    here = trail + (cat["title"],)
    found = [
        {"id": p["id"], "title": p["title"], "path": list(here)}
        for p in (cat.get("poems") or [])
    ]
    for child in cat.get("children") or []:
        found.extend(list_poems(child["id"], here))
    return found


def fetch_poem(entry: dict) -> bool:
    """Download one poem unless it is already cached. True if downloaded."""
    target = POEMS / f"{entry['id']}.json"
    if target.exists():
        return False
    poem = get_json(f"{API}/poem/{entry['id']}{POEM_QUERY}")
    slim = {
        "id": poem["id"],
        "title": poem["title"],
        "fullTitle": poem["fullTitle"],
        "url": poem["fullUrl"],
        "verses": [
            {
                "o": v["vOrder"],
                "c": v["coupletIndex"],
                "p": v["versePosition"],
                "t": v["text"],
                "s": v.get("coupletSummary"),
            }
            for v in poem["verses"]
        ],
    }
    target.write_text(json.dumps(slim, ensure_ascii=False), encoding="utf-8")
    return True


def fetch_collection(name: str) -> None:
    poet, cat_id, book = COLLECTIONS[name]
    index_file = RAW / f"{name}.json"
    if index_file.exists():
        entries = json.loads(index_file.read_text(encoding="utf-8"))["poems"]
    else:
        entries = list_poems(cat_id)
        index_file.write_text(
            json.dumps(
                {"name": name, "poet": poet, "book": book, "poems": entries},
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
    print(f"{name}: {len(entries)} poems", flush=True)
    done = 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        for fresh in pool.map(fetch_poem, entries):
            done += 1
            if done % 200 == 0:
                print(f"  {done}/{len(entries)}", flush=True)
    print(f"{name}: finished", flush=True)


def main() -> None:
    POEMS.mkdir(parents=True, exist_ok=True)
    wanted = sys.argv[1:] or ["all"]
    names = list(COLLECTIONS) if wanted == ["all"] else wanted
    for name in names:
        fetch_collection(name)


if __name__ == "__main__":
    main()
