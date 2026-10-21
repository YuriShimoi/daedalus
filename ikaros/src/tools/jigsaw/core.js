// Jigsaw core: ciphers and codes, all in one registry (encode / decode with options), glyph
// ciphers drawn as SVG, chains of steps, and helpers to crack a text (frequency, index of
// coincidence, Kasiski, Vigenère key guess, "try all", anagrams, word search grids).
DAE_CORE(DAE => {
  const AZ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const mod = (n, m) => ((n % m) + m) % m;
  const isL = c => /[a-z]/i.test(c);
  const up = s => String(s ?? '').toUpperCase();
  const lettersOf = s => up(s).replace(/[^A-Z]/g, '');
  const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
  const enc = new TextEncoder(), dec = new TextDecoder();

  /** Maps every letter (case kept); f(index 0..25, k = letter count so far) -> new index. */
  const mapL = (text, f) => {
    let k = 0;
    return [...text].map(c => {
      if(!isL(c) || !/[A-Za-z]/.test(c)) return c;
      const u = c === c.toUpperCase();
      const i = f(c.toUpperCase().charCodeAt(0) - 65, k++);
      const o = AZ[mod(i, 26)];
      return u ? o : o.toLowerCase();
    }).join('');
  };

  /** Key alphabet: unique letters of the key, then the rest (J merged into I when `noJ`). */
  const keyAlpha = (key, noJ = false, abc = AZ) => {
    let k = lettersOf(key);
    if(noJ) k = k.replace(/J/g, 'I');
    const base = noJ ? abc.replace('J', '') : abc;
    return [...new Set([...k, ...base])].filter(c => base.includes(c)).join('');
  };
  const keyNums = key => lettersOf(key).split('').map(c => c.charCodeAt(0) - 65);

  // squares: 5x5 (I/J) or 6x6 (A-Z + 0-9)
  const square = (key, size = 5) => {
    const abc = size === 6 ? AZ + '0123456789' : AZ;
    let k = up(key).replace(size === 6 ? /[^A-Z0-9]/g : /[^A-Z]/g, '');
    if(size === 5) k = k.replace(/J/g, 'I');
    const base = size === 5 ? abc.replace('J', '') : abc;
    return [...new Set([...k, ...base])].join('');
  };
  const sqPos = (sq, ch, size = 5) => { const i = sq.indexOf(ch); return i < 0 ? null : [Math.floor(i / size), i % size]; };
  const sqText = (s, size = 5) => (size === 5 ? lettersOf(s).replace(/J/g, 'I') : up(s).replace(/[^A-Z0-9]/g, ''));

  // columnar transposition helpers (irregular: the last row may be short)
  const order = key => {
    const k = up(key).split('');
    return k.map((c, i) => [c, i]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1])).map(x => x[1]);
  };
  const colEnc = (text, key) => {
    const n = up(key).replace(/\s/g, '').length || 1, chars = [...text];
    return order(up(key).replace(/\s/g, '') || 'A').map(c => chars.filter((_, i) => i % n === c).join('')).join('');
  };
  const colDec = (text, key) => {
    const k = up(key).replace(/\s/g, '') || 'A', n = k.length, chars = [...text], rows = Math.ceil(chars.length / n), full = chars.length % n || n;
    const cols = new Array(n);
    let at = 0;
    for(const c of order(k)) {
      const len = rows - (c >= full && chars.length % n ? 1 : 0);
      cols[c] = chars.slice(at, at + len);
      at += len;
    }
    let out = '';
    for(let r = 0; r < rows; r++) for(let c = 0; c < n; c++) if(cols[c][r] !== undefined) out += cols[c][r];
    return out;
  };

  //#region [ Code tables ]
  const MORSE = { A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
    0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.', '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--', '/': '-..-.', '(': '-.--.', ')': '-.--.-', '&': '.-...', ':': '---...', ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', '_': '..--.-', '"': '.-..-.', '$': '...-..-', '@': '.--.-.' };
  const MORSE_R = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));
  const NATO = ['Alfa', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliett', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey', 'X-ray', 'Yankee', 'Zulu'];
  const NATO_D = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const KEYPAD = ['', '', 'ABC', 'DEF', 'GHI', 'JKL', 'MNO', 'PQRS', 'TUV', 'WXYZ'];
  const RUNES = { A: 'ᚨ', B: 'ᛒ', C: 'ᚲ', D: 'ᛞ', E: 'ᛖ', F: 'ᚠ', G: 'ᚷ', H: 'ᚺ', I: 'ᛁ', J: 'ᛃ', K: 'ᚲ', L: 'ᛚ', M: 'ᛗ', N: 'ᚾ', O: 'ᛟ', P: 'ᛈ', Q: 'ᚲ', R: 'ᚱ', S: 'ᛊ', T: 'ᛏ', U: 'ᚢ', V: 'ᚹ', W: 'ᚹ', X: 'ᚲᛊ', Y: 'ᛃ', Z: 'ᛉ' };
  const RUNES_R = { 'ᚨ': 'A', 'ᛒ': 'B', 'ᚲ': 'K', 'ᛞ': 'D', 'ᛖ': 'E', 'ᚠ': 'F', 'ᚷ': 'G', 'ᚺ': 'H', 'ᛁ': 'I', 'ᛃ': 'J', 'ᛚ': 'L', 'ᛗ': 'M', 'ᚾ': 'N', 'ᛟ': 'O', 'ᛈ': 'P', 'ᚱ': 'R', 'ᛊ': 'S', 'ᛏ': 'T', 'ᚢ': 'U', 'ᚹ': 'W', 'ᛉ': 'Z', 'ᚦ': 'TH', 'ᛜ': 'NG', 'ᛇ': 'EI' };
  // Standard Galactic Alphabet (Commander Keen, Minecraft's enchanting table) in its usual Unicode look-alikes
  const SGA = { A: 'ᔑ', B: 'ʖ', C: 'ᓵ', D: '↸', E: 'ᒷ', F: '⎓', G: '⊣', H: '⍑', I: '╎', J: '⋮', K: 'ꖌ', L: 'ꖎ', M: 'ᒲ', N: 'リ', O: '𝙹', P: '!¡', Q: 'ᑑ', R: '∷', S: 'ᓭ', T: 'ℸ̣', U: '⚍', V: '⍊', W: '∴', X: '̇/', Y: '||', Z: '⨅' };
  const SGA_R = Object.entries(SGA).map(([k, v]) => [v, k]).sort((a, b) => b[0].length - a[0].length);
  const TAP = 'ABCDEFGHIJLMNOPQRSTUVWXYZ';   // tap code square: C and K share a cell (K -> C)
  const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', euro: '€' };
  //#endregion

  //#region [ Byte codes ]
  const bytesOut = (text, base, width, sep = ' ') => [...enc.encode(text)].map(b => b.toString(base).toUpperCase().padStart(width, '0')).join(sep);
  const bytesIn = (text, base) => {
    const parts = text.trim().split(/[\s,]+/).filter(Boolean);
    const valid = { 2: /^[01]+$/, 8: /^[0-7]+$/, 10: /^\d+$/, 16: /^[0-9a-f]+$/i }[base];
    // hex without spaces: pairs
    const list = base === 16 && parts.length === 1 && parts[0].length > 2 ? parts[0].match(/../g) : base === 2 && parts.length === 1 && parts[0].length > 8 ? parts[0].match(/.{1,8}/g) : parts;
    if(!list.every(p => valid.test(p))) throw new Error(`not base-${base} numbers`);
    return dec.decode(Uint8Array.from(list.map(p => parseInt(p, base) & 255)));
  };
  const b64e = text => {
    const b = enc.encode(text);
    if(typeof btoa === 'function') { let s = ''; b.forEach(x => { s += String.fromCharCode(x); }); return btoa(s); }
    return Buffer.from(b).toString('base64');
  };
  const b64d = text => {
    const s = text.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    if(!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new Error('not Base64');
    const pad = s + '='.repeat((4 - s.length % 4) % 4);
    const bin = typeof atob === 'function' ? Uint8Array.from(atob(pad), c => c.charCodeAt(0)) : Uint8Array.from(Buffer.from(pad, 'base64'));
    return dec.decode(bin);
  };
  const b32e = text => {
    let bits = '', out = '';
    enc.encode(text).forEach(b => { bits += b.toString(2).padStart(8, '0'); });
    for(let i = 0; i < bits.length; i += 5) out += BASE32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
    return out + '='.repeat((8 - out.length % 8) % 8);
  };
  const b32d = text => {
    const s = up(text).replace(/[\s=]/g, '');
    if(/[^A-Z2-7]/.test(s)) throw new Error('not Base32');
    let bits = '';
    for(const c of s) bits += BASE32.indexOf(c).toString(2).padStart(5, '0');
    const bytes = [];
    for(let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
    return dec.decode(Uint8Array.from(bytes));
  };
  const a85e = text => {
    const b = enc.encode(text);
    let out = '';
    for(let i = 0; i < b.length; i += 4) {
      const chunk = [b[i], b[i + 1] ?? 0, b[i + 2] ?? 0, b[i + 3] ?? 0];
      let n = ((chunk[0] << 24) | (chunk[1] << 16) | (chunk[2] << 8) | chunk[3]) >>> 0;
      const len = Math.min(4, b.length - i);
      if(n === 0 && len === 4) { out += 'z'; continue; }
      const g = [];
      for(let k = 0; k < 5; k++) { g.unshift(String.fromCharCode(33 + n % 85)); n = Math.floor(n / 85); }
      out += g.slice(0, len + 1).join('');
    }
    return `<~${out}~>`;
  };
  const a85d = text => {
    const s = text.replace(/\s+/g, '').replace(/^<~/, '').replace(/~>$/, '').replace(/z/g, '!!!!!');
    if(/[^!-u]/.test(s)) throw new Error('not Ascii85');
    const bytes = [];
    for(let i = 0; i < s.length; i += 5) {
      const g = s.slice(i, i + 5), len = g.length;
      let n = 0;
      for(const c of g.padEnd(5, 'u')) n = n * 85 + (c.charCodeAt(0) - 33);
      const four = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
      bytes.push(...four.slice(0, len - 1));
    }
    return dec.decode(Uint8Array.from(bytes));
  };
  //#endregion

  //#region [ Ciphers ]
  const o = (k, label, type = 'text', def = '', extra = {}) => ({ k, label, type, def, ...extra });
  const KEY = o('key', 'Key', 'text', 'LEMON');

  const vig = sign => (t, op) => {
    const k = keyNums(op.key);
    if(!k.length) return t;
    return mapL(t, (i, n) => i + sign * k[n % k.length]);
  };
  const porta = (t, op) => {
    const k = keyNums(op.key);
    if(!k.length) return t;
    return mapL(t, (p, n) => {
      const s = Math.floor(k[n % k.length] / 2);
      return p < 13 ? 13 + mod(p + s, 13) : mod(p - 13 - s, 13);
    });
  };
  const playfair = (t, op, dir) => {
    const sq = square(op.key);
    let s = sqText(t);
    if(dir > 0) {
      let out = '';
      for(let i = 0; i < s.length; i++) {
        out += s[i];
        if(i + 1 < s.length && s[i + 1] === s[i] && out.length % 2 === 1) out += s[i] === 'X' ? 'Q' : 'X';
      }
      if(out.length % 2) out += out.at(-1) === 'X' ? 'Q' : 'X';
      s = out;
    }
    let out = '';
    for(let i = 0; i + 1 < s.length; i += 2) {
      const [r1, c1] = sqPos(sq, s[i]), [r2, c2] = sqPos(sq, s[i + 1]);
      if(r1 === r2) out += sq[r1 * 5 + mod(c1 + dir, 5)] + sq[r2 * 5 + mod(c2 + dir, 5)];
      else if(c1 === c2) out += sq[mod(r1 + dir, 5) * 5 + c1] + sq[mod(r2 + dir, 5) * 5 + c2];
      else out += sq[r1 * 5 + c2] + sq[r2 * 5 + c1];
    }
    return dir > 0 ? out.match(/.{1,2}/g)?.join(' ') ?? '' : out;
  };
  const bifid = (t, op, dir) => {
    const sq = square(op.key), s = sqText(t), p = Math.max(1, +op.period || s.length);
    let out = '';
    for(let b = 0; b < s.length; b += p) {
      const blk = s.slice(b, b + p), pos = [...blk].map(c => sqPos(sq, c));
      if(dir > 0) {
        const seq = [...pos.map(x => x[0]), ...pos.map(x => x[1])];
        for(let i = 0; i < seq.length; i += 2) out += sq[seq[i] * 5 + seq[i + 1]];
      }
      else {
        const seq = pos.flat(), n = blk.length;
        for(let i = 0; i < n; i++) out += sq[seq[i] * 5 + seq[n + i]];
      }
    }
    return out;
  };
  const adfgx = (size, labels) => (t, op, dir) => {
    const sq = square(op.key, size);
    if(dir > 0) {
      const mid = [...sqText(t, size)].map(c => { const [r, cc] = sqPos(sq, c, size); return labels[r] + labels[cc]; }).join('');
      return colEnc(mid, op.key2 || 'CARGO').match(/.{1,5}/g)?.join(' ') ?? '';
    }
    const mid = colDec(up(t).replace(new RegExp(`[^${labels}]`, 'g'), ''), op.key2 || 'CARGO');
    let out = '';
    for(let i = 0; i + 1 < mid.length; i += 2) out += sq[labels.indexOf(mid[i]) * size + labels.indexOf(mid[i + 1])];
    return out;
  };
  const foursquare = (t, op, dir) => {
    const plain = square(''), k1 = square(op.key), k2 = square(op.key2 || 'EXAMPLE');
    let s = sqText(t);
    if(s.length % 2) s += 'X';
    let out = '';
    for(let i = 0; i < s.length; i += 2) {
      if(dir > 0) {
        const [r1, c1] = sqPos(plain, s[i]), [r2, c2] = sqPos(plain, s[i + 1]);
        out += k1[r1 * 5 + c2] + k2[r2 * 5 + c1];
      }
      else {
        const [r1, c2] = sqPos(k1, s[i]), [r2, c1] = sqPos(k2, s[i + 1]);
        out += plain[r1 * 5 + c1] + plain[r2 * 5 + c2];
      }
    }
    return out;
  };
  const twosquare = (t, op) => {
    // vertical two-square: reciprocal
    const top = square(op.key), bot = square(op.key2 || 'EXAMPLE');
    let s = sqText(t);
    if(s.length % 2) s += 'X';
    let out = '';
    for(let i = 0; i < s.length; i += 2) {
      const [r1, c1] = sqPos(top, s[i]), [r2, c2] = sqPos(bot, s[i + 1]);
      out += c1 === c2 ? s[i] + s[i + 1] : top[r1 * 5 + c2] + bot[r2 * 5 + c1];
    }
    return out;
  };
  const rail = (t, op, dir) => {
    const n = Math.max(2, +op.rails || 3), off = mod(+op.offset || 0, 2 * (n - 1)), chars = [...t];
    const railOf = i => { const p = mod(i + off, 2 * (n - 1)); return p < n ? p : 2 * (n - 1) - p; };
    const idx = chars.map((_, i) => i).sort((a, b) => railOf(a) - railOf(b) || a - b);
    if(dir > 0) return idx.map(i => chars[i]).join('');
    const out = [];
    idx.forEach((i, k) => { out[i] = chars[k]; });
    return out.join('');
  };
  const route = (t, op, dir) => {
    const cols = Math.max(2, +op.cols || 5), chars = [...t.replace(/\s/g, '')];
    const rows = Math.ceil(chars.length / cols);
    if(dir > 0) while(chars.length < rows * cols) chars.push('X');
    const path = [];
    if(op.mode === 'snake') {
      for(let c = 0; c < cols; c++) for(let r = 0; r < rows; r++) path.push((c % 2 ? rows - 1 - r : r) * cols + c);
    }
    else {
      let top = 0, bottom = rows - 1, left = 0, right = cols - 1;
      while(top <= bottom && left <= right) {
        for(let c = left; c <= right; c++) path.push(top * cols + c);
        for(let r = top + 1; r <= bottom; r++) path.push(r * cols + right);
        if(top < bottom) for(let c = right - 1; c >= left; c--) path.push(bottom * cols + c);
        if(left < right) for(let r = bottom - 1; r > top; r--) path.push(r * cols + left);
        top++; bottom--; left++; right--;
      }
    }
    if(dir > 0) return path.map(i => chars[i]).join('');
    const out = [];
    path.forEach((i, k) => { out[i] = chars[k]; });
    return out.join('');
  };
  const polyNums = (t, key) => [...sqText(t)].map(c => { const [r, cc] = sqPos(square(key), c); return (r + 1) * 10 + cc + 1; });

  const CIPHERS = [
    // substitution
    { id: 'caesar', name: 'Caesar', group: 'Substitution', opts: [o('shift', 'Shift', 'int', 3, { min: -25, max: 25 })],
      enc: (t, op) => mapL(t, i => i + (+op.shift || 0)), dec: (t, op) => mapL(t, i => i - (+op.shift || 0)) },
    { id: 'rot13', name: 'ROT13', group: 'Substitution', opts: [], enc: t => mapL(t, i => i + 13), dec: t => mapL(t, i => i + 13) },
    { id: 'rot47', name: 'ROT47', group: 'Substitution', opts: [],
      enc: t => t.replace(/[!-~]/g, c => String.fromCharCode(33 + mod(c.charCodeAt(0) - 33 + 47, 94))), dec: t => t.replace(/[!-~]/g, c => String.fromCharCode(33 + mod(c.charCodeAt(0) - 33 + 47, 94))) },
    { id: 'rot5', name: 'ROT5 (digits)', group: 'Substitution', opts: [], enc: t => t.replace(/\d/g, d => (+d + 5) % 10), dec: t => t.replace(/\d/g, d => (+d + 5) % 10) },
    { id: 'atbash', name: 'Atbash', group: 'Substitution', opts: [], enc: t => mapL(t, i => 25 - i), dec: t => mapL(t, i => 25 - i) },
    { id: 'affine', name: 'Affine', group: 'Substitution', opts: [o('a', 'a (odd, not 13)', 'int', 5, { min: 1, max: 25 }), o('b', 'b', 'int', 8, { min: 0, max: 25 })],
      enc: (t, op) => { const a = +op.a; if(gcd(a, 26) !== 1) throw new Error('a must share no factor with 26 (1 3 5 7 9 11 15 17 19 21 23 25)'); return mapL(t, i => a * i + +op.b); },
      dec: (t, op) => { const a = +op.a; if(gcd(a, 26) !== 1) throw new Error('a must share no factor with 26'); const inv = [...Array(26).keys()].find(x => mod(a * x, 26) === 1); return mapL(t, i => inv * (i - +op.b)); } },
    { id: 'keyword', name: 'Keyword alphabet', group: 'Substitution', opts: [o('key', 'Keyword', 'text', 'KRYPTOS')],
      enc: (t, op) => { const a = keyAlpha(op.key); return mapL(t, i => a.charCodeAt(i) - 65); }, dec: (t, op) => { const a = keyAlpha(op.key); return mapL(t, i => a.indexOf(AZ[i])); } },
    { id: 'alphabet', name: 'Custom alphabet', group: 'Substitution', opts: [o('alpha', 'Cipher alphabet (26 letters)', 'text', 'QWERTYUIOPASDFGHJKLZXCVBNM')],
      enc: (t, op) => { const a = lettersOf(op.alpha); if(new Set(a).size !== 26) throw new Error('the alphabet needs all 26 letters once'); return mapL(t, i => a.charCodeAt(i) - 65); },
      dec: (t, op) => { const a = lettersOf(op.alpha); if(new Set(a).size !== 26) throw new Error('the alphabet needs all 26 letters once'); return mapL(t, i => a.indexOf(AZ[i])); } },
    { id: 'a1z26', name: 'A1Z26', group: 'Substitution', opts: [o('sep', 'Separator', 'text', '-')],
      enc: (t, op) => up(t).split(/\s+/).filter(Boolean).map(w => [...w].filter(isL).map(c => c.charCodeAt(0) - 64).join(op.sep || '-')).filter(Boolean).join(' '),
      dec: t => t.trim().split(/\s+/).map(w => w.split(/[^0-9]+/).filter(Boolean).map(n => (+n >= 1 && +n <= 26 ? AZ[n - 1] : '?')).join('')).join(' ') },
    // polyalphabetic
    { id: 'vigenere', name: 'Vigenère', group: 'Polyalphabetic', opts: [KEY], enc: vig(1), dec: vig(-1) },
    { id: 'beaufort', name: 'Beaufort', group: 'Polyalphabetic', opts: [KEY],
      enc: (t, op) => { const k = keyNums(op.key); return k.length ? mapL(t, (i, n) => k[n % k.length] - i) : t; }, dec: (t, op) => { const k = keyNums(op.key); return k.length ? mapL(t, (i, n) => k[n % k.length] - i) : t; } },
    { id: 'autokey', name: 'Autokey', group: 'Polyalphabetic', opts: [o('key', 'Primer', 'text', 'QUEEN')],
      enc: (t, op) => { const k = keyNums(op.key).concat(keyNums(t)); return k.length ? mapL(t, (i, n) => i + k[n]) : t; },
      dec: (t, op) => { const k = keyNums(op.key); if(!k.length) return t; return mapL(t, (i, n) => { const p = mod(i - k[n], 26); k.push(p); return p; }); } },
    { id: 'gronsfeld', name: 'Gronsfeld', group: 'Polyalphabetic', opts: [o('key', 'Digits', 'text', '31415')],
      enc: (t, op) => { const k = String(op.key).replace(/\D/g, '').split('').map(Number); return k.length ? mapL(t, (i, n) => i + k[n % k.length]) : t; },
      dec: (t, op) => { const k = String(op.key).replace(/\D/g, '').split('').map(Number); return k.length ? mapL(t, (i, n) => i - k[n % k.length]) : t; } },
    { id: 'porta', name: 'Porta', group: 'Polyalphabetic', opts: [o('key', 'Key', 'text', 'FORTIFICATION')], enc: porta, dec: porta },
    { id: 'running', name: 'Running key', group: 'Polyalphabetic', opts: [o('key', 'Key text (a book passage)', 'area', 'Call me Ishmael. Some years ago, never mind how long precisely')], enc: vig(1), dec: vig(-1) },
    // squares
    { id: 'polybius', name: 'Polybius square', group: 'Squares', opts: [o('key', 'Key (optional)', 'text', '')],
      enc: (t, op) => up(t).split(/\s+/).filter(Boolean).map(w => polyNums(w, op.key).join(' ')).filter(Boolean).join(' / '),
      dec: (t, op) => { const sq = square(op.key); return t.split('/').map(w => (w.match(/[1-5]\s*[1-5]/g) ?? []).map(p => { const d = p.replace(/\s/g, ''); return sq[(d[0] - 1) * 5 + (d[1] - 1)]; }).join('')).join(' '); } },
    { id: 'playfair', name: 'Playfair', group: 'Squares', opts: [o('key', 'Key', 'text', 'PLAYFAIR EXAMPLE')], enc: (t, op) => playfair(t, op, 1), dec: (t, op) => playfair(t, op, -1) },
    { id: 'bifid', name: 'Bifid', group: 'Squares', opts: [o('key', 'Key', 'text', 'BGWKZQPNDSIOAXEFCLUMTHYVR'), o('period', 'Period (0 = whole text)', 'int', 5, { min: 0, max: 50 })],
      enc: (t, op) => bifid(t, op, 1), dec: (t, op) => bifid(t, op, -1) },
    { id: 'adfgx', name: 'ADFGX', group: 'Squares', opts: [o('key', 'Square key', 'text', 'BTALPDHOZKQFVSNGICUXMREWY'), o('key2', 'Transposition key', 'text', 'CARGO')],
      enc: (t, op) => adfgx(5, 'ADFGX')(t, op, 1), dec: (t, op) => adfgx(5, 'ADFGX')(t, op, -1) },
    { id: 'adfgvx', name: 'ADFGVX', group: 'Squares', opts: [o('key', 'Square key (A-Z, 0-9)', 'text', 'PH0QG64MEA1YL2NOFDXKR3CVS5ZW7BJ9UTI8'), o('key2', 'Transposition key', 'text', 'PRIVACY')],
      enc: (t, op) => adfgx(6, 'ADFGVX')(t, op, 1), dec: (t, op) => adfgx(6, 'ADFGVX')(t, op, -1) },
    { id: 'foursquare', name: 'Four-square', group: 'Squares', opts: [o('key', 'Key 1', 'text', 'EXAMPLE'), o('key2', 'Key 2', 'text', 'KEYWORD')],
      enc: (t, op) => foursquare(t, op, 1), dec: (t, op) => foursquare(t, op, -1) },
    { id: 'twosquare', name: 'Two-square', group: 'Squares', opts: [o('key', 'Top key', 'text', 'EXAMPLE'), o('key2', 'Bottom key', 'text', 'KEYWORD')], enc: twosquare, dec: twosquare },
    { id: 'nihilist', name: 'Nihilist', group: 'Squares', opts: [o('key', 'Square key', 'text', 'ZEBRAS'), o('key2', 'Key word', 'text', 'RUSSIAN')],
      enc: (t, op) => { const p = polyNums(t, op.key), k = polyNums(op.key2, op.key); return k.length ? p.map((n, i) => n + k[i % k.length]).join(' ') : p.join(' '); },
      dec: (t, op) => { const sq = square(op.key), k = polyNums(op.key2, op.key); return (t.match(/\d+/g) ?? []).map((n, i) => { const v = +n - (k.length ? k[i % k.length] : 0); const r = Math.floor(v / 10) - 1, c = v % 10 - 1; return r >= 0 && r < 5 && c >= 0 && c < 5 ? sq[r * 5 + c] : '?'; }).join(''); } },
    // transposition
    { id: 'railfence', name: 'Rail fence', group: 'Transposition', opts: [o('rails', 'Rails', 'int', 3, { min: 2, max: 20 }), o('offset', 'Offset', 'int', 0, { min: 0, max: 40 })],
      enc: (t, op) => rail(t, op, 1), dec: (t, op) => rail(t, op, -1) },
    { id: 'columnar', name: 'Columnar', group: 'Transposition', opts: [o('key', 'Key', 'text', 'ZEBRAS')], enc: (t, op) => colEnc(t, op.key), dec: (t, op) => colDec(t, op.key) },
    { id: 'double', name: 'Double columnar', group: 'Transposition', opts: [o('key', 'Key 1', 'text', 'ZEBRAS'), o('key2', 'Key 2', 'text', 'STRIPE')],
      enc: (t, op) => colEnc(colEnc(t, op.key), op.key2), dec: (t, op) => colDec(colDec(t, op.key2), op.key) },
    { id: 'scytale', name: 'Scytale', group: 'Transposition', opts: [o('turns', 'Letters per turn (rod diameter)', 'int', 4, { min: 2, max: 30 })],
      enc: (t, op) => colEnc(t, 'A'.repeat(Math.max(2, +op.turns || 4)).split('').map((_, i) => AZ[i]).join('')),
      dec: (t, op) => colDec(t, 'A'.repeat(Math.max(2, +op.turns || 4)).split('').map((_, i) => AZ[i]).join('')) },
    { id: 'route', name: 'Route', group: 'Transposition', opts: [o('cols', 'Columns', 'int', 5, { min: 2, max: 30 }), o('mode', 'Route', 'select', 'spiral', { options: ['spiral', 'snake'] })],
      enc: (t, op) => route(t, op, 1), dec: (t, op) => route(t, op, -1) },
    { id: 'reverse', name: 'Reverse', group: 'Transposition', opts: [o('mode', 'Reverse', 'select', 'text', { options: ['text', 'words', 'each word'] })],
      enc: (t, op) => op.mode === 'words' ? t.split(/(\s+)/).reverse().join('') : op.mode === 'each word' ? t.split(/(\s+)/).map(w => [...w].reverse().join('')).join('') : [...t].reverse().join(''),
      dec: (t, op) => op.mode === 'words' ? t.split(/(\s+)/).reverse().join('') : op.mode === 'each word' ? t.split(/(\s+)/).map(w => [...w].reverse().join('')).join('') : [...t].reverse().join('') },
    // codes
    { id: 'morse', name: 'Morse', group: 'Codes', opts: [],
      enc: t => up(t).trim().split(/\s+/).map(w => [...w].map(c => MORSE[c] ?? '').filter(Boolean).join(' ')).filter(Boolean).join(' / '),
      dec: t => t.trim().replace(/[–—_]/g, '-').replace(/[•·]/g, '.').split(/\s*\/\s*|\s{3,}/).map(w => w.trim().split(/\s+/).map(c => MORSE_R[c] ?? (c ? '?' : '')).join('')).join(' ') },
    { id: 'tap', name: 'Tap code', group: 'Codes', opts: [],
      enc: t => up(t).replace(/K/g, 'C').trim().split(/\s+/)
        .map(w => [...w].filter(c => TAP.includes(c)).map(c => { const i = TAP.indexOf(c); return '.'.repeat(Math.floor(i / 5) + 1) + ' ' + '.'.repeat(i % 5 + 1); }).join('  ')).filter(Boolean).join(' / '),
      dec: t => t.split('/').map(w => { const g = w.trim().split(/\s+/); let s = ''; for(let i = 0; i + 1 < g.length; i += 2) s += TAP[(g[i].length - 1) * 5 + g[i + 1].length - 1] ?? '?'; return s; }).join(' ') },
    { id: 'bacon', name: 'Baconian', group: 'Codes', opts: [o('a', 'Symbol A', 'text', 'A'), o('b', 'Symbol B', 'text', 'B'), o('variant', 'Alphabet', 'select', '26 letters', { options: ['26 letters', '24 letters (I=J, U=V)'] })],
      enc: (t, op) => { const v24 = String(op.variant).startsWith('24'), A = op.a || 'A', B = op.b || 'B'; return lettersOf(t).split('').map(c => { let i = c.charCodeAt(0) - 65; if(v24) { if(i >= 21) i -= 2; else if(i >= 9) i -= 1; } return i.toString(2).padStart(5, '0').replace(/0/g, A).replace(/1/g, B); }).join(' '); },
      dec: (t, op) => { const v24 = String(op.variant).startsWith('24'), A = op.a || 'A', B = op.b || 'B'; const bits = [...t].map(c => (c === A ? '0' : c === B ? '1' : c.toLowerCase() === A.toLowerCase() ? '0' : c.toLowerCase() === B.toLowerCase() ? '1' : '')).join(''); return (bits.match(/.{5}/g) ?? []).map(g => { let i = parseInt(g, 2); if(v24) { if(i >= 19) i += 2; else if(i >= 9) i += 1; } return AZ[i] ?? '?'; }).join(''); } },
    { id: 'multitap', name: 'Keypad multi-tap', group: 'Codes', opts: [],
      enc: t => up(t).trim().split(/\s+/).map(w => [...w].map(c => { const k = KEYPAD.findIndex(g => g.includes(c)); return k < 0 ? (/\d/.test(c) ? c : '') : String(k).repeat(KEYPAD[k].indexOf(c) + 1); }).filter(Boolean).join(' ')).join(' 0 '),
      dec: t => t.trim().split(/\s+0\s+|\s*0\s*(?=\s)/).map(w => w.trim().split(/\s+/).map(g => { const k = +g[0]; return KEYPAD[k]?.[(g.length - 1) % (KEYPAD[k].length || 1)] ?? ''; }).join('')).join(' ') },
    { id: 't9', name: 'T9 (keypad digits)', group: 'Codes', opts: [],
      enc: t => up(t).trim().split(/\s+/).map(w => [...w].map(c => KEYPAD.findIndex(g => g.includes(c))).filter(k => k > 0).join('')).join(' '),
      dec: t => t.trim().split(/\s+/).map(d => Cipher.t9Words(d)[0] ?? [...d].map(k => `[${KEYPAD[+k] || '?'}]`).join('')).join(' ') },
    { id: 'nato', name: 'NATO phonetic', group: 'Codes', opts: [],
      enc: t => up(t).trim().split(/\s+/).map(w => [...w].map(c => (/[A-Z]/.test(c) ? NATO[c.charCodeAt(0) - 65] : /\d/.test(c) ? NATO_D[+c] : '')).filter(Boolean).join(' ')).join(' / '),
      dec: t => t.split('/').map(w => w.trim().split(/\s+/).map(x => { const i = NATO.findIndex(n => n.toLowerCase() === x.toLowerCase() || (x.toLowerCase() === 'alpha' && n === 'Alfa') || (x.toLowerCase() === 'juliet' && n === 'Juliett')); if(i >= 0) return AZ[i]; const d = NATO_D.findIndex(n => n.toLowerCase() === x.toLowerCase()); return d >= 0 ? String(d) : ''; }).join('')).join(' ') },
    { id: 'binary', name: 'Binary', group: 'Codes', opts: [], enc: t => bytesOut(t, 2, 8), dec: t => bytesIn(t, 2) },
    { id: 'octal', name: 'Octal', group: 'Codes', opts: [], enc: t => bytesOut(t, 8, 3), dec: t => bytesIn(t, 8) },
    { id: 'decimal', name: 'Decimal bytes', group: 'Codes', opts: [], enc: t => bytesOut(t, 10, 1), dec: t => bytesIn(t, 10) },
    { id: 'hex', name: 'Hex', group: 'Codes', opts: [], enc: t => bytesOut(t, 16, 2), dec: t => bytesIn(t, 16) },
    { id: 'base32', name: 'Base32', group: 'Codes', opts: [], enc: b32e, dec: b32d },
    { id: 'base64', name: 'Base64', group: 'Codes', opts: [], enc: b64e, dec: b64d },
    { id: 'ascii85', name: 'Ascii85', group: 'Codes', opts: [], enc: a85e, dec: a85d },
    { id: 'url', name: 'URL encode', group: 'Codes', opts: [], enc: t => encodeURIComponent(t), dec: t => decodeURIComponent(t.replace(/\+/g, ' ')) },
    { id: 'html', name: 'HTML entities', group: 'Codes', opts: [],
      enc: t => [...t].map(c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? (c.codePointAt(0) > 126 ? `&#x${c.codePointAt(0).toString(16).toUpperCase()};` : c)).join(''),
      dec: t => t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m)) },
    { id: 'unicode', name: 'Unicode points', group: 'Codes', opts: [],
      enc: t => [...t].map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' '),
      dec: t => (t.match(/(?:U\+|\\u|0x)?[0-9a-f]{2,6}/gi) ?? []).map(x => String.fromCodePoint(parseInt(x.replace(/^(U\+|\\u|0x)/i, ''), 16))).join('') },
    { id: 'runes', name: 'Elder Futhark runes', group: 'Codes', opts: [],
      enc: t => up(t).replace(/TH/g, 'ᚦ').replace(/NG/g, 'ᛜ').replace(/[A-Z]/g, c => RUNES[c]).replace(/\s+/g, ' ᛫ '),
      dec: t => [...t.replace(/\s*᛫\s*/g, ' ')].map(c => RUNES_R[c] ?? c).join('') },
    { id: 'sga', name: 'Standard Galactic Alphabet', group: 'Codes', opts: [],
      enc: t => [...t].map(c => (/[a-z]/i.test(c) ? SGA[c.toUpperCase()] : c)).join(''),
      dec: t => {
        let out = '';
        for(let i = 0; i < t.length;) {
          const hit = SGA_R.find(([v]) => t.startsWith(v, i));
          if(hit) { out += hit[1]; i += hit[0].length; }
          else { out += t[i]; i++; }
        }
        return out;
      } },
    { id: 'book', name: 'Book cipher', group: 'Codes', opts: [o('book', 'Book text (line.word positions)', 'area', 'It was the best of times, it was the worst of times,\nit was the age of wisdom, it was the age of foolishness')],
      enc: (t, op) => { const words = Cipher.bookWords(op.book); return t.trim().split(/\s+/).map(w => { const k = w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); const hit = words.find(x => x.w === k); return hit ? `${hit.line}.${hit.n}` : `?${w}`; }).join(' '); },
      dec: (t, op) => { const words = Cipher.bookWords(op.book); return t.trim().split(/\s+/).map(tk => { const m = tk.match(/^(\d+)[.:](\d+)$/); if(!m) return tk.replace(/^\?/, ''); return words.find(x => x.line === +m[1] && x.n === +m[2])?.raw ?? '?'; }).join(' '); } },
    { id: 'xor', name: 'XOR (hex out)', group: 'Codes', opts: [o('key', 'Key', 'text', 'key')],
      enc: (t, op) => { const k = enc.encode(op.key || '\0'), b = enc.encode(t); return [...b].map((x, i) => (x ^ k[i % k.length]).toString(16).padStart(2, '0')).join(' ').toUpperCase(); },
      dec: (t, op) => { const k = enc.encode(op.key || '\0'), hx = t.replace(/[^0-9a-f]/gi, ''); if(hx.length % 2) throw new Error('odd number of hex digits'); return dec.decode(Uint8Array.from(hx.match(/../g) ?? [], (h, i) => parseInt(h, 16) ^ k[i % k.length])); } },
    // utility steps for chains
    { id: 'clean', name: 'Letters only', group: 'Tidy', opts: [], enc: t => lettersOf(t), dec: t => lettersOf(t) },
    { id: 'group', name: 'Groups of N', group: 'Tidy', opts: [o('n', 'Group size', 'int', 5, { min: 1, max: 20 })],
      enc: (t, op) => (t.replace(/\s+/g, '').match(new RegExp(`.{1,${Math.max(1, +op.n || 5)}}`, 'g')) ?? []).join(' '), dec: t => t.replace(/\s+/g, '') },
    { id: 'upper', name: 'UPPERCASE', group: 'Tidy', opts: [], enc: t => t.toUpperCase(), dec: t => t.toLowerCase() },
  ];
  //#endregion

  //#region [ Glyph ciphers (SVG) ]
  const BRAILLE = { A: [1], B: [1, 2], C: [1, 4], D: [1, 4, 5], E: [1, 5], F: [1, 2, 4], G: [1, 2, 4, 5], H: [1, 2, 5], I: [2, 4], J: [2, 4, 5], K: [1, 3], L: [1, 2, 3], M: [1, 3, 4], N: [1, 3, 4, 5], O: [1, 3, 5], P: [1, 2, 3, 4], Q: [1, 2, 3, 4, 5], R: [1, 2, 3, 5], S: [2, 3, 4], T: [2, 3, 4, 5], U: [1, 3, 6], V: [1, 2, 3, 6], W: [2, 4, 5, 6], X: [1, 3, 4, 6], Y: [1, 3, 4, 5, 6], Z: [1, 3, 5, 6], '#': [3, 4, 5, 6] };
  // semaphore: arm angles as clock hours (6 = down), seen by the reader
  const SEMA = { A: [6, 7.5], B: [6, 9], C: [6, 10.5], D: [6, 12], E: [6, 1.5], F: [6, 3], G: [6, 4.5], H: [7.5, 9], I: [7.5, 10.5], K: [7.5, 12], L: [7.5, 1.5], M: [7.5, 3], N: [7.5, 4.5], O: [9, 10.5], P: [9, 12], Q: [9, 1.5], R: [9, 3], S: [9, 4.5], T: [10.5, 12], U: [10.5, 1.5], Y: [10.5, 3], J: [12, 3], V: [12, 4.5], W: [1.5, 3], X: [1.5, 4.5], Z: [3, 4.5] };

  const glyph = {
    // pigpen: A-I grid, J-R grid + dot, S-V X, W-Z X + dot
    pigpen(c, s) {
      const i = c.charCodeAt(0) - 65, w = s, out = [];
      const L = (x1, y1, x2, y2) => out.push(`M${x1} ${y1}L${x2} ${y2}`);
      let dot = false;
      if(i < 18) {
        const k = i % 9, r = Math.floor(k / 3), col = k % 3;
        dot = i >= 9;
        if(col > 0) L(4, 4, 4, w - 4);
        if(col < 2) L(w - 4, 4, w - 4, w - 4);
        if(r > 0) L(4, 4, w - 4, 4);
        if(r < 2) L(4, w - 4, w - 4, w - 4);
        return { d: out.join(''), dots: dot ? [[w / 2, w / 2]] : [] };
      }
      const k = (i - 18) % 4;
      dot = i >= 22;
      const m = w / 2;
      if(k === 0) { L(4, 4, m, w - 6); L(m, w - 6, w - 4, 4); return { d: out.join(''), dots: dot ? [[m, w * .38]] : [] }; }
      if(k === 1) { L(4, 4, w - 6, m); L(w - 6, m, 4, w - 4); return { d: out.join(''), dots: dot ? [[w * .38, m]] : [] }; }
      if(k === 2) { L(w - 4, 4, 6, m); L(6, m, w - 4, w - 4); return { d: out.join(''), dots: dot ? [[w * .62, m]] : [] }; }
      L(4, w - 4, m, 6); L(m, 6, w - 4, w - 4);
      return { d: out.join(''), dots: dot ? [[m, w * .62]] : [] };
    },
    braille(c, s) {
      const dots = BRAILLE[c] ?? [];
      const pos = n => [s * (n <= 3 ? .3 : .7), s * (.2 + .3 * ((n - 1) % 3))];
      return { d: '', dots: [1, 2, 3, 4, 5, 6].map(n => [...pos(n), dots.includes(n)]) };
    },
    semaphore(c, s) {
      const [a, b] = SEMA[c] ?? [6, 6];
      const cx = s / 2, cy = s * .46, len = s * .36;
      const arm = h => { const ang = (h / 12) * Math.PI * 2; const x = cx + Math.sin(ang) * len, y = cy - Math.cos(ang) * len; return { x, y, ang }; };
      const p = [arm(a), arm(b)];
      let d = `M${cx} ${cy}L${cx} ${s * .82}M${cx} ${s * .82}L${cx - s * .1} ${s * .96}M${cx} ${s * .82}L${cx + s * .1} ${s * .96}`;
      const flags = [];
      for(const q of p) {
        d += `M${cx} ${cy}L${q.x} ${q.y}`;
        // a small square flag at the hand, on the arm's left side
        const ux = Math.sin(q.ang), uy = -Math.cos(q.ang), nx = -uy, ny = ux, f = s * .13;
        flags.push(`M${q.x} ${q.y}L${q.x - ux * f} ${q.y - uy * f}L${q.x - ux * f + nx * f} ${q.y - uy * f + ny * f}L${q.x + nx * f} ${q.y + ny * f}Z`);
      }
      return { d, fill: flags.join(''), head: [cx, cy - s * .12, s * .07] };
    },
    // stick men (dancing men style): arms x arms x legs = 27 poses; a flag marks the end of a word
    stickmen(c, s, last) {
      const i = c.charCodeAt(0) - 65;
      const la = i % 3, ra = Math.floor(i / 3) % 3, lg = Math.floor(i / 9) % 3;
      const cx = s / 2, sh = s * .36, hip = s * .66;
      const armY = [s * .18, sh + s * .02, s * .54];
      let d = `M${cx} ${sh - s * .08}L${cx} ${hip}`;
      d += `M${cx} ${sh}L${cx - s * .26} ${armY[la]}M${cx} ${sh}L${cx + s * .26} ${armY[ra]}`;
      const legs = [[[-.18, .95], [.18, .95]], [[-.28, .82], [.08, .95]], [[-.08, .95], [.28, .82]]][lg];
      for(const [dx, dy] of legs) d += `M${cx} ${hip}L${cx + dx * s} ${dy * s}`;
      let fill = '';
      if(last) { const hx = cx + s * .26, hy = armY[ra]; fill = `M${hx} ${hy}L${hx} ${hy - s * .2}L${hx + s * .14} ${hy - s * .14}L${hx} ${hy - s * .08}Z`; d += `M${hx} ${hy}L${hx} ${hy - s * .2}`; }
      return { d, fill, head: [cx, sh - s * .16, s * .08] };
    },
    // drawn as text: the Unicode look-alikes (Segoe UI Symbol / Cambria Math have them)
    sga(c, s) {
      return { text: SGA[c] ?? c, size: s * .78 };
    },
    templar(c, s) {
      // pigpen-like Templar shapes: the cell's walls drawn as chevrons pointing in
      const p = glyph.pigpen(c, s);
      return { d: p.d.replace(/L/g, ' L'), dots: p.dots, rot: 45 };
    },
  };

  const GLYPHS = [
    { id: 'pigpen', name: 'Pigpen', letters: AZ },
    { id: 'templar', name: 'Templar (turned pigpen)', letters: AZ },
    { id: 'braille', name: 'Braille', letters: AZ + '0123456789' },
    { id: 'semaphore', name: 'Semaphore', letters: AZ },
    { id: 'stickmen', name: 'Stick men (dancing-men style)', letters: AZ },
    { id: 'sga', name: 'Standard Galactic Alphabet', letters: AZ },
    { id: 'mayan', name: 'Mayan numbers', letters: '0123456789' },
    { id: 'tally', name: 'Tally marks', letters: '0123456789' },
  ];
  //#endregion

  //#region [ Language data ]
  const FREQ = {
    en: { A: 8.17, B: 1.49, C: 2.78, D: 4.25, E: 12.7, F: 2.23, G: 2.02, H: 6.09, I: 6.97, J: .15, K: .77, L: 4.03, M: 2.41, N: 6.75, O: 7.51, P: 1.93, Q: .1, R: 5.99, S: 6.33, T: 9.06, U: 2.76, V: .98, W: 2.36, X: .15, Y: 1.97, Z: .07 },
    pt: { A: 14.63, B: 1.04, C: 3.88, D: 4.99, E: 12.57, F: 1.02, G: 1.3, H: 1.28, I: 6.18, J: .4, K: .02, L: 2.78, M: 4.74, N: 5.05, O: 10.73, P: 2.52, Q: 1.2, R: 6.53, S: 7.81, T: 4.34, U: 4.63, V: 1.67, W: .01, X: .21, Y: .01, Z: .47 },
  };
  const COMMON = {
    en: 'the of and to a in is it you that he was for on are with as i his they be at one have this from or had by hot but some what there we can out other were all your when up use word how said an each she which do their time if will way about many then them would write like so these her long make thing see him two has look more day could go come did my sound no most number who over know water than call first people may down side been now find any new work part take get place made live where after back little only round man year came show every good me give our under name very through just form much great think say help low line before turn cause same mean differ move right boy old too does tell sentence set three want air well also play small end put home read hand port large spell add even land here must big high such follow act why ask men change went light kind off need house picture try us again animal point mother world near build self earth father head stand own page should country found answer school grow study still learn plant cover food sun four thought let keep eye never last door between city tree cross since hard start might story saw far sea draw left late run don while press close night real life few stop open seem together next white children begin got walk example ease paper often always music those both mark book letter until mile river car feet care second group carry took rain eat room friend began idea fish mountain north once base hear horse cut sure watch color face wood main enough plain girl usual young ready above ever red list though feel talk bird soon body dog family direct pose leave song measure state product black short numeral class wind question happen complete ship area half rock order fire south problem piece told knew pass farm top whole king size heard best hour better true during hundred am remember step early hold west ground interest reach fast five sing listen six table travel less morning ten simple several vowel toward war lay against pattern slow center love person money serve appear road map science rule govern pull cold notice voice fall power town fine certain fly unit lead cry dark machine note wait plan figure star box noun field rest correct able pound done beauty drive stood contain front teach week final gave green oh quick develop sleep warm free minute strong special mind behind clear tail produce fact street inch lot nothing course stay wheel full force blue object decide surface deep moon island foot yet busy test record boat common gold possible plane age dry wonder laugh thousand ago ran check game shape yes cool miss brought heat snow bed bring sit perhaps fill east weight language among attack dawn secret key treasure door gate tower dragon sword castle hidden north'.split(' '),
    pt: 'de a o que e do da em um para é com não uma os no se na por mais as dos como mas foi ao ele das tem à seu sua ou ser quando muito há nos já está eu também só pelo pela até isso ela entre era depois sem mesmo aos ter seus quem nas me esse eles estão você tinha foram essa num nem suas meu às minha têm numa pelos elas havia seja qual será nós tenho lhe deles essas esses pelas este fosse dele tu te vocês vos lhes meus minhas teu tua teus tuas nosso nossa nossos nossas dela delas esta estes estas aquele aquela aqueles aquelas isto aquilo estou está estamos estão estive esteve estivemos estiveram estava estávamos estavam hei há havemos hão houve houvemos houveram sou somos são era éramos eram fui foi fomos foram seria seriam tenho tem temos tém tinha tínhamos tinham tive teve tivemos tiveram terá terão porta chave tesouro castelo torre espada dragão segredo norte sul leste oeste ataque amanhecer casa tempo vida dia ano homem mulher mundo coisa vez lugar caminho cidade água fogo terra ar noite sol lua rei rainha ouro prata pedra livro carta mapa'.split(' '),
  };
  //#endregion

  class Cipher {
    static LIST = CIPHERS;
    static GLYPHS = GLYPHS;
    static FREQ = FREQ;
    static COMMON = COMMON;
    static MORSE = MORSE;

    static get(id) {
      return CIPHERS.find(c => c.id === id) ?? null;
    }

    static defaults(c) {
      return Object.fromEntries(c.opts.map(x => [x.k, x.def]));
    }

    /** One step: {id, opts} in direction 'enc' | 'dec'. */
    static run(text, step, dir = 'enc') {
      const c = Cipher.get(step.id);
      if(!c) throw new Error(`unknown cipher ${step.id}`);
      return c[dir](String(text), { ...Cipher.defaults(c), ...step.opts });
    }

    /** A chain of steps: encode runs them in order, decode in reverse. */
    static chain(text, steps, dir = 'enc') {
      const list = dir === 'enc' ? steps : [...steps].reverse();
      return list.reduce((t, s) => Cipher.run(t, s, dir), String(text));
    }

    static bookWords(book) {
      const out = [];
      String(book).split(/\r?\n/).forEach((line, li) => {
        line.split(/\s+/).filter(Boolean).forEach((raw, wi) => out.push({ line: li + 1, n: wi + 1, raw: raw.replace(/[^\p{L}\p{N}'-]/gu, ''), w: raw.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') }));
      });
      return out;
    }

    //#region [ Glyphs ]
    /**
     * SVG of text in a glyph cipher (letters / digits it does not know are skipped; spaces make a gap).
     * @returns {string} svg markup (stroke / fill use currentColor)
     */
    static glyphs(id, text, { size = 40, per = 12, gap = 8 } = {}) {
      const g = GLYPHS.find(x => x.id === id);
      if(!g) throw new Error(`unknown glyph cipher ${id}`);
      const words = up(text).trim().split(/\s+/).filter(Boolean);
      const items = [];
      if(id === 'mayan' || id === 'tally') {
        for(const w of words) for(const n of w.match(/\d+/g) ?? []) items.push({ n: +n });
      }
      else {
        for(const w of words) {
          let chars = [...w].filter(c => g.letters.includes(c));
          if(id === 'braille') chars = chars.flatMap(c => (/\d/.test(c) ? ['#', 'JABCDEFGHI'[+c]] : [c]));
          chars.forEach((c, i) => items.push({ c, last: i === chars.length - 1 }));
          items.push({ space: true });
        }
        items.pop();
      }
      const cell = id === 'mayan' ? size * 1.1 : id === 'tally' ? size * 1.6 : size;
      let x = 0, y = 0, row = 0, maxW = 0;
      const body = [];
      const sw = Math.max(1.5, size / 14);
      for(const it of items) {
        if(it.space) { x += gap * 2; continue; }
        if(row >= per && !it.space) { x = 0; y += (id === 'mayan' ? Cipher.#mayanHeight(it.n, size) : size) + gap * 2; row = 0; }
        let svg = '';
        if(id === 'mayan') { const m = Cipher.#mayan(it.n, size); svg = m.svg; }
        else if(id === 'tally') svg = Cipher.#tally(it.n, size);
        else {
          const gl = glyph[id](it.c, size, it.last);
          if(gl.d) svg += `<path d="${gl.d}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${gl.rot ? ` transform="rotate(${gl.rot} ${size / 2} ${size / 2}) translate(${size * .1} ${size * .1}) scale(.8)"` : ''}/>`;
          if(gl.text) svg += `<text x="${size / 2}" y="${size * .72}" text-anchor="middle" font-size="${gl.size}" font-family="'Segoe UI Symbol', 'Cambria Math', 'Noto Sans Symbols 2', sans-serif" fill="currentColor">${gl.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`;
          if(gl.fill) svg += `<path d="${gl.fill}" fill="currentColor"/>`;
          if(gl.head) svg += `<circle cx="${gl.head[0]}" cy="${gl.head[1]}" r="${gl.head[2]}" fill="currentColor"/>`;
          for(const [dx, dy, on = true] of gl.dots ?? []) svg += `<circle cx="${dx}" cy="${dy}" r="${size * .07}" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="${on ? 0 : 1}" opacity="${on ? 1 : .25}"/>`;
        }
        body.push(`<g transform="translate(${x} ${y})">${svg}</g>`);
        x += (id === 'tally' ? Cipher.#tallyWidth(it.n, size) : cell) + gap;
        maxW = Math.max(maxW, x);
        row++;
      }
      const h = y + (id === 'mayan' ? Math.max(...items.map(i => Cipher.#mayanHeight(i.n ?? 0, size)), size) : size);
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 ${Math.max(maxW, size) + 8} ${h + 8}" width="${Math.max(maxW, size) + 8}" height="${h + 8}">${body.join('')}</svg>`;
    }

    static #mayanDigit(v, size) {
      // one base-20 digit: dots (1-4) over bars (5 each); 0 = shell
      const out = [];
      const w = size, bh = size * .12, gap = size * .07;
      if(v === 0) return { svg: `<ellipse cx="${w / 2}" cy="${size * .2}" rx="${w * .38}" ry="${size * .16}" fill="none" stroke="currentColor" stroke-width="${size / 14}"/><path d="M${w * .2} ${size * .2}Q${w / 2} ${size * .05} ${w * .8} ${size * .2}" fill="none" stroke="currentColor" stroke-width="${size / 20}"/>`, h: size * .4 };
      const bars = Math.floor(v / 5), dots = v % 5;
      let y = 0;
      if(dots) {
        for(let i = 0; i < dots; i++) out.push(`<circle cx="${w / 2 + (i - (dots - 1) / 2) * size * .2}" cy="${size * .08}" r="${size * .07}" fill="currentColor"/>`);
        y = size * .18;
      }
      for(let i = 0; i < bars; i++) { out.push(`<rect x="${w * .08}" y="${y}" width="${w * .84}" height="${bh}" rx="${bh / 3}" fill="currentColor"/>`); y += bh + gap; }
      return { svg: out.join(''), h: Math.max(y, size * .2) };
    }

    static #mayanDigits(n) {
      const d = [];
      do { d.unshift(n % 20); n = Math.floor(n / 20); } while(n > 0);
      return d;
    }

    static #mayanHeight(n, size) {
      return Cipher.#mayanDigits(n).reduce((s, v) => s + Cipher.#mayanDigit(v, size).h + size * .25, 0);
    }

    static #mayan(n, size) {
      let y = 0, svg = '';
      for(const v of Cipher.#mayanDigits(n)) {
        const g = Cipher.#mayanDigit(v, size);
        svg += `<g transform="translate(0 ${y})">${g.svg}</g>`;
        y += g.h + size * .25;
      }
      return { svg, h: y };
    }

    static #tallyWidth(n, size) {
      return Math.max(1, Math.ceil(n / 5)) * size * .7;
    }

    static #tally(n, size) {
      let s = '';
      const sw = Math.max(1.5, size / 14);
      for(let g = 0; g * 5 < n; g++) {
        const k = Math.min(5, n - g * 5), x0 = g * size * .7;
        for(let i = 0; i < Math.min(4, k); i++) s += `<path d="M${x0 + i * size * .12 + 4} ${size * .1}L${x0 + i * size * .12 + 4} ${size * .9}" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round"/>`;
        if(k === 5) s += `<path d="M${x0} ${size * .75}L${x0 + size * .5} ${size * .25}" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round"/>`;
      }
      return s;
    }
    //#endregion

    //#region [ Analysis ]
    static freq(text) {
      const s = lettersOf(text), count = Object.fromEntries([...AZ].map(c => [c, 0]));
      for(const c of s) count[c]++;
      return { count, total: s.length };
    }

    /** Index of coincidence (English ≈ 0.066, Portuguese ≈ 0.072, random ≈ 0.038). */
    static ioc(text) {
      const { count, total } = Cipher.freq(text);
      if(total < 2) return 0;
      return Object.values(count).reduce((s, n) => s + n * (n - 1), 0) / (total * (total - 1));
    }

    /** Likely Vigenère key lengths: [{len, score}] best first (Kasiski spacings + column IoC). */
    static keyLengths(text, max = 16) {
      const s = lettersOf(text);
      const kas = new Map();
      for(let i = 0; i + 3 <= s.length; i++) {
        const tri = s.slice(i, i + 3);
        for(let j = s.indexOf(tri, i + 1); j >= 0; j = s.indexOf(tri, j + 1)) {
          const d = j - i;
          for(let L = 2; L <= max; L++) if(d % L === 0) kas.set(L, (kas.get(L) ?? 0) + 1);
        }
      }
      const out = [];
      for(let L = 1; L <= max && L <= s.length / 2; L++) {
        let ic = 0;
        for(let c = 0; c < L; c++) ic += Cipher.ioc([...s].filter((_, i) => i % L === c).join(''));
        out.push({ len: L, ioc: ic / L, kasiski: kas.get(L) ?? 0 });
      }
      // multiples of the key score as well as the key: the shortest length close to the best wins
      const best = Math.max(...out.map(x => x.ioc), 0);
      const scored = out.map(x => ({ ...x, score: x.ioc / (best || 1) + Math.min(.05, x.kasiski * .001) }));
      const near = scored.filter(x => x.score >= .75).sort((a, b) => a.len - b.len);
      return [...near, ...scored.filter(x => x.score < .75).sort((a, b) => b.score - a.score)];
    }

    /** Key guess for a Vigenère text of length L (chi-squared per column). */
    static vigenereKey(text, L, lang = 'en') {
      const s = lettersOf(text), f = FREQ[lang];
      let key = '';
      for(let c = 0; c < L; c++) {
        const col = [...s].filter((_, i) => i % L === c);
        let best = 0, bestChi = Infinity;
        for(let k = 0; k < 26; k++) {
          const cnt = new Array(26).fill(0);
          col.forEach(ch => cnt[mod(ch.charCodeAt(0) - 65 - k, 26)]++);
          const chi = cnt.reduce((sum, n, i) => { const e = f[AZ[i]] / 100 * col.length; return sum + (n - e) ** 2 / (e || 1e-6); }, 0);
          if(chi < bestChi) { bestChi = chi; best = k; }
        }
        key += AZ[best];
      }
      return key;
    }

    /** How much text looks like a language: higher is better (letter fit + common words). */
    static score(text, lang = 'en') {
      const t = String(text);
      if(!t.trim()) return -99;
      const printable = [...t].filter(c => /[\p{L}\p{N}\p{P}\s]/u.test(c)).length / [...t].length;
      if(printable < .9) return -50 + printable * 10;
      const s = lettersOf(t.normalize('NFD').replace(/[̀-ͯ]/g, ''));
      if(s.length < 2) return -20;
      const f = FREQ[lang];
      let lp = 0;
      for(const c of s) lp += Math.log10((f[c] || .01) / 100);
      const letterFit = lp / s.length + 1.6;            // ~0 for real text, about -0.4 for noise
      const words = t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z]+/).filter(Boolean);
      const common = new Set(COMMON[lang].map(w => w.normalize('NFD').replace(/[̀-ͯ]/g, '')));
      const hits = words.length ? words.filter(w => common.has(w)).length / words.length : 0;
      const letterShare = s.length / t.replace(/\s/g, '').length;
      return +(letterFit * 10 + hits * 6 + (letterShare - 1) * 3).toFixed(3);
    }

    /**
     * Runs every keyless decoder (plus Caesar shifts and a Vigenère key guess) and ranks the results.
     * @returns {Array<{name, text, score, key?}>}
     */
    static tryAll(text, lang = 'en', top = 15) {
      const out = [];
      const add = (name, fn, key) => {
        try {
          const r = fn();
          if(r && r !== text && r.trim()) out.push({ name, text: r, score: Cipher.score(r, lang), key });
        } catch {}
      };
      for(let k = 1; k < 26; k++) add(k === 13 ? 'ROT13' : `Caesar ${k}`, () => Cipher.run(text, { id: 'caesar', opts: { shift: k } }, 'dec'), k);
      for(const id of ['atbash', 'rot47', 'reverse', 'morse', 'a1z26', 'binary', 'hex', 'decimal', 'octal', 'base64', 'base32', 'ascii85', 'url', 'html', 'unicode', 'nato', 'multitap', 'tap', 'bacon', 'runes', 'polybius']) {
        const c = Cipher.get(id);
        add(c.name, () => Cipher.run(text, { id }, 'dec'));
      }
      for(const L of [2, 3, 4, 5, 6, 7, 8]) add(`Rail fence ${L}`, () => Cipher.run(text, { id: 'railfence', opts: { rails: L } }, 'dec'));
      const s = lettersOf(text);
      if(s.length >= 20) {
        for(const { len } of Cipher.keyLengths(text).slice(0, 3)) {
          if(len < 2 || s.length < len * 6) continue;
          const key = Cipher.vigenereKey(text, len, lang);
          if(new Set(key).size === 1) continue;   // one repeated letter is a Caesar shift (already tried)
          add(`Vigenère (key ${key})`, () => Cipher.run(text, { id: 'vigenere', opts: { key } }, 'dec'), key);
        }
      }
      const seen = new Set();
      return out.sort((a, b) => b.score - a.score).filter(x => (seen.has(x.text) ? false : seen.add(x.text))).slice(0, top);
    }
    //#endregion

    //#region [ Words: anagrams, T9, word search ]
    /** Word list for a language ([] until its file is loaded: DAE.Words[lang] = 'word\n...'). */
    static words(lang = 'en') {
      const w = DAE.Words?.[lang];
      if(!w) return [];
      if(typeof w === 'string') DAE.Words[lang] = w.split('\n').filter(Boolean);
      return DAE.Words[lang];
    }

    static #key(w) {
      return w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
    }

    /**
     * Anagrams of `letters`: exact single words, two-word phrases, and the longest words that fit.
     * @returns {{exact: string[], pairs: string[], fit: string[]}}
     */
    static anagrams(letters, list, { min = 3, max = 60 } = {}) {
      const want = Cipher.#key(letters);
      const cnt = s => { const c = new Array(26).fill(0); for(const ch of s) c[ch.charCodeAt(0) - 97]++; return c; };
      const W = cnt(want);
      const fits = c => c.every((n, i) => n <= W[i]);
      const cand = [];
      for(const raw of list) {
        const k = Cipher.#key(raw);
        if(k.length < min || k.length > want.length) continue;
        const c = cnt(k);
        if(fits(c)) cand.push({ raw, k, c });
      }
      const exact = cand.filter(x => x.k.length === want.length && x.k !== want).map(x => x.raw);
      const pairs = [];
      const byLen = new Map();
      for(const x of cand) { if(!byLen.has(x.k.length)) byLen.set(x.k.length, []); byLen.get(x.k.length).push(x); }
      for(const x of cand) {
        const rest = want.length - x.k.length;
        if(rest < min || rest < x.k.length) continue;
        for(const y of byLen.get(rest) ?? []) {
          if(y.k.length === x.k.length && y.k < x.k) continue;
          if(x.c.every((n, i) => n + y.c[i] === W[i])) pairs.push(`${x.raw} ${y.raw}`);
          if(pairs.length >= max) break;
        }
        if(pairs.length >= max) break;
      }
      const fit = cand.filter(x => x.k.length < want.length).sort((a, b) => b.k.length - a.k.length).slice(0, max).map(x => x.raw);
      return { exact: [...new Set(exact)].slice(0, max), pairs: [...new Set(pairs)], fit: [...new Set(fit)] };
    }

    /** Words for a T9 digit string (from the loaded English list, then Portuguese). */
    static t9Words(digits) {
      const d = String(digits).replace(/\D/g, '');
      const map = {};
      KEYPAD.forEach((g, k) => [...g].forEach(c => { map[c] = String(k); }));
      const out = [];
      for(const lang of ['en', 'pt']) {
        for(const w of Cipher.words(lang)) {
          const k = Cipher.#key(w);
          if(k.length === d.length && [...k.toUpperCase()].map(c => map[c]).join('') === d) out.push(w);
          if(out.length > 8) return out;
        }
      }
      return out;
    }

    /**
     * Word search grid.
     * @returns {{grid: string[][], placed: Array<{word, r, c, dr, dc}>, missed: string[]}}
     */
    static wordSearch(words, { size = 0, dirs = 'all', seed = Date.now(), fill = AZ } = {}) {
      const rng = new DAE.Rng(seed);
      const list = [...new Set(words.map(w => lettersOf(w)).filter(w => w.length > 1))].sort((a, b) => b.length - a.length);
      const n = size || Math.max(8, Math.ceil(Math.max(...list.map(w => w.length), 0) * 1.25), Math.ceil(Math.sqrt(list.join('').length * 2.2)));
      const D = dirs === 'easy' ? [[0, 1], [1, 0]] : dirs === 'forward' ? [[0, 1], [1, 0], [1, 1], [-1, 1]] : [[0, 1], [1, 0], [1, 1], [-1, 1], [0, -1], [-1, 0], [-1, -1], [1, -1]];
      const grid = Array.from({ length: n }, () => new Array(n).fill(''));
      const placed = [], missed = [];
      for(const w of list) {
        let ok = false;
        for(let tries = 0; tries < 400 && !ok; tries++) {
          const [dr, dc] = rng.pick(D), r = rng.int(0, n - 1), c = rng.int(0, n - 1);
          const er = r + dr * (w.length - 1), ec = c + dc * (w.length - 1);
          if(er < 0 || er >= n || ec < 0 || ec >= n) continue;
          let fits = true;
          for(let i = 0; i < w.length && fits; i++) { const x = grid[r + dr * i][c + dc * i]; if(x && x !== w[i]) fits = false; }
          if(!fits) continue;
          for(let i = 0; i < w.length; i++) grid[r + dr * i][c + dc * i] = w[i];
          placed.push({ word: w, r, c, dr, dc });
          ok = true;
        }
        if(!ok) missed.push(w);
      }
      for(const row of grid) for(let i = 0; i < n; i++) if(!row[i]) row[i] = rng.pick([...fill]);
      return { grid, placed, missed };
    }
    //#endregion
  }

  DAE.Cipher = Cipher;
});
