// Obsidian <-> Hestia. Reads JSON Canvas files (.canvas: text, file, link and group nodes, edges)
// and whole vaults (one note card per .md, a group per folder, [[wikilinks]] as links), and writes a
// board back as a .canvas. Vault files are read through a callback, so the same code runs in Node
// (CLI) and in the page (dropped files).
DAE_CORE(DAE => {
  const PRESET = { 1: '#FF5555', 2: '#FFB86C', 3: '#F1FA8C', 4: '#50FA7B', 5: '#8BE9FD', 6: '#BD93F9' };
  const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
  const AUDIO = /\.(wav|mp3|ogg|oga|opus|m4a|mp4|aac|flac|webm)$/i;
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
    wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4', mp4: 'video/mp4', aac: 'audio/aac', flac: 'audio/flac', webm: 'audio/webm',
    md: 'text/markdown', toon: 'text/toon', json: 'application/json', canvas: 'application/json' };
  const num = (v, d = 0) => (isNaN(Number(v)) ? d : Number(v));
  const base = p => String(p).split('/').pop();
  const stem = p => base(p).replace(/\.[^.]+$/, '');

  class Obsidian {
    static PRESET = PRESET;

    static mime(name) {
      return MIME[String(name).split('.').pop().toLowerCase()] ?? 'application/octet-stream';
    }

    static b64(bytes) {
      if(typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
      let s = '';
      for(let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(s);
    }

    static text(bytes) {
      return new TextDecoder().decode(bytes);
    }

    /** Obsidian color ("1".."6" or "#rrggbb") -> Dracula hex, '' for none. */
    static color(c) {
      if(c === undefined || c === null || c === '') return '';
      return PRESET[c] ?? (/^#[0-9a-f]{3,8}$/i.test(c) ? c.toUpperCase() : '');
    }

    /** Hex -> Obsidian preset number when it is one, else the hex. */
    static presetOf(hex) {
      const k = Object.keys(PRESET).find(n => PRESET[n].toLowerCase() === String(hex).toLowerCase());
      return k ?? (hex || undefined);
    }

    //#region [ Markdown ]
    /**
     * Obsidian Markdown -> Hestia Markdown: ![[image]] become embedded assets, ![[note]] a quote line,
     * [[target|alias]] plain bold text. `links` collects the wikilink targets.
     */
    static md(text, b, read, links = []) {
      return String(text ?? '')
        .replace(/!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g, (all, target) => {
          const t = target.trim();
          if(IMAGE.test(t)) {
            const bytes = read(t);
            if(bytes) {
              const a = DAE.Board.addAsset(b, { name: base(t), mime: Obsidian.mime(t), data: Obsidian.b64(bytes) });
              return `![${stem(t)}](asset:${a.id})`;
            }
            return `*(missing image: ${t})*`;
          }
          links.push(t);
          return `> ↪ ${stem(t)}`;
        })
        .replace(/\[\[([^\]|#]+)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]/g, (all, target, sub, alias) => {
          links.push(target.trim());
          return `**${(alias ?? (sub ? `${stem(target)} › ${sub}` : stem(target))).trim()}**`;
        })
        .replace(/^---\n[\s\S]*?\n---\n?/, '');   // front matter
    }
    //#endregion

    //#region [ Canvas -> board ]
    /**
     * @param {string|object} src - .canvas text or parsed JSON
     * @param {object} o - read(path): vault file bytes (Uint8Array) or null
     */
    static fromCanvas(src, { read = () => null } = {}) {
      const B = DAE.Board, c = typeof src === 'string' ? JSON.parse(src) : src, b = B.create();
      const ids = new Map(), groups = [];
      const nodes = [...(c.nodes ?? [])].sort((p, q) => (q.type === 'group') - (p.type === 'group'));
      for(const n of nodes) {
        const box = { x: num(n.x), y: num(n.y), w: Math.max(40, num(n.width, 250)), h: Math.max(30, num(n.height, 60)) }, col = Obsidian.color(n.color);
        let it;
        if(n.type === 'group') {
          it = B.item(b, 'group', { ...box, label: n.label || 'Group', color: col || '#8BE9FD', border: '', items: [], z: 0 });
          groups.push(it);
        }
        else if(n.type === 'text') it = B.item(b, 'note', { ...box, md: Obsidian.md(n.text, b, read), ...(col ? { color: col } : {}) });
        else if(n.type === 'link') it = B.item(b, 'note', { ...box, md: `[${n.url}](${n.url})`, ...(col ? { color: col } : {}) });
        else if(n.type === 'file') it = Obsidian.#file(b, n.file, box, col, read);
        if(!it) continue;
        b.items.push(it);
        ids.set(n.id, it.id);
      }
      // a node belongs to the smallest group around its center (Obsidian groups are geometric)
      for(const it of b.items) {
        if(it.kind === 'group') continue;
        const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
        const g = groups.filter(g => cx >= g.x && cx <= g.x + g.w && cy >= g.y && cy <= g.y + g.h).sort((p, q) => p.w * p.h - q.w * q.h)[0];
        if(g) g.items.push(it.id);
      }
      for(const e of c.edges ?? []) {
        const from = ids.get(e.fromNode), to = ids.get(e.toNode);
        if(from && to && from !== to) B.edge(b, from, to, { label: e.label ?? '', color: Obsidian.color(e.color) });
      }
      B.prune(b);
      B.bind(b);
      const all = B.bounds(b.items);
      if(all) b.view = { x: all.x - 60, y: all.y - 60, zoom: 1 };
      return b;
    }

    /** A file node: image, note (.md), tool widget (.toon / audio) or a placeholder note. */
    static #file(b, path, box, col, read) {
      const B = DAE.Board, bytes = read(path), name = base(path), tint = col ? { color: col } : {};
      if(!bytes) return B.item(b, 'note', { ...box, md: `📄 **${name}**\n\n*(not found in the vault)*`, ...tint });
      if(IMAGE.test(name)) {
        const a = B.addAsset(b, { name, mime: Obsidian.mime(name), data: Obsidian.b64(bytes) });
        return B.item(b, 'image', { ...box, asset: a.id, name });
      }
      if(/\.md$/i.test(name)) {
        const body = Obsidian.md(Obsidian.text(bytes), b, read);
        return B.item(b, 'note', { ...box, md: /^\s*# /.test(body) ? body : `# ${stem(name)}\n\n${body}`, ...tint });
      }
      const isText = /\.(toon|json)$/i.test(name), kind = B.widgetKind(name, Obsidian.mime(name), isText ? Obsidian.text(bytes) : null);
      if(kind === 'athena' || kind === 'apollo') {
        const a = B.addAsset(b, { name, mime: isText ? 'text/toon' : Obsidian.mime(name), data: Obsidian.b64(bytes) });
        return B.item(b, 'widget', { ...box, tool: kind, asset: a.id, name, audio: null, ...(kind === 'apollo' ? { fit: true } : {}) });
      }
      return B.item(b, 'note', { ...box, md: `📄 **${name}**`, ...tint });
    }
    //#endregion

    //#region [ Vault -> board ]
    /**
     * A board of a whole vault: one note card per .md (grouped by folder), links from [[wikilinks]].
     * @param {Array<{path: string, text: string}>} notes - vault-relative paths
     * @param {object} o - read(path or file name): bytes of any vault file (embedded images); name: label of the root folder
     */
    static fromVault(notes, { read = () => null, columns = 4, name = 'vault' } = {}) {
      const B = DAE.Board, b = B.create(), byName = new Map(), cards = [];
      const folders = new Map();
      for(const n of [...notes].sort((p, q) => p.path.localeCompare(q.path))) {
        const dir = n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : '';
        if(!folders.has(dir)) folders.set(dir, []);
        folders.get(dir).push(n);
      }
      const W = 300, GAP = 40, ROW_MAX = 4200;
      let gx = 0, gy = 0, rowH = 0;
      for(const [dir, list] of folders) {
        const placed = [], heights = [];
        list.forEach((n, i) => {
          const links = [], body = Obsidian.md(n.text, b, read, links);
          const md = /^\s*# /.test(body) ? body : `# ${stem(n.path)}\n\n${body}`;
          const h = Math.min(380, Math.max(120, 60 + md.split('\n').length * 20));
          const it = B.item(b, 'note', { md, w: W, h });
          b.items.push(it);
          placed.push(it);
          heights.push(h);
          cards.push({ it, links });
          byName.set(stem(n.path).toLowerCase(), it.id);
          byName.set(n.path.replace(/\.md$/i, '').toLowerCase(), it.id);
        });
        // grid inside the folder: columns of cards, each row as tall as its tallest card
        const cols = Math.min(columns, placed.length), rows = Math.ceil(placed.length / cols);
        let y = gy + 40;
        for(let r = 0; r < rows; r++) {
          const row = placed.slice(r * cols, r * cols + cols), h = Math.max(...row.map(i => i.h));
          row.forEach((it, k) => Object.assign(it, { x: gx + 24 + k * (W + GAP), y }));
          y += h + GAP;
        }
        const fw = cols * (W + GAP) - GAP + 48, fh = y - gy;
        if(dir || folders.size > 1) b.items.push(B.item(b, 'group', { label: dir || name, color: '#8BE9FD', border: '', items: placed.map(i => i.id), z: 0 }));
        gx += fw + 120;
        rowH = Math.max(rowH, fh);
        if(gx > ROW_MAX) { gx = 0; gy += rowH + 140; rowH = 0; }
      }
      for(const { it, links } of cards) {
        for(const t of new Set(links)) {
          const to = byName.get(t.replace(/\.md$/i, '').toLowerCase()) ?? byName.get(stem(t).toLowerCase());
          if(to && to !== it.id && !b.edges.some(e => e.from === it.id && e.to === to)) B.edge(b, it.id, to);
        }
      }
      B.bind(b);
      const all = B.bounds(b.items);
      if(all) b.view = { x: all.x - 60, y: all.y - 60, zoom: 0.6 };
      return b;
    }
    //#endregion

    //#region [ Board -> canvas ]
    /**
     * A JSON Canvas of the board. Images and widget files are written next to it (in `dir`), lines
     * bound at both ends become edges; free strokes and lines have no Obsidian equivalent and are left out.
     * @returns {{ canvas: object, files: Array<{path: string, bytes: Uint8Array}>, skipped: number }}
     */
    static toCanvas(b, { dir = 'hestia-files', unb64 }) {
      const B = DAE.Board, nodes = [], edges = [], files = [], used = new Set();
      let skipped = 0;
      const id = it => `h${it.id}`;
      const done = new Map();   // asset id -> written path (one file per asset)
      const fileOf = a => {
        if(done.has(a.id)) return done.get(a.id);
        const orig = a.name || `${a.id}.bin`;
        let name = orig;
        for(let k = 2; used.has(name.toLowerCase()); k++) name = orig.replace(/(\.[^.]+)?$/, `-${k}$1`);
        used.add(name.toLowerCase());
        files.push({ path: `${dir}/${name}`, bytes: unb64(a.data) });
        done.set(a.id, `${dir}/${name}`);
        return done.get(a.id);
      };
      for(const it of B.ordered(b)) {
        const box = { id: id(it), x: Math.round(it.x), y: Math.round(it.y), width: Math.round(it.w), height: Math.round(it.h) };
        const color = it.color && it.kind !== 'text' && it.kind !== 'shape' ? Obsidian.presetOf(it.color) : undefined;
        if(it.kind === 'group') nodes.push({ ...box, type: 'group', label: it.label, ...(color ? { color } : {}) });
        else if(it.kind === 'note') nodes.push({ ...box, type: 'text', text: String(it.md ?? '').replace(/!\[([^\]]*)\]\(asset:([\w-]+)\)/g, (all, alt, aid) => { const a = B.asset(b, aid); return a ? `![[${fileOf(a)}]]` : ''; }), ...(color ? { color } : {}) });
        else if(it.kind === 'text') nodes.push({ ...box, type: 'text', text: it.text ?? '' });
        else if(it.kind === 'shape' && !B.isLine(it)) nodes.push({ ...box, type: 'text', text: it.text || ' ', color: Obsidian.presetOf(it.color === '#FFFFFF' ? '' : it.color) });
        else if((it.kind === 'image' || it.kind === 'widget') && B.asset(b, it.asset)) nodes.push({ ...box, type: 'file', file: fileOf(B.asset(b, it.asset)) });
        else if(B.isLine(it) && it.from && it.to) edges.push({ id: `l${it.id}`, fromNode: `h${it.from}`, toNode: `h${it.to}`, toEnd: it.shape === 'arrow' ? 'arrow' : 'none' });
        else skipped++;
      }
      for(const e of b.edges) edges.push({ id: `e${e.id}`, fromNode: `h${e.from}`, toNode: `h${e.to}`, ...(e.label ? { label: e.label } : {}), ...(e.color ? { color: Obsidian.presetOf(e.color) } : {}) });
      for(const n of nodes) if(n.color === undefined) delete n.color;
      return { canvas: { nodes, edges }, files, skipped };
    }
    //#endregion
  }

  DAE.Obsidian = Obsidian;
});
