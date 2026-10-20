const test = require('node:test');
const assert = require('node:assert');
const { Project, Sfxr, Keymap, Wav } = require('./load.js');

test('starter project: three tracks with distinct ids and a beat', () => {
  const p = Project.create();
  assert.deepStrictEqual(p.tracks.map(t => t.id), [1, 2, 3]);
  assert.strictEqual(new Set(p.tracks.map(t => t.color)).size, 3);
  const drums = p.tracks.find(t => t.kind === 'drum');
  assert.ok(drums.clips.filter(Boolean).length > 0);
});

test('TOON round trip keeps everything (song, notes, keyboard tuning, sounds)', () => {
  const p = Project.create();
  p.patterns[0].notes.push({ step: 3, len: 2, pitch: 61, vel: 0.5, cents: -12 });
  p.keyboard = Keymap.make('One row');
  p.keyboard.keys[2].cents = 7;
  p.keyboard.keys[3].hz = 301.5;
  p.sfx.push(Sfxr.normalize({ id: 10, name: 'coin, big', gen: 'pickup', seed: 5, params: Sfxr.generate('pickup', 5), locks: ['duty'] }));
  p.mixes.push({ id: 11, name: 'mix', layers: [{ sfx: 10, delay: 30, vol: 80 }] });
  p.sets.push({ id: 12, name: 'set', items: [10, 11] });
  p.level.music = 'full';
  const text = Project.stringify(p);
  const q = Project.parse(text);
  assert.deepStrictEqual(q, Project.normalize(p));
  assert.strictEqual(q.sfx[0].name, 'coin, big');
  assert.strictEqual(q.keyboard.keys[3].hz, 301.5);
  assert.strictEqual(q.level.music, 'full');
});

test('normalize drops clips of foreign patterns and clamps values', () => {
  const p = Project.normalize({ song: { bpm: 999, bars: 4 }, tracks: [{ id: 1, kind: 'melodic', clips: [5, 0, 0, 0] }], patterns: [{ id: 5, track: 2 }] });
  assert.strictEqual(p.song.bpm, 300);
  assert.deepStrictEqual(p.tracks[0].clips, [0, 0, 0, 0]);
  assert.strictEqual(p.patterns.length, 0);
});

test('setBars keeps clips and clamps the loop', () => {
  const p = Project.create();
  p.song.loop = { on: true, from: 2, to: 8 };
  Project.setBars(p, 4);
  assert.strictEqual(p.tracks[2].clips.length, 4);
  assert.strictEqual(p.song.loop.to, 4);
});

test('WAV encode / decode (16-bit stereo, 8-bit mono)', () => {
  const x = Float32Array.from({ length: 100 }, (_, i) => Math.sin(i / 5) * 0.5);
  const st = Wav.decode(Wav.encode([x, x], 22050, 16));
  assert.strictEqual(st.rate, 22050);
  assert.strictEqual(st.channels.length, 2);
  assert.ok(Math.abs(st.channels[1][7] - x[7]) < 1e-4);
  const m = Wav.decode(Wav.encode([x], 8000, 8));
  assert.ok(Math.abs(m.channels[0][7] - x[7]) < 0.01);
  assert.strictEqual(Wav.resample(x, 44100, 22050).length, 50);
});

test('removePattern drops the pattern and clears its clips', () => {
  const p = Project.create();
  const drums = p.tracks.find(t => t.kind === 'drum');
  const pid = drums.clips.find(Boolean);
  Project.removePattern(p, pid);
  assert.ok(!p.patterns.some(x => x.id === pid));
  assert.ok(!drums.clips.includes(pid));
  assert.strictEqual(drums.clips.length, p.song.bars);
});
