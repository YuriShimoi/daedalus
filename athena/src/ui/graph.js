// Graph view: the core SVG renderer inside a pan/zoom viewport, plus editing gestures.
class Graph {
  static $el = null;
  static vb = { x: 0, y: 0, w: 800, h: 600 };
  static GRID = 40;                 // snap step, shown by the dot grid
  static #drag = null;

  static init($el) {
    Graph.$el = $el;
    $el.addEventListener('wheel', e => {
      e.preventDefault();
      Graph.zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, Graph.#point(e));
    }, { passive: false });
    $el.addEventListener('mousedown', Graph.#down);
    window.addEventListener('mousemove', Graph.#move);
    window.addEventListener('mouseup', Graph.#up);
    // the menu opens from mouseup (right button, no drag), so a right-drag never shows it
    $el.addEventListener('contextmenu', e => e.preventDefault());
    new ResizeObserver(() => Graph.#apply()).observe($el);
  }

  static draw(model, opts) {
    Graph.$el.innerHTML = DAE.Svg.render(model, opts);
    Graph.#grid();
    Graph.#apply();
  }

  static snap(p) {
    return { x: Math.round(p.x / Graph.GRID) * Graph.GRID, y: Math.round(p.y / Graph.GRID) * Graph.GRID };
  }

  /** Dot grid behind the map, in map units, so it pans and zooms with it. */
  static #grid() {
    const $svg = Graph.#svg();
    if(!$svg) return;
    const G = Graph.GRID;
    // tile offset by half a step, so its centered dot lands on the snap points
    $svg.insertAdjacentHTML('afterbegin', `<defs><pattern id="dae-grid" x="${-G / 2}" y="${-G / 2}" width="${G}" height="${G}" patternUnits="userSpaceOnUse">` +
      `<circle cx="${G / 2}" cy="${G / 2}" r="1.5" fill="${DAE.Svg.C.line}"/></pattern></defs>` +
      '<rect x="-50000" y="-50000" width="100000" height="100000" fill="url(#dae-grid)" pointer-events="none"/>');
  }

  //#region [ Viewport ]
  static #svg() {
    return Graph.$el.querySelector('svg');
  }

  static #apply() {
    const $svg = Graph.#svg();
    if(!$svg) return;
    // keep the viewBox aspect equal to the element, so zoom math stays simple
    const r = Graph.$el.getBoundingClientRect();
    if(r.width && r.height) Graph.vb.h = Graph.vb.w * r.height / r.width;
    $svg.setAttribute('viewBox', `${Graph.vb.x} ${Graph.vb.y} ${Graph.vb.w} ${Graph.vb.h}`);
    $svg.removeAttribute('width');
    $svg.removeAttribute('height');
  }

  static fit() {
    const pts = [...App.pos.values()];
    if(!pts.length) return;
    const pad = 90;
    const minX = Math.min(...pts.map(p => p.x)) - pad, maxX = Math.max(...pts.map(p => p.x)) + pad;
    const minY = Math.min(...pts.map(p => p.y)) - pad, maxY = Math.max(...pts.map(p => p.y)) + pad;
    const r = Graph.$el.getBoundingClientRect();
    const aspect = r.width && r.height ? r.width / r.height : 4 / 3;
    let w = Math.max(maxX - minX, 400), h = Math.max(maxY - minY, 300);
    if(w / h < aspect) w = h * aspect;
    Graph.vb = { x: (minX + maxX - w) / 2, y: (minY + maxY - w / aspect) / 2, w, h: w / aspect };
    Graph.#apply();
  }

  static zoom(f, at) {
    const v = Graph.vb;
    const cx = at?.x ?? v.x + v.w / 2, cy = at?.y ?? v.y + v.h / 2;
    const w = Math.min(Math.max(v.w / f, 150), 20000);
    const k = w / v.w;
    Graph.vb = { x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k, w, h: v.h * k };
    Graph.#apply();
  }

  /** Mouse event -> map coordinates. */
  static #point(e) {
    const r = Graph.$el.getBoundingClientRect();
    return { x: Graph.vb.x + (e.clientX - r.left) / r.width * Graph.vb.w, y: Graph.vb.y + (e.clientY - r.top) / r.height * Graph.vb.h };
  }
  //#endregion

