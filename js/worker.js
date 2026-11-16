// Background thread: loads the language model and the poems, and answers
// searches. Running here keeps the page smooth while the model works.
//
// Messages in:   {type:'init'}
//                {type:'search', id, text, top}
//                {type:'poem', id, collection, poem}
//                {type:'randomPoem', id, collection}
//                {type:'verse', id, collection, row}  one couplet (a shared link)
//                {type:'daily', id, day}              the verse of the day
// Messages out:  {type:'poems', loaded, total}        a poet's text is here:
//                                                     reading, fal and word
//                                                     search work for it
//                {type:'progress', loaded, total}
//                {type:'ready'}                       search by meaning works
//                {type:'collection', name, loaded, total}
//                {type:'results', id, results}
//                {type:'poem', id, poem}
//                {type:'error', message}

import * as ort from './vendor/ort/ort.wasm.min.mjs';
import { normalize } from './normalize.js';
import { UnigramTokenizer } from './tokenizer.js';

const ROOT = new URL('..', import.meta.url);
const MODEL_DIR = new URL('models/e5-small-fa/', ROOT);
const DATA_DIR = new URL('data/site/', ROOT);
const ORT_DIR = new URL('js/vendor/ort/', ROOT);

let manifest = null;
let tokenizer = null;
let session = null;
let modelReady = false; // true after the warm-up run
const collections = []; // {info, vectors:Int8Array|null, poems, couplets, firstRow:Map}

// ---- downloading with progress -------------------------------------------

let loadedBytes = 0;
let totalBytes = 0;

