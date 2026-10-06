// Turns a Vuniper title (+ year) into a Stremio meta with an IMDb id, using Cinemeta's public search.
// Stremio needs IMDb ids so your other add-ons and the detail page work as normal.
const cache = new Map();

const norm = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');

async function cinemeta(path) {
  const res = await fetch(`https://v3-cinemeta.strem.io/${path}`);
  if (!res.ok) throw new Error(`Cinemeta ${res.status}`);
  return res.json();
}

async function resolve({ title, year, imdb }) {
  const key = `${title}|${year || ''}|${imdb || ''}`;
  if (cache.has(key)) return cache.get(key);

  let meta = null;
  try {
    if (imdb) {
      const { meta: m } = await cinemeta(`meta/movie/${imdb}.json`);
      meta = m;
    } else {
      const { metas = [] } = await cinemeta(`catalog/movie/top/search=${encodeURIComponent(title)}.json`);
      const yearOf = (m) => Number(String(m.releaseInfo || m.year || '').slice(0, 4)) || null;
      meta =
        metas.find((m) => norm(m.name) === norm(title) && year && Math.abs(yearOf(m) - year) <= 1) ||
        metas.find((m) => norm(m.name) === norm(title)) ||
        (year ? metas.find((m) => Math.abs(yearOf(m) - year) <= 1) : null) ||
        metas[0] ||
        null;
    }
  } catch (e) {
    console.warn(`Lookup failed for "${title}": ${e.message}`);
  }

  const out = meta && meta.id
    ? {
        id: meta.id,
        type: 'movie',
        name: meta.name,
        poster: meta.poster,
        background: meta.background,
        releaseInfo: meta.releaseInfo,
        imdbRating: meta.imdbRating,
        description: meta.description,
      }
    : null;
  cache.set(key, out);
  return out;
}

async function resolveAll(items) {
  const metas = [];
  const seen = new Set();
  // Small batches to stay polite to Cinemeta.
  for (let i = 0; i < items.length; i += 5) {
    const batch = await Promise.all(items.slice(i, i + 5).map(resolve));
    for (const m of batch) if (m && !seen.has(m.id)) { seen.add(m.id); metas.push(m); }
  }
  return metas;
}

module.exports = { resolveAll };
