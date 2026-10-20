const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { main } = require('../cli.js');
const Edit = require('../src/cli/edit.js');
const { Project, Toon } = require('./load.js');

const quiet = fn => {
  const log = console.log, err = console.error;
  console.log = console.error = () => {};
  try { return fn(); } finally { console.log = log; console.error = err; }
};

test('words keep quoted text together', () => {
  assert.deepStrictEqual(Edit.words('track add melodic name="My lead" vol=0.5'), ['track', 'add', 'melodic', 'name=My lead', 'vol=0.5']);
});

test('song, tracks and patterns', () => {
  const p = Project.create();
  Edit.apply(p, ['song bpm=150 key=D scale=major bars=8 loop=2-3', 'track add melodic name=Keys engine=organ preset=jazz', 'track set Keys vol=0.5 volume=0.4 drawbars=8,0,8,0,0,0,0,0,0',
    'pattern add Keys bars=4', 'pattern set Keys:2 bars=12', 'track up Keys']);
  assert.strictEqual(p.song.bpm, 150);
  assert.deepStrictEqual(p.song.loop, { on: true, from: 1, to: 3 });
  assert.strictEqual(p.tracks[0].clips.length, 8);
  const keys = p.tracks.find(t => t.name === 'Keys');
  assert.strictEqual(p.tracks.indexOf(keys), 2);
  assert.strictEqual(keys.inst.preset, 'jazz');
  assert.strictEqual(keys.vol, 0.5);
  assert.strictEqual(keys.inst.vol, 0.4);
  assert.deepStrictEqual(keys.inst.drawbars, [8, 0, 8, 0, 0, 0, 0, 0, 0]);
  assert.strictEqual(p.patterns.filter(x => x.track === keys.id)[1].bars, 8);   // clamped
  assert.throws(() => Edit.apply(p, ['track set Keys preset=nope']), /organ presets/);
  assert.throws(() => Edit.apply(p, ['song key=H']), /song key=H/);
});

test('notes: melodic names, drum rows and step ranges', () => {
  const p = Project.create();
  Edit.apply(p, ['notes set Lead:1 C4:0:4 Eb4:4:2:0.5:-10 G4:8:20', 'notes set Drums:1 kick:0-15/4 snare:4,12:1']);
  const lead = p.patterns.find(x => x.track === 1), drums = p.patterns.find(x => x.track === 3);
  assert.deepStrictEqual(lead.notes.map(n => [n.step, n.len, n.pitch]), [[0, 4, 60], [4, 2, 63], [8, 8, 67]]);   // length cut at the pattern end
  assert.strictEqual(lead.notes[1].cents, -10);
  assert.strictEqual(drums.notes.length, 6);
  assert.ok(drums.notes.some(n => n.pitch === 1 && n.step === 12 && n.vel === 1));
  Edit.apply(p, ['notes remove Drums:1 kick:0,4', 'pattern transpose Lead:1 12']);
  assert.strictEqual(drums.notes.length, 4);
  assert.strictEqual(lead.notes[0].pitch, 72);
  assert.throws(() => Edit.apply(p, ['notes add Lead:1 C4:16']), /outside the pattern/);
  assert.throws(() => Edit.apply(p, ['notes add Drums:1 cowbell:0']), /bad drum row/);
});

test('clips: long patterns placed once per length, 0 clears, removal clears clips', () => {
  const p = Project.create();
  Edit.apply(p, ['pattern add Lead bars=2', 'clip Lead 1-6 :2', 'clip Drums 3 0']);
  const lead = p.tracks[0], pid = p.patterns.filter(x => x.track === 1)[1].id;
  assert.deepStrictEqual(lead.clips.slice(0, 7), [pid, 0, pid, 0, pid, 0, 0]);
  assert.strictEqual(p.tracks[2].clips[2], 0);
  Edit.apply(p, [`pattern remove ${pid}`]);
  assert.ok(!lead.clips.includes(pid));
  assert.throws(() => Edit.apply(p, ['clip Lead 1 Drums:1']), /another track/);
});

