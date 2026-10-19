const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Model, Rules, Solver } = require('./load.js');

const sample = f => Model.parse(fs.readFileSync(path.join(__dirname, '..', 'samples', f), 'utf8'));
const map = text => Model.parse('dae: 1\n' + text);

/** Every route must replay with the rules engine and end on the exit. */
const replays = (m, r) => r.routes.forEach(route => {
  const res = Rules.replay(m, route.steps);
  assert.equal(res.error, undefined, res.error);
  assert.equal(res.state.won, true);
  assert.equal(res.state.hp, route.hp);
});

test('samples: solved and every route replays', () => {
  for(const f of ['tutorial', 'waves', 'effects', 'events', 'recipes', 'no-inventory']) {
    const m = sample(f + '.toon');
    for(const mode of ['safe', 'weighted']) {
      const r = Solver.solve(m, { top: 3, mode });
      assert.equal(r.status, 'solved', `${f} ${mode}`);
      assert.ok(r.routes.length >= 1);
      replays(m, r);
      const scores = r.routes.map(x => x.score);
      assert.deepEqual(scores, [...scores].sort((a, b) => b - a), 'best first');
    }
  }
});

test('known best: tutorial needs holy water on the ghost and ends at hp 15', () => {
  const r = Solver.solve(sample('tutorial.toon'), { mode: 'safe' });
  assert.equal(r.routes[0].hp, 15);
  assert.ok(r.routes[0].steps.includes('use holywater>r2.2'));
});

test('known best: safe mode skips an optional fight, weighted takes it', () => {
  const safe = Solver.solve(sample('events.toon'), { mode: 'safe' });
  assert.deepEqual(safe.routes[0].steps, ['move r1', 'take herb', 'move r4', 'move r5']);
  const weighted = Solver.solve(sample('events.toon'), { mode: 'weighted' });
  assert.ok(weighted.routes[0].steps.includes('fight'));
  assert.ok(weighted.routes[0].kills > 0);
});

test('known best: picks the stronger weapon and kills every wave', () => {
  const r = Solver.solve(sample('waves.toon'), { mode: 'safe' });
  assert.equal(r.routes[0].hp, 40);
  assert.ok(r.routes[0].steps.includes('equip axe'));
});

test('unsolvable is proven when the search runs out', () => {
  const r = Solver.solve(sample('locked.toon'));
  assert.equal(r.status, 'unsolvable');
  const lost = Solver.solve(map(`player:
  hp: 5
  str: 1
enemies[1]{id,hp,str}:
  ogre,40,9
rooms[2]{id,flags,enemies}:
  r0,entry,
  r1,exit,ogre
passages[1]{id,a,b}:
  p0,r0,r1
`));
  assert.equal(lost.status, 'unsolvable');
});

test('visit guard: a route that needs more visits than allowed is a limit hit', () => {
  // the key sits behind a room the route must pass 3 times
  const text = `items[3]{id,key}:
  k1,a
  k2,b
  k3,c
rooms[5]{id,flags,items}:
  r0,entry,
  r1,,
  r2,,k1
  r3,,k2
  r4,exit,k3
passages[4]{id,a,b,lock}:
  p0,r0,r1,
  p1,r1,r2,
  p2,r1,r3,key:a
  p3,r1,r4,key:b
`;
  assert.equal(Solver.solve(map(text), { maxRoomVisits: 1 }).status, 'limit');
  assert.equal(Solver.solve(map(text), { maxRoomVisits: 4 }).status, 'solved');
});

test('time limit stops the search', () => {
  const s = new Solver(sample('waves.toon'), { timeLimitMs: 0 });
  s.step(1000);
  assert.equal(s.done, true);
  assert.ok(['partial', 'limit'].includes(s.result().status));
});

test('step() is incremental and reports progress', () => {
  const s = new Solver(sample('waves.toon'), { top: 3, mode: 'weighted' });
  let p, guard = 0;
  do { p = s.step(1); } while(!p.done && ++guard < 1e5);
  assert.equal(p.done, true);
  assert.equal(s.result().status, 'solved');
});

test('required rooms are on every route', () => {
  const m = map(`rooms[3]{id,flags,mark}:
  r0,entry,
  r1,exit,
  r2,,required
passages[2]{id,a,b}:
  p0,r0,r1
  p1,r0,r2
`);
  const r = Solver.solve(m);
  assert.deepEqual(r.routes[0].steps, ['move r2', 'move r0', 'move r1']);
});
