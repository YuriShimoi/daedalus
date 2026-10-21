// Board document: items on an infinite plane (strokes, shapes, text, notes, images, groups, widgets),
// edges between items and the assets they use (images, tool files, rendered audio). Saved as TOON.
// Coordinates are world units; every item keeps its box (x, y, w, h). Lines and arrows keep their
// end points (x1, y1, x2, y2) and an optional binding to an item at each end.
DAE_CORE(DAE => {
  const KINDS = ['stroke', 'shape', 'text', 'note', 'image', 'group', 'widget'];
  const BOXES = ['rect', 'ellipse', 'diamond', 'triangle', 'hexagon', 'parallelogram', 'star', 'cylinder', 'bubble'];
  const SHAPES = [...BOXES, 'line', 'arrow'];
  const COLORS = ['#FFFFFF', '#A3A3A3', '#FF79C6', '#BD93F9', '#8BE9FD', '#50FA7B', '#F1FA8C', '#FFB86C', '#FF5555'];
  const DARK = '#111111';   // border only: near black, so it reads on the dark board
  const DEFAULT_SIZE = { text: [160, 32], note: [240, 160], image: [240, 180], group: [400, 300], widget: [440, 330] };
  const num = (v, d) => (v === undefined || v === null || v === '' || isNaN(Number(v)) ? d : Number(v));

  class Board {
    static KINDS = KINDS;
    static SHAPES = SHAPES;
    static BOXES = BOXES;   // shapes drawn in a box (the shape tool)
    static COLORS = COLORS;
    static BORDERS = [DARK, ...COLORS];
    static border = DARK;   // border of new items (the page sets it from the context bar; '' = none)

    static create() {
      return { app: 'hestia', version: 1, view: { x: 0, y: 0, zoom: 1 }, items: [], edges: [], assets: [] };
    }

    //#region [ Items ]
    static nextId(list) {
      return list.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
    }

    static isLine(it) {
      return it.kind === 'shape' && (it.shape === 'line' || it.shape === 'arrow');
    }

    /** New item with defaults, on top of the others. */
    static item(b, kind, fields = {}) {
      const [w, h] = DEFAULT_SIZE[kind] ?? [120, 80];
      const it = { id: Board.nextId(b.items), kind, x: 0, y: 0, w, h, z: Board.top(b) + 1, locked: false, ...fields };
      if(it.border === undefined) it.border = Board.border;
      if(!it.border) delete it.border;
      if(Board.isLine(it)) Board.sync(it);
      return it;
    }

    static top(b) {
      return b.items.reduce((m, x) => Math.max(m, x.z), 0);
    }

    /** Draw order: groups under everything, then by z. */
    static ordered(b) {
      return [...b.items].sort((p, q) => (q.kind === 'group') - (p.kind === 'group') || p.z - q.z);
    }

    static find(b, id) {
      return b.items.find(x => x.id === id);
    }

    /** Middle point of a line: the one set by the user, or halfway. */
    static mid(it) {
      return it.mx != null ? { x: it.mx, y: it.my } : { x: (it.x1 + it.x2) / 2, y: (it.y1 + it.y2) / 2 };
    }

    /** Control point of a curved line, so the curve passes through its middle point. */
    static ctrl(it) {
      const m = Board.mid(it);
      return { x: 2 * m.x - (it.x1 + it.x2) / 2, y: 2 * m.y - (it.y1 + it.y2) / 2 };
    }

    /** Points along a line (for hit tests and its box): straight, sharp corner at the middle, or a sampled curve. */
    static linePoints(it) {
      const a = { x: it.x1, y: it.y1 }, b = { x: it.x2, y: it.y2 };
      if(it.mx == null) return [a, b];
      if(!it.curve) return [a, Board.mid(it), b];
      const c = Board.ctrl(it), out = [];
      for(let k = 0; k <= 24; k++) {
        const t = k / 24, u = 1 - t;
        out.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y });
      }
      return out;
    }

    /** Box of a line / arrow from its path. */
    static sync(it) {
      if(!Board.isLine(it)) return it;
      const pts = Board.linePoints(it), xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      it.x = Math.min(...xs);
      it.y = Math.min(...ys);
      it.w = Math.max(...xs) - it.x;
      it.h = Math.max(...ys) - it.y;
      return it;
    }

    static center(it) {
      return { x: it.x + it.w / 2, y: it.y + it.h / 2 };
    }

    /** Point where the segment from the item's center toward (px, py) leaves its box (or ellipse). */
    static anchor(it, px, py, gap = 6) {
      const c = Board.center(it), dx = px - c.x, dy = py - c.y;
      if(!dx && !dy) return c;
      const hw = it.w / 2 + gap, hh = it.h / 2 + gap;
      let t;
      if(it.kind === 'shape' && it.shape === 'ellipse') t = 1 / Math.sqrt((dx / hw) ** 2 + (dy / hh) ** 2);
      else if(it.kind === 'shape' && it.shape === 'diamond') t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
      else t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
      return { x: c.x + dx * Math.min(1, t), y: c.y + dy * Math.min(1, t) };
    }

    /** Moves the bound ends of lines and arrows onto their items (groups fit their members first). */
    static bind(b) {
      Board.fitGroups(b);
      for(const it of b.items) {
        if(!Board.isLine(it)) continue;
        const A = it.from && Board.find(b, it.from), B = it.to && Board.find(b, it.to);
        if(it.from && !A) it.from = null;
        if(it.to && !B) it.to = null;
        if(!A && !B) continue;
        // each bound end aims at the middle point when there is one, else at the other end
        const m = it.mx != null ? Board.mid(it) : null;
        const ta = m ?? (B ? Board.center(B) : { x: it.x2, y: it.y2 }), tb = m ?? (A ? Board.center(A) : { x: it.x1, y: it.y1 });
        if(A) { const p = Board.anchor(A, ta.x, ta.y); it.x1 = p.x; it.y1 = p.y; }
        if(B) { const p = Board.anchor(B, tb.x, tb.y); it.x2 = p.x; it.y2 = p.y; }
        Board.sync(it);
      }
    }

    static move(b, ids, dx, dy) {
      for(const id of ids) {
        const it = Board.find(b, id);
        if(!it || it.locked) continue;
        it.x += dx;
        it.y += dy;
        if(Board.isLine(it)) {
          it.x1 += dx; it.y1 += dy; it.x2 += dx; it.y2 += dy;
          if(it.mx != null) { it.mx += dx; it.my += dy; }
        }
      }
      Board.bind(b);
    }

    /** Sets an item's box; lines scale their end points into the new box. */
    static resize(it, x, y, w, h) {
      if(Board.isLine(it)) {
        const sx = it.w ? w / it.w : 1, sy = it.h ? h / it.h : 1;
        it.x1 = x + (it.x1 - it.x) * sx; it.x2 = x + (it.x2 - it.x) * sx;
        it.y1 = y + (it.y1 - it.y) * sy; it.y2 = y + (it.y2 - it.y) * sy;
        if(it.mx != null) { it.mx = x + (it.mx - it.x) * sx; it.my = y + (it.my - it.y) * sy; }
        return Board.sync(it);
      }
      Object.assign(it, { x, y, w: Math.max(8, w), h: Math.max(8, h) });
      return it;
    }

    /** A group's members (older boards without a member list: the items inside its box). */
    static inside(b, g) {
      if(Array.isArray(g.items)) return g.items.map(id => Board.find(b, id)).filter(Boolean);
      return b.items.filter(x => x !== g && x.x >= g.x && x.y >= g.y && x.x + x.w <= g.x + g.w && x.y + x.h <= g.y + g.h);
    }

    static GROUP_PAD = 24;
    static frozen = new Set();   // group ids that keep their box while their members are dragged

    /** Each group takes the box of its members plus a margin. */
    static fitGroups(b) {
      const P = Board.GROUP_PAD;
      for(const g of b.items) {
        if(g.kind !== 'group' || !Array.isArray(g.items) || Board.frozen.has(g.id)) continue;
        const box = Board.bounds(Board.inside(b, g));
        if(box) Object.assign(g, { x: box.x - P, y: box.y - P, w: box.w + P * 2, h: box.h + P * 2 });
      }
    }

    /** The group an item belongs to, or null. */
    static groupOf(b, id) {
      return b.items.find(g => g.kind === 'group' && g.items?.includes(id)) ?? null;
    }

    /** Moves an item into a group (or out of every group with gid = null). */
    static setGroup(b, id, gid) {
      for(const g of b.items) if(g.kind === 'group' && g.items) g.items = g.items.filter(x => x !== id);
      const g = gid && Board.find(b, gid);
      if(g) g.items.push(id);
    }

    /** New group around items (they leave their old groups). */
    static group(b, ids, fields = {}) {
      const list = ids.map(id => Board.find(b, id)).filter(it => it && it.kind !== 'group');
      for(const it of list) Board.setGroup(b, it.id, null);
      const g = Board.item(b, 'group', { label: 'Group', color: '#8BE9FD', border: '', ...fields, items: list.map(it => it.id), z: 0 });
      b.items.push(g);
      Board.prune(b);
      Board.fitGroups(b);
      return g;
    }

    /** Deletes groups left without members. */
    static prune(b) {
      for(const g of b.items) if(g.kind === 'group' && g.items) g.items = g.items.filter(id => Board.find(b, id));
      b.items = b.items.filter(g => g.kind !== 'group' || !g.items || g.items.length);
    }

    /** Deletes items, the edges that touch them and unused assets. */
    static remove(b, ids) {
      const set = new Set(ids);
      b.items = b.items.filter(x => !set.has(x.id));
      b.edges = b.edges.filter(e => !set.has(e.from) && !set.has(e.to));
      Board.prune(b);
      Board.bind(b);
      Board.gc(b);
    }

    /** Drops assets no item or note points to. */
    static gc(b) {
      const used = new Set();
      for(const it of b.items) {
        if(it.asset) used.add(it.asset);
        if(it.audio) used.add(it.audio);
        if(it.md) for(const m of it.md.matchAll(/asset:([\w-]+)/g)) used.add(m[1]);
      }
      b.assets = b.assets.filter(a => used.has(a.id));
    }

    static asset(b, id) {
      return b.assets.find(a => a.id === id);
    }

    /** Adds an asset (or returns the one with the same data). */
    static addAsset(b, { name, mime, data, source = '', samples = 0 }) {
      const same = b.assets.find(a => a.data === data);
      if(same) return same;
      const a = { id: 'a' + Board.nextId(b.assets.map(x => ({ id: Number(x.id.slice(1)) || 0 }))), name, mime, data, source };
      if(samples) a.samples = samples;   // exact length of rendered audio (frames)
      b.assets.push(a);
      return a;
    }
    //#endregion

    //#region [ Hit testing ]
    static distToSeg(px, py, x1, y1, x2, y2) {
      const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
      return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    }

    /** Is (px, py) on the item? `tol` in world units. Groups only hit on their label and border. */
    static hitItem(it, px, py, tol = 4) {
      if(px < it.x - tol || py < it.y - tol || px > it.x + it.w + tol || py > it.y + it.h + tol) return false;
      if(Board.isLine(it)) {
        const p = Board.linePoints(it);
        for(let k = 0; k + 1 < p.length; k++) if(Board.distToSeg(px, py, p[k].x, p[k].y, p[k + 1].x, p[k + 1].y) <= tol + (it.width ?? 2)) return true;
        return false;
      }
      if(it.kind === 'stroke') {
        const sx = it.vw ? it.w / it.vw : 1, sy = it.vh ? it.h / it.vh : 1, p = it.points;
        if(p.length < 4) return Math.hypot(px - it.x - p[0] * sx, py - it.y - p[1] * sy) <= tol + it.width;
        for(let i = 0; i + 3 < p.length; i += 2)
          if(Board.distToSeg(px, py, it.x + p[i] * sx, it.y + p[i + 1] * sy, it.x + p[i + 2] * sx, it.y + p[i + 3] * sy) <= tol + it.width) return true;
        return false;
      }
      if(it.kind === 'group') return py <= it.y + 28 || px <= it.x + tol || py >= it.y + it.h - tol || px >= it.x + it.w - tol;
      return true;
    }

    /** Topmost item at a point, or null. */
    static hit(b, px, py, tol = 4) {
      const list = Board.ordered(b);
      for(let i = list.length - 1; i >= 0; i--) if(Board.hitItem(list[i], px, py, tol)) return list[i];
      return null;
    }

    /** Items fully inside a rectangle. */
    static within(b, x, y, w, h) {
      return b.items.filter(it => it.x >= x && it.y >= y && it.x + it.w <= x + w && it.y + it.h <= y + h);
    }

    /** Box around items (null for none). */
    static bounds(items) {
      if(!items.length) return null;
      const x = Math.min(...items.map(i => i.x)), y = Math.min(...items.map(i => i.y));
      return { x, y, w: Math.max(...items.map(i => i.x + i.w)) - x, h: Math.max(...items.map(i => i.y + i.h)) - y };
    }
    //#endregion

    //#region [ Edges ]
    /** Middle of one side: top right bottom left. */
    static side(it, s) {
      const c = Board.center(it);
      return { top: { x: c.x, y: it.y }, right: { x: it.x + it.w, y: c.y }, bottom: { x: c.x, y: it.y + it.h }, left: { x: it.x, y: c.y } }[s];
    }

    /** The pair of sides that faces each other best. */
    static sides(a, b) {
      const ca = Board.center(a), cb = Board.center(b), dx = cb.x - ca.x, dy = cb.y - ca.y;
      if(Math.abs(dx) * a.h > Math.abs(dy) * a.w) return dx > 0 ? ['right', 'left'] : ['left', 'right'];
      return dy > 0 ? ['bottom', 'top'] : ['top', 'bottom'];
    }

    static edge(b, from, to, fields = {}) {
      const e = { id: Board.nextId(b.edges), from, to, label: '', color: '', ...fields };
      b.edges.push(e);
      return e;
    }
    //#endregion

    //#region [ Search ]
    static text(it) {
      return [it.text, it.md, it.label, it.name].filter(Boolean).join(' ');
    }

    /** Ids of items whose text holds `q` (case-insensitive), in reading order. */
    static search(b, q) {
      const s = String(q).trim().toLowerCase();
      if(!s) return [];
      const hits = b.items.filter(it => Board.text(it).toLowerCase().includes(s));
      hits.push(...b.edges.filter(e => e.label?.toLowerCase().includes(s)).map(e => Board.find(b, e.from)).filter(Boolean));
      return [...new Set(hits)].sort((p, q2) => p.y - q2.y || p.x - q2.x).map(it => it.id);
    }
    //#endregion

    //#region [ Files ]
    static stringify(b) {
      return DAE.Toon.encode(b);
    }

    static parse(text) {
      const t = text.trimStart();
      return Board.normalize(t.startsWith('{') ? JSON.parse(t) : DAE.Toon.decode(text));
    }

    /** Fills defaults and fixes types after decode; drops what can't be used. */
    static normalize(raw) {
      const b = Board.create();
      b.view = { x: num(raw?.view?.x, 0), y: num(raw?.view?.y, 0), zoom: Math.min(8, Math.max(0.05, num(raw?.view?.zoom, 1))) };
      b.assets = (raw?.assets ?? []).filter(a => a?.id && a.data).map(a => {
        const x = { id: String(a.id), name: String(a.name ?? ''), mime: String(a.mime ?? ''), data: String(a.data), source: String(a.source ?? '') };
        if(num(a.samples, 0)) x.samples = num(a.samples, 0);
        return x;
      });
      for(const r of raw?.items ?? []) {
        if(!KINDS.includes(r?.kind)) continue;
        const it = { ...r, id: num(r.id, Board.nextId(b.items)), x: num(r.x, 0), y: num(r.y, 0), w: num(r.w, 100), h: num(r.h, 100), z: num(r.z, 0), locked: r.locked === true || r.locked === 'true' };
        if(it.kind === 'shape') {
          if(!SHAPES.includes(it.shape)) it.shape = 'rect';
          if(Board.isLine(it)) {
            for(const k of ['x1', 'y1', 'x2', 'y2']) it[k] = num(r[k], 0);
            it.from = r.from ? num(r.from, null) : null;
            it.to = r.to ? num(r.to, null) : null;
            if(r.mx != null && r.mx !== '') { it.mx = num(r.mx, 0); it.my = num(r.my, 0); } else { delete it.mx; delete it.my; }
            if(r.curve === true || r.curve === 'true') it.curve = true; else delete it.curve;
            Board.sync(it);
          }
        }
        if(it.kind === 'stroke') it.points = (r.points ?? []).map(Number);
        if(it.kind === 'group' && r.items) it.items = [].concat(r.items).map(Number);
        for(const k of ['width', 'size', 'vw', 'vh']) if(r[k] !== undefined) it[k] = num(r[k], 1);
        b.items.push(it);
      }
      for(const g of b.items) if(g.kind === 'group' && !g.items) g.items = Board.inside(b, g).filter(x => x.kind !== 'group').map(x => x.id);
      Board.prune(b);
      const ids = new Set(b.items.map(x => x.id));
      b.edges = (raw?.edges ?? []).map(e => ({ id: num(e.id, 0), from: num(e.from, 0), to: num(e.to, 0), label: String(e.label ?? ''), color: String(e.color ?? '') }))
        .filter(e => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
      Board.bind(b);
      return b;
    }

    /** Copies another board's items, links and assets in (new ids), moved by (dx, dy). Returns the new ids. */
    static merge(b, src, dx = 0, dy = 0) {
      const amap = new Map(), imap = new Map(), added = [];
      for(const a of src.assets) amap.set(a.id, Board.addAsset(b, a).id);
      let z = Board.top(b);
      for(const s of Board.ordered(src)) {
        const it = JSON.parse(JSON.stringify(s));
        it.id = Board.nextId(b.items);
        it.z = it.kind === 'group' ? 0 : ++z;
        if(it.asset) it.asset = amap.get(it.asset) ?? it.asset;
        if(it.audio) it.audio = amap.get(it.audio) ?? null;
        if(it.md) it.md = it.md.replace(/asset:([\w-]+)/g, (m, id) => `asset:${amap.get(id) ?? id}`);
        imap.set(s.id, it.id);
        b.items.push(it);
        added.push(it);
      }
      for(const it of added) {
        if(Board.isLine(it)) { it.from = imap.get(it.from) ?? null; it.to = imap.get(it.to) ?? null; }
        if(it.kind === 'group') it.items = (it.items ?? []).map(id => imap.get(id)).filter(Boolean);
      }
      Board.move(b, added.map(i => i.id), dx, dy);
      for(const e of src.edges) if(imap.has(e.from) && imap.has(e.to)) Board.edge(b, imap.get(e.from), imap.get(e.to), { label: e.label, color: e.color });
      Board.prune(b);
      Board.bind(b);
      return added.map(i => i.id).filter(id => Board.find(b, id));
    }

    /** What a file is to Hestia: 'athena' / 'apollo' (widgets), 'board', 'canvas' (Obsidian) or null. */
    static widgetKind(name, mime = '', text = null) {
      if(/^audio\/|^video\/mp4/.test(mime) || /\.(wav|mp3|ogg|oga|opus|m4a|mp4|aac|flac|webm)$/i.test(name)) return 'apollo';
      if(text === null) return null;
      try {
        const t = text.trimStart(), doc = t.startsWith('{') ? JSON.parse(t) : DAE.Toon.decode(text);
        if(doc?.app === 'apollo') return 'apollo';
        if(doc?.rooms) return 'athena';
        if(doc?.app === 'hestia') return 'board';
        if(Array.isArray(doc?.nodes)) return 'canvas';
      } catch {}
      return null;
    }

    /** Short stable hash of a text (for render caches). */
    static hash(text) {
      return DAE.Rng.hash(text).toString(36) + '-' + String(text).length.toString(36);
    }
    //#endregion
  }

  DAE.Board = Board;
});