// `counted` downloads move the loading bar; the others arrive quietly.
async function download(url, kind, counted = true) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed: ${url}`);
  if (!response.body) {
    const whole = await response.arrayBuffer();
    if (counted) {
      loadedBytes += whole.byteLength;
      reportProgress();
    }
    return finish(new Uint8Array(whole), kind);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (counted) {
      loadedBytes += value.byteLength;
      reportProgress();
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return finish(bytes, kind);
}

function finish(bytes, kind) {
  if (kind === 'json') return JSON.parse(new TextDecoder().decode(bytes));
  return bytes;
}

let lastReport = 0;
function reportProgress(force) {
  const now = Date.now();
  if (!force && now - lastReport < 80) return;
  lastReport = now;
  postMessage({ type: 'progress', loaded: Math.min(loadedBytes, totalBytes), total: totalBytes });
}

// ---- loading -------------------------------------------------------------

// Somebody may ask for a poet whose text is still on the way (a shared
// link opens before everything is loaded): the answer waits for it.
const textWaiters = [];
function whenTextIsHere(name) {
  const here = collections.find((c) => c.info.name === name);
  if (here) return Promise.resolve(here);
  if (manifest && !manifest.collections.some((c) => c.name === name)) return Promise.resolve(null);
  return new Promise((resolve) => textWaiters.push({ name, resolve }));
}

// A poet arrives in two parts. The text (small) comes first: with it the
// visitor can already read, take a fal and search by words. The vectors
// (big) are only needed for the search by meaning.
async function loadText(info, counted) {
  const text = await download(new URL(`${info.name}.json`, DATA_DIR), 'json', counted);
  const firstRow = new Map(); // poem number -> its first couplet row
  text.couplets.forEach((couplet, row) => {
    if (!firstRow.has(couplet[0])) firstRow.set(couplet[0], row);
  });
  const collection = { info, vectors: null, poems: text.poems, couplets: text.couplets, firstRow, plain: null };
  collections.push(collection);
  textWaiters.filter((w) => w.name === info.name).forEach((w) => w.resolve(collection));
  postMessage({ type: 'poems', name: info.name, loaded: collections.length, total: manifest.collections.length });
}

async function loadVectors(info, counted) {
  const bytes = await download(new URL(`${info.name}.bin`, DATA_DIR), 'bytes', counted);
  const collection = collections.find((c) => c.info === info);
  collection.vectors = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

// Resolved when the list of poets is known.
let manifestIsHere;
const ready = new Promise((resolve) => { manifestIsHere = resolve; });

async function init() {
  manifest = await (await fetch(new URL('manifest.json', DATA_DIR))).json();
  manifestIsHere();
  const [first, ...rest] = manifest.collections;
  // The bar on the cover covers everything needed for the first search by meaning.
  totalBytes = manifest.engineBytes + manifest.modelBytes + manifest.tokenizerBytes + first.bytes;

  // 1. Hafez's text: about half a megabyte on the wire, and the book is usable.
  await loadText(first, true);

  // 2. The other poets' text, one after another, beside the big download.
  const otherTexts = (async () => {
    for (const info of rest) await loadText(info, false);
  })();

  // 3. The engine, the model and Hafez's vectors.
  const [wasm, model, tokenizerJson] = await Promise.all([
    download(new URL('ort-wasm-simd-threaded.wasm', ORT_DIR), 'bytes'),
    download(new URL('onnx/model_quantized.onnx', MODEL_DIR), 'bytes'),
    download(new URL('tokenizer.json', MODEL_DIR), 'json'),
    loadVectors(first, true),
  ]);

  tokenizer = new UnigramTokenizer(tokenizerJson);
  ort.env.wasm.numThreads = 1; // more threads need special server headers
  ort.env.wasm.wasmPaths = ORT_DIR.href;
  ort.env.wasm.wasmBinary = wasm;
  const created = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
  session = created;
  await embed('query: سلام'); // warm up, so the first real search is fast

  loadedBytes = totalBytes;
  reportProgress(true);
  modelReady = true;
  postMessage({ type: 'ready', collections: manifest.collections.length });
  postMessage({ type: 'collection', name: first.name, loaded: 1, total: manifest.collections.length });

  // 4. The other poets' vectors arrive quietly while the visitor already reads.
  await otherTexts;
  for (let i = 0; i < rest.length; i++) {
    await loadVectors(rest[i], false);
    postMessage({ type: 'collection', name: rest[i].name, loaded: i + 2, total: manifest.collections.length });
  }
}

// ---- the model -----------------------------------------------------------

// Text -> one vector of 384 numbers with length 1.
async function embed(text) {
  const ids = tokenizer.encode(text);
  const n = ids.length;
  const shape = [1, n];
  const feeds = {
    input_ids: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), shape),
    attention_mask: new ort.Tensor('int64', new BigInt64Array(n).fill(1n), shape),
  };
  if (session.inputNames.includes('token_type_ids')) {
    feeds.token_type_ids = new ort.Tensor('int64', new BigInt64Array(n), shape);
  }
  const output = await session.run(feeds);
  const hidden = output[session.outputNames[0]].data; // n rows of `dim` numbers
  const dim = hidden.length / n;
  const vector = new Float32Array(dim);
  for (let t = 0; t < n; t++) {
    for (let d = 0; d < dim; d++) vector[d] += hidden[t * dim + d];
  }
  let length = 0;
  for (let d = 0; d < dim; d++) length += vector[d] * vector[d];
  length = Math.sqrt(length) || 1;
  for (let d = 0; d < dim; d++) vector[d] /= length;
  return vector;
}

// ---- searching -----------------------------------------------------------

function describe(collection, row, score) {
  const [poem, m1, m2, meaning] = collection.couplets[row];
  return {
    collection: collection.info.name,
    poet: collection.info.poetName,
    book: collection.info.book,
    poem,
    title: collection.poems[poem][0],
    url: 'https://ganjoor.net' + collection.poems[poem][1],
    row,
    m1,
    m2,
    meaning,
    score,
  };
}

// Thin a ranked list of hits: at most one couplet from the same poem, so
// the pages feel varied, and each text only once (some couplets appear in
// two poems).
function pick(hits, top, toScore) {
  const seen = new Set();
  const results = [];
  for (const hit of hits) {
    const couplet = hit.collection.couplets[hit.row];
    const key = hit.collection.info.name + ':' + couplet[0];
    if (seen.has(key) || seen.has(couplet[1]) || couplet[1].length < 8) continue;
    seen.add(key);
    seen.add(couplet[1]);
    results.push(describe(hit.collection, hit.row, hit.sum * toScore));
    if (results.length === top) break;
  }
  return results;
}

// Search by meaning: the model turns the text into a vector, and the
// couplets whose vectors point the same way win.
async function search(text, top) {
  const query = await embed('query: ' + normalize(text));
  const dim = manifest.dim;
  const keep = top * 8; // extra candidates, thinned out in pick()
  const best = []; // sorted, highest score first

  for (const collection of collections) {
    const vectors = collection.vectors;
    if (!vectors) continue; // this poet's vectors are still on the way
    const rows = collection.couplets.length;
    for (let row = 0, offset = 0; row < rows; row++) {
      let sum = 0;
      for (let d = 0; d < dim; d++) sum += query[d] * vectors[offset++];
      if (best.length === keep && sum <= best[keep - 1].sum) continue;
      let at = best.length;
      while (at > 0 && best[at - 1].sum < sum) at--;
      best.splice(at, 0, { sum, collection, row });
      if (best.length > keep) best.pop();
    }
  }
  return pick(best, top, manifest.scale / 127);
}

// Search by words: used while the model is still downloading. It looks
// for the visitor's own words in the couplets and in their plain-Persian
// meanings (the meanings use today's words, so they are found more often).
const SMALL_WORDS = new Set(('از به در که را با من تو او ما شما و یا این آن برای هم یک است هست هستم بود شد شده شود ' +
  'می تا بر هر چه اما ولی خیلی دیگر نه هیچ همه خود دارم دارد کرد کنم کند باید هنوز چون اگر پس روی پیش').split(' '));

function wordSearch(text, top) {
  const words = [...new Set(normalize(text).split(/[\s\u200c،؛؟!?.,«»"'()]+/))]
    .filter((word) => word.length >= 2 && !SMALL_WORDS.has(word));
  if (!words.length) return [];
  const hits = [];
  for (const collection of collections) {
    if (!collection.plain) {
      // cleaned once per poet: [verse, meaning]
      collection.plain = collection.couplets.map((c) => [normalize(c[1] + ' ' + c[2]), normalize(c[3] || '')]);
    }
    collection.plain.forEach(([verse, meaning], row) => {
      let sum = 0;
      for (const word of words) {
        if (verse.includes(word)) sum += 3;
        else if (meaning.includes(word)) sum += 2;
      }
      if (sum) hits.push({ sum: sum - verse.length / 1000, collection, row }); // shorter wins a tie
    });
  }
  hits.sort((a, b) => b.sum - a.sum);
  return pick(hits.slice(0, top * 8), top, 1 / (3 * words.length));
}

function readPoem(name, poem) {
  const collection = collections.find((c) => c.info.name === name);
  if (!collection) return null;
  if (poem == null) poem = Math.floor(Math.random() * collection.poems.length);
  const lines = [];
  for (let row = collection.firstRow.get(poem); row < collection.couplets.length; row++) {
    const couplet = collection.couplets[row];
    if (couplet[0] !== poem) break;
    lines.push({ row, m1: couplet[1], m2: couplet[2], meaning: couplet[3] });
  }
  return {
    collection: name,
    poet: collection.info.poetName,
    book: collection.info.book,
    poem,
    title: collection.poems[poem][0],
    url: 'https://ganjoor.net' + collection.poems[poem][1],
    lines,
  };
}

// One couplet by its place in a poet's file: what a shared link points at.
async function readVerse(name, row) {
  const collection = await whenTextIsHere(name);
  if (!collection || !Number.isInteger(row) || row < 0 || row >= collection.couplets.length) return null;
  return describe(collection, row, 1);
}

// The verse of the day: the same Hafez couplet for everybody on one day.
// Only couplets of a comfortable length are in the draw.
let dailyRows = null;
async function dailyVerse(day) {
  const collection = await whenTextIsHere(manifest.collections[0].name);
  if (!dailyRows) {
    dailyRows = [];
    collection.couplets.forEach((c, row) => {
      if (c[3] && c[1].length >= 16 && c[1].length <= 34 && c[2].length <= 34) dailyRows.push(row);
    });
  }
  // a fixed shuffle of the days, so neighbours in the book are not neighbours in time
  const turn = Math.imul(day, 2654435761) >>> 0;
  return describe(collection, dailyRows[turn % dailyRows.length], 1);
}

// ---- messages ------------------------------------------------------------

self.onmessage = async (event) => {
  const message = event.data;
  try {
    if (message.type === 'init') {
      await init();
    } else if (message.type === 'search') {
      const started = performance.now();
      const byMeaning = modelReady;
      const results = byMeaning
        ? await search(message.text, message.top || 12)
        : wordSearch(message.text, message.top || 12);
      postMessage({ type: 'results', id: message.id, results, byMeaning, ms: performance.now() - started });
    } else if (message.type === 'poem' || message.type === 'randomPoem') {
      postMessage({ type: 'poem', id: message.id, poem: readPoem(message.collection, message.poem) });
    } else if (message.type === 'verse') {
      await ready;
      postMessage({ type: 'verse', id: message.id, verse: await readVerse(message.collection, message.row) });
    } else if (message.type === 'daily') {
      await ready;
      postMessage({ type: 'verse', id: message.id, verse: await dailyVerse(message.day) });
    } else if (message.type === 'embed') {
      // Used by the tests to compare the browser's numbers with Python's.
      const vector = await embed('query: ' + normalize(message.text));
      postMessage({ type: 'vector', id: message.id, vector: Array.from(vector) });
    }
  } catch (error) {
    postMessage({ type: 'error', id: message.id, message: String(error && error.message || error) });
  }
};
