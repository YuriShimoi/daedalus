const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Model, Check } = require('./load.js');

const sample = f => Model.parse(fs.readFileSync(path.join(__dirname, '..', 'samples', f), 'utf8'));
const map = text => Model.parse('dae: 1\n' + text);

test('no path: exit not linked', () => {
  const r = Check.run(map('rooms[3]{id,flags}:\n  r0,entry\n  r1,\n  r2,exit\npassages[1]{id,a,b}:\n  p0,r0,r1\n'));
  assert.equal(r.verdict, 'no-path');
  assert.equal(r.label, 'unsolvable (no path)');
});

test('no path: one-way passage the wrong way', () => {
  const r = Check.run(map('rooms[2]{id,flags}:\n  r0,entry\n  r1,exit\npassages[1]{id,a,b,dir}:\n  p0,r1,r0,a>b\n'));
  assert.equal(r.verdict, 'no-path');
});

test('no path: required room cut off', () => {
  const r = Check.run(map('rooms[3]{id,flags,mark}:\n  r0,entry,\n  r1,exit,\n  r2,,required\npassages[1]{id,a,b}:\n  p0,r0,r1\n'));
  assert.equal(r.verdict, 'no-path');
  assert.deepEqual(r.blockers.map(b => b.id), ['r2']);
});

test('locks: key behind its own door, blockers listed', () => {
  const r = Check.run(sample('locked.toon'));
  assert.equal(r.verdict, 'locks');
  const ids = r.blockers.map(b => b.id).sort();
  assert.deepEqual(ids, ['c0', 'p1', 'p2']);
  assert.deepEqual(r.blockers.find(b => b.id === 'p2').need, ['key:red']);
  assert.deepEqual(r.blockers.find(b => b.id === 'c0').need, ['key:blue']);
});

test('locks: recipe needs a builder that is never reached', () => {
  const r = Check.run(map(`items[3]{id,key}:
  a,
  b,
  k,gold
rooms[3]{id,flags,items,builders}:
  r0,entry,a+b,
  r1,exit,,
  r2,,,forge
passages[2]{id,a,b,lock}:
  p0,r0,r1,key:gold
  p1,r1,r2,
recipes[1]{in,out,builder}:
  a+b,k,forge
`));
  assert.equal(r.verdict, 'locks');
});

test('optimistic: kill lock and drop key count as reachable', () => {
  const r = Check.run(map(`items[1]{id,key}:
  k,red
enemies[1]{id,hp,str,drop}:
  ogre,5,1,k
rooms[3]{id,flags,enemies}:
  r0,entry,
  r1,,ogre
  r2,exit,
passages[2]{id,a,b,lock}:
  p0,r0,r1,
  p1,r1,r2,key:red+kill:ogre
`));
  assert.equal(r.verdict, 'combat');
});

test('optimistic: unlock event opens a passage with an impossible key', () => {
  const r = Check.run(map(`rooms[3]{id,flags}:
  r0,entry
  r1,
  r2,exit
passages[2]{id,a,b,lock}:
  p0,r0,r1,
  p1,r1,r2,key:none
events[1]{id,room,do}:
  ev0,r1,unlock:p1
`));
  assert.equal(r.verdict, 'no-enemies');
  assert.deepEqual(r.route, ['move r1', 'move r2']);
});

test('no enemies: route avoids the guarded room', () => {
  const r = Check.run(map(`enemies[1]{id,hp,str}:
  orc,10,3
rooms[4]{id,flags,enemies}:
  r0,entry,
  r1,,orc
  r2,,
  r3,exit,
passages[4]{id,a,b}:
  p0,r0,r1
  p1,r1,r3
  p2,r0,r2
  p3,r2,r3
`));
  assert.equal(r.verdict, 'no-enemies');
  assert.deepEqual(r.route, ['move r2', 'move r3']);
});

test('no enemies: key with one use, two doors -> only one opens', () => {
  const r = Check.run(map(`items[1]{id,key,keyUses}:
  k,red,1
rooms[3]{id,flags,items}:
  r0,entry,k
  r1,,
  r2,exit,
passages[2]{id,a,b,lock}:
  p0,r0,r1,key:red
  p1,r1,r2,key:red
`));
  // optimistic says reachable (infinite keys), exact search says the real key runs out
  assert.equal(r.verdict, 'no-route');
});

test('needs combat: the only way is through enemies', () => {
  assert.equal(Check.run(sample('tutorial.toon')).verdict, 'combat');
  assert.equal(Check.run(sample('waves.toon')).verdict, 'combat');
});

test('events sample is solvable without enemies', () => {
  const r = Check.run(sample('events.toon'));
  assert.equal(r.verdict, 'no-enemies');
  assert.deepEqual(r.route, ['move r1', 'move r4', 'move r5']);
});
