const test = require('node:test');
const assert = require('node:assert');
const DAE = require('../src/core/index.js');
const { Tree, Diff, Colors, Sprites, Cipher, Dice, Wheel, Ease, Anim, Zip, Gif, Rng, Toon } = DAE;

//#region [ Spyglass ]
test('spyglass: JSON ranges per path, errors with line and column', () => {
  const text = '{\n  "a": 1,\n  "list": [\n    {"id": 1},\n    {"id": 2}\n  ]\n}';
  const r = Tree.parse(text);
  assert.strictEqual(r.format, 'json');
  assert.deepStrictEqual(r.ranges.get('list'), [3, 6]);
  assert.deepStrictEqual(r.ranges.get('list[1].id'), [5, 5]);
  const bad = Tree.parse('{\n  "a": 1,\n}');
  assert.strictEqual(bad.error.line, 3);
  assert.match(bad.error.reason, /trailing comma|key/);
  assert.strictEqual(Tree.parse('[1, 2').error.reason, 'unclosed "["');
});

test('spyglass: TOON ranges follow the decoder (lists, tables, inline arrays)', () => {
  const text = 'app: athena\nrooms[2]:\n  - id: r0\n    name: Hall\n  - id: r1\n    items[2]{id,kind}:\n      i0,key\n      i1,gem\ntags[3]: a,b,c\n';
  const r = Tree.parse(text);
  assert.strictEqual(r.format, 'toon');
  assert.deepStrictEqual(r.value, Toon.decode(text));
  assert.deepStrictEqual(r.ranges.get('rooms[0]'), [3, 4]);
  assert.deepStrictEqual(r.ranges.get('rooms[1]'), [5, 8]);
  assert.deepStrictEqual(r.ranges.get('rooms[1].items[1]'), [8, 8]);
  assert.deepStrictEqual(r.ranges.get('tags[2]'), [9, 9]);
  assert.strictEqual(Tree.pathAt(r.ranges, 7), 'rooms[1].items[0]');
  assert.strictEqual(Tree.parse('a: 1\n b: 2').error.line, 2);
});

test('spyglass: cards, tables, layout, search, convert', () => {
  const v = { name: 'x', rooms: [{ id: 'r0', items: [{ id: 'i0', kind: 'key' }, { id: 'i1', kind: 'gem' }] }], 'odd key': [1, 2] };
  const cards = Tree.cards(v);
  assert.deepStrictEqual(cards.map(c => c.kind), ['object', 'array', 'object', 'table', 'array']);
  assert.strictEqual(cards[3].path, 'rooms[0].items');
  assert.deepStrictEqual(cards[3].cols, ['id', 'kind']);
  assert.strictEqual(cards[4].path, '["odd key"]');
  const { pos } = Tree.layout(cards);
  assert.ok(pos.get(1).x > pos.get(0).x && pos.get(3).x > pos.get(2).x);
  const hidden = Tree.layout(cards, { hidden: new Set([1]) });
  assert.ok(!hidden.pos.has(2));
  assert.deepStrictEqual(Tree.search(cards, 'gem'), [{ card: 3, row: 1 }]);
  assert.deepStrictEqual(Tree.get(v, 'rooms[0].items[1].kind'), 'gem');
  assert.deepStrictEqual(Tree.get(v, '["odd key"][1]'), 2);
  const toon = Tree.convert(JSON.stringify(v));
  assert.deepStrictEqual(Toon.decode(toon), v);
  assert.deepStrictEqual(JSON.parse(Tree.convert(toon)), v);
  assert.throws(() => Tree.convert('[1,2]'), /object at the top/);
});
//#endregion

