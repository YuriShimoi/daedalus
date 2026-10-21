// Spyglass core: TOON / JSON text -> value + line ranges per path -> cards (objects, arrays,
// tables) with rows -> a left-to-right tree layout. Paths read like code: rooms[1].items[0], a["b c"].
DAE_CORE(DAE => {
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isPrim = v => v === null || typeof v !== 'object';
  const ident = k => /^[A-Za-z_$][\w$]*$/.test(k);
  const join = (path, key) => typeof key === 'number' ? `${path}[${key}]` : ident(key) ? (path ? `${path}.${key}` : key) : `${path}[${JSON.stringify(key)}]`;
  const HEAD = /^([\w$.-]+|"(?:[^"\\]|\\.)*")?(?:\[(\d+)\])?(?:\{([^}]*)\})?:(?: (.*))?$/;

  // sizes used by the layout (the page draws with the same numbers)
  const CH = 7.2, ROW = 20, HEADER = 28, PAD = 10, MIN_W = 150, MAX_W = 380, GAP_X = 90, GAP_Y = 22, TABLE_ROWS = 60;

  class ParseError extends Error {
    constructor(msg, line, col = 1) {
      super(`line ${line}, col ${col}: ${msg}`);
      Object.assign(this, { reason: msg, line, col });
    }
  }

  class Tree {
    static SIZES = { CH, ROW, HEADER, PAD, MIN_W, MAX_W, GAP_X, GAP_Y, TABLE_ROWS };
    static join = join;

    /** 'json' when the text starts like JSON, else 'toon'. */
    static detect(text) {
      const s = text.trimStart();
      return /^[[{"]/.test(s) || /^(-?\d|true\b|false\b|null\b)/.test(s) && !/^[\w$.-]+(\[\d+\])?(\{[^}]*\})?:/.test(s) ? 'json' : 'toon';
    }

    /**
     * @returns {{format, value, ranges: Map<string, [number, number]>, error: ParseError|null}}
     */
    static parse(text, format = Tree.detect(text)) {
      try {
        if(format === 'json') {
          const { value, ranges } = Tree.#json(text);
          return { format, value, ranges, error: null };
        }
        let value;
        try { value = DAE.Toon.decode(text); }
        catch(e) {
          const m = e.message.match(/^line (\d+): (.*)$/);
          throw m ? new ParseError(m[2], +m[1]) : e;
        }
        return { format, value, ranges: Tree.#toonRanges(text), error: null };
      }
      catch(e) {
        return { format, value: undefined, ranges: new Map(), error: e instanceof ParseError ? e : new ParseError(e.message, 1) };
      }
    }

    //#region [ JSON with positions ]
    static #json(text) {
      const starts = [0];
      for(let i = 0; i < text.length; i++) if(text[i] === '\n') starts.push(i + 1);
      const lineOf = off => {
        let lo = 0, hi = starts.length - 1;
        while(lo < hi) { const m = (lo + hi + 1) >> 1; if(starts[m] <= off) lo = m; else hi = m - 1; }
        return lo + 1;
      };
      const fail = (msg, at = i) => { const l = lineOf(at); throw new ParseError(msg, l, at - starts[l - 1] + 1); };
      const ranges = new Map();
      let i = 0;
      const ws = () => { while(i < text.length && ' \t\n\r'.includes(text[i])) i++; };
      const str = () => {
        const s = i;
        i++;
        while(i < text.length && text[i] !== '"') {
          if(text[i] === '\\') i++;
          else if(text[i] === '\n') fail('line break inside a string');
          i++;
        }
        if(i >= text.length) fail('unclosed string', s);
        i++;
        try { return JSON.parse(text.slice(s, i)); } catch { fail('bad escape in string', s); }
      };
      const value = path => {
        ws();
        const s = i, c = text[i];
        let v;
        if(c === '{') {
          v = {};
          i++; ws();
          if(text[i] === '}') i++;
          else for(;;) {
            ws();
            if(text[i] !== '"') fail(text[i] === '}' ? 'trailing comma' : 'expected a "key"');
            const k = str();
            ws();
            if(text[i] !== ':') fail('expected ":"');
            i++;
            v[k] = value(join(path, k));
            ws();
            if(text[i] === ',') { i++; continue; }
            if(text[i] === '}') { i++; break; }
            fail(i >= text.length ? 'unclosed "{"' : 'expected "," or "}"');
          }
        }
        else if(c === '[') {
          v = [];
          i++; ws();
          if(text[i] === ']') i++;
          else for(;;) {
            ws();
            if(text[i] === ']') fail('trailing comma');
            v.push(value(join(path, v.length)));
            ws();
            if(text[i] === ',') { i++; continue; }
            if(text[i] === ']') { i++; break; }
            fail(i >= text.length ? 'unclosed "["' : 'expected "," or "]"');
          }
        }
        else if(c === '"') v = str();
        else {
          const m = text.slice(i).match(/^(-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?|true|false|null)/);
          if(!m) fail(i >= text.length ? 'unexpected end' : `unexpected "${text[i]}"`);
          i += m[0].length;
          v = JSON.parse(m[0]);
        }
        ranges.set(path, [lineOf(s), lineOf(Math.max(s, i - 1))]);
        return v;
      };
      const v = value('');
      ws();
      if(i < text.length) fail('extra text after the value');
      return { value: v, ranges };
    }
    //#endregion

    //#region [ TOON ranges ]
    /** Line range of every path in TOON text (the text already decoded fine). */
    static #toonRanges(text) {
      const lines = [];
      text.replace(/\r\n?/g, '\n').split('\n').forEach((raw, i) => {
        if(!raw.trim() || raw.trimStart().startsWith('#')) return;
        lines.push({ n: i + 1, depth: (raw.length - raw.trimStart().length) / 2, text: raw.trim() });
      });
      const ranges = new Map();
      let i = 0;
      const keyOf = k => k.startsWith('"') ? JSON.parse(k) : k;
      const readObject = (depth, path) => {
        while(i < lines.length && lines[i].depth === depth && !lines[i].text.startsWith('- ')) {
          const line = lines[i++], m = line.text.match(HEAD);
          if(!m?.[1]) break;
          const p = join(path, keyOf(m[1]));
          readValue(line, depth, m, p);
          ranges.set(p, [line.n, lines[i - 1].n]);
        }
      };
      const readValue = (line, depth, m, path) => {
        const [, , count, fields, rest] = m;
        if(count === undefined) {
          if(rest === undefined) readObject(depth + 1, path);
          return;
        }
        const n = +count;
        if(fields !== undefined) {
          for(let r = 0; r < n && i < lines.length; r++) { const row = lines[i++]; ranges.set(join(path, r), [row.n, row.n]); }
          return;
        }
        if(rest !== undefined) {
          for(let k = 0; k < n; k++) ranges.set(join(path, k), [line.n, line.n]);
          return;
        }
        if(n) readList(depth + 1, path);
      };
      const readList = (depth, path) => {
        let k = 0;
        while(i < lines.length && lines[i].depth === depth && lines[i].text.startsWith('- ')) {
          const line = lines[i], body = line.text.slice(2), m = body.match(HEAD), p = join(path, k++);
          if(!m) i++;
          else if(m[1] === undefined) { i++; readValue(line, depth, m, p); }
          else { line.text = body; line.depth = depth + 1; readObject(depth + 1, p); }
          ranges.set(p, [line.n, lines[i - 1].n]);
        }
      };
      readObject(0, '');
      if(lines.length) ranges.set('', [lines[0].n, lines.at(-1).n]);
      return ranges;
    }
    //#endregion

    //#region [ Convert ]
    static stringify(value, format) {
      if(format === 'json') return JSON.stringify(value, null, 2) + '\n';
      if(!isObj(value)) throw new Error('TOON needs an object at the top (wrap the array or value in a key)');
      return DAE.Toon.encode(value);
    }

    /** Text in one format -> text in the other (or the same, re-formatted). */
    static convert(text, to) {
      const r = Tree.parse(text);
      if(r.error) throw r.error;
      return Tree.stringify(r.value, to ?? (r.format === 'json' ? 'toon' : 'json'));
    }
    //#endregion

    //#region [ Cards ]
    /** A flat object list with only primitive values: shown as one table card. */
    static isTable(v) {
      if(!Array.isArray(v) || !v.length || !v.every(isObj)) return false;
      return v.every(o => Object.values(o).every(isPrim));
    }

    static columns(list) {
      const cols = [];
      for(const o of list) for(const k of Object.keys(o)) if(!cols.includes(k)) cols.push(k);
      return cols;
    }

    static type(v) {
      return v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
    }

    static show(v) {
      if(typeof v === 'string') return v;
      return v === undefined ? '' : JSON.stringify(v);
    }

    /**
     * Value -> cards. Card: { id, path, key, kind: object|array|table|value, depth, rows, cols?, parent, row (row index in the parent), children: [card ids] }.
     * Row: { key, value?, type, child? (card id), path }.
     */
    static cards(value) {
      const cards = [];
      const add = (v, key, path, depth, parent, row) => {
        const id = cards.length;
        const kind = Tree.isTable(v) ? 'table' : Array.isArray(v) ? 'array' : isObj(v) ? 'object' : 'value';
        const card = { id, path, key, kind, depth, parent, row, rows: [], children: [] };
        cards.push(card);
        if(kind === 'value') { card.rows.push({ key: '', value: v, type: Tree.type(v), path }); return id; }
        if(kind === 'table') {
          card.cols = Tree.columns(v);
          v.forEach((o, i) => card.rows.push({ key: i, cells: card.cols.map(c => o[c]), path: join(path, i) }));
          return id;
        }
        const entries = Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v);
        for(const [k, x] of entries) {
          const p = join(path, k);
          if(isPrim(x)) card.rows.push({ key: k, value: x, type: Tree.type(x), path: p });
          else {
            const r = card.rows.length;
            card.rows.push({ key: k, type: Tree.type(x), size: Array.isArray(x) ? x.length : Object.keys(x).length, path: p, child: -1 });
            const cid = add(x, k, p, depth + 1, id, r);
            card.rows[r].child = cid;
            card.children.push(cid);
          }
        }
        return id;
      };
      add(value, '', '', 0, -1, -1);
      return cards;
    }

    /** Width / height of a card for the layout. */
    static size(card) {
      if(card.kind === 'table') {
        const rows = card.rows.slice(0, TABLE_ROWS);
        const widths = card.cols.map((c, j) => Math.max(c.length, ...rows.map(r => Tree.show(r.cells[j]).length)));
        const w = Math.min(MAX_W * 1.6, Math.max(MIN_W, (widths.reduce((s, x) => s + Math.min(x, 24), 0) + 4) * CH + card.cols.length * 14 + PAD * 2));
        return { w, h: HEADER + ROW * (Math.min(card.rows.length, TABLE_ROWS) + 1 + (card.rows.length > TABLE_ROWS ? 1 : 0)) + 8, colW: widths.map(x => Math.min(x, 24) * CH + 14) };
      }
      let wide = String(card.key).length + 16;
      for(const r of card.rows) wide = Math.max(wide, String(r.key).length + Tree.show(r.value ?? '').slice(0, 40).length + 6 + (r.child !== undefined ? 6 : 0));
      return { w: Math.min(MAX_W, Math.max(MIN_W, wide * CH + PAD * 2)), h: HEADER + ROW * card.rows.length + 8 };
    }

    /**
     * Left-to-right tidy tree. `hidden` = Set of card ids whose children are collapsed.
     * @returns {{pos: Map<id, {x, y, w, h}>, bounds: {x, y, w, h}}}
     */
    static layout(cards, { root = 0, hidden = new Set() } = {}) {
      const pos = new Map(), span = new Map(), colW = [];
      const visKids = c => (hidden.has(c.id) ? [] : c.children.map(i => cards[i]));
      const measure = (c, d) => {
        const s = Tree.size(c);
        pos.set(c.id, { x: 0, y: 0, w: s.w, h: s.h, d });
        colW[d] = Math.max(colW[d] ?? 0, s.w);
        const kids = visKids(c);
        let sum = 0;
        kids.forEach((k, i) => { sum += measure(k, d + 1) + (i ? GAP_Y : 0); });
        span.set(c.id, Math.max(s.h, sum));
        return span.get(c.id);
      };
      const place = (c, top) => {
        const p = pos.get(c.id), sp = span.get(c.id);
        p.y = top + (sp - p.h) / 2;
        const kids = visKids(c);
        const sum = kids.reduce((s, k, i) => s + span.get(k.id) + (i ? GAP_Y : 0), 0);
        let y = top + (sp - sum) / 2;
        for(const k of kids) { place(k, y); y += span.get(k.id) + GAP_Y; }
      };
      const r = cards[root];
      if(!r) return { pos, bounds: { x: 0, y: 0, w: 0, h: 0 } };
      measure(r, 0);
      place(r, 0);
      const colX = [0];
      for(let d = 1; d < colW.length; d++) colX[d] = colX[d - 1] + colW[d - 1] + GAP_X;
      for(const p of pos.values()) p.x = colX[p.d];
      const w = colX.at(-1) + colW.at(-1);
      return { pos, bounds: { x: 0, y: 0, w, h: span.get(r.id) } };
    }

    /** Cards below `id` (all depths). */
    static descendants(cards, id) {
      let n = 0;
      const walk = c => c.children.forEach(k => { n++; walk(cards[k]); });
      walk(cards[id]);
      return n;
    }

    /** Matches of `query` in keys and values: [{card, row}] (row -1 = the card's own key). */
    static search(cards, query) {
      const q = query.trim().toLowerCase();
      if(!q) return [];
      const out = [];
      for(const c of cards) {
        if(c.parent >= 0 && String(c.key).toLowerCase().includes(q)) out.push({ card: c.id, row: -1 });
        c.rows.forEach((r, i) => {
          const hay = r.cells ? r.cells.map(Tree.show).join(' ') : `${r.child === undefined ? r.key : ''} ${Tree.show(r.value ?? '')}`;
          if(hay.toLowerCase().includes(q)) out.push({ card: c.id, row: i });
        });
      }
      return out;
    }

    /** Card holding a path (deepest), and the row inside it. */
    static find(cards, path) {
      let best = null;
      for(const c of cards) {
        if(c.path === path) return { card: c.id, row: -1 };
        const i = c.rows.findIndex(r => r.path === path && r.child === undefined);
        if(i >= 0) best = { card: c.id, row: i };
      }
      return best;
    }

    /** Path of the deepest node whose range holds `line`. */
    static pathAt(ranges, line) {
      let best = '', size = Infinity;
      for(const [p, [a, b]] of ranges) if(line >= a && line <= b && b - a <= size) { best = p; size = b - a; }
      return best;
    }

    static stats(value) {
      const s = { objects: 0, arrays: 0, values: 0, depth: 0 };
      const walk = (v, d) => {
        s.depth = Math.max(s.depth, d);
        if(Array.isArray(v)) { s.arrays++; v.forEach(x => walk(x, d + 1)); }
        else if(isObj(v)) { s.objects++; Object.values(v).forEach(x => walk(x, d + 1)); }
        else s.values++;
      };
      walk(value, 0);
      s.nodes = s.objects + s.arrays + s.values;
      return s;
    }

    /** Value at a path written by join() (for "copy value"). */
    static get(value, path) {
      if(!path) return value;
      const parts = [...path.matchAll(/(?:^|\.)([A-Za-z_$][\w$]*)|\[(\d+)\]|\[("(?:[^"\\]|\\.)*")\]/g)].map(m => m[1] ?? (m[2] !== undefined ? +m[2] : JSON.parse(m[3])));
      return parts.reduce((v, k) => v?.[k], value);
    }
    //#endregion
  }

  DAE.Tree = Tree;
});
