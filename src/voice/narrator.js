/**
 * narrator-v3.js - Natural Czech TTS
 * Voice: cs-CZ-VlastaNeural via edge-tts
 * Complete text sanitization for human-like reading
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

/**
 * Complete text sanitization - remove EVERYTHING a human wouldn't read aloud
 */
function sanitizeForSpeech(text) {
  let s = String(text);

  // === MARKDOWN removal ===
  s = s.replace(/```[\s\S]*?```/g, '');          // code blocks
  s = s.replace(/`([^`]*)`/g, '$1');             // inline code
  s = s.replace(/#{1,6}\s*/g, '');                // headings
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');   // ***bold italic***
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');        // **bold**
  s = s.replace(/\*([^*]+)\*/g, '$1');            // *italic*
  s = s.replace(/__([^_]+)__/g, '$1');            // __underline__
  s = s.replace(/_([^_]+)_/g, '$1');              // _italic_
  s = s.replace(/~~([^~]+)~~/g, '$1');            // ~~strikethrough~~
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');  // [link](url)
  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, '');   // ![image](url)
  s = s.replace(/^[-*+]\s+/gm, '');               // bullet points
  s = s.replace(/^\d+\.\s+/gm, '');               // numbered lists
  s = s.replace(/^>\s*/gm, '');                    // blockquotes
  s = s.replace(/\|/g, ', ');                      // table pipes
  s = s.replace(/^-{3,}$/gm, '');                 // horizontal rules

  // === Stray markdown/special chars ===
  s = s.replace(/\*+/g, '');                       // any remaining asterisks
  s = s.replace(/#+/g, '');                        // any remaining hashes
  s = s.replace(/`+/g, '');                        // any remaining backticks
  s = s.replace(/~+/g, '');                        // any remaining tildes

  // === URLs - convert to human speech ===
  s = s.replace(/https?:\/\/(?:www\.)?smartenergyshare\.com[^\s,.)\"']*/gi, 'smart energy share');
  s = s.replace(/https?:\/\/(?:www\.)?whitelabel\.smartenergyshare\.com[^\s,.)\"']*/gi, 'platforma smart energy share');
  s = s.replace(/https?:\/\/(?:www\.)?([a-zA-Z0-9][-a-zA-Z0-9]*)\.[a-z]{2,}[^\s,.)\"']*/gi, (_, d) => d.replace(/[-_]/g, ' '));
  s = s.replace(/www\.\S+/gi, '');                // remove remaining www. links
  s = s.replace(/\S+\.(com|cz|eu|org|net|io)\b/gi, ''); // remove remaining domains

  // === HTML entities ===
  s = s.replace(/&amp;/g, 'a');
  s = s.replace(/&nbsp;/g, ' ');
  s = s.replace(/&ndash;/g, ', ');
  s = s.replace(/&mdash;/g, ', ');
  s = s.replace(/&hellip;/g, '...');
  s = s.replace(/&[a-zA-Z]+;/g, ' ');
  s = s.replace(/&#\d+;/g, ' ');

  // === Encoding artifacts ===
  s = s.replace(/\\u[\da-fA-F]{4}/g, '');          // unicode escapes
  s = s.replace(/\\n/g, '. ');                      // literal \n
  s = s.replace(/\\r/g, '');                        // literal \r
  s = s.replace(/\\t/g, ' ');                       // literal \t
  s = s.replace(/\\/g, '');                         // remaining backslashes

  // === Special characters humans don't read ===
  s = s.replace(/[<>{}[\]()]/g, ' ');              // brackets
  s = s.replace(/\//g, ' ');                        // forward slashes
  s = s.replace(/[""„"]/g, '');                     // fancy quotes - just remove
  s = s.replace(/[''‚']/g, '');                     // fancy single quotes
  s = s.replace(/[–—]/g, ', ');                     // em/en dashes to pauses
  s = s.replace(/\.\.\./g, '. ');                   // ellipsis
  s = s.replace(/…/g, '. ');                        // unicode ellipsis
  s = s.replace(/[•·■□▪▸►▶→←↑↓↔⇒⇐]/g, '');       // bullets and arrows
  s = s.replace(/[©®™℃°§†‡¶]/g, '');               // misc symbols
  s = s.replace(/\s*[:;]\s*$/gm, '.');             // trailing colons/semicolons

  // === Units and abbreviations to Czech speech ===
  s = s.replace(/(\d)\s*kWh/gi, '$1 kilowatthodin');
  s = s.replace(/(\d)\s*MWh/gi, '$1 megawatthodin');
  s = s.replace(/(\d)\s*GWh/gi, '$1 gigawatthodin');
  s = s.replace(/(\d)\s*kWp/gi, '$1 kilowatt píku');
  s = s.replace(/(\d)\s*kW\b/gi, '$1 kilowattů');
  s = s.replace(/(\d)\s*MW\b/gi, '$1 megawattů');
  s = s.replace(/(\d)\s*GW\b/gi, '$1 gigawattů');
  s = s.replace(/(\d)\s*TWh/gi, '$1 terawatthodin');

  // === Percentages - correct Czech declension ===
  s = s.replace(/(\d+)\s*%/g, (_, n) => {
    const num = parseInt(n);
    if (num === 1) return num + ' procento';
    if (num >= 2 && num <= 4) return num + ' procenta';
    return num + ' procent';
  });

  // === Temperature ===
  s = s.replace(/(\d+)\s*°C/g, '$1 stupňů Celsia');
  s = s.replace(/(\d+)\s*°/g, '$1 stupňů');

  // === Currency ===
  s = s.replace(/(\d[\d\s]*)\s*Kč/g, '$1 korun');
  s = s.replace(/(\d[\d\s]*)\s*€/g, '$1 eur');
  s = s.replace(/(\d[\d\s]*)\s*\$/g, '$1 dolarů');
  s = s.replace(/(\d[\d\s]*)\s*CZK/gi, '$1 korun');
  s = s.replace(/(\d[\d\s]*)\s*EUR\b/gi, '$1 eur');

  // === Common Czech abbreviations ===
  s = s.replace(/\bFVE\b/g, 'fotovoltaické elektrárny');
  s = s.replace(/\bOZE\b/g, 'obnovitelné zdroje energie');
  s = s.replace(/\bERÚ\b/g, 'Energetický regulační úřad');
  s = s.replace(/\bBESS\b/g, 'bateriové úložiště');
  s = s.replace(/\bEV\b/g, 'elektromobil');
  s = s.replace(/\bCO2\b/gi, 'CO dva');
  s = s.replace(/\bAI\b/g, 'umělá inteligence');
  s = s.replace(/\bIoT\b/g, 'internet věcí');
  s = s.replace(/\bAPI\b/g, 'A P I');
  s = s.replace(/\bSEO\b/g, 'S E O');
  s = s.replace(/\bmj\./gi, 'mimo jiné');
  s = s.replace(/\btj\./gi, 'to jest');
  s = s.replace(/\btř\./gi, 'třída');
  s = s.replace(/\bč\./gi, 'číslo');
  s = s.replace(/\btis\.\s/gi, 'tisíc ');
  s = s.replace(/\bmil\.\s/gi, 'milionů ');
  s = s.replace(/\bmld\.\s/gi, 'miliard ');

  // === Brand names pronunciation ===
  s = s.replace(/SmartEnergyShare/gi, 'Smart Energy Share');
  s = s.replace(/smartenergyshare/gi, 'Smart Energy Share');

  // === Numbers with spaces (thousands separator) ===
  s = s.replace(/(\d)\s(\d{3})\b/g, '$1$2');      // "200 000" -> "200000" for TTS

  // === Orphaned/stray punctuation ===
  s = s.replace(/[""„“”]/g, '');   // all types of quotes
  s = s.replace(/[''\u2018\u2019\u201a]/g, ''); // single quotes
  s = s.replace(/\s*[;:]\s*(?=[A-Z])/g, '. ');   // semicolons before sentences
  s = s.replace(/\(\s*\)/g, '');                  // empty parens

  // === Large numbers - add spaces for natural reading ===
  s = s.replace(/(\d)(\d{6})(?!\d)/g, '$1 $2');   // millions
  s = s.replace(/(\d)(\d{3})(?!\d)/g, (m, a, b) => {
    // Don't split years like 2024
    const num = parseInt(a + b);
    if (num >= 1900 && num <= 2099) return a + b;
    return a + ' ' + b;
  });

  // === Clean up whitespace ===
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/\s+\./g, '.');
  s = s.replace(/\.\s*\./g, '.');
  s = s.replace(/,\s*,/g, ',');
  s = s.replace(/^\s+|\s+$/g, '');

  // === Remove very short or empty sentences ===
  s = s.replace(/\.\s*\./g, '.');
  s = s.trim();

  return s;
}

async function synthesize(text, voice, outFile) {
  const clean = sanitizeForSpeech(text);
  if (!clean || clean.length < 3) {
    throw new Error('empty narration text after sanitization');
  }

  // Use plain text (SSML often gets read literally by edge-tts)
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

module.exports = { synthesize, getAudioDuration, sanitizeForSpeech };
