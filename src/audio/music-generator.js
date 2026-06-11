/**
 * music-generator.js - ambient background bed via FFmpeg lavfi (no assets)
 * Calm fifth drone (E2/B2/E3) + filtered brown-noise "air", slow tremolo
 * (f >= 0.1 - server FFmpeg limitation), fade in/out. The video generator
 * mixes this under narration at low volume (cfg.audio.musicVolume).
 */
const { execFile } = require('child_process');

function ffmpeg(args, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', ['-y', ...args], { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, so, se) => {
      if (err) return reject(new Error(`ffmpeg failed: ${String(se).slice(-800)}`));
      resolve();
    });
  });
}

async function generateMusic(durationSec, outFile) {
  const d = Math.max(8, Math.ceil(durationSec));
  const fadeOut = Math.max(0, d - 4);
  const filter = [
    '[0]volume=0.45,tremolo=f=0.10:d=0.55[a]',
    '[1]volume=0.28,tremolo=f=0.13:d=0.50[b]',
    '[2]volume=0.16,tremolo=f=0.11:d=0.60[c]',
    '[3]lowpass=f=400,volume=0.45[n]',
    `[a][b][c][n]amix=inputs=4:duration=first,lowpass=f=1100,highpass=f=45,afade=t=in:st=0:d=2.5,afade=t=out:st=${fadeOut}:d=4,volume=0.9[out]`
  ].join(';');
  await ffmpeg([
    '-f', 'lavfi', '-i', `sine=frequency=82.41:duration=${d}`,
    '-f', 'lavfi', '-i', `sine=frequency=123.47:duration=${d}`,
    '-f', 'lavfi', '-i', `sine=frequency=164.81:duration=${d}`,
    '-f', 'lavfi', '-i', `anoisesrc=color=brown:amplitude=0.04:duration=${d}`,
    '-filter_complex', filter, '-map', '[out]',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', outFile
  ]);
  return outFile;
}

module.exports = { generateMusic };
