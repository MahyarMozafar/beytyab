// بیت‌یاب — the page itself: the cover, the pages and everything a visitor taps.
// The heavy work (the language model and the search) lives in js/worker.js.

import { pageSound, setSound, soundIsOn } from './sound.js';
import { shareVerse } from './share.js';

const gsap = window.gsap;
const $ = (selector, root = document) => root.querySelector(selector);

const book = $('#book');
const spread = $('#spread');
const cover = $('#cover');
const pageMain = $('#page-main');
const pageSide = $('#page-side');
const mainBody = $('#main-body');
const sideBody = $('#side-body');
const toast = $('#toast');

const wideQuery = matchMedia('(min-width: 900px) and (min-height: 560px)');
const calmQuery = matchMedia('(prefers-reduced-motion: reduce)');
const isWide = () => wideQuery.matches;
const isCalm = () => calmQuery.matches;

const EXAMPLES = [
  'دلم برای کسی تنگ شده',
  'امیدوارم روزهای سخت تمام شود',
  'از آدم‌های دورو خسته‌ام',
  'عمر زود می‌گذرد',
  'می‌خواهم به دیگران خوبی کنم',
  'امشب خیلی تنها هستم',
];

const state = {
  view: 'search',
  ready: false,
  percent: 0,
  poets: 0,
  poetsTotal: 4,
  query: '',
  results: [],
  index: 0,
  poem: null,
  poemIsFal: false,
  backTo: 'search',
  turning: false,
};

// ---------- small helpers ----------

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const fa = (number) => String(number).replace(/\d/g, (d) => FA_DIGITS[d]);
const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Masnavi sections have long story titles; the page header shows the short part.
const shortTitle = (title) => String(title ?? '').split(' - ')[0];
const icon = (name) => `<svg aria-hidden="true"><use href="#${name}"/></svg>`;

function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* private mode: the site still works, it just forgets */ }
  return null;
}

let toastTimer;
function say(message) {
  toast.textContent = message;
  toast.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-on'), 2600);
}

// ---------- the worker (language model + search) ----------

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const waiting = new Map();
let nextId = 1;

function ask(message) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    worker.postMessage({ ...message, id });
  });
}

worker.onmessage = ({ data }) => {
  if (data.type === 'progress') {
    state.percent = Math.floor((100 * data.loaded) / data.total);
    showProgress();
  } else if (data.type === 'ready') {
    state.ready = true;
    state.percent = 100;
    state.poetsTotal = data.collections;
    showProgress();
  } else if (data.type === 'collection') {
    state.poets = data.loaded;
    state.poetsTotal = data.total;
    showProgress();
  } else if (data.id && waiting.has(data.id)) {
    const { resolve, reject } = waiting.get(data.id);
    waiting.delete(data.id);
    if (data.type === 'error') reject(new Error(data.message));
    else resolve(data);
  } else if (data.type === 'error') {
    loadFailed();
  }
};
worker.onerror = loadFailed;

function loadFailed() {
  state.failed = true;
  showProgress();
}

function showProgress() {
  const trace = $('#trace');
  const line = $('#cover-load');
  if (trace) trace.style.setProperty('--p', String(state.percent));
  let text;
  if (state.failed) text = 'بارگیری کامل نشد. اینترنت را بررسی کن و صفحه را دوباره باز کن.';
  else if (!state.ready) text = `در حال آماده‌سازی… ${fa(state.percent)}٪ · بار اول حدود ۴۰ مگابایت`;
  else text = 'آماده است';
  if (line) line.textContent = text;

  const status = $('#status');
  const go = $('#go');
  const fal = $('#fal');
  if (go) go.disabled = !state.ready;
  if (fal) fal.disabled = !state.ready;
  if (status) {
    if (state.failed) status.textContent = text;
    else if (!state.ready) status.innerHTML = `هوش مصنوعی در حال آماده شدن است… <b>${fa(state.percent)}٪</b>`;
    else if (state.poets < state.poetsTotal) status.textContent = 'حافظ آماده است؛ سعدی و مولانا هم در راه‌اند…';
    else status.textContent = 'بیش از ۴۱ هزار بیت از حافظ، سعدی و مولانا آماده است.';
  }
}

