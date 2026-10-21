const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Board, Obsidian } = require('./load.js');
const { main } = require('../cli.js');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const MAP = fs.readFileSync(path.join(__dirname, '../samples/tutorial.toon'));
const vault = { 'Keep.md': '---\ntags: [a]\n---\n# The Keep\nSee [[Boss]] and [[Lore/Door|the door]].\n![[pic.png]]', 'Boss.md': 'Boss of act 1.', 'Lore/Door.md': '# Door\nBack to [[Keep#Forge]].', 'img/pic.png': PNG, 'maps/m.toon': MAP };
const read = p => {
  const key = Object.keys(vault).find(k => k === p) ?? Object.keys(vault).find(k => k.split('/').pop().toLowerCase() === String(p).split('/').pop().toLowerCase());
  return key ? new Uint8Array(Buffer.from(vault[key])) : null;
};
const canvas = {
  nodes: [
    { id: 'g', type: 'group', x: -20, y: -20, width: 700, height: 300, label: 'Act 1', color: '5' },
    { id: 't', type: 'text', x: 0, y: 0, width: 200, height: 100, text: 'Go to [[Boss]]', color: '1' },
    { id: 'f', type: 'file', x: 240, y: 0, width: 200, height: 160, file: 'Keep.md' },
    { id: 'i', type: 'file', x: 480, y: 0, width: 100, height: 100, file: 'img/pic.png' },
    { id: 'm', type: 'file', x: 0, y: 400, width: 400, height: 300, file: 'maps/m.toon' },
    { id: 'x', type: 'file', x: 500, y: 400, width: 100, height: 60, file: 'gone.pdf' },
    { id: 'l', type: 'link', x: 700, y: 400, width: 200, height: 60, url: 'https://obsidian.md' },
  ],
  edges: [{ id: 'e1', fromNode: 't', toNode: 'f', label: 'read', color: '4' }, { id: 'e2', fromNode: 'f', toNode: 'nope' }],
};

test('canvas -> board: every node type, colors, groups, links', () => {
  const b = Obsidian.fromCanvas(JSON.stringify(canvas), { read });
  const kinds = b.items.map(i => i.kind).sort();
  assert.deepStrictEqual(kinds, ['group', 'image', 'note', 'note', 'note', 'note', 'widget']);
  const g = b.items.find(i => i.kind === 'group');
  assert.strictEqual(g.label, 'Act 1');
  assert.strictEqual(g.color, '#8BE9FD');
  assert.strictEqual(g.items.length, 3);   // text, Keep.md, image; the map lies outside
  const t = b.items.find(i => i.md?.startsWith('Go to'));
  assert.strictEqual(t.md, 'Go to **Boss**');
  assert.strictEqual(t.color, '#FF5555');
  const keep = b.items.find(i => i.md?.includes('The Keep'));
  assert.ok(!keep.md.includes('tags:'), 'front matter removed');
  assert.ok(/!\[pic\]\(asset:a\d+\)/.test(keep.md), 'embedded image becomes an asset');
  assert.ok(keep.md.includes('**the door**'));
  assert.strictEqual(b.items.find(i => i.kind === 'widget').tool, 'athena');
  assert.ok(b.items.some(i => i.md?.includes('not found in the vault')));
  assert.deepStrictEqual(b.edges.map(e => [e.label, e.color]), [['read', '#50FA7B']]);   // the edge to a missing node is dropped
  assert.strictEqual(b.assets.length, 2);   // the png once (note embed + image node), the map
  assert.deepStrictEqual(Board.parse(Board.stringify(b)).items, b.items);
});

test('vault -> board: a card per note, folder groups, wikilink links', () => {
  const notes = Object.entries(vault).filter(([p]) => p.endsWith('.md')).map(([p, text]) => ({ path: p, text }));
  const b = Obsidian.fromVault(notes, { read, name: 'MyVault' });
  const cards = b.items.filter(i => i.kind === 'note');
  assert.strictEqual(cards.length, 3);
  assert.ok(cards.some(c => c.md.startsWith('# Boss')), 'a note without a heading gets its name as title');
  assert.deepStrictEqual(b.items.filter(i => i.kind === 'group').map(g => g.label).sort(), ['Lore', 'MyVault']);
  const id = name => cards.find(c => c.md.includes(name)).id;
  const pairs = b.edges.map(e => `${e.from}>${e.to}`).sort();
  assert.deepStrictEqual(pairs, [`${id('The Keep')}>${id('# Boss')}`, `${id('The Keep')}>${id('# Door')}`, `${id('# Door')}>${id('The Keep')}`].sort());
  for(const c of cards) for(const o of cards) if(c !== o) assert.ok(c.x + c.w <= o.x || o.x + o.w <= c.x || c.y + c.h <= o.y || o.y + o.h <= c.y, 'cards do not overlap');
});

