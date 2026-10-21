const test = require('node:test');
const assert = require('node:assert');
const { Board, Markdown, Ogg } = require('./load.js');

const board = () => {
  const b = Board.create();
  const a = Board.item(b, 'shape', { shape: 'rect', x: 0, y: 0, w: 100, h: 60, color: '#fff' });
  b.items.push(a);
  const c = Board.item(b, 'note', { x: 300, y: 0, w: 100, h: 60, md: '# Plan\n- [ ] boss room' });
  b.items.push(c);
  const arrow = Board.item(b, 'shape', { shape: 'arrow', x1: 0, y1: 0, x2: 10, y2: 10, from: a.id, to: c.id, color: '#fff', width: 2 });
  b.items.push(arrow);
  Board.bind(b);
  return { b, a, c, arrow };
};

test('arrows stick to the border of their items and follow them', () => {
  const { b, a, c, arrow } = board();
  assert.strictEqual(arrow.x1, a.x + a.w + 6);   // right side + gap
  assert.strictEqual(arrow.y1, 30);
  assert.strictEqual(arrow.x2, c.x - 6);
  Board.move(b, [c.id], 0, 200);
  assert.ok(arrow.y2 > 150);
  assert.strictEqual(arrow.y, Math.min(arrow.y1, arrow.y2));
  Board.remove(b, [c.id]);
  assert.strictEqual(arrow.to, null);
});

test('hit test: topmost first, strokes by distance, groups by label and border', () => {
  const { b, a } = board();
  const s = Board.item(b, 'stroke', { x: 0, y: 100, w: 100, h: 100, vw: 100, vh: 100, points: [0, 0, 100, 100], width: 2 });
  const g = Board.item(b, 'group', { x: -50, y: -50, w: 600, h: 400, label: 'Act 1' });
  b.items.push(s, g);
  assert.strictEqual(Board.hit(b, 50, 30).id, a.id);
  assert.strictEqual(Board.hit(b, 50, 150).id, s.id);
  assert.strictEqual(Board.hit(b, 90, 120), g.kind === 'group' && Board.hitItem(g, 90, 120) ? g : null);
  assert.strictEqual(Board.hit(b, 0, -40).id, g.id);   // label strip
  assert.deepStrictEqual(Board.inside(b, g).map(x => x.id).sort(), b.items.filter(x => x !== g).map(x => x.id).sort());
  assert.deepStrictEqual(Board.ordered(b)[0], g);   // groups draw first
});

test('TOON round trip keeps items, edges and assets', () => {
  const { b, a, c } = board();
  Board.edge(b, a.id, c.id, { label: 'leads to' });
  const asset = Board.addAsset(b, { name: 'x.png', mime: 'image/png', data: 'iVBORw0KGgo=' });
  b.items.push(Board.item(b, 'image', { asset: asset.id }));
  const back = Board.parse(Board.stringify(b));
  assert.deepStrictEqual(back.items, b.items);
  assert.deepStrictEqual(back.edges, b.edges);
  assert.deepStrictEqual(back.assets, b.assets);
  assert.strictEqual(Board.addAsset(b, { name: 'y.png', mime: 'image/png', data: 'iVBORw0KGgo=' }).id, asset.id);   // same data, same asset
  Board.remove(b, [b.items.at(-1).id]);
  assert.strictEqual(b.assets.length, 0);   // unused asset dropped
});

test('search finds notes, text and edge labels', () => {
  const { b, a, c } = board();
  Board.edge(b, a.id, c.id, { label: 'secret door' });
  assert.deepStrictEqual(Board.search(b, 'BOSS'), [c.id]);
  assert.deepStrictEqual(Board.search(b, 'secret'), [a.id]);
});

test('markdown: escaped text, tasks, links, assets', () => {
  const html = Markdown.render('# Hi <b>\n- [x] done\n- [ ] todo\n\n**bold** and `code` [link](https://x.dev) ![i](asset:a1)', { asset: id => `blob:${id}` });
  assert.ok(html.includes('<h1>Hi &lt;b&gt;</h1>'));
  assert.ok(html.includes('type="checkbox" data-line="1" checked'));
  assert.ok(html.includes('<b>bold</b>') && html.includes('<code>code</code>'));
  assert.ok(html.includes('href="https://x.dev"') && html.includes('src="blob:a1"'));
  assert.ok(!Markdown.render('[x](javascript:alert(1))').includes('javascript:'));
  assert.strictEqual(Markdown.toggleTask('- [ ] a\n- [x] b', 0), '- [x] a\n- [x] b');
});

test('ogg opus writer: headers, lacing, granules, crc', () => {
  const packets = Array.from({ length: 300 }, (_, i) => ({ data: new Uint8Array(i % 7 === 0 ? 600 : 120).fill(i & 255), samples: 960 }));
  const bytes = Ogg.opus(packets, { channels: 2, preSkip: 312, length: 287000 });
  const pages = Ogg.read(bytes);
  assert.ok(pages.every(p => p.crcOk));
  assert.strictEqual(new TextDecoder().decode(pages[0].packets[0].subarray(0, 8)), 'OpusHead');
  assert.strictEqual(pages[0].flags, 2);
  assert.strictEqual(new TextDecoder().decode(pages[1].packets[0].subarray(0, 8)), 'OpusTags');
  const audio = pages.slice(2);
  assert.strictEqual(audio.flatMap(p => p.packets).length, 300);
  assert.ok(audio.flatMap(p => p.packets).every((p, i) => p.length === packets[i].data.length));
  assert.strictEqual(audio.at(-1).flags, 4);
  assert.strictEqual(audio.at(-1).granule, 312 + 287000);   // end trimmed to the real length
  for(let i = 1; i < audio.length; i++) assert.ok(audio[i].granule >= audio[i - 1].granule);
});
