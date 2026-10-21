// App state: the board, selection, active tool and style, view (pan / zoom), undo history.
const { Board } = DAE;

class App {
  static b = Board.create();
  static history = new DAE.History(150);
  static pool = new Map();          // every asset seen this session, so undo can bring one back
  static sel = new Set();           // selected item ids
  static edgeSel = 0;               // selected edge id
  static tool = 'select';
  static style = { color: '#FFFFFF', fill: 'none', width: 2, size: 20, border: Board.border, shape: 'rect' };
  static fileName = 'untitled.hestia.toon';
  static handle = null;
  static dirty = false;
  static editing = 0;               // item id whose text is being edited

  static get view() { return App.b.view; }
  static get selected() { return [...App.sel].map(id => Board.find(App.b, id)).filter(Boolean); }
  static get one() { return App.sel.size === 1 ? App.selected[0] : null; }

  //#region [ Coordinates ]
  static $board = null;

  static #rect() {
    return App.$board.getBoundingClientRect();
  }

  /** Screen (client) point -> world point (shared/viewport.js). */
  static toWorld(cx, cy) {
    return DAE.View.toWorld(App.view, App.#rect(), cx, cy);
  }

  static toScreen(wx, wy) {
    return DAE.View.toScreen(App.view, App.#rect(), wx, wy);
  }

  /** World point at the middle of the board. */
  static center() {
    const r = App.#rect();
    return App.toWorld(r.left + r.width / 2, r.top + r.height / 2);
  }

  /** Zooms by `f` keeping the world point under (cx, cy) in place. */
  static zoomAt(f, cx, cy) {
    DAE.View.zoomAt(App.view, App.#rect(), f, cx, cy, 0.05, 8);
    Render.view();
  }

  /** Fits a world box (or every item) in the board. */
  static fit(box = Board.bounds(App.b.items), pad = 60) {
    const r = App.#rect(), v = App.view;
    if(!box) Object.assign(v, { x: -r.width / 2, y: -r.height / 2, zoom: 1 });
    else DAE.View.fit(v, r, box, { pad, max: 2 });
    Render.view();
  }
  //#endregion

  //#region [ Changes ]
  static snapshot() {
    for(const a of App.b.assets) App.pool.set(a.id, a);
    return JSON.stringify({ items: App.b.items, edges: App.b.edges, assets: App.b.assets.map(a => a.id) });
  }

  static #restore(snap) {
    const s = JSON.parse(snap);
    App.b.items = s.items;
    App.b.edges = s.edges;
    App.b.assets = s.assets.map(id => App.pool.get(id)).filter(Boolean);
    for(const id of [...App.sel]) if(!Board.find(App.b, id)) App.sel.delete(id);
    App.after();
  }

  /** Records the state before a change that happens over time (drag); call App.after() at the end. */
  static begin() {
    App.history.push(App.snapshot());
  }

  /** One undoable change. */
  static change(fn) {
    App.begin();
    fn(App.b);
    App.after();
  }

  /** After any change: bindings, dirty flag, autosave, redraw. */
  static after() {
    Board.bind(App.b);
    App.setDirty(true);
    Files.autosave();
    App.render();
  }

  static undo() {
    const s = App.history.undo(App.snapshot());
    if(s) App.#restore(s);
  }

  static redo() {
    const s = App.history.redo(App.snapshot());
    if(s) App.#restore(s);
  }

  static setDirty(on) {
    App.dirty = on;
    document.getElementById('file-state').textContent = on ? '●' : '';
    document.getElementById('file-name').textContent = App.fileName;
    document.title = `${App.fileName}${on ? ' ●' : ''} · Hestia`;
  }

  /** Replaces the board (open, new, recent). */
  static load(b, name = 'untitled.hestia.toon', handle = null) {
    Widgets.clear();
    App.b = b;
    App.fileName = name;
    App.handle = handle;
    App.sel.clear();
    App.edgeSel = 0;
    App.history.clear();
    App.setDirty(false);
    Render.reset();
    App.render();
    if(!b.items.length) App.fit(null);
    else Render.view();
  }

  static select(ids, add = false) {
    if(!add) App.sel.clear();
    for(const id of ids) App.sel.add(id);
    App.edgeSel = 0;
    App.render();
  }

  static render() {
    Render.all();
    Panels.update();
  }
  //#endregion

  //#region [ Clipboard ]
  static clip = null;

  static copy() {
    const items = App.selected;
    if(!items.length) return false;
    const ids = new Set(items.map(i => i.id));
    App.clip = JSON.parse(JSON.stringify({
      items, edges: App.b.edges.filter(e => ids.has(e.from) && ids.has(e.to)),
      assets: App.b.assets.filter(a => items.some(i => i.asset === a.id || i.audio === a.id)),
    }));
    return true;
  }

  /** Pastes copies offset by `d` (or centered at a world point). */
  static paste(at = null, d = 24) {
    if(!App.clip) return;
    App.change(b => {
      const box = Board.bounds(App.clip.items), map = new Map();
      const dx = at ? at.x - box.x - box.w / 2 : d, dy = at ? at.y - box.y - box.h / 2 : d;
      for(const a of App.clip.assets) if(!Board.asset(b, a.id)) b.assets.push(a);
      let z = Board.top(b);
      for(const src of App.clip.items) {
        const it = { ...JSON.parse(JSON.stringify(src)), id: Board.nextId(b.items), z: ++z };
        map.set(src.id, it.id);
        b.items.push(it);
      }
      const added = b.items.filter(it => [...map.values()].includes(it.id));
      for(const it of added) {
        if(Board.isLine(it)) { it.from = map.get(it.from) ?? null; it.to = map.get(it.to) ?? null; }
        if(it.kind === 'group') it.items = (it.items ?? []).map(id => map.get(id)).filter(Boolean);
        else Board.setGroup(b, it.id, null);
      }
      Board.prune(b);
      Board.move(b, added.map(i => i.id), dx, dy);
      for(const e of App.clip.edges) Board.edge(b, map.get(e.from), map.get(e.to), { label: e.label, color: e.color });
      App.sel = new Set(added.map(i => i.id));
    });
    App.clip.items.forEach(i => { i.x += d; i.y += d; if(Board.isLine(i)) { i.x1 += d; i.y1 += d; i.x2 += d; i.y2 += d; if(i.mx != null) { i.mx += d; i.my += d; } } });
  }

  static duplicate() {
    if(App.copy()) App.paste(null, 24);
  }

  static remove() {
    if(App.edgeSel) {
      App.change(b => { b.edges = b.edges.filter(e => e.id !== App.edgeSel); });
      App.edgeSel = 0;
      App.render();
      return;
    }
    const ids = App.selected.filter(i => !i.locked).map(i => i.id);
    if(!ids.length) return;
    App.change(b => Board.remove(b, ids));
    App.sel.clear();
    App.render();
  }
  //#endregion
}
