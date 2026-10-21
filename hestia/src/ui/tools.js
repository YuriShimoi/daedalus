// Pointer work on the board: pan / zoom, select (click, shift, marquee), move, resize, line ends,
// side-dot links, drawing tools (pen, shapes, lines, text, note, image, widget) and text editing.
class Tools {
  static TOOLS = [
    // [id, icon, key, label]
    ['select', 'arrow-pointer', 'V', 'Select'], ['hand', 'hand', 'H', 'Hand (or hold Space)'], null,
    ['pen', 'pen', 'P', 'Pen'], ['shape', 'square', 'R', 'Shape (pick it in the bar above: rectangle, ellipse, diamond, triangle, hexagon, parallelogram, star, cylinder, speech bubble)'],
    ['line', 'minus', 'L', 'Line'], ['arrow', 'arrow-right', 'A', 'Arrow'], ['text', 'font', 'T', 'Text'], null,
    ['note', 'note-sticky', 'N', 'Note card (Markdown)'], ['image', 'image', 'I', 'Image'],
    ['widget', 'window-maximize', 'W', 'Widget: Athena map, Apollo song or any audio file'],
  ];

  static drag = null;
  static space = false;

  static init($b) {
    $b.addEventListener('pointerdown', Tools.#down);
    addEventListener('pointermove', Tools.#move);
    addEventListener('pointerup', Tools.#up);
    $b.addEventListener('wheel', Tools.#wheel, { passive: false });
    $b.addEventListener('dblclick', Tools.#dbl);
    $b.addEventListener('contextmenu', Tools.#context);
    $b.addEventListener('focusout', e => { if(e.target.classList?.contains('editor')) Tools.commit(e.target.value); });
    $b.addEventListener('keydown', e => {
      if(!e.target.classList?.contains('editor')) return;
      if(e.key === 'Escape' || (e.key === 'Enter' && e.ctrlKey)) { e.preventDefault(); Tools.commit(e.target.value); App.$board.focus({ preventScroll: true }); }
      e.stopPropagation();
    });
  }

  static set(tool) {
    if(tool !== 'select' && tool !== 'hand' && tool !== App.tool) { App.sel.clear(); App.edgeSel = 0; App.render(); }   // drawing tools start fresh
    App.tool = tool;
    App.$board.classList.toggle('pan', tool === 'hand');
    App.$board.classList.toggle('draw', !['select', 'hand'].includes(tool));
    Panels.update();
  }

  static #tol() {
    return 6 / App.view.zoom;
  }

  /** Item under a client point (precise for strokes and lines), skipping `except`. */
  static itemAt(cx, cy, except = null) {
    const w = App.toWorld(cx, cy), list = Board.ordered(App.b);
    for(let i = list.length - 1; i >= 0; i--) if(list[i] !== except && Board.hitItem(list[i], w.x, w.y, Tools.#tol())) return list[i];
    return null;
  }

  //#region [ Down ]
  static #down = e => {
    DAE.Menu.close();
    const t = e.target, w = App.toWorld(e.clientX, e.clientY);
    if(t.closest('.editor') || e.button === 2) return;
    const $ed = App.editing && document.querySelector('#items .editor');
    if($ed) Tools.commit($ed.value);
    if(e.button === 1 || (e.button === 0 && (Tools.space || App.tool === 'hand'))) {
      e.preventDefault();
      Tools.drag = { kind: 'pan', x: e.clientX, y: e.clientY };
      App.$board.classList.add('panning');
      return;
    }
    if(e.button !== 0) return;
    App.$board.focus({ preventScroll: true });
    const $box = t.closest('.md input[type=checkbox]');
    if($box) {
      e.preventDefault();
      const it = Board.find(App.b, Number(t.closest('.it').dataset.id));
      App.change(() => { it.md = DAE.Markdown.toggleTask(it.md, Number($box.dataset.line)); });
      return;
    }
    if(t.closest('a[href]') && t.closest('.md')) return;
    if(App.tool === 'select' && t.closest('.win-body')) return;   // the widget handles its own clicks

    switch(App.tool) {
      case 'select': return Tools.#downSelect(e, t, w);
      case 'pen': {
        App.begin();
        const it = Board.item(App.b, 'stroke', { color: App.style.color, border: '', width: App.style.width * 1.5, points: [], abs: [w.x, w.y] });
        App.b.items.push(it);
        Tools.#strokeBox(it);
        Tools.drag = { kind: 'pen', it };
        App.render();
        return;
      }
      case 'shape': {
        App.begin();
        const it = Board.item(App.b, 'shape', { shape: App.style.shape, x: w.x, y: w.y, w: 1, h: 1, color: App.style.color, border: App.style.border, fill: App.style.fill, width: App.style.width, size: App.style.size, text: '' });
        App.b.items.push(it);
        Tools.drag = { kind: 'shape', it, sx: w.x, sy: w.y };
        App.render();
        return;
      }
      case 'line': case 'arrow': {
        App.begin();
        const from = e.altKey ? null : Tools.itemAt(e.clientX, e.clientY);   // Alt: the end stays free
        const it = Board.item(App.b, 'shape', { shape: App.tool, x1: w.x, y1: w.y, x2: w.x, y2: w.y, color: App.style.color, border: '', width: App.style.width,
          from: from && !Board.isLine(from) ? from.id : null, to: null });
        App.b.items.push(it);
        Tools.drag = { kind: 'line', it, sx: e.clientX, sy: e.clientY };
        App.render();
        return;
      }
      case 'text': e.preventDefault(); return Tools.newText(w);   // no default focus: it would close the new editor
      case 'note': e.preventDefault(); return Tools.newNote(w);
      case 'image': Tools.set('select'); return Files.pick('image', w);
      case 'widget': Tools.set('select'); return Files.pick('widget', w);
    }
  };

  static #downSelect(e, t, w) {
    if(t.dataset.hd || t.dataset.grip) {
      const it = t.dataset.grip ? Board.find(App.b, Number(t.closest('.it').dataset.id)) : App.one;
      if(!it || it.locked) return;
      Tools.drag = { kind: 'resize', it, hd: t.dataset.hd ?? 'se', o: { x: it.x, y: it.y, w: it.w, h: it.h, size: it.size }, sx: w.x, sy: w.y, started: false };
      return;
    }
    if(t.dataset.mid) {
      Tools.drag = { kind: 'mid', it: App.one, started: false };
      return;
    }
    if(t.dataset.end) {
      Tools.drag = { kind: 'end', it: App.one, end: t.dataset.end, started: false };
      return;
    }
    if(t.dataset.dot) {
      Tools.drag = { kind: 'link', it: App.one, side: t.dataset.dot, x: w.x, y: w.y };
      return;
    }
    const $edge = t.closest('[data-edge]');
    if($edge) {
      App.sel.clear();
      App.edgeSel = Number($edge.dataset.edge);
      App.render();
      return;
    }
    const it = Tools.itemAt(e.clientX, e.clientY);
    if(it) {
      if(e.shiftKey) { App.sel.has(it.id) ? App.sel.delete(it.id) : App.sel.add(it.id); App.edgeSel = 0; App.render(); return; }
      if(!App.sel.has(it.id)) App.select([it.id]);
      // moving a group takes its members
      const ids = new Set(App.selected.filter(x => !x.locked).map(x => x.id));
      for(const g of App.selected.filter(x => x.kind === 'group' && !x.locked)) for(const x of Board.inside(App.b, g)) if(!x.locked) ids.add(x.id);
      const moving = [...ids].map(id => Board.find(App.b, id));
      Tools.drag = { kind: 'move', ids: [...ids], sx: w.x, sy: w.y, cx: e.clientX, cy: e.clientY, started: false, box: Board.bounds(moving), done: { x: 0, y: 0 } };
      return;
    }
    if(!e.shiftKey) { App.sel.clear(); App.edgeSel = 0; App.render(); }
    Tools.drag = { kind: 'marquee', cx: e.clientX, cy: e.clientY, add: e.shiftKey };
  }
  //#endregion

  //#region [ Move ]
  static #move = e => {
    const d = Tools.drag;
    if(!d) return;
    const w = App.toWorld(e.clientX, e.clientY), v = App.view;
    switch(d.kind) {
      case 'pan':
        v.x -= (e.clientX - d.x) / v.zoom;
        v.y -= (e.clientY - d.y) / v.zoom;
        d.x = e.clientX; d.y = e.clientY;
        Render.view();
        return;
      case 'move': {
        if(!d.started) {
          if(Math.hypot(e.clientX - d.cx, e.clientY - d.cy) < 3) return;
          d.started = true;
          App.begin();
          // groups whose members are dragged (without the group) keep their box until the drop
          for(const id of d.ids) { const g = Board.groupOf(App.b, id); if(g && !d.ids.includes(g.id)) Board.frozen.add(g.id); }
        }
        // snaps to other items' edges and centers, else to the dot grid; Alt moves freely
        const raw = { x: w.x - d.sx, y: w.y - d.sy }, s = e.altKey ? { off: raw, guides: [] } : Tools.snap(d, raw);
        Board.move(App.b, d.ids, s.off.x - d.done.x, s.off.y - d.done.y);
        d.done = s.off;
        App.render();
        Tools.#guides(s.guides);
        return;
      }
      case 'resize': {
        if(!d.started) { d.started = true; App.begin(); }
        const guides = Tools.#resize(d, w, e.shiftKey, !e.altKey);
        App.render();
        Tools.#guides(guides);
        return;
      }
      case 'mid': {
        if(!d.started) { d.started = true; App.begin(); }
        Object.assign(d.it, { mx: w.x, my: w.y });
        Board.bind(App.b);
        Board.sync(d.it);
        App.render();
        return;
      }
      case 'end': {
        if(!d.started) { d.started = true; App.begin(); }
        const k = d.end;
        d.it[`x${k}`] = w.x;
        d.it[`y${k}`] = w.y;
        d.it[k === '1' ? 'from' : 'to'] = null;
        Board.sync(d.it);
        App.render();
        return;
      }
      case 'link': {
        d.x = w.x; d.y = w.y;
        Render.overlay();
        const p = Board.side(d.it, d.side);
        document.getElementById('overlay').insertAdjacentHTML('beforeend',
          `<svg style="position:absolute;left:0;top:0;overflow:visible"><path d="M${p.x} ${p.y}L${w.x} ${w.y}" stroke="#8BE9FD" stroke-width="${2 / v.zoom}" stroke-dasharray="${6 / v.zoom}"/></svg>`);
        return;
      }
      case 'marquee': {
        const r = App.$board.getBoundingClientRect(), $m = document.getElementById('marquee');
        Object.assign($m.style, { display: 'block', left: `${Math.min(d.cx, e.clientX) - r.left}px`, top: `${Math.min(d.cy, e.clientY) - r.top}px`,
          width: `${Math.abs(e.clientX - d.cx)}px`, height: `${Math.abs(e.clientY - d.cy)}px` });
        d.ex = e.clientX; d.ey = e.clientY;
        return;
      }
      case 'pen': {
        const a = d.it.abs, lx = a[a.length - 2], ly = a[a.length - 1];
        if(Math.hypot(w.x - lx, w.y - ly) < 2 / v.zoom) return;
        a.push(w.x, w.y);
        Tools.#strokeBox(d.it);
        App.render();
        return;
      }
      case 'shape': {
        let dx = w.x - d.sx, dy = w.y - d.sy;
        if(e.shiftKey) { const m = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * m; dy = Math.sign(dy || 1) * m; }
        Object.assign(d.it, { x: Math.min(d.sx, d.sx + dx), y: Math.min(d.sy, d.sy + dy), w: Math.max(1, Math.abs(dx)), h: Math.max(1, Math.abs(dy)) });
        App.render();
        return;
      }
      case 'line': {
        let x = w.x, y = w.y;
        if(e.shiftKey) {
          const ang = Math.round(Math.atan2(y - d.it.y1, x - d.it.x1) / (Math.PI / 12)) * Math.PI / 12, len = Math.hypot(x - d.it.x1, y - d.it.y1);
          x = d.it.x1 + Math.cos(ang) * len; y = d.it.y1 + Math.sin(ang) * len;
        }
        Object.assign(d.it, { x2: x, y2: y });
        Board.sync(d.it);
        App.render();
        return;
      }
    }
  };

  /** After a move: an item dropped inside a group's frame joins it, dropped outside its own group leaves it. */
  static #regroup(d) {
    const b = App.b, moved = new Set(d.ids);
    for(const id of d.ids) {
      const it = Board.find(b, id);
      if(!it || it.kind === 'group') continue;
      const cur = Board.groupOf(b, id);
      if(cur && moved.has(cur.id)) continue;   // it moved with its group
      const c = Board.center(it);
      const target = Board.ordered(b).filter(g => g.kind === 'group' && !moved.has(g.id) && c.x >= g.x && c.x <= g.x + g.w && c.y >= g.y && c.y <= g.y + g.h).pop() ?? null;
      if(target !== cur) Board.setGroup(b, id, target?.id ?? null);
    }
    Board.frozen.clear();
    Board.prune(b);
  }

  static GRID = 24;

  /** Offset for a moved box: { off, guides }. Per axis: nearest edge / center of another item, else the grid. */
  /** Snap targets: every box item except the moved ones (shared/snap.js). */
  static #targets(skip) {
    return App.b.items.filter(i => !skip.has(i.id) && i.kind !== 'stroke' && !Board.isLine(i));
  }

  static snap(d, raw) {
    return DAE.Snap.move(d.box, raw, Tools.#targets(new Set(d.ids)), { tol: 7 / App.view.zoom, grid: Tools.GRID });
  }

  static #guides(list) {
    if(!list.length) return;
    document.getElementById('overlay').insertAdjacentHTML('beforeend', list.map(g => g.ax === 'x'
      ? `<i class="guide" style="left:${g.at}px;top:${g.lo}px;height:${g.hi - g.lo}px"></i>`
      : `<i class="guide h" style="left:${g.lo}px;top:${g.at}px;width:${g.hi - g.lo}px"></i>`).join(''));
  }

  /** Snaps one coordinate (a dragged edge) to another item's edge / center, else to the grid: { v, guide }. */
  static #snapTo(v, ax, self, box) {
    return DAE.Snap.value(v, ax, Tools.#targets(new Set([self.id])), box, { tol: 7 / App.view.zoom, grid: Tools.GRID });
  }

  /** Resizes from a handle; the dragged edges follow the snapping rules. Returns the guides to draw. */
  static #resize(d, w, shift, snap = true) {
    const { o, hd, it } = d, dx = w.x - d.sx, dy = w.y - d.sy, guides = [];
    let { x, y, w: W, h: H } = o;
    const edge = (v, ax) => {
      if(!snap) return v;
      const s = Tools.#snapTo(v, ax, it, { x, y, w: W, h: H });
      if(s.guide) guides.push(s.guide);
      return s.v;
    };
    if(hd.includes('e')) W = edge(o.x + o.w + dx, 'x') - o.x;
    if(hd.includes('s')) H = edge(o.y + o.h + dy, 'y') - o.y;
    if(hd.includes('w')) { x = edge(o.x + dx, 'x'); W = o.x + o.w - x; }
    if(hd.includes('n')) { y = edge(o.y + dy, 'y'); H = o.y + o.h - y; }
    const keep = (it.kind === 'image' || it.kind === 'text') !== shift;
    if(keep && hd.length === 2) {
      const r = o.w / o.h;
      if(W / H > r) W = H * r; else H = W / r;
      if(hd.includes('w')) x = o.x + o.w - W;
      if(hd.includes('n')) y = o.y + o.h - H;
    }
    W = Math.max(12, W); H = Math.max(12, H);
    if(it.kind === 'text') { it.size = Math.max(6, Math.round(o.size * H / o.h)); Object.assign(it, { x, y }); return guides; }
    if(it.kind === 'widget') { W = Math.max(220, W); H = Math.max(110, H); }
    Board.resize(it, x, y, W, H);
    return guides;
  }

  /** Stroke box + relative points from the absolute ones being drawn. */
  static #strokeBox(it) {
    const a = it.abs, xs = a.filter((_, i) => i % 2 === 0), ys = a.filter((_, i) => i % 2 === 1);
    const x = Math.min(...xs), y = Math.min(...ys);
    Object.assign(it, { x, y, w: Math.max(1, Math.max(...xs) - x), h: Math.max(1, Math.max(...ys) - y) });
    it.vw = it.w; it.vh = it.h;
    it.points = a.map((p, i) => Math.round((p - (i % 2 ? y : x)) * 10) / 10);
  }
  //#endregion

