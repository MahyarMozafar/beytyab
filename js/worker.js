// Background thread: loads the language model and the poems, and answers
// searches. Running here keeps the page smooth while the model works.
//
// Messages in:   {type:'init'}
//                {type:'search', id, text, top}
//                {type:'poem', id, collection, poem}
//                {type:'randomPoem', id, collection}
// Messages out:  {type:'progress', loaded, total}
//                {type:'ready'}                       first poet can be searched
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
const collections = []; // {info, vectors:Int8Array, poems, couplets, firstRow:Map}

// ---- downloading with progress -------------------------------------------

let loadedBytes = 0;
let totalBytes = 0;

async function download(url, kind) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed: ${url}`);
  if (!response.body) {
    const whole = await response.arrayBuffer();
    loadedBytes += whole.byteLength;
    reportProgress();
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
    loadedBytes += value.byteLength;
    reportProgress();
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

async function loadCollection(info) {
  const [vectors, text] = await Promise.all([
    download(new URL(`${info.name}.bin`, DATA_DIR), 'bytes'),
    download(new URL(`${info.name}.json`, DATA_DIR), 'json'),
  ]);
  const firstRow = new Map(); // poem number -> its first couplet row
  text.couplets.forEach((couplet, row) => {
    if (!firstRow.has(couplet[0])) firstRow.set(couplet[0], row);
  });
  collections.push({
    info,
    vectors: new Int8Array(vectors.buffer, vectors.byteOffset, vectors.byteLength),
    poems: text.poems,
    couplets: text.couplets,
    firstRow,
  });
}

async function init() {
  manifest = await (await fetch(new URL('manifest.json', DATA_DIR))).json();
  const first = manifest.collections[0];
  // The bar on the cover covers everything needed for the first search.
  totalBytes = manifest.engineBytes + manifest.modelBytes + manifest.tokenizerBytes + first.bytes;

  const [wasm, model, tokenizerJson] = await Promise.all([
    download(new URL('ort-wasm-simd-threaded.wasm', ORT_DIR), 'bytes'),
    download(new URL('onnx/model_quantized.onnx', MODEL_DIR), 'bytes'),
    download(new URL('tokenizer.json', MODEL_DIR), 'json'),
    loadCollection(first),
  ]);

  tokenizer = new UnigramTokenizer(tokenizerJson);
  ort.env.wasm.numThreads = 1; // more threads need special server headers
  ort.env.wasm.wasmPaths = ORT_DIR.href;
  ort.env.wasm.wasmBinary = wasm;
  session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
  await embed('query: سلام'); // warm up, so the first real search is fast

  loadedBytes = totalBytes;
  reportProgress(true);
  postMessage({ type: 'ready', collections: manifest.collections.length });
  postMessage({ type: 'collection', name: first.name, loaded: 1, total: manifest.collections.length });

  // The other poets arrive quietly while the visitor already reads.
  for (let i = 1; i < manifest.collections.length; i++) {
    await loadCollection(manifest.collections[i]);
    postMessage({
      type: 'collection',
      name: manifest.collections[i].name,
      loaded: i + 1,
      total: manifest.collections.length,
    });
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

async function search(text, top) {
  const query = await embed('query: ' + normalize(text));
  const dim = manifest.dim;
  const toScore = manifest.scale / 127;
  const keep = top * 8; // extra candidates, thinned out below
  const best = []; // sorted, highest score first

  for (const collection of collections) {
    const vectors = collection.vectors;
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

  // At most one couplet from the same poem, so the pages feel varied.
  const seen = new Set();
  const results = [];
  for (const hit of best) {
    const couplet = hit.collection.couplets[hit.row];
    const key = hit.collection.info.name + ':' + couplet[0];
    // Some couplets appear in two poems; show each text only once.
    if (seen.has(key) || seen.has(couplet[1]) || couplet[1].length < 8) continue;
    seen.add(key);
    seen.add(couplet[1]);
    results.push(describe(hit.collection, hit.row, hit.sum * toScore));
    if (results.length === top) break;
  }
  return results;
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

// ---- messages ------------------------------------------------------------

self.onmessage = async (event) => {
  const message = event.data;
  try {
    if (message.type === 'init') {
      await init();
    } else if (message.type === 'search') {
      const started = performance.now();
      const results = await search(message.text, message.top || 7);
      postMessage({ type: 'results', id: message.id, results, ms: performance.now() - started });
    } else if (message.type === 'poem' || message.type === 'randomPoem') {
      postMessage({ type: 'poem', id: message.id, poem: readPoem(message.collection, message.poem) });
    } else if (message.type === 'embed') {
      // Used by the tests to compare the browser's numbers with Python's.
      const vector = await embed('query: ' + normalize(message.text));
      postMessage({ type: 'vector', id: message.id, vector: Array.from(vector) });
    }
  } catch (error) {
    postMessage({ type: 'error', id: message.id, message: String(error && error.message || error) });
  }
};
