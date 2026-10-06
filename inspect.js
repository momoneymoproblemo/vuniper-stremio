// Run `npm run inspect` to see exactly what the scraper finds on Vuniper,
// before installing the add-on in Stremio.
const { scrape } = require('./scraper');

scrape({ verbose: true })
  .then(() => console.log('\nIf a section shows 0 titles, adjust its `label` / `jsonHint` in config.js.'))
  .catch((e) => {
    console.error('Inspect failed:', e);
    process.exit(1);
  });
