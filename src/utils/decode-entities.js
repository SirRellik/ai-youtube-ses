/**
 * decode-entities.js - HTML entity decoding that preserves Czech diacritics.
 * Articles may carry entity-encoded text (&iacute; &#269; &#x10D; ...);
 * stripping those to spaces deletes letters from on-screen overlays.
 */
const NAMED = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  ndash: '–', mdash: '—', hellip: '…',
  ldquo: '“', rdquo: '”', bdquo: '„',
  lsquo: '‘', rsquo: '’', sbquo: '‚',
  deg: '°', sect: '§', copy: '©', reg: '®', trade: '™',
  euro: '€', middot: '·', bull: '•', laquo: '«', raquo: '»',
  // Czech letters (latin-ext named entities)
  aacute: 'á', Aacute: 'Á', eacute: 'é', Eacute: 'É',
  iacute: 'í', Iacute: 'Í', oacute: 'ó', Oacute: 'Ó',
  uacute: 'ú', Uacute: 'Ú', yacute: 'ý', Yacute: 'Ý',
  uring: 'ů', Uring: 'Ů',
  ccaron: 'č', Ccaron: 'Č', dcaron: 'ď', Dcaron: 'Ď',
  ecaron: 'ě', Ecaron: 'Ě', ncaron: 'ň', Ncaron: 'Ň',
  rcaron: 'ř', Rcaron: 'Ř', scaron: 'š', Scaron: 'Š',
  tcaron: 'ť', Tcaron: 'Ť', zcaron: 'ž', Zcaron: 'Ž'
};

function decodeEntities(text) {
  let s = String(text);
  // numeric: &#269; and &#x10D;
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (m, hex) => {
    const cp = parseInt(hex, 16);
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ' ';
  });
  s = s.replace(/&#(\d+);/g, (m, dec) => {
    const cp = parseInt(dec, 10);
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ' ';
  });
  // named: known map first, unknown leftovers become a space
  s = s.replace(/&([a-zA-Z]+);/g, (m, name) =>
    Object.prototype.hasOwnProperty.call(NAMED, name) ? NAMED[name] : ' ');
  // composed form so háčky/čárky are single code points for slicing + fonts
  return s.normalize('NFC');
}

module.exports = { decodeEntities };
