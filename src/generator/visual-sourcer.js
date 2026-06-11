/**
 * visual-sourcer.js - real photo sourcing for scenes
 * Priority: 1) article's own Pexels image  2) Pexels API search (CC0)
 * 3) caller falls back to pure HTML/CSS visuals when this returns null.
 * Search results and downloads are cached under cfg.cacheDir.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const CRED_PATH = '/opt/nyx/nyx-neural-data/credentials.json';
let PEXELS_KEY;

function pexelsKey() {
  if (PEXELS_KEY === undefined) {
    try { PEXELS_KEY = JSON.parse(fs.readFileSync(CRED_PATH, 'utf8')).pexels.apiKey || null; }
    catch (e) { console.log('[Visuals] No Pexels API key available'); PEXELS_KEY = null; }
  }
  return PEXELS_KEY;
}

function md5(s) { return crypto.createHash('md5').update(String(s)).digest('hex'); }

function httpGetJson(url, headers = {}, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'ai-youtube-ses/1.0', ...headers } }, (res) => {
      if (res.statusCode >= 300) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function downloadFile(url, dest, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 3) return reject(new Error('too many redirects'));
    const req = https.get(url, { timeout: 30000, headers: { 'User-Agent': 'ai-youtube-ses/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(downloadFile(res.headers.location, dest, depth + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const ws = fs.createWriteStream(dest);
      res.pipe(ws);
      ws.on('finish', () => ws.close(resolve));
      ws.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function searchPexels(query, cacheDir) {
  const key = pexelsKey();
  if (!key) return [];
  const cacheFile = path.join(cacheDir, 'pexels', `${md5(query)}.json`);
  if (fs.existsSync(cacheFile)) {
    try { return JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (e) { /* refetch */ }
  }
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape&locale=cs-CZ`;
  const data = await httpGetJson(url, { Authorization: key });
  const photos = (data.photos || [])
    .map((p) => ({ id: p.id, url: p.src && (p.src.landscape || p.src.large2x || p.src.original) }))
    .filter((p) => p.url);
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(photos, null, 2));
  return photos;
}

async function fetchImage(url, cacheDir) {
  const dest = path.join(cacheDir, 'images', `${md5(url)}.jpg`);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 10000) return dest;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await downloadFile(url, dest);
  if (!fs.existsSync(dest) || fs.statSync(dest).size < 10000) {
    fs.rmSync(dest, { force: true });
    return null;
  }
  return dest;
}

async function sourceSceneImage(scene, article, cacheDir, sceneIndex = 0) {
  try {
    if (scene.useArticleImage && article && article.image && /^https?:/.test(article.image)) {
      const f = await fetchImage(article.image, cacheDir);
      if (f) return f;
    }
    if (scene.pexels_query) {
      const photos = await searchPexels(scene.pexels_query, cacheDir);
      if (photos.length) {
        const pick = photos[sceneIndex % photos.length];
        const f = await fetchImage(pick.url, cacheDir);
        if (f) return f;
      }
    }
  } catch (e) {
    console.log(`[Visuals] Image sourcing failed (${String(e.message).slice(0, 120)}), using CSS-only visual`);
  }
  return null;
}

module.exports = { searchPexels, fetchImage, sourceSceneImage };
