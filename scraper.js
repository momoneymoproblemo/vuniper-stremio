// Loads Vuniper in headless Chrome and pulls titles for each configured section.
// Strategy 1: sniff the site's own JSON API responses (most reliable for a JS app).
// Strategy 2: fall back to the rendered page — find the section heading/tab and read its cards.
const puppeteer = require('puppeteer');
const config = require('./config');

const TITLE_KEYS = ['title', 'name', 'original_title', 'movie_title'];

function pickTitle(o) {
  for (const k of TITLE_KEYS) if (typeof o[k] === 'string' && o[k].trim()) return o[k].trim();
  return null;
}

function pickYear(o) {
  const raw = o.year || o.release_year || o.release_date || o.releaseDate || o.date || '';
  const m = String(raw).match(/(19|20)\d{2}/);
  return m ? Number(m[0]) : null;
}

function pickImdb(o) {
  const v = o.imdb_id || o.imdbId || o.imdb || '';
  const m = String(v).match(/tt\d{5,}/);
  return m ? m[0] : null;
}

// Walk a JSON blob and return every array that looks like a list of movies, with the path to it.
function findMovieArrays(node, path = '', out = []) {
  if (Array.isArray(node)) {
    const objs = node.filter((x) => x && typeof x === 'object' && !Array.isArray(x));
    const titled = objs.filter(pickTitle);
    if (titled.length >= 3 && titled.length >= objs.length * 0.6) {
      out.push({
        path,
        items: titled.map((o) => ({ title: pickTitle(o), year: pickYear(o), imdb: pickImdb(o) })),
      });
    }
    node.forEach((x, i) => findMovieArrays(x, `${path}[${i}]`, out));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) findMovieArrays(v, path ? `${path}.${k}` : k, out);
  }
  return out;
}

// Runs inside the page: find a heading/tab matching `labelSrc`, click it if it's a tab,
// then return titles from the nearest container holding several movie cards.
function domExtract(labelSrc, labelFlags) {
  const label = new RegExp(labelSrc, labelFlags);
  const candidates = [...document.querySelectorAll('h1,h2,h3,h4,h5,button,a,[role=tab],span,div,p')]
    .filter((el) => el.children.length <= 2 && label.test((el.textContent || '').trim()))
    .sort((a, b) => a.textContent.length - b.textContent.length);
  const heading = candidates[0];
  if (!heading) return { found: false, items: [] };

  const isTab = heading.matches('button,[role=tab],a') && !heading.getAttribute('href')?.startsWith('http');
  return { found: true, isTab, text: heading.textContent.trim() };
}

function domCards(labelSrc, labelFlags) {
  const label = new RegExp(labelSrc, labelFlags);
  const heading = [...document.querySelectorAll('h1,h2,h3,h4,h5,button,a,[role=tab],span,div,p')]
    .filter((el) => el.children.length <= 2 && label.test((el.textContent || '').trim()))
    .sort((a, b) => a.textContent.length - b.textContent.length)[0];

  // Climb from the heading until we reach a container with several poster images.
  let box = heading || document.body;
  while (box && box !== document.body && box.querySelectorAll('img').length < 4) box = box.parentElement;
  if (!box) box = document.body;

  const seen = new Set();
  const items = [];
  for (const img of box.querySelectorAll('img')) {
    const card = img.closest('a,li,article,[class*=card],[class*=item],[class*=movie]') || img.parentElement;
    let title = (img.getAttribute('alt') || '').trim();
    if (!title || /poster|logo|image|icon/i.test(title)) {
      const t = card && card.querySelector('h2,h3,h4,h5,[class*=title],p,span');
      title = t ? t.textContent.trim() : '';
    }
    if (!title || title.length > 120 || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    const yearMatch = (card ? card.textContent : '').match(/\b(19|20)\d{2}\b/);
    items.push({ title, year: yearMatch ? Number(yearMatch[0]) : null, imdb: null });
  }
  return items;
}

async function scrape({ verbose = false } = {}) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const log = (...a) => verbose && console.log(...a);
  const jsonResponses = [];

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
    );
    page.on('response', async (res) => {
      const type = res.headers()['content-type'] || '';
      if (!type.includes('json')) return;
      try {
        jsonResponses.push({ url: res.url(), body: await res.json() });
      } catch (_) {}
    });

    await page.goto(config.pageUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    // Scroll to trigger lazy-loaded sections.
    for (let i = 0; i < 8; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await new Promise((r) => setTimeout(r, 600));
    }

    log(`\nCaptured ${jsonResponses.length} JSON responses:`);
    const arrays = [];
    for (const r of jsonResponses) {
      const found = findMovieArrays(r.body);
      found.forEach((f) => arrays.push({ ...f, url: r.url }));
      log(`  ${r.url}  →  ${found.length} movie-like list(s)`);
      found.forEach((f) => log(`      ${f.path || '(root)'}: ${f.items.length} items, e.g. ${f.items.slice(0, 3).map((x) => x.title).join(' | ')}`));
    }

    const results = {};
    for (const section of config.sections) {
      // 1) JSON match: URL or path mentions the section's keywords.
      const jsonHit = arrays
        .filter((a) => section.jsonHint.test(a.url) || section.jsonHint.test(a.path))
        .sort((a, b) => b.items.length - a.items.length)[0];

      let items = [];
      let source = '';
      if (jsonHit) {
        items = jsonHit.items;
        source = `json ${jsonHit.url} ${jsonHit.path}`;
      } else {
        // 2) DOM: if the label is a tab/button, click it first, then read the cards near it.
        const info = await page.evaluate(domExtract, section.label.source, section.label.flags);
        if (info.found) {
          if (info.isTab) {
            const before = jsonResponses.length;
            await page.evaluate((src, flags) => {
              const label = new RegExp(src, flags);
              const el = [...document.querySelectorAll('button,a,[role=tab],span,div')]
                .filter((e) => e.children.length <= 2 && label.test((e.textContent || '').trim()))
                .sort((a, b) => a.textContent.length - b.textContent.length)[0];
              el && el.click();
            }, section.label.source, section.label.flags);
            await new Promise((r) => setTimeout(r, 2500));
            // A tab click may have fetched fresh JSON — prefer that.
            const fresh = jsonResponses.slice(before).flatMap((r) => findMovieArrays(r.body).map((f) => ({ ...f, url: r.url })));
            if (fresh.length) {
              const best = fresh.sort((a, b) => b.items.length - a.items.length)[0];
              items = best.items;
              source = `json after clicking "${info.text}" ${best.url}`;
            }
          }
          if (!items.length) {
            items = await page.evaluate(domCards, section.label.source, section.label.flags);
            source = `page cards near "${info.text}"`;
          }
        }
      }

      results[section.id] = items.slice(0, config.maxItems);
      log(`\n[${section.name}] ${results[section.id].length} titles via ${source || 'nothing found'}`);
      results[section.id].slice(0, 10).forEach((m) => log(`   - ${m.title}${m.year ? ` (${m.year})` : ''}`));
    }
    return results;
  } finally {
    await browser.close();
  }
}

module.exports = { scrape };
