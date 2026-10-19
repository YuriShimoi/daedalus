const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Model, Validate, Toon } = require('./load.js');

const dir = path.join(__dirname, '..', 'samples');
const samples = fs.readdirSync(dir).filter(f => f.endsWith('.toon'));

for(const file of samples) {
  test(`sample ${file}: valid and round-trips`, () => {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    const m = Model.parse(text);
    const v = Validate.run(m);
    assert.deepEqual(v.errors, [], 'no validation errors');
    const out = Model.stringify(m);
    assert.deepEqual(Model.parse(out), m, 'model -> toon -> model');
    assert.equal(Model.stringify(Model.parse(out)), out, 'stable output');
    const json = JSON.stringify(m);
    assert.deepEqual(Model.fromDoc(Model.toDoc(JSON.parse(json))), m, 'json round trip');
    assert.ok(out.length < json.length / 2, `toon (${out.length}) much smaller than json (${json.length})`);
  });
}

test('empty model has defaults and a tiny file', () => {
  const m = Model.empty();
  assert.equal(m.player.hp, 30);
  assert.equal(m.player.inventory, true);
  assert.equal(m.rules.maxRoomVisits, 4);
  assert.equal(Model.stringify(m), 'dae: 1\n');
});

test('cell syntax: conditions, actions, foes', () => {
  assert.deepEqual(Model.parseCond('stat:str=5'), { t: 'stat', v: 'str', n: 5 });
  assert.deepEqual(Model.parseCond('key:red'), { t: 'key', v: 'red' });
  assert.deepEqual(Model.actionList('unlock:p1+fx+:rage@player+fx-:ward@r2.1+spawn:rat@r2:2+spawn:bat@r3'), [
    { op: 'unlock', v: 'p1' },
    { op: 'fx+', v: 'rage', target: 'player' },
    { op: 'fx-', v: 'ward', target: 'r2.1' },
    { op: 'spawn', v: 'rat', room: 'r2', wave: 2 },
    { op: 'spawn', v: 'bat', room: 'r3', wave: 1 },
  ]);
  for(const s of ['spawn:rat@r2:2', 'spawn:bat@r3', 'fx+:a@player', 'kill:r2.1', 'take:x'])
    assert.equal(Model.actionStr(Model.parseAction(s)), s);
  assert.deepEqual(Model.parseFoe('ogre:2'), { type: 'ogre', wave: 2 });
  const room = { id: 'r2', enemies: ['rat', 'ogre:2'].map(Model.parseFoe) };
  assert.deepEqual(Model.foes(room).map(f => f.iid), ['r2.1', 'r2.2']);
});

test('tutorial sample reads as planned', () => {
  const m = Model.parse(fs.readFileSync(path.join(dir, 'tutorial.toon'), 'utf8'));
  const ix = Model.index(m);
  assert.equal(m.score.mode, 'weighted');
  assert.deepEqual(m.player.slots, [{ id: 'hand', mode: 'hold-drop' }, { id: 'body', mode: 'fixed' }]);
  assert.deepEqual(ix.rooms.get('r2').enemies, [{ type: 'rat', wave: 1 }, { type: 'ghost', wave: 1 }, { type: 'ogre', wave: 2 }]);
  assert.equal(ix.passages.get('p2').dir, 'a>b');
  assert.deepEqual(ix.passages.get('p3').lock, [{ t: 'key', v: 'red' }]);
  assert.deepEqual(ix.items.get('holywater'), {
    id: 'holywater', slot: null, hp: 0, str: 0, def: 0, uses: 1, heal: 0, key: null, keyUses: 1,
    breakOnDrop: false, addFx: [], delFx: ['ward'], target: 'one', onHit: [], weight: null,
  });
  assert.deepEqual(ix.effects.get('rage'), { id: 'rage', hp: 0, str: 3, def: 0, invuln: false, dur: 2 });
  assert.deepEqual(ix.events.get('ev1').if, [{ t: 'kill', v: 'ogre' }]);
});

test('room positions are optional and round-trip', () => {
  const m = Model.parse('dae: 1\nrooms[2]{id,flags,x,y}:\n  r0,entry,120,240\n  r1,exit,,\n');
  assert.deepEqual([m.rooms[0].x, m.rooms[0].y, m.rooms[1].x], [120, 240, null]);
  const text = Model.stringify(m);
  assert.match(text, /rooms\[2\]\{id,flags,x,y\}/);
  assert.deepEqual(Model.parse(text), m);
  assert.doesNotMatch(Model.stringify(Model.parse('dae: 1\nrooms[1]{id}:\n  r0\n')), /x,y/, 'no columns without positions');
});
