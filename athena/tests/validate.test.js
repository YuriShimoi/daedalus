const test = require('node:test');
const assert = require('node:assert/strict');
const { Model, Validate } = require('./load.js');

const base = `dae: 1
items[1]{id,key}:
  k,red
enemies[1]{id,hp}:
  rat,5
rooms[2]{id,flags,enemies}:
  r0,entry,
  r1,exit,rat
passages[1]{id,a,b}:
  p0,r0,r1
`;
const codes = (text, extra = '') => {
  const v = Validate.run(Model.parse(text + extra));
  return { e: v.errors.map(x => x.code), w: v.warnings.map(x => x.code) };
};

test('a small valid map', () => {
  assert.deepEqual(codes(base), { e: [], w: [] });
});

test('missing entry and exit', () => {
  const { e } = codes('dae: 1\nrooms[1]{id}:\n  r0\n');
  assert.deepEqual(e, ['entry', 'exit']);
});

test('unknown references are errors', () => {
  const { e } = codes(base, `chests[1]{id,items,lock}:
  c0,ghostitem,item:nope
events[2]{id,room,do}:
  ev0,r9,unlock:p7+give:zz+fx+:nofx@nobody+spawn:dragon@r1:0+kill:player
  ev1,r1,dance:1
recipes[1]{in,out,builder}:
  k,missing,forge
`);
  for(const code of ['ref-item', 'ref-room', 'ref-lock', 'ref-effect', 'ref-target', 'ref-enemy', 'action', 'value'])
    assert.ok(e.includes(code), `has ${code}: ${e}`);
});

test('bad values and duplicates', () => {
  const { e } = codes(`dae: 1
player:
  hp: 0
  slots[2]{id,mode}:
    hand,glued
    hand,free
effects[1]{id,dur}:
  x,forever
items[1]{id,slot,target,key,keyUses}:
  a,leg,both,red,0
rooms[2]{id,flags,mark}:
  r0,entry,urgent
  r0,exit,
passages[1]{id,a,b,dir}:
  p0,r0,r0,b>a
`);
  for(const code of ['value', 'id-dup', 'ref-slot', 'passage-loop'])
    assert.ok(e.includes(code), `has ${code}: ${e}`);
});

test('warnings: unreachable, missing key, no slots', () => {
  const { e, w } = codes(`dae: 1
player:
  inventory: false
rooms[3]{id,flags}:
  r0,entry
  r1,exit
  r2,
passages[2]{id,a,b,dir,lock}:
  p0,r0,r1,,key:blue
  p1,r2,r0,a>b,
`);
  assert.deepEqual(e, []);
  assert.deepEqual(w.sort(), ['key-none', 'no-slots', 'unreachable']);
});

test('kill conditions accept types and instances', () => {
  const { e } = codes(base, 'events[1]{id,room,if,do}:\n  ev0,r1,kill:r1.1+kill:rat,fx-:x@r1.1\neffects[1]{id}:\n  x\n');
  assert.deepEqual(e, []);
});

test('key supply: leftover keys warn, matched keys do not', () => {
  const map = extra => Model.parse(`dae: 1
items[2]{id,key,keyUses}:
  k,red,${extra.uses ?? 1}
  part,,
rooms[3]{id,flags,items,chests,builders}:
  r0,entry,${extra.r0 ?? 'k'},c0,
  r1,,,,${extra.r1 ?? ''}
  r2,exit,,,
chests[1]{id,items}:
  c0,${extra.chest ?? ''}
passages[2]{id,a,b,lock}:
  p0,r0,r1,key:red
  p1,r1,r2,${extra.lock2 ?? ''}
${extra.recipe ?? ''}`);
  const extra = m => Validate.run(m).warnings.filter(w => w.code === 'key-extra');
  assert.equal(extra(map({})).length, 0, 'one key, one lock');
  assert.equal(extra(map({ chest: 'k' })).length, 1, 'a second copy in a chest in the same room');
  assert.equal(extra(map({ r0: 'k+k' })).length, 1, 'two copies side by side');
  assert.equal(extra(map({ chest: 'k', lock2: 'key:red' })).length, 0, 'two keys, two locks');
  assert.equal(extra(map({ uses: 2 })).length, 1, 'two uses, one lock');
  assert.equal(extra(map({ chest: 'part', recipe: 'recipes[1]{in,out}:\n  part,k' })).length, 1, 'a crafted second copy, same room');
  assert.equal(extra(map({ chest: 'part', recipe: 'recipes[1]{in,out,builder}:\n  part,k,anvil', r1: 'anvil' })).length, 0, 'a crafted copy further in: shortcut');
  assert.equal(extra(map({ uses: 'inf', lock2: 'key:red' })).length, 0, 'one master key');
  assert.equal(extra(map({ uses: 'inf', chest: 'k' })).length, 1, 'two master keys');
});