//#region [ Caliper ]
test('caliper: added / removed / changed / moved with key matching, patch round trip', () => {
  const a = { v: 1, rooms: [{ id: 'a', n: 1 }, { id: 'b', n: 2 }, { id: 'c', n: 3 }], tags: ['x', 'y'], gone: true };
  const b = { v: 2, rooms: [{ id: 'b', n: 2 }, { id: 'a', n: 9 }, { id: 'd', n: 4 }], tags: ['y', 'x'], fresh: { k: 1 } };
  const root = Diff.compare(a, b);
  const ch = Diff.changes(root);
  const kinds = Object.fromEntries(ch.map(c => [c.path, c.kind]));
  assert.strictEqual(kinds.v, 'changed');
  assert.strictEqual(kinds.gone, 'removed');
  assert.strictEqual(kinds.fresh, 'added');
  assert.strictEqual(kinds['rooms[0]'], 'moved');
  assert.strictEqual(kinds['rooms[1]'], 'moved');
  assert.strictEqual(kinds['rooms[1].n'], 'changed');
  assert.ok(ch.some(c => c.path === 'rooms[2]' && c.kind === 'added' && c.new.id === 'd'));
  assert.ok(ch.some(c => c.kind === 'removed' && c.old?.id === 'c'));
  // order-free primitive arrays
  assert.strictEqual(Diff.changes(Diff.compare(a.tags, b.tags, { order: true })).length, 0);
  // options
  assert.strictEqual(Diff.changes(Diff.compare({ x: 1.0001, s: 'A' }, { x: 1, s: 'a' }, { tol: .01, nocase: true })).length, 0);
  assert.strictEqual(Diff.changes(Diff.compare({ view: 1 }, { view: 2 }, { ignore: ['view'] })).length, 0);
  // patch
  const ops = Diff.patch(a, b);
  assert.deepStrictEqual(Diff.apply(a, ops), b);
  assert.deepStrictEqual(Diff.apply([1, 2, 3], Diff.patch([1, 2, 3], [1])), [1]);
  assert.match(Diff.markdown(ch), /\| `v` \| changed/);
});
//#endregion

//#region [ Prisma ]
test('prisma: parses every CSS color syntax', () => {
  assert.deepStrictEqual(Colors.parse('#fA0'), [255, 170, 0, 1]);
  assert.deepStrictEqual(Colors.parse('#ff000080'), [255, 0, 0, 0.502]);
  assert.deepStrictEqual(Colors.parse('rgb(255 0 0 / 50%)'), [255, 0, 0, 0.5]);
  assert.deepStrictEqual(Colors.parse('rgba(0, 128, 255, .25)'), [0, 128, 255, 0.25]);
  assert.deepStrictEqual(Colors.parse('hsl(120 100% 25%)'), [0, 128, 0, 1]);
  assert.deepStrictEqual(Colors.parse('hwb(0 0% 0%)'), [255, 0, 0, 1]);
  assert.deepStrictEqual(Colors.parse('oklch(62.8% 0.2577 29.23)').slice(0, 3), [255, 0, 0]);
  assert.ok(Colors.parse('lab(54.29% 80.82 69.88)').slice(0, 3).every((v, i) => Math.abs(v - [255, 0, 0][i]) <= 2));
  assert.deepStrictEqual(Colors.parse('color(display-p3 1 0 0)').slice(0, 3), [255, 0, 0]);
  assert.deepStrictEqual(Colors.parse('rebeccapurple'), [102, 51, 153, 1]);
  for(const bad of ['#12', '#12345', 'rgb(1,2)', 'rgb(1, 2% , 3)', 'hsl(10, 20, 30)', 'nope', 'rgb(1 2 3 / )']) assert.strictEqual(Colors.parse(bad), null, bad);
  assert.strictEqual(Colors.hex([255, 184, 108, 1]), '#FFB86C');
  assert.strictEqual(Colors.formats([255, 0, 0, 1]).hsl, 'hsl(0 100% 50%)');
  assert.ok(Math.abs(Colors.contrast([0, 0, 0], [255, 255, 255]) - 21) < 1e-9);
});

