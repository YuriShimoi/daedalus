// Scale core: dice formulas like "(3D6+1D12)*2+1D100".
// Grammar: numbers, NdS (N defaults to 1, d% = d100), + - * / (integer division, rounded down),
// parentheses, unary minus. Dice modifiers: khN / klN / dhN / dlN (keep / drop highest or lowest),
// kN = khN, ! (explode on the max), rN (reroll results <= N once). Shortcuts: adv = 2d20kh1, dis = 2d20kl1.
// Only dice in the set are valid (any sides from 4 to 100).
DAE_CORE(DAE => {
  const MIN_SIDES = 4, MAX_SIDES = 100, MAX_DICE = 1000, MAX_EXPLODE = 100;

  class Dice {
    static DEFAULT_SET = [4, 6, 8, 10, 12, 20, 100];
    static MIN_SIDES = MIN_SIDES;
    static MAX_SIDES = MAX_SIDES;

    //#region [ Parse ]
    static tokens(text) {
      const out = [];
      const s = text.replace(/\s+/g, '');
      let i = 0;
      const err = msg => { throw new Error(`${msg} at ${i + 1}`); };
      while(i < s.length) {
        const rest = s.slice(i);
        let m;
        if((m = rest.match(/^(adv|dis)/i))) {
          out.push({ t: 'dice', n: 2, s: 20, mods: [{ k: m[1].toLowerCase() === 'adv' ? 'kh' : 'kl', v: 1 }], at: i, src: m[1].toLowerCase() });
          i += m[0].length;
          continue;
        }
        if((m = rest.match(/^(\d*)[dD](\d+|%)/))) {
          const n = m[1] === '' ? 1 : +m[1], sides = m[2] === '%' ? 100 : +m[2];
          const tok = { t: 'dice', n, s: sides, mods: [], at: i };
          i += m[0].length;
          // modifiers
          for(;;) {
            const r2 = s.slice(i);
            let mm;
            if((mm = r2.match(/^(kh|kl|dh|dl|k)(\d+)/i))) {
              tok.mods.push({ k: mm[1].toLowerCase() === 'k' ? 'kh' : mm[1].toLowerCase(), v: +mm[2] });
              i += mm[0].length;
            }
            else if(r2[0] === '!') { tok.mods.push({ k: '!' }); i++; }
            else if((mm = r2.match(/^r(\d+)/i))) { tok.mods.push({ k: 'r', v: +mm[1] }); i += mm[0].length; }
            else break;
          }
          tok.src = s.slice(tok.at, i);
          out.push(tok);
          continue;
        }
        if((m = rest.match(/^\d+/))) { out.push({ t: 'num', v: +m[0], at: i }); i += m[0].length; continue; }
        if('+-*/()'.includes(s[i])) { out.push({ t: s[i], at: i }); i++; continue; }
        if(s[i] === 'x' || s[i] === '×') { out.push({ t: '*', at: i }); i++; continue; }
        err(`unexpected "${s[i]}"`);
      }
      return out;
    }

    /**
     * Formula -> AST. Throws Error with a readable message.
     * @param {number[]} set - valid die sides (default: the usual set)
     */
    static parse(text, set = Dice.DEFAULT_SET) {
      if(!text.trim()) throw new Error('empty formula');
      const toks = Dice.tokens(text);
      let p = 0;
      const peek = () => toks[p], next = () => toks[p++];
      const BIN = { '+': 10, '-': 10, '*': 20, '/': 20 };
      const unit = () => {
        const tk = next();
        if(!tk) throw new Error('formula ends too early');
        if(tk.t === 'num') return { t: 'num', v: tk.v };
        if(tk.t === 'dice') {
          if(tk.s < MIN_SIDES || tk.s > MAX_SIDES) throw new Error(`D${tk.s}: dice go from D${MIN_SIDES} to D${MAX_SIDES}`);
          if(!set.includes(tk.s)) throw new Error(`D${tk.s} is not in the dice set`);
          if(tk.n < 1) throw new Error(`${tk.src}: roll at least one die`);
          if(tk.n > MAX_DICE) throw new Error(`${tk.src}: at most ${MAX_DICE} dice`);
          for(const m of tk.mods) {
            if(['kh', 'kl'].includes(m.k) && (m.v < 1 || m.v > tk.n)) throw new Error(`${tk.src}: keep 1 to ${tk.n}`);
            if(['dh', 'dl'].includes(m.k) && (m.v < 0 || m.v >= tk.n)) throw new Error(`${tk.src}: drop 0 to ${tk.n - 1}`);
            if(m.k === 'r' && m.v >= tk.s) throw new Error(`${tk.src}: reroll value must be below ${tk.s}`);
          }
          return { t: 'dice', n: tk.n, s: tk.s, mods: tk.mods, src: tk.src };
        }
        if(tk.t === '-') return { t: 'neg', a: expr(30) };
        if(tk.t === '+') return expr(30);
        if(tk.t === '(') {
          const e = expr(0);
          if(next()?.t !== ')') throw new Error('missing ")"');
          return { t: 'par', a: e };
        }
        throw new Error(`unexpected "${tk.t}" at ${tk.at + 1}`);
      };
      const expr = min => {
        let left = unit();
        for(;;) {
          const tk = peek();
          if(!tk || !(tk.t in BIN) || BIN[tk.t] <= min) break;
          next();
          left = { t: 'bin', op: tk.t, a: left, b: expr(BIN[tk.t]) };
        }
        return left;
      };
      const ast = expr(0);
      if(p < toks.length) throw new Error(toks[p].t === ')' ? 'extra ")"' : `unexpected "${toks[p].src ?? toks[p].v ?? toks[p].t}"`);
      return ast;
    }

    /** AST back to text (normalized: uppercase D). */
    static text(ast) {
      switch(ast.t) {
        case 'num': return String(ast.v);
        case 'dice': return ast.src === 'adv' || ast.src === 'dis' ? ast.src : `${ast.n}D${ast.s}` + ast.mods.map(m => m.k === '!' ? '!' : m.k + m.v).join('');
        case 'neg': return '-' + Dice.text(ast.a);
        case 'par': return `(${Dice.text(ast.a)})`;
        default: return `${Dice.text(ast.a)}${ast.op}${Dice.text(ast.b)}`;
      }
    }
    //#endregion

    //#region [ Roll ]
    /** A die roll from rng (a function -> [0, 1)); crypto random by default. */
    static random() {
      if(globalThis.crypto?.getRandomValues) {
        const a = new Uint32Array(1);
        return () => { crypto.getRandomValues(a); return a[0] / 4294967296; };
      }
      return Math.random;
    }

    static #group(node, rnd) {
      const die = () => 1 + Math.floor(rnd() * node.s);
      const reroll = node.mods.find(m => m.k === 'r'), explode = node.mods.some(m => m.k === '!');
      const rolls = [];
      for(let i = 0; i < node.n; i++) {
        let v = die();
        const one = { v };
        if(reroll && v <= reroll.v) { one.was = v; one.v = v = die(); }
        rolls.push(one);
        if(explode) {
          let k = 0;
          while(v === node.s && k++ < MAX_EXPLODE) {
            v = die();
            rolls.push({ v, exploded: true });
          }
        }
      }
      // keep / drop work on the rolled dice (explosions count as their own dice)
      const order = rolls.map((d, i) => i).sort((a, b) => rolls[a].v - rolls[b].v || a - b);
      for(const m of node.mods) {
        const live = order.filter(i => !rolls[i].drop);
        let drop = [];
        if(m.k === 'kh') drop = live.slice(0, Math.max(0, live.length - m.v));
        if(m.k === 'kl') drop = live.slice(m.v);
        if(m.k === 'dh') drop = live.slice(Math.max(0, live.length - m.v));
        if(m.k === 'dl') drop = live.slice(0, m.v);
        drop.forEach(i => rolls[i].drop = true);
      }
      return { text: Dice.text(node), sides: node.s, rolls, sum: rolls.reduce((s, d) => s + (d.drop ? 0 : d.v), 0) };
    }

    /**
     * Rolls a formula.
     * @returns {{formula, total, groups: Array<{text, sides, rolls, sum}>, shown: string}} shown = the formula with values in
     */
    static roll(formula, { set = Dice.DEFAULT_SET, rnd = Dice.random() } = {}) {
      const ast = typeof formula === 'string' ? Dice.parse(formula, set) : formula;
      const groups = [];
      const ev = n => {
        switch(n.t) {
          case 'num': return { v: n.v, s: String(n.v) };
          case 'dice': {
            const g = Dice.#group(n, rnd);
            groups.push(g);
            const live = g.rolls.filter(d => !d.drop).map(d => d.v);
            return { v: g.sum, s: live.length > 1 ? `[${live.join('+')}]` : String(g.sum) };
          }
          case 'neg': { const a = ev(n.a); return { v: -a.v, s: '-' + a.s }; }
          case 'par': { const a = ev(n.a); return { v: a.v, s: `(${a.s})` }; }
          default: {
            const a = ev(n.a), b = ev(n.b);
            if(n.op === '/' && b.v === 0) throw new Error('division by zero');
            const v = n.op === '+' ? a.v + b.v : n.op === '-' ? a.v - b.v : n.op === '*' ? a.v * b.v : Math.floor(a.v / b.v);
            return { v, s: `${a.s} ${n.op === '*' ? '×' : n.op === '/' ? '÷' : n.op} ${b.s}` };
          }
        }
      };
      const r = ev(ast);
      return { formula: Dice.text(ast), total: r.v, groups, shown: `${r.s} = ${r.v}` };
    }
    //#endregion

    //#region [ Odds ]
    // A distribution is a Map value -> probability.
    static #conv(a, b, op) {
      const out = new Map();
      for(const [x, p] of a) {
        for(const [y, q] of b) {
          if(op === '/' && y === 0) continue;
          const v = op === '+' ? x + y : op === '-' ? x - y : op === '*' ? x * y : Math.floor(x / y);
          out.set(v, (out.get(v) ?? 0) + p * q);
        }
      }
      if(op === '/') {
        const t = [...out.values()].reduce((s, p) => s + p, 0);
        if(t > 0 && t < 1) for(const [k, p] of out) out.set(k, p / t);
      }
      return out;
    }

    /** Exact distribution of one dice group, or null when it would take too long. */
    static #groupDist(n) {
      const one = new Map();
      const reroll = n.mods.find(m => m.k === 'r');
      for(let v = 1; v <= n.s; v++) {
        // reroll once: a low face is replaced by a fresh roll
        if(reroll && v <= reroll.v) for(let w = 1; w <= n.s; w++) one.set(w, (one.get(w) ?? 0) + 1 / n.s / n.s);
        else one.set(v, (one.get(v) ?? 0) + 1 / n.s);
      }
      if(n.mods.some(m => m.k === '!')) {
        // explode: max adds another die; truncated after 6 chains (the rest is below 1e-6 for D4+)
        const e = new Map();
        const add = (base, prob, depth) => {
          for(const [v, p] of one) {
            if(v === n.s && depth < 6) add(base + v, prob * p, depth + 1);
            else e.set(base + v, (e.get(base + v) ?? 0) + prob * p);
          }
        };
        add(0, 1, 0);
        if(n.mods.some(m => m.k !== '!' && m.k !== 'r')) return null;   // keep/drop with explosions: sample
        let d = new Map([[0, 1]]);
        for(let i = 0; i < n.n; i++) d = Dice.#conv(d, e, '+');
        return d;
      }
      const keep = n.mods.filter(m => m.k !== 'r');
      if(!keep.length) {
        let d = new Map([[0, 1]]);
        for(let i = 0; i < n.n; i++) d = Dice.#conv(d, one, '+');
        return d;
      }
      // keep / drop: enumerate sorted multisets when small enough
      if(n.s ** n.n > 2e5) return null;
      const out = new Map(), faces = [...one];
      const rolls = new Array(n.n);
      const walk = (i, prob) => {
        if(i === n.n) {
          const sorted = [...rolls].sort((a, b) => a - b);
          let lo = 0, hi = sorted.length;
          for(const m of keep) {
            if(m.k === 'kh') lo = Math.max(lo, hi - m.v);
            if(m.k === 'kl') hi = Math.min(hi, lo + m.v);
            if(m.k === 'dh') hi = Math.max(lo, hi - m.v);
            if(m.k === 'dl') lo = Math.min(hi, lo + m.v);
          }
          let s = 0;
          for(let k = lo; k < hi; k++) s += sorted[k];
          out.set(s, (out.get(s) ?? 0) + prob);
          return;
        }
        for(const [v, p] of faces) { rolls[i] = v; walk(i + 1, prob * p); }
      };
      walk(0, 1);
      return out;
    }

    /**
     * Distribution of a formula: exact when it stays small, else from `samples` rolls.
     * @returns {{dist: Array<[number, number]>, min, max, mean, exact: boolean}}
     */
    static odds(formula, { set = Dice.DEFAULT_SET, samples = 20000, rnd = Math.random } = {}) {
      const ast = typeof formula === 'string' ? Dice.parse(formula, set) : formula;
      let exact = true;
      const ev = n => {
        if(!exact) return null;
        switch(n.t) {
          case 'num': return new Map([[n.v, 1]]);
          case 'dice': { const d = Dice.#groupDist(n); if(!d) exact = false; return d; }
          case 'neg': { const a = ev(n.a); return a && new Map([...a].map(([v, p]) => [-v, p])); }
          case 'par': return ev(n.a);
          default: {
            const a = ev(n.a), b = ev(n.b);
            if(!a || !b) return null;
            if(a.size * b.size > 4e6) { exact = false; return null; }
            return Dice.#conv(a, b, n.op);
          }
        }
      };
      let d = ev(ast);
      if(!d) {
        exact = false;
        d = new Map();
        for(let i = 0; i < samples; i++) {
          let v;
          try { v = Dice.roll(ast, { set, rnd }).total; } catch { continue; }
          d.set(v, (d.get(v) ?? 0) + 1 / samples);
        }
      }
      const dist = [...d].filter(([, p]) => p > 0).sort((a, b) => a[0] - b[0]);
      const mean = dist.reduce((s, [v, p]) => s + v * p, 0);
      return { dist, min: dist[0]?.[0] ?? 0, max: dist.at(-1)?.[0] ?? 0, mean, exact };
    }

    /** P(result >= x) (or <= x with `below`). */
    static chance(odds, x, below = false) {
      return odds.dist.reduce((s, [v, p]) => s + ((below ? v <= x : v >= x) ? p : 0), 0);
    }
    //#endregion
  }

  DAE.Dice = Dice;
});
