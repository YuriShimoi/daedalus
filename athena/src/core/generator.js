// Map generator: L-System shape -> loops and one-way shortcuts -> lock-and-key gates (keys always
// placed in front of their lock, optionally behind recipe chains or in chests) -> enemies, waves,
// items and invulnerable enemies with their counter item -> solver check, re-rolled until solvable.
DAE_CORE(DAE => {
  class Generator {
    static DEFAULTS = {
      seed: 1, rooms: 12, branching: 0.4, deepnest: 3, iterations: 40, loops: 1, oneWay: 0.3,
      enemyDensity: 0.5, maxWaves: 2, itemDensity: 0.4, locks: 2, chests: 1, combos: true, comboDepth: 1,
      effects: true, invulnRate: 0.15, difficulty: 0.5, exits: 1, tries: 30, solveMs: 1500,
    };

    /** @returns {{model, seed, tries, result}} the first solvable map from seed, seed+1, ... */
    static generate(params = {}) {
      const p = { ...Generator.DEFAULTS, ...params };
      for(let t = 0; t < p.tries; t++) {
        const model = Generator.build({ ...p, seed: p.seed + t });
        const v = DAE.Validate.run(model);
        if(!v.ok || v.warnings.some(w => w.code === 'key-extra')) continue;   // no leftover keys
        const quick = DAE.Check.run(model, { maxStates: 2000 });
        if(['no-path', 'locks', 'no-route'].includes(quick.verdict)) continue;
        const result = DAE.Solver.solve(model, { timeLimitMs: p.solveMs, mode: 'safe', firstRoute: true });
        if(result.routes.length) return { model, seed: p.seed + t, tries: t + 1, result, quick };
      }
      throw new Error(`no solvable map in ${p.tries} tries from seed ${p.seed}`);
    }

    /** One map from one seed, not checked. */
    static build(params = {}) {
      const p = { ...Generator.DEFAULTS, ...params };
      const rng = new DAE.Rng(p.seed);
      const m = DAE.Model.empty();
      const n = { item: 0, enemy: 0, chest: 0, key: 0, builder: 0, fx: 0 };
      const id = kind => `${{ item: 'i', enemy: 'e', chest: 'c', key: 'k', builder: 'b', fx: 'f' }[kind]}${n[kind]++}`;

      //#region [ Shape ]
      const { nodes, edges } = DAE.LSystem.interpret(DAE.LSystem.grow(rng, p));
      m.rooms = nodes.map((node, i) => ({
        id: `r${i}`, entry: node.kind === 'entry', exit: node.kind === 'exit', weight: 0, mark: 'none',
        enemies: [], items: [], chests: [], builders: [],
      }));
      m.passages = edges.map(([a, b], i) => ({ id: `p${i}`, a: `r${a}`, b: `r${b}`, dir: 'both', lock: [] }));
      const adjTree = Generator.#adjacency(m);
      const lvl = Generator.#bfs(adjTree, 'r0');
      const maxLvl = Math.max(1, ...lvl.values());

      // loops between rooms far apart in the tree; a share become one-way shortcuts back up
      const far = [];
      for(let i = 0; i < m.rooms.length; i++) {
        const from = Generator.#bfs(adjTree, m.rooms[i].id);
        for(let j = i + 1; j < m.rooms.length; j++) {
          const a = m.rooms[i].id, b = m.rooms[j].id;
          const d = from.get(b);
          if(d >= 3 && !m.rooms[i].exit && !m.rooms[j].exit) far.push({ a, b, d });
        }
      }
      far.sort((x, y) => y.d - x.d);
      for(let k = 0; k < p.loops && far.length; k++) {
        const pick = far.splice(rng.int(0, Math.max(0, Math.floor(far.length * 0.3))), 1)[0];
        let [a, b] = [pick.a, pick.b];
        const oneWay = rng.chance(p.oneWay);
        if(oneWay && lvl.get(a) < lvl.get(b)) [a, b] = [b, a];
        m.passages.push({ id: `p${m.passages.length}`, a, b, dir: oneWay ? 'a>b' : 'both', lock: [] });
      }
      //#endregion

      //#region [ Locks and keys ]
      const keyRoom = new Map(); // color -> room the key can be found in
      const exitIds = m.rooms.filter(r => r.exit).map(r => r.id);
      // the entry's only way out is never locked (shortcuts into the entry count as ways out)
      const entryWays = m.passages.filter(g => g.a === 'r0' || (g.b === 'r0' && g.dir === 'both'));
      const firstOnly = entryWays.length === 1 ? entryWays[0] : null;
      for(let k = 0; k < p.locks; k++) {
        // gate on the way to an exit: an open passage whose locking keeps a key room in front
        const path = Generator.#path(m, keyRoom, 'r0', exitIds);
        const options = (path ?? []).filter(g => !g.lock.length && g !== firstOnly);
        rng.shuffle(options);
        let placed = false;
        for(const g of options) {
          const front = Generator.#reachKeys(m, keyRoom, g.id);
          if(exitIds.some(x => front.has(x))) continue; // not a gate
          const rooms = [...front].filter(r => r !== 'r0' || front.size === 1);
          if(!rooms.length) continue;
          const color = id('key');
          // deeper rooms are likelier key spots; deepnest pushes keys further down branches
          const weights = rooms.map(r => 1 + lvl.get(r) * (p.deepnest / 2));
          const room = Generator.#weighted(rng, rooms, weights);
          g.lock = [{ t: 'key', v: color }];
          const item = id('item');
          m.items.push(Generator.#item({ id: item, key: color }));
          keyRoom.set(color, room);
          Generator.#hide(m, rng, p, id, item, room, [...front], 0);
          placed = true;
          break;
        }
        if(!placed) break;
      }
      //#endregion

      //#region [ Player, enemies, items ]
      m.player.slots = [{ id: 'hand', mode: 'free' }, { id: 'body', mode: 'free' }];
      // hub rooms on big maps are crossed many times
      m.rules.maxRoomVisits = Math.max(6, Math.round(m.rooms.length / 4));
      const diff = 0.5 + p.difficulty;
      const tiers = 3 + Math.floor(m.rooms.length / 25);
      const types = [];
      for(let t = 0; t < tiers; t++) {
        const e = { id: id('enemy'), hp: Math.round(4 + t * 5 * diff), str: Math.round(3 + t * 2 * diff), def: Math.round(t * diff), drop: [], fx: [], weight: null };
        m.enemies.push(e);
        types.push(e);
      }
      const gear = (slot, t) => {
        const item = Generator.#item({ id: id('item'), slot, uses: slot === 'hand' ? rng.int(6, 14) : null });
        if(slot === 'hand') item.str = 2 + t * 2;
        else item.def = 1 + t;
        m.items.push(item);
        return item.id;
      };
      let ward = null, counter = null;
      const ghosts = new Map(); // base type -> invulnerable variant
      if(p.effects) {
        ward = { id: id('fx'), hp: 0, str: 0, def: 0, invuln: true, dur: 'perm' };
        m.effects.push(ward);
        m.effects.push({ id: id('fx'), hp: 0, str: 2, def: 0, invuln: false, dur: 2 });
      }
      const tierOf = r => Math.min(tiers - 1, Math.floor((lvl.get(r.id) ?? 0) / maxLvl * tiers * 0.999 + rng.next() * 0.5));
      for(const r of m.rooms) {
        if(r.entry) continue;
        const t = tierOf(r);
        if(!r.exit && rng.chance(p.enemyDensity)) {
          const count = rng.int(1, Math.min(3, 1 + Math.floor(p.maxWaves * diff)));
          for(let c = 0; c < count; c++) {
            const type = types[Math.max(0, t - (c ? rng.int(0, 1) : 0))];
            r.enemies.push({ type: type.id, wave: rng.int(1, p.maxWaves) });
          }
          r.enemies.sort((a, b) => a.wave - b.wave);
          // an invulnerable variant takes the first spot; its counter goes on the way in
          let ghost = null;
          if(ward && rng.chance(p.invulnRate)) {
            ghost = ghosts.get(r.enemies[0].type);
            if(!ghost) {
              ghost = { ...m.enemies.find(e => e.id === r.enemies[0].type), id: id('enemy'), fx: [ward.id], drop: [] };
              m.enemies.push(ghost);
              ghosts.set(r.enemies[0].type, ghost);
            }
            r.enemies[0] = { type: ghost.id, wave: r.enemies[0].wave };
          }
          // trim until a fight against the expected player power here fits the damage budget
          const pstr = m.player.str + 2 + Math.max(0, t - 1) * 2, pdef = m.player.def + Math.max(0, t - 1);
          const budget = m.player.hp * (0.25 + 0.35 * p.difficulty);
          while(r.enemies.length > 1 && Generator.#fightCost(m, r.enemies, pstr, pdef) > budget) r.enemies.pop();
          // loot that pays back most of the fight, less on higher difficulty
          const refund = Math.round(Generator.#fightCost(m, r.enemies, pstr, pdef) * (1.1 - 0.6 * p.difficulty));
          if(refund > 0) {
            const pot = Generator.#item({ id: id('item'), uses: 1, heal: refund });
            m.items.push(pot);
            r.items.push(pot.id);
          }
          r.weight = 1;
          if(ghost && r.enemies.some(f => f.type === ghost.id)) {
            if(!counter) {
              counter = Generator.#item({ id: id('item'), uses: 1, delFx: [ward.id], target: 'one' });
              m.items.push(counter);
            }
            const way = Generator.#treePath(adjTree, 'r0', r.id).slice(0, -1);
            const spot = Generator.#weighted(rng, way, way.map(x => 1 + lvl.get(x)));
            m.rooms.find(x => x.id === spot).items.push(counter.id);
          }
        }
        if(rng.chance(p.itemDensity)) {
          const roll = rng.next();
          if(roll < 0.45) {
            const pot = Generator.#item({ id: id('item'), uses: 1, heal: Math.round(8 + 6 * (t + 1)) });
            m.items.push(pot);
            r.items.push(pot.id);
          }
          else if(roll < 0.75) r.items.push(gear('hand', t));
          else if(roll < 0.9) r.items.push(gear('body', t));
          else if(p.effects) {
            const buff = Generator.#item({ id: id('item'), uses: 1, addFx: [m.effects[1].id], target: 'self' });
            m.items.push(buff);
            r.items.push(buff.id);
          }
          r.weight = Math.max(r.weight, 1);
        }
      }
      // a starter weapon in the entry keeps early fights fair
      m.rooms[0].items.push(gear('hand', 0));
      //#endregion
      return m;
    }

    /** Damage a player with these stats takes from a room's waves (same formula as the rules). */
    static #fightCost(m, foes, str, def) {
      const waves = new Map();
      foes.forEach(f => {
        const e = m.enemies.find(x => x.id === f.type);
        (waves.get(f.wave) ?? waves.set(f.wave, []).get(f.wave)).push({ hp: e.hp, str: e.str, def: e.def });
      });
      let taken = 0;
      for(const wave of [...waves.keys()].sort((a, b) => a - b).map(w => waves.get(w))) {
        while(wave.length) {
          wave[0].hp -= Math.max(1, str - wave[0].def);
          if(wave[0].hp <= 0) wave.shift();
          for(const e of wave) taken += Math.max(1, e.str - def);
          if(taken > 1e4) return taken;
        }
      }
      return taken;
    }

    //#region [ Placement ]
    static #item(fields) {
      return { id: '', slot: null, hp: 0, str: 0, def: 0, uses: null, heal: 0, key: null, keyUses: 1, breakOnDrop: false,
        addFx: [], delFx: [], target: 'self', onHit: [], weight: null, ...fields };
    }

    /** Puts `item` in `room`: plainly, in a chest, or as a recipe made from parts spread over `front`. */
    static #hide(m, rng, p, id, item, room, front, depth) {
      const r = m.rooms.find(x => x.id === room);
      if(p.combos && depth < p.comboDepth && rng.chance(0.5)) {
        const parts = [id('item'), id('item')];
        parts.forEach(x => m.items.push(Generator.#item({ id: x })));
        let builder = null;
        if(rng.chance(0.5)) {
          builder = id('builder');
          const spot = rng.pick(front);
          m.rooms.find(x => x.id === spot).builders.push(builder);
        }
        m.recipes.push({ in: parts, out: item, consume: true, builder });
        parts.forEach(x => Generator.#hide(m, rng, p, id, x, rng.pick(front), front, depth + 1));
        return;
      }
      if(m.chests.length < p.chests && rng.chance(0.5)) {
        const c = id('chest');
        m.chests.push({ id: c, items: [item], lock: [] });
        r.chests.push(c);
        return;
      }
      r.items.push(item);
    }

    static #weighted(rng, list, weights) {
      const total = weights.reduce((a, b) => a + b, 0);
      let x = rng.next() * total;
      for(let i = 0; i < list.length; i++) if((x -= weights[i]) < 0) return list[i];
      return list[list.length - 1];
    }
    //#endregion

    //#region [ Graph helpers ]
    static #adjacency(m) {
      const adj = new Map(m.rooms.map(r => [r.id, []]));
      m.passages.forEach(g => {
        adj.get(g.a).push(g.b);
        adj.get(g.b).push(g.a);
      });
      return adj;
    }

    static #bfs(adj, from) {
      const dist = new Map([[from, 0]]);
      const queue = [from];
      while(queue.length) {
        const r = queue.shift();
        for(const x of adj.get(r)) if(!dist.has(x)) { dist.set(x, dist.get(r) + 1); queue.push(x); }
      }
      return dist;
    }

    static #treePath(adj, from, to) {
      const prev = new Map([[from, null]]);
      const queue = [from];
      while(queue.length) {
        const r = queue.shift();
        if(r === to) break;
        for(const x of adj.get(r)) if(!prev.has(x)) { prev.set(x, r); queue.push(x); }
      }
      const path = [];
      for(let r = to; r !== null && r !== undefined; r = prev.get(r)) path.unshift(r);
      return path;
    }

    /** Rooms reachable from r0 when locks open once their key room is reachable; `closed` stays shut. */
    static #reachKeys(m, keyRoom, closed) {
      const reach = new Set(['r0']);
      let grew = true;
      while(grew) {
        grew = false;
        for(const g of m.passages) {
          if(g.id === closed) continue;
          const open = g.lock.every(c => reach.has(keyRoom.get(c.v)));
          if(!open) continue;
          for(const [a, b] of g.dir === 'both' ? [[g.a, g.b], [g.b, g.a]] : [[g.a, g.b]])
            if(reach.has(a) && !reach.has(b)) { reach.add(b); grew = true; }
        }
      }
      return reach;
    }

    /** Passages on a shortest open way from `from` to any exit (oriented a -> b along the way). */
    static #path(m, keyRoom, from, exits) {
      const prev = new Map([[from, null]]);
      const queue = [from];
      const reach = Generator.#reachKeys(m, keyRoom, null);
      while(queue.length) {
        const r = queue.shift();
        if(exits.includes(r)) {
          const out = [];
          for(let x = r; prev.get(x); x = prev.get(x).from) out.unshift(prev.get(x).g);
          return out;
        }
        for(const g of m.passages) {
          for(const [a, b] of g.dir === 'both' ? [[g.a, g.b], [g.b, g.a]] : [[g.a, g.b]]) {
            if(a !== r || prev.has(b) || !reach.has(b)) continue;
            if(!g.lock.every(c => reach.has(keyRoom.get(c.v)))) continue;
            prev.set(b, { from: a, g });
            queue.push(b);
          }
        }
      }
      return null;
    }
    //#endregion
  }

  DAE.Generator = Generator;
});