// ---------- bookmarks ----------

let marks = store('beytyab.marks') || [];
const markKey = (v) => `${v.collection}:${v.row}`;
const isMarked = (v) => marks.some((m) => markKey(m) === markKey(v));

function toggleMark(verse) {
  if (isMarked(verse)) {
    marks = marks.filter((m) => markKey(m) !== markKey(verse));
    say('نشان برداشته شد');
  } else {
    const { collection, row, poet, book: bookName, poem, title, url, m1, m2, meaning } = verse;
    marks.unshift({ collection, row, poet, book: bookName, poem, title, url, m1, m2, meaning });
    say('این بیت نشان شد');
  }
  store('beytyab.marks', marks);
  showMarkCount();
}

function showMarkCount() {
  const tool = $('#tool-marks');
  tool.querySelector('.tool__count')?.remove();
  if (marks.length) tool.insertAdjacentHTML('beforeend', `<span class="tool__count">${fa(marks.length)}</span>`);
}

// ---------- what each view looks like ----------

function searchView() {
  const chips = EXAMPLES.map((text) => `<button class="chip" type="button" data-example="${esc(text)}">${esc(text)}</button>`).join('');
  mainBody.innerHTML = `
    <div class="sarlowh"><div class="sarlowh__plate"><h2 class="sarlowh__title">بیت‌یاب</h2></div></div>
    <form class="ask" id="ask" novalidate>
      <label class="ask__label" for="q">حالِ دلت را بنویس</label>
      <div class="ask__box">
        <textarea class="ask__input" id="q" rows="3" maxlength="300" enterkeyhint="search"
          placeholder="مثلاً: دلم برای کسی که دور است تنگ شده…">${esc(state.query)}</textarea>
        <button class="btn btn--icon ask__mic" id="mic" type="button" aria-label="گفتن با صدا" hidden>${icon('i-mic')}</button>
      </div>
      <div class="chips" aria-label="نمونه‌ها">${chips}</div>
      <div class="ask__actions">
        <button class="btn btn--main" id="go" type="submit">بیت‌ها را پیدا کن</button>
        <button class="btn" id="fal" type="button">${icon('i-book')}فال حافظ</button>
      </div>
      <p class="muted status" id="status" role="status"></p>
    </form>`;
  sideBody.innerHTML = `
    <h2 class="side-title">این کتاب چطور کار می‌کند؟</h2>
    <ol class="how">
      <li>حال یا موقعیتت را با زبان خودت بنویس. لازم نیست کلمه‌های شعر را بدانی.</li>
      <li>هوش مصنوعی معنای جمله‌ات را می‌فهمد و با معنای هزاران بیت مقایسه می‌کند.</li>
      <li>نزدیک‌ترین بیت‌ها، هر کدام در یک صفحه، جلوی تو باز می‌شوند.</li>
    </ol>
    <div class="rule"></div>
    <p class="muted" style="text-align:center">همه‌چیز روی دستگاه خودت انجام می‌شود.<br>نوشته‌ات به هیچ جایی فرستاده نمی‌شود.</p>`;
  if (speechAvailable()) $('#mic').hidden = false;
  showProgress();
}

function meaningBlock(verse, extraClass = '', hidden = false) {
  if (!verse.meaning) return '';
  return `<div class="meaning ${extraClass}" ${hidden ? 'hidden' : ''}>
    <span class="meaning__label">معنی ساده</span>${esc(verse.meaning)}</div>`;
}

function verseActions(verse) {
  const marked = isMarked(verse);
  return `<div class="acts">
    <button class="btn ${marked ? 'btn--on' : ''}" type="button" data-act="mark" aria-pressed="${marked}">${icon(marked ? 'i-mark-on' : 'i-mark')}${marked ? 'نشان شد' : 'نشان کن'}</button>
    <button class="btn" type="button" data-act="share">${icon('i-share')}کارت</button>
    <button class="btn" type="button" data-act="poem">${icon('i-book')}همهٔ شعر</button>
  </div>`;
}

