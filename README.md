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

## The design

The whole site is one old Persian verse book: a light leather cover with a
gold medallion, cream paper, a lapis-and-gold border, flower-and-bird
corners and verses in nastaliq. The book is drawn in 3D: it is tilted, it
has stacks of sheets on both sides and it opens in the middle. Each result
is one page, and pages turn like real paper.

On a phone the open book is wider than the screen, so the pages keep
their full size. The screen shows one page and a part of the other, and a
swipe or a tap slides the book sideways.

Extras: a share card (1080 × 1920 picture of the verse), Fal-e Hafez,
bookmarks kept on the device, an optional paper sound, and speaking
instead of typing where the browser supports it.

## Folders

| Folder    | What is inside                                               |
|-----------|--------------------------------------------------------------|
| `js/`     | The page (`app.js`), the search thread (`worker.js`), the tokenizer, the share card and the sound |
| `css/`    | All styles                                                   |
| `tools/`  | Python scripts that download poems and build the data files  |
| `data/`   | Poem and vector files loaded by the site (`data/site/`)      |
| `models/` | The language model served to the browser                     |
| `tests/`  | Pages and data that check the browser against Python         |

## Running it on your computer

```bash
python3 -m http.server 8765
```

Then open `http://localhost:8765`. Add `?sw=1` to the address to test the
offline cache.

## Building the data

```bash
python3 -m venv tools/venv
tools/venv/bin/pip install -r tools/requirements.txt
tools/venv/bin/python tools/fetch_poems.py all   # download poems
tools/venv/bin/python tools/prune_model.py       # make the small model
tools/venv/bin/python tools/embed.py all         # couplets -> vectors
tools/venv/bin/python tools/pack.py              # files for the site
```

## Tests

```bash
tools/venv/bin/python tools/make_tokenizer_cases.py /tmp/cases.json
node tools/test_tokenizer.mjs /tmp/cases.json    # JS tokenizer = Python
tools/venv/bin/python tools/make_engine_cases.py
# then open tests/engine.html in the browser
```

## Poem source

Poem texts and the plain-language meanings come from
[Ganjoor](https://ganjoor.net), the open library of Persian poetry. The
meanings are machine-written there and can be wrong.

## Status

Work in progress.
