const fetch = require('./src/fetcher/article-fetcher');
const filter = require('./src/fetcher/article-filter');
const BAD = /update_topic|strategic_intent|Generate a long|I am starting the generation/i;

(async () => {
  const arts = await fetch.fetchArticles({ type: 'fs', dir: './data/articles' });
  const good = filter.selectArticles(arts);
  let clean = 0, dirty = 0;
  const cleanList = [];
  for (const a of good) {
    if (BAD.test((a.content || '').slice(0, 600))) {
      dirty++;
    } else {
      clean++;
      cleanList.push(a);
    }
  }
  console.log('Clean:', clean, 'Dirty:', dirty, 'Total:', good.length);
  // Show first 5 clean articles
  for (const ca of cleanList.slice(0, 5)) {
    console.log('\n---', ca.title);
    console.log('First 200:', (ca.content || '').slice(0, 200));
  }
})();
