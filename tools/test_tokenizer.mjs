// Check that the JavaScript text cleaner and tokenizer give exactly the
// same result as the Python ones that built the poem vectors.
//
// Usage:
//   python tools/make_tokenizer_cases.py cases.json
//   node tools/test_tokenizer.mjs cases.json
import { readFileSync } from 'node:fs';
import { normalize } from '../js/normalize.js';
import { UnigramTokenizer } from '../js/tokenizer.js';

const root = new URL('..', import.meta.url);
const tokenizer = new UnigramTokenizer(
  JSON.parse(readFileSync(new URL('models/e5-small-fa/tokenizer.json', root), 'utf8')),
);
const cases = JSON.parse(readFileSync(process.argv[2], 'utf8'));

let badClean = 0;
let badIds = 0;
for (const c of cases) {
  const clean = normalize(c.raw);
  if (clean !== c.clean) {
    if (badClean++ < 5) console.log('CLEAN differs:', JSON.stringify(c.raw), '\n  js:', JSON.stringify(clean), '\n  py:', JSON.stringify(c.clean));
    continue;
  }
  const ids = tokenizer.encode('query: ' + clean);
  if (ids.length !== c.ids.length || ids.some((id, i) => id !== c.ids[i])) {
    if (badIds++ < 5) console.log('IDS differ:', JSON.stringify(clean), '\n  js:', ids.join(' '), '\n  py:', c.ids.join(' '));
  }
}
console.log(`${cases.length} cases, cleaner differs: ${badClean}, tokenizer differs: ${badIds}`);
process.exit(badClean + badIds ? 1 : 0);