function resultView() {
  const verse = state.results[state.index];
  const count = state.results.length;
  const long = verse.m1.length > 27 || verse.m2.length > 27;
  mainBody.innerHTML = `
    <header class="head">
      <span class="head__poet">${esc(verse.poet)}</span>
      <span class="head__src">${esc(verse.book)}، ${esc(shortTitle(verse.title))}</span>
    </header>
    <div class="verse ${long ? 'verse--long' : ''}" lang="fa">
      <p class="m1 ink">${esc(verse.m1)}</p>
      <p class="m2 ink">${esc(verse.m2)}</p>
    </div>
    <div class="acts only-narrow">
      <button class="btn" type="button" data-act="pan-side">معنی و کارت${icon('i-next')}</button>
    </div>
    <nav class="pager" aria-label="ورق زدن">
      <button class="btn" type="button" data-act="prev" ${state.index === 0 ? 'disabled' : ''}>${icon('i-prev')}قبلی</button>
      <span class="pager__num" aria-label="صفحهٔ ${fa(state.index + 1)} از ${fa(count)}">${fa(state.index + 1)} از ${fa(count)}</span>
      <button class="btn" type="button" data-act="next" ${state.index === count - 1 ? 'disabled' : ''}>بعدی${icon('i-next')}</button>
    </nav>`;
  sideBody.innerHTML = `
    ${state.query ? `<p class="query-echo">حالِ تو: <q>${esc(state.query)}</q></p>` : '<p class="query-echo">از بیت‌های نشان‌شده</p>'}
    ${meaningBlock(verse)}
    <p class="muted">از <b>${esc(verse.book)}</b>، ${esc(verse.title)} ·
      <a href="${esc(verse.url)}" target="_blank" rel="noopener">متن کامل در گنجور</a></p>
    <div class="rule"></div>
    ${verseActions(verse)}`;
}

function niyatView() {
  mainBody.innerHTML = `
    <div class="niyat">
      <p class="niyat__text">ای حافظ شیرازی،<br>تو محرمِ هر رازی…</p>
      <p class="muted">چشم‌هایت را ببند و در دلت نیت کن.<br>بعد کتاب را باز کن.</p>
      <button class="btn btn--main" type="button" data-act="fal-open">${icon('i-book')}کتاب را باز کن</button>
      <button class="btn" type="button" data-act="home">بازگشت</button>
    </div>`;
  sideBody.innerHTML = `
    <h2 class="side-title">فال حافظ</h2>
    <p class="muted">رسمی قدیمی است: نیت می‌کنند، دیوان حافظ را باز می‌کنند و غزلی را که می‌آید می‌خوانند.</p>
    <div class="rule"></div>
    <p class="muted" style="text-align:center">این‌جا یک غزل از ${fa(495)} غزل حافظ، به‌صورت تصادفی باز می‌شود.</p>`;
}

function poemView() {
  const poem = state.poem;
  const lines = poem.lines.map((line) => `<li><p class="m1">${esc(line.m1)}</p><p class="m2">${esc(line.m2)}</p></li>`).join('');
  const first = poem.lines[0];
  mainBody.innerHTML = `
    <header class="head">
      <span class="head__poet">${esc(poem.poet)}</span>
      <span class="head__src">${esc(poem.book)}، ${esc(shortTitle(poem.title))}</span>
    </header>
    <ol class="poem" lang="fa">${lines}</ol>
    <nav class="pager">
      <button class="btn" type="button" data-act="back">${icon('i-prev')}بازگشت</button>
      ${state.poemIsFal ? `<button class="btn" type="button" data-act="fal-again">فال دوباره</button>` : ''}
      <button class="btn" type="button" data-act="share-first">${icon('i-share')}کارت</button>
    </nav>`;
  sideBody.innerHTML = `
    <h2 class="side-title">${state.poemIsFal ? 'فال تو' : esc(shortTitle(poem.title))}</h2>
    ${first && first.meaning ? `<div class="meaning"><span class="meaning__label">معنی سادهٔ بیت اول</span>${esc(first.meaning)}</div>` : ''}
    <p class="muted">${fa(poem.lines.length)} بیت ·
      <a href="${esc(poem.url)}" target="_blank" rel="noopener">این شعر در گنجور</a></p>
    <div class="rule"></div>
    <p class="muted" style="text-align:center">${state.poemIsFal ? 'هر بار که کتاب را باز کنی، غزل دیگری می‌آید.' : 'برای برگشتن به بیت‌ها «بازگشت» را بزن.'}</p>`;
}

