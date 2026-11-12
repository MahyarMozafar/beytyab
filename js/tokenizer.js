// Split text into the word pieces the model knows, and return their numbers.
//
// The model uses a "Unigram" word-piece list (SentencePiece, XLM-RoBERTa).
// Every piece has a score. For each word we look for the way of cutting it
// into pieces that gives the highest total score (Viterbi search).
//
// tools/test_tokenizer.mjs checks that this file gives exactly the same
// numbers as the Python tokenizer that built the poem vectors.

const BOS = 0;      // <s>   start of text
const EOS = 2;      // </s>  end of text
const WORD_START = '▁'; // "▁" marks the beginning of a word
const MAX_TOKENS = 128;
// Invisible characters the original tokenizer turns into a space
const INVISIBLE_RE = /[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2060\ufeff]/g;

export class UnigramTokenizer {
  constructor(tokenizerJson) {
    const vocab = tokenizerJson.model.vocab;
    this.unkId = tokenizerJson.model.unk_id;
    this.pieces = new Map();
    this.maxPieceLength = 1;
    let minScore = 0;
    vocab.forEach(([piece, score], id) => {
      this.pieces.set(piece, [id, score]);
      const length = Array.from(piece).length;
      if (length > this.maxPieceLength) this.maxPieceLength = length;
      if (score < minScore) minScore = score;
    });
    // An unknown character is allowed, but it is always the worst choice.
    this.unkScore = minScore - 10;
  }

  // Text -> list of piece numbers, with <s> at the start and </s> at the end.
  encode(text) {
    const clean = text
      .normalize('NFKC')
      .replace(INVISIBLE_RE, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const ids = [BOS];
    for (const word of clean.split(' ')) {
      if (word) this.encodeWord(WORD_START + word, ids);
    }
    if (ids.length > MAX_TOKENS - 1) ids.length = MAX_TOKENS - 1;
    ids.push(EOS);
    return ids;
  }

  encodeWord(word, ids) {
    const chars = Array.from(word);
    const n = chars.length;
    // best[i] = best total score for the first i characters
    const best = new Float64Array(n + 1).fill(-Infinity);
    const backStart = new Int32Array(n + 1);
    const backId = new Int32Array(n + 1);
    best[0] = 0;
    for (let start = 0; start < n; start++) {
      if (best[start] === -Infinity) continue;
      let piece = '';
      const limit = Math.min(n, start + this.maxPieceLength);
      let foundSingle = false;
      for (let end = start + 1; end <= limit; end++) {
        piece += chars[end - 1];
        const hit = this.pieces.get(piece);
        if (!hit) continue;
        if (end === start + 1) foundSingle = true;
        const score = best[start] + hit[1];
        if (score > best[end]) {
          best[end] = score;
          backStart[end] = start;
          backId[end] = hit[0];
        }
      }
      if (!foundSingle) {
        const score = best[start] + this.unkScore;
        if (score > best[start + 1]) {
          best[start + 1] = score;
          backStart[start + 1] = start;
          backId[start + 1] = this.unkId;
        }
      }
    }
    // Walk back from the end to read the chosen pieces.
    const found = [];
    for (let end = n; end > 0; end = backStart[end]) found.push(backId[end]);
    for (let i = found.length - 1; i >= 0; i--) {
      const id = found[i];
      // Several unknown characters in a row count as one unknown piece.
      if (id === this.unkId && ids[ids.length - 1] === this.unkId) continue;
      ids.push(id);
    }
  }
}
