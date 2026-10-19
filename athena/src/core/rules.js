// Rules engine: a pure state machine shared by the solver, play mode and route playback.
// Rules.init(model) -> state; Rules.actions(model, s) -> legal actions;
// Rules.apply(model, s, action) -> { state, log } (a new state; throws on an illegal action).
DAE_CORE(DAE => {
  const byEntry = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : (a.u ?? 1e9) - (b.u ?? 1e9) || (a.k ?? 1e9) - (b.k ?? 1e9);
  const MAX_EXCHANGES = 10000;
  const ent = e => e.u === null && e.k === null ? e.id : `${e.id}/${e.u}/${e.k}`;
  // arrays copied during the current apply() (copy-on-write for room floors and enemies)
  let OWN = null;

  class Rules {
    static #ctx = new WeakMap();

    //#region [ Context and state ]
    /** Lookups for a model (cached; models are treated as immutable, edit a copy). */
    static ctx(model) {
      let c = Rules.#ctx.get(model);
      if(c) return c;
      const ix = DAE.Model.index(model);
      const adj = new Map(model.rooms.map(r => [r.id, []]));
      model.passages.forEach(g => {
        adj.get(g.a)?.push({ to: g.b, g });
        if(g.dir === 'both') adj.get(g.b)?.push({ to: g.a, g });
      });
      const evByRoom = new Map();
      model.events.forEach(e => (evByRoom.get(e.room) ?? evByRoom.set(e.room, []).get(e.room)).push(e));
      const usable = new Set(model.items.filter(t => t.heal > 0 || t.delFx.length
        || t.addFx.some(id => ix.effects.get(id)?.dur !== 'equip')).map(t => t.id));
      c = {
        model, ix, adj, evByRoom, usable,
        entry: model.rooms.find(r => r.entry)?.id,
        exits: new Set(model.rooms.filter(r => r.exit).map(r => r.id)),
        required: model.rooms.filter(r => r.mark === 'required').map(r => r.id),
        slotIds: model.player.slots.map(s => s.id),
        slotMode: new Map(model.player.slots.map(s => [s.id, s.mode])),
      };
      Rules.#ctx.set(model, c);
      return c;
    }

    /** A fresh held/floor item: u = uses left (null = unlimited), k = key uses left (null = inf or not a key). */
    static entry(ctx, id) {
      const t = ctx.ix.items.get(id);
      return { id, u: t.uses ?? null, k: t.key && t.keyUses !== 'inf' ? t.keyUses : null };
    }

    static addSorted(list, v) {
      if(!list.includes(v)) {
        list.push(v);
        list.sort();
      }
    }

    static init(model) {
      const ctx = Rules.ctx(model);
      const s = {
        room: ctx.entry, hp: 0, dead: false, won: false, fight: null, steps: 0,
        slots: Object.fromEntries(ctx.slotIds.map(id => [id, null])),
        bag: [], fx: [], floor: {}, foes: {}, spawnN: {}, dead_: {},
        opened: [], sealed: [], looted: [], fired: [], seen: [], visits: { [ctx.entry]: 1 },
      };
      for(const r of model.rooms) {
        if(r.items.length) s.floor[r.id] = r.items.map(id => Rules.entry(ctx, id)).sort(byEntry);
        const foes = DAE.Model.foes(r).map(f => Rules.#newFoe(ctx, f.iid, f.type, f.wave));
        if(foes.length) s.foes[r.id] = foes;
        s.spawnN[r.id] = foes.length;
      }
      const log = [];
      model.player.start.forEach(id => Rules.give(ctx, s, Rules.entry(ctx, id), log));
      model.player.fx.forEach(id => DAE.Effects.addPlayer(ctx, s, id));
      s.hp = DAE.Effects.player(ctx, s).maxhp;
      s.dead = s.hp <= 0;
      Rules.#arrive(ctx, s, log);
      return s;
    }

    static #newFoe(ctx, iid, type, wave) {
      const e = ctx.ix.enemies.get(type);
      const f = { iid, type, wave, hp: e.hp, fx: [] };
      e.fx.forEach(id => DAE.Effects.addFoe(ctx, f, id));
      return f;
    }

    static clone(s) {
      const slots = {};
      for(const k in s.slots) slots[k] = s.slots[k] && { ...s.slots[k] };
      // floors and enemies are shared until written (see floorOf / foesOf)
      return {
        ...s, slots, floor: { ...s.floor }, foes: { ...s.foes }, fight: s.fight && { ...s.fight },
        bag: s.bag.map(e => ({ ...e })), fx: s.fx.map(f => ({ ...f })),
        spawnN: { ...s.spawnN }, dead_: { ...s.dead_ }, visits: { ...s.visits },
        opened: [...s.opened], sealed: [...s.sealed], looted: [...s.looted], fired: [...s.fired], seen: [...s.seen],
      };
    }

    /** Canonical text of everything but hp, steps and visits (states equal up to hp share it). */
    static sig(s) {
      const slots = [];
      for(const k in s.slots) slots.push(s.slots[k] ? ent(s.slots[k]) : '-');
      const floor = Object.keys(s.floor).sort().map(k => k + ':' + s.floor[k].map(ent).join(',')).join(';');
      const foes = Object.keys(s.foes).sort().map(k => k + ':' + s.foes[k].map(f => `${f.iid}/${f.hp}/${f.wave}/${f.fx.join('+')}`).join(',')).join(';');
      return [s.room, s.dead ? 1 : 0, s.won ? 1 : 0, s.fight ? s.fight.wave + (s.fight.turn ? 't' : '') : '', slots.join(','),
        s.bag.map(ent).join(','), s.fx.map(f => f.id + '/' + f.t).join(','), floor, foes, Object.keys(s.dead_).sort().join(','),
        s.opened.join(','), s.sealed.join(','), s.looted.join(','), s.fired.join(','), s.seen.join(',')].join('|');
    }

    /** Canonical text of a state; `full` adds visits and steps. */
    static key(s, full = false) {
      let k = Rules.sig(s) + '#' + s.hp;
      if(full) k += '#' + Object.keys(s.visits).sort().map(r => r + s.visits[r]).join(',') + '#' + s.steps;
      return k;
    }

    /** 52-bit FNV-1a style hash of a string, as a short base-36 string. */
    static hash(str) {
      let a = 2166136261, b = 0x9747b28c;
      for(let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        a = Math.imul(a ^ c, 16777619);
        b = Math.imul(b ^ c, 0x5bd1e995);
      }
      return (a >>> 0).toString(36) + '.' + ((b >>> 0) & 0xfffff).toString(36);
    }

    /** The room's floor list, copied first if this apply() hasn't written it yet. */
    static floorOf(s, room) {
      let list = s.floor[room];
      if(!OWN) return list ?? (s.floor[room] = []);
      if(!list) OWN.add(list = s.floor[room] = []);
      else if(!OWN.has(list)) OWN.add(list = s.floor[room] = list.map(e => ({ ...e })));
      return list;
    }

    static foesOf(s, room) {
      let list = s.foes[room];
      if(!OWN) return list ?? (s.foes[room] = []);
      if(!list) OWN.add(list = s.foes[room] = []);
      else if(!OWN.has(list)) OWN.add(list = s.foes[room] = list.map(f => ({ ...f, fx: [...f.fx] })));
      return list;
    }
    //#endregion

    //#region [ Holding items ]
    static held(s) {
      const out = s.bag.map((e, i) => ({ where: 'bag', i, e }));
      for(const k in s.slots) if(s.slots[k]) out.push({ where: k, e: s.slots[k] });
      return out;
    }

    static findHeld(s, id) {
      return Rules.held(s).find(h => h.e.id === id);
    }

    static removeHeld(s, h) {
      if(h.where === 'bag') s.bag.splice(h.i, 1);
      else s.slots[h.where] = null;
    }

    static #toBag(s, e) {
      s.bag.push(e);
      s.bag.sort(byEntry);
    }

    static #see(s, id) {
      Rules.addSorted(s.seen, id);
    }

    /** Puts an item on a room's floor (no breaking). */
    static place(s, room, e) {
      const list = Rules.floorOf(s, room);
      list.push(e);
      list.sort(byEntry);
    }

    /** The player drops an item: breakOnDrop items are destroyed. */
    static #drop(ctx, s, e, log) {
      if(ctx.ix.items.get(e.id).breakOnDrop) log.push(`${e.id} breaks`);
      else Rules.place(s, s.room, e);
    }

    /** Gives an item to the player: bag, or with inventory off a free allowed slot, else the floor. */
    static give(ctx, s, e, log) {
      Rules.#see(s, e.id);
      if(ctx.model.player.inventory) return Rules.#toBag(s, e);
      const free = Rules.#allowedSlots(ctx, e.id).find(id => !s.slots[id]);
      if(free) s.slots[free] = e;
      else {
        Rules.place(s, s.room, e);
        log.push(`no free slot: ${e.id} stays on the floor`);
      }
    }

    static #allowedSlots(ctx, id) {
      const t = ctx.ix.items.get(id);
      return t.slot ? [t.slot] : ctx.slotIds;
    }

    /** Puts an item into a slot, handling the old one by slot mode. */
    static #intoSlot(ctx, s, slot, e, log) {
      const old = s.slots[slot];
      if(old) {
        const mode = ctx.slotMode.get(slot);
        if(mode === 'fixed') throw new Error(`slot ${slot} is fixed`);
        if(mode === 'free' && ctx.model.player.inventory) Rules.#toBag(s, old);
        else Rules.#drop(ctx, s, old, log);
      }
      s.slots[slot] = e;
      DAE.Effects.clamp(ctx, s);
    }
    //#endregion

    //#region [ Conditions, locks, foes ]
    static #keyHolders(ctx, s, color) {
      return Rules.held(s).filter(h => ctx.ix.items.get(h.e.id).key === color && (h.e.k === null || h.e.k > 0));
    }

    static cond(ctx, s, c) {
      switch(c.t) {
        case 'key': return Rules.#keyHolders(ctx, s, c.v).length > 0;
        case 'item': return !!Rules.findHeld(s, c.v);
        case 'kill':
          if(!ctx.ix.enemies.has(c.v)) return c.v in s.dead_;
          return Object.values(s.dead_).includes(c.v) && !DAE.Events.foes(ctx, s, c.v).length;
        case 'stat': return (c.v === 'hp' ? s.hp : DAE.Effects.player(ctx, s)[c.v]) >= c.n;
      }
      return false;
    }

    static lockOk(ctx, s, id, conds) {
      if(s.sealed.includes(id)) return false;
      return s.opened.includes(id) || conds.every(c => Rules.cond(ctx, s, c));
    }

    /** True when crossing needs no key use (open already, or no key condition). */
    static freeLock(s, id, conds) {
      return !s.sealed.includes(id) && (!conds.length || s.opened.includes(id));
    }

    /** Opens a lock for good, spending 1 use per key condition (an inf key first, else the most used). */
    static #open(ctx, s, id, conds, log) {
      if(!conds.length || s.opened.includes(id)) return;
      for(const c of conds) {
        if(c.t !== 'key') continue;
        const hs = Rules.#keyHolders(ctx, s, c.v).sort((a, b) => (a.e.k ?? -1) - (b.e.k ?? -1));
        const h = hs[0];
        if(h.e.k !== null && --h.e.k === 0) {
          Rules.removeHeld(s, h);
          log.push(`${h.e.id} used up`);
        }
      }
      Rules.addSorted(s.opened, id);
      log.push(`open ${id} (${conds.map(DAE.Model.condStr).join(', ')})`);
    }

    static spawn(ctx, s, type, room, wave) {
      if(!ctx.ix.enemies.has(type) || !ctx.adj.has(room)) return;
      const n = s.spawnN[room] = (s.spawnN[room] ?? 0) + 1;
      Rules.foesOf(s, room).push(Rules.#newFoe(ctx, `${room}.${n}`, type, wave));
    }

    static killFoe(ctx, s, room, f, log) {
      const list = Rules.foesOf(s, room);
      list.splice(list.findIndex(x => x.iid === f.iid), 1);
      if(!list.length) delete s.foes[room];
      s.dead_[f.iid] = f.type;
      const drops = ctx.ix.enemies.get(f.type).drop;
      drops.forEach(id => Rules.place(s, room, Rules.entry(ctx, id)));
      log.push(`${f.iid} (${f.type}) dies${drops.length ? ', drops ' + drops.join(', ') : ''}`);
    }
    //#endregion

    //#region [ Moving and fighting ]
    static #arrive(ctx, s, log) {
      DAE.Events.fire(ctx, s, s.room, 'enter', log);
      if(s.dead) return;
      Rules.#startFight(ctx, s, log);
    }

    static #startFight(ctx, s, log) {
      const foes = s.foes[s.room];
      if(foes?.length) {
        s.fight = { wave: Math.min(...foes.map(f => f.wave)), turn: false };
        log.push(`fight: ${foes.map(f => f.type + (f.wave > 1 ? ':' + f.wave : '')).join(', ')}`);
      }
      else Rules.#settle(ctx, s);
    }

    /** Not fighting: the exit counts once every required room was visited. */
    static #settle(ctx, s) {
      s.fight = null;
      s.won = ctx.exits.has(s.room) && ctx.required.every(r => s.visits[r]);
    }

    /** One exchange: the player hits, then the wave hits back. */
    static #exchange(ctx, s, wave, log) {
      const { Effects } = DAE;
      const live = Rules.foesOf(s, s.room).filter(f => f.wave === wave);
      const ps = Effects.player(ctx, s);
      const target = live.find(f => !Effects.foe(ctx, f).invuln);
      if(!target) {
        s.dead = true;
        log.push(`stalemate: ${live.map(f => f.iid).join(', ')} can't be hurt`);
        return 'dead';
      }
      target.hp -= Math.max(1, ps.str - Effects.foe(ctx, target).def);
      for(const e of Object.values(s.slots)) if(e) ctx.ix.items.get(e.id).onHit.forEach(id => Effects.addFoe(ctx, target, id));
      if(target.hp <= 0) Rules.killFoe(ctx, s, s.room, target, log);
      const rest = (s.foes[s.room] ?? []).filter(f => f.wave === wave);
      if(!rest.length) return 'cleared';
      let total = 0;
      for(const f of rest) total += ps.invuln ? 0 : Math.max(1, Effects.foe(ctx, f).str - ps.def);
      s.hp -= total;
      if(s.hp <= 0) {
        s.dead = true;
        log.push('the player dies');
        return 'dead';
      }
      return 'go';
    }

    static #fight(ctx, s, log) {
      const wave = s.fight.wave;
      const names = s.foes[s.room].filter(f => f.wave === wave).map(f => f.type).join(', ');
      const hp0 = s.hp;
      let res = 'go';
      for(let i = 0; res === 'go'; i++) {
        res = Rules.#exchange(ctx, s, wave, log);
        if(i > MAX_EXCHANGES) {
          s.dead = true;
          res = 'dead';
        }
        if(res === 'go' && ctx.model.rules.combatConsumables) {
          s.fight.turn = true;
          log.push(`wave ${wave}: ${names} (hp ${hp0}→${s.hp}), turn pause`);
          return;
        }
      }
      log.push(`wave ${wave}: ${names} (hp ${hp0}→${Math.max(0, s.hp)})`);
      if(res === 'dead') return;
      const foes = s.foes[s.room];
      if(foes?.length) {
        s.fight = { wave: Math.min(...foes.map(f => f.wave)), turn: false };
        return;
      }
      // end of the room fight: durability on equipped gear, effect durations
      for(const k in s.slots) {
        const e = s.slots[k];
        if(!e || e.u === null || !ctx.ix.items.get(e.id).slot) continue;
        if(--e.u <= 0) {
          s.slots[k] = null;
          log.push(`${e.id} breaks`);
        }
      }
      DAE.Effects.tick(ctx, s);
      if(!s.dead) Rules.#settle(ctx, s);
    }
    //#endregion

    //#region [ Actions ]
    /** Legal actions in this state. */
    static actions(model, s) {
      const ctx = Rules.ctx(model);
      if(s.dead) return [];
      const out = [];
      const inv = model.player.inventory;
      const heldIds = [...new Set(Rules.held(s).map(h => h.e.id))];
      const foes = s.foes[s.room] ?? [];

      // use: self items anywhere, enemy-target items only in a fight
      for(const id of heldIds) {
        if(!ctx.usable.has(id)) continue;
        const t = ctx.ix.items.get(id);
        if(t.target === 'self') out.push({ a: 'use', item: id });
        else if(s.fight && t.target === 'one') foes.forEach(f => out.push({ a: 'use', item: id, target: f.iid }));
        else if(s.fight) out.push({ a: 'use', item: id });
      }
      if(s.fight) {
        if(!s.fight.turn) Rules.#equipActions(ctx, s, out);
        out.unshift({ a: 'fight' });
        return out;
      }

      for(const { to, g } of ctx.adj.get(s.room) ?? [])
        if(Rules.lockOk(ctx, s, g.id, g.lock) && !out.some(x => x.a === 'move' && x.to === to)) out.push({ a: 'move', to });
      for(const id of new Set((s.floor[s.room] ?? []).map(e => e.id))) {
        if(inv) { out.push({ a: 'take', item: id }); continue; }
        const slots = Rules.#allowedSlots(ctx, id);
        if(slots.some(k => !s.slots[k])) out.push({ a: 'take', item: id });
        else slots.filter(k => ctx.slotMode.get(k) !== 'fixed').forEach(k => out.push({ a: 'take', item: id, slot: k }));
      }
      Rules.#equipActions(ctx, s, out);
      for(const h of Rules.held(s))
        if(h.where === 'bag' || ctx.slotMode.get(h.where) !== 'fixed')
          if(!out.some(x => x.a === 'drop' && x.item === h.e.id)) out.push({ a: 'drop', item: h.e.id });
      for(const c of model.rooms.find(r => r.id === s.room)?.chests ?? []) {
        const chest = ctx.ix.chests.get(c);
        if(chest && !s.looted.includes(c) && Rules.lockOk(ctx, s, c, chest.lock)) out.push({ a: 'open', chest: c });
      }
      model.recipes.forEach((r, i) => { if(Rules.#canCraft(ctx, s, r)) out.push({ a: 'craft', r: i, item: r.out }); });
      return out;
    }

    static #equipActions(ctx, s, out) {
      if(!ctx.model.player.inventory) return;
      for(const id of new Set(s.bag.map(e => e.id))) {
        const slot = ctx.ix.items.get(id).slot;
        if(slot && !(s.slots[slot] && ctx.slotMode.get(slot) === 'fixed')) out.push({ a: 'equip', item: id });
      }
      for(const k in s.slots) if(s.slots[k] && ctx.slotMode.get(k) === 'free') out.push({ a: 'unequip', slot: k });
    }

    static #canCraft(ctx, s, r) {
      if(r.builder && !ctx.ix.rooms.get(s.room)?.builders.includes(r.builder)) return false;
      const ids = Rules.held(s).map(h => h.e.id);
      return r.in.every(id => {
        const i = ids.indexOf(id);
        if(i < 0) return false;
        ids.splice(i, 1);
        return true;
      });
    }

    /** Applies one action to a copy of the state. */
    static apply(model, s0, a) {
      const ctx = Rules.ctx(model);
      const s = Rules.clone(s0);
      const log = [];
      OWN = new Set();
      try { Rules.#run(model, ctx, s, a, log); }
      finally { OWN = null; }
      return { state: s, log };
    }

    static #run(model, ctx, s, a, log) {
      const fail = msg => { throw new Error(`${Rules.actionStr(a)}: ${msg}`); };
      if(s.dead) fail('the player is dead');
      const inFight = () => { if(s.fight) fail('not during a fight'); };
      const held = id => Rules.findHeld(s, id) ?? fail(`not holding ${id}`);

      switch(a.a) {
        case 'move': {
          inFight();
          const edge = (ctx.adj.get(s.room) ?? []).find(x => x.to === a.to && Rules.lockOk(ctx, s, x.g.id, x.g.lock))
            ?? fail(`no open way to ${a.to}`);
          Rules.#open(ctx, s, edge.g.id, edge.g.lock, log);
          DAE.Events.fire(ctx, s, s.room, 'leave', log);
          if(s.dead) break;
          s.room = a.to;
          s.visits[a.to] = (s.visits[a.to] ?? 0) + 1;
          s.steps++;
          s.won = false;
          Rules.#arrive(ctx, s, log);
          break;
        }
        case 'take': {
          inFight();
          const floor = Rules.floorOf(s, s.room);
          const i = floor.findIndex(e => e.id === a.item);
          if(i < 0) fail('not on the floor');
          const [e] = floor.splice(i, 1);
          if(!floor.length) delete s.floor[s.room];
          if(model.player.inventory) Rules.give(ctx, s, e, log);
          else {
            const slots = Rules.#allowedSlots(ctx, e.id);
            const slot = a.slot ?? slots.find(k => !s.slots[k]) ?? fail('no free slot');
            if(!slots.includes(slot)) fail(`can't go in slot ${slot}`);
            Rules.#see(s, e.id);
            Rules.#intoSlot(ctx, s, slot, e, log);
          }
          break;
        }
        case 'drop': {
          inFight();
          const h = held(a.item);
          if(h.where !== 'bag' && ctx.slotMode.get(h.where) === 'fixed') fail('fixed slot');
          Rules.removeHeld(s, h);
          Rules.#drop(ctx, s, h.e, log);
          DAE.Effects.clamp(ctx, s);
          break;
        }
        case 'equip': {
          if(s.fight?.turn) fail('not between turns');
          const i = s.bag.findIndex(e => e.id === a.item);
          const slot = ctx.ix.items.get(a.item)?.slot;
          if(i < 0 || !slot) fail('not an equippable item in the bag');
          const [e] = s.bag.splice(i, 1);
          Rules.#intoSlot(ctx, s, slot, e, log);
          break;
        }
        case 'unequip': {
          if(s.fight?.turn) fail('not between turns');
          if(!model.player.inventory || ctx.slotMode.get(a.slot) !== 'free' || !s.slots[a.slot]) fail('can\'t unequip');
          Rules.#toBag(s, s.slots[a.slot]);
          s.slots[a.slot] = null;
          DAE.Effects.clamp(ctx, s);
          break;
        }
        case 'use': {
          const h = held(a.item);
          const t = ctx.ix.items.get(a.item);
          if(!ctx.usable.has(a.item)) fail('nothing to use');
          const { Effects } = DAE;
          let foes = [];
          if(t.target === 'one') {
            const f = (s.foes[s.room] ? Rules.foesOf(s, s.room) : []).find(x => x.iid === a.target);
            if(!s.fight || !f) fail('needs a target enemy here');
            foes = [f];
          }
          else if(t.target === 'all') {
            if(!s.fight) fail('needs enemies here');
            foes = Rules.foesOf(s, s.room);
          }
          if(t.target === 'self') {
            if(t.heal) s.hp += t.heal;
            t.delFx.forEach(id => Effects.delPlayer(ctx, s, id));
            t.addFx.filter(id => ctx.ix.effects.get(id)?.dur !== 'equip').forEach(id => Effects.addPlayer(ctx, s, id));
            Effects.clamp(ctx, s);
          }
          else for(const f of foes) {
            t.delFx.forEach(id => Effects.delFoe(ctx, f, id));
            t.addFx.filter(id => ctx.ix.effects.get(id)?.dur !== 'equip').forEach(id => Effects.addFoe(ctx, f, id));
          }
          if(h.e.u !== null && --h.e.u <= 0) Rules.removeHeld(s, h);
          break;
        }
        case 'open': {
          inFight();
          const chest = ctx.ix.chests.get(a.chest);
          if(!chest || !ctx.ix.rooms.get(s.room).chests.includes(a.chest) || s.looted.includes(a.chest)) fail('no such closed chest here');
          if(!Rules.lockOk(ctx, s, a.chest, chest.lock)) fail('locked');
          Rules.#open(ctx, s, a.chest, chest.lock, log);
          Rules.addSorted(s.looted, a.chest);
          chest.items.forEach(id => Rules.place(s, s.room, Rules.entry(ctx, id)));
          log.push(`${a.chest}: ${chest.items.join(', ') || 'empty'}`);
          break;
        }
        case 'craft': {
          inFight();
          const r = model.recipes[a.r] ?? fail('no such recipe');
          if(!Rules.#canCraft(ctx, s, r)) fail('missing inputs or builder');
          if(r.consume) r.in.forEach(id => Rules.removeHeld(s, Rules.findHeld(s, id)));
          Rules.give(ctx, s, Rules.entry(ctx, r.out), log);
          log.push(`craft ${r.out} from ${r.in.join(' + ')}`);
          break;
        }
        case 'fight':
          if(!s.fight) fail('no fight');
          s.fight.turn = false;
          Rules.#fight(ctx, s, log);
          break;
        default:
          fail('unknown action');
      }
    }
    //#endregion

    //#region [ Text form and replay ]
    /** move r1 | take x[>slot] | drop x | equip x | unequip slot | use x[>target] | open c0 | craft out[/i] | fight */
    static actionStr(a) {
      switch(a.a) {
        case 'move': return `move ${a.to}`;
        case 'take': return `take ${a.item}${a.slot ? '>' + a.slot : ''}`;
        case 'use': return `use ${a.item}${a.target ? '>' + a.target : ''}`;
        case 'unequip': return `unequip ${a.slot}`;
        case 'open': return `open ${a.chest}`;
        case 'craft': return `craft ${a.item}/${a.r}`;
        case 'fight': return 'fight';
        default: return `${a.a} ${a.item}`;
      }
    }

    static parseAction(model, str) {
      const [verb, arg = ''] = str.trim().split(/\s+/);
      const [x, y] = arg.split(/[>/]/);
      switch(verb) {
        case 'move': return { a: 'move', to: x };
        case 'take': return y ? { a: 'take', item: x, slot: y } : { a: 'take', item: x };
        case 'use': return y ? { a: 'use', item: x, target: y } : { a: 'use', item: x };
        case 'unequip': return { a: 'unequip', slot: x };
        case 'open': return { a: 'open', chest: x };
        case 'craft': {
          const r = y !== undefined ? +y : model.recipes.findIndex(q => q.out === x);
          return { a: 'craft', r, item: x };
        }
        case 'fight': return { a: 'fight' };
        default: return { a: verb, item: x };
      }
    }

    /** Runs action strings from the start. Stops at the first illegal one. */
    static replay(model, steps) {
      let s = Rules.init(model);
      const states = [s], log = [];
      for(let i = 0; i < steps.length; i++) {
        try {
          const res = Rules.apply(model, s, Rules.parseAction(model, steps[i]));
          s = res.state;
          states.push(s);
          log.push({ step: steps[i], log: res.log });
        }
        catch(err) {
          return { state: s, states, log, error: err.message, at: i };
        }
      }
      return { state: s, states, log };
    }
    //#endregion
  }

  DAE.Rules = Rules;
});