function marksView() {
  const list = marks.map((m, i) => `<li><button class="mark" type="button" data-mark="${i}">
      <span class="mark__verse">${esc(m.m1)} / ${esc(m.m2)}</span>
      <span class="mark__src">${esc(m.poet)} · ${esc(m.book)}، ${esc(shortTitle(m.title))}</span>
    </button></li>`).join('');
  mainBody.innerHTML = `
    <header class="head"><span class="head__poet">بیت‌های نشان‌شده</span>
      <span class="head__src">${marks.length ? `${fa(marks.length)} بیت` : 'هنوز چیزی نشان نکرده‌ای'}</span></header>
    ${marks.length ? `<ul class="marks">${list}</ul>` : `<div class="empty"><p>هر بیتی را که دوست داشتی «نشان کن»<br>تا این‌جا بماند.</p></div>`}
    <nav class="pager"><button class="btn" type="button" data-act="home">${icon('i-prev')}صفحهٔ نخست</button><span></span><span></span></nav>`;
  sideBody.innerHTML = `
    <h2 class="side-title">روبانِ کتاب</h2>
    <p class="muted">بیت‌هایی که نشان می‌کنی فقط روی همین دستگاه نگه داشته می‌شوند.</p>
    <div class="rule"></div>
    <p class="muted" style="text-align:center">روی هر بیت بزن تا صفحه‌اش باز شود.</p>`;
}

const VIEWS = { search: searchView, results: resultView, niyat: niyatView, poem: poemView, marks: marksView };

function render() {
  book.dataset.view = state.view;
  VIEWS[state.view]();
  mainBody.scrollTop = 0;
  sideBody.scrollTop = 0;
}

// The two half-lines appear from right to left, like ink from a pen.
function writeInk() {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    mainBody.querySelectorAll('.ink').forEach((line) => line.classList.add('is-written'));
  }));
}

// ---------- sliding between the two pages (phones) ----------

// On a phone the open book is wider than the screen. 'main' shows the right
// page (the verse), 'side' slides over to the left page (meaning, actions).
function setPan(page) {
  book.dataset.pan = page;
}

// A tap on the page that is half outside the screen only slides to it.
spread.addEventListener('click', (event) => {
  if (isWide()) return;
  const page = event.target.closest('.page');
  const which = page === pageSide ? 'side' : page === pageMain ? 'main' : null;
  if (which && which !== book.dataset.pan) {
    event.preventDefault();
    event.stopPropagation();
    setPan(which);
  }
}, true);

// ---------- turning a page ----------

function snapshot(page) {
  const copy = page.cloneNode(true);
  copy.removeAttribute('id');
  copy.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  copy.querySelectorAll('.ink').forEach((node) => node.classList.add('is-written'));
  const typed = page.querySelector('textarea');
  if (typed) copy.querySelector('textarea').value = typed.value;
  return copy;
}

function element(className, ...children) {
  const node = document.createElement('div');
  node.className = className;
  node.append(...children);
  return node;
}

