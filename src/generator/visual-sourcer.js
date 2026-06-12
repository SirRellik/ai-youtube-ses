/**
 * visual-sourcer.js - scene background sourcing (v6)
 * Priority: 1) article's own image URL  2) AI-generated image (scene.image_prompt)
 * 3) Pexels API search  4) Pexels hardcoded pools
 * Downloads are cached under cacheDir/images/, AI images under cacheDir/ai-images/
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { generateAiImage } = require('./ai-image-generator');

const CRED_PATH = '/opt/nyx/nyx-neural-data/credentials.json';
let PEXELS_KEY;

function pexelsKey() {
  if (PEXELS_KEY === undefined) {
    try {
      const creds = JSON.parse(fs.readFileSync(CRED_PATH, 'utf8'));
      PEXELS_KEY = (creds.pexels && creds.pexels.apiKey) || (creds.PEXELS_API_KEY) || null;
    } catch { PEXELS_KEY = null; }
  }
  return PEXELS_KEY;
}

function md5(s) { return crypto.createHash('md5').update(String(s)).digest('hex'); }

// Hardcoded CC0 Pexels pools by topic (fallback when no API key)
const PEXELS_POOLS = {
  'solar panels house roof': [
    'https://images.pexels.com/photos/2800832/pexels-photo-2800832.jpeg?auto=compress&cs=tinysrgb&w=1280',
    'https://images.pexels.com/photos/9875441/pexels-photo-9875441.jpeg?auto=compress&cs=tinysrgb&w=1280',
    'https://images.pexels.com/photos/2102416/pexels-photo-2102416.jpeg?auto=compress&cs=tinysrgb&w=1280',
    'https://images.pexels.com/photos/8853502/pexels-photo-8853502.jpeg?auto=compress&cs=tinysrgb&w=1280',
    'https://images.pexels.com/photos/1036936/pexels-photo-1036936.jpeg?auto=compress&cs=tinysrgb&w=1280',
  ],
  'home battery energy storage': [
    'https://images.pexels.com/photos/3862130/pexels-photo-3862130.jpeg?auto=compress&cs=tinysrgb&w=1280',
    'https://images.pexels.com/photos/9875388/pexels-photo-9875388.jpeg?auto=compress&cs=tinysrgb&w=1280',
    'https://images.pexels.com/photos/2800832/pexels-photo-2800832.jpeg?auto=compress&cs=tinysrgb&w=1280',
  ],
  'modern houses neighborhood solar aerial': [
    'https://images.pexels.com/photos/1396122/pexels-photo-1396122.jpeg?auto=compress&cs=tinysrgb&w=1280',
    'https://images.pexels.com/photos/2102416/pexels-photo-2102416.jpeg?auto=compress&cs=tinysrgb&w=1280',
    'https://images.pexels.com/photos/1546168/pexels-photo-1546168.jpeg?auto=compress&cs=tinysrgb&w=1280',
  ],
  'electric car charging home': [
    'https://images.pexels.com/photos/3846205/pexels-photo-3846205.jpeg?auto=compress&cs=tinysrgb&w=1280',
    'https://images.pexels.com/photos/3862130/pexels-photo-3862130.jpeg?auto=compress&cs=tinysrgb&w=1280',
  ],
  'electricity grid power lines sunset': [
    'https://images.pexels.com/photos/532192/pexels-photo-532192.jpeg?auto=compress&cs=tinysrgb&w=1280',
    'https://images.pexels.com/photos/1624712/pexels-photo-1624712.jpeg?auto=compress&cs=tinysrgb&w=1280',
    'https://images.pexels.com/photos/2539462/pexels-photo-2539462.jpeg?auto=compress&cs=tinysrgb&w=1280',
  ],
  'family home finances calculator': [
    'https://images.pexels.com/photos/4386292/pexels-photo-4386292.jpeg?auto=compress&cs=tinysrgb&w=1280',
    'https://images.pexels.com/photos/3943716/pexels-photo-3943716.jpeg?auto=compress&cs=tinysrgb&w=1280',
    'https://images.pexels.com/photos/4475523/pexels-photo-4475523.jpeg?auto=compress&cs=tinysrgb&w=1280',
  ],
  'renewable energy modern home': [
    'https://images.pexels.com/photos/2800832/pexels-photo-2800832.jpeg?auto=compress&cs=tinysrgb&w=1280',
    'https://images.pexels.com/photos/1036936/pexels-photo-1036936.jpeg?auto=compress&cs=tinysrgb&w=1280',
    'https://images.pexels.com/photos/2102416/pexels-photo-2102416.jpeg?auto=compress&cs=tinysrgb&w=1280',
    'https://images.pexels.com/photos/1624712/pexels-photo-1624712.jpeg?auto=compress&cs=tinysrgb&w=1280',
    'https://images.pexels.com/photos/9875441/pexels-photo-9875441.jpeg?auto=compress&cs=tinysrgb&w=1280',
  ],
  'wind turbines countryside': [
    'https://images.pexels.com/photos/532192/pexels-photo-532192.jpeg?auto=compress&cs=tinysrgb&w=1280',
    'https://images.pexels.com/photos/1624712/pexels-photo-1624712.jpeg?auto=compress&cs=tinysrgb&w=1280',
  ],
  'heat pump modern house': [
    'https://images.pexels.com/photos/1396122/pexels-photo-1396122.jpeg?auto=compress&cs=tinysrgb&w=1280',
    'https://images.pexels.com/photos/2800832/pexels-photo-2800832.jpeg?auto=compress&cs=tinysrgb&w=1280',
  ]
};

function downloadFile(url, dest, depth) {
  return new Promise((resolve, reject) => {
    if ((depth || 0) > 4) return reject(new Error('too many redirects'));
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: 30000, headers: { 'User-Agent': 'ai-youtube-ses/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(downloadFile(res.headers.location, dest, (depth || 0) + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const ws = fs.createWriteStream(dest);
      res.pipe(ws);
      ws.on('finish', () => ws.close(resolve));
      ws.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function httpGetJson(url, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs || 20000, headers: { 'User-Agent': 'ai-youtube-ses/1.0', ...headers } }, (res) => {
      if (res.statusCode >= 300) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
  });
}

async function fetchImage(url, cacheDir) {
  const dest = path.join(cacheDir, 'images', md5(url) + '.jpg');
  if (fs.existsSync(dest) && fs.statSync(dest).size > 5000) return dest;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    await downloadFile(url, dest);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 5000) {
      console.log('[Visuals] Downloaded:', url.slice(0, 80));
      return dest;
    }
  } catch (e) {
    console.log('[Visuals] Download failed:', e.message.slice(0, 80));
  }
  try { fs.unlinkSync(dest); } catch {}
  return null;
}

async function searchPexelsApi(query, cacheDir) {
  const key = pexelsKey();
  if (!key) return [];
  try {
    const url = 'https://api.pexels.com/v1/search?query=' + encodeURIComponent(query) + '&per_page=5&orientation=landscape';
    const data = await httpGetJson(url, { Authorization: key });
    return (data.photos || []).map(p => p.src && (p.src.landscape || p.src.large2x || p.src.original)).filter(Boolean);
  } catch { return []; }
}

async function sourceSceneImage(scene, article, cacheDir, sceneIndex) {
  const idx = sceneIndex || 0;

  // 1. Article's own image (first scene gets priority)
  if (scene.useArticleImage && article && article.image && /^https?:/.test(article.image)) {
    const f = await fetchImage(article.image, cacheDir);
    if (f) return f;
  }

  // 2. AI-generated image specific to the scene (Gemini/xAI/Pollinations)
  if (scene.image_prompt) {
    try {
      const f = await generateAiImage(scene.image_prompt, cacheDir);
      if (f) return f;
    } catch (e) {
      console.log('[Visuals] AI image failed:', String(e.message).slice(0, 80));
    }
  }

  // 3. Pexels API search
  if (scene.pexels_query) {
    const apiResults = await searchPexelsApi(scene.pexels_query, cacheDir);
    if (apiResults.length) {
      const pick = apiResults[idx % apiResults.length];
      const f = await fetchImage(pick, cacheDir);
      if (f) return f;
    }
  }

  // 4. Hardcoded Pexels pools (always works, no API key needed)
  const query = scene.pexels_query || 'renewable energy modern home';
  const pool = PEXELS_POOLS[query] || PEXELS_POOLS['renewable energy modern home'];
  if (pool && pool.length) {
    const pick = pool[idx % pool.length];
    const f = await fetchImage(pick, cacheDir);
    if (f) return f;
  }

  // 5. Try article image as last resort
  if (article && article.image && /^https?:/.test(article.image)) {
    const f = await fetchImage(article.image, cacheDir);
    if (f) return f;
  }

  console.log('[Visuals] No image found for scene ' + idx + ', using CSS-only');
  return null;
}

module.exports = { searchPexelsApi, fetchImage, sourceSceneImage };
