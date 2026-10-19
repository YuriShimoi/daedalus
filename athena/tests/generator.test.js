const test = require('node:test');
const assert = require('node:assert/strict');
const { Model, Rules, Validate, Generator, LSystem, Rng, Solver } = require('./load.js');

test('l-system: axiom grows to the room budget, brackets balance', () => {
  const rng = new Rng(5);
  const sym = LSystem.grow(rng, { rooms: 20, branching: 0.5, deepnest: 3 });
  const rooms = sym.filter(s => 'ERX'.includes(s.t)).length;
  assert.ok(rooms <= 20 && rooms >= 15, `rooms ${rooms}`);
  assert.equal(sym.filter(s => s.t === '[').length, sym.filter(s => s.t === ']').length);
  assert.equal(sym[0].t, 'E');
  assert.ok(sym.every(s => s.t !== 'R' || s.d <= 3));
  const { nodes, edges } = LSystem.interpret(sym);
  assert.equal(edges.length, nodes.length - 1, 'a tree');
});

test('l-system: branching and deepnest shape the tree', () => {
  const stats = (branching, deepnest) => {
    let leaves = 0, depth = 0;
    for(let seed = 1; seed <= 30; seed++) {
      const { nodes, edges } = LSystem.interpret(LSystem.grow(new Rng(seed), { rooms: 40, branching, deepnest }));
      const deg = new Array(nodes.length).fill(0);
      edges.forEach(([a, b]) => { deg[a]++; deg[b]++; });
      leaves += deg.filter(d => d === 1).length;
      depth += Math.max(...nodes.map(n => n.depth));
    }
    return { leaves, depth };
  };
  assert.ok(stats(0.8, 3).leaves > stats(0.05, 3).leaves, 'more branching, more leaves');
  assert.ok(stats(0.6, 5).depth > stats(0.6, 1).depth, 'deeper nesting, deeper branches');
  assert.equal(stats(0.6, 0).depth, 0, 'deepnest 0 is a single corridor');
});

test('generator: same seed, same map', () => {
  const a = Model.stringify(Generator.build({ seed: 42, rooms: 20 }));
  const b = Model.stringify(Generator.build({ seed: 42, rooms: 20 }));
  assert.equal(a, b);
  assert.notEqual(a, Model.stringify(Generator.build({ seed: 43, rooms: 20 })));
});

test('generator: 200 seeds x 3 sizes are valid and solvable', () => {
  for(const rooms of [8, 20, 40]) {
    for(let seed = 1; seed <= 200; seed++) {
      const g = Generator.generate({ seed: seed * 7919, rooms });
      assert.deepEqual(Validate.run(g.model).errors, [], `seed ${g.seed} rooms ${rooms}`);
      const route = g.result.routes[0];
      const res = Rules.replay(g.model, route.steps);
      assert.equal(res.error, undefined);
      assert.equal(res.state.won, true, `seed ${g.seed} rooms ${rooms} replays to the exit`);
    }
  }
});

test('generator: parameters show in the map', () => {
  const count = (params, f) => {
    let total = 0;
    for(let seed = 1; seed <= 20; seed++) total += f(Generator.build({ seed, ...params }));
    return total;
  };
  const locks = m => m.passages.filter(g => g.lock.length).length;
  const foes = m => m.rooms.reduce((n, r) => n + r.enemies.length, 0);
  const oneWay = m => m.passages.filter(g => g.dir === 'a>b').length;
  assert.equal(count({ rooms: 20, locks: 0 }, locks), 0);
  assert.ok(count({ rooms: 20, locks: 3 }, locks) > count({ rooms: 20, locks: 1 }, locks));
  assert.ok(count({ rooms: 20, enemyDensity: 0.9 }, foes) > count({ rooms: 20, enemyDensity: 0.1 }, foes));
  assert.equal(count({ rooms: 20, loops: 3, oneWay: 0 }, oneWay), 0);
  assert.ok(count({ rooms: 20, loops: 3, oneWay: 1 }, oneWay) > 0);
  assert.equal(count({ rooms: 20, effects: false }, m => m.effects.length), 0);
  assert.equal(count({ rooms: 20, combos: false }, m => m.recipes.length), 0);
  const sizes = [10, 30, 60].map(rooms => Generator.build({ seed: 3, rooms }).rooms.length);
  assert.ok(sizes[0] <= 10 && sizes[1] <= 30 && sizes[2] <= 60 && sizes[2] > sizes[1] && sizes[1] > sizes[0], `${sizes}`);
  assert.ok(Generator.build({ seed: 3, rooms: 30, exits: 3 }).rooms.filter(r => r.exit).length >= 2);
});

test('generator: ids only, no flavor names', () => {
  const m = Generator.build({ seed: 9, rooms: 25 });
  for(const list of [m.rooms, m.items, m.enemies, m.effects, m.chests, m.passages])
    list.forEach(x => assert.match(x.id, /^[a-z]\d+$/));
});

test('100-room map: the solver returns a route within the time limit', () => {
  for(const seed of [1, 2, 3]) {
    const m = Generator.build({ seed, rooms: 100 });
    const t0 = Date.now();
    const r = Solver.solve(m, { timeLimitMs: 4000, top: 3, mode: 'weighted' });
    assert.ok(Date.now() - t0 < 5000, 'time limit kept');
    assert.ok(r.routes.length > 0, `seed ${seed}: ${r.label}`);
    assert.equal(Rules.replay(m, r.routes[0].steps).state.won, true);
  }
});

test('generator: an entry with a single way out never has it locked', () => {
  let single = 0;
  for(let seed = 1; seed <= 60; seed++) {
    const m = Generator.build({ seed, rooms: 14, locks: 3 });
    const ways = m.passages.filter(g => g.a === 'r0' || (g.b === 'r0' && g.dir === 'both'));
    if(ways.length !== 1) continue;
    single++;
    assert.equal(ways[0].lock.length, 0, `seed ${seed}: ${ways[0].id} locked`);
  }
  assert.ok(single > 5, `only ${single} maps with a single entry passage`);
});

test('generator: no leftover keys', () => {
  for(let seed = 1; seed <= 15; seed++) {
    const { model } = Generator.generate({ seed, locks: 3, chests: 2, comboDepth: 2 });
    assert.deepEqual(Validate.run(model).warnings.filter(w => w.code === 'key-extra'), [], `seed ${seed}`);
  }
});
