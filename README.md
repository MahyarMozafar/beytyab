# بیت‌یاب (Beyt-yab)

Search Persian poetry by **meaning**, not by matching words.

You write a feeling or a situation in Persian. Beyt-yab finds verses by
Hafez, Saadi and Molavi that carry that meaning.

## How it works

1. **Before publishing (on a computer):** every verse is turned into a list
   of numbers that holds its meaning (an *embedding*). The numbers are saved
   as small files next to the site.
2. **In the visitor's browser:** the same small language model turns the
   visitor's sentence into numbers.
3. The page compares the numbers and shows the closest verses
   (*semantic search*).

Nothing the visitor writes leaves their device. There is no server and no
paid API: the model runs inside the browser.

## Folders

| Folder    | What is inside                                              |
|-----------|-------------------------------------------------------------|
| `tools/`  | Python scripts that download poems and build the data files |
| `data/`   | Poem and embedding files used by the site                   |
| `models/` | The language model files served to the browser              |

## Building the data

```bash
python3 -m venv tools/venv
tools/venv/bin/pip install -r tools/requirements.txt
tools/venv/bin/python tools/fetch_poems.py all
```

## Poem source

Poem texts come from [Ganjoor](https://ganjoor.net), the open library of
Persian poetry.

## Status

Work in progress.
