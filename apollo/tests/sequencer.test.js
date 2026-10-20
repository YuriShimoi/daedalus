const test = require('node:test');
const assert = require('node:assert');
const { Project, Engine, Instruments, Samples } = require('./load.js');

function song() {
  const p = Project.create();
  p.song.bpm = 120;
  p.tracks = [p.tracks[0]];
  p.patterns = [p.patterns[0]];
  const t = p.tracks[0];
  t.inst = { ...Instruments.make('chip', 'arp'), d: 0.05, s: 0, r: 0.01 };
  t.clips.fill(0);
  t.clips[0] = t.clips[1] = p.patterns[0].id;
  p.patterns[0].notes = [0, 4, 8, 12].map(step => ({ step, len: 1, pitch: 72, vel: 1, cents: 0 }));
  return p;
}

/** Sample indexes where the signal rises after a quiet gap. */
function onsets(x, thr = 0.02, gap = 2000) {
  const out = [];
  let quiet = gap;
  for(let i = 0; i < x.length; i++) {
    if(Math.abs(x[i]) > thr) { if(quiet >= gap) out.push(i); quiet = 0; }
    else quiet++;
  }
  return out;
}

test('a 2-bar song renders notes at their steps', () => {
  const p = song(), r = Engine.render(p, Samples.packs, { from: 0, to: 2 });
  const step = 44100 * 60 / 120 / 4;   // 16th note at 120 bpm
  const got = onsets(r.L);
  const want = [0, 4, 8, 12, 16, 20, 24, 28].map(s => Math.round(s * step));
  assert.strictEqual(got.length, want.length, `onsets ${got}`);
  got.forEach((g, i) => assert.ok(Math.abs(g - want[i]) < 64, `note ${i}: ${g} vs ${want[i]}`));
});

test('mute silences a track, solo keeps only the soloed one', () => {
  const p = song();
  p.tracks[0].mute = true;
  let r = Engine.render(p, Samples.packs, { from: 0, to: 1 });
  assert.ok(r.L.every(v => v === 0));
  p.tracks[0].mute = false;
  const drums = Project.track(p, 'drum');
  p.tracks.push(drums);
  drums.solo = true;
  r = Engine.render(p, Samples.packs, { from: 0, to: 1 });
  assert.ok(r.L.every(v => v === 0), 'soloing an empty track silences the rest');
});

test('loop export has the exact loop length and wraps the tail', () => {
  const p = song();
  p.tracks[0].inst = { ...Instruments.make('pluck', 'acoustic') };
  p.patterns[0].notes[3].len = 4;   // rings past the loop end
  const r = Engine.render(p, Samples.packs, { from: 0, to: 2, loop: true });
  const barLen = 44100 * 60 / 120 * 4;
  assert.strictEqual(r.L.length, Math.round(2 * barLen));
  const plain = Engine.render(p, Samples.packs, { from: 0, to: 2 });
  assert.ok(plain.L.length > r.L.length, 'plain render keeps the release tail');
  assert.ok(Math.abs(r.L[10] - plain.L[10]) > 0 || plain.L.length === r.L.length, 'tail is added onto the start');
});

test('live notes play and stop on the engine', () => {
  const p = song(), e = new Engine(44100), L = new Float32Array(512), R = new Float32Array(512);
  e.setProject(p);
  e.handle({ t: 'on', id: 'a', ti: 0, pitch: 60, vel: 1 });
  e.process(L, R, 512);
  assert.ok(L.some(v => v !== 0));
  e.handle({ t: 'off', id: 'a' });
  for(let i = 0; i < 40; i++) e.process(L, R, 512);
  assert.strictEqual(e.voices.length, 0);
});

test('playback loops inside the loop range', () => {
  const p = song();
  p.song.loop = { on: true, from: 0, to: 1 };
  const e = new Engine(44100), L = new Float32Array(1024), R = new Float32Array(1024);
  e.setProject(p);
  e.play(0);
  for(let i = 0; i < 120; i++) e.process(L, R, 1024);   // ~2.8 s, the loop is 2 s
  assert.ok(e.pos < 44100 * 2, `pos ${e.pos}`);
  assert.ok(e.playing);
});
