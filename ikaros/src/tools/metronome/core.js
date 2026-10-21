// Metronome core: easing curves (cubic-bezier, steps, CSS linear(), easings.net set, springs) and
// animation templates with CSS variables (Font Awesome's animations as the reference).
// A curve is a function t (0..1) -> progress; every curve also has a CSS form and JS source.
DAE_CORE(DAE => {
  const r = (v, d = 3) => +v.toFixed(d);
  const PI = Math.PI;

  //#region [ Curve builders ]
  /** cubic-bezier(x1, y1, x2, y2): solves x(s) = t (Newton, bisection fallback), returns y(s). */
  function bezier(x1, y1, x2, y2) {
    const A = (a, b) => 1 - 3 * b + 3 * a, B = (a, b) => 3 * b - 6 * a, C = a => 3 * a;
    const at = (s, a, b) => ((A(a, b) * s + B(a, b)) * s + C(a)) * s;
    const slope = (s, a, b) => 3 * A(a, b) * s * s + 2 * B(a, b) * s + C(a);
    const solve = t => {
      let s = t;
      for(let i = 0; i < 8; i++) {
        const d = slope(s, x1, x2);
        if(Math.abs(d) < 1e-6) break;
        const x = at(s, x1, x2) - t;
        if(Math.abs(x) < 1e-7) return s;
        s -= x / d;
      }
      let lo = 0, hi = 1;
      s = t;
      for(let i = 0; i < 40; i++) {
        const x = at(s, x1, x2);
        if(Math.abs(x - t) < 1e-7) break;
        if(x < t) lo = s; else hi = s;
        s = (lo + hi) / 2;
      }
      return s;
    };
    return t => t <= 0 ? 0 : t >= 1 ? 1 : at(solve(t), y1, y2);
  }

  /** steps(n, jump): jump-start | jump-end (end) | jump-none | jump-both (CSS rules). */
  function steps(n, jump = 'jump-end') {
    jump = { start: 'jump-start', end: 'jump-end' }[jump] ?? jump;
    const total = jump === 'jump-none' ? n - 1 : jump === 'jump-both' ? n + 1 : n;
    return t => {
      if(t >= 1) return 1;
      let s = Math.floor(t * n);
      if(jump === 'jump-start' || jump === 'jump-both') s++;
      return Math.max(0, Math.min(1, s / total));
    };
  }

  /** CSS linear(): stops [[progress, at]] with `at` 0..1 (missing `at` spread evenly, as CSS does). */
  function linear(stops) {
    const pts = stops.map(s => Array.isArray(s) ? [...s] : [s, undefined]);
    if(pts[0][1] === undefined) pts[0][1] = 0;
    if(pts.at(-1)[1] === undefined) pts.at(-1)[1] = 1;
    for(let i = 1; i < pts.length; i++) if(pts[i][1] !== undefined) pts[i][1] = Math.max(pts[i][1], pts[i - 1][1]);
    for(let i = 1; i < pts.length - 1; i++) {
      if(pts[i][1] !== undefined) continue;
      let j = i;
      while(pts[j][1] === undefined) j++;
      const a = pts[i - 1][1], b = pts[j][1];
      for(let k = i; k < j; k++) pts[k][1] = a + (b - a) * (k - i + 1) / (j - i + 1);
    }
    return t => {
      if(t <= pts[0][1]) return pts[0][0];
      for(let i = 1; i < pts.length; i++) {
        const [v1, a1] = pts[i];
        if(t <= a1) {
          const [v0, a0] = pts[i - 1];
          return a1 === a0 ? v1 : v0 + (v1 - v0) * (t - a0) / (a1 - a0);
        }
      }
      return pts.at(-1)[0];
    };
  }

  /**
   * Damped spring from 0 to 1, stretched to settle at t = 1.
   * @returns {{fn: function, settle: number}} settle = seconds it takes (mass 1)
   */
  function spring(stiffness = 170, damping = 26, mass = 1) {
    const w0 = Math.sqrt(stiffness / mass), zeta = damping / (2 * Math.sqrt(stiffness * mass));
    const x = s => {
      if(zeta < 1) {
        const wd = w0 * Math.sqrt(1 - zeta * zeta);
        return 1 - Math.exp(-zeta * w0 * s) * (Math.cos(wd * s) + zeta * w0 / wd * Math.sin(wd * s));
      }
      if(zeta === 1) return 1 - Math.exp(-w0 * s) * (1 + w0 * s);
      const a = -w0 * (zeta - Math.sqrt(zeta * zeta - 1)), b = -w0 * (zeta + Math.sqrt(zeta * zeta - 1));
      return 1 - (b * Math.exp(a * s) - a * Math.exp(b * s)) / (b - a);
    };
    // settle: the last time it is more than 0.1% away from the end
    let settle = 10;
    for(let s = 10; s > 0; s -= 0.01) if(Math.abs(1 - x(s)) > 0.001) { settle = s + 0.01; break; }
    return { fn: t => t >= 1 ? 1 : x(t * settle), settle: r(settle, 2) };
  }
  //#endregion

  //#region [ easings.net set ]
  const c1 = 1.70158, c2 = c1 * 1.525, c3 = c1 + 1, c4 = 2 * PI / 3, c5 = 2 * PI / 4.5;
  const bounceOut = x => {
    const n1 = 7.5625, d1 = 2.75;
    if(x < 1 / d1) return n1 * x * x;
    if(x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
    if(x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
    return n1 * (x -= 2.625 / d1) * x + 0.984375;
  };
  // [name, in, out, inOut, bezier values for in / out / inOut when one fits (easings.net)]
  const FAMILY = {
    sine:    [x => 1 - Math.cos(x * PI / 2), x => Math.sin(x * PI / 2), x => -(Math.cos(PI * x) - 1) / 2,
              [.12, 0, .39, 0], [.61, 1, .88, 1], [.37, 0, .63, 1]],
    quad:    [x => x * x, x => 1 - (1 - x) * (1 - x), x => x < .5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2,
              [.11, 0, .5, 0], [.5, 1, .89, 1], [.45, 0, .55, 1]],
    cubic:   [x => x ** 3, x => 1 - (1 - x) ** 3, x => x < .5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2,
              [.32, 0, .67, 0], [.33, 1, .68, 1], [.65, 0, .35, 1]],
    quart:   [x => x ** 4, x => 1 - (1 - x) ** 4, x => x < .5 ? 8 * x ** 4 : 1 - (-2 * x + 2) ** 4 / 2,
              [.5, 0, .75, 0], [.25, 1, .5, 1], [.76, 0, .24, 1]],
    quint:   [x => x ** 5, x => 1 - (1 - x) ** 5, x => x < .5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2,
              [.64, 0, .78, 0], [.22, 1, .36, 1], [.83, 0, .17, 1]],
    expo:    [x => x === 0 ? 0 : 2 ** (10 * x - 10), x => x === 1 ? 1 : 1 - 2 ** (-10 * x),
              x => x === 0 ? 0 : x === 1 ? 1 : x < .5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2,
              [.7, 0, .84, 0], [.16, 1, .3, 1], [.87, 0, .13, 1]],
    circ:    [x => 1 - Math.sqrt(1 - x * x), x => Math.sqrt(1 - (x - 1) ** 2),
              x => x < .5 ? (1 - Math.sqrt(1 - (2 * x) ** 2)) / 2 : (Math.sqrt(1 - (-2 * x + 2) ** 2) + 1) / 2,
              [.55, 0, 1, .45], [0, .55, .45, 1], [.85, 0, .15, 1]],
    back:    [x => c3 * x ** 3 - c1 * x * x, x => 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2,
              x => x < .5 ? ((2 * x) ** 2 * ((c2 + 1) * 2 * x - c2)) / 2 : ((2 * x - 2) ** 2 * ((c2 + 1) * (x * 2 - 2) + c2) + 2) / 2,
              [.36, 0, .66, -.56], [.34, 1.56, .64, 1], [.68, -.6, .32, 1.6]],
    elastic: [x => x === 0 ? 0 : x === 1 ? 1 : -(2 ** (10 * x - 10)) * Math.sin((x * 10 - 10.75) * c4),
              x => x === 0 ? 0 : x === 1 ? 1 : 2 ** (-10 * x) * Math.sin((x * 10 - .75) * c4) + 1,
              x => x === 0 ? 0 : x === 1 ? 1 : x < .5 ? -(2 ** (20 * x - 10) * Math.sin((20 * x - 11.125) * c5)) / 2 : (2 ** (-20 * x + 10) * Math.sin((20 * x - 11.125) * c5)) / 2 + 1],
    bounce:  [x => 1 - bounceOut(1 - x), bounceOut, x => x < .5 ? (1 - bounceOut(1 - 2 * x)) / 2 : (1 + bounceOut(2 * x - 1)) / 2],
  };
  const SRC = {
    sine: ['1 - Math.cos(t * Math.PI / 2)', 'Math.sin(t * Math.PI / 2)', '-(Math.cos(Math.PI * t) - 1) / 2'],
    quad: ['t * t', '1 - (1 - t) * (1 - t)', 't < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2'],
    cubic: ['t ** 3', '1 - (1 - t) ** 3', 't < .5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2'],
    quart: ['t ** 4', '1 - (1 - t) ** 4', 't < .5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2'],
    quint: ['t ** 5', '1 - (1 - t) ** 5', 't < .5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2'],
    expo: ['t === 0 ? 0 : 2 ** (10 * t - 10)', 't === 1 ? 1 : 1 - 2 ** (-10 * t)', 't === 0 ? 0 : t === 1 ? 1 : t < .5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2'],
    circ: ['1 - Math.sqrt(1 - t * t)', 'Math.sqrt(1 - (t - 1) ** 2)', 't < .5 ? (1 - Math.sqrt(1 - (2 * t) ** 2)) / 2 : (Math.sqrt(1 - (-2 * t + 2) ** 2) + 1) / 2'],
    back: ['2.70158 * t ** 3 - 1.70158 * t * t', '1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2',
      't < .5 ? ((2 * t) ** 2 * (3.5949095 * 2 * t - 2.5949095)) / 2 : ((2 * t - 2) ** 2 * (3.5949095 * (t * 2 - 2) + 2.5949095) + 2) / 2'],
    elastic: ['t === 0 ? 0 : t === 1 ? 1 : -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * 2 * Math.PI / 3)',
      't === 0 ? 0 : t === 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - .75) * 2 * Math.PI / 3) + 1',
      't === 0 ? 0 : t === 1 ? 1 : t < .5 ? -(2 ** (20 * t - 10) * Math.sin((20 * t - 11.125) * 2 * Math.PI / 4.5)) / 2 : (2 ** (-20 * t + 10) * Math.sin((20 * t - 11.125) * 2 * Math.PI / 4.5)) / 2 + 1'],
  };
  //#endregion

  class Ease {
    static bezier = bezier;
    static steps = steps;
    static linear = linear;
    static spring = spring;

    /** Every template curve: { id, name, group, kind, def } where def is what make() reads. */
    static CURVES = (() => {
      const list = [
        { id: 'linear', name: 'linear', group: 'CSS', kind: 'bezier', def: [0, 0, 1, 1] },
        { id: 'ease', name: 'ease', group: 'CSS', kind: 'bezier', def: [.25, .1, .25, 1] },
        { id: 'ease-in', name: 'ease-in', group: 'CSS', kind: 'bezier', def: [.42, 0, 1, 1] },
        { id: 'ease-out', name: 'ease-out', group: 'CSS', kind: 'bezier', def: [0, 0, .58, 1] },
        { id: 'ease-in-out', name: 'ease-in-out', group: 'CSS', kind: 'bezier', def: [.42, 0, .58, 1] },
      ];
      const cap = s => s[0].toUpperCase() + s.slice(1);
      for(const [fam, f] of Object.entries(FAMILY)) {
        ['in', 'out', 'in-out'].forEach((dir, i) => {
          const id = `ease-${dir}-${fam}`, name = `ease${cap(dir.replace('-o', 'O'))}${cap(fam)}`;
          if(f[3 + i]) list.push({ id, name, group: cap(fam), kind: 'bezier', def: f[3 + i] });
          else list.push({ id, name, group: cap(fam), kind: 'fn', def: fam, dir: i });
        });
      }
      list.push(
        { id: 'spring-gentle', name: 'spring gentle', group: 'Spring', kind: 'spring', def: [120, 14, 1] },
        { id: 'spring-wobbly', name: 'spring wobbly', group: 'Spring', kind: 'spring', def: [180, 12, 1] },
        { id: 'spring-stiff', name: 'spring stiff', group: 'Spring', kind: 'spring', def: [210, 20, 1] },
        { id: 'spring-slow', name: 'spring slow', group: 'Spring', kind: 'spring', def: [280, 60, 1] },
        { id: 'steps-4', name: 'steps(4)', group: 'Steps', kind: 'steps', def: [4, 'jump-end'] },
        { id: 'steps-8-start', name: 'steps(8, start)', group: 'Steps', kind: 'steps', def: [8, 'jump-start'] },
        { id: 'steps-5-none', name: 'steps(5, jump-none)', group: 'Steps', kind: 'steps', def: [5, 'jump-none'] },
      );
      return list;
    })();

    static curve(id) {
      return Ease.CURVES.find(c => c.id === id) ?? null;
    }

    /** A curve spec {kind, def, dir?} -> t => progress. */
    static make(spec) {
      const { kind, def } = spec;
      if(kind === 'bezier') return bezier(...def);
      if(kind === 'steps') return steps(...def);
      if(kind === 'linear') return linear(def);
      if(kind === 'spring') return spring(...def).fn;
      if(kind === 'fn') return FAMILY[def][spec.dir];
      throw new Error(`unknown curve kind ${kind}`);
    }

    /** n + 1 evenly spaced values. */
    static sample(fn, n = 10, digits = 4) {
      return Array.from({ length: n + 1 }, (_, i) => r(fn(i / n), digits));
    }

    /**
     * A function as CSS linear(): samples it, then drops points a straight line already covers
     * (Ramer-Douglas-Peucker, `tol` in progress units).
     */
    static toLinear(fn, { n = 120, tol = 0.002 } = {}) {
      const pts = Array.from({ length: n + 1 }, (_, i) => [i / n, fn(i / n)]);
      const keep = new Uint8Array(pts.length);
      keep[0] = keep[n] = 1;
      const rdp = (a, b) => {
        let far = -1, dist = tol;
        const [x0, y0] = pts[a], [x1, y1] = pts[b];
        for(let i = a + 1; i < b; i++) {
          const y = y0 + (y1 - y0) * (pts[i][0] - x0) / (x1 - x0);
          const d = Math.abs(pts[i][1] - y);
          if(d > dist) { dist = d; far = i; }
        }
        if(far > 0) { keep[far] = 1; rdp(a, far); rdp(far, b); }
      };
      rdp(0, n);
      const out = pts.filter((_, i) => keep[i]);
      return `linear(${out.map(([x, y], i) => (i === 0 || i === out.length - 1) && x === i / (out.length - 1) ? String(r(y)) : `${r(y)} ${r(x * 100, 2)}%`).join(', ')})`;
    }

    /** CSS timing function for a spec. */
    static css(spec) {
      const { kind, def } = spec;
      if(kind === 'bezier') {
        const named = { '0,0,1,1': 'linear', '0.25,0.1,0.25,1': 'ease', '0.42,0,1,1': 'ease-in', '0,0,0.58,1': 'ease-out', '0.42,0,0.58,1': 'ease-in-out' }[def.map(v => r(v)).join(',')];
        return named ?? `cubic-bezier(${def.map(v => r(v)).join(', ')})`;
      }
      if(kind === 'steps') return `steps(${def[0]}${def[1] && def[1] !== 'jump-end' ? ', ' + def[1] : ''})`;
      return Ease.toLinear(Ease.make(spec));
    }

    /** Reads a CSS timing function back into a spec (keywords, cubic-bezier, steps, linear). Null when invalid. */
    static parse(text) {
      const s = text.trim().toLowerCase();
      const kw = Ease.CURVES.slice(0, 5).find(c => c.id === s);
      if(kw) return { kind: 'bezier', def: [...kw.def] };
      if(s === 'step-start') return { kind: 'steps', def: [1, 'jump-start'] };
      if(s === 'step-end') return { kind: 'steps', def: [1, 'jump-end'] };
      let m = s.match(/^cubic-bezier\(([^)]*)\)$/);
      if(m) {
        const v = m[1].split(',').map(Number);
        if(v.length !== 4 || v.some(Number.isNaN) || v[0] < 0 || v[0] > 1 || v[2] < 0 || v[2] > 1) return null;
        return { kind: 'bezier', def: v };
      }
      m = s.match(/^steps\(\s*(\d+)\s*(?:,\s*([\w-]+))?\s*\)$/);
      if(m) {
        const jump = { start: 'jump-start', end: 'jump-end' }[m[2]] ?? m[2] ?? 'jump-end';
        if(!['jump-start', 'jump-end', 'jump-none', 'jump-both'].includes(jump) || +m[1] < 1 || (jump === 'jump-none' && +m[1] < 2)) return null;
        return { kind: 'steps', def: [+m[1], jump] };
      }
      m = s.match(/^linear\((.*)\)$/);
      if(m) {
        const stops = [];
        for(const part of m[1].split(',')) {
          const bits = part.trim().split(/\s+/);
          const v = Number(bits[0]);
          if(Number.isNaN(v) || bits.length > 3) return null;
          const ats = bits.slice(1).map(b => b.endsWith('%') ? Number(b.slice(0, -1)) / 100 : NaN);
          if(ats.some(Number.isNaN)) return null;
          if(!ats.length) stops.push([v, undefined]);
          else ats.forEach(a => stops.push([v, a]));
        }
        return stops.length >= 2 ? { kind: 'linear', def: stops } : null;
      }
      return null;
    }

    /** JS source for `const ease = t => ...` (self-contained). */
    static js(spec, name = 'ease') {
      const { kind, def } = spec;
      if(kind === 'fn' && def === 'bounce') {
        const body = ['1 - bounceOut(1 - t)', 'bounceOut(t)', 't < .5 ? (1 - bounceOut(1 - 2 * t)) / 2 : (1 + bounceOut(2 * t - 1)) / 2'][spec.dir];
        return `const bounceOut = x => {
  const n1 = 7.5625, d1 = 2.75;
  if(x < 1 / d1) return n1 * x * x;
  if(x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if(x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
};
const ${name} = t => ${body};`;
      }
      if(kind === 'fn') return `const ${name} = t => ${SRC[def][spec.dir]};`;
      if(kind === 'bezier') {
        const [x1, y1, x2, y2] = def.map(v => r(v, 4));
        if(x1 === y1 && x2 === y2) return `const ${name} = t => t;`;
        return `// cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})
const ${name} = (() => {
  const bx = s => ((1 - 3 * ${x2} + 3 * ${x1}) * s + (3 * ${x2} - 6 * ${x1})) * s * s + 3 * ${x1} * s;
  const by = s => ((1 - 3 * ${y2} + 3 * ${y1}) * s + (3 * ${y2} - 6 * ${y1})) * s * s + 3 * ${y1} * s;
  return t => {
    if(t <= 0 || t >= 1) return t <= 0 ? 0 : 1;
    let lo = 0, hi = 1, s = t;
    for(let i = 0; i < 30; i++) { if(bx(s) < t) lo = s; else hi = s; s = (lo + hi) / 2; }
    return by(s);
  };
})();`;
      }
      if(kind === 'steps') {
        const [n, jump = 'jump-end'] = def;
        const total = jump === 'jump-none' ? n - 1 : jump === 'jump-both' ? n + 1 : n;
        const plus = jump === 'jump-start' || jump === 'jump-both' ? ' + 1' : '';
        return `const ${name} = t => t >= 1 ? 1 : Math.min(1, Math.max(0, (Math.floor(t * ${n})${plus}) / ${total}));`;
      }
      // spring / linear(): a point table, read with straight lines between points
      const pts = (kind === 'linear' ? null : Ease.sample(Ease.make(spec), 60, 4));
      const table = pts ?? Ease.sample(Ease.make(spec), 60, 4);
      return `// ${kind === 'spring' ? `spring(${def.join(', ')})` : 'linear()'} as 61 points
const ${name} = (() => {
  const P = [${table.join(', ')}];
  return t => {
    if(t <= 0) return P[0];
    if(t >= 1) return P[P.length - 1];
    const x = t * (P.length - 1), i = Math.floor(x);
    return P[i] + (P[i + 1] - P[i]) * (x - i);
  };
})();`;
    }
  }

  //#region [ Animation templates ]
  // vars: [name, default, unit, min, max, step]. Keyframes read them as var(--ik-<name>), like Font
  // Awesome's --fa-* variables. `timing` is the default curve, `iter` the default iteration count.
  const v = (name, def, unit = '', min = 0, max = 2, step = 0.01) => ({ name, def, unit, min, max, step });
  const ANIMS = [
    // Font Awesome 6 animations (same keyframes and variables, renamed to --ik-*)
    { id: 'beat', name: 'beat', group: 'Font Awesome', dur: 1, timing: 'ease-in-out', iter: 'infinite',
      vars: [v('beat-scale', 1.25, '', 1, 2)],
      kf: '0%, 90% { transform: scale(1); }\n  45% { transform: scale(var(--ik-beat-scale)); }' },
    { id: 'bounce', name: 'bounce', group: 'Font Awesome', dur: 1, timing: 'cubic-bezier(0.28, 0.84, 0.42, 1)', iter: 'infinite',
      vars: [v('bounce-height', -0.5, 'em', -2, 0), v('bounce-rebound', -0.125, 'em', -1, 0), v('bounce-start-scale-x', 1.1, '', .5, 1.5), v('bounce-start-scale-y', .9, '', .5, 1.5),
        v('bounce-jump-scale-x', .9, '', .5, 1.5), v('bounce-jump-scale-y', 1.1, '', .5, 1.5), v('bounce-land-scale-x', 1.05, '', .5, 1.5), v('bounce-land-scale-y', .95, '', .5, 1.5)],
      kf: `0% { transform: scale(1, 1) translateY(0); }
  10% { transform: scale(var(--ik-bounce-start-scale-x), var(--ik-bounce-start-scale-y)) translateY(0); }
  30% { transform: scale(var(--ik-bounce-jump-scale-x), var(--ik-bounce-jump-scale-y)) translateY(var(--ik-bounce-height)); }
  50% { transform: scale(var(--ik-bounce-land-scale-x), var(--ik-bounce-land-scale-y)) translateY(0); }
  57% { transform: scale(1, 1) translateY(var(--ik-bounce-rebound)); }
  64% { transform: scale(1, 1) translateY(0); }
  100% { transform: scale(1, 1) translateY(0); }` },
    { id: 'fade', name: 'fade', group: 'Font Awesome', dur: 1, timing: 'cubic-bezier(0.4, 0, 0.6, 1)', iter: 'infinite',
      vars: [v('fade-opacity', .4, '', 0, 1)],
      kf: '50% { opacity: var(--ik-fade-opacity); }' },
    { id: 'beat-fade', name: 'beat-fade', group: 'Font Awesome', dur: 1, timing: 'cubic-bezier(0.4, 0, 0.6, 1)', iter: 'infinite',
      vars: [v('beat-fade-opacity', .4, '', 0, 1), v('beat-fade-scale', 1.125, '', 1, 2)],
      kf: '0%, 100% { opacity: var(--ik-beat-fade-opacity); transform: scale(1); }\n  50% { opacity: 1; transform: scale(var(--ik-beat-fade-scale)); }' },
    { id: 'flip', name: 'flip', group: 'Font Awesome', dur: 1, timing: 'ease-in-out', iter: 'infinite',
      vars: [v('flip-x', 0, '', 0, 1, 1), v('flip-y', 1, '', 0, 1, 1), v('flip-z', 0, '', 0, 1, 1), v('flip-angle', -180, 'deg', -360, 360, 1)],
      kf: '50% { transform: rotate3d(var(--ik-flip-x), var(--ik-flip-y), var(--ik-flip-z), var(--ik-flip-angle)); }' },
    { id: 'shake', name: 'shake', group: 'Font Awesome', dur: 1, timing: 'linear', iter: 'infinite',
      vars: [v('shake-angle', 18, 'deg', 0, 60, 1)],
      kf: `0% { transform: rotate(calc(var(--ik-shake-angle) * -0.83)); }
  4% { transform: rotate(calc(var(--ik-shake-angle) * 0.83)); }
  8%, 24% { transform: rotate(calc(var(--ik-shake-angle) * -1)); }
  12%, 28% { transform: rotate(var(--ik-shake-angle)); }
  16% { transform: rotate(calc(var(--ik-shake-angle) * -1.22)); }
  20% { transform: rotate(calc(var(--ik-shake-angle) * 1.22)); }
  32% { transform: rotate(calc(var(--ik-shake-angle) * -0.67)); }
  36% { transform: rotate(calc(var(--ik-shake-angle) * 0.67)); }
  40%, 100% { transform: rotate(0deg); }` },
    { id: 'spin', name: 'spin', group: 'Font Awesome', dur: 2, timing: 'linear', iter: 'infinite', vars: [],
      kf: '0% { transform: rotate(0deg); }\n  100% { transform: rotate(360deg); }' },
    { id: 'spin-pulse', name: 'spin-pulse', group: 'Font Awesome', dur: 1, timing: 'steps(8)', iter: 'infinite', vars: [],
      kf: '0% { transform: rotate(0deg); }\n  100% { transform: rotate(360deg); }' },
    { id: 'spin-reverse', name: 'spin-reverse', group: 'Font Awesome', dur: 2, timing: 'linear', iter: 'infinite', dir: 'reverse', vars: [],
      kf: '0% { transform: rotate(0deg); }\n  100% { transform: rotate(360deg); }' },
    // attention
    { id: 'pulse', name: 'pulse', group: 'Attention', dur: 1, timing: 'ease-in-out', iter: 'infinite',
      vars: [v('pulse-scale', 1.08, '', 1, 1.6)],
      kf: '0%, 100% { transform: scale(1); }\n  50% { transform: scale(var(--ik-pulse-scale)); }' },
    { id: 'heartbeat', name: 'heartbeat', group: 'Attention', dur: 1.3, timing: 'ease-in-out', iter: 'infinite',
      vars: [v('heartbeat-scale', 1.3, '', 1, 2)],
      kf: '0%, 28%, 70% { transform: scale(1); }\n  14%, 42% { transform: scale(var(--ik-heartbeat-scale)); }' },
    { id: 'wobble', name: 'wobble', group: 'Attention', dur: 1, timing: 'ease', iter: 1,
      vars: [v('wobble-x', 25, '%', 0, 60, 1), v('wobble-angle', 5, 'deg', 0, 20, 1)],
      kf: `0%, 100% { transform: translateX(0); }
  15% { transform: translateX(calc(var(--ik-wobble-x) * -1)) rotate(calc(var(--ik-wobble-angle) * -1)); }
  30% { transform: translateX(calc(var(--ik-wobble-x) * 0.8)) rotate(calc(var(--ik-wobble-angle) * 0.6)); }
  45% { transform: translateX(calc(var(--ik-wobble-x) * -0.6)) rotate(calc(var(--ik-wobble-angle) * -0.6)); }
  60% { transform: translateX(calc(var(--ik-wobble-x) * 0.4)) rotate(calc(var(--ik-wobble-angle) * 0.4)); }
  75% { transform: translateX(calc(var(--ik-wobble-x) * -0.2)) rotate(calc(var(--ik-wobble-angle) * -0.2)); }` },
    { id: 'swing', name: 'swing', group: 'Attention', dur: 1, timing: 'ease', iter: 1, origin: 'top center',
      vars: [v('swing-angle', 15, 'deg', 0, 45, 1)],
      kf: `20% { transform: rotate(var(--ik-swing-angle)); }
  40% { transform: rotate(calc(var(--ik-swing-angle) * -0.67)); }
  60% { transform: rotate(calc(var(--ik-swing-angle) * 0.33)); }
  80% { transform: rotate(calc(var(--ik-swing-angle) * -0.33)); }
  100% { transform: rotate(0deg); }` },
    { id: 'tada', name: 'tada', group: 'Attention', dur: 1, timing: 'ease', iter: 1,
      vars: [v('tada-scale', 1.1, '', 1, 1.6), v('tada-angle', 3, 'deg', 0, 15, 1)],
      kf: `0%, 100% { transform: scale(1) rotate(0); }
  10%, 20% { transform: scale(calc(2 - var(--ik-tada-scale))) rotate(calc(var(--ik-tada-angle) * -1)); }
  30%, 50%, 70%, 90% { transform: scale(var(--ik-tada-scale)) rotate(var(--ik-tada-angle)); }
  40%, 60%, 80% { transform: scale(var(--ik-tada-scale)) rotate(calc(var(--ik-tada-angle) * -1)); }` },
    { id: 'jello', name: 'jello', group: 'Attention', dur: 1, timing: 'ease', iter: 1,
      vars: [v('jello-skew', 12.5, 'deg', 0, 40, .5)],
      kf: `0%, 11.1%, 100% { transform: skew(0); }
  22.2% { transform: skew(calc(var(--ik-jello-skew) * -1), calc(var(--ik-jello-skew) * -1)); }
  33.3% { transform: skew(calc(var(--ik-jello-skew) * 0.5), calc(var(--ik-jello-skew) * 0.5)); }
  44.4% { transform: skew(calc(var(--ik-jello-skew) * -0.25), calc(var(--ik-jello-skew) * -0.25)); }
  55.5% { transform: skew(calc(var(--ik-jello-skew) * 0.125), calc(var(--ik-jello-skew) * 0.125)); }
  66.6% { transform: skew(calc(var(--ik-jello-skew) * -0.0625), calc(var(--ik-jello-skew) * -0.0625)); }` },
    { id: 'rubber-band', name: 'rubber-band', group: 'Attention', dur: 1, timing: 'ease', iter: 1,
      vars: [v('rubber-stretch', 1.25, '', 1, 2)],
      kf: `0%, 100% { transform: scale(1, 1); }
  30% { transform: scale(var(--ik-rubber-stretch), calc(2 - var(--ik-rubber-stretch))); }
  40% { transform: scale(calc(2 - var(--ik-rubber-stretch)), var(--ik-rubber-stretch)); }
  50% { transform: scale(1.15, 0.85); }
  65% { transform: scale(0.95, 1.05); }
  75% { transform: scale(1.05, 0.95); }` },
    { id: 'blink', name: 'blink', group: 'Attention', dur: 1, timing: 'steps(1)', iter: 'infinite', vars: [v('blink-opacity', 0, '', 0, 1)],
      kf: '50% { opacity: var(--ik-blink-opacity); }' },
    { id: 'float', name: 'float', group: 'Loop', dur: 3, timing: 'ease-in-out', iter: 'infinite',
      vars: [v('float-height', -0.25, 'em', -2, 0)],
      kf: '0%, 100% { transform: translateY(0); }\n  50% { transform: translateY(var(--ik-float-height)); }' },
    { id: 'pop', name: 'pop', group: 'Attention', dur: .5, timing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', iter: 1,
      vars: [v('pop-scale', .6, '', 0, 1)],
      kf: '0% { transform: scale(var(--ik-pop-scale)); opacity: 0; }\n  100% { transform: scale(1); opacity: 1; }' },
    // entrances / exits (iter 1; preview replays them)
    { id: 'fade-in', name: 'fade-in', group: 'Enter / exit', dur: .6, timing: 'ease-out', iter: 1, vars: [],
      kf: 'from { opacity: 0; }\n  to { opacity: 1; }' },
    { id: 'fade-out', name: 'fade-out', group: 'Enter / exit', dur: .6, timing: 'ease-in', iter: 1, vars: [],
      kf: 'from { opacity: 1; }\n  to { opacity: 0; }' },
    { id: 'slide-in', name: 'slide-in', group: 'Enter / exit', dur: .6, timing: 'ease-out', iter: 1,
      vars: [v('slide-x', -100, '%', -300, 300, 1), v('slide-y', 0, '%', -300, 300, 1)],
      kf: 'from { transform: translate(var(--ik-slide-x), var(--ik-slide-y)); opacity: 0; }\n  to { transform: translate(0, 0); opacity: 1; }' },
    { id: 'slide-out', name: 'slide-out', group: 'Enter / exit', dur: .6, timing: 'ease-in', iter: 1,
      vars: [v('slide-x', 100, '%', -300, 300, 1), v('slide-y', 0, '%', -300, 300, 1)],
      kf: 'from { transform: translate(0, 0); opacity: 1; }\n  to { transform: translate(var(--ik-slide-x), var(--ik-slide-y)); opacity: 0; }' },
    { id: 'zoom-in', name: 'zoom-in', group: 'Enter / exit', dur: .5, timing: 'ease-out', iter: 1,
      vars: [v('zoom-from', .3, '', 0, 1)],
      kf: 'from { transform: scale(var(--ik-zoom-from)); opacity: 0; }\n  to { transform: scale(1); opacity: 1; }' },
    { id: 'zoom-out', name: 'zoom-out', group: 'Enter / exit', dur: .5, timing: 'ease-in', iter: 1,
      vars: [v('zoom-to', .3, '', 0, 1)],
      kf: 'from { transform: scale(1); opacity: 1; }\n  to { transform: scale(var(--ik-zoom-to)); opacity: 0; }' },
  ];

  class Anim {
    static LIST = ANIMS;

    static get(id) {
      return ANIMS.find(a => a.id === id) ?? null;
    }

    /** Variable values: defaults overridden by `vals` ({name: number}). */
    static values(a, vals = {}) {
      return Object.fromEntries(a.vars.map(x => [x.name, vals[x.name] ?? x.def]));
    }

    /** Inline style for a preview element: the variables + the animation shorthand. */
    static style(a, o = {}) {
      const vals = Anim.values(a, o.vals);
      const timing = o.timing ?? a.timing;
      const s = Object.entries(vals).map(([k, val]) => `--ik-${k}: ${val}${a.vars.find(x => x.name === k).unit};`);
      s.push(`animation: ik-${a.id} ${o.dur ?? a.dur}s ${timing} ${o.delay ?? 0}s ${o.iter ?? a.iter} ${o.dir ?? a.dir ?? 'normal'} both;`);
      if(a.origin) s.push(`transform-origin: ${a.origin};`);
      return s.join(' ');
    }

    static keyframes(a) {
      return `@keyframes ik-${a.id} {\n  ${a.kf}\n}`;
    }

    /** CSS to copy: keyframes + a class with the variables and the animation (Font Awesome style). */
    static css(a, o = {}) {
      const vals = Anim.values(a, o.vals);
      const cls = o.cls ?? `ik-${a.id}`;
      const lines = Object.entries(vals).map(([k, val]) => `  --ik-${k}: ${val}${a.vars.find(x => x.name === k).unit};`);
      lines.push(`  animation-name: ik-${a.id};`, `  animation-duration: var(--ik-animation-duration, ${o.dur ?? a.dur}s);`,
        `  animation-timing-function: var(--ik-animation-timing, ${o.timing ?? a.timing});`, `  animation-delay: var(--ik-animation-delay, ${o.delay ?? 0}s);`,
        `  animation-iteration-count: var(--ik-animation-iteration-count, ${o.iter ?? a.iter});`, `  animation-direction: var(--ik-animation-direction, ${o.dir ?? a.dir ?? 'normal'});`);
      if(a.origin) lines.push(`  transform-origin: ${a.origin};`);
      return `${Anim.keyframes(a)}\n\n.${cls} {\n${lines.join('\n')}\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .${cls} { animation: none; }\n}\n`;
    }

    /** element.animate() call: keyframes resolved with the current variable values. */
    static js(a, o = {}) {
      const vals = Anim.values(a, o.vals);
      const sub = s => s.replace(/var\(--ik-([\w-]+)\)/g, (_, k) => `${vals[k]}${a.vars.find(x => x.name === k)?.unit ?? ''}`);
      const frames = [];
      for(const m of a.kf.matchAll(/([\d%,\s.a-z]+)\{([^}]*)\}/g)) {
        const offs = m[1].split(',').map(s => s.trim()).map(s => s === 'from' ? 0 : s === 'to' ? 1 : parseFloat(s) / 100);
        const props = {};
        for(const decl of m[2].split(';').map(s => s.trim()).filter(Boolean)) {
          const i = decl.indexOf(':');
          props[decl.slice(0, i).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = sub(decl.slice(i + 1).trim());
        }
        offs.forEach(offset => frames.push({ offset, ...props }));
      }
      frames.sort((p, q) => p.offset - q.offset);
      const iter = (o.iter ?? a.iter) === 'infinite' ? 'Infinity' : (o.iter ?? a.iter);
      return `element.animate(${JSON.stringify(frames, null, 2)}, {\n  duration: ${Math.round((o.dur ?? a.dur) * 1000)},\n  easing: '${o.timing ?? a.timing}',\n  delay: ${Math.round((o.delay ?? 0) * 1000)},\n  iterations: ${iter},\n  direction: '${o.dir ?? a.dir ?? 'normal'}',\n  fill: 'both'\n});\n`;
    }
  }
  //#endregion

  DAE.Ease = Ease;
  DAE.Anim = Anim;
});
