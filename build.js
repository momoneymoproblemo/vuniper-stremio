// Scrapes Vuniper and writes a static Stremio add-on into docs/ (served by GitHub Pages).
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { scrape } = require('./scraper');
const { resolveAll } = require('./resolve');

const OUT = path.join(__dirname, 'docs');

const manifest = {
  id: 'community.vuniper',
  version: '1.0.0',
  name: 'Vuniper',
  description: 'Movies just released to digital and hidden gems, as listed on vuniper.com. Updates every 6 hours.',
  resources: ['catalog'],
  types: ['movie'],
  idPrefixes: ['tt'],
  catalogs: config.sections.map((s) => ({ type: 'movie', id: s.id, name: s.name })),
};

function write(rel, data) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

(async () => {
  write('manifest.json', manifest);
  const scraped = await scrape({ verbose: true });
  let anyUpdated = false;

  for (const s of config.sections) {
    const metas = await resolveAll(scraped[s.id] || []);
    const rel = `catalog/movie/${s.id}.json`;
    console.log(`\n${s.name}: ${scraped[s.id]?.length || 0} found on Vuniper, ${metas.length} matched to IMDb`);
    if (metas.length) {
      write(rel, { metas });
      anyUpdated = true;
    } else if (!fs.existsSync(path.join(OUT, rel))) {
      write(rel, { metas: [] });
      console.log('  (nothing found — wrote an empty list; check the log above)');
    } else {
      console.log('  (nothing found — kept the previous list)');
    }
  }

  if (!anyUpdated) {
    console.error('\nNo titles found for either row. Vuniper may have changed layout — see the log above.');
    process.exitCode = 1;
  }
})();
