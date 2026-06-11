/**
 * narrator-v2.js - Natural Czech TTS narration
 * Voice: cs-CZ-VlastaNeural via edge-tts
 * Fixes: URL reading, markdown symbols, natural pacing, SSML
 */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(cmd, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${cmd} failed: ${stderr || err.message}`));
      resolve(stdout);
    });
  });
}

/**
 * Sanitize text for natural Czech speech:
 * - Remove markdown symbols (##, **, *, etc.)
 * - Convert URLs to human-readable form
 * - Convert abbreviations to spoken form
 * - Add natural pauses
 */
function sanitizeForSpeech(text) {
  let s = String(text);

  // Remove markdown formatting
  s = s.replace(/#{1,6}\s*/g, '');           // ## headings
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');   // **bold**
  s = s.replace(/\*([^*]+)\*/g, '$1');       // *italic*
  s = s.replace(/__([^_]+)__/g, '$1');       // __underline__
  s = s.replace(/_([^_]+)_/g, '$1');         // _italic_
  s = s.replace(/`([^`]+)`/g, '$1');         // `code`
  s = s.replace(/```[\s\S]*?```/g, '');      // code blocks
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // [link](url) -> link text
  s = s.replace(/!\[.*?\]\(.*?\)/g, '');     // images
  s = s.replace(/^[-*+]\s+/gm, '');          // bullet points
  s = s.replace(/^\d+\.\s+/gm, '');          // numbered lists

  // Convert URLs to human-readable Czech
  s = s.replace(/https?:\/\/(?:www\.)?smartenergyshare\.com\/?[^\s,.)"]*/gi,
    'na webu Smart Energy Share');
  s = s.replace(/https?:\/\/(?:www\.)?whitelabel\.smartenergyshare\.com\/?[^\s,.)"]*/gi,
    'na platformě Smart Energy Share');
  s = s.replace(/https?:\/\/(?:www\.)?([a-zA-Z0-9.-]+)\.[a-z]{2,}[^\s,.)"]*/gi,
    (_, domain) => `na webu ${domain.replace(/[-_.]/g, ' ')}`);
  s = s.replace(/www\.[a-zA-Z0-9.-]+\.[a-z]{2,}[^\s,.)"]*/gi,
    (match) => `na webu ${match.replace(/^www\./, '').replace(/\.[a-z]+$/, '').replace(/[-_.]/g, ' ')}`);

  // Abbreviations and units to Czech spoken form
  s = s.replace(/\bkWh\b/gi, 'kilowatthodin');
  s = s.replace(/\bMWh\b/gi, 'megawatthodin');
  s = s.replace(/\bkWp\b/gi, 'kilowatt peak');
  s = s.replace(/\bkW\b/gi, 'kilowatt');
  s = s.replace(/\bMW\b/gi, 'megawatt');
  s = s.replace(/\bGW\b/gi, 'gigawatt');
  s = s.replace(/\bFVE\b/g, 'fotovoltaické elektrárny');
  s = s.replace(/\bOZE\b/g, 'obnovitelné zdroje energie');
  s = s.replace(/\bERÚ\b/g, 'Energetický regulační úřad');
  s = s.replace(/\bČEPS\b/g, 'ČEPS');
  s = s.replace(/\bBESS\b/g, 'bateriové úložiště');
  s = s.replace(/\bEV\b/g, 'elektromobil');
  s = s.replace(/\bCO2\b/gi, 'CO dva');
  s = s.replace(/\bAI\b/g, 'umělá inteligence');
  s = s.replace(/\bIoT\b/g, 'internet věcí');
  s = s.replace(/\bAPI\b/g, 'A P I');
  s = s.replace(/\bSEO\b/g, 'S E O');
  s = s.replace(/\bCZK\b/gi, 'korun');
  s = s.replace(/\bEUR\b/gi, 'eur');
  s = s.replace(/\bUSD\b/gi, 'dolarů');
  s = s.replace(/\bKč\b/g, 'korun');
  s = s.replace(/\b€\b/g, 'eur');
  s = s.replace(/\$(\d)/g, '$1 dolarů');

  // Numbers with units
  s = s.replace(/(\d+)\s*%/g, '$1 procent');
  s = s.replace(/(\d+)\s*°C/g, '$1 stupňů Celsia');

  // Smart Energy Share pronunciation
  s = s.replace(/SmartEnergyShare/gi, 'Smart Energy Share');
  s = s.replace(/smartenergyshare/gi, 'Smart Energy Share');

  // Clean up special chars
  s = s.replace(/&amp;/g, 'a');
  s = s.replace(/&nbsp;/g, ' ');
  s = s.replace(/&[a-z]+;/g, ' ');
  s = s.replace(/[<>{}[\]|\\]/g, ' ');
  s = s.replace(/\(\s*\)/g, '');             // empty parens
  s = s.replace(/\s*[–—]\s*/g, ', ');        // em/en dashes to pauses
  s = s.replace(/\s{2,}/g, ' ');
  s = s.trim();

  return s;
}

/**
 * Build SSML for natural speech with pauses and emphasis
 */
function buildSSML(text, rate) {
  const clean = sanitizeForSpeech(text);
  const sentences = clean.match(/[^.!?]+[.!?]+/g) || [clean];

  let ssml = '<speak>';
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i].trim();
    if (!s) continue;

    if (i === 0) {
      // First sentence slightly slower for clarity
      ssml += `<prosody rate="${rate}">${s}</prosody>`;
    } else {
      ssml += `<break time="400ms"/><prosody rate="${rate}">${s}</prosody>`;
    }
  }
  ssml += '<break time="300ms"/></speak>';
  return ssml;
}

/**
 * Synthesize speech with natural Czech prosody
 */
async function synthesize(text, voice, outFile, options = {}) {
  const rate = options.rate || '-5%';  // slightly slower = more natural
  const clean = sanitizeForSpeech(text);

  if (!clean || clean.length < 3) {
    throw new Error('empty narration text after sanitization');
  }

  // Try SSML first for natural pauses
  const ssml = buildSSML(text, rate);
  const tmpSsml = outFile + '.ssml.txt';

  try {
    fs.writeFileSync(tmpSsml, ssml);
    await run('edge-tts', ['--voice', voice, '--file', tmpSsml, '--write-media', outFile]);
  } catch (e) {
    // Fallback: plain text without SSML (some edge-tts versions don't support SSML well)
    console.log('[Narrator] SSML failed, using plain text:', e.message.slice(0, 80));
    await run('edge-tts', ['--voice', voice, '--text', clean, '--write-media', outFile]);
  } finally {
    try { fs.unlinkSync(tmpSsml); } catch {}
  }

  if (!fs.existsSync(outFile) || fs.statSync(outFile).size < 1000) {
    throw new Error('edge-tts produced empty file');
  }
  return outFile;
}

async function getAudioDuration(file) {
  const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  const dur = parseFloat(String(out).trim());
  if (!isFinite(dur) || dur <= 0) throw new Error(`ffprobe bad duration for ${file}`);
  return dur;
}

module.exports = { synthesize, getAudioDuration, sanitizeForSpeech, buildSSML };