// direction: 'next' turns forward, 'prev' turns back. change() sets the new state.
function turn(direction, change) {
  if (state.turning) return Promise.resolve();
  if (isCalm() || book.dataset.state !== 'open') {
    change();
    render();
    writeInk();
    return Promise.resolve();
  }
  state.turning = true;
  pageSound();
  const oldMain = snapshot(pageMain);
  const oldSide = snapshot(pageSide);
  change();
  render();

  const front = element('leaf__face leaf__face--front');
  const back = element('leaf__face leaf__face--back');
  const shade = element('leaf__shade');
  const leaf = element('leaf', front, back, shade);
  let hold = null;
  let motion;

  // The leaf carries the old page on its front and the new one on its back.
  if (direction === 'next') {
    front.append(oldSide);
    back.append(snapshot(pageMain));
    hold = element('hold', oldMain);
    motion = { rotationY: 180 };
  } else {
    leaf.classList.add('leaf--right');
    front.append(oldMain);
    back.append(snapshot(pageSide));
    hold = element('hold hold--left', oldSide);
    motion = { rotationY: -180 };
  }
  back.querySelectorAll('.ink').forEach((node) => node.classList.remove('is-written'));
  spread.append(hold, leaf);
  setPan('main'); // on a phone, slide back to the page where the verse lands

  return new Promise((resolve) => {
    const timeline = gsap.timeline({
      onComplete() {
        leaf.remove();
        hold?.remove();
        state.turning = false;
        writeInk();
        resolve();
      },
    });
    const duration = 1.15;
    timeline.to(leaf, { ...motion, duration, ease: 'power2.inOut' }, 0);
    timeline.to(shade, { opacity: 0.7, duration: duration / 2, ease: 'sine.in' }, 0);
    timeline.to(shade, { opacity: 0, duration: duration / 2, ease: 'sine.out' }, duration / 2);
  });
}

// ---------- opening and closing the cover ----------

let coverTimeline = null;

function coverMotion(opening, duration) {
  const wide = isWide();
  // Closed, the cover sits in the middle. Open, it has swung over the spine.
  // On a phone the open book is wider than the screen, so the left page
  // starts outside the screen (-60%).
  const closed = { rotationY: 0, left: wide ? '25%' : '10%', opacity: 1 };
  const opened = { rotationY: 180, left: wide ? '0%' : '-60%' };
  const timeline = gsap.timeline();
  if (opening) {
    timeline.fromTo(cover, closed, { ...opened, duration, ease: 'power2.inOut' }, 0);
    timeline.fromTo(spread, { opacity: 0 }, { opacity: 1, duration: duration * 0.45, ease: 'sine.out' }, duration * 0.1);
    timeline.to(cover, { opacity: 0, duration: 0.3, ease: 'sine.out' }, duration - 0.05);
  } else {
    timeline.fromTo(cover, { ...opened, opacity: 0 }, { ...closed, duration, ease: 'power2.inOut' }, 0);
    timeline.to(cover, { opacity: 1, duration: 0.2 }, 0);
    timeline.to(spread, { opacity: 0, duration: duration * 0.4 }, duration * 0.6);
  }
  return timeline;
}

function openBook({ quick = false } = {}) {
  if (book.dataset.state !== 'closed') return Promise.resolve();
  const seen = store('beytyab.seen');
  store('beytyab.seen', true);
  document.body.classList.add('book-open');
  spread.removeAttribute('aria-hidden');
  book.dataset.state = 'opening';
  const done = () => {
    book.dataset.state = 'open';
    gsap.set(cover, { clearProps: 'all' });
    gsap.set(spread, { clearProps: 'opacity' });
    coverTimeline = null;
    writeInk();
  };
  if (isCalm()) {
    done();
    return Promise.resolve();
  }
  pageSound();
  return new Promise((resolve) => {
    coverTimeline = coverMotion(true, quick || seen ? 0.9 : 1.9);
    coverTimeline.eventCallback('onComplete', () => { done(); resolve(); });
  });
}

function closeBook() {
  if (book.dataset.state !== 'open' || isCalm()) return Promise.resolve();
  book.dataset.state = 'opening';
  pageSound();
  return new Promise((resolve) => {
    const timeline = coverMotion(false, 0.8);
    timeline.eventCallback('onComplete', () => {
      book.dataset.state = 'closed';
      gsap.set(cover, { clearProps: 'all' });
      resolve();
    });
  });
}

