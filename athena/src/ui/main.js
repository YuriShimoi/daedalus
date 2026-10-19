// Athena page entry: app state, edits with undo/redo, rendering, toolbar and shortcuts.
class App {
  static model = null;
  static fileName = 'untitled.toon';
  static dirty = false;
  static history = new DAE.History(100);
  static pos = new Map();          // room id -> {x, y}, kept across edits (layout only on load / re-layout)
  static selected = null;          // room or passage id
  static tab = 'room';
  static issues = { errors: [], warnings: [] };
  static route = null;             // action strings highlighted on the graph
  static view = null;              // { state } shown by playback / play mode
  static marks = new Set();        // ids flagged red (blockers, validation)
  static mode = 'edit';            // edit | play

  static init() {
    DAE.Icons.mount();
    App.#toolbar();
    Graph.init(document.getElementById('graph'));
    Inspector.init();
    Menu.init();
    SolverPanel.init(document.getElementById('dock'));
    App.#keys();
    App.load(App.starter(), 'untitled.toon');
    window.addEventListener('beforeunload', e => { if(App.dirty) e.preventDefault(); });
  }

  /** A small map to start from. */
  static starter() {
    return DAE.Model.parse('dae: 1\nrooms[2]{id,flags}:\n  r0,entry\n  r1,exit\npassages[1]{id,a,b}:\n  p0,r0,r1\n');
  }

  //#region [ Model changes ]
  /** Replaces the model (open, new, generate): saved positions or a fresh layout, history cleared. */
  static load(model, name) {
    const saved = new Map(model.rooms.filter(r => r.x != null && r.y != null).map(r => [r.id, { x: r.x, y: r.y }]));
    model.rooms.forEach(r => { r.x = r.y = null; });   // positions live in App.pos while editing, written back on save
    App.model = model;
    App.fileName = name ?? App.fileName;
    App.history.clear();
    App.selected = model.rooms[0]?.id ?? null;
    App.route = null;
    App.view = null;
    App.marks = new Set();
    App.relayout(false);
    for(const [id, p] of saved) App.pos.set(id, p);
    App.setDirty(false);
    SolverPanel.reset();
    App.changed();
    Graph.fit();
  }

  /** Every edit goes through here: snapshot for undo, a new model object (rules caches key on it). */
  static edit(fn) {
    if(App.mode === 'play') Play.stop();
    App.history.push(App.snapshot());
    const m = DAE.Model.clone(App.model);
    fn(m);
    App.model = m;
    App.setDirty(true);
    App.changed();
  }

  static undo() {
    const prev = App.history.undo(App.snapshot());
    if(prev) App.#restore(prev);
  }

  static redo() {
    const next = App.history.redo(App.snapshot());
    if(next) App.#restore(next);
  }

  /** A history state: the model and the room positions, so moves undo too. */
  static snapshot() {
    return JSON.stringify({ model: App.model, pos: [...App.pos] });
  }

  /** The model as saved: room positions from the editor. */
  static toSave() {
    const m = DAE.Model.clone(App.model);
    m.rooms.forEach(r => {
      const p = App.pos.get(r.id);
      if(p) { r.x = Math.round(p.x); r.y = Math.round(p.y); }
    });
    return m;
  }

