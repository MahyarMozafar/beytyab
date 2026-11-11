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
        " ": " ",  # no-break space
        "‏": "",  # right-to-left mark
        "‎": "",  # left-to-right mark
        "ـ": "",  # tatweel (the stretching line)
    }
)

# Short vowel marks, tanween, shadda, sukun, superscript alef, hamza marks
MARKS = re.compile("[ً-ٰٟ]")
SPACES = re.compile(r"\s+")
# A half-space next to a normal space does nothing; remove it
LOOSE_ZWNJ = re.compile("‌*\\s+‌*|^‌+|‌+$")


def normalize(text: str) -> str:
    """Return the text without vowel marks and with Persian letter forms."""
    text = text.translate(LETTERS)
    text = MARKS.sub("", text)
    text = LOOSE_ZWNJ.sub(" ", text)
    text = SPACES.sub(" ", text)
    return text.strip()


if __name__ == "__main__":
    sample = "اَلا یا اَیُّهَا السّاقی اَدِرْ کَأسَاً و ناوِلْها"
    print(normalize(sample))