// A tap while the cover is opening finishes the animation at once.
book.addEventListener('pointerdown', () => {
  if (coverTimeline && coverTimeline.progress() > 0.05) coverTimeline.progress(1);
});

// ---------- actions ----------

async function runSearch(text) {
  const query = text.trim().replace(/\s+/g, ' ');
  if (query.length < 2) return say('اول چند کلمه از حال دلت بنویس');
  if (!state.ready) return say('هوش مصنوعی هنوز آماده نشده؛ چند لحظه صبر کن');
  const go = $('#go');
  if (go) { go.disabled = true; go.textContent = 'در حال گشتن…'; }
  try {
    const { results } = await ask({ type: 'search', text: query, top: 7 });
    if (!results.length) throw new Error('empty');
    await turn('next', () => {
      state.query = query;
      state.results = results;
      state.index = 0;
      state.view = 'results';
    });
  } catch {
    say('جست‌وجو انجام نشد. دوباره امتحان کن');
    if (go) { go.disabled = false; go.textContent = 'بیت‌ها را پیدا کن'; }
  }
}

async function openFal() {
  const { poem } = await ask({ type: 'randomPoem', collection: 'hafez' });
  if (!poem) return say('غزل‌های حافظ هنوز آماده نیست');
  setPan('main');
  await closeBook();
  state.poem = poem;
  state.poemIsFal = true;
  state.backTo = 'search';
  state.view = 'poem';
  render();
  await openBook({ quick: true });
}

async function openWholePoem(verse) {
  const { poem } = await ask({ type: 'poem', collection: verse.collection, poem: verse.poem });
  if (!poem) return;
  turn('next', () => {
    state.poem = poem;
    state.poemIsFal = false;
    state.backTo = 'results';
    state.view = 'poem';
  });
}

function goHome() {
  if (state.view === 'search') return;
  turn('prev', () => { state.view = 'search'; });
}

function step(delta) {
  if (state.view !== 'results') return;
  const target = state.index + delta;
  if (target < 0 || target >= state.results.length) return;
  turn(delta > 0 ? 'next' : 'prev', () => { state.index = target; });
}

async function share(verse) {
  say('در حال ساختن کارت…');
  try {
    const outcome = await shareVerse(verse);
    if (outcome === 'saved') say('کارت در دانلودها ذخیره شد');
    else toast.classList.remove('is-on');
  } catch {
    say('کارت ساخته نشد');
  }
}

// One listener for every button inside the pages.
spread.addEventListener('click', (event) => {
  const example = event.target.closest('[data-example]');
  if (example) {
    $('#q').value = example.dataset.example;
    return runSearch(example.dataset.example);
  }
  const markButton = event.target.closest('[data-mark]');
  if (markButton) {
    const verse = marks[Number(markButton.dataset.mark)];
    return turn('next', () => {
      state.query = '';
      state.results = [verse];
      state.index = 0;
      state.view = 'results';
    });
  }
  const button = event.target.closest('[data-act]');
  if (!button || button.disabled) return;
  const verse = state.results[state.index];
  switch (button.dataset.act) {
    case 'next': return step(1);
    case 'prev': return step(-1);
    case 'home': return goHome();
    case 'pan-side': return setPan('side');
    case 'mark': {
      toggleMark(verse);
      const marked = isMarked(verse);
      spread.querySelectorAll('[data-act="mark"]').forEach((b) => {
        b.classList.toggle('btn--on', marked);
        b.setAttribute('aria-pressed', String(marked));
        b.innerHTML = `${icon(marked ? 'i-mark-on' : 'i-mark')}${marked ? 'نشان شد' : 'نشان کن'}`;
      });
      return;
    }
    case 'share': return share(verse);
    case 'share-first': {
      const first = state.poem.lines[0];
      return share({ ...state.poem, m1: first.m1, m2: first.m2 });
    }
    case 'poem': return openWholePoem(verse);
    case 'back': return turn('prev', () => { state.view = state.backTo; });
    case 'fal-open':
    case 'fal-again': return openFal();
  }
});

