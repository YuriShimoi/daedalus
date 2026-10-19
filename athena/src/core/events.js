// Room enter/leave events: conditions (lock syntax) and actions.
DAE_CORE(DAE => {
  class Events {
    /** Fires the room's events for `on` ('enter' | 'leave'). */
    static fire(ctx, s, room, on, log) {
      for(const e of ctx.evByRoom.get(room) ?? []) {
        if(s.dead) return;
        if(e.on !== on || (e.once && s.fired.includes(e.id))) continue;
        if(!e.if.every(c => DAE.Rules.cond(ctx, s, c))) continue;
        if(e.once) {
          s.fired.push(e.id);
          s.fired.sort();
        }
        log.push(`event ${e.id}: ${e.do.map(DAE.Model.actionStr).join(', ')}`);
        e.do.forEach(a => Events.act(ctx, s, a, log));
      }
    }

    /** Live foes matching a target: an enemy type (anywhere) or an instance id. `write` copies the lists first. */
    static foes(ctx, s, target, write = false) {
      const out = [];
      const byType = ctx.ix.enemies.has(target);
      const hit = f => byType ? f.type === target : f.iid === target;
      for(const room of Object.keys(s.foes)) {
        if(!s.foes[room].some(hit)) continue;
        const list = write ? DAE.Rules.foesOf(s, room) : s.foes[room];
        for(const f of list) if(hit(f)) out.push({ room, f });
      }
      return out;
    }

    static act(ctx, s, a, log) {
      const { Rules, Effects } = DAE;
      switch(a.op) {
        case 'lock':
          Rules.addSorted(s.sealed, a.v);
          break;
        case 'unlock':
          s.sealed = s.sealed.filter(x => x !== a.v);
          Rules.addSorted(s.opened, a.v);
          break;
        case 'give':
          if(ctx.ix.items.has(a.v)) Rules.give(ctx, s, Rules.entry(ctx, a.v), log);
          break;
        case 'take': {
          const h = Rules.findHeld(s, a.v);
          if(h) Rules.removeHeld(s, h);
          Effects.clamp(ctx, s);
          break;
        }
        case 'fx+':
        case 'fx-':
          if(a.target === 'player') (a.op === 'fx+' ? Effects.addPlayer : Effects.delPlayer)(ctx, s, a.v);
          else Events.foes(ctx, s, a.target, true).forEach(({ f }) => (a.op === 'fx+' ? Effects.addFoe : Effects.delFoe)(ctx, f, a.v));
          break;
        case 'spawn':
          Rules.spawn(ctx, s, a.v, a.room, a.wave);
          break;
        case 'kill':
          Events.foes(ctx, s, a.v, true).forEach(({ room, f }) => Rules.killFoe(ctx, s, room, f, log));
          break;
      }
    }
  }

  DAE.Events = Events;
});
