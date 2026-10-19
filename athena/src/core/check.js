// Stage A quick check, no combat simulation. Each step is a result on its own:
// 1 links (entry -> exit), 2 optimistic lock-key fixpoint (proves "unsolvable"),
// 3 exact enemy-free search (route that never fights; on a map without enemies a failed search
// proves "unsolvable (no route)"), else "needs combat".
DAE_CORE(DAE => {
  class Check {
    static LABELS = {
      'no-path': 'unsolvable (no path)',
      locks: 'unsolvable (locks)',
      'no-enemies': 'solvable without enemies',
      'no-route': 'unsolvable (no route)',
      combat: 'needs combat',
    };

    /** @returns {{verdict, label, ms, blockers?, route?, states?, truncated?}} */
    static run(model, { maxStates = 50000 } = {}) {
      const t0 = Date.now();
      const done = r => ({ ...r, label: Check.LABELS[r.verdict], ms: Date.now() - t0 });
      const ctx = DAE.Rules.ctx(model);
      if(!ctx.entry || !ctx.exits.size) return done({ verdict: 'no-path', blockers: [], msg: 'no entry or no exit room' });

      const linked = DAE.Validate.reach(model, ctx.entry);
      const missing = [...ctx.exits, ...ctx.required].filter(r => !linked.has(r));
      if(![...ctx.exits].some(r => linked.has(r)) || ctx.required.some(r => !linked.has(r)))
        return done({ verdict: 'no-path', blockers: missing.map(r => ({ id: r, need: ['link'] })) });

      const fp = Check.optimistic(model);
      if(!fp.ok) return done({ verdict: 'locks', blockers: fp.blockers, reach: [...fp.reach] });

      const calm = Check.peaceful(model, maxStates);
      if(calm.route) return done({ verdict: 'no-enemies', route: calm.route, states: calm.states });
      // no enemy can ever exist: the exhaustive search was the real game
      const foeless = model.rooms.every(r => !r.enemies.length) && model.events.every(e => e.do.every(a => a.op !== 'spawn'));
      if(foeless && !calm.truncated) return done({ verdict: 'no-route', states: calm.states });
      return done({ verdict: 'combat', states: calm.states, truncated: calm.truncated, reach: [...fp.reach] });
    }

    /**
     * Everything only ever gets better: keys are infinite, enemies beatable, unlock/give/spawn/kill
     * events fire, lock/take events and stats are ignored. If no exit is reached, the map is unsolvable.
     */
    static optimistic(model) {
      const { Rules, Model } = DAE;
      const ctx = Rules.ctx(model);
      const ix = ctx.ix;
      const reach = new Set([ctx.entry]);
      const have = new Set(model.player.start);
      const opened = new Set(), looted = new Set(), fired = new Set();
      const killed = new Set(), builders = new Set();
      const spawned = new Map(); // room -> enemy types
      const keys = () => new Set([...have].map(id => ix.items.get(id)?.key).filter(Boolean));
      const condOk = (c, colors) => c.t === 'key' ? colors.has(c.v) : c.t === 'item' ? have.has(c.v)
        : c.t === 'kill' ? killed.has(c.v) || (spawned.has(c.v.split('.')[0]) && reach.has(c.v.split('.')[0]))
        : c.t === 'stat';
      const kill = (iid, type) => {
        killed.add(iid);
        killed.add(type);
        ix.enemies.get(type)?.drop.forEach(id => have.add(id));
      };

      let changed = true;
      while(changed) {
        changed = false;
        const size = have.size + reach.size + opened.size + killed.size + fired.size;
        let colors = keys();
        for(const id of reach) {
          const room = ix.rooms.get(id);
          room.items.forEach(x => have.add(x));
          room.builders.forEach(b => builders.add(b));
          Model.foes(room).forEach(f => kill(f.iid, f.type));
          (spawned.get(id) ?? []).forEach(type => kill(`${id}.*`, type));
          for(const c of room.chests) {
            const chest = ix.chests.get(c);
            if(chest && !looted.has(c) && (opened.has(c) || chest.lock.every(x => condOk(x, colors)))) {
              looted.add(c);
              chest.items.forEach(x => have.add(x));
            }
          }
          for(const e of ctx.evByRoom.get(id) ?? []) {
            if(fired.has(e.id) || !e.if.every(x => condOk(x, colors))) continue;
            fired.add(e.id);
            for(const a of e.do) {
              if(a.op === 'give') have.add(a.v);
              else if(a.op === 'unlock') opened.add(a.v);
              else if(a.op === 'spawn') spawned.set(a.room, [...(spawned.get(a.room) ?? []), a.v]);
              else if(a.op === 'kill') {
                if(ix.enemies.has(a.v)) kill(a.v, a.v);
                else {
                  const [room] = a.v.split('.');
                  const f = Model.foes(ix.rooms.get(room) ?? { id: room, enemies: [] }).find(x => x.iid === a.v);
                  if(f) kill(f.iid, f.type);
                }
              }
            }
          }
        }
        for(const r of model.recipes)
          if((!r.builder || builders.has(r.builder)) && r.in.every(x => have.has(x))) have.add(r.out);
        colors = keys();
        for(const id of [...reach]) {
          for(const { to, g } of ctx.adj.get(id) ?? []) {
            if(reach.has(to)) continue;
            if(opened.has(g.id) || g.lock.every(x => condOk(x, colors))) reach.add(to);
          }
        }
        changed = size !== have.size + reach.size + opened.size + killed.size + fired.size;
      }

      const ok = [...ctx.exits].some(r => reach.has(r)) && ctx.required.every(r => reach.has(r));
      const blockers = [];
      if(!ok) {
        const colors = keys();
        for(const id of reach) for(const { to, g } of ctx.adj.get(id) ?? [])
          if(!reach.has(to) && !blockers.some(b => b.id === g.id))
            blockers.push({ id: g.id, kind: 'passage', from: id, to, need: g.lock.filter(x => !condOk(x, colors)).map(Model.condStr) });
        for(const id of reach) for(const c of ix.rooms.get(id).chests)
          if(!looted.has(c)) blockers.push({ id: c, kind: 'chest', room: id, need: ix.chests.get(c).lock.filter(x => !condOk(x, colors)).map(Model.condStr) });
      }
      return { ok, reach, have, blockers };
    }

    /** Exact BFS with the real rules that never starts a fight. Shortest route or null. */
    static peaceful(model, maxStates = 50000) {
      const { Rules } = DAE;
      const start = Rules.init(model);
      if(start.fight || start.dead) return { route: null, states: 1 };
      if(start.won) return { route: [], states: 1 };
      const seen = new Set([Rules.hash(Rules.key(start))]);
      const queue = [{ s: start, prev: null, step: null }];
      for(let qi = 0; qi < queue.length; qi++) {
        const node = queue[qi];
        for(const a of Rules.actions(model, node.s)) {
          if(a.a === 'fight' || a.a === 'drop' || a.a === 'unequip') continue;
          let next;
          try { next = Rules.apply(model, node.s, a).state; }
          catch { continue; }
          if(next.fight || next.dead) continue;
          const k = Rules.hash(Rules.key(next));
          if(seen.has(k)) continue;
          seen.add(k);
          const child = { s: next, prev: node, step: Rules.actionStr(a) };
          if(next.won) {
            const route = [];
            for(let n = child; n.prev; n = n.prev) route.unshift(n.step);
            return { route, states: seen.size };
          }
          if(seen.size >= maxStates) return { route: null, states: seen.size, truncated: true };
          queue.push(child);
        }
      }
      return { route: null, states: seen.size };
    }
  }

  DAE.Check = Check;
});
