const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Model, Layout, Svg, Generator } = require('./load.js');
require('../../shared/icons.js');

const samples = path.join(__dirname, '..', 'samples');

test('layout: deterministic, on the lattice, no overlapping rooms, all in view', () => {
  const maps = fs.readdirSync(samples).filter(f => f.endsWith('.toon')).map(f => Model.parse(fs.readFileSync(path.join(samples, f), 'utf8')));
  maps.push(...[20, 60, 100].map(rooms => Generator.build({ seed: 11, rooms })));
  for(const m of maps) {
    const a = Layout.run(m), b = Layout.run(m);
    assert.deepEqual([...a.pos], [...b.pos]);
    const p = [...a.pos.values()];
    for(let i = 0; i < p.length; i++) {
      assert.ok(p[i].x >= 0 && p[i].y >= 0 && p[i].x <= a.width && p[i].y <= a.height);
      assert.ok(p[i].x % Layout.CELL === 0 && p[i].y % Layout.CELL === 0, 'on the lattice');
      for(let j = i + 1; j < p.length; j++) assert.ok(Math.hypot(p[i].x - p[j].x, p[i].y - p[j].y) >= Layout.CELL, 'rooms overlap');
    }
  }
});

test('svg: every room and passage, route numbers, standalone icons', () => {
  const m = Model.parse(fs.readFileSync(path.join(samples, 'tutorial.toon'), 'utf8'));
  const svg = Svg.render(m, { route: ['move r1', 'fight', 'move r3'], standalone: true });
  assert.equal((svg.match(/data-room=/g) || []).length, m.rooms.length);
  assert.equal((svg.match(/data-passage=/g) || []).length, m.passages.length);
  assert.equal((svg.match(/class="step"/g) || []).length, 3);
  assert.match(svg, /<symbol id="i-lock"/);
  assert.match(svg, /marker-end="url\(#dae-arrow\)"/);
  assert.ok(!/href="http/.test(svg));
});