spread.addEventListener('submit', (event) => {
  event.preventDefault();
  runSearch($('#q').value);
});

spread.addEventListener('keydown', (event) => {
  if (event.target.id === 'q' && event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    runSearch(event.target.value);
  }
});

spread.addEventListener('click', (event) => {
  if (event.target.closest('#fal')) {
    if (!state.ready) return say('چند لحظه صبر کن تا کتاب آماده شود');
    turn('next', () => { state.view = 'niyat'; });
  } else if (event.target.closest('#mic')) {
    listen();
  }
});

// Arrow keys and swipes turn the result pages. In a right-to-left book,
// forward is to the left.
document.addEventListener('keydown', (event) => {
  if (event.target.matches('textarea, input')) return;
  if (event.key === 'ArrowLeft') step(1);
  else if (event.key === 'ArrowRight') step(-1);
});

let touchStart = null;
spread.addEventListener('touchstart', (event) => {
  const touch = event.touches[0];
  touchStart = { x: touch.clientX, y: touch.clientY };
}, { passive: true });
spread.addEventListener('touchend', (event) => {
  if (!touchStart) return;
  const touch = event.changedTouches[0];
  const dx = touch.clientX - touchStart.x;
  const dy = touch.clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
  const forward = dx > 0; // dragging the page to the right moves forward
  if (!isWide()) {
    // Phones: first slide to the other page, then turn the page.
    if (forward && book.dataset.pan !== 'side') return setPan('side');
    if (!forward && book.dataset.pan === 'side') return setPan('main');
  }
  step(forward ? 1 : -1);
}, { passive: true });

// ---------- toolbar ----------

$('#open-btn').addEventListener('click', () => openBook());
$('#tool-home').addEventListener('click', goHome);
$('#tool-marks').addEventListener('click', () => {
  if (state.view !== 'marks') turn('next', () => { state.view = 'marks'; });
});

const soundTool = $('#tool-sound');
function showSound() {
  const on = soundIsOn();
  soundTool.setAttribute('aria-pressed', String(on));
  soundTool.innerHTML = icon(on ? 'i-sound-on' : 'i-sound-off');
}
soundTool.addEventListener('click', () => {
  setSound(!soundIsOn());
  store('beytyab.sound', soundIsOn());
  showSound();
  if (soundIsOn()) pageSound();
  say(soundIsOn() ? 'صدای ورق زدن روشن شد' : 'صدا خاموش شد');
});

// ---------- speaking instead of typing ----------

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const speechAvailable = () => Boolean(Recognition);
let recognition = null;

function listen() {
  const mic = $('#mic');
  if (recognition) return recognition.stop();
  recognition = new Recognition();
  recognition.lang = 'fa-IR';
  recognition.interimResults = true;
  mic.classList.add('is-listening');
  say('بگو، گوش می‌دهم…');
  recognition.onresult = (event) => {
    const input = $('#q');
    if (input) input.value = Array.from(event.results).map((r) => r[0].transcript).join(' ');
  };
  recognition.onerror = (event) => {
    say(event.error === 'not-allowed' ? 'اجازهٔ میکروفون داده نشد' : 'صدا شنیده نشد. می‌توانی بنویسی');
  };
  recognition.onend = () => {
    recognition = null;
    $('#mic')?.classList.remove('is-listening');
  };
  try { recognition.start(); } catch { recognition = null; mic.classList.remove('is-listening'); }
}

// ---------- start ----------

setPan('main');
setSound(store('beytyab.sound') === true);
showSound();
showMarkCount();
render();
showProgress();
worker.postMessage({ type: 'init' });

// On the live site always; on a local test server only with ?sw=1, so that
// edits show up at once while developing.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.search.includes('sw=1'))) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
