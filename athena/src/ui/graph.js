// Graph view: the core SVG renderer inside a pan/zoom viewport, plus editing gestures.
class Graph {
  static $el = null;
  static view = DAE.View.make(0, 0, 1);   // shared/viewport.js: { x, y, zoom }
  static ZOOM = [0.04, 6];
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

  static #rect() {
    const r = Graph.$el.getBoundingClientRect();
    return r.width && r.height ? r : { left: r.left, top: r.top, width: 800, height: 600 };
  }

  static #apply() {
    const $svg = Graph.#svg();
    if(!$svg) return;
    const b = DAE.View.box(Graph.view, Graph.#rect());
    $svg.setAttribute('viewBox', `${b.x} ${b.y} ${b.w} ${b.h}`);
    $svg.removeAttribute('width');
    $svg.removeAttribute('height');
  }

  static fit() {
    const pts = [...App.pos.values()];
    if(!pts.length) return;
    const pad = 90;
    const minX = Math.min(...pts.map(p => p.x)) - pad, maxX = Math.max(...pts.map(p => p.x)) + pad;
    const minY = Math.min(...pts.map(p => p.y)) - pad, maxY = Math.max(...pts.map(p => p.y)) + pad;
    const w = Math.max(maxX - minX, 400), h = Math.max(maxY - minY, 300);
    DAE.View.fit(Graph.view, Graph.#rect(), { x: (minX + maxX - w) / 2, y: (minY + maxY - h) / 2, w, h }, { pad: 0, min: Graph.ZOOM[0], max: Graph.ZOOM[1] });
    Graph.#apply();
  }

  /** Zooms by f (> 1: in) around a map point (the center when omitted). */
  static zoom(f, at) {
    const r = Graph.#rect(), s = at ? DAE.View.toScreen(Graph.view, r, at.x, at.y) : { x: undefined, y: undefined };
    DAE.View.zoomAt(Graph.view, r, f, s.x, s.y, Graph.ZOOM[0], Graph.ZOOM[1]);
    Graph.#apply();
  }

  /** Mouse event -> map coordinates. */
  static #point(e) {
    return DAE.View.toWorld(Graph.view, Graph.#rect(), e.clientX, e.clientY);
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
      Graph.#drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, view: { ...Graph.view }, moved: false };
      Graph.$el.classList.add('panning');
    }
  }

  static #move(e) {
    const d = Graph.#drag;
    if(!d) return;
    if(d.kind === 'pan') {
      if(Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) d.moved = true;
      Graph.view = DAE.View.pan({ ...d.view }, e.clientX - d.sx, e.clientY - d.sy);
      Graph.#apply();
    }
    else if(d.kind === 'move') {
      const p = Graph.#point(e);
      if(!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) < 6) return;
      d.moved = true;
      Graph.$el.classList.add('moving');
      // shared/snap.js: line up with other rooms (pink guide), else the grid; Alt moves freely
      const raw = { x: p.x - d.start.x, y: p.y - d.start.y }, others = [...App.pos].filter(([id]) => id !== d.id).map(([, q]) => ({ x: q.x, y: q.y, w: 0, h: 0 }));
      const s = e.altKey ? { off: raw, guides: [] } : DAE.Snap.move({ x: d.from.x, y: d.from.y, w: 0, h: 0 }, raw, others, { tol: 8 / Graph.view.zoom, grid: Graph.GRID });
      const to = { x: Math.round(d.from.x + s.off.x), y: Math.round(d.from.y + s.off.y) };
      d.guides = s.guides;
      const cur = App.pos.get(d.id);
      if(cur.x === to.x && cur.y === to.y) return Graph.#guides(d.guides);
      if(!d.pushed) {   // one undo step per drag
        d.pushed = true;
        App.history.push(App.snapshot());
        App.historyButtons();
        App.setDirty(true);
      }
      App.pos.set(d.id, to);   // saved in the file (rooms x,y)
      App.render();
      Graph.#guides(d.guides);
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

  /** Snap guide lines over the map (cleared by the next render). */
  static #guides(list) {
    const $svg = Graph.#svg();
    if(!$svg) return;
    $svg.querySelector('#snap-guides')?.remove();
    if(!list?.length) return;
    const w = 1.5 / Graph.view.zoom, ext = 60;
    $svg.insertAdjacentHTML('beforeend', `<g id="snap-guides" pointer-events="none" stroke="${DAE.Svg.C.pink ?? '#FF79C6'}" stroke-width="${w}" stroke-dasharray="${4 / Graph.view.zoom}">`
      + list.map(g => g.ax === 'x' ? `<line x1="${g.at}" y1="${g.lo - ext}" x2="${g.at}" y2="${g.hi + ext}"/>` : `<line x1="${g.lo - ext}" y1="${g.at}" x2="${g.hi + ext}" y2="${g.at}"/>`).join('') + '</g>');
  }

  static #up(e) {
    const d = Graph.#drag;
    Graph.#drag = null;
    Graph.#svg()?.querySelector('#snap-guides')?.remove();
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
