// Stats and effects: player maxHP/STR/DEF from base + equipped items + effects; enemy stats.
DAE_CORE(DAE => {
  class Effects {
    /** Player stats now. Only items in slots give bonuses and equip effects. */
    static player(ctx, s) {
      const p = ctx.model.player;
      const out = { maxhp: p.hp, str: p.str, def: p.def, invuln: false };
      const add = fx => {
        if(!fx) return;
        out.maxhp += fx.hp; out.str += fx.str; out.def += fx.def;
        if(fx.invuln) out.invuln = true;
      };
      for(const e of Object.values(s.slots)) {
        if(!e) continue;
        const t = ctx.ix.items.get(e.id);
        out.maxhp += t.hp; out.str += t.str; out.def += t.def;
        for(const id of t.addFx) {
          const fx = ctx.ix.effects.get(id);
          if(fx?.dur === 'equip') add(fx);
        }
      }
      for(const f of s.fx) add(ctx.ix.effects.get(f.id));
      return out;
    }

    static foe(ctx, f) {
      const e = ctx.ix.enemies.get(f.type);
      const out = { str: e.str, def: e.def, invuln: false };
      for(const id of f.fx) {
        const fx = ctx.ix.effects.get(id);
        if(!fx) continue;
        out.str += fx.str; out.def += fx.def;
        if(fx.invuln) out.invuln = true;
      }
      return out;
    }

    /** Healing and max HP changes keep hp <= maxHP; hp <= 0 is death. */
    static clamp(ctx, s) {
      const { maxhp } = Effects.player(ctx, s);
      if(s.hp > maxhp) s.hp = maxhp;
      if(s.hp <= 0) s.dead = true;
    }

    /** Adds (or refreshes) a player effect. perm beats N; a longer N wins. */
    static addPlayer(ctx, s, id) {
      const fx = ctx.ix.effects.get(id);
      if(!fx) return;
      const t = typeof fx.dur === 'number' ? fx.dur : 'perm';
      const cur = s.fx.find(f => f.id === id);
      if(cur) {
        if(cur.t !== 'perm' && (t === 'perm' || t > cur.t)) cur.t = t;
      }
      else {
        s.fx.push({ id, t });
        s.fx.sort((a, b) => a.id < b.id ? -1 : 1);
      }
      Effects.clamp(ctx, s);
    }

    static delPlayer(ctx, s, id) {
      const i = s.fx.findIndex(f => f.id === id);
      if(i >= 0) s.fx.splice(i, 1);
      Effects.clamp(ctx, s);
    }

    /** Enemy effects last until it dies; an hp effect changes its current hp. */
    static addFoe(ctx, f, id) {
      const fx = ctx.ix.effects.get(id);
      if(!fx || f.fx.includes(id)) return;
      f.fx.push(id);
      f.fx.sort();
      f.hp = Math.max(1, f.hp + fx.hp);
    }

    static delFoe(ctx, f, id) {
      const i = f.fx.indexOf(id);
      if(i < 0) return;
      f.fx.splice(i, 1);
      f.hp = Math.max(1, f.hp - ctx.ix.effects.get(id).hp);
    }

    /** End of a room fight: N durations count down. */
    static tick(ctx, s) {
      s.fx = s.fx.filter(f => {
        if(f.t === 'perm') return true;
        f.t--;
        return f.t > 0;
      });
      Effects.clamp(ctx, s);
    }
  }

  DAE.Effects = Effects;
});