test('prisma: extracts colors with what they paint', () => {
  const css = ':root {\n  --accent: #8BE9FD;\n  --bad: rgb(255 85 85);\n}\n.btn:hover { background: var(--accent); color: white; border: 1px solid #44475A; }\n#fff { color: red; }\n@media (x) { .a { fill: hsl(0 0% 50%); } }\n';
  const { hits, uses } = Colors.extract(css, 'site.css');
  const by = Object.fromEntries(hits.map(h => [h.raw, h]));
  assert.strictEqual(by['#8BE9FD'].var, '--accent');
  assert.strictEqual(by['#8BE9FD'].sel, ':root');
  assert.strictEqual(by['white'].prop, 'color');
  assert.strictEqual(by['white'].sel, '.btn:hover');
  assert.strictEqual(by['#44475A'].cat, 'border');
  assert.ok(!hits.some(h => h.raw === '#fff'), 'id selector is not a color');
  assert.strictEqual(by['red'].sel, '#fff');
  assert.strictEqual(by['hsl(0 0% 50%)'].sel, '@media (x) › .a');
  assert.deepStrictEqual(uses.map(u => [u.var, u.sel, u.prop]), [['--accent', '.btn:hover', 'background']]);

  const html = '<div id="hero" class="big card" style="color: #123456">red text</div>\n<svg><rect fill="#abc" stroke="navy"/></svg><a href="#add">x</a>';
  const h2 = Colors.extract(html, 'page.html').hits;
  assert.deepStrictEqual(h2.map(h => h.raw), ['#123456', '#abc', 'navy']);
  assert.strictEqual(h2[0].el, 'div#hero.big.card');
  assert.strictEqual(h2[1].attr, 'fill');
  assert.strictEqual(h2[1].el, 'rect');

  const js = "const GOLD = '#F4B740';\nconst theme = { warn: \"#FFB86C\", ink: 'black', label: 'red alert' };\nctx.fillStyle = 'tomato';\n";
  const h3 = Colors.extract(js, 'theme.js').hits;
  assert.deepStrictEqual(h3.map(h => [h.raw, h.key]), [['#F4B740', 'GOLD'], ['#FFB86C', 'warn'], ['tomato', 'ctx.fillStyle']]);

  const pal = Colors.swatches([...hits, ...Colors.extract('a { color: #8be9fd; }', 'b.css').hits], uses);
  const acc = pal.find(s => s.hex === '#8BE9FD');
  assert.strictEqual(acc.count, 2);
  assert.strictEqual(acc.name, 'accent');
  assert.strictEqual(acc.uses.length, 1);
  const merged = Colors.merge(Colors.swatches(Colors.extract('a{color:#808080;background:#818181;border-color:#FF0000}', 'x.css').hits), 2);
  assert.strictEqual(merged.length, 2);
  assert.match(Colors.css(merged), /--color: #808080;/);
  assert.match(Colors.gpl(merged), /^GIMP Palette/);
});
//#endregion

//#region [ Easel, zip, gif ]
test('easel: grid and island frames, sequences, packing, aseprite round trip', () => {
  const W = 12, H = 6, rgba = new Uint8Array(W * H * 4);
  const dot = (x, y) => { rgba[(y * W + x) * 4 + 3] = 255; };
  dot(1, 1); dot(2, 1); dot(1, 2);         // island 1
  dot(4, 2);                                // 2 px away: merges with gap 2
  dot(9, 1); dot(9, 2); dot(10, 2);         // island 2
  const isl = Sprites.islands(rgba, W, H, { gap: 2, minArea: 1 });
  assert.deepStrictEqual(isl, [{ x: 1, y: 1, w: 4, h: 2 }, { x: 9, y: 1, w: 2, h: 2 }]);
  const g = Sprites.grid(W, H, { cell: { w: 6, h: 6 } });
  assert.strictEqual(g.length, 2);
  assert.strictEqual(Sprites.grid(W, H, { count: { cols: 4, rows: 2 }, rgba }).length, 3);
  assert.deepStrictEqual(Sprites.sequence({ frames: [0, 1, 2, 3], mode: 'pingpong' }), [0, 1, 2, 3, 2, 1]);
  assert.deepStrictEqual(Sprites.durations({ frames: [0, 1], fps: 10, durations: { 1: 250 } }), [100, 250]);
  const p = Sprites.pack([{ w: 4, h: 4 }, { w: 2, h: 8 }, { w: 3, h: 3 }]);
  assert.ok(p.pos.every(q => q.x >= 1 && q.y >= 1));
  const proj = { image: 'hero.png', w: 12, h: 6, frames: isl, anims: [{ name: 'idle', frames: [0, 1], fps: 8, mode: 'pingpong' }] };
  const back = Sprites.fromAseprite(Sprites.aseprite(proj));
  assert.deepStrictEqual(back.frames.map(({ x, y, w, h }) => ({ x, y, w, h })), isl);
  assert.deepStrictEqual(back.anims[0], { name: 'idle', frames: [0, 1], fps: 8, mode: 'pingpong' });
  const data = Toon.decode(Toon.encode(Sprites.data(proj)));
  assert.deepStrictEqual(Sprites.read(data).anims[0].frames, [0, 1]);
});

test('zip: stored entries with crc', () => {
  assert.strictEqual(Zip.crc32(new TextEncoder().encode('The quick brown fox jumps over the lazy dog')), 0x414FA339);
  const z = Zip.make([{ name: 'a.txt', data: 'hi' }, { name: 'f/b.bin', data: new Uint8Array([1, 2, 3]) }]);
  const dv = new DataView(z.buffer);
  assert.strictEqual(dv.getUint32(0, true), 0x04034B50);
  assert.strictEqual(dv.getUint32(z.length - 22, true), 0x06054B50);
  assert.strictEqual(dv.getUint16(z.length - 22 + 10, true), 2);
});

/** Minimal GIF reader for the test: frames as index arrays. */
function readGif(b) {
  let p = 13;
  const w = b[6] | (b[7] << 8), h = b[8] | (b[9] << 8), gct = 2 << (b[10] & 7);
  const pal = [];
  for(let i = 0; i < gct; i++) pal.push([b[p + i * 3], b[p + i * 3 + 1], b[p + i * 3 + 2]]);
  p += gct * 3;
  const frames = [];
  let trans = -1;
  while(b[p] !== 0x3B) {
    if(b[p] === 0x21) {
      if(b[p + 1] === 0xF9) trans = b[p + 6];
      p += 2;
      while(b[p]) p += b[p] + 1;
      p++;
      continue;
    }
    p += 10;
    const min = b[p++];
    const data = [];
    while(b[p]) { data.push(...b.slice(p + 1, p + 1 + b[p])); p += b[p] + 1; }
    p++;
    // LZW decode
    const clear = 1 << min, out = [];
    let size = min + 1, dict = [], bit = 0, prev = null;
    const reset = () => { dict = Array.from({ length: clear + 2 }, (_, i) => [i]); size = min + 1; prev = null; };
    reset();
    for(;;) {
      let code = 0;
      for(let i = 0; i < size; i++) code |= ((data[(bit + i) >> 3] >> ((bit + i) & 7)) & 1) << i;
      bit += size;
      if(code === clear) { reset(); continue; }
      if(code === clear + 1) break;
      let entry = dict[code] ?? (prev ? [...prev, prev[0]] : null);
      out.push(...entry);
      if(prev) dict.push([...prev, entry[0]]);
      prev = entry;
      if(dict.length === (1 << size) && size < 12) size++;
    }
    frames.push(out.map(i => (i === trans ? null : pal[i])));
  }
  return { w, h, frames };
}

test('gif: frames decode back to the same pixels (exact palette + transparency)', () => {
  const W = 20, H = 15, rng = new Rng(4);
  const frames = [0, 1].map(() => {
    const rgba = new Uint8Array(W * H * 4);
    for(let i = 0; i < W * H; i++) {
      const c = rng.int(0, 6);
      if(c === 0) continue;
      rgba.set([c * 30, 255 - c * 20, c * 10, 255], i * 4);
    }
    return { rgba, delay: 120 };
  });
  const g = readGif(Gif.encode({ w: W, h: H, frames }));
  assert.strictEqual(g.frames.length, 2);
  g.frames.forEach((f, k) => f.forEach((px, i) => {
    const s = frames[k].rgba.slice(i * 4, i * 4 + 4);
    if(s[3] === 0) assert.strictEqual(px, null);
    else assert.deepStrictEqual(px, [s[0], s[1], s[2]]);
  }));
  // more than 255 colors: median cut keeps it close
  const big = new Uint8Array(32 * 32 * 4);
  for(let i = 0; i < 1024; i++) big.set([i & 255, (i * 7) & 255, (i * 13) & 255, 255], i * 4);
  const g2 = readGif(Gif.encode({ w: 32, h: 32, frames: [{ rgba: big }] }));
  assert.strictEqual(g2.frames[0].length, 1024);
});
//#endregion

//#region [ Jigsaw ]
test('jigsaw: every cipher round-trips', () => {
  const plain = 'Attack at dawn, meet by the old tower';
  const lettersOnly = ['playfair', 'bifid', 'adfgx', 'adfgvx', 'foursquare', 'twosquare', 'nihilist', 'polybius', 'tap', 'bacon', 'a1z26', 'morse', 'nato', 'multitap', 't9', 'route', 'runes', 'clean', 'group', 'upper', 'book', 'scytale', 'sga'];
  const norm = s => s.toUpperCase().replace(/[^A-Z]/g, '').replace(/J/g, 'I');
  for(const c of Cipher.LIST) {
    if(['t9'].includes(c.id)) continue;
    const enc = Cipher.run(plain, { id: c.id }, 'enc');
    const back = Cipher.run(enc, { id: c.id }, 'dec');
    if(c.id === 'book') continue;
    if(lettersOnly.includes(c.id)) {
      const b = norm(back).replace(/X+$/, ''), p = norm(plain);
      if(c.id === 'playfair') assert.strictEqual(b.replace(/X/g, ''), p.replace(/X/g, ''), c.id);
      else if(c.id === 'tap') assert.strictEqual(b, p.replace(/K/g, 'C'), c.id);
      else if(c.id === 'runes') assert.strictEqual(b, p.replace(/C/g, 'K').replace(/Y/g, 'I'), c.id);
      else if(['foursquare', 'twosquare'].includes(c.id)) assert.strictEqual(b, p, c.id);
      else assert.strictEqual(b, p, c.id);
    }
    else assert.strictEqual(back, plain, c.id);
  }
});

test('jigsaw: known vectors', () => {
  assert.strictEqual(Cipher.run('ATTACKATDAWN', { id: 'vigenere', opts: { key: 'LEMON' } }), 'LXFOPVEFRNHR');
  assert.strictEqual(Cipher.run('Hello', { id: 'caesar', opts: { shift: 3 } }), 'Khoor');
  assert.strictEqual(Cipher.run('hide the gold in the tree stump', { id: 'playfair', opts: { key: 'playfair example' } }).replace(/ /g, ''), 'BMODZBXDNABEKUDMUIXMMOUVIF');
  assert.strictEqual(Cipher.run('WEAREDISCOVEREDFLEEATONCE', { id: 'railfence', opts: { rails: 3 } }), 'WECRLTEERDSOEEFEAOCAIVDEN');
  assert.strictEqual(Cipher.run('SOS', { id: 'morse' }), '... --- ...');
  assert.strictEqual(Cipher.run('Man', { id: 'base64' }), 'TWFu');
  assert.strictEqual(Cipher.run('foobar', { id: 'base32' }), 'MZXW6YTBOI======');
  assert.strictEqual(Cipher.run('test', { id: 'ascii85' }), '<~FCfN8~>');
  assert.strictEqual(Cipher.run('ATTACKATDAWN', { id: 'autokey', opts: { key: 'QUEENLY' } }), 'QNXEPVYTWTWP');
  assert.strictEqual(Cipher.run('AFFINECIPHER', { id: 'affine', opts: { a: 5, b: 8 } }), 'IHHWVCSWFRCP');
  assert.strictEqual(Cipher.run('hello', { id: 'multitap' }), '44 33 555 555 666');
  assert.strictEqual(Cipher.chain('secret', [{ id: 'vigenere', opts: { key: 'KEY' } }, { id: 'base64' }], 'enc'), Cipher.run(Cipher.run('secret', { id: 'vigenere', opts: { key: 'KEY' } }), { id: 'base64' }));
  assert.strictEqual(Cipher.chain(Cipher.chain('secret', [{ id: 'atbash' }, { id: 'hex' }]), [{ id: 'atbash' }, { id: 'hex' }], 'dec'), 'secret');
  assert.throws(() => Cipher.run('x', { id: 'affine', opts: { a: 2, b: 1 } }), /factor/);
  assert.strictEqual(Cipher.run('3.1 2.1', { id: 'book', opts: { book: 'a b c\nd e f\ng h i' } }, 'dec'), 'g d');
});

test('jigsaw: analysis cracks Caesar and Vigenère, anagrams, word search, glyphs', () => {
  const text = 'it was the best of times it was the worst of times it was the age of wisdom it was the age of foolishness it was the epoch of belief';
  const c = Cipher.run(text, { id: 'caesar', opts: { shift: 7 } });
  assert.strictEqual(Cipher.tryAll(c)[0].text, text);
  const v = Cipher.run(text, { id: 'vigenere', opts: { key: 'TOWER' } });
  assert.strictEqual(Cipher.keyLengths(v)[0].len, 5);
  assert.strictEqual(Cipher.vigenereKey(v, 5), 'TOWER');
  assert.ok(Cipher.ioc(text) > 0.06 && Cipher.ioc(v) < 0.05);
  assert.ok(Cipher.score('the old man and the sea') > Cipher.score('xqz vbk wpl jjm'));
  assert.ok(Cipher.score('o rei e a rainha na torre', 'pt') > Cipher.score('o rei e a rainha na torre', 'en') - 1);
  const words = ['listen', 'silent', 'enlist', 'tinsel', 'inlets', 'lists', 'net', 'tin', 'lest', 'sin', 'ten', 'sit', 'len'];
  const an = Cipher.anagrams('listen', words);
  assert.deepStrictEqual(an.exact.sort(), ['enlist', 'inlets', 'silent', 'tinsel']);
  assert.ok(an.pairs.includes('sit len') || an.pairs.includes('len sit'));
  const ws = Cipher.wordSearch(['DRAGON', 'SWORD', 'KEY'], { seed: 3 });
  for(const p of ws.placed) {
    const got = [...p.word].map((_, i) => ws.grid[p.r + p.dr * i][p.c + p.dc * i]).join('');
    assert.strictEqual(got, p.word);
  }
  assert.strictEqual(ws.missed.length, 0);
  for(const g of Cipher.GLYPHS) assert.match(Cipher.glyphs(g.id, g.id === 'mayan' || g.id === 'tally' ? '7 20 13' : 'hi there'), /^<svg[^>]+viewBox/);
  DAE.Words = { en: 'hello\ngood' };
  assert.deepStrictEqual(Cipher.t9Words('43556'), ['hello']);
  assert.strictEqual(Cipher.run('43556 4663', { id: 't9' }, 'dec'), 'hello good');
});
//#endregion

//#region [ Scale ]
test('scale: formulas parse, roll and fail clearly', () => {
  const fixed = v => () => v;
  const r = Dice.roll('(3D6+1D12)*2+1D100', { rnd: fixed(0.5) });
  assert.strictEqual(r.total, (4 * 3 + 7) * 2 + 51);
  assert.strictEqual(r.groups.length, 3);
  assert.match(r.shown, /= 89$/);
  assert.strictEqual(Dice.roll('10 / 3 - -2').total, 5);
  const seq = [0.99, 0.0, 0.5, 0.2];
  let i = 0;
  const k = Dice.roll('4d6kh3', { rnd: () => seq[i++] });
  assert.deepStrictEqual(k.groups[0].rolls.map(d => [d.v, !!d.drop]), [[6, false], [1, true], [4, false], [2, false]]);
  assert.strictEqual(k.total, 12);
  i = 0;
  const ex = Dice.roll('d6!', { rnd: () => [0.99, 0.99, 0.1][i++] });
  assert.strictEqual(ex.total, 13);
  assert.throws(() => Dice.parse('2d7'), /D7 is not in the dice set/);
  assert.ok(Dice.parse('2d7', [7]));
  assert.throws(() => Dice.parse('2d3', [3]), /D4 to D100/);
  assert.throws(() => Dice.parse('(1d6'), /missing "\)"/);
  assert.throws(() => Dice.parse('1d6+'), /ends too early/);
  assert.throws(() => Dice.parse('3d6kh4'), /keep 1 to 3/);
  assert.strictEqual(Dice.text(Dice.parse('adv+d%')), 'adv+1D100');
});

test('scale: exact odds', () => {
  const o = Dice.odds('2d6');
  assert.ok(o.exact);
  assert.strictEqual(o.min, 2);
  assert.ok(Math.abs(o.mean - 7) < 1e-9);
  assert.ok(Math.abs(o.dist.find(([v]) => v === 7)[1] - 6 / 36) < 1e-12);
  const adv = Dice.odds('adv');
  assert.ok(Math.abs(Dice.chance(adv, 20) - (1 - (19 / 20) ** 2)) < 1e-12);
  const m = Dice.odds('(3D6+1D12)*2+1D100');
  assert.ok(m.exact);
  assert.ok(Math.abs(m.mean - ((10.5 + 6.5) * 2 + 50.5)) < 1e-9);
  assert.ok(Math.abs(m.dist.reduce((s, [, p]) => s + p, 0) - 1) < 1e-9);
  const big = Dice.odds('8d20kh3', { samples: 3000, rnd: new Rng(1).next.bind(new Rng(1)) });
  assert.strictEqual(big.exact, false);
});
//#endregion

//#region [ Wheel ]
test('wheel: percents, locks, slices, pick, landing', () => {
  const items = Wheel.parseList('Gold | 50 | #FFB86C\nSword | 30\nNothing | 20');
  assert.deepStrictEqual(Wheel.percents(items).map(Math.round), [50, 30, 20]);
  items[0].lock = true;
  Wheel.setPercent(items, 1, 40);
  assert.deepStrictEqual(Wheel.percents(items).map(p => +p.toFixed(6)), [50, 40, 10]);
  items[2].on = false;
  assert.deepStrictEqual(Wheel.percents(items).map(Math.round), [56, 44, 0]);
  items[2].on = true;
  const odds = Wheel.slices(items, 'odds'), eq = Wheel.slices(items, 'equal');
  assert.ok(Math.abs(odds[0].a1 - 0.5) < 1e-9 && Math.abs(eq[0].a1 - 1 / 3) < 1e-9);
  const rng = new Rng(9), counts = [0, 0, 0];
  for(let i = 0; i < 20000; i++) counts[Wheel.pick(items, () => rng.next())]++;
  assert.ok(Math.abs(counts[0] / 20000 - .5) < .02 && Math.abs(counts[2] / 20000 - .1) < .02);
  for(const mode of ['odds', 'equal']) {
    const sl = Wheel.slices(items, mode);
    for(let k = 0; k < 3; k++) {
      const end = Wheel.landing(sl, k, { from: 2.3, rnd: () => rng.next() });
      assert.ok(end - 2.3 >= 4);
      assert.strictEqual(Wheel.under(sl, end).index, k);
    }
  }
  const c = Wheel.colors(7, ['#1', '#2', '#3']);
  for(let k = 0; k < 7; k++) assert.notStrictEqual(c[k], c[(k + 1) % 7]);
});
//#endregion

//#region [ Metronome ]
test('metronome: curves, CSS round trips, springs, templates', () => {
  const ease = Ease.bezier(.25, .1, .25, 1);
  assert.ok(Math.abs(ease(.5) - 0.8024) < 1e-3);
  assert.strictEqual(Ease.steps(4)(0.3), .25);
  assert.strictEqual(Ease.steps(4, 'jump-start')(0), .25);
  assert.strictEqual(Ease.linear([[0], [1, .5], [0, 1]].map(([v, a]) => [v, a]))(.25), .5);
  for(const c of Ease.CURVES) {
    const fn = Ease.make(c);
    assert.ok((Math.abs(fn(0)) < 1e-6 || c.def[1] === 'jump-start') && Math.abs(fn(1) - 1) < 1e-6, c.id);
    const css = Ease.css(c);
    const back = Ease.make(Ease.parse(css));
    for(const t of [.1, .37, .5, .8]) assert.ok(Math.abs(back(t) - fn(t)) < 0.02, `${c.id} @${t}: ${css}`);
    const js = new Function(Ease.js(c) + '\nreturn ease;')();
    for(const t of [.1, .5, .9]) assert.ok(Math.abs(js(t) - fn(t)) < 0.02, `${c.id} js @${t}`);
  }
  assert.strictEqual(Ease.parse('cubic-bezier(2, 0, 1, 1)'), null);
  assert.strictEqual(Ease.parse('steps(1, jump-none)'), null);
  assert.deepStrictEqual(Ease.parse('ease-out'), { kind: 'bezier', def: [0, 0, .58, 1] });
  const sp = Ease.spring(180, 12);
  assert.ok(sp.settle > 0.5 && sp.settle < 3 && Math.max(...Ease.sample(sp.fn, 100)) > 1);
  for(const a of Anim.LIST) {
    assert.match(Anim.css(a), new RegExp(`@keyframes ik-${a.id}`));
    for(const v of a.vars) assert.ok(a.kf.includes(`--ik-${v.name}`), `${a.id} uses ${v.name}`);
    const js = Anim.js(a);
    assert.match(js, /element\.animate\(/);
    assert.ok(!js.includes('var(--ik'), a.id);
  }
  assert.strictEqual(Anim.LIST.filter(a => a.group === 'Font Awesome').length, 9);
});
//#endregion
