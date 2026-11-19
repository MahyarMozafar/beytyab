// بیت‌یاب — the page itself: the cover, the pages and everything a visitor taps.
// The heavy work (the language model and the search) lives in js/worker.js.

import { pageSound, setSound, soundIsOn } from './sound.js';
import { shareVerse } from './share.js';
import { OPENING_POEMS } from './opening-poems.js';

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

// How many verses one search brings: one verse on each page.
const RESULT_PAGES = 12;

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
  ready: false, // the model is loaded: search by meaning works
  poemsReady: false, // Hafez's text is loaded: reading, fal and word search work
  byMeaning: true, // how the pages on show were found
  origin: 'search', // where the pages on show come from: search | marks | link | daily
  daily: null, // the verse of the day
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
  if (data.type === 'network') {
    state.weakNetwork = !data.ok;
    showProgress();
  } else if (data.type === 'poems') {
    const first = !state.poemsReady;
    state.poemsReady = true;
    showProgress();
    if (first) loadDaily();
  } else if (data.type === 'progress') {
    state.percent = Math.floor((100 * data.loaded) / data.total);
    showProgress();
  } else if (data.type === 'ready') {
    state.poemsReady = true;
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
  else if (state.weakNetwork) text = 'اینترنت ضعیف است؛ دوباره تلاش می‌کنم…';
  else if (!state.poemsReady) text = 'در حال آماده‌سازی…';
  else if (!state.ready) text = `کتاب باز می‌شود · هوش مصنوعی ${fa(state.percent)}٪ (بار اول حدود ۲۶ مگابایت)`;
  else text = 'آماده است';
  if (line) line.textContent = text;

  const status = $('#status');
  const go = $('#go');
  const fal = $('#fal');
  // The book is usable as soon as the first poems are here; the search by
  // meaning joins when the model has arrived.
  if (go) go.disabled = !state.poemsReady;
  if (fal) fal.disabled = !state.poemsReady;
  if (status) {
    if (state.failed) status.textContent = text;
    else if (state.weakNetwork && !state.ready) status.innerHTML = `اینترنت ضعیف است؛ هر تکه که برسد نگه داشته می‌شود و ادامه می‌دهم… <b>${fa(state.percent)}٪</b>`;
    else if (!state.poemsReady) status.textContent = 'کتاب در حال آماده شدن است…';
    else if (!state.ready) status.innerHTML = `هوش مصنوعی در راه است… <b>${fa(state.percent)}٪</b><br>تا آن وقت با <b>کلمه‌های خودت</b> می‌گردم و فال حافظ هم آماده است.`;
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
    <div id="daily">${dailyBlock()}</div>
    <div class="rule"></div>
    <p class="muted" style="text-align:center">حالت را با زبان خودت بنویس؛ کتاب بیت‌هایی با همان <b>معنی</b> می‌آورد.<br>
      <button class="textlink" type="button" data-act="about">این کتاب چطور کار می‌کند؟</button></p>`;
  if (speechAvailable()) $('#mic').hidden = false;
  showProgress();
}

// The verse of the day sits on the left page of the first spread.
function dailyBlock() {
  const verse = state.daily;
  // Until it arrives (or if it never does) the page shows a plain welcome.
  if (!verse) return '<h2 class="side-title">خوش آمدی</h2><p class="muted" style="text-align:center">این کتاب، شعری برای حالِ دلت پیدا می‌کند.</p>';
  return `
    <h2 class="side-title">بیتِ امروز</h2>
    <button class="daily" type="button" data-act="daily-open" aria-label="بیت امروز را باز کن">
      <span class="daily__verse" lang="fa">${esc(verse.m1)}<br>${esc(verse.m2)}</span>
      <span class="daily__src">${esc(verse.poet)} · ${esc(shortTitle(verse.title))}</span>
      <span class="daily__more">معنی و صفحهٔ این بیت${icon('i-next')}</span>
    </button>`;
}

// Tehran time decides when "today" turns over (UTC + 3:30).
const today = () => Math.floor((Date.now() + 3.5 * 3600e3) / 86400e3);

async function loadDaily() {
  try {
    const { verse } = await ask({ type: 'daily', day: today() });
    state.daily = verse;
    const slot = $('#daily');
    if (slot) slot.innerHTML = dailyBlock();
  } catch { /* the page works without it */ }
}

function aboutView() {
  mainBody.innerHTML = `
    <header class="head"><span class="head__poet">این کتاب چطور کار می‌کند؟</span>
      <span class="head__src">جست‌وجو با معنی، نه با کلمه</span></header>
    <ol class="how">
      <li>حال یا موقعیتت را با زبان خودت می‌نویسی. لازم نیست کلمه‌های شعر را بدانی.</li>
      <li>یک هوش مصنوعیِ کوچک جمله‌ات را به ۳۸۴ عدد تبدیل می‌کند. این عددها «معنی» جملهٔ تو هستند.</li>
      <li>معنی بیش از ۴۱ هزار بیت از حافظ، سعدی و مولانا از قبل به همین شکل حساب شده است.</li>
      <li>کتاب عددهای تو را با عددهای همهٔ بیت‌ها مقایسه می‌کند و نزدیک‌ترین‌ها را، هر کدام در یک صفحه، باز می‌کند.</li>
    </ol>
    <nav class="pager"><button class="btn" type="button" data-act="home">${icon('i-prev')}صفحهٔ نخست</button><span></span><span></span></nav>`;
  sideBody.innerHTML = `
    <h2 class="side-title">زیرِ جلدِ کتاب</h2>
    <ul class="facts">
      <li><b>همه‌چیز روی دستگاه خودت.</b> هوش مصنوعی داخل مرورگر تو کار می‌کند. سروری در کار نیست و نوشته‌ات به هیچ جایی فرستاده نمی‌شود.</li>
      <li><b>مدلِ سبک‌شده.</b> مدل زبانیِ <bdi dir="ltr">multilingual-e5-small</bdi> صد زبان می‌داند. فقط واژه‌های فارسی‌اش نگه داشته شد و حجمش از ۱۱۸ به ۲۷ مگابایت رسید، بدون اینکه جواب‌ها عوض شود.</li>
      <li><b>بدون اینترنت.</b> بعد از بار اول، کتاب روی دستگاهت می‌ماند و بی‌اینترنت هم باز می‌شود.</li>
      <li><b>متن شعرها</b> و معنی‌های ساده از <a href="https://ganjoor.net" target="_blank" rel="noopener">گنجور</a> است. معنی‌ها را ماشین نوشته و شاید دقیق نباشند.</li>
    </ul>
    ${installBlock()}
    <div class="rule"></div>
    <p class="muted" style="text-align:center">ساختهٔ <a href="https://mahyarmozafar.ir" target="_blank" rel="noopener">مهیار مظفر</a> ·
      <a href="https://github.com/MahyarMozafar/beytyab" target="_blank" rel="noopener">کدِ برنامه</a></p>`;
}

// ---------- on the home screen, like an app ----------

// Android browsers hand over an "install" question that the page may ask
// later, on a button. iPhones have no such thing: there the reader adds
// the page by hand, so the page only explains how.
let installQuestion = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installQuestion = event;
  if (state.view === 'about') render();
});
window.addEventListener('appinstalled', () => {
  installQuestion = null;
  if (state.view === 'about') render();
});

function installBlock() {
  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (installed) return '';
  const apple = /iphone|ipad|ipod/i.test(navigator.userAgent);
  let body;
  if (installQuestion) {
    body = `<button class="btn btn--main" type="button" data-act="install">روی صفحهٔ گوشی بگذار</button>`;
  } else if (apple) {
    body = `<p class="muted">در سافاری دکمهٔ <b>Share</b> را بزن و بعد <b dir="ltr">Add to Home Screen</b> را انتخاب کن.</p>`;
  } else {
    body = `<p class="muted">از منوی مرورگر، <b dir="ltr">Add to Home screen</b> یا <b dir="ltr">Install</b> را انتخاب کن.</p>`;
  }
  return `<div class="install"><span class="meaning__label">بیت‌یاب مثل یک برنامه</span>
    <p class="muted">کتاب را روی صفحهٔ اصلی گوشی بگذار تا با یک لمس باز شود.</p>${body}</div>`;
}

async function install() {
  if (!installQuestion) return;
  installQuestion.prompt();
  await installQuestion.userChoice.catch(() => null);
  installQuestion = null;
  if (state.view === 'about') render();
}

function meaningBlock(verse, extraClass = '', hidden = false) {
  if (!verse.meaning) return '';
  return `<div class="meaning ${extraClass}" ${hidden ? 'hidden' : ''}>
    <span class="meaning__label">معنی ساده</span>${esc(verse.meaning)}</div>`;
}

// The small line above a verse that says why this page is open.
const ORIGIN_LINE = {
  search: (st) => `حالِ تو: <q>${esc(st.query)}</q>`,
  marks: () => 'از بیت‌های نشان‌شده',
  link: () => 'این بیت را برای تو فرستاده‌اند',
  daily: () => 'بیتِ امروز',
};

function verseActions(verse) {
  const marked = isMarked(verse);
  return `<div class="acts">
    <button class="btn ${marked ? 'btn--on' : ''}" type="button" data-act="mark" aria-pressed="${marked}">${icon(marked ? 'i-mark-on' : 'i-mark')}${marked ? 'نشان شد' : 'نشان کن'}</button>
    <button class="btn" type="button" data-act="share">${icon('i-share')}کارت</button>
    <button class="btn" type="button" data-act="link">${icon('i-link')}لینک</button>
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
    <nav class="pager" aria-label="ورق زدن">
      <button class="btn" type="button" data-act="prev" ${state.index === 0 ? 'disabled' : ''}>${icon('i-prev')}قبلی</button>
      <span class="pager__num" aria-label="صفحهٔ ${fa(state.index + 1)} از ${fa(count)}">${fa(state.index + 1)} از ${fa(count)}</span>
      <button class="btn" type="button" data-act="next" ${state.index === count - 1 ? 'disabled' : ''}>بعدی${icon('i-next')}</button>
    </nav>`;
  sideBody.innerHTML = `
    <p class="query-echo">${ORIGIN_LINE[state.origin](state)}</p>
    ${state.origin === 'search' && !state.byMeaning ? '<p class="note">این بیت‌ها با <b>کلمه‌های تو</b> پیدا شدند. هوش مصنوعی که آماده شد، دوباره بگرد تا با <b>معنی</b> بگردد.</p>' : ''}
    ${meaningBlock(verse)}
    <p class="muted">از <b>${esc(verse.book)}</b>، ${esc(verse.title)} ·
      <a href="${esc(verse.url)}" target="_blank" rel="noopener">متن کامل در گنجور</a></p>
    <div class="rule"></div>
    ${verseActions(verse)}
    ${state.origin === 'link' || state.origin === 'daily'
      ? `<div class="acts"><button class="btn btn--main" type="button" data-act="home">حالِ دلِ خودت را بنویس</button></div>` : ''}`;
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
  if (state.poemIsFal && poem.reading) {
    const reading = poem.reading;
    sideBody.innerHTML = `
      <h2 class="side-title">تعبیر فال تو</h2>
      <div class="omen omen--${reading.omen}">
        <span class="omen__label">${esc(reading.label)}</span>
        <p class="omen__line">${esc(reading.line)}</p>
      </div>
      <div class="meaning"><span class="meaning__label">این غزل چه می‌گوید؟</span>${esc(reading.summary)}</div>
      <p class="muted">${fa(poem.lines.length)} بیت ·
        <a href="${esc(poem.url)}" target="_blank" rel="noopener">این غزل در گنجور</a></p>
      <div class="rule"></div>
      <p class="muted" style="text-align:center">تعبیر را ماشین نوشته و برای دلخوشی است.<br>هر بار که کتاب را باز کنی، غزل دیگری می‌آید.</p>`;
    return;
  }
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

const VIEWS = { search: searchView, results: resultView, niyat: niyatView, poem: poemView, marks: marksView, about: aboutView };

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

// ---------- fitting the book on small screens ----------

// On a phone the book keeps the same two-page shape as on a wide screen. It
// is laid out at a comfortable size and then scaled down to fit (see the
// phone block in css/main.css). Closed, the cover is zoomed in to fill the
// screen; it zooms out to the whole book while it opens.
const desk = book.parentElement;
function fitBook() {
  const names = ['--bw', '--bh', '--bs', '--zc'];
  if (isWide()) return names.forEach((name) => book.style.removeProperty(name));
  const tools = $('.tools');
  const credit = $('.credit');
  const roomX = desk.clientWidth - 48;
  // sideways phone: the buttons stand beside the book and take no height
  const sideways = getComputedStyle(tools).position === 'absolute';
  const roomY = desk.clientHeight - (sideways ? -30 : tools.offsetHeight) - (credit?.offsetHeight ?? 0) - 100;
  const scale = Math.min(1, roomX / 540, roomY / 470);
  let width = roomX / scale;
  let height = roomY / scale;
  // one page is between 0.54 and 0.8 times as wide as it is tall
  if (width / 2 > height * 0.8) width = height * 1.6;
  if (width / 2 < height * 0.54) height = width / 2 / 0.54;
  const closedZoom = Math.min((roomX - 24) / (width / 2), roomY / height, 2.2) * 0.9 / scale;
  book.style.setProperty('--bw', `${Math.round(width)}px`);
  book.style.setProperty('--bh', `${Math.round(height)}px`);
  book.style.setProperty('--bs', scale.toFixed(4));
  book.style.setProperty('--zc', Math.max(1, closedZoom).toFixed(4));
}
addEventListener('resize', fitBook);
wideQuery.addEventListener('change', fitBook);

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

// Slow at the start (a hand lifting weight), steady in the middle, and still
// moving when it lands, like a heavy block of paper falling over.
const liftEase = (p) => p * p * (1.9 - 0.9 * p);

// The pages that turn while the book opens carry real ghazals, like any page
// in the middle of a divan. Each opening takes the next ones from the list.
let nextOpeningPoem = Math.floor(Math.random() * OPENING_POEMS.length);
function poemPage() {
  const poem = OPENING_POEMS[nextOpeningPoem % OPENING_POEMS.length];
  nextOpeningPoem += 1;
  const lines = poem.lines.map(([m1, m2]) => `<li><p class="m1">${esc(m1)}</p><p class="m2">${esc(m2)}</p></li>`).join('');
  const body = element('page__body page__body--still');
  body.innerHTML = `
    <header class="head">
      <span class="head__poet">${esc(poem.poet)}</span>
      <span class="head__src">${esc(poem.title)}</span>
    </header>
    <ol class="poem poem--page" lang="fa">${lines}</ol>`;
  return element('page', element('page__frame'), body);
}

// Builds the whole opening as one timeline (about 2.8 seconds at speed 1):
// the cover and a thick block of pages lift together and fall to the right,
// then a few loose pages follow. The last one carries the real right page.
// Closing the book plays the same timeline backwards.
function openingTimeline(loose) {
  const boards = $('.boards', spread);
  const cast = element('cast');
  const leaves = [];
  for (let k = 1; k <= loose; k += 1) {
    const depth = (loose - k + 1) * 0.5; // the first to lift lies on top
    const front = element('leaf__face leaf__face--front', poemPage(), element('leaf__shade'));
    const back = element('leaf__face leaf__face--back', k === loose ? snapshot(pageMain) : poemPage(), element('leaf__shade'));
    front.style.transform = `translateZ(${depth}px)`;
    back.style.transform = `rotateY(180deg) translateZ(${-depth}px)`;
    leaves.push(element('leaf leaf--loose', front, back));
  }
  // the last page of the block that lifts with the cover
  $('.cover__face--back', cover).replaceChildren(poemPage());
  // lowest in the pile first, so that the top one is painted last
  spread.append(cast, ...leaves.slice().reverse());

  const zoom = Number(getComputedStyle(book).getPropertyValue('--zc')) || 1;
  const timeline = gsap.timeline({ paused: true });
  timeline.eventCallback('onComplete', null);
  timeline.cleanup = () => {
    cast.remove();
    leaves.forEach((leaf) => leaf.remove());
    gsap.set(cover, { clearProps: 'all' });
    gsap.set(boards, { clearProps: 'all' });
    book.style.removeProperty('--shift');
    book.style.removeProperty('--zoom');
  };

  // 1. a thumb goes in and the edge of the block comes up a little
  timeline.fromTo(cover, { rotationY: 0 }, { rotationY: 9, duration: 0.4, ease: 'power2.out' }, 0);
  timeline.fromTo(boards, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'none' }, 0);
  // 2. the block turns over the spine and falls on the right side
  timeline.to(cover, { rotationY: 180, duration: 1.55, ease: liftEase }, 0.4);
  timeline.to(cover, { rotationY: 176.5, duration: 0.12, ease: 'power1.out' }, 1.95);
  timeline.to(cover, { rotationY: 180, duration: 0.2, ease: 'power1.in' }, 2.07);
  // meanwhile the book moves so that the spine ends in the middle of the desk
  timeline.fromTo(book, { '--shift': '25%', '--zoom': zoom }, { '--shift': '0%', '--zoom': 1, duration: 1.75, ease: 'sine.inOut' }, 0.2);
  // its shadow on the desk, then the leather under it
  timeline.fromTo(cast, { opacity: 0 }, { opacity: 1, duration: 0.7, ease: 'sine.in' }, 0.9);
  timeline.to(cast, { opacity: 0, duration: 0.35, ease: 'sine.out' }, 1.6);
  timeline.fromTo(boards, { '--k': 1 }, { '--k': 0, duration: 0.4, ease: 'sine.inOut' }, 1.55);
  // 3. the loose pages follow, one after another
  leaves.forEach((leaf, index) => {
    const start = 1.0 + index * 0.24;
    const [frontShade, backShade] = leaf.querySelectorAll('.leaf__shade');
    timeline.fromTo(leaf, { rotationY: 0 }, { rotationY: 180, duration: 1.1, ease: 'power2.inOut' }, start);
    timeline.fromTo(frontShade, { opacity: 0 }, { opacity: 0.8, duration: 0.55, ease: 'sine.in' }, start);
    timeline.fromTo(backShade, { opacity: 0.8 }, { opacity: 0, duration: 0.55, ease: 'sine.out' }, start + 0.55);
  });
  timeline.to({}, { duration: 0.12 }); // a short rest before the real page takes over
  return timeline;
}

function openBook({ quick = false } = {}) {
  if (book.dataset.state !== 'closed') return Promise.resolve();
  const seen = store('beytyab.seen');
  store('beytyab.seen', true);
  document.body.classList.add('book-open');
  spread.removeAttribute('aria-hidden');
  if (isCalm()) {
    book.dataset.state = 'open';
    worker.postMessage({ type: 'model' });
    writeInk();
    return Promise.resolve();
  }
  book.dataset.state = 'opening';
  pageSound();
  return new Promise((resolve) => {
    const timeline = openingTimeline(quick ? 2 : 3);
    coverTimeline = timeline;
    timeline.eventCallback('onComplete', () => {
      book.dataset.state = 'open';
      timeline.cleanup();
      coverTimeline = null;
      worker.postMessage({ type: 'model' }); // the big download may start now
      writeInk();
      resolve();
    });
    timeline.timeScale(quick ? 1.7 : seen ? 1.25 : 1).play(0);
  });
}

function closeBook() {
  if (book.dataset.state !== 'open' || isCalm()) return Promise.resolve();
  pageSound();
  return new Promise((resolve) => {
    const timeline = openingTimeline(2);
    timeline.progress(1);
    book.dataset.state = 'opening';
    timeline.eventCallback('onReverseComplete', () => {
      book.dataset.state = 'closed';
      timeline.cleanup();
      resolve();
    });
    timeline.timeScale(2).reverse();
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
  if (!state.poemsReady) return say('کتاب هنوز آماده نشده؛ چند لحظه صبر کن');
  const go = $('#go');
  if (go) { go.disabled = true; go.textContent = 'در حال گشتن…'; }
  try {
    const { results, byMeaning } = await ask({ type: 'search', text: query, top: RESULT_PAGES });
    if (!results.length) {
      // Only the word search can come back empty-handed.
      say('با این کلمه‌ها بیتی پیدا نشد. چند کلمهٔ دیگر بنویس، یا صبر کن تا هوش مصنوعی آماده شود');
      if (go) { go.disabled = false; go.textContent = 'بیت‌ها را پیدا کن'; }
      return;
    }
    await turn('next', () => {
      state.byMeaning = byMeaning;
      state.origin = 'search';
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

// The reading of each ghazal (its mood and what it says as a whole) is one
// small file, fetched the first time somebody takes a fal.
let falFile = null;
async function falReading(poemNumber) {
  try {
    falFile ??= fetch('data/site/hafez-fal.json').then((response) => response.json());
    const { moods, poems } = await falFile;
    const [moodNumber, summary] = poems[poemNumber];
    const mood = moods[moodNumber];
    return { omen: mood.omen, label: mood.label, line: mood.lines[poemNumber % mood.lines.length], summary };
  } catch {
    falFile = null; // try again next time
    return null; // the fal still opens, with the meaning of its first couplet
  }
}

async function openFal() {
  const { poem } = await ask({ type: 'randomPoem', collection: 'hafez' });
  if (!poem) return say('غزل‌های حافظ هنوز آماده نیست');
  poem.reading = await falReading(poem.poem);
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

// ---------- a link that opens the book on one verse ----------

// The address ends in #b=<poet file>.<row>, for example #b=hafez.1204.
const verseLink = (verse) => `${location.origin}${location.pathname}#b=${verse.collection}.${verse.row}`;

async function shareLink(verse) {
  const url = verseLink(verse);
  const text = `${verse.m1}\n${verse.m2}\n— ${verse.poet}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'بیت‌یاب', text, url });
      return;
    } catch (error) {
      if (error.name === 'AbortError') return; // the reader closed the sheet
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    say('لینک این بیت کپی شد');
  } catch {
    say(url);
  }
}

// Somebody opened a shared link: put that verse on the pages, behind the
// closed cover, so the book opens on it.
async function openSharedVerse() {
  const match = /^#b=([a-z-]+)\.(\d+)$/.exec(location.hash);
  if (!match) return;
  try {
    const { verse } = await ask({ type: 'verse', collection: match[1], row: Number(match[2]) });
    if (!verse || state.view !== 'search') return;
    const show = () => {
      state.origin = 'link';
      state.query = '';
      state.results = [verse];
      state.index = 0;
      state.view = 'results';
    };
    if (book.dataset.state === 'open') return turn('next', show);
    show();
    render();
    const gift = $('#cover-gift');
    if (gift) gift.hidden = false;
  } catch { /* a broken link just opens the first page */ }
}

function openAbout() {
  if (state.view !== 'about') turn('next', () => { state.view = 'about'; });
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
      state.origin = 'marks';
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
    case 'link': return shareLink(verse);
    case 'about': return openAbout();
    case 'install': return install();
    case 'daily-open':
      if (!state.daily) return;
      return turn('next', () => {
        state.origin = 'daily';
        state.query = '';
        state.results = [state.daily];
        state.index = 0;
        state.view = 'results';
      });
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

// A mouse wheel moves the row of suggestions sideways.
spread.addEventListener('wheel', (event) => {
  const row = event.target.closest('.chips');
  if (!row || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  event.preventDefault();
  row.scrollLeft -= event.deltaY; // right-to-left row: down moves to the left
}, { passive: false });

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
    if (!state.poemsReady) return say('چند لحظه صبر کن تا کتاب آماده شود');
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
  step(forward ? 1 : -1);
}, { passive: true });

// ---------- toolbar ----------

$('#open-btn').addEventListener('click', () => openBook());
$('#tool-home').addEventListener('click', goHome);
// (?.: a visitor may still hold yesterday's copy of the page without this button)
$('#tool-about')?.addEventListener('click', openAbout);
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

fitBook();
setSound(store('beytyab.sound') === true);
showSound();
showMarkCount();
render();
showProgress();
// On a phone the big download waits until the cover has opened.
worker.postMessage({ type: 'init', waitForOpen: !isWide() });
openSharedVerse();

// On the live site always; on a local test server only with ?sw=1, so that
// edits show up at once while developing.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.search.includes('sw=1'))) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
