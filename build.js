// Pulls both Vuniper lists and writes a static Stremio add-on into docs/ (served by GitHub Pages).
const fs = require('fs');
const path = require('path');
const { scrape } = require('./scraper');

const OUT = path.join(__dirname, 'docs');

const ROWS = [
  { id: 'vuniper-now-online', name: 'Vuniper: Now Online' },
  { id: 'vuniper-hidden-gems', name: 'Vuniper: Hidden Gems' },
];

const manifest = {
  id: 'community.vuniper',
  version: '1.0.1',
  name: 'Vuniper',
  description: 'Movies just released to digital and hidden gems, as listed on vuniper.com. Updates every 6 hours.',
  resources: ['catalog'],
  types: ['movie'],
  idPrefixes: ['tt'],
  catalogs: ROWS.map((r) => ({ type: 'movie', id: r.id, name: r.name })),
};

function write(rel, data) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

(async () => {
  write('manifest.json', manifest);
  const results = await scrape({ verbose: true });
  let anyUpdated = false;

  for (const r of ROWS) {
    const metas = results[r.id] || [];
    console.log(`\n${r.name}: ${metas.length} films`);
    if (metas.length) {
      write(`catalog/movie/${r.id}.json`, { metas });
      anyUpdated = true;
    } else {
      console.log('  (nothing found — kept the previous list)');
    }
  }

  if (!anyUpdated) {
    console.error('\nNo films found for either row. Vuniper may have changed its feed.');
    process.exitCode = 1;
  }
})();
