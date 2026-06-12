/**
 * narrator-v2.js - Premium Czech TTS via Gemini native TTS models
 *
 * Quality: NotebookLM-grade neural speech with natural intonation, far above
 * edge-tts. Czech (and 20+ other languages) supported with full diacritics.
 *
 * Key resolution (same chain as ai-image-generator.js):
 *   GEMINI_API_KEY env -> /opt/nyx/nyx-neural-data/llm-hub.json config.gemini.apiKey
 *
 * Voice param semantics (channel.voices values keep working unchanged):
 *   'gemini:Sulafat'      -> explicit Gemini prebuilt voice
 *   'Charon' / 'Kore' ... -> bare Gemini voice name
 *   'cs-CZ-VlastaNeural'  -> edge-tts id: ignored here, GEMINI_TTS_VOICE env
 *                            or DEFAULT_VOICE is used instead (the edge id is
 *                            still what the edge-tts fallback receives)
 *
 * Env overrides: GEMINI_TTS_MODEL, GEMINI_TTS_VOICE, GEMINI_TTS_STYLE
 *
 * Free tier is rate-limited (requests/min + requests/day). 429s are retried
 * with the server-suggested delay; when the daily quota is gone the module
 * disables itself for QUOTA_COOLDOWN_MS so callers fall back to edge-tts
 * without hammering a dead endpoint once per scene.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');
const { sanitizeForSpeech, getAudioDuration } = require('./narrator');

const LLM_HUB_PATH = '/opt/nyx/nyx-neural-data/llm-hub.json';
// Both are preview TTS models; tried in order until one succeeds.
const MODELS = ['gemini-2.5-flash-preview-tts', 'gemini-3.1-flash-tts-preview'];
const DEFAULT_VOICE = 'Charon'; // informative narrator; Sulafat=warm, Kore=firm female
const DEFAULT_STYLE =
  'Přečti následující text jako zkušený český moderátor dokumentárního pořadu - ' +
  'přirozeně, srozumitelně, v klidném tempu a se zaujetím:';
const MAX_CHUNK_CHARS = 3500;   // scenes are far shorter; safety net for long texts
const MIN_REQUEST_GAP_MS = 1500;
const QUOTA_COOLDOWN_MS = 15 * 60 * 1000;

let lastRequestAt = 0;
let disabledUntil = 0;

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function geminiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const hub = readJsonSafe(LLM_HUB_PATH);
  return (hub && hub.config && hub.config.gemini && hub.config.gemini.apiKey) || null;
}

function resolveVoice(voice) {
  const v = String(voice || '');
  if (v.startsWith('gemini:')) return v.slice(7);
  if (/^[A-Z][a-z]+$/.test(v)) return v; // bare Gemini voice name
  return process.env.GEMINI_TTS_VOICE || DEFAULT_VOICE;
}

function postJson(url, body, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: timeoutMs
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
    req.end(data);
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// "21s" / "3.5s" in error details -> ms; null when absent
function suggestedRetryMs(errJson) {
  try {
    for (const d of errJson.error.details || []) {
      if (d.retryDelay) return Math.ceil(parseFloat(d.retryDelay) * 1000);
    }
  } catch { /* no structured details */ }
  return null;
}

function splitChunks(text) {
  if (text.length <= MAX_CHUNK_CHARS) return [text];
  const chunks = [];
  let buf = '';
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (buf && buf.length + sentence.length + 1 > MAX_CHUNK_CHARS) { chunks.push(buf); buf = ''; }
    buf = buf ? buf + ' ' + sentence : sentence;
  }
  if (buf) chunks.push(buf);
  return chunks;
}

