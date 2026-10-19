const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const cli = path.join(__dirname, '..', 'cli.js');
const S = f => path.join(__dirname, '..', 'samples', f);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-'));
const run = (...args) => {
  try { return { code: 0, out: execFileSync('node', [cli, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch(e) { return { code: e.status, out: e.stdout + e.stderr }; }
};

test('check exit codes: 0 enemy-free, 3 needs combat, 2 unsolvable', () => {
  assert.equal(run('check', S('events.toon')).code, 0);
  assert.equal(run('check', S('tutorial.toon')).code, 3);
  assert.equal(run('check', S('locked.toon')).code, 2);
  const json = JSON.parse(run('check', S('locked.toon'), '--json').out);
  assert.equal(json.verdict, 'locks');
});

test('solve: routes printed, -o saves solutions, unsolvable exits 2', () => {
  const out = path.join(tmp, 'solved.toon');
  const r = run('solve', S('waves.toon'), '--top', '3', '-o', out);
  assert.equal(r.code, 0);
  assert.match(r.out, /^solved/);
  assert.match(fs.readFileSync(out, 'utf8'), /solutions\[\d\]\{id,steps\}:/);
  assert.equal(run('solve', S('locked.toon')).code, 2);
});

test('validate, play, convert, render, gen', () => {
  assert.equal(run('validate', S('tutorial.toon')).code, 0);
  const bad = path.join(tmp, 'bad.toon');
  fs.writeFileSync(bad, 'dae: 1\nrooms[1]{id}:\n  r0\n');
  assert.equal(run('validate', bad).code, 1);
  assert.equal(run('play', S('tutorial.toon'), '--steps', 'take sword;move r1').code, 0);
  assert.equal(run('play', S('tutorial.toon'), '--steps', 'move r3').code, 1);
  const json = path.join(tmp, 't.json');
  assert.equal(run('convert', S('tutorial.toon'), '--to', 'json', '-o', json).code, 0);
  assert.equal(run('convert', json, '--to', 'toon').out, run('convert', S('tutorial.toon'), '--to', 'toon').out);
  const svg = path.join(tmp, 'm.svg');
  assert.equal(run('render', S('tutorial.toon'), '-o', svg, '--steps', 'move r1').code, 0);
  assert.match(fs.readFileSync(svg, 'utf8'), /^<svg/);
  const gen = path.join(tmp, 'g.toon');
  assert.equal(run('gen', '--seed', '4', '--rooms', '12', '-o', gen).code, 0);
  assert.equal(run('check', gen).code === 1, false);
  assert.equal(run('nope').code, 1);
});

test('edit: add, set, link, remove; layout writes positions; render uses them', () => {
  const e = path.join(tmp, 'e.toon');
  assert.equal(run('edit', S('tutorial.toon'), 'add rooms r9 weight=2', 'link r3 r9 dir=a>b lock=key:red', 'set items potion heal=12', 'set player hp=40', '-o', e).code, 0);
  const { Model } = require('./load.js');
  const m = Model.parse(fs.readFileSync(e, 'utf8'));
  assert.equal(m.rooms.find(r => r.id === 'r9').weight, 2);
  assert.deepEqual(m.passages.at(-1), { id: m.passages.at(-1).id, a: 'r3', b: 'r9', dir: 'a>b', lock: [{ t: 'key', v: 'red' }] });
  assert.equal(m.items.find(t => t.id === 'potion').heal, 12);
  assert.equal(m.player.hp, 40);
  const gone = Model.parse(run('edit', e, 'remove rooms r9').out);
  assert.equal(gone.rooms.some(r => r.id === 'r9') || gone.passages.some(g => g.b === 'r9'), false, 'room and its passages removed');
  assert.equal(run('edit', e, 'set rooms nope weight=1').code, 1);
  assert.equal(run('edit', e, 'fly away').code, 1);

  const l = path.join(tmp, 'l.toon');
  assert.equal(run('layout', e, '-o', l).code, 0);
  const placed = Model.parse(fs.readFileSync(l, 'utf8'));
  assert.ok(placed.rooms.every(r => r.x % 40 === 0 && r.y % 40 === 0), 'every room on the grid');
  fs.writeFileSync(l, fs.readFileSync(l, 'utf8').replace(/^(  r0,.*?),\d+,\d+$/m, '$1,2000,120'));
  assert.match(run('render', l).out, /viewBox="0 0 (\d{4})/, 'a far saved position widens the picture');
});

test('play: --at shows an earlier state, --save stores the route', () => {
  assert.match(run('play', S('tutorial.toon'), '--steps', 'take sword;move r1', '--at', '1').out, /^room r0/m);
  const s = path.join(tmp, 's.toon');
  assert.equal(run('play', S('tutorial.toon'), '--steps', 'take sword', '--save', 'mine', '-o', s).code, 0);
  assert.match(fs.readFileSync(s, 'utf8'), /solutions\[1\]\{id,steps\}:\n  mine,take sword/);
  assert.equal(run('play', S('tutorial.toon'), '--steps', 'move r3', '--save', '-o', s).code, 1);
});
