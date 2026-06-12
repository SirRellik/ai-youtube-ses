/**
 * ai-image-generator.js - AI-generated scene backgrounds (v6)
 * Takes a scene's image_prompt and tries providers in order:
 *   1) Google Gemini image models (key: GEMINI_API_KEY env or llm-hub.json)
 *   2) xAI grok-2-image (key: XAI_API_KEY env, credentials.json, or grok CLI token)
 *   3) Pollinations.ai (keyless, best-effort)
 * Results are normalized to 1920x1080 JPEG and cached under cacheDir/ai-images/
 * by prompt hash. Returns null when every provider fails - callers fall back
 * to Pexels via visual-sourcer.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { execFile } = require('child_process');

const LLM_HUB_PATH = '/opt/nyx/nyx-neural-data/llm-hub.json';
const CRED_PATH = '/opt/nyx/nyx-neural-data/credentials.json';
const GROK_AUTH_PATH = path.join(process.env.HOME || '/root', '.grok', 'auth.json');
const GEMINI_MODELS = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image'];
const OUT_W = 1920, OUT_H = 1080;

// Providers that returned quota/billing errors are skipped for the rest of
// the process so a 10-scene video does not hammer a dead endpoint 10 times.
const disabledProviders = new Set();

function sha1(s) { return crypto.createHash('sha1').update(String(s)).digest('hex'); }

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function geminiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const hub = readJsonSafe(LLM_HUB_PATH);
  return (hub && hub.config && hub.config.gemini && hub.config.gemini.apiKey) || null;
}

function xaiKey() {
  if (process.env.XAI_API_KEY) return process.env.XAI_API_KEY;
  const creds = readJsonSafe(CRED_PATH);
  for (const k of ['xai', 'grok']) {
    const c = creds && creds[k];
    if (c) return c.apiKey || c.key || (typeof c === 'string' ? c : null);
  }
  // grok CLI session token authenticates against api.x.ai as a Bearer token
  const auth = readJsonSafe(GROK_AUTH_PATH);
  if (auth) {
    for (const v of Object.values(auth)) {
      try {
        const inner = typeof v === 'string' ? JSON.parse(v) : v;
        if (inner && inner.key) return inner.key;
      } catch { /* not this entry */ }
    }
  }
  return null;
}

function httpRequest(method, url, { headers, body, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      method, hostname: u.hostname, path: u.pathname + u.search,
      headers: { 'User-Agent': 'ai-youtube-ses/1.0', ...headers },
      timeout: timeoutMs || 90000
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function isQuotaError(status, text) {
  return status === 402 || status === 429 || /quota|billing|credit|spending-limit|paid plan/i.test(text || '');
}

async function tryGemini(prompt) {
  const key = geminiKey();
  if (!key) return null;
  for (const model of GEMINI_MODELS) {
    const res = await httpRequest('POST',
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['IMAGE'] }
        })
      });
    const text = res.body.toString('utf8');
    if (res.status !== 200) {
      if (isQuotaError(res.status, text)) throw Object.assign(new Error(`gemini quota (HTTP ${res.status})`), { quota: true });
      continue;
    }
    const data = JSON.parse(text);
    const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
    const img = parts.find((p) => p.inlineData && p.inlineData.data);
    if (img) return Buffer.from(img.inlineData.data, 'base64');
  }
  return null;
}

async function tryXai(prompt) {
  const key = xaiKey();
  if (!key) return null;
  const res = await httpRequest('POST', 'https://api.x.ai/v1/images/generations', {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: 'grok-2-image', prompt, response_format: 'b64_json' })
  });
  const text = res.body.toString('utf8');
  if (res.status !== 200) {
    if (isQuotaError(res.status, text)) throw Object.assign(new Error(`xai quota (HTTP ${res.status})`), { quota: true });
    return null;
  }
  const data = JSON.parse(text);
  const b64 = data.data && data.data[0] && data.data[0].b64_json;
  return b64 ? Buffer.from(b64, 'base64') : null;
}

async function tryPollinations(prompt) {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${OUT_W}&height=${OUT_H}&nologo=true`;
  const res = await httpRequest('GET', url, { timeoutMs: 120000 });
  if (res.status !== 200) {
    if (isQuotaError(res.status, '')) throw Object.assign(new Error(`pollinations HTTP ${res.status}`), { quota: true });
    return null;
  }
  return res.body.length > 10000 ? res.body : null;
}

const PROVIDERS = [
  ['gemini', tryGemini],
  ['xai', tryXai],
  ['pollinations', tryPollinations]
];

function normalizeJpeg(rawFile, outFile) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', ['-y', '-i', rawFile,
      '-vf', `scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,crop=${OUT_W}:${OUT_H}`,
      '-frames:v', '1', '-q:v', '2', outFile
    ], { timeout: 60000 }, (err, so, se) => {
      if (err) return reject(new Error(`normalize failed: ${String(se).slice(-300)}`));
      resolve(outFile);
    });
  });
}

/**
 * Generate (or load cached) AI image for a prompt. Returns absolute path to a
 * 1920x1080 JPEG, or null when no provider could produce an image.
 */
async function generateAiImage(prompt, cacheDir) {
  if (!prompt || process.env.AI_IMAGES === 'off') return null;
  const dir = path.join(cacheDir, 'ai-images');
  const outFile = path.join(dir, sha1(prompt) + '.jpg');
  if (fs.existsSync(outFile) && fs.statSync(outFile).size > 10000) return outFile;
  fs.mkdirSync(dir, { recursive: true });

  for (const [name, fn] of PROVIDERS) {
    if (disabledProviders.has(name)) continue;
    try {
      const buf = await fn(prompt);
      if (buf && buf.length > 10000) {
        const rawFile = outFile + '.raw';
        fs.writeFileSync(rawFile, buf);
        try {
          await normalizeJpeg(rawFile, outFile);
        } finally {
          try { fs.unlinkSync(rawFile); } catch { /* ignore */ }
        }
        if (fs.existsSync(outFile) && fs.statSync(outFile).size > 10000) {
          console.log(`[AI-Image] Generated via ${name}: ${prompt.slice(0, 70)}...`);
          return outFile;
        }
      }
    } catch (e) {
      if (e.quota) {
        disabledProviders.add(name);
        console.log(`[AI-Image] ${name} disabled for this run: ${e.message}`);
      } else {
        console.log(`[AI-Image] ${name} failed: ${String(e.message).slice(0, 100)}`);
      }
    }
  }
  return null;
}

module.exports = { generateAiImage };