  //#region [ Up ]
  static #up = e => {
    const d = Tools.drag;
    if(!d) return;
    Tools.drag = null;
    App.$board.classList.remove('panning');
    switch(d.kind) {
      case 'pan':
        Files.autosave();
        return;
      case 'move':
        if(d.started) { Tools.#regroup(d); App.after(); }
        return;
      case 'resize':
        if(d.started) App.after();
        return;
      case 'end': {
        if(!d.started) return;
        const hit = e.altKey ? null : Tools.itemAt(e.clientX, e.clientY, d.it);   // Alt: the end stays free
        if(hit && !Board.isLine(hit)) d.it[d.end === '1' ? 'from' : 'to'] = hit.id;
        App.after();
        return;
      }
      case 'mid':
        if(d.started) App.after();
        return;
      case 'link': {
        const hit = Tools.itemAt(e.clientX, e.clientY, d.it);
        if(hit && hit !== d.it) App.change(b => { if(!b.edges.some(x => x.from === d.it.id && x.to === hit.id)) Board.edge(b, d.it.id, hit.id); });
        else if(!hit) {
          // dropped on empty board: a new note, linked (as Obsidian canvas does)
          App.change(b => {
            const n = Board.item(b, 'note', { md: '' });
            Object.assign(n, { x: d.x - n.w / 2, y: d.y - n.h / 2 });
            b.items.push(n);
            Board.edge(b, d.it.id, n.id);
            App.sel = new Set([n.id]);
            App.editing = n.id;
          });
        }
        else Render.overlay();
        return;
      }
      case 'marquee': {
        document.getElementById('marquee').style.display = 'none';
        if(d.ex === undefined) return;
        const a = App.toWorld(Math.min(d.cx, d.ex), Math.min(d.cy, d.ey)), b = App.toWorld(Math.max(d.cx, d.ex), Math.max(d.cy, d.ey));
        App.select(Board.within(App.b, a.x, a.y, b.x - a.x, b.y - a.y).map(i => i.id), d.add);
        return;
      }
      case 'pen':
        delete d.it.abs;
        App.after();
        return;
      case 'shape': {
        const it = d.it;
        if(it.w < 4 && it.h < 4) Object.assign(it, it.kind === 'group' ? { w: 400, h: 300 } : { x: it.x - 60, y: it.y - 40, w: 120, h: 80 });
        App.sel = new Set([it.id]);
        Tools.set('select');
        App.after();
        return;
      }
      case 'line': {
        const it = d.it;
        if(Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) Object.assign(it, { x2: it.x1 + 140, y2: it.y1 });
        const hit = e.altKey ? null : Tools.itemAt(e.clientX, e.clientY, it);
        if(hit && hit.id !== it.from && !Board.isLine(hit)) it.to = hit.id;
        Board.bind(App.b);
        Board.sync(it);
        App.sel = new Set([it.id]);
        Tools.set('select');
        App.after();
        return;
      }
    }
  };
  //#endregion

