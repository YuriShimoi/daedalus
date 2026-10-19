// Athena map model: defaults, TOON doc <-> normalized model, cell syntax helpers.
// The normalized model is plain JSON (no Infinity): keyUses 'inf', uses null = unlimited.
DAE_CORE(DAE => {
  /** "a+b+c" -> ['a','b','c'] */
  const list = v => v === undefined || v === null || v === '' ? [] : String(v).split('+').map(x => x.trim()).filter(Boolean);
  /** ['a','b'] -> "a+b", or undefined when empty (column can be dropped) */
  const join = arr => arr?.length ? arr.join('+') : undefined;
  /** value, or undefined when it equals the default */
  const opt = (v, def) => v === def || v === undefined || v === null ? undefined : v;
  const str = v => v === undefined || v === null ? v : String(v);
  const num = (v, def) => v === undefined || v === null || v === '' ? def : Number(v);
  const bool = (v, def) => v === undefined || v === null || v === '' ? def : v === true || v === 'true';

  class Model {
    static RULES = { combatConsumables: false, maxRoomVisits: 4, timeLimitMs: 10000 };
    static WEIGHTS = { item: 1, kill: 2, clear: 5, hp: 1, exit: 10, steps: -0.1 };
    static PLAYER = { hp: 30, str: 5, def: 2, inventory: true };
    static SLOT_MODES = ['fixed', 'hold-drop', 'free'];
    static MARKS = ['none', 'important', 'required'];
    static TARGETS = ['self', 'one', 'all'];
    static COND_TYPES = ['key', 'item', 'kill', 'stat'];
    static STATS = ['hp', 'str', 'def'];
    static ACTIONS = ['lock', 'unlock', 'give', 'take', 'fx+', 'fx-', 'spawn', 'kill'];

    static empty() {
      return Model.fromDoc({ dae: 1 });
    }

    static parse(text) {
      return Model.fromDoc(DAE.Toon.decode(text));
    }

    static stringify(model) {
      return DAE.Toon.encode(Model.toDoc(model));
    }

    static clone(model) {
      return JSON.parse(JSON.stringify(model));
    }

    //#region [ Cell syntax ]
    /** "key:red" | "item:x" | "kill:ogre" | "stat:str=5" -> condition object */
    static parseCond(s) {
      const i = s.indexOf(':');
      const t = i < 0 ? s : s.slice(0, i);
      const v = i < 0 ? '' : s.slice(i + 1);
      if(t === 'stat') {
        const [stat, n] = v.split('=');
        return { t, v: stat, n: num(n, 0) };
      }
      return { t, v };
    }

    static condStr(c) {
      return c.t === 'stat' ? `stat:${c.v}=${c.n}` : `${c.t}:${c.v}`;
    }

    /** "spawn:rat@r2:2" | "fx+:rage@player" | "unlock:p1" ... -> action object */
    static parseAction(s) {
      const i = s.indexOf(':');
      const op = i < 0 ? s : s.slice(0, i);
      const rest = i < 0 ? '' : s.slice(i + 1);
      if(op === 'fx+' || op === 'fx-') {
        const [v, target = 'player'] = rest.split('@');
        return { op, v, target };
      }
      if(op === 'spawn') {
        const [v, where = ''] = rest.split('@');
        const [room, wave] = where.split(':');
        return { op, v, room, wave: num(wave, 1) };
      }
      return { op, v: rest };
    }

    static actionStr(a) {
      if(a.op === 'fx+' || a.op === 'fx-') return `${a.op}:${a.v}@${a.target}`;
      if(a.op === 'spawn') return `spawn:${a.v}@${a.room}${a.wave !== 1 ? ':' + a.wave : ''}`;
      return `${a.op}:${a.v}`;
    }

    /** "+" joins actions, but "fx+:" holds a "+" too: split only where "+" isn't followed by ":" */
    static actionList(v) {
      return v === undefined || v === null || v === '' ? [] : String(v).split(/\+(?!:)/).map(Model.parseAction);
    }

    /** "ogre:2" -> { type: 'ogre', wave: 2 } */
    static parseFoe(s) {
      const [type, wave] = s.split(':');
      return { type, wave: num(wave, 1) };
    }

    static foeStr(f) {
      return f.wave !== 1 ? `${f.type}:${f.wave}` : f.type;
    }

    /** Instance IDs of a room's starting enemies: r2.1, r2.2 ... */
    static foes(room) {
      return room.enemies.map((f, i) => ({ iid: `${room.id}.${i + 1}`, type: f.type, wave: f.wave }));
    }

    /** id -> entity maps for quick lookups */
    static index(model) {
      const by = arr => new Map(arr.map(x => [x.id, x]));
      return {
        rooms: by(model.rooms), items: by(model.items), enemies: by(model.enemies), effects: by(model.effects),
        chests: by(model.chests), passages: by(model.passages), events: by(model.events),
        slots: by(model.player.slots),
      };
    }
    //#endregion

    //#region [ Doc -> model ]
    static fromDoc(doc) {
      const p = doc.player ?? {};
      const score = doc.score ?? {};
      return {
        dae: num(doc.dae, 1),
        rules: { ...Model.RULES, ...(doc.rules ?? {}) },
        score: { mode: score.mode ?? 'safe', w: { ...Model.WEIGHTS, ...(score.w ?? {}) } },
        player: {
          hp: num(p.hp, Model.PLAYER.hp),
          str: num(p.str, Model.PLAYER.str),
          def: num(p.def, Model.PLAYER.def),
          inventory: bool(p.inventory, true),
          slots: (p.slots ?? []).map(s => ({ id: str(s.id), mode: s.mode ?? 'free' })),
          start: (p.start ?? []).map(String),
          fx: (p.fx ?? []).map(String),
        },
        effects: (doc.effects ?? []).map(e => ({
          id: str(e.id), hp: num(e.hp, 0), str: num(e.str, 0), def: num(e.def, 0),
          invuln: bool(e.invuln, false), dur: e.dur === undefined ? 'perm' : e.dur,
        })),
        items: (doc.items ?? []).map(t => ({
          id: str(t.id), slot: str(t.slot) ?? null,
          hp: num(t.hp, 0), str: num(t.str, 0), def: num(t.def, 0),
          uses: num(t.uses, null), heal: num(t.heal, 0),
          key: str(t.key) ?? null, keyUses: t.keyUses ?? 1,
          breakOnDrop: bool(t.breakOnDrop, false),
          addFx: list(t.addFx), delFx: list(t.delFx), target: t.target ?? 'self', onHit: list(t.onHit),
          weight: num(t.weight, null),
        })),
        enemies: (doc.enemies ?? []).map(e => ({
          id: str(e.id), hp: num(e.hp, 1), str: num(e.str, 0), def: num(e.def, 0),
          drop: list(e.drop), fx: list(e.fx), weight: num(e.weight, null),
        })),
        rooms: (doc.rooms ?? []).map(r => {
          const flags = list(r.flags);
          return {
            id: str(r.id), entry: flags.includes('entry'), exit: flags.includes('exit'),
            weight: num(r.weight, 0), mark: r.mark ?? 'none',
            enemies: list(r.enemies).map(Model.parseFoe), items: list(r.items),
            chests: list(r.chests), builders: list(r.builders),
            x: num(r.x, null), y: num(r.y, null),   // editor position; null = placed by the layout
          };
        }),
        chests: (doc.chests ?? []).map(c => ({ id: str(c.id), items: list(c.items), lock: list(c.lock).map(Model.parseCond) })),
        passages: (doc.passages ?? []).map((g, i) => ({
          id: str(g.id) ?? `p${i}`, a: str(g.a), b: str(g.b), dir: g.dir ?? 'both',
          lock: list(g.lock).map(Model.parseCond),
        })),
        recipes: (doc.recipes ?? []).map(r => ({
          in: list(r.in), out: str(r.out), consume: bool(r.consume, true), builder: str(r.builder) ?? null,
        })),
        events: (doc.events ?? []).map((e, i) => ({
          id: str(e.id) ?? `ev${i}`, room: str(e.room), on: e.on ?? 'enter', once: bool(e.once, true),
          if: list(e.if).map(Model.parseCond), do: Model.actionList(e.do),
        })),
        solutions: (doc.solutions ?? []).map((s, i) => ({
          id: str(s.id) ?? `s${i}`, steps: s.steps ? String(s.steps).split(';').map(x => x.trim()).filter(Boolean) : [],
        })),
      };
    }
    //#endregion

    //#region [ Model -> doc ]
    /** Compact doc: defaults and empty sections are left out to keep files small. */
    static toDoc(m) {
      const doc = { dae: m.dae };
      const diff = (obj, def) => {
        const out = {};
        for(const k of Object.keys(obj)) if(obj[k] !== def[k]) out[k] = obj[k];
        return Object.keys(out).length ? out : undefined;
      };
      doc.rules = diff(m.rules, Model.RULES);
      const w = diff(m.score.w, Model.WEIGHTS);
      if(m.score.mode !== 'safe' || w) doc.score = { mode: opt(m.score.mode, 'safe'), w };

      const p = m.player;
      const player = {
        hp: opt(p.hp, Model.PLAYER.hp), str: opt(p.str, Model.PLAYER.str), def: opt(p.def, Model.PLAYER.def),
        inventory: opt(p.inventory, true),
        slots: p.slots.length ? p.slots.map(s => ({ id: s.id, mode: opt(s.mode, 'free') })) : undefined,
        start: p.start.length ? p.start : undefined,
        fx: p.fx.length ? p.fx : undefined,
      };
      if(Object.values(player).some(v => v !== undefined)) doc.player = player;

      const table = (key, arr, row) => { if(arr.length) doc[key] = arr.map(row); };
      table('effects', m.effects, e => ({
        id: e.id, hp: opt(e.hp, 0), str: opt(e.str, 0), def: opt(e.def, 0), invuln: opt(e.invuln, false), dur: opt(e.dur, 'perm'),
      }));
      table('items', m.items, t => ({
        id: t.id, slot: opt(t.slot, null), hp: opt(t.hp, 0), str: opt(t.str, 0), def: opt(t.def, 0),
        uses: opt(t.uses, null), heal: opt(t.heal, 0), key: opt(t.key, null), keyUses: opt(t.keyUses, 1),
        breakOnDrop: opt(t.breakOnDrop, false), addFx: join(t.addFx), delFx: join(t.delFx),
        target: opt(t.target, 'self'), onHit: join(t.onHit), weight: opt(t.weight, null),
      }));
      table('enemies', m.enemies, e => ({
        id: e.id, hp: e.hp, str: opt(e.str, 0), def: opt(e.def, 0), drop: join(e.drop), fx: join(e.fx), weight: opt(e.weight, null),
      }));
      table('rooms', m.rooms, r => ({
        id: r.id, flags: join([r.entry && 'entry', r.exit && 'exit'].filter(Boolean)),
        weight: opt(r.weight, 0), mark: opt(r.mark, 'none'),
        enemies: join(r.enemies.map(Model.foeStr)), items: join(r.items), chests: join(r.chests), builders: join(r.builders),
        x: opt(r.x, null), y: opt(r.y, null),
      }));
      table('chests', m.chests, c => ({ id: c.id, items: join(c.items), lock: join(c.lock.map(Model.condStr)) }));
      table('passages', m.passages, g => ({
        id: g.id, a: g.a, b: g.b, dir: opt(g.dir, 'both'), lock: join(g.lock.map(Model.condStr)),
      }));
      table('recipes', m.recipes, r => ({ in: join(r.in), out: r.out, consume: opt(r.consume, true), builder: opt(r.builder, null) }));
      table('events', m.events, e => ({
        id: e.id, room: e.room, on: opt(e.on, 'enter'), once: opt(e.once, true),
        if: join(e.if.map(Model.condStr)), do: join(e.do.map(Model.actionStr)),
      }));
      table('solutions', m.solutions, s => ({ id: s.id, steps: s.steps.join(';') || undefined }));
      return doc;
    }
    //#endregion
  }

  DAE.Model = Model;
});
