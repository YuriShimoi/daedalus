// Wheel core: items with weights (shown as %), slices, a weighted pick and the landing angle.
// item: { label, weight, color, icon?, on, lock? }. Weights are kept as percents that add to 100
// over the items that are on; locked items keep theirs when others change.
DAE_CORE(DAE => {
  const DRACULA = ['#FF79C6', '#BD93F9', '#8BE9FD', '#50FA7B', '#F1FA8C', '#FFB86C', '#FF5555', '#6272A4'];

  class Wheel {
    static PALETTES = {
      dracula: DRACULA,
      bronze: ['#CD7F32', '#E3A869', '#8C5523', '#F2D0A4', '#A0662C', '#5E3A17'],
      pastel: ['#F7C6D9', '#CDB4F7', '#B4E7F7', '#C2F7C6', '#F7F2B4', '#F7D6B4'],
      mono: ['#44475A', '#6272A4', '#8B93B8', '#B4BAD6', '#525568', '#3A3C4E'],
    };

    static item(label, o = {}) {
      return { label, weight: 1, color: null, icon: null, on: true, lock: false, ...o };
    }

    static live(items) {
      return items.filter(i => i.on !== false && (i.weight ?? 0) > 0);
    }

    /** Percent of each item (0 for items that are off). */
    static percents(items) {
      const total = Wheel.live(items).reduce((s, i) => s + i.weight, 0);
      return items.map(i => (i.on !== false && total > 0 ? (i.weight ?? 0) / total * 100 : 0));
    }

    /** Rewrites weights as percents that add to 100. */
    static normalize(items) {
      const p = Wheel.percents(items);
      items.forEach((i, k) => { if(i.on !== false) i.weight = +p[k].toFixed(4); });
      return items;
    }

    /**
     * Sets item k to `pct` percent: locked items keep theirs, the other live items share the rest
     * in their current proportions (evenly when they were all 0).
     */
    static setPercent(items, k, pct) {
      Wheel.normalize(items);
      const locked = items.reduce((s, i, j) => s + (j !== k && i.lock && i.on !== false ? i.weight : 0), 0);
      pct = Math.max(0, Math.min(100 - locked, pct));
      const free = items.filter((i, j) => j !== k && !i.lock && i.on !== false);
      const rest = 100 - locked - pct;
      if(!free.length) pct = 100 - locked;
      const had = free.reduce((s, i) => s + i.weight, 0);
      free.forEach(i => { i.weight = had > 0 ? i.weight / had * rest : rest / free.length; });
      items[k].weight = pct;
      return items;
    }

    /** All live items at the same weight. */
    static even(items) {
      const live = items.filter(i => i.on !== false);
      live.forEach(i => { i.weight = 100 / live.length; });
      return items;
    }

    /**
     * Slices in turns (0..1, clockwise from the pointer at 0).
     * mode 'odds': size follows the weight; 'equal': every live item gets the same size.
     */
    static slices(items, mode = 'odds') {
      const live = items.map((item, index) => ({ item, index })).filter(x => x.item.on !== false && x.item.weight > 0);
      const total = live.reduce((s, x) => s + x.item.weight, 0);
      let a = 0;
      return live.map(x => {
        const size = mode === 'equal' ? 1 / live.length : x.item.weight / total;
        const s = { ...x, a0: a, a1: a + size };
        a += size;
        return s;
      });
    }

    /** Index of the winning item (weighted by percent, whatever the slice mode). */
    static pick(items, rnd = Math.random) {
      const live = items.map((item, index) => ({ item, index })).filter(x => x.item.on !== false && x.item.weight > 0);
      if(!live.length) return -1;
      const total = live.reduce((s, x) => s + x.item.weight, 0);
      let r = rnd() * total;
      for(const x of live) {
        r -= x.item.weight;
        if(r < 0) return x.index;
      }
      return live.at(-1).index;
    }

    /**
     * Final rotation (in turns, adding to `from`) so the pointer stops inside the winner's slice.
     * The wheel turns clockwise; the pointer sits at angle 0 (top). A point at slice angle a is under
     * the pointer when rotation = -a (mod 1).
     */
    static landing(slices, index, { from = 0, turns = [4, 7], rnd = Math.random, margin = 0.15 } = {}) {
      const s = slices.find(x => x.index === index);
      if(!s) return from;
      const size = s.a1 - s.a0;
      const at = s.a0 + size * (margin + (1 - 2 * margin) * rnd());
      const target = ((1 - at) % 1 + 1) % 1;
      const spins = turns[0] + Math.floor(rnd() * (turns[1] - turns[0] + 1));
      const cur = ((from % 1) + 1) % 1;
      return from + spins + ((target - cur) % 1 + 1) % 1;
    }

    /** Which slice is under the pointer for a rotation (in turns). */
    static under(slices, rotation) {
      const a = ((-rotation % 1) + 1) % 1;
      return slices.find(s => a >= s.a0 && a < s.a1) ?? slices.at(-1);
    }

    /** Colors from a palette so neighbors (and first / last) differ. */
    static colors(n, palette = DRACULA) {
      const out = [];
      for(let i = 0; i < n; i++) {
        let c = palette[i % palette.length];
        if(n > 1 && i === n - 1 && c === out[0]) c = palette[(i + 1) % palette.length] === out[i - 1] ? palette[(i + 2) % palette.length] : palette[(i + 1) % palette.length];
        out.push(c);
      }
      return out;
    }

    /** "label | weight | #color" per line (weight and color optional). */
    static parseList(text) {
      return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
        const [label, w, c] = l.split('|').map(s => s.trim());
        const o = {};
        if(w && !Number.isNaN(+w.replace('%', ''))) o.weight = +w.replace('%', '');
        if(c && /^#[0-9a-f]{3,8}$/i.test(c)) o.color = c;
        return Wheel.item(label, o);
      });
    }

    static listText(items) {
      return items.map(i => [i.label, +(+i.weight).toFixed(2), i.color].filter(x => x !== null && x !== undefined).join(' | ')).join('\n');
    }

    /** Spread of results: [{label, count, pct, expected}] for the current items. */
    static spread(items, history) {
      const p = Wheel.percents(items);
      const n = history.length;
      return items.map((it, k) => {
        const count = history.filter(h => h === it.label).length;
        return { label: it.label, count, pct: n ? count / n * 100 : 0, expected: p[k] };
      });
    }
  }

  DAE.Wheel = Wheel;
});
