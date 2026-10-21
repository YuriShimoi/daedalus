// Stage B full search: best-first over rules states with macro moves (walks through quiet rooms
// are one move), auto-pickup, pareto dominance on (hp, steps), visit/time guards and top-k routes.
// Incremental: new Solver(model, opts).step(ms) runs a time slice, so it fits a worker or a UI loop.
DAE_CORE(DAE => {
  class Heap {
    #a = [];
    get size() { return this.#a.length; }
    push(item, prio) {
      const a = this.#a;
      a.push({ item, prio });
      for(let i = a.length - 1; i > 0;) {
        const p = (i - 1) >> 1;
        if(a[p].prio >= a[i].prio) break;
        [a[p], a[i]] = [a[i], a[p]];
        i = p;
      }
    }
    pop() {
      const a = this.#a;
      const top = a[0];
      const last = a.pop();
      if(a.length) {
        a[0] = last;
        for(let i = 0; ;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if(l < a.length && a[l].prio > a[m].prio) m = l;
          if(r < a.length && a[r].prio > a[m].prio) m = r;
          if(m === i) break;
          [a[m], a[i]] = [a[i], a[m]];
          i = m;
        }
      }
      return top?.item;
    }
  }

  class Solver {
    static LABELS = {
      solved: 'solved', partial: 'partial (limit hit, best found so far)',
      unsolvable: 'unsolvable (proven)', limit: 'unsolvable (limit hit)',
    };

    /**
     * @param {object} opts - top (1|3), mode ('safe'|'weighted'), timeLimitMs, maxRoomVisits, maxStates
     */
    constructor(model, opts = {}) {
      const { Rules } = DAE;
      this.model = model;
      this.ctx = Rules.ctx(model);
      this.top = opts.top ?? 1;
      this.mode = opts.mode ?? model.score.mode ?? 'safe';
      this.timeLimitMs = opts.timeLimitMs ?? model.rules.timeLimitMs;
      this.maxVisits = opts.maxRoomVisits ?? model.rules.maxRoomVisits;
      this.maxStates = opts.maxStates ?? 3e6;
      this.firstOnly = !!opts.firstRoute; // stop at the first route (generator check)
      this.ms = 0;
      this.states = 0;
      this.pruned = 0;
      this.limitHit = false;
      this.done = false;
      this.routes = [];
      this.heap = new Heap();
      // randomized greedy rollouts run first (fast routes on big maps), then the best-first search
      this.rolls = 0;
      this.maxRolls = opts.rollouts ?? 48;
      this.rollMs = opts.rollMs ?? this.timeLimitMs * 0.4;
      this.rng = new DAE.Rng(opts.seed ?? 1);
      this.seen = new Set();
      this.front = new Map(); // dominance key -> [[hp, steps]]
      this.dist = this.#exitDistances();
      this.weighted = model.rooms.filter(r => r.weight > 0).map(r => r.id);

      const s = Rules.init(model);
      this.root = this.#normalize({ s, parent: null, acts: [] });
      if(s.dead) this.done = true;
      else this.#add(this.root);
    }

    static solve(model, opts) {
      const solver = new Solver(model, opts);
      while(!solver.done) solver.step(1e9);
      return solver.result();
    }

    //#region [ Search loop ]
    /** Runs for up to `budgetMs`. @returns progress */
    step(budgetMs = 50) {
      const t0 = Date.now();
      while(!this.done && this.heap.size) {
        const spent = this.ms + (Date.now() - t0);
        if(spent > this.timeLimitMs || this.states >= this.maxStates) {
          this.limitHit = true;
          this.done = true;
          break;
        }
        if(this.done) break;
        if(this.rolls < this.maxRolls && spent < this.rollMs) {
          this.rolls++;
          this.#rollout();
        }
        else for(const child of this.#expand(this.heap.pop())) this.#add(child);
        if(Date.now() - t0 >= budgetMs) break;
      }
      this.ms += Date.now() - t0;
      if(!this.heap.size) this.done = true;
      if(this.firstOnly && this.routes.length) this.limitHit = false;
      return { done: this.done, states: this.states, ms: this.ms, found: this.routes.length, best: this.routes[0]?.score };
    }

    #add(node) {
      const { Rules } = DAE;
      const s = node.s;
      if(s.dead) return;
      if(Object.values(s.visits).some(v => v > this.maxVisits)) {
        this.pruned++;
        this.limitHit = true;
        return;
      }
      // pareto dominance on (hp, steps) among states that match in everything else
      const core = Rules.hash(Rules.sig(s));
      const full = core + '#' + s.hp;
      if(this.seen.has(full)) return;
      const list = this.front.get(core) ?? [];
      if(list.some(([hp, st]) => hp >= s.hp && st <= s.steps)) return;
      this.front.set(core, [...list.filter(([hp, st]) => !(s.hp >= hp && s.steps <= st)), [s.hp, s.steps]]);
      this.seen.add(full);
      this.states++;
      if(s.won) return this.#record(node);
      this.heap.push(node, this.#priority(s));
    }

    #record(node) {
      const steps = [];
      for(let n = node; n; n = n.parent) steps.unshift(...n.acts);
      // routes through the same rooms with the same score count as one (the shorter is kept)
      const s = node.s;
      const score = Math.round(this.#score(s) * 1000) / 1000;
      const sig = steps.filter(x => x.startsWith('move ')).join(';') + '|' + score;
      const twin = this.routes.find(r => r.sig === sig);
      if(twin && twin.steps.length <= steps.length) return;
      if(twin) this.routes.splice(this.routes.indexOf(twin), 1);
      const st = DAE.Effects.player(this.ctx, s);
      this.routes.push({
        sig, steps, score, hp: s.hp, maxhp: st.maxhp, str: st.str, def: st.def,
        moves: s.steps, kills: Object.keys(s.dead_).length, items: s.seen.length, cleared: this.#cleared(s),
      });
      this.routes.sort((a, b) => b.score - a.score || a.steps.length - b.steps.length);
      this.routes.length = Math.min(this.routes.length, this.top);
      if(this.firstOnly) this.done = true;
    }

    result() {
      const status = this.routes.length ? (this.limitHit && this.heap.size ? 'partial' : 'solved')
        : this.limitHit ? 'limit' : 'unsolvable';
      return {
        status, label: Solver.LABELS[status], mode: this.mode, states: this.states, ms: this.ms,
        routes: this.routes.map(({ sig, ...r }) => r),
      };
    }
    //#endregion

    //#region [ Scoring ]
    #cleared(s) {
      return !Object.keys(s.foes).length && this.weighted.every(r => s.visits[r]);
    }

    #score(s) {
      if(this.mode !== 'weighted') return s.hp - s.steps * 0.001;
      const { ix } = this.ctx;
      const w = this.model.score.w;
      let items = 0, kills = 0, rooms = 0;
      for(const id of s.seen) items += ix.items.get(id)?.weight ?? 1;
      for(const type of Object.values(s.dead_)) kills += ix.enemies.get(type)?.weight ?? 1;
      for(const id in s.visits) {
        const r = ix.rooms.get(id);
        rooms += r.weight + (r.mark === 'important' ? 1 : 0);
      }
      return w.item * items + w.kill * kills + rooms + w.clear * (this.#cleared(s) ? 1 : 0)
        + w.hp * s.hp + w.exit * (s.won ? 1 : 0) + w.steps * s.steps;
    }

    /**
     * Search order: progress first (locks and chests opened, items found, kills), then the route score,
     * then closeness to an exit. Progress-first finds a route fast on big maps; the search then keeps
     * going and the best routes win by score, not by this order.
     */
    #priority(s) {
      const progress = 6 * (s.opened.length + s.looted.length) + 2 * s.seen.length + Object.keys(s.dead_).length;
      return progress + 0.2 * this.#score(s) - 1.5 * (this.dist.get(s.room) ?? 50);
    }

    /** Graph distance to the nearest exit, ignoring locks (the stage A heuristic). */
    #exitDistances() {
      const back = new Map();
      for(const [from, edges] of this.ctx.adj) for(const { to } of edges) (back.get(to) ?? back.set(to, []).get(to)).push(from);
      const dist = new Map([...this.ctx.exits].map(r => [r, 0]));
      const queue = [...this.ctx.exits];
      while(queue.length) {
        const r = queue.shift();
        for(const p of back.get(r) ?? []) if(!dist.has(p)) { dist.set(p, dist.get(r) + 1); queue.push(p); }
      }
      return dist;
    }
    //#endregion

    //#region [ Rollouts ]
    /**
     * One greedy run from the start: take the nearest target that is safe (fights are simulated
     * with counters, heals and the best gear first), with random tie-breaks. Records a route on the exit.
     */
    #rollout() {
      const { Rules } = DAE;
      let node = this.root;
      for(let guard = 0; guard < 400 && !node.s.won; guard++) {
        node = this.#gear(node);
        const options = [];
        // cheap pre-pick: short walks toward the exit first, a little noise; only the best few get simulated
        const d0 = this.dist.get(node.s.room) ?? 50;
        const walks = this.#walks(node.s).map(path => {
          const end = path[path.length - 1];
          return { path, pre: (d0 - (this.dist.get(end) ?? 50)) * 1.5 - path.length + this.rng.next() * 3 + (this.ctx.exits.has(end) ? 100 : 0) };
        }).sort((a, b) => b.pre - a.pre);
        for(const { path, pre } of walks) {
          if(options.length >= 4) break;
          let child;
          try { child = this.#settleFight(this.#normalize(this.#apply(node, path.map(to => ({ a: 'move', to }))))); }
          catch { continue; }
          if(!child || child.s.dead || Object.values(child.s.visits).some(v => v > this.maxVisits)) continue;
          const gain = this.#priority(child.s) - this.#priority(node.s) + (child.s.hp - node.s.hp) * 0.6;
          options.push({ child, value: child.s.won ? 1e9 : gain + pre });
        }
        this.lastRoll = node;
        if(!options.length) return;
        options.sort((a, b) => b.value - a.value);
        node = options[0].child;
      }
      if(node.s.won) {
        this.states++;
        this.#record(node);
      }
    }

    /** Outside a fight: craft, open paid chests, equip anything that helps, heal below half hp. */
    #gear(node) {
      const { Rules, Effects } = DAE;
      for(let guard = 0; guard < 20; guard++) {
        const low = node.s.hp < Effects.player(this.ctx, node.s).maxhp / 2;
        const a = Rules.actions(this.model, node.s).find(x => x.a === 'craft' || x.a === 'open'
          || (x.a === 'equip' && this.#improves(node.s, x)) || (low && x.a === 'use' && this.ctx.ix.items.get(x.item).heal));
        if(!a) break;
        node = this.#normalize(this.#apply(node, [a]));
      }
      return node;
    }

    /** Plays a fight to its end with a simple policy, or null when every try dies. */
    #settleFight(node) {
      const { Rules, Effects } = DAE;
      for(let guard = 0; node.s.fight && guard < 200; guard++) {
        const s = node.s;
        const options = this.#prepChoices(s);
        const fight = this.#apply(node, [{ a: 'fight' }]);
        if(!fight.s.dead) {
          node = fight;
          continue;
        }
        // the plain fight dies: try the prep choices (counters first, then heals, buffs, gear)
        const st = Effects.player(this.ctx, s);
        const rank = a => a.a === 'use' && this.ctx.ix.items.get(a.item).delFx.length ? 0
          : a.a === 'use' && this.ctx.ix.items.get(a.item).heal && s.hp < st.maxhp ? 1 : 2;
        const pick = options.filter(a => a.a !== 'fight').sort((a, b) => rank(a) - rank(b))[0];
        if(!pick) return null;
        node = this.#apply(node, [pick]);
        if(Rules.key(node.s) === Rules.key(s)) return null;
      }
      return this.#normalize(node);
    }
    //#endregion

    //#region [ Expansion ]
    #apply(node, actions) {
      const { Rules } = DAE;
      let s = node.s;
      const acts = [];
      for(let i = 0; i < actions.length; i++) {
        const a = actions[i];
        acts.push(Rules.actionStr(a));
        // the middle of a walk only crosses quiet rooms through open passages: no clone needed
        if(a.a === 'move' && i > 0 && i < actions.length - 1) {
          s.room = a.to;
          s.visits[a.to] = (s.visits[a.to] ?? 0) + 1;
          s.steps++;
          continue;
        }
        s = Rules.apply(this.model, s, a).state;
        if(s.dead) break;
      }
      return { s, parent: node, acts };
    }

    /** Free moves after arriving: with an inventory, take everything and open chests that cost nothing. */
    #normalize(node) {
      const { Rules } = DAE;
      if(!this.model.player.inventory || node.s.fight || node.s.dead) return node;
      let s = node.s;
      const acts = [...node.acts];
      for(let guard = 0; guard < 200; guard++) {
        const item = s.floor[s.room]?.[0];
        const chest = this.ctx.ix.rooms.get(s.room).chests
          .find(c => !s.looted.includes(c) && Rules.freeLock(s, c, this.ctx.ix.chests.get(c).lock));
        const a = item ? { a: 'take', item: item.id } : chest ? { a: 'open', chest } : null;
        if(!a) break;
        s = Rules.apply(this.model, s, a).state;
        acts.push(Rules.actionStr(a));
      }
      return { s, parent: node.parent, acts };
    }

    #expand(node) {
      const out = [];
      const s = node.s;
      const push = actions => {
        try { out.push(this.#normalize(this.#apply(node, actions))); }
        catch { /* illegal in this state */ }
      };
      if(s.fight) {
        this.#prepChoices(s).forEach(a => push([a]));
        return out;
      }
      this.#localChoices(s).forEach(a => push([a]));
      for(const path of this.#walks(s)) push(path.map(to => ({ a: 'move', to })));
      return out;
    }

    /** Prep (and between-turn) choices that can matter. */
    #prepChoices(s) {
      const { Rules, Effects } = DAE;
      const { ix } = this.ctx;
      const st = Effects.player(this.ctx, s);
      const foes = s.foes[s.room] ?? [];
      const out = [{ a: 'fight' }];
      for(const a of Rules.actions(this.model, s)) {
        if(a.a === 'use') {
          const t = ix.items.get(a.item);
          if(t.target === 'self') {
            const buff = t.addFx.some(id => !s.fx.some(f => f.id === id)) || t.delFx.some(id => s.fx.some(f => f.id === id));
            if((t.heal && s.hp < st.maxhp) || buff) out.push(a);
          }
          else {
            const hit = a.target ? foes.filter(f => f.iid === a.target) : foes;
            if(hit.some(f => t.delFx.some(id => f.fx.includes(id)) || t.addFx.some(id => !f.fx.includes(id)))) out.push(a);
          }
        }
        else if(a.a === 'equip' && this.#improves(s, a)) out.push(a);
      }
      return out;
    }

    #improves(s, a) {
      const { Rules, Effects } = DAE;
      try {
        const before = Effects.player(this.ctx, s);
        const after = Effects.player(this.ctx, Rules.apply(this.model, s, a).state);
        return after.str > before.str || after.def > before.def || after.maxhp > before.maxhp || after.invuln > before.invuln;
      }
      catch { return false; }
    }

    /** Single actions outside a fight: craft, equip, useful uses, paid chests, slot juggling. */
    #localChoices(s) {
      const { Rules, Effects } = DAE;
      const { ix } = this.ctx;
      const st = Effects.player(this.ctx, s);
      const out = [];
      for(const a of Rules.actions(this.model, s)) {
        switch(a.a) {
          case 'craft': out.push(a); break;
          case 'open': out.push(a); break;
          case 'take': if(!this.model.player.inventory) out.push(a); break;
          case 'equip': if(this.#improves(s, a) || ix.items.get(a.item).addFx.length) out.push(a); break;
          case 'use': {
            const t = ix.items.get(a.item);
            if((t.heal && s.hp < st.maxhp) || t.addFx.some(id => !s.fx.some(f => f.id === id))) out.push(a);
            break;
          }
        }
      }
      return out;
    }

    /** Macro moves: paths through quiet rooms to every interesting room reachable now. */
    #walks(s) {
      const { Rules } = DAE;
      const { ix, adj, evByRoom } = this.ctx;
      const quiet = id => !s.foes[id] && !(evByRoom.get(id) ?? []).some(e => !(e.once && s.fired.includes(e.id)));
      const interesting = id => {
        const r = ix.rooms.get(id);
        return !quiet(id) || this.ctx.exits.has(id) || s.floor[id]?.length || r.builders.length
          || r.chests.some(c => !s.looted.includes(c)) || (r.weight > 0 && !s.visits[id]) || r.mark !== 'none' && !s.visits[id]
          || (adj.get(id) ?? []).some(({ g }) => g.lock.length && !s.opened.includes(g.id) && Rules.lockOk(this.ctx, s, g.id, g.lock));
      };
      const paths = [];
      const seen = new Set([s.room]);
      const queue = [{ room: s.room, path: [] }];
      // an exit ends the route once every required room was visited, so walks can't pass it then
      const exitEnds = this.ctx.required.every(r => s.visits[r]);
      while(queue.length) {
        const { room, path } = queue.shift();
        for(const { to, g } of adj.get(room) ?? []) {
          if(seen.has(to) || !Rules.lockOk(this.ctx, s, g.id, g.lock)) continue;
          seen.add(to);
          const next = [...path, to];
          const free = Rules.freeLock(s, g.id, g.lock);
          if(interesting(to) || !free) paths.push(next);
          if(free && quiet(to) && !(exitEnds && this.ctx.exits.has(to))) queue.push({ room: to, path: next });
        }
      }
      return paths;
    }
    //#endregion
  }

  /** Worker body: solves on 'start', answers 'stop' with the best found so far. */
  const WORKER_MAIN = DAE => {
    let solver = null;
    onmessage = e => {
      const { cmd, model, opts } = e.data;
      if(cmd === 'stop') {
        if(solver && !solver.done) {
          solver.done = true;
          solver.limitHit = true;
          postMessage({ type: 'done', result: solver.result() });
        }
        return;
      }
      solver = new DAE.Solver(model, opts);
      const loop = () => {
        if(solver.done) return;
        const p = solver.step(100);
        if(p.done) postMessage({ type: 'done', result: solver.result() });
        else {
          postMessage({ type: 'progress', progress: p });
          setTimeout(loop, 0);
        }
      };
      loop();
    };
  };

  /**
   * Browser runner: a Blob Web Worker built from the core sources (works on file://),
   * or a chunked main-thread loop if workers fail. @returns {{stop: Function}}
   */
  Solver.start = (model, opts, { onProgress = () => {}, onDone = () => {} } = {}) => {
    let worker = null, fallback = null, finished = false;
    const done = result => {
      if(finished) return;
      finished = true;
      worker?.terminate();
      onDone(result);
    };
    const runHere = () => {
      worker?.terminate();
      worker = null;
      fallback = new Solver(model, opts);
      const loop = () => {
        if(finished) return;
        const p = fallback.step(16);
        if(p.done) done(fallback.result());
        else {
          onProgress(p);
          setTimeout(loop, 0);
        }
      };
      loop();
    };
    try {
      worker = globalThis.DAE_CORE.worker(WORKER_MAIN);
      worker.onmessage = e => e.data.type === 'done' ? done(e.data.result) : onProgress(e.data.progress);
      worker.onerror = e => {
        e.preventDefault?.();
        if(!finished) runHere();
      };
      worker.postMessage({ cmd: 'start', model, opts });
    }
    catch { runHere(); }
    return {
      stop() {
        if(worker) worker.postMessage({ cmd: 'stop' });
        else if(fallback && !finished) {
          fallback.limitHit = true;
          done(fallback.result());
        }
      },
    };
  };

  DAE.Solver = Solver;
});