test('board -> canvas -> board keeps notes, images, widgets, groups and links', () => {
  const b = Obsidian.fromCanvas(canvas, { read });
  const r = Obsidian.toCanvas(b, { dir: 'files', unb64: s => new Uint8Array(Buffer.from(s, 'base64')) });
  assert.strictEqual(r.files.length, 2);   // one file per asset
  const files = Object.fromEntries(r.files.map(f => [f.path, f.bytes]));
  const back = Obsidian.fromCanvas(r.canvas, { read: p => files[p] ?? null });
  const count = x => x.items.map(i => i.kind).sort().join();
  assert.strictEqual(count(back), count(b));
  assert.strictEqual(back.edges.length, b.edges.length);
  assert.strictEqual(back.items.find(i => i.kind === 'group').items.length, 3);
  assert.strictEqual(r.canvas.nodes.find(n => n.type === 'group').color, '5');   // Dracula cyan back to Obsidian preset 5
});

test('cli: import, edit, add, render, export', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hestia-cli-'));
  const v = path.join(dir, 'vault');
  for(const [p, data] of Object.entries(vault)) { fs.mkdirSync(path.dirname(path.join(v, p)), { recursive: true }); fs.writeFileSync(path.join(v, p), data); }
  fs.mkdirSync(path.join(v, '.obsidian'));
  fs.writeFileSync(path.join(v, 'Plan.canvas'), JSON.stringify(canvas));
  const quiet = fn => { const l = console.log, e = console.error; console.log = console.error = () => {}; try { return fn(); } finally { console.log = l; console.error = e; } };
  const f = path.join(dir, 'b.toon');
  assert.strictEqual(quiet(() => main(['import', path.join(v, 'Plan.canvas'), '-o', f])), 0);
  assert.strictEqual(Board.parse(fs.readFileSync(f, 'utf8')).items.length, 7);
  assert.strictEqual(quiet(() => main(['import', v, '-o', path.join(dir, 'v.toon')])), 0);
  assert.strictEqual(quiet(() => main(['edit', f, "note add '# New\\n- [ ] x' x=0 y=900 color=pink", 'shape add star text=key', 'arrow add from=8 to=9 mid=100,800 curve=true', 'link 8 9 label=has', 'group 8,9 label=Extra', 'set 9 border=orange fill=tint'])), 0);
  let b = Board.parse(fs.readFileSync(f, 'utf8'));
  const n = Board.find(b, 8), s = Board.find(b, 9), a = Board.find(b, 10);
  assert.strictEqual(n.md, '# New\n- [ ] x');
  assert.strictEqual(n.color, '#FF79C6');
  assert.strictEqual(s.shape, 'star');
  assert.strictEqual(s.border, '#FFB86C');
  assert.deepStrictEqual([a.from, a.to, a.curve, a.mx], [8, 9, true, 100]);
  assert.strictEqual(b.items.find(i => i.label === 'Extra').items.join(), '8,9');
  assert.strictEqual(quiet(() => main(['edit', f, 'set 99 x=1'])), 1);
  assert.strictEqual(quiet(() => main(['add', f, path.join(__dirname, '../samples/song.toon'), path.join(v, 'Boss.md'), path.join(v, 'img/pic.png')])), 0);
  b = Board.parse(fs.readFileSync(f, 'utf8'));
  assert.ok(b.items.some(i => i.tool === 'apollo') && b.items.some(i => i.md?.startsWith('# Boss')));
  const svg = path.join(dir, 'b.svg');
  assert.strictEqual(quiet(() => main(['render', f, '-o', svg])), 0);
  assert.ok(fs.readFileSync(svg, 'utf8').includes('data-room'), 'the Athena map is drawn in its widget');
  const cv = path.join(dir, 'out.canvas');
  assert.strictEqual(quiet(() => main(['export', f, '--to', 'canvas', '-o', cv])), 0);
  assert.ok(JSON.parse(fs.readFileSync(cv, 'utf8')).nodes.length > 8);
  assert.ok(fs.existsSync(path.join(dir, 'out-files', 'pic.png')));
});