/** One TTS request -> raw PCM Buffer (s16le mono) + sample rate. */
async function requestPcm(key, model, voiceName, text) {
  const style = process.env.GEMINI_TTS_STYLE || DEFAULT_STYLE;
  const body = {
    contents: [{ parts: [{ text: `${style}\n\n${text}` }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } }
    }
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  for (let attempt = 1; attempt <= 4; attempt++) {
    const gap = lastRequestAt + MIN_REQUEST_GAP_MS - Date.now();
    if (gap > 0) await sleep(gap);
    lastRequestAt = Date.now();

    const res = await postJson(url, body);
    if (res.status === 200) {
      let json;
      try { json = JSON.parse(res.body); } catch { throw new Error('gemini-tts: bad JSON response'); }
      const part = json.candidates && json.candidates[0] &&
        json.candidates[0].content && json.candidates[0].content.parts &&
        json.candidates[0].content.parts.find((p) => p.inlineData);
      if (!part) throw new Error('gemini-tts: no audio in response (blocked or empty)');
      const rateMatch = /rate=(\d+)/.exec(part.inlineData.mimeType || '');
      return {
        pcm: Buffer.from(part.inlineData.data, 'base64'),
        rate: rateMatch ? parseInt(rateMatch[1], 10) : 24000
      };
    }

    let errJson = null;
    try { errJson = JSON.parse(res.body); } catch { /* non-JSON error body */ }
    const msg = (errJson && errJson.error && errJson.error.message) || res.body.slice(0, 200);

    if (res.status === 429) {
      const wait = suggestedRetryMs(errJson);
      // Daily quota exhausted (or a wait longer than a video is worth):
      // disable the module and let the caller fall back to edge-tts.
      if (/PerDay/i.test(JSON.stringify(errJson || msg)) || (wait && wait > 60000)) {
        disabledUntil = Date.now() + QUOTA_COOLDOWN_MS;
        throw new Error(`gemini-tts quota exhausted: ${msg}`);
      }
      if (attempt < 4) { await sleep(wait || attempt * 8000); continue; }
    } else if (res.status >= 500 && attempt < 4) {
      await sleep(attempt * 3000);
      continue;
    }
    throw new Error(`gemini-tts HTTP ${res.status}: ${msg}`);
  }
  throw new Error('gemini-tts: retries exhausted');
}

function pcmToMp3(pcmFile, rate, outFile) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', ['-y', '-f', 's16le', '-ar', String(rate), '-ac', '1',
      '-i', pcmFile, '-b:a', '128k', outFile],
    { timeout: 120000 }, (err, _so, stderr) => {
      if (err) return reject(new Error(`ffmpeg pcm->mp3 failed: ${stderr || err.message}`));
      resolve();
    });
  });
}

async function synthesize(text, voice, outFile) {
  if (Date.now() < disabledUntil) {
    throw new Error('gemini-tts disabled (quota cooldown)');
  }
  const key = geminiKey();
  if (!key) throw new Error('gemini-tts: no GEMINI_API_KEY available');

  const clean = sanitizeForSpeech(text);
  if (!clean || clean.length < 3) throw new Error('empty narration text after sanitization');

  const voiceName = resolveVoice(voice);
  const models = process.env.GEMINI_TTS_MODEL
    ? [process.env.GEMINI_TTS_MODEL, ...MODELS.filter((m) => m !== process.env.GEMINI_TTS_MODEL)]
    : MODELS;

  let lastErr;
  for (const model of models) {
    try {
      const parts = [];
      let rate = 24000;
      for (const chunk of splitChunks(clean)) {
        const r = await requestPcm(key, model, voiceName, chunk);
        parts.push(r.pcm);
        rate = r.rate;
      }
      const pcmFile = path.join(os.tmpdir(), `gem-tts-${process.pid}-${Date.now()}.pcm`);
      fs.writeFileSync(pcmFile, Buffer.concat(parts));
      try {
        await pcmToMp3(pcmFile, rate, outFile);
      } finally {
        fs.unlinkSync(pcmFile);
      }
      if (!fs.existsSync(outFile) || fs.statSync(outFile).size < 1000) {
        throw new Error('gemini-tts produced empty file');
      }
      return outFile;
    } catch (e) {
      lastErr = e;
      if (/quota|disabled|no GEMINI_API_KEY/i.test(e.message)) throw e; // model switch won't help
      console.warn(`[narrator-v2] ${model} failed: ${e.message}`);
    }
  }
  throw lastErr || new Error('gemini-tts: all models failed');
}

module.exports = { synthesize, getAudioDuration, sanitizeForSpeech };
