const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
require('../core.js');
require('../toon.js');
require('../rng.js');
const { Toon, Rng, History } = require('../history.js');

test('toon: objects, inline arrays, tables, lists', () => {
  const doc = {
    a: 1, b: 'text', c: true, d: null, e: -2.5,
    nested: { x: 'y', deeper: { z: 0 } },
    tags: ['p', 'q', 3],
    empty: [],
    rows: [{ id: 'r0', v: 1 }, { id: 'r1', w: 'x' }],
    mixed: [1, { k: 'v', n: 2 }, 'z'],
  };
  const back = Toon.decode(Toon.encode(doc));
  assert.deepEqual(back, { ...doc, rows: [{ id: 'r0', v: 1 }, { id: 'r1', w: 'x' }] });
});

test('toon: strings that need quotes survive', () => {
  const tricky = ['', ' pad', 'a,b', 'say "hi"', 'back\slash', 'line\nbreak', 'true', 'null', '42', '-1e3', '- dash', 'k: v', 'ogre:2', 'fx+:a@b'];
  const doc = { list: tricky, rows: tricky.map(s => ({ s })) };
  const back = Toon.decode(Toon.encode(doc));
  assert.deepEqual(back.list, tricky);
  // '' in a table cell is quoted, so it stays '' (an empty cell would mean "missing")
  assert.deepEqual(back.rows.map(r => r.s), tricky);
  assert.equal(Toon.str('ogre:2'), 'ogre:2');
});

test('toon: errors name the line', () => {
  assert.throws(() => Toon.decode('a: 1\n   b: 2'), /line 2/);
  assert.throws(() => Toon.decode('t[2]{a,b}:\n  1,2'), /line 1: table has 1 rows/);
  assert.throws(() => Toon.decode('t[1]{a,b}:\n  1'), /line 2: 1 cells/);
  assert.throws(() => Toon.decode('x[3]: 1,2'), /2 items, expected 3/);
});

test('rng: seeded and repeatable', () => {
  const a = new Rng('seed'), b = new Rng('seed');
  const seq = () => [a.next(), a.int(1, 6), a.pick(['x', 'y'])];
  assert.deepEqual(seq(), [b.next(), b.int(1, 6), b.pick(['x', 'y'])]);
  for(let i = 0; i < 200; i++) {
    const n = a.int(2, 4);
    assert.ok(n >= 2 && n <= 4);
  }
});

test('history: undo, redo, limit', () => {
  const h = new History(2);
  h.push(1); h.push(2); h.push(3);
  assert.equal(h.undo(4), 3);
  assert.equal(h.undo(3), 2);
  assert.equal(h.undo(2), undefined);
  assert.equal(h.redo(2), 3);
  h.push(9);
  assert.equal(h.canRedo, false);
});

test('icons: sprite bundled, nothing loaded from outside the project', () => {
  const root = path.join(__dirname, '..', '..');
  const { Icons } = require('../icons.js');
  assert.ok((Icons.sprite.match(/<symbol /g) || []).length >= 30);
  const files = [];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    if(e.name === 'node_modules' || e.name.startsWith('.')) return;
    const p = path.join(d, e.name);
    if(e.isDirectory()) walk(p);
    else if(/\.(js|html|css)$/.test(e.name) && !p.includes('tests')) files.push(p);
  });
  walk(root);
  for(const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    assert.ok(!/(src|href)=["']?(https?:)?\/\//i.test(s), `${f} loads a remote file`);
    assert.ok(!/url\(\s*["']?(https?:)?\/\//i.test(s), `${f} loads a remote file in css`);
    assert.ok(!/[A-Z]:[\/]/.test(s), `${f} has an absolute path`);
  }
});
