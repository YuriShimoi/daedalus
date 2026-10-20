#!/usr/bin/env node
// Builds the bundled sample packs (vendor/sounds/*.js) from downloaded sources with ffmpeg:
// mono 22.05 kHz, leading silence trimmed, length capped with a fade, peak-normalized, 8-bit mu-law, base64.
//   node tools/pack.js <source dir>      (source dir holds piano/ guitar/ epiano/ kit/, see SOURCES)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RATE = 22050;
const OUT = path.join(__dirname, '..', 'vendor', 'sounds');
const FLUID = 'FluidR3_GM (Frank Wen), via gleitz/midi-js-soundfonts';
const PACKS = [
  { name: 'fluid-piano', title: 'Piano (FluidR3)', dir: 'piano', kind: 'melodic', secs: 1.8, credit: FLUID, license: 'CC-BY 3.0' },
  { name: 'fluid-guitar', title: 'Acoustic guitar (FluidR3)', dir: 'guitar', kind: 'melodic', secs: 1.6, credit: FLUID, license: 'CC-BY 3.0' },
  { name: 'fluid-epiano', title: 'E-piano (FluidR3)', dir: 'epiano', kind: 'melodic', secs: 1.6, credit: FLUID, license: 'CC-BY 3.0' },
  { name: 'vcsl-kit', title: 'Drum kit (VCSL)', dir: 'kit', kind: 'kit', secs: 1.0, credit: 'Versilian Community Sample Library (sgossner/VCSL)', license: 'CC0',
    long: { crash: 2.2, 'hat-open': 1.4 } },
];
const NOTE = { C: 0, Db: 1, D: 2, Eb: 3, E: 4, F: 5, Gb: 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };

function decode(file) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

function shape(x, secs) {
  let start = x.findIndex(v => Math.abs(v) > 0.01);
  start = Math.max(0, (start < 0 ? 0 : start) - 32);
  const len = Math.min(x.length - start, Math.round(secs * RATE)), fade = Math.round(0.25 * RATE);
  const out = x.slice(start, start + len);
  let peak = 0;
  for(const v of out) peak = Math.max(peak, Math.abs(v));
  const g = peak > 0 ? 0.85 / peak : 1;
  for(let i = 0; i < out.length; i++) out[i] *= g * Math.min(1, (out.length - i) / fade);
  return out;
}

function mulaw(s) {
  let x = Math.max(-32635, Math.min(32635, Math.round(s * 32767)));
  const sign = x < 0 ? 0x80 : 0;
  if(x < 0) x = -x;
  x += 0x84;
  let exp = 7;
  for(let mask = 0x4000; (x & mask) === 0 && exp > 0; exp--, mask >>= 1);
  return ~(sign | (exp << 4) | ((x >> (exp + 3)) & 0x0F)) & 0xFF;
}

function main(src) {
  if(!src) { console.error('usage: node tools/pack.js <source dir>'); return 1; }
  fs.mkdirSync(OUT, { recursive: true });
  for(const pk of PACKS) {
    const files = fs.readdirSync(path.join(src, pk.dir)).filter(f => /\.(mp3|wav|ogg)$/i.test(f)).sort();
    const zones = files.map(f => {
      const base = f.replace(/\.\w+$/, ''), zone = {};
      if(pk.kind === 'kit') zone.row = base;
      else {
        const m = /^([A-G]b?)(-?\d)$/.exec(base);
        zone.note = (Number(m[2]) + 1) * 12 + NOTE[m[1]];
      }
      const x = shape(decode(path.join(src, pk.dir, f)), pk.long?.[base] ?? pk.secs);
      zone.mu = Buffer.from(Uint8Array.from(x, mulaw)).toString('base64');
      return zone;
    }).sort((a, b) => (a.note ?? 0) - (b.note ?? 0));
    const { dir, secs, long, ...meta } = pk;
    const body = JSON.stringify({ ...meta, rate: RATE, zones });
    const text = `// ${pk.title}: ${pk.credit}, ${pk.license}. Built by tools/pack.js; do not edit.\n(globalThis.APOLLO_PACKS ??= []).push(${body});\n`;
    fs.writeFileSync(path.join(OUT, pk.name + '.js'), text);
    console.log(`${pk.name}: ${zones.length} zones, ${(text.length / 1024).toFixed(0)} KB`);
  }
  return 0;
}

if(require.main === module) process.exitCode = main(process.argv[2]);
