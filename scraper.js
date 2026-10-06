// Opens Vuniper in headless Chrome and reads its own data feed from inside the page
// (the feed only answers requests coming from vuniper.com itself).
const puppeteer = require('puppeteer');

const MONTHS = 6;

// Each row: Stremio catalog id/name/type, Vuniper mediaType + section, the field Vuniper
// sorts/pages by, and which way "6 months" runs ("past", "future" or "none" for popularity lists).
const ROWS = [
  { id: 'vuniper-now-online',  name: 'Vuniper: Now Online',       type: 'movie',  mt: 'movies', sec: 'web',      field: 'web',              dir: 'past' },
  { id: 'vuniper-hidden-gems', name: 'Vuniper: Hidden Gems',      type: 'movie',  mt: 'movies', sec: 'gems',     field: 'web',              dir: 'past' },
  { id: 'vuniper-upcoming',    name: 'Vuniper: Upcoming Movies',  type: 'movie',  mt: 'movies', sec: 'upcoming', field: 'release_date',     dir: 'future' },
  { id: 'vuniper-theaters',    name: 'Vuniper: In Theaters',      type: 'movie',  mt: 'movies', sec: 'theaters', field: 'release_date',     dir: 'past' },
  { id: 'vuniper-popular',     name: 'Vuniper: Popular Online',   type: 'movie',  mt: 'movies', sec: 'popular',  field: 'popularity',       dir: 'none', filterField: 'web', maxPages: 15 },
  { id: 'vuniper-bluray',      name: 'Vuniper: New on Blu-ray',   type: 'movie',  mt: 'movies', sec: 'bluray',   field: 'bluray',           dir: 'past' },
  { id: 'vuniper-shows-new',      name: 'Vuniper: New Shows & Seasons', type: 'series', mt: 'shows', sec: 'new',      field: 'last_season_date', dir: 'past' },
  { id: 'vuniper-shows-upcoming', name: 'Vuniper: Upcoming Shows',      type: 'series', mt: 'shows', sec: 'upcoming', field: 'next_season_date', dir: 'future' },
  { id: 'vuniper-shows-popular',  name: 'Vuniper: Popular Shows',       type: 'series', mt: 'shows', sec: 'popular',  field: 'popularity',       dir: 'none', maxPages: 5 },
];

// Runs inside the vuniper.com page. Mirrors how the site's own "Show more" pages through a list.
async function fetchRowInPage(row, months) {
  const API = 'https://api.vuniper.workers.dev/?';
  const PAGE = 21; // Vuniper returns 21 and shows 20; the 21st only signals "there's more"
  const HARD_MAX_PAGES = 40;
  const get = async (qs) => JSON.parse(await (await fetch(API + qs)).text());
  const now = Date.now();
  const span = months * 30.44 * 864e5;
  const toTime = (v) => (v ? Date.parse(String(v).replace(' ', 'T') + (/[zZ]$|[+-]\d\d:?\d\d$/.test(v) ? '' : 'Z')) : NaN);
  const inRange = (t) => (row.dir === 'past' ? t >= now - span : row.dir === 'future' ? t <= now + span : true);

  let page = (await get(`action=GET_MANY_ITEMS_KV&kvName=${row.mt}_${row.sec}`)).items || [];
  const all = [];
  let pages = 1;
  for (;;) {
    const full = page.length >= PAGE;
    const shown = full ? page.slice(0, PAGE - 1) : page;
    let stop = false;
    for (const it of shown) {
      if (row.dir !== 'none' && !inRange(toTime(it[row.field]))) { stop = true; break; }
      all.push(it);
    }
    if (stop || !full || pages >= (row.maxPages || HARD_MAX_PAGES)) break;
    let cur = shown[shown.length - 1][row.field];
    if (cur == null) break;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(cur)) cur = cur.replace(' ', 'T') + '.000Z';
    page = (await get(`action=GET_MANY_ITEMS&mediaType=${row.mt}&section=${row.sec}&paginationCursor=${encodeURIComponent(cur)}`)).items || [];
    pages++;
    if (!page.length) break;
  }
  return row.filterField ? all.filter((it) => toTime(it[row.filterField]) >= now - span) : all;
}

const fmtDate = (v) => {
  const t = Date.parse(String(v || '').replace(' ', 'T'));
  return isNaN(t) ? null : new Date(t).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
};

function toMeta(i, row) {
  if (!i.imdb_id || !/^tt\d+$/.test(i.imdb_id)) return null;
  const bits = [];
  if (row.id === 'vuniper-upcoming' && fmtDate(i.release_date)) bits.push(`Out ${fmtDate(i.release_date)}.`);
  if (row.id === 'vuniper-shows-upcoming' && fmtDate(i.next_season_date)) bits.push(`New season ${fmtDate(i.next_season_date)}.`);
  if (i.score) bits.push(`Vuniper score ${i.score}%${i.reviews_count ? ` (${i.reviews_count} reviews)` : ''}.`);
  const split = (s) => (s ? String(s).split(',').map((x) => x.trim()).filter(Boolean) : undefined);
  const year = i.year ? String(i.year) : '';
  return {
    id: i.imdb_id,
    type: row.type,
    name: i.title,
    poster: `https://images.metahub.space/poster/medium/${i.imdb_id}/img`,
    background: `https://images.metahub.space/background/medium/${i.imdb_id}/img`,
    releaseInfo: row.type === 'series' && year ? `${year}–${i.year_end || ''}` : year,
    description: [...bits, i.description || ''].join(' ').trim(),
    genres: split(i.genres),
    runtime: i.runtime || undefined,
    director: i.director ? [i.director] : undefined,
    cast: split(i.actors),
  };
}

async function scrape({ verbose = false } = {}) {
  const log = (...a) => verbose && console.log(...a);
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
    );
    await page.goto('https://vuniper.com/movies', { waitUntil: 'networkidle2', timeout: 60000 });

    const results = {};
    for (const row of ROWS) {
      try {
        const items = await page.evaluate(fetchRowInPage, row, MONTHS);
        const seen = new Set();
        results[row.id] = items.map((i) => toMeta(i, row)).filter((m) => m && !seen.has(m.id) && seen.add(m.id));
      } catch (e) {
        console.error(`[${row.name}] failed: ${e.message}`);
        results[row.id] = [];
      }
      log(`\n[${row.name}] ${results[row.id].length} titles`);
      results[row.id].slice(0, 5).forEach((m) => log(`   - ${m.name} (${m.releaseInfo})`));
    }
    return results;
  } finally {
    await browser.close();
  }
}

module.exports = { scrape, ROWS };
