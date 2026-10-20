// App state: project, selection, undo / redo, mode (music / sfx) and level (simple / full).
class App {
  static p = null;
  static fileName = 'untitled.toon';
  static dirty = false;
  static history = new DAE.History(200);
  static sel = { track: 0, pattern: 0 };
  static sfxSel = 0;
  static cursor = 0;       // bar where playback starts
  static rec = false;
  static status = { playing: false, step: 0, peak: 0 };

  static get track() { return App.p.tracks.find(t => t.id === App.sel.track); }
  static get pattern() { return App.p.patterns.find(x => x.id === App.sel.pattern); }
  static get mode() { return App.p.mode; }
  static get level() { return App.p.level[App.p.mode]; }

  static load(p, name = 'untitled.toon') {
    Audio.send({ t: 'stop' });
    App.p = p;
    App.fileName = name;
    App.history.clear();
    App.cursor = 0;
    App.fixSel();
    App.setDirty(false);
    Audio.project(p);
    document.getElementById('start').classList.add('off');
    App.render();
  }

  /** Keeps the selection pointing at existing things. */
  static fixSel() {
    const p = App.p;
    if(!p.tracks.some(t => t.id === App.sel.track)) App.sel.track = p.tracks[0]?.id ?? 0;
    const pats = p.patterns.filter(x => x.track === App.sel.track);
    if(!pats.some(x => x.id === App.sel.pattern)) App.sel.pattern = pats[0]?.id ?? 0;
    const ids = [...p.sfx, ...p.mixes].map(x => x.id);
    if(!ids.includes(App.sfxSel)) App.sfxSel = ids[0] ?? 0;
  }

  static snapshot() {
    return JSON.stringify(App.p);
  }

  /**
   * One undoable edit. kind: 'project' (re-compile the song), 'mix' (mixer values only), 'none'.
   * redraw: false skips the full re-render (the caller updates its own view).
   */
  static change(fn, kind = 'project', redraw = true) {
    App.history.push(App.snapshot());
    fn(App.p);
    App.#after(kind);
    if(redraw) App.render();
  }

  /** For drags and sliders: call begin() once, then live() on every move. */
  static begin() {
    App.history.push(App.snapshot());
  }

  static #liveTimer = 0;
  static live(kind = 'project') {
    App.setDirty(true);
    if(kind === 'mix') Audio.mix(App.p);
    else if(kind === 'project') {
      cancelAnimationFrame(App.#liveTimer);
      App.#liveTimer = requestAnimationFrame(() => Audio.project(App.p));
    }
    Files.autosave();
  }

  static #after(kind) {
    App.fixSel();
    App.setDirty(true);
    Files.autosave();
    if(kind === 'mix') Audio.mix(App.p);
    else if(kind === 'project') Audio.project(App.p);
  }

  static undo() {
    const s = App.history.undo(App.snapshot());
    if(s) App.#restore(s);
  }

  static redo() {
    const s = App.history.redo(App.snapshot());
    if(s) App.#restore(s);
  }

  static #restore(s) {
    const mode = App.p.mode, level = App.p.level;
    App.p = JSON.parse(s);
    App.p.mode = mode;      // undo never flips the view
    App.p.level = level;
    App.#after('project');
    App.render();
  }

  static setDirty(d) {
    App.dirty = d;
    const $n = document.getElementById('file-name'), $s = document.getElementById('file-state');
    if($n) $n.textContent = App.fileName;
    if($s) $s.textContent = d ? '●' : '';
  }

  static setMode(m) {
    App.p.mode = m;
    App.render();
  }

  static setLevel(l) {
    App.p.level[App.p.mode] = l;
    Files.autosave();
    App.render();
  }

  static render() {
    UI.reset();
    const sfx = App.p.mode === 'sfx';
    document.body.classList.toggle('sfx', sfx);
    document.body.classList.toggle('simple', App.level === 'simple');
    document.getElementById('music').classList.toggle('on', !sfx);
    document.getElementById('sfx').classList.toggle('on', sfx);
    Header.render();
    if(sfx) Sfx.render();
    else {
      Playlist.render();
      Editor.render();
      Inspector.render();
    }
    Keyboard.render();
  }

  static toast(msg) {
    let $t = document.getElementById('toast');
    if(!$t) {
      $t = document.createElement('div');
      $t.id = 'toast';
      $t.style.cssText = 'position:fixed;left:50%;bottom:150px;transform:translateX(-50%);background:var(--line);padding:8px 14px;border-radius:var(--r);z-index:20;font-size:13px';
      document.body.append($t);
    }
    $t.textContent = msg;
    $t.hidden = false;
    clearTimeout(App.toast.t);
    App.toast.t = setTimeout(() => { $t.hidden = true; }, 3500);
  }
}

// Small view helpers: escaped text, icon buttons and live-bound sliders.
class UI {
  static #fields = new Map();
  static #n = 0;

  static esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  static icon(name) {
    return DAE.Icons.html(name);
  }

  static reset() {
    UI.#fields.clear();
  }

  /**
   * Slider row. d: { get, set(v), min, max, step, fmt(v), kind: 'project'|'mix'|'none', after() }
   * The edit is one undo step from press to release.
   */
  static field(label, d, cls = '') {
    const id = ++UI.#n, v = d.get(), fmt = d.fmt ?? (x => Math.round(x * 100));
    UI.#fields.set(id, { ...d, fmt });
    return `<label class="field ${cls}">${label}<input type="range" data-f="${id}" min="${d.min ?? 0}" max="${d.max ?? 1}" step="${d.step ?? 0.01}" value="${v}"><b>${fmt(v)}</b></label>`;
  }

  /** Bare slider (no label row), e.g. track volume knobs. */
  static knob(d, cls = 'knob', title = '') {
    const id = ++UI.#n;
    UI.#fields.set(id, { fmt: x => x, ...d });
    return `<input type="range" class="${cls}" title="${title}" data-f="${id}" min="${d.min ?? 0}" max="${d.max ?? 1}" step="${d.step ?? 0.01}" value="${d.get()}">`;
  }

  /** Hooks every [data-f] slider under $root. */
  static wire($root) {
    $root.querySelectorAll('[data-f]').forEach($i => {
      const d = UI.#fields.get(Number($i.dataset.f));
      if(!d) return;
      let started = false;
      $i.onpointerdown = e => e.stopPropagation();
      $i.oninput = () => {
        if(!started) { App.begin(); started = true; }
        const v = Number($i.value);
        d.set(v);
        const $b = $i.nextElementSibling;
        if($b?.tagName === 'B') $b.textContent = d.fmt(v);
        App.live(d.kind ?? 'project');
        d.live?.(v);
      };
      $i.onchange = () => {
        started = false;
        d.after?.();
      };
    });
  }
}
