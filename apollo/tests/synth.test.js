const test = require('node:test');
const assert = require('node:assert');
const { Synth, Instruments, Samples, Theory } = require('./load.js');

const SR = 44100;
function run(v, n) {
  const out = new Float32Array(n);
  for(let i = 0; i < n && !v.done; i++) out[i] = v.next();
  return out;
}

/** Fundamental by autocorrelation in [lo, hi] Hz. */
function pitch(x, lo = 60, hi = 2000) {
  let best = 0, bestLag = 0;
  for(let lag = Math.floor(SR / hi); lag <= Math.ceil(SR / lo); lag++) {
    let s = 0;
    for(let i = 0; i + lag < x.length; i++) s += x[i] * x[i + lag];
    if(s > best) { best = s; bestLag = lag; }
  }
  return SR / bestLag;
}

const voice = (inst, hz, extra = {}) => Synth.voice({ sr: SR, kind: 'melodic', inst, hz, vel: 0.8, gate: Infinity, seed: 7, packs: Samples.packs, ...extra });

for(const [engine, preset, tol] of [['chip', 'lead', 0.01], ['pluck', 'acoustic', 0.02], ['fm', 'e-piano', 0.01], ['organ', 'flute', 0.02], ['sample', 'piano', 0.03]]) {
  test(`${engine} plays in tune and below full scale`, () => {
    const inst = Instruments.make(engine, preset);
    inst.vibDepth = 0;
    const x = run(voice(inst, 220), SR / 2).subarray(SR / 10, SR / 2);
    const f = pitch(x);
    assert.ok(Math.abs(f / 220 - 1) < tol, `${engine}: ${f.toFixed(1)} Hz`);
    let peak = 0;
    for(const v of x) peak = Math.max(peak, Math.abs(v));
    assert.ok(peak > 0.05 && peak <= 1, `${engine} peak ${peak}`);
  });
}

test('gate releases a sustained note', () => {
  const inst = Instruments.make('chip', 'lead');
  const v = voice(inst, 440, { gate: SR * 0.1 });
  run(v, SR);
  assert.ok(v.done, 'voice ends after its release');
});

test('every synth drum ends by itself; sampled kit plays', () => {
  for(const mode of ['synth', 'sample']) {
    const kit = Instruments.makeKit(mode);
    kit.rows.forEach((row, r) => {
      const v = Synth.voice({ sr: SR, kind: 'drum', kit, pitch: r, vel: 1, seed: 3, packs: Samples.packs });
      const x = run(v, SR * 6);
      let peak = 0;
      for(const s of x) peak = Math.max(peak, Math.abs(s));
      assert.ok(v.done, `${mode} ${row.name} ends`);
      assert.ok(peak > 0.02 && peak <= 1.2, `${mode} ${row.name} peak ${peak}`);
    });
  }
});

test('glide starts from the previous note', () => {
  const inst = { ...Instruments.make('chip', 'lead'), glide: 0.2, vibDepth: 0, wave: 'sine' };
  const v = voice(inst, 440, { fromHz: 220 });
  const early = run(v, 2048);
  assert.ok(pitch(early.subarray(0, 2048), 150, 600) < 330);
  assert.ok(Math.abs(Theory.hz(69) - 440) < 1e-9);
});