test('kit, keyboard and export', () => {
  const p = Project.create();
  Edit.apply(p, ['kit set Drums mode=sample', 'kit row Drums snare vol=0.3 tune=0.8', 'keys template "One row" root=C4', 'keys bind C4 q', 'keys tune 1 cents=-20', 'export rate=22050 bits=8']);
  assert.strictEqual(p.tracks[2].kit.mode, 'sample');
  assert.strictEqual(p.tracks[2].kit.rows[1].tune, 0.8);
  assert.strictEqual(p.keyboard.name, 'One row');
  assert.strictEqual(p.keyboard.keys[0].note, 60);
  assert.strictEqual(p.keyboard.keys[0].code, 'KeyQ');
  assert.strictEqual(p.keyboard.keys[1].cents, -20);
  Edit.apply(p, ['keys just C']);
  assert.notStrictEqual(p.keyboard.keys[4].cents, 0);
  assert.deepStrictEqual(p.export, { rate: 22050, bits: 8, normalize: true });
});

test('sounds, mixes and sets', () => {
  const p = Project.create('sfx');
  Edit.apply(p, ['sfx add jump seed=5', 'sfx set jump_01 wave=sine base_freq=0.6 freq_ramp=-2 lock=base_freq', 'sfx generate jump_01 seed=9',
    'sfx variants jump_01 n=2', 'mix add hop layers=jump_01@0:100,jump_v1@50:70', 'set add picks items=jump_01,hop']);
  const s = p.sfx.find(x => x.name === 'jump_01');
  assert.strictEqual(s.params.base_freq, 0.6);   // locked through generate
  assert.strictEqual(s.seed, 9);
  assert.strictEqual(p.sfx.length, 3);
  assert.deepStrictEqual(p.mixes[0].layers[1], { sfx: p.sfx[1].id, delay: 50, vol: 70 });
  assert.strictEqual(p.sets.length, 2);
  Edit.apply(p, ['sfx remove jump_v1']);
  assert.strictEqual(p.mixes[0].layers[1].sfx, 0);
  assert.deepStrictEqual(Edit.check(Project.parse(Project.stringify(p))), []);
});

test('cli: new, edit, extract / apply, code / paste, convert round trip', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-edit-'));
  const f = path.join(dir, 'p.toon'), pre = path.join(dir, 'pre.toon'), kit = path.join(dir, 'kit.toon');
  assert.strictEqual(quiet(() => main(['new', '--bpm', '90', '--empty', '-o', f])), 0);
  assert.strictEqual(quiet(() => main(['edit', f, 'track add drum', 'track set Lead engine=pluck preset=nylon', 'sfx add pickup seed=2'])), 0);
  let p = Project.parse(fs.readFileSync(f, 'utf8'));
  assert.strictEqual(p.song.bpm, 90);
  assert.strictEqual(p.tracks.length, 2);
  assert.strictEqual(p.tracks[0].inst.preset, 'nylon');

  assert.strictEqual(quiet(() => main(['extract', f, '--inst', 'Lead', '-o', pre])), 0);
  assert.strictEqual(quiet(() => main(['extract', f, '--kit', 'Drums', '-o', kit])), 0);
  assert.ok(Toon.decode(fs.readFileSync(pre, 'utf8')).apolloPreset);
  assert.strictEqual(quiet(() => main(['edit', f, 'track add melodic name=Two', 'kit row Drums kick vol=0.1'])), 0);
  assert.strictEqual(quiet(() => main(['apply', f, pre, '--track', 'Two'])), 0);
  assert.strictEqual(quiet(() => main(['apply', f, kit])), 0);
  p = Project.parse(fs.readFileSync(f, 'utf8'));
  assert.strictEqual(p.tracks.find(t => t.name === 'Two').inst.engine, 'pluck');
  assert.strictEqual(p.tracks.find(t => t.kind === 'drum').kit.rows[0].vol, 0.9);   // kit restored

  let code = '';
  const log = console.log;
  console.log = x => { code = x; };
  try { main(['code', f, '--name', 'pickup_01']); } finally { console.log = log; }
  assert.ok(code.startsWith('apollo-sfx:'));
  assert.strictEqual(quiet(() => main(['edit', f, `sfx paste ${code} name=copy`])), 0);
  p = Project.parse(fs.readFileSync(f, 'utf8'));
  assert.deepStrictEqual(p.sfx[1].params, p.sfx[0].params);

  const js = path.join(dir, 'p.json');
  assert.strictEqual(quiet(() => main(['convert', f, '--to', 'json', '-o', js])), 0);
  assert.deepStrictEqual(Project.parse(fs.readFileSync(js, 'utf8')), p);
  assert.strictEqual(quiet(() => main(['edit', f, 'nope'])), 1);
});
