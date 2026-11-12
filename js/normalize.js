// Clean Persian text so the same words always look the same to the model.
// These are the same rules as tools/normalize.py. If you change one file,
// change the other too.

const LETTERS = {
  'ي': 'ی', 'ى': 'ی', 'ئ': 'ی',
  'ك': 'ک',
  'ة': 'ه', 'ۀ': 'ه',
  'أ': 'ا', 'إ': 'ا', 'ٱ': 'ا',
  'ؤ': 'و',
  '\u00a0': ' ',  // no-break space
  '\u200f': '',   // right-to-left mark
  '\u200e': '',   // left-to-right mark
  '\u0640': '',   // tatweel (the stretching line)
};
const LETTERS_RE = new RegExp('[' + Object.keys(LETTERS).join('') + ']', 'g');
// Short vowel marks, tanween, shadda, sukun, superscript alef, hamza marks
const MARKS_RE = /[\u064b-\u065f\u0670]/g;
// A half-space next to a normal space does nothing; remove it
const LOOSE_ZWNJ_RE = /\u200c*\s+\u200c*|^\u200c+|\u200c+$/g;
const SPACES_RE = /\s+/g;

export function normalize(text) {
  return text
    .replace(LETTERS_RE, (ch) => LETTERS[ch])
    .replace(MARKS_RE, '')
    .replace(LOOSE_ZWNJ_RE, ' ')
    .replace(SPACES_RE, ' ')
    .trim();
}