  static #restore(json) {
    const s = JSON.parse(json);
    App.model = s.model;
    App.pos = new Map(s.pos);
    App.setDirty(true);
    App.changed();
  }

  /** After any change: validate, place new rooms, redraw everything. */
  static changed() {
    App.issues = DAE.Validate.run(App.model);
    for(const r of App.model.rooms) if(!App.pos.has(r.id)) App.pos.set(r.id, App.#freeSpot());
    for(const id of [...App.pos.keys()]) if(!App.model.rooms.some(r => r.id === id)) App.pos.delete(id);
    if(App.selected && !App.model.rooms.some(r => r.id === App.selected) && !App.model.passages.some(g => g.id === App.selected))
      App.selected = null;
    App.#issuesChip();
    App.historyButtons();
    App.render();
    Inspector.render();
    SolverPanel.modelChanged();
  }

  static historyButtons() {
    document.getElementById('btn-undo').disabled = !App.history.canUndo;
    document.getElementById('btn-redo').disabled = !App.history.canRedo;
  }

  static relayout(draw = true) {
    if(draw) App.history.push(App.snapshot());
    const L = DAE.Layout.run(App.model);
    App.pos = new Map([...L.pos].map(([id, p]) => [id, Graph.snap(p)]));
    if(draw) {
      App.setDirty(true);
      App.historyButtons();
      App.render();
      Graph.fit();
    }
  }

  static #freeSpot() {
    const xs = [...App.pos.values()];
    const maxX = xs.length ? Math.max(...xs.map(p => p.x)) : 0;
    return { x: maxX + DAE.Layout.GAP, y: xs.length ? xs[xs.length - 1].y : 80 };
  }

  static setDirty(v) {
    App.dirty = v;
    document.getElementById('file-name').textContent = App.fileName;
    document.getElementById('file-state').textContent = v ? '●' : '';
    document.title = `${v ? '● ' : ''}${App.fileName} · Athena`;
  }

  static #issuesChip() {
    const $c = document.getElementById('issues');
    const { errors, warnings } = App.issues;
    $c.className = 'chip ' + (errors.length ? 'bad' : warnings.length ? 'warn' : 'good');
    $c.innerHTML = errors.length ? `${DAE.Icons.html('circle-xmark')} ${errors.length} error${errors.length > 1 ? 's' : ''}`
      : warnings.length ? `${DAE.Icons.html('triangle-exclamation')} ${warnings.length} warning${warnings.length > 1 ? 's' : ''}`
      : `${DAE.Icons.html('circle-check')} valid`;
    $c.title = [...errors.map(e => 'error: ' + e.msg), ...warnings.map(w => 'warning: ' + w.msg)].join('\n');
  }
  //#endregion

  //#region [ Drawing ]
  static render() {
    const issueIds = new Set(App.issues.errors.map(e => e.at));
    const marks = new Set([...App.marks, ...[...issueIds].filter(id => App.pos.has(id) || App.model.passages.some(g => g.id === id))]);
    Graph.draw(App.model, {
      layout: App.#layout(), selected: App.selected, route: App.route, state: App.view?.state, marks,
    });
  }

  static #layout() {
    const pts = [...App.pos.values()];
    const pad = DAE.Layout.GAP * 0.6;
    return {
      pos: App.pos,
      width: (pts.length ? Math.max(...pts.map(p => p.x)) : 0) + pad,
      height: (pts.length ? Math.max(...pts.map(p => p.y)) : 0) + pad,
    };
  }

  static select(id) {
    if(App.mode === 'play') {
      if(id) Play.clickRoom(id);
      return;
    }
    App.selected = id;
    if(id && App.mode === 'edit') App.tab = App.model.passages.some(g => g.id === id) ? 'passage' : 'room';
    App.render();
    Inspector.render();
  }
  //#endregion

  //#region [ Toolbar and keys ]
  static #toolbar() {
    const I = DAE.Icons.html;
    const groups = [
      [['new', 'plus', 'New', () => Files.newMap()], ['open', 'folder-open', 'Open', () => Files.open()],
        ['save', 'floppy-disk', 'Save', () => Files.save()], ['saveas', 'file-export', 'Save as', () => Files.save(true)]],
      [['gen', 'wand-magic-sparkles', 'Generate', () => Files.generateDialog()], ['reroll', 'dice', '', () => Files.reroll(), 'New map: same settings, new seed']],
      [['check', 'circle-check', 'Quick check', () => SolverPanel.quickCheck()], ['solve', 'route', 'Solve', () => SolverPanel.solve()],
        ['play', 'person-walking', 'Play', () => Play.toggle()]],
      [['undo', 'rotate-left', '', () => App.undo(), 'Undo (Ctrl+Z)'], ['redo', 'rotate-right', '', () => App.redo(), 'Redo (Ctrl+Y)']],
    ];
    const $bar = document.getElementById('toolbar');
    groups.forEach((group, gi) => {
      if(gi) $bar.insertAdjacentHTML('beforeend', '<span class="sep"></span>');
      for(const [id, icon, label, fn, title] of group) {
        const $b = document.createElement('button');
        $b.id = 'btn-' + id;
        $b.innerHTML = I(icon) + (label ? ` ${label}` : '');
        $b.title = title ?? label;
        $b.onclick = fn;
        if(id === 'solve') $b.className = 'primary';
        $bar.append($b);
      }
    });
    const tools = [['magnifying-glass-plus', 'Zoom in', () => Graph.zoom(1.25)], ['magnifying-glass-minus', 'Zoom out', () => Graph.zoom(0.8)],
      ['crosshairs', 'Fit', () => Graph.fit()], ['sitemap', 'Re-layout', () => App.relayout()]];
    const $tools = document.getElementById('canvas-tools');
    for(const [icon, title, fn] of tools) {
      const $b = document.createElement('button');
      $b.innerHTML = I(icon);
      $b.title = title;
      $b.onclick = fn;
      $tools.append($b);
    }
    document.getElementById('issues').onclick = () => Inspector.show('rules');
  }

  static #keys() {
    document.addEventListener('keydown', e => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '');
      if(e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        Files.save(e.shiftKey);
      }
      else if(typing) return;
      else if(e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); App.mode === 'play' ? Play.back() : App.undo(); }
      else if(e.ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); App.redo(); }
      else if((e.key === 'Delete' || e.key === 'Backspace') && App.selected && App.mode === 'edit') Inspector.deleteSelected();
      else if(e.key === 'Escape' && App.mode === 'play') Play.stop();
      else if(e.key === 'Escape' && Playback.steps) SolverPanel.leave();
    });
  }
  //#endregion
}

window.addEventListener('DOMContentLoaded', () => App.init());
