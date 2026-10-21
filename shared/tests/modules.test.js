const test = require('node:test');
const assert = require('node:assert');
require('../core.js');
for(const f of ['cli', 'snap', 'viewport', 'store']) require(`../${f}.js`);
const { Cli, Snap, View, Store } = globalThis.DAE;

test('cli: parse keeps negative numbers as values and short options', () => {
  const a = Cli.parse(['render', 'x.toon', '--from', '-3', '--loop', '-o', 'out.wav', '--mono']);
  assert.deepStrictEqual(a, { _: ['render', 'x.toon'], from: '-3', loop: true, o: 'out.wav', mono: true });
  assert.strictEqual(Cli.parse(['--dir', '-d', 'sounds']).dir, true);
});

test('cli: op strings', () => {
  assert.deepStrictEqual(Cli.words(`note add '# A\\nb' name="My lead" x=1`), ['note', 'add', '# A\nb', 'name=My lead', 'x=1']);
  assert.deepStrictEqual(Cli.fields(['freq_ramp=-0.4', 'hat-closed:0', 'on=true', 'name=x']), { kv: { freq_ramp: -0.4, on: true, name: 'x' }, rest: ['hat-closed:0'] });
  assert.throws(() => Cli.number('abc', 'bpm'), /bpm: expected a number/);
});

test('cli: run handles help, unknown commands and errors', () => {
  const logs = [], log = console.log, err = console.error;
  console.log = console.error = m => logs.push(m);
  try {
    assert.strictEqual(Cli.run('t', 'HELP', { ok: () => 0, bad: () => { throw new Error('nope'); } }, ['ok']), 0);
    assert.strictEqual(Cli.run('t', 'HELP', {}, []), 1);
    assert.strictEqual(Cli.run('t', 'HELP', { bad: () => { throw new Error('nope'); } }, ['bad']), 1);
    assert.strictEqual(Cli.run('t', 'HELP', {}, ['zzz']), 1);
  } finally { console.log = log; console.error = err; }
  assert.ok(logs.includes('t bad: nope'));
});

test('snap: edges / centers first, grid otherwise, guides', () => {
  const others = [{ x: 100, y: 0, w: 50, h: 50 }];
  const s = Snap.move({ x: 0, y: 200, w: 40, h: 40 }, { x: 57, y: 3 }, others, { tol: 6, grid: 24 });
  assert.deepStrictEqual(s.off, { x: 60, y: -8 });   // right edge 97 -> 100 (other's left); top 203 -> grid line 192
  assert.deepStrictEqual(s.guides, [{ ax: 'x', at: 100, lo: 0, hi: 243 }]);
  assert.deepStrictEqual(Snap.move({ x: 0, y: 0, w: 0, h: 0 }, { x: 13, y: 0 }, [], { grid: 0 }).off, { x: 13, y: 0 });
  assert.strictEqual(Snap.value(148, 'x', others, { x: 0, y: 0, w: 10, h: 10 }, { tol: 4 }).v, 150);
  assert.strictEqual(Snap.value(37, 'y', others, { x: 0, y: 0, w: 10, h: 10 }, { tol: 4, grid: 24 }).v, 48);
});

test('viewport: zoom keeps the point under the cursor, fit, round trips', () => {
  const r = { left: 10, top: 20, width: 800, height: 600 }, v = View.make(-100, -50, 1);
  const before = View.toWorld(v, r, 300, 200);
  View.zoomAt(v, r, 2, 300, 200);
  const after = View.toWorld(v, r, 300, 200);
  assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9);
  assert.strictEqual(v.zoom, 2);
  const s = View.toScreen(v, r, after.x, after.y);
  assert.ok(Math.abs(s.x - 300) < 1e-9);
  View.fit(v, r, { x: 0, y: 0, w: 400, h: 100 }, { pad: 0, max: 10 });
  assert.strictEqual(v.zoom, 2);
  const c = View.toWorld(v, r, r.left + 400, r.top + 300);
  assert.deepStrictEqual([c.x, c.y], [200, 50]);
  View.pan(v, 20, 0);
  assert.strictEqual(v.x, -10);
});

test('store: recent-list helper', () => {
  const list = Store.push([{ name: 'a' }, { name: 'b' }], { name: 'b', t: 2 }, 2);
  assert.deepStrictEqual(list, [{ name: 'b', t: 2 }, { name: 'a' }]);
});
