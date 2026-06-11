/**
 * narrator.js - edge-tts narration (free, no API key)
 * Czech primary: cs-CZ-VlastaNeural | English: en-US-AndrewMultilingualNeural
 */
const { execFile } = require('child_process');
const fs = require('fs');

function run(cmd, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${cmd} failed: ${stderr || err.message}`));
      resolve(stdout);
    });
  });
}

async function synthesize(text, voice, outFile) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('empty narration text');
  await run('edge-tts', ['--voice', voice, '--text', clean, '--write-media', outFile]);
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

module.exports = { synthesize, getAudioDuration };
