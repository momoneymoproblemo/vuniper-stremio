// Pulls every Vuniper list and writes a static Stremio add-on into docs/ (served by GitHub Pages).
const fs = require('fs');
const path = require('path');
const { scrape, ROWS } = require('./scraper');

const OUT = path.join(__dirname, 'docs');
const BASE = 'https://momoneymoproblemo.github.io/vuniper-stremio';
const PAGE_SIZE = 100; // Stremio asks for more with ?skip=100, 200...

const manifest = {
  id: 'community.vuniper',
  version: '2.0.0',
  name: 'Vuniper',
  description:
    'New movies and shows as tracked by vuniper.com: now online, hidden gems, upcoming, in theaters, popular and new on Blu-ray, plus new, upcoming and popular shows. Unofficial; updates every 6 hours.',
  logo: `${BASE}/logo.png`,
  background: `${BASE}/background.png`,
  resources: ['catalog'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  catalogs: ROWS.map((r) => ({ type: r.type, id: r.id, name: r.name, extra: [{ name: 'skip', isRequired: false }] })),
};

function write(rel, data) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

(async () => {
  write('manifest.json', manifest);
  const results = await scrape({ verbose: true });
  let updated = 0;

  for (const r of ROWS) {
    const metas = results[r.id] || [];
    console.log(`${r.name}: ${metas.length}`);
    if (!metas.length) {
      console.log('  (nothing found — kept the previous list)');
      continue;
    }
    const dir = `catalog/${r.type}/${r.id}`;
    // Clear old pages so a shorter list doesn't leave stale extras behind.
    fs.rmSync(path.join(OUT, dir), { recursive: true, force: true });
    write(`${dir}.json`, { metas: metas.slice(0, PAGE_SIZE) });
    for (let skip = PAGE_SIZE; skip < metas.length; skip += PAGE_SIZE) {
      write(`${dir}/skip=${skip}.json`, { metas: metas.slice(skip, skip + PAGE_SIZE) });
    }
    updated++;
  }

  if (!updated) {
    console.error('\nNo titles found for any row. Vuniper may have changed its feed.');
    process.exitCode = 1;
  }
})();
