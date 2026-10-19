// Structural checks on a normalized model: unknown IDs, bad values, missing entry/exit.
// Solvability is not checked here (that's check.js).
DAE_CORE(DAE => {
  class Validate {
    /**
     * @returns {{ok: boolean, errors: {code, msg, at}[], warnings: {code, msg, at}[]}}
     */
    static run(m) {
      const { Model } = DAE;
      const errors = [], warnings = [];
      const err = (code, msg, at) => errors.push({ code, msg, at });
      const warn = (code, msg, at) => warnings.push({ code, msg, at });
      const ix = Model.index(m);

      if(m.dae !== 1) err('version', `unsupported dae version ${m.dae}`, 'dae');

      //#region [ IDs ]
      const groups = { rooms: m.rooms, items: m.items, enemies: m.enemies, effects: m.effects, chests: m.chests,
        passages: m.passages, events: m.events, slots: m.player.slots, solutions: m.solutions };
      for(const [name, arr] of Object.entries(groups)) {
        const seen = new Set();
        arr.forEach((x, i) => {
          if(!x.id) err('id-missing', `${name}[${i}] has no id`, `${name}[${i}]`);
          else if(seen.has(x.id)) err('id-dup', `duplicate ${name} id "${x.id}"`, x.id);
          seen.add(x.id);
        });
      }
      if(ix.enemies.has('player')) err('id-reserved', '"player" is reserved and can\'t be an enemy id', 'player');

      // every enemy instance, starting ones plus spawns (r2.1 ... and spawned types)
      const instances = new Set();
      m.rooms.forEach(r => Model.foes(r).forEach(f => instances.add(f.iid)));
      const isTarget = t => t === 'player' || ix.enemies.has(t) || instances.has(t);
      //#endregion

      //#region [ Helpers ]
      const needItem = (id, at) => { if(!ix.items.has(id)) err('ref-item', `unknown item "${id}"`, at); };
      const needFx = (id, at) => { if(!ix.effects.has(id)) err('ref-effect', `unknown effect "${id}"`, at); };
      const needRoom = (id, at) => { if(!ix.rooms.has(id)) err('ref-room', `unknown room "${id}"`, at); };
      const needEnemy = (id, at) => { if(!ix.enemies.has(id)) err('ref-enemy', `unknown enemy "${id}"`, at); };
      const keyColors = new Set(m.items.filter(t => t.key).map(t => t.key));
      const nonNeg = (v, what, at) => {
        if(v !== null && !(Number.isFinite(v) && v >= 0)) err('value', `${what} must be a number >= 0`, at);
      };
      const conds = (list, at) => list.forEach(c => {
        if(!Model.COND_TYPES.includes(c.t)) return err('cond', `unknown condition "${c.t}"`, at);
        if(c.t === 'key' && !keyColors.has(c.v)) warn('key-none', `no item opens key "${c.v}"`, at);
        if(c.t === 'item') needItem(c.v, at);
        if(c.t === 'kill' && !ix.enemies.has(c.v) && !instances.has(c.v)) err('ref-enemy', `unknown kill target "${c.v}"`, at);
        if(c.t === 'stat' && (!Model.STATS.includes(c.v) || !Number.isFinite(c.n))) err('cond', `bad stat condition "${Model.condStr(c)}"`, at);
      });
      //#endregion

      //#region [ Player, effects, items, enemies ]
      const p = m.player;
      if(!(p.hp > 0)) err('value', 'player hp must be > 0', 'player');
      nonNeg(p.str, 'player str', 'player');
      nonNeg(p.def, 'player def', 'player');
      p.slots.forEach(s => { if(!Model.SLOT_MODES.includes(s.mode)) err('value', `slot "${s.id}" has bad mode "${s.mode}"`, s.id); });
      p.start.forEach(id => needItem(id, 'player.start'));
      p.fx.forEach(id => needFx(id, 'player.fx'));
      if(!p.inventory && !p.slots.length) warn('no-slots', 'inventory is off and there are no slots: the player can\'t hold anything', 'player');

      m.effects.forEach(e => {
        if(!(e.dur === 'perm' || e.dur === 'equip' || (Number.isInteger(e.dur) && e.dur > 0)))
          err('value', `effect "${e.id}" has bad dur "${e.dur}" (perm, equip or N > 0)`, e.id);
      });

      m.items.forEach(t => {
        if(t.slot !== null && !ix.slots.has(t.slot)) err('ref-slot', `item "${t.id}" uses unknown slot "${t.slot}"`, t.id);
        nonNeg(t.uses, `item "${t.id}" uses`, t.id);
        nonNeg(t.heal, `item "${t.id}" heal`, t.id);
        if(t.key && !(t.keyUses === 'inf' || (Number.isInteger(t.keyUses) && t.keyUses > 0)))
          err('value', `item "${t.id}" keyUses must be inf or N > 0`, t.id);
        if(!Model.TARGETS.includes(t.target)) err('value', `item "${t.id}" has bad target "${t.target}"`, t.id);
        [...t.addFx, ...t.delFx, ...t.onHit].forEach(id => needFx(id, t.id));
        const equipFx = t.addFx.filter(id => ix.effects.get(id)?.dur === 'equip');
        if(equipFx.length && t.slot === null) warn('equip-fx', `item "${t.id}" gives equip effects but has no slot`, t.id);
      });

      m.enemies.forEach(e => {
        if(!(e.hp > 0)) err('value', `enemy "${e.id}" hp must be > 0`, e.id);
        nonNeg(e.str, `enemy "${e.id}" str`, e.id);
        nonNeg(e.def, `enemy "${e.id}" def`, e.id);
        e.drop.forEach(id => needItem(id, e.id));
        e.fx.forEach(id => needFx(id, e.id));
      });
      //#endregion

      //#region [ Rooms, chests, passages ]
      const entries = m.rooms.filter(r => r.entry);
      if(!entries.length) err('entry', 'no entry room', 'rooms');
      if(entries.length > 1) err('entry', `more than one entry room (${entries.map(r => r.id).join(', ')})`, 'rooms');
      if(!m.rooms.some(r => r.exit)) err('exit', 'no exit room', 'rooms');

      const chestRoom = new Map();
      m.rooms.forEach(r => {
        if(!Model.MARKS.includes(r.mark)) err('value', `room "${r.id}" has bad mark "${r.mark}"`, r.id);
        r.enemies.forEach(f => {
          needEnemy(f.type, r.id);
          if(!(Number.isInteger(f.wave) && f.wave > 0)) err('value', `room "${r.id}" enemy "${f.type}" has bad wave`, r.id);
        });
        r.items.forEach(id => needItem(id, r.id));
        r.chests.forEach(id => {
          if(!ix.chests.has(id)) err('ref-chest', `unknown chest "${id}"`, r.id);
          else if(chestRoom.has(id)) err('chest-twice', `chest "${id}" is in rooms ${chestRoom.get(id)} and ${r.id}`, id);
          chestRoom.set(id, r.id);
        });
      });
      m.chests.forEach(c => {
        if(!chestRoom.has(c.id)) warn('chest-unused', `chest "${c.id}" is in no room`, c.id);
        c.items.forEach(id => needItem(id, c.id));
        conds(c.lock, c.id);
      });

      const pairs = new Set();
      m.passages.forEach(g => {
        needRoom(g.a, g.id);
        needRoom(g.b, g.id);
        if(g.a === g.b) err('passage-loop', `passage "${g.id}" links room "${g.a}" to itself`, g.id);
        if(g.dir !== 'both' && g.dir !== 'a>b') err('value', `passage "${g.id}" has bad dir "${g.dir}" (both or a>b)`, g.id);
        const pair = [g.a, g.b].sort().join('|');
        if(pairs.has(pair)) warn('passage-dup', `more than one passage between ${g.a} and ${g.b}`, g.id);
        pairs.add(pair);
        conds(g.lock, g.id);
      });
      //#endregion

      //#region [ Recipes, events ]
      const builders = new Set(m.rooms.flatMap(r => r.builders));
      m.recipes.forEach((r, i) => {
        const at = `recipes[${i}]`;
        if(!r.in.length) err('recipe', 'recipe with no inputs', at);
        r.in.forEach(id => needItem(id, at));
        needItem(r.out, at);
        if(r.builder && !builders.has(r.builder)) warn('builder-none', `no room has builder "${r.builder}"`, at);
      });

      m.events.forEach(e => {
        needRoom(e.room, e.id);
        if(e.on !== 'enter' && e.on !== 'leave') err('value', `event "${e.id}" has bad on "${e.on}" (enter or leave)`, e.id);
        conds(e.if, e.id);
        e.do.forEach(a => {
          const lockable = ix.passages.has(a.v) || ix.chests.has(a.v);
          if(!Model.ACTIONS.includes(a.op)) err('action', `event "${e.id}" has unknown action "${a.op}"`, e.id);
          else if(a.op === 'lock' || a.op === 'unlock') { if(!lockable) err('ref-lock', `"${a.v}" is not a passage or chest`, e.id); }
          else if(a.op === 'give' || a.op === 'take') needItem(a.v, e.id);
          else if(a.op === 'fx+' || a.op === 'fx-') {
            needFx(a.v, e.id);
            if(!isTarget(a.target)) err('ref-target', `unknown target "${a.target}"`, e.id);
          }
          else if(a.op === 'spawn') {
            needEnemy(a.v, e.id);
            needRoom(a.room, e.id);
            if(!(Number.isInteger(a.wave) && a.wave > 0)) err('value', `event "${e.id}" spawn has bad wave`, e.id);
          }
          else if(a.op === 'kill' && (a.v === 'player' || !isTarget(a.v))) err('ref-target', `bad kill target "${a.v}"`, e.id);
        });
      });
      //#endregion

      //#region [ Reach and slots ]
      if(entries.length === 1) {
        const seen = Validate.reach(m, entries[0].id);
        m.rooms.filter(r => !seen.has(r.id)).forEach(r => warn('unreachable', `room "${r.id}" can't be reached from the entry`, r.id));
      }
      // no leftover keys: the key uses a run can collect match the locks of that color, unless the extra
      // copies are a shortcut (found at different distances, so a run takes the near one and skips the far one)
      for(const [color, { uses, masters, locks, shortcut }] of Validate.keySupply(m)) {
        if(shortcut) continue;
        if(masters > 1 || (masters && uses)) warn('key-extra', `key "${color}": more than one key for its locks (one has unlimited uses)`, color);
        else if(!masters && uses > locks) warn('key-extra', `key "${color}": ${uses === Infinity ? 'unlimited' : uses} use${uses === 1 ? '' : 's'} for ${locks} lock${locks === 1 ? '' : 's'}`, color);
      }
      if(!p.inventory && p.slots.length) {
        const keys = m.items.filter(t => t.key).length;
        if(keys > p.slots.length) warn('slots-few', `inventory is off: ${keys} keys but only ${p.slots.length} slots`, 'player');
      }
      //#endregion

      return { ok: !errors.length, errors, warnings };
    }

    /**
     * Per key color: the most key uses a run can collect (copies x keyUses), copies of inf keys (masters), its locks,
     * and whether the copies are a shortcut (sources at different distances from the entry).
     * Sources: the start, rooms, chests, enemy drops, event gives and recipes; repeatable sources count as unlimited.
     * Distance is in rooms from the entry, ignoring locks; a craft counts at its farthest input or builder.
     * Colors with unlimited locks (a lock action on a repeating event) are left out.
     * @returns {Map<string, {uses: number, masters: number, locks: number, shortcut: boolean}>}
     */
    static keySupply(m) {
      const count = (list, id) => list.filter(x => x === id).length;
      const entry = m.rooms.find(r => r.entry)?.id;
      const dist = entry ? Validate.distances(m, entry) : new Map();
      const far = id => dist.get(id) ?? Infinity;
      const nearest = list => Math.min(Infinity, ...list);
      // where a run can meet each enemy type: starting rooms and spawn rooms
      const foes = new Map();   // type -> { n, d }
      const meet = (type, n, room) => {
        const f = foes.get(type) ?? { n: 0, d: Infinity };
        foes.set(type, { n: f.n + n, d: Math.min(f.d, far(room)) });
      };
      m.rooms.forEach(r => r.enemies.forEach(f => meet(f.type, 1, r.id)));
      m.events.forEach(e => e.do.forEach(a => { if(a.op === 'spawn') meet(a.v, e.once ? 1 : Infinity, a.room); }));
      const builderAt = b => nearest(m.rooms.filter(r => r.builders.includes(b)).map(r => far(r.id)));

      const memo = new Map();
      /** Sources of an item: [{ n: copies, d: distance }] */
      const sources = id => {
        if(memo.has(id)) return memo.get(id);
        memo.set(id, []);   // a recipe cycle adds nothing
        const out = [];
        const add = (n, d) => { if(n > 0) out.push({ n, d }); };
        add(count(m.player.start, id), 0);
        m.rooms.forEach(r => {
          add(count(r.items, id), far(r.id));
          r.chests.forEach(c => add(count(m.chests.find(x => x.id === c)?.items ?? [], id), far(r.id)));
        });
        m.enemies.forEach(e => { const f = foes.get(e.id); if(f) add(count(e.drop, id) * f.n, f.d); });
        m.events.forEach(e => e.do.forEach(a => { if(a.op === 'give' && a.v === id) add(e.once ? 1 : Infinity, far(e.room)); }));
        m.recipes.filter(r => r.out === id).forEach(r => {
          const ins = [...new Set(r.in)].map(x => ({ need: count(r.in, x), src: sources(x) }));
          const crafts = ins.length ? Math.min(...ins.map(x => Math.floor(x.src.reduce((a, b) => a + b.n, 0) / x.need))) : Infinity;
          const d = Math.max(r.builder ? builderAt(r.builder) : 0, ...ins.map(x => nearest(x.src.map(q => q.d))));
          add(r.consume ? crafts : crafts > 0 ? Infinity : 0, d);
        });
        memo.set(id, out);
        return out;
      };

      const locks = new Map();
      const lockOf = new Map();   // passage/chest id -> its key colors
      for(const x of [...m.passages, ...m.chests]) {
        const colors = x.lock.filter(c => c.t === 'key').map(c => c.v);
        lockOf.set(x.id, colors);
        colors.forEach(c => locks.set(c, (locks.get(c) ?? 0) + 1));
      }
      m.events.forEach(e => e.do.forEach(a => {
        if(a.op === 'lock') (lockOf.get(a.v) ?? []).forEach(c => locks.set(c, (locks.get(c) ?? 0) + (e.once ? 1 : Infinity)));
      }));
      const out = new Map();
      for(const t of m.items.filter(t => t.key)) {
        const lk = locks.get(t.key) ?? 0;
        if(lk === Infinity) continue;
        const cur = out.get(t.key) ?? { uses: 0, masters: 0, locks: lk, shortcut: false, dists: new Set() };
        for(const src of sources(t.id)) {
          if(t.keyUses === 'inf') cur.masters += src.n;   // an inf key opens every lock: one copy is enough
          else cur.uses += src.n * t.keyUses;
          cur.dists.add(src.d);
        }
        cur.shortcut = cur.dists.size > 1;
        out.set(t.key, cur);
      }
      for(const v of out.values()) delete v.dists;
      return out;
    }

    /** Rooms from a room (BFS hops), following passage direction, ignoring locks and enemies. */
    static distances(m, from) {
      const out = new Map();
      m.passages.forEach(g => {
        (out.get(g.a) ?? out.set(g.a, []).get(g.a)).push(g.b);
        if(g.dir === 'both') (out.get(g.b) ?? out.set(g.b, []).get(g.b)).push(g.a);
      });
      const d = new Map([[from, 0]]);
      const queue = [from];
      while(queue.length) {
        const at = queue.shift();
        for(const n of out.get(at) ?? []) if(!d.has(n)) { d.set(n, d.get(at) + 1); queue.push(n); }
      }
      return d;
    }

    /** Rooms reachable from a room, following passage direction, ignoring locks and enemies. */
    static reach(m, from) {
      const out = new Map();
      m.passages.forEach(g => {
        (out.get(g.a) ?? out.set(g.a, []).get(g.a)).push(g.b);
        if(g.dir === 'both') (out.get(g.b) ?? out.set(g.b, []).get(g.b)).push(g.a);
      });
      const seen = new Set([from]);
      const queue = [from];
      while(queue.length) for(const n of out.get(queue.shift()) ?? []) {
        if(!seen.has(n)) { seen.add(n); queue.push(n); }
      }
      return seen;
    }
  }

  DAE.Validate = Validate;
});
