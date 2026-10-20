const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Sfxr, Wav } = require('./load.js');

test('every generator and wave renders a bounded, non-silent sound', () => {
  for(const g of [...Sfxr.GENERATORS, ...Sfxr.EXTRA_GENERATORS]) {
    const p = Sfxr.generate(g, 11);
    const x = Sfxr.render(p, 11);
    assert.ok(x.length > 100, `${g} length ${x.length}`);
    assert.ok(x.some(v => Math.abs(v) > 0.001), `${g} silent`);
    assert.ok(x.every(v => Math.abs(v) <= 1), `${g} out of range`);
  }
  for(const wave of Sfxr.WAVES) {
    const x = Sfxr.render({ ...Sfxr.DEFAULTS, wave, harmonics: 0.4, bit_crush: 0.3, compression: 0.3 }, 3);
    assert.ok(x.some(v => Math.abs(v) > 0.001), `${wave} silent`);
  }
});

test('same generator and seed give the same sound', () => {
  assert.deepStrictEqual(Sfxr.generate('laser', 42), Sfxr.generate('laser', 42));
  assert.deepStrictEqual(Sfxr.render(Sfxr.generate('explosion', 9), 9), Sfxr.render(Sfxr.generate('explosion', 9), 9));
});

test('locked params survive generators and mutate', () => {
  const keep = { ...Sfxr.DEFAULTS, base_freq: 0.123, duty: 0.777 };
  const g = Sfxr.generate('random', 5, ['base_freq', 'duty'], keep);
  assert.strictEqual(g.base_freq, 0.123);
  assert.strictEqual(g.duty, 0.777);
  for(let s = 0; s < 20; s++) {
    const m = Sfxr.mutate(keep, s, ['base_freq', 'duty'], 0.2);
    assert.strictEqual(m.base_freq, 0.123);
    assert.strictEqual(m.duty, 0.777);
  }
  const m = Sfxr.mutate(keep, 1, [], 0.2);
  assert.ok(Object.keys(keep).some(k => m[k] !== keep[k]), 'unlocked params move');
});

test('mix layers sounds with delay and volume', () => {
  const p = { sfx: [Sfxr.normalize({ id: 1, params: Sfxr.generate('blip', 1), seed: 1 })], mixes: [] };
  const one = Sfxr.render(p.sfx[0].params, 1);
  const mix = { layers: [{ sfx: 1, delay: 0, vol: 100 }, { sfx: 1, delay: 100, vol: 50 }] };
  const x = Sfxr.renderMix(p, mix);
  assert.strictEqual(x.length, 4410 + one.length);
  assert.ok(Math.abs(x[10] - one[10]) < 1e-6);
});

// Shape test against tools/media/sfx.py: same params must give the same samples (non-noise waves).
const SFX_PY = 'D:/claude_cache/tools/media/sfx.py';
const hasPython = (() => { try { execFileSync('python', ['--version']); return fs.existsSync(SFX_PY); } catch { return false; } })();
test('matches sfx.py for the same params', { skip: !hasPython && 'python or sfx.py missing' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-'));
  const PY_KEYS = ['wave', 'base_freq', 'freq_limit', 'freq_ramp', 'freq_dramp', 'vib_strength', 'vib_speed', 'arp_mod', 'arp_speed', 'attack', 'sustain',
    'punch', 'decay', 'duty', 'duty_ramp', 'repeat_speed', 'pha_offset', 'pha_ramp', 'lpf_freq', 'lpf_ramp', 'lpf_resonance', 'hpf_freq', 'hpf_ramp', 'vol'];
  for(const [gen, seed] of [['laser', 3], ['powerup', 8], ['jump', 2], ['pickup', 4]]) {
    const params = Sfxr.generate(gen, seed);
    if(params.wave === 'noise') continue;
    const json = path.join(dir, `${gen}.json`), wav = path.join(dir, `${gen}.wav`);
    fs.writeFileSync(json, JSON.stringify(Object.fromEntries(PY_KEYS.map(k => [k, params[k]]))));
    execFileSync('python', [SFX_PY, 'from', json, '-o', wav, '--raw']);
    const py = Wav.decode(fs.readFileSync(wav)).channels[0];
    const js = Sfxr.render(params, seed);
    assert.ok(Math.abs(py.length - js.length) <= 1, `${gen}: ${py.length} vs ${js.length} samples`);
    let dot = 0, a = 0, b = 0;
    for(let i = 0; i < Math.min(py.length, js.length); i++) { dot += py[i] * js[i]; a += py[i] ** 2; b += js[i] ** 2; }
    const corr = dot / Math.sqrt(a * b || 1);
    assert.ok(corr > 0.99, `${gen}: correlation ${corr.toFixed(4)}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
