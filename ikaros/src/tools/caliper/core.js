// Caliper core: compares two values (from TOON or JSON) as trees.
// Node: { key, path, status, a, b, children } with status
//   same | changed (value) | added | removed | moved (array item matched by key at another index) | inner (children differ).
// Arrays match by index, or by a key field ('auto' picks id / name / key when every item has a unique one).
DAE_CORE(DAE => {
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const kind = v => Array.isArray(v) ? 'array' : isObj(v) ? 'object' : 'value';
  const ident = k => /^[A-Za-z_$][\w$]*$/.test(k);
  const join = (path, key) => typeof key === 'number' ? `${path}[${key}]` : ident(key) ? (path ? `${path}.${key}` : key) : `${path}[${JSON.stringify(key)}]`;
  const ptr = parts => parts.map(p => '/' + String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('');

  class Diff {
    /**
     * @param {object} o - { key: 'auto' | 'index' | field, ignore: string[] (key names), tol: number, nocase: boolean, order: boolean (ignore order of primitive arrays) }
     */
    static compare(a, b, o = {}) {
      const opt = { key: 'auto', ignore: [], tol: 0, nocase: false, order: false, ...o };
      return Diff.#node(a, b, '', '', opt, true, true, '');
    }

    static #eqPrim(a, b, o) {
      if(typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= o.tol;
      if(typeof a === 'string' && typeof b === 'string' && o.nocase) return a.toLowerCase() === b.toLowerCase();
      return a === b;
    }

    /** path = where it is in b (in a when removed); apath = where it is in a. */
    static #node(a, b, key, path, o, hasA, hasB, apath = path) {
      if(!hasA) return Diff.#side(b, key, path, 'added', 'b');
      if(!hasB) return Diff.#side(a, key, apath, 'removed', 'a');
      const ka = kind(a), kb = kind(b);
      if(ka !== kb || ka === 'value') {
        const same = ka === kb && Diff.#eqPrim(a, b, o);
        return { key, path, apath, status: same ? 'same' : 'changed', a, b, kind: ka === kb ? ka : 'value', children: [] };
      }
      const children = ka === 'object' ? Diff.#objects(a, b, path, o, apath) : Diff.#arrays(a, b, path, o, apath);
      const status = children.every(c => c.status === 'same') ? 'same' : 'inner';
      return { key, path, apath, status, a, b, kind: ka, children };
    }

    /** A subtree that is only on one side: every node below gets the same status. */
    static #side(v, key, path, status, side) {
      const k = kind(v);
      const children = k === 'object' ? Object.entries(v).map(([ck, cv]) => Diff.#side(cv, ck, join(path, ck), status, side))
        : k === 'array' ? v.map((cv, i) => Diff.#side(cv, i, join(path, i), status, side)) : [];
      return { key, path, ...(side === 'a' ? { apath: path } : {}), status, [side]: v, kind: k, children };
    }

    static #objects(a, b, path, o, apath) {
      const keys = [...Object.keys(a), ...Object.keys(b).filter(k => !(k in a))].filter(k => !o.ignore.includes(k));
      return keys.map(k => Diff.#node(a[k], b[k], k, join(path, k), o, k in a, k in b, join(apath, k)));
    }

    /** The field arrays are matched by, or null for index matching. */
    static matchKey(a, b, o = {}) {
      const want = o.key ?? 'auto';
      if(want === 'index') return null;
      const all = [...a, ...b];
      if(!all.length || !all.every(isObj)) return null;
      const ok = f => [a, b].every(list => {
        const vals = list.map(x => x[f]);
        return vals.every(v => v !== undefined && v !== null && !isObj(v) && !Array.isArray(v)) && new Set(vals.map(String)).size === vals.length;
      });
      if(want !== 'auto') return ok(want) ? want : null;
      return ['id', 'name', 'key'].find(ok) ?? null;
    }

    static #arrays(a, b, path, o, apath) {
      if(o.order && [...a, ...b].every(v => kind(v) === 'value')) {
        // as multisets: equal values pair up, the rest are added / removed
        const left = [...a], out = [];
        b.forEach((v, i) => {
          const j = left.findIndex(x => x !== undefined && Diff.#eqPrim(x, v, o));
          if(j >= 0) { left[j] = undefined; out.push({ key: i, path: join(path, i), apath: join(apath, j), status: 'same', a: v, b: v, kind: 'value', children: [] }); }
          else out.push(Diff.#side(v, i, join(path, i), 'added', 'b'));
        });
        a.forEach((v, i) => { if(left[i] !== undefined) out.push(Diff.#side(v, i, join(apath, i), 'removed', 'a')); });
        return out;
      }
      const field = Diff.matchKey(a, b, o);
      if(!field) {
        const n = Math.max(a.length, b.length);
        return Array.from({ length: n }, (_, i) => Diff.#node(a[i], b[i], i, join(path, i), o, i < a.length, i < b.length, join(apath, i)));
      }
      const at = new Map(a.map((x, i) => [String(x[field]), i]));
      const out = [], used = new Set();
      b.forEach((x, i) => {
        const j = at.get(String(x[field]));
        if(j === undefined) { out.push(Diff.#side(x, i, join(path, i), 'added', 'b')); return; }
        used.add(j);
        const n = Diff.#node(a[j], x, i, join(path, i), o, true, true, join(apath, j));
        if(j !== i) { n.from = j; n.status = n.status === 'same' ? 'moved' : n.status; n.moved = true; }
        n.match = `${field}=${x[field]}`;
        out.push(n);
      });
      a.forEach((x, j) => { if(!used.has(j)) out.push({ ...Diff.#side(x, j, join(apath, j), 'removed', 'a'), match: `${field}=${x[field]}` }); });
      return out;
    }

    /** Flat change list [{path, kind, old, new, from?}] (top-most change per branch). */
    static changes(root) {
      const out = [];
      const walk = n => {
        if(n.moved) {
          out.push({ path: n.path, kind: 'moved', from: n.from });
          if(n.status === 'inner') n.children.forEach(walk);
          return;
        }
        if(n.status === 'same') return;
        if(n.status === 'inner') { n.children.forEach(walk); return; }
        const c = { path: n.path || '(root)', kind: n.status };
        if('a' in n) c.old = n.a;
        if('b' in n) c.new = n.b;
        out.push(c);
      };
      walk(root);
      return out;
    }

    static count(root) {
      const c = { added: 0, removed: 0, changed: 0, moved: 0 };
      for(const x of Diff.changes(root)) c[x.kind] = (c[x.kind] ?? 0) + 1;
      return c;
    }

    //#region [ JSON Patch (RFC 6902) ]
    /** Ops turning a into b (index based, so applying them in order always works). */
    static patch(a, b, base = []) {
      const ops = [];
      const walk = (x, y, parts) => {
        const kx = kind(x), ky = kind(y);
        if(kx !== ky || kx === 'value') {
          if(x !== y) ops.push({ op: 'replace', path: ptr(parts), value: y });
          return;
        }
        if(kx === 'object') {
          for(const k of Object.keys(x)) if(!(k in y)) ops.push({ op: 'remove', path: ptr([...parts, k]) });
          for(const k of Object.keys(y)) {
            if(!(k in x)) ops.push({ op: 'add', path: ptr([...parts, k]), value: y[k] });
            else walk(x[k], y[k], [...parts, k]);
          }
          return;
        }
        const n = Math.min(x.length, y.length);
        for(let i = 0; i < n; i++) walk(x[i], y[i], [...parts, i]);
        for(let i = x.length - 1; i >= y.length; i--) ops.push({ op: 'remove', path: ptr([...parts, i]) });
        for(let i = x.length; i < y.length; i++) ops.push({ op: 'add', path: ptr([...parts, '-']), value: y[i] });
      };
      walk(a, b, base);
      return ops;
    }

    /** Applies RFC 6902 add / remove / replace ops (returns a new value). */
    static apply(value, ops) {
      let doc = structuredClone(value);
      for(const op of ops) {
        const parts = op.path === '' ? [] : op.path.slice(1).split('/').map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'));
        if(!parts.length) {
          if(op.op === 'remove') doc = undefined; else doc = structuredClone(op.value);
          continue;
        }
        let parent = doc;
        for(const p of parts.slice(0, -1)) parent = parent[Array.isArray(parent) ? +p : p];
        const last = parts.at(-1);
        if(Array.isArray(parent)) {
          const i = last === '-' ? parent.length : +last;
          if(op.op === 'add') parent.splice(i, 0, structuredClone(op.value));
          else if(op.op === 'remove') parent.splice(i, 1);
          else parent[i] = structuredClone(op.value);
        }
        else if(op.op === 'remove') delete parent[last];
        else parent[last] = structuredClone(op.value);
      }
      return doc;
    }
    //#endregion

    /** Change list as Markdown. */
    static markdown(list) {
      const cell = v => v === undefined ? '' : '`' + JSON.stringify(v).replace(/\|/g, '\\|').slice(0, 80) + '`';
      return ['| Path | Change | Old | New |', '|---|---|---|---|', ...list.map(c => `| \`${c.path}\` | ${c.kind}${c.from !== undefined ? ` (from [${c.from}])` : ''} | ${cell(c.old)} | ${cell(c.new)} |`)].join('\n') + '\n';
    }
  }

  DAE.Diff = Diff;
});
