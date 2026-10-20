const test = require('node:test');
const assert = require('node:assert');
const { Theory, Keymap } = require('./load.js');

test('note names, parsing and frequency', () => {
  assert.strictEqual(Theory.name(60), 'C4');
  assert.strictEqual(Theory.name(69), 'A4');
  assert.strictEqual(Theory.parse('A4'), 69);
  assert.strictEqual(Theory.parse('Db4'), 61);
  assert.strictEqual(Theory.parse('C#4'), 61);
  assert.ok(Math.abs(Theory.hz(69) - 440) < 1e-9);
  assert.ok(Math.abs(Theory.hz(69, 100) - Theory.hz(70)) < 1e-9);
  assert.ok(Theory.inScale(57, 'A', 'minor'));
  assert.ok(!Theory.inScale(58, 'A', 'minor'));
});

test('FL style template: two rows, octave keys, labels', () => {
  const t = Keymap.make('FL style', 48);
  assert.strictEqual(t.keys.length, 29);
  assert.strictEqual(t.keys[0].code, 'KeyZ');
  assert.strictEqual(t.keys[12].code, 'KeyQ');
  assert.strictEqual(t.keys[12].note, 60);
  assert.strictEqual(Keymap.find(t, 'KeyQ'), 12);
  assert.strictEqual(Keymap.label('Comma'), ',');
  assert.strictEqual(Keymap.label('Digit2'), '2');
});

test('binding moves a code, tuning offsets and Hz overrides', () => {
  const t = Keymap.make();
  Keymap.bind(t, 3, 'KeyZ');
  assert.strictEqual(t.keys[0].code, '');
  assert.strictEqual(t.keys[3].code, 'KeyZ');
  t.keys[4].cents = -14;
  assert.ok(Math.abs(Keymap.hz(t, 4) - Theory.hz(52, -14)) < 1e-9);
  t.keys[5].hz = 333;
  assert.strictEqual(Keymap.hz(t, 5), 333);
  assert.ok(Math.abs(Keymap.hz(t, 5, 12) - 666) < 1e-9);
  Keymap.just(t, 0);
  assert.ok(Math.abs(t.keys[4].cents - -13.69) < 1e-9);   // E over C: pure third
  assert.strictEqual(t.keys[5].hz, 0);
  Keymap.equal(t);
  assert.ok(t.keys.every(k => k.cents === 0 && k.hz === 0));
});

test('normalize keeps a custom template and fills gaps', () => {
  const t = Keymap.normalize({ name: 'mine', root: 36, keys: [{ code: 'KeyA', note: 40, cents: '5' }, {}] });
  assert.strictEqual(t.name, 'mine');
  assert.strictEqual(t.keys[0].cents, 5);
  assert.strictEqual(t.keys[1].note, 37);
  assert.strictEqual(Keymap.normalize(null).keys.length, 29);
});
