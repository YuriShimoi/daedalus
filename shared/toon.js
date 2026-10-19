// TOON (Token-Oriented Object Notation), the subset Daedalus writes: indented objects,
// inline primitive arrays `k[N]: a,b`, tabular arrays `k[N]{f,g}:` and `- ` list items.
// In tables an empty cell means "missing".
DAE_CORE(DAE => {
  const NUM = /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i;
  const HEAD = /^([\w$.-]+|"(?:[^"\\]|\\.)*")?(?:\[(\d+)\])?(?:\{([^}]*)\})?:(?: (.*))?$/;

  class Toon {
    //#region [ Encode ]
    /** Object -> TOON text. undefined values are skipped. */
    static encode(value) {
      const out = [];
      Toon.#object(value, 0, out);
      return out.join('\n') + '\n';
    }

    static str(v) {
      if(v === null || v === undefined) return 'null';
      if(typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
      if(typeof v === 'boolean') return String(v);
      const s = String(v);
      // quote anything that could be read as another type or breaks the row syntax
      if(s === '' || s !== s.trim() || /[,"\\\n\r\t]|: /.test(s) || s.startsWith('- ')
        || /^(true|false|null)$/.test(s) || NUM.test(s)) {
        return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
      }
      return s;
    }

    static #isPrim(v) { return v === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof v); }
    static #isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

    /** Union of keys when every item is a flat object, else null. */
    static #tableKeys(list) {
      if(!list.length || !list.every(Toon.#isObj)) return null;
      // keys in declared order; columns that are empty in every row are dropped
      const keys = [], used = new Set();
      for(const o of list) {
        for(const [k, v] of Object.entries(o)) {
          if(!Toon.#isPrim(v)) return null;
          if(!keys.includes(k)) keys.push(k);
          if(v !== undefined) used.add(k);
        }
      }
      const out = keys.filter(k => used.has(k));
      return out.length ? out : null;
    }

    static #object(value, indent, out) {
      const pad = '  '.repeat(indent);
      for(const [key, v] of Object.entries(value)) {
        if(v === undefined) continue;
        if(Toon.#isPrim(v)) out.push(`${pad}${key}: ${Toon.str(v)}`);
        else if(Array.isArray(v)) Toon.#array(`${pad}${key}`, v, indent, out);
        else {
          out.push(`${pad}${key}:`);
          Toon.#object(v, indent + 1, out);
        }
      }
    }

    static #array(head, list, indent, out) {
      const pad = '  '.repeat(indent);
      if(list.every(Toon.#isPrim)) {
        out.push(`${head}[${list.length}]:${list.length ? ' ' + list.map(Toon.str).join(',') : ''}`);
        return;
      }
      const keys = Toon.#tableKeys(list);
      if(keys) {
        out.push(`${head}[${list.length}]{${keys.join(',')}}:`);
        const cell = v => v === undefined || v === null ? '' : Toon.str(v);
        list.forEach(o => out.push(`${pad}  ${keys.map(k => cell(o[k])).join(',')}`));
        return;
      }
      out.push(`${head}[${list.length}]:`);
      for(const item of list) {
        if(Toon.#isPrim(item)) out.push(`${pad}  - ${Toon.str(item)}`);
        else if(Array.isArray(item)) Toon.#array(`${pad}  - `, item, indent + 1, out);
        else {
          const sub = [];
          Toon.#object(item, indent + 2, sub);
          sub[0] = `${pad}  - ` + sub[0].trimStart();
          out.push(...sub);
        }
      }
    }
    //#endregion

    //#region [ Decode ]
    /** TOON text -> object. Throws Error('line N: ...') on bad syntax. */
    static decode(text) {
      const lines = [];
      text.replace(/\r\n?/g, '\n').split('\n').forEach((raw, i) => {
        if(!raw.trim() || raw.trimStart().startsWith('#')) return;
        const indent = raw.length - raw.trimStart().length;
        if(indent % 2) throw new Error(`line ${i + 1}: odd indentation`);
        lines.push({ n: i + 1, depth: indent / 2, text: raw.trim() });
      });
      const ctx = { lines, i: 0 };
      const value = Toon.#readObject(ctx, 0);
      if(ctx.i < lines.length) Toon.#fail(lines[ctx.i], 'unexpected indentation');
      return value;
    }

    static #fail(line, msg) {
      throw new Error(`line ${line.n}: ${msg}`);
    }

    static #readObject(ctx, depth, obj = {}) {
      const { lines } = ctx;
      while(ctx.i < lines.length && lines[ctx.i].depth === depth && !lines[ctx.i].text.startsWith('- ')) {
        const line = lines[ctx.i++];
        const m = line.text.match(HEAD);
        if(!m || !m[1]) Toon.#fail(line, `expected "key: value", got "${line.text}"`);
        const key = m[1].startsWith('"') ? Toon.#unquote(m[1], line) : m[1];
        obj[key] = Toon.#readValue(ctx, line, depth, m);
      }
      return obj;
    }

    /** Value after a header: m = [_, key, count, fields, rest] */
    static #readValue(ctx, line, depth, m) {
      const [, , count, fields, rest] = m;
      if(count === undefined) {
        if(fields !== undefined) Toon.#fail(line, 'fields without [N]');
        if(rest !== undefined) return Toon.#prim(rest, line);
        return Toon.#readObject(ctx, depth + 1);
      }
      const n = +count;
      if(fields !== undefined) {
        const keys = fields.split(',').map(k => k.trim());
        const list = [];
        for(let r = 0; r < n; r++) {
          const row = ctx.lines[ctx.i];
          if(!row || row.depth !== depth + 1) Toon.#fail(line, `table has ${r} rows, expected ${n}`);
          ctx.i++;
          const cells = Toon.#split(row.text, row);
          if(cells.length !== keys.length) Toon.#fail(row, `${cells.length} cells, expected ${keys.length}`);
          const o = {};
          keys.forEach((k, c) => {
            if(cells[c] !== '') o[k] = Toon.#prim(cells[c], row);
          });
          list.push(o);
        }
        return list;
      }
      if(rest !== undefined) {
        const list = Toon.#split(rest, line).map(c => Toon.#prim(c, line));
        if(list.length !== n) Toon.#fail(line, `${list.length} items, expected ${n}`);
        return list;
      }
      if(n === 0) return [];
      return Toon.#readList(ctx, line, depth + 1, n);
    }

    static #readList(ctx, head, depth, n) {
      const list = [];
      while(ctx.i < ctx.lines.length && ctx.lines[ctx.i].depth === depth && ctx.lines[ctx.i].text.startsWith('- ')) {
        const line = ctx.lines[ctx.i];
        const body = line.text.slice(2);
        const m = body.match(HEAD);
        if(!m) {
          ctx.i++;
          list.push(Toon.#prim(body, line));
          continue;
        }
        if(m[1] === undefined) {
          ctx.i++;
          list.push(Toon.#readValue(ctx, line, depth, m));
          continue;
        }
        // object item: first field shares the "- " line, the rest sit at depth + 1
        line.text = body;
        line.depth = depth + 1;
        list.push(Toon.#readObject(ctx, depth + 1));
      }
      if(list.length !== n) Toon.#fail(head, `${list.length} items, expected ${n}`);
      return list;
    }

    /** Splits on commas outside quotes, keeping quotes for #prim. */
    static #split(text, line) {
      const cells = [];
      let cur = '', quoted = false;
      for(let i = 0; i < text.length; i++) {
        const ch = text[i];
        if(quoted) {
          cur += ch;
          if(ch === '\\') cur += text[++i] ?? '';
          else if(ch === '"') quoted = false;
        }
        else if(ch === '"') { quoted = true; cur += ch; }
        else if(ch === ',') { cells.push(cur.trim()); cur = ''; }
        else cur += ch;
      }
      if(quoted) Toon.#fail(line, 'unclosed quote');
      cells.push(cur.trim());
      return cells;
    }

    static #prim(text, line) {
      const s = text.trim();
      if(s.startsWith('"')) return Toon.#unquote(s, line);
      if(s === 'true') return true;
      if(s === 'false') return false;
      if(s === 'null') return null;
      if(NUM.test(s)) return Number(s);
      return s;
    }

    static #unquote(s, line) {
      if(s.length < 2 || !s.endsWith('"')) Toon.#fail(line, `bad quoted string ${s}`);
      const map = { n: '\n', r: '\r', t: '\t' };
      return s.slice(1, -1).replace(/\\(.)/g, (_, c) => map[c] ?? c);
    }
    //#endregion
  }

  DAE.Toon = Toon;
});