  //#region [ Wheel, double click, menu ]
  static #wheel = e => {
    if(!e.ctrlKey && e.target.closest('.win-body')) return;   // widgets scroll / zoom their own content
    if(e.target.closest('.md') && !e.ctrlKey) {
      const $md = e.target.closest('.md');
      if($md.scrollHeight > $md.clientHeight) return;   // a long note scrolls first
    }
    e.preventDefault();
    if(e.ctrlKey || e.metaKey) App.zoomAt(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0018)), e.clientX, e.clientY);
    else {
      const k = e.deltaMode ? 30 : 1, v = App.view;
      v.x += (e.shiftKey ? e.deltaY : e.deltaX) * k / v.zoom;
      v.y += (e.shiftKey ? 0 : e.deltaY) * k / v.zoom;
      Render.view();
    }
    Tools.#saveView();
  };

  static #viewTimer = 0;
  static #saveView() {
    clearTimeout(Tools.#viewTimer);
    Tools.#viewTimer = setTimeout(() => Files.autosave(), 600);
  }

  static #dbl = e => {
    if(App.tool !== 'select' || e.target.closest('.win-body') || e.target.closest('.editor')) return;
    if(e.target.dataset?.mid && App.one) { const it = App.one; return App.change(() => { delete it.mx; delete it.my; delete it.curve; }); }
    const $edge = e.target.closest('[data-edge]');
    if($edge) return Tools.editEdge(Number($edge.dataset.edge));
    const it = Tools.itemAt(e.clientX, e.clientY);
    if(it?.kind === 'group') return Tools.editGroup(it);
    if(it && !it.locked && (['text', 'note'].includes(it.kind) || (it.kind === 'shape' && !Board.isLine(it)))) return Tools.edit(it);
    if(!it) Tools.newText(App.toWorld(e.clientX, e.clientY));
  };

  static #context = e => {
    e.preventDefault();
    const $edge = e.target.closest('[data-edge]'), w = App.toWorld(e.clientX, e.clientY);
    if($edge) {
      App.sel.clear();
      App.edgeSel = Number($edge.dataset.edge);
      App.render();
      return Menu.open(e.clientX, e.clientY, { edge: App.edgeSel, at: w });
    }
    const it = e.target.closest('.win-body') ? Board.find(App.b, Number(e.target.closest('.it').dataset.id)) : Tools.itemAt(e.clientX, e.clientY);
    if(it && !App.sel.has(it.id)) App.select([it.id]);
    if(!it && App.sel.size) App.select([]);
    Menu.open(e.clientX, e.clientY, { item: it, at: w });
  };
  //#endregion

  //#region [ Text editing ]
  static newText(w) {
    App.change(b => {
      const it = Board.item(b, 'text', { border: '', x: w.x, y: w.y - App.style.size * 0.65, text: '', size: App.style.size, color: App.style.color });
      b.items.push(it);
      App.sel = new Set([it.id]);
      App.editing = it.id;
    });
    Tools.set('select');
  }

  static newNote(w, md = '') {
    App.change(b => {
      const it = Board.item(b, 'note', { md });
      Object.assign(it, { x: w.x - it.w / 2, y: w.y - it.h / 2 });
      b.items.push(it);
      App.sel = new Set([it.id]);
      App.editing = md ? 0 : it.id;
    });
    Tools.set('select');
  }

  static edit(it) {
    App.editing = it.id;
    App.sel = new Set([it.id]);
    App.render();
  }

  /** Ends text editing with the editor's value. */
  static commit(value) {
    if(!App.editing) return;
    const it = Board.find(App.b, App.editing);
    App.editing = 0;
    if(!it) return App.render();
    const field = it.kind === 'note' ? 'md' : 'text';
    if(it.kind === 'text' && !value.trim()) {
      App.change(b => Board.remove(b, [it.id]));
      App.sel.delete(it.id);
      return App.render();
    }
    if((it[field] ?? '') !== value) App.change(() => { it[field] = value; });
    else App.render();
  }

  /** Small input over the board (edge labels, group names). */
  static #input(cx, cy, value, done) {
    const r = App.$board.getBoundingClientRect(), $i = document.createElement('input');
    $i.className = 'edge-in';
    $i.value = value;
    Object.assign($i.style, { left: `${cx - r.left - 80}px`, top: `${cy - r.top - 14}px` });
    App.$board.append($i);
    $i.focus();
    $i.select();
    let gone = false;
    const end = ok => { if(gone) return; gone = true; $i.remove(); if(ok) done($i.value); };
    $i.onkeydown = e => { e.stopPropagation(); if(e.key === 'Enter') end(true); if(e.key === 'Escape') end(false); };
    $i.onblur = () => end(true);
  }

  static editEdge(id) {
    const e = App.b.edges.find(x => x.id === id);
    if(!e) return;
    const g = Render.edgeGeom(Board.find(App.b, e.from), Board.find(App.b, e.to)), p = App.toScreen(g.mid.x, g.mid.y);
    Tools.#input(p.x, p.y, e.label, v => { if(v !== e.label) App.change(() => { e.label = v.trim(); }); });
  }

  static editGroup(g) {
    const p = App.toScreen(g.x + 80, g.y - 14);
    Tools.#input(p.x, p.y, g.label, v => { if(v !== g.label) App.change(() => { g.label = v.trim() || 'Group'; }); });
  }
  //#endregion
}