  //#region [ Gestures ]
  static #hit(target) {
    const $room = target.closest?.('[data-room]');
    if($room) return { kind: 'room', id: $room.dataset.room };
    const $g = target.closest?.('[data-passage]');
    if($g) return { kind: 'passage', id: $g.dataset.passage };
    return null;
  }

  static #down(e) {
    if(e.button !== 0 && e.button !== 2) return;
    const hit = Graph.#hit(e.target);
    const p = Graph.#point(e);
    const edit = App.mode === 'edit';
    if(e.button === 2) {
      // right: drag from a room links it (to a room, or to a new room on empty space); a plain click opens the menu
      Graph.#drag = hit?.kind === 'room' && edit ? { kind: 'link', from: hit.id, start: p, moved: false } : { kind: 'menu', hit, start: p };
      return;
    }
    if(hit?.kind === 'room' && edit) Graph.#drag = { kind: 'move', id: hit.id, start: p, from: { ...App.pos.get(hit.id) }, moved: false };
    else if(hit) Graph.#drag = { kind: 'click', hit };
    else {
      Graph.#drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vb: { ...Graph.vb }, moved: false };
      Graph.$el.classList.add('panning');
    }
  }

  static #move(e) {
    const d = Graph.#drag;
    if(!d) return;
    if(d.kind === 'pan') {
      const r = Graph.$el.getBoundingClientRect();
      const dx = (e.clientX - d.sx) / r.width * d.vb.w, dy = (e.clientY - d.sy) / r.height * d.vb.h;
      if(Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) d.moved = true;
      Graph.vb = { ...d.vb, x: d.vb.x - dx, y: d.vb.y - dy };
      Graph.#apply();
    }
    else if(d.kind === 'move') {
      const p = Graph.#point(e);
      if(!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) < 6) return;
      d.moved = true;
      Graph.$el.classList.add('moving');
      const to = Graph.snap({ x: d.from.x + p.x - d.start.x, y: d.from.y + p.y - d.start.y });
      const cur = App.pos.get(d.id);
      if(cur.x === to.x && cur.y === to.y) return;
      if(!d.pushed) {   // one undo step per drag
        d.pushed = true;
        App.history.push(App.snapshot());
        App.historyButtons();
        App.setDirty(true);
      }
      App.pos.set(d.id, to);   // saved in the file (rooms x,y)
      App.render();
    }
    else if(d.kind === 'link') {
      const p = Graph.#point(e);
      if(!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) < 8) return;
      d.moved = true;
      const a = App.pos.get(d.from);
      let $pre = Graph.#svg()?.querySelector('#link-preview');
      if(!$pre) {
        const c = DAE.Svg.C.accent;
        Graph.#svg()?.insertAdjacentHTML('beforeend', `<g id="link-preview" pointer-events="none"><line stroke="${c}" stroke-width="3" stroke-dasharray="6 4"/>` +
          `<circle r="24" fill="none" stroke="${c}" stroke-width="2" stroke-dasharray="6 4"/></g>`);
        $pre = Graph.#svg()?.querySelector('#link-preview');
      }
      if(!$pre) return;
      // over another room: link to its center; over empty space: to the ghost of the room the drop will create (snapped)
      const over = Graph.#hit(e.target), g = Graph.snap(p);
      const end = over?.kind === 'room' ? App.pos.get(over.id) ?? g : g;
      const $line = $pre.querySelector('line'), $ghost = $pre.querySelector('circle');
      $line.setAttribute('x1', a.x); $line.setAttribute('y1', a.y);
      $line.setAttribute('x2', end.x); $line.setAttribute('y2', end.y);
      $ghost.setAttribute('cx', g.x); $ghost.setAttribute('cy', g.y);
      $ghost.style.display = over?.kind === 'room' ? 'none' : '';
    }
  }

  static #up(e) {
    const d = Graph.#drag;
    Graph.#drag = null;
    Graph.$el.classList.remove('panning', 'moving');
    if(!d) return;
    // double-clicks come from the mouseup click count: the first click re-renders, so a dblclick event would hit a removed node
    const dbl = e.detail >= 2 && App.mode === 'edit';
    if(d.kind === 'pan') {
      if(d.moved || !e.target.closest?.('#graph')) return;
      return dbl ? Inspector.addRoom(Graph.snap(Graph.#point(e))) : App.select(null);
    }
    if(d.kind === 'click') return dbl && d.hit.kind === 'passage' ? Inspector.splitPassage(d.hit.id) : App.select(d.hit.id);
    if(d.kind === 'move') return App.select(d.id);
    if(d.kind === 'menu') return Menu.open(e, d.hit, d.start);
    if(d.kind === 'link') {
      Graph.#svg()?.querySelector('#link-preview')?.remove();
      if(!d.moved) return Menu.open(e, { kind: 'room', id: d.from }, d.start);
      const hit = Graph.#hit(e.target);
      if(hit?.kind === 'room') { if(hit.id !== d.from) Inspector.addPassage(d.from, hit.id); }
      else if(e.target.closest?.('#graph')) Inspector.addLinkedRoom(d.from, Graph.snap(Graph.#point(e)));
    }
  }
  //#endregion
}
