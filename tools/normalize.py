"""Clean Persian text so the same words always look the same to the model.

The same rules are repeated in js/normalize.js for the visitor's text.
If you change one file, change the other too.
"""
from __future__ import annotations

import re

# Arabic letter forms -> Persian letter forms
LETTERS = str.maketrans(
    {
        "ي": "ی",
        "ى": "ی",
        "ئ": "ی",
        "ك": "ک",
        "ة": "ه",
        "ۀ": "ه",
        "أ": "ا",
        "إ": "ا",
        "ٱ": "ا",
        "ؤ": "و",
        "\u00a0": " ",  # no-break space
        "\u200f": "",  # right-to-left mark
        "\u200e": "",  # left-to-right mark
        "\u0640": "",  # tatweel (the stretching line)
    }
)

# Short vowel marks, tanween, shadda, sukun, superscript alef, hamza marks
MARKS = re.compile("[\u064b-\u065f\u0670]")
SPACES = re.compile(r"\s+")
# A half-space next to a normal space does nothing; remove it
LOOSE_ZWNJ = re.compile("\u200c*\\s+\u200c*|^\u200c+|\u200c+$")


def normalize(text: str) -> str:
    """Return the text without vowel marks and with Persian letter forms."""
    text = text.translate(LETTERS)
    text = MARKS.sub("", text)
    text = LOOSE_ZWNJ.sub(" ", text)
    text = SPACES.sub(" ", text)
    return text.strip()


if __name__ == "__main__":
    sample = "ا\u064eلا یا ا\u064eی\u064f\u0651ه\u064eا الس\u0651اقی ا\u064eد\u0650ر\u0652 ک\u064eأس\u064eا\u064b و ناو\u0650ل\u0652ها"
    print(normalize(sample))
