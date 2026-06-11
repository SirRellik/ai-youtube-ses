/**
 * Test: generate 3 SES videos from real articles
 */
const fs = require('fs');
const path = require('path');
const { fetchArticles } = require('./src/fetcher/article-fetcher');
const { buildScreenplay } = require('./src/screenwriter/screenwriter');
const { generateVideo } = require('./src/generator/video-generator');

const channelCfg = JSON.parse(fs.readFileSync('./config/channels.json', 'utf8')).ses;
const defaultCfg = JSON.parse(fs.readFileSync('./config/default.json', 'utf8'));

async function main() {
  console.log('[TEST] Fetching SES articles...');
  const articles = await fetchArticles(channelCfg.source);
  console.log(`[TEST] Found ${articles.length} articles`);

  // Pick 3 articles with good content length (1000-15000 chars), diverse topics
  const good = articles
    .filter(a => a.content.length > 1000 && a.content.length < 15000 && a.title.length > 10)
    .sort(() => Math.random() - 0.5);

  const selected = good.slice(0, 3);
  console.log('[TEST] Selected articles:');
  selected.forEach((a, i) => console.log(`  ${i + 1}. ${a.title} (${a.content.length} chars)`));

  const outputDir = path.join(__dirname, 'data', 'test-videos');
  fs.mkdirSync(outputDir, { recursive: true });

  const cfg = {
    ...defaultCfg,
    outputDir,
    tempDir: '/tmp/ses-video-gen'
  };

  for (let i = 0; i < selected.length; i++) {
    const article = selected[i];
    console.log(`\n[TEST] === Video ${i + 1}/3: ${article.title.slice(0, 60)} ===`);

    try {
      const screenplay = buildScreenplay(article, channelCfg);
      console.log(`[TEST] Screenplay: ${screenplay.scenes.length} scenes`);

      const outFile = await generateVideo(screenplay, channelCfg, cfg);
      const stat = fs.statSync(outFile);
      console.log(`[TEST] Video generated: ${outFile} (${Math.round(stat.size / 1024)}KB)`);
    } catch (e) {
      console.log(`[TEST] FAILED: ${e.message}`);
    }
  }

  // List results
  console.log('\n[TEST] === RESULTS ===');
  const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.mp4'));
  for (const f of files) {
    const sz = fs.statSync(path.join(outputDir, f)).size;
    console.log(`  ${f} (${Math.round(sz / 1024)}KB)`);
  }
  console.log(`[TEST] Total: ${files.length} videos generated`);
}

main().catch(e => console.error('[TEST] FATAL:', e.message));
