// Background thread: loads the language model and the poems, and answers
// searches. Running here keeps the page smooth while the model works.
//
// Messages in:   {type:'init'}
//                {type:'search', id, text, top}
//                {type:'poem', id, collection, poem}
//                {type:'randomPoem', id, collection}
//                {type:'verse', id, collection, row}  one couplet (a shared link)
//                {type:'daily', id, day}              the verse of the day
//                {type:'model'}                       the big download may start
//                                                     (after init with waitForOpen)
// Messages out:  {type:'network', ok}                 the connection is failing / is back
//                {type:'poems', loaded, total}        a poet's text is here:
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
const DATA_DIR = new URL('data/site/', ROOT);
const ORT_DIR = new URL('js/vendor/ort/', ROOT);

let manifest = null;
let tokenizer = null;
let session = null;
let modelReady = false; // true after the warm-up run
const collections = []; // {info, vectors:Int8Array|null, poems, couplets, firstRow:Map}

// ---- downloading: in parts, kept, and never giving up --------------------
//
// Many visitors are on a weak connection that drops. So:
//  - big files come in 1 MB parts (tools/split_files.py);
//  - every finished file or part is kept in the browser's cache at once,
//    so a reload or the next visit goes on from where it stopped;
//  - a part that fails or stalls is asked for again, with a longer wait
//    each time, for as long as the page is open.

let loadedBytes = 0;
let totalBytes = 0;
let shelf = null; // the Cache that keeps finished files; null if the browser has none
const STALL = 30000; // a download that is silent this long is started again

async function openShelf() {
  try {
    const name = 'beytyab-files-' + manifest.files;
    for (const key of await caches.keys()) {
      if (key.startsWith('beytyab-files-') && key !== name) await caches.delete(key); // older files
    }
    shelf = await caches.open(name);
    // ask the browser not to throw these files away when space gets tight
    navigator.storage?.persist?.().catch(() => {});
  } catch {
    shelf = null;
  }
}

// One request, read piece by piece so the loading bar can move.
async function fetchBytes(url, onPiece) {
  const control = new AbortController();
  let timer = setTimeout(() => control.abort(), STALL);
  try {
    const response = await fetch(url, { signal: control.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!response.body) {
      const whole = new Uint8Array(await response.arrayBuffer());
      onPiece(whole.byteLength);
      return whole;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      clearTimeout(timer);
      timer = setTimeout(() => control.abort(), STALL);
      chunks.push(value);
      size += value.byteLength;
      onPiece(value.byteLength);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    clearTimeout(timer);
  }
}

// One file or one part: from the shelf if it is there, else from the
// network, again and again until it arrives.
async function fetchKept(path, counted) {
  const url = new URL(path, ROOT);
  url.searchParams.set('v', manifest.files); // also tells sw.js to stay out of it
  const saved = shelf && (await shelf.match(url).catch(() => null));
  if (saved) {
    const bytes = new Uint8Array(await saved.arrayBuffer());
    if (counted) {
      loadedBytes += bytes.byteLength;
      reportProgress();
    }
    return bytes;
  }
  for (let attempt = 0; ; attempt++) {
    let got = 0;
    try {
      const bytes = await fetchBytes(url, (n) => {
        got += n;
        if (counted) {
          loadedBytes += n;
          reportProgress();
        }
      });
      if (attempt > 0) postMessage({ type: 'network', ok: true });
      shelf?.put(url, new Response(bytes)).catch(() => {});
      return bytes;
    } catch {
      if (counted) loadedBytes -= got; // the lost piece comes again
      if (attempt === 1) postMessage({ type: 'network', ok: false });
      await new Promise((resolve) => setTimeout(resolve, Math.min(20000, 1500 * 2 ** attempt)));
    }
  }
}

// A whole file by its path on the site, put together from its parts.
async function download(path, kind, counted = true) {
  const count = manifest.parts?.[path];
  let bytes;
  if (!count) {
    bytes = await fetchKept(path, counted);
  } else {
    const parts = new Array(count);
    let next = 0;
    const lane = async () => {
      while (next < count) {
        const i = next++;
        parts[i] = await fetchKept(`${path}.p${String(i).padStart(3, '0')}`, counted);
      }
    };
    await Promise.all([lane(), lane(), lane()]); // three parts at a time
    bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
  }
  return kind === 'json' ? JSON.parse(new TextDecoder().decode(bytes)) : bytes;
}

let lastReport = 0;
function reportProgress(force) {
  const now = Date.now();
  if (!force && now - lastReport < 80) return;
  lastReport = now;
  postMessage({ type: 'progress', loaded: Math.max(0, Math.min(loadedBytes, totalBytes)), total: totalBytes });
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
  const text = await download(`data/site/${info.name}.json`, 'json', counted);
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
  const bytes = await download(`data/site/${info.name}.bin`, 'bytes', counted);
  const collection = collections.find((c) => c.info === info);
  collection.vectors = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

// Resolved when the page says the big download may start.
let startModel;
const mayLoadModel = new Promise((resolve) => { startModel = resolve; });

// Resolved when the list of poets is known.
let manifestIsHere;
const ready = new Promise((resolve) => { manifestIsHere = resolve; });

async function init() {
  // The list of files: small, always asked fresh, and asked again if the
  // connection fails (sw.js answers from its copy when there is no network).
  for (let attempt = 0; !manifest; attempt++) {
    try {
      const response = await fetch(new URL('manifest.json', DATA_DIR), { cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      manifest = await response.json();
    } catch {
      if (attempt === 1) postMessage({ type: 'network', ok: false });
      await new Promise((resolve) => setTimeout(resolve, Math.min(20000, 1500 * 2 ** attempt)));
    }
  }
  await openShelf();
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

  // 3. The engine, the model and Hafez's vectors. On a phone the page asks
  //    for them only when the cover has opened, so that the opening is not
  //    slowed down by a big download and the start of the model.
  await mayLoadModel;
  const tokenizerJson = await download('models/e5-small-fa/tokenizer.json', 'json');
  await loadVectors(first, true);
  const wasm = await download('js/vendor/ort/ort-wasm-simd-threaded.wasm', 'bytes');
  const model = await download('models/e5-small-fa/onnx/model_quantized.onnx', 'bytes');

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
      if (!message.waitForOpen) startModel();
      await init();
    } else if (message.type === 'model') {
      startModel();
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
