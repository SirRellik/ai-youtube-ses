/**
 * thumbnail-generator.js - 1280x720 thumbnail (v2)
 * Pexels/article photo background + big Czech text + SES logo, brand colors.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { sourceSceneImage } = require('./visual-sourcer');

const TEMPLATE = fs.readFileSync(path.join(__dirname, 'templates', 'thumbnail-v2.html'), 'utf8');
const EMPTY_BG = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function generateThumbnail(screenplay, channel, cfg) {
  const cacheDir = cfg.cacheDir || './data/cache';
  const firstScene = screenplay.scenes && screenplay.scenes[0];
  const bgFile = await sourceSceneImage(
    { useArticleImage: true, pexels_query: (firstScene && firstScene.pexels_query) || 'solar energy' },
    screenplay.article, cacheDir, 1
  );
  const seo = screenplay.seo || {};
  const logoPath = path.resolve(channel.logo || '');
  const html = TEMPLATE
    .replace(/{{WIDTH}}/g, cfg.thumbnail.width).replace(/{{HEIGHT}}/g, cfg.thumbnail.height)
    .replace(/{{PRIMARY}}/g, channel.colors.primary).replace(/{{SECONDARY}}/g, channel.colors.secondary)
    .replace(/{{TEXT}}/g, channel.colors.text).replace(/{{BG_DARK}}/g, channel.colors.bgDark || '#04162e')
    .replace(/{{THUMB_TEXT}}/g, esc(seo.thumbnailText || String(screenplay.title).slice(0, 24).toUpperCase()))
    .replace(/{{TITLE}}/g, esc(String(screenplay.title).slice(0, 70)))
    .replace(/{{BG_IMAGE}}/g, bgFile ? `file://${path.resolve(bgFile)}` : EMPTY_BG)
    .replace(/{{LOGO_TAG}}/g, fs.existsSync(logoPath) ? `<img src="file://${logoPath}">` : '')
    .replace(/{{CHANNEL_NAME}}/g, esc(channel.name));

  fs.mkdirSync(cfg.outputDir, { recursive: true });
  const outFile = path.join(cfg.outputDir, `${screenplay.articleId}-thumb.png`);
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: cfg.thumbnail.width, height: cfg.thumbnail.height });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.screenshot({ path: outFile, type: 'png' });
  } finally {
    await browser.close();
  }
  console.log(`[Thumbnail] Done: ${outFile}`);
  return outFile;
}

module.exports = { generateThumbnail };
