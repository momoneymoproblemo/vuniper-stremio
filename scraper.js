// Opens Vuniper in headless Chrome and reads its own data feed from inside the page
// (the feed only answers requests coming from vuniper.com itself).
const puppeteer = require('puppeteer');

const API = 'https://api.vuniper.workers.dev/';

// Each row: Vuniper's first-page feed name, its "show more" section name, and how many extra pages to pull.
const ROWS = {
  'vuniper-now-online': { kvName: 'movies_web', section: 'web', extraPages: 3 },
  'vuniper-hidden-gems': { kvName: 'movies_gems', section: 'gems', extraPages: 3 },
};

function toMeta(i) {
  if (!i.imdb_id || !/^tt\d+$/.test(i.imdb_id)) return null;
  const score = i.score ? `Vuniper score ${i.score}%${i.reviews_count ? ` (${i.reviews_count} reviews)` : ''}. ` : '';
  return {
    id: i.imdb_id,
    type: 'movie',
    name: i.title,
    poster: `https://images.metahub.space/poster/medium/${i.imdb_id}/img`,
    background: `https://images.metahub.space/background/medium/${i.imdb_id}/img`,
    releaseInfo: String(i.year || ''),
    description: score + (i.description || ''),
    genres: i.genres ? String(i.genres).split(',').map((g) => g.trim()).filter(Boolean) : undefined,
    runtime: i.runtime || undefined,
    director: i.director ? [i.director] : undefined,
    cast: i.actors ? String(i.actors).split(',').map((a) => a.trim()).filter(Boolean) : undefined,
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
    for (const [id, row] of Object.entries(ROWS)) {
      const items = await page.evaluate(
        async (api, row) => {
          const get = async (qs) => JSON.parse(await (await fetch(api + '?' + qs)).text());
          const first = await get(`action=GET_MANY_ITEMS_KV&kvName=${row.kvName}`);
          let all = first.items || [];
          for (let p = 0; p < row.extraPages && all.length; p++) {
            const cursor = all[all.length - 1].web;
            if (!cursor) break;
            const next = await get(
              `action=GET_MANY_ITEMS&mediaType=movies&section=${row.section}&paginationCursor=${encodeURIComponent(cursor)}`
            );
            if (!next.items || !next.items.length) break;
            all = all.concat(next.items);
          }
          return all;
        },
        API,
        row
      );

      const seen = new Set();
      results[id] = items
        .map(toMeta)
        .filter((m) => m && !seen.has(m.id) && seen.add(m.id));
      log(`\n[${id}] ${results[id].length} films`);
      results[id].slice(0, 10).forEach((m) => log(`   - ${m.name} (${m.releaseInfo})`));
    }
    return results;
  } finally {
    await browser.close();
  }
}

module.exports = { scrape };
