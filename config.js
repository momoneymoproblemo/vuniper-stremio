// Edit these if Vuniper labels or URLs differ from what the scraper expects.
// Run `npm run inspect` to see what the scraper actually finds.
module.exports = {
  pageUrl: process.env.VUNIPER_URL || 'https://vuniper.com/movies',

  sections: [
    {
      id: 'vuniper-now-online',
      name: 'Vuniper: Now Online',
      // Text of the heading/tab on the page, and keywords to match in the site's JSON
      label: /now\s*online|just\s*released|available\s*now|digital/i,
      jsonHint: /online|digital|released|latest|new/i,
    },
    {
      id: 'vuniper-hidden-gems',
      name: 'Vuniper: Hidden Gems',
      label: /hidden\s*gems?/i,
      jsonHint: /gem|hidden/i,
    },
  ],

  refreshHours: Number(process.env.REFRESH_HOURS || 6),
  maxItems: 100,
  port: Number(process.env.PORT || 7000),
};
