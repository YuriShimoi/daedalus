// Widget host: each widget item gets one live instance of its tool's widget class, mounted in the
// window body and kept while the item lives. Tool cores load on demand (script tags, file:// safe).
class Widgets {
  static types = {};           // tool -> class (registered by src/widgets/*.js)
  static #live = new Map();    // item id -> { inst, asset }
  static #scripts = new Map(); // src -> Promise

  static register(tool, cls) {
    Widgets.types[tool] = cls;
  }

  static icon(tool) {
    return `../${tool}/assets/${tool}.svg`;
  }

  /** Loads scripts in order (each once). */
  static load(list) {
    return list.reduce((p, src) => p.then(() => {
      if(!Widgets.#scripts.has(src)) Widgets.#scripts.set(src, new Promise((ok, fail) => {
        const $s = document.createElement('script');
        $s.src = src;
        $s.onload = ok;
        $s.onerror = () => fail(new Error(`can't load ${src}`));
        document.body.append($s);
      }));
      return Widgets.#scripts.get(src);
    }), Promise.resolve());
  }

  /** Mounts (or refreshes when its file changed) the widget of an item. */
  static mount(it, $body) {
    const cur = Widgets.#live.get(it.id);
    if(cur && cur.$body === $body && cur.asset === it.asset) return;
    if(cur) cur.inst.unmount?.();
    const Cls = Widgets.types[it.tool];
    if(!Cls) { $body.innerHTML = `<p class="win-msg bad">Unknown widget "${DAE.Markdown.esc(it.tool)}"</p>`; return; }
    const inst = new Cls(it, $body);
    Widgets.#live.set(it.id, { inst, asset: it.asset, $body });
    $body.innerHTML = '<p class="win-msg">Loading…</p>';
    Promise.resolve(inst.mount()).catch(err => Widgets.error($body, err));
  }

  static error($body, err) {
    console.error(err);
    $body.innerHTML = `<p class="win-msg bad">Can't open this file.<br>${DAE.Markdown.esc(err.message ?? err)}</p>`;
  }

  static get(id) {
    return Widgets.#live.get(id)?.inst ?? null;
  }

  static unmount(id) {
    Widgets.#live.get(id)?.inst.unmount?.();
    Widgets.#live.delete(id);
  }

  static clear() {
    for(const id of [...Widgets.#live.keys()]) Widgets.unmount(id);
  }

  /** The file a widget shows, as text (tool files) or null (audio). */
  static sourceText(it) {
    const a = Board.asset(App.b, it.asset);
    if(!a || !/toon|json|text/.test(a.mime)) return null;
    return new TextDecoder().decode(AudioKit.fromB64(a.data));
  }

  /** Which widget a dropped file becomes: 'athena', 'apollo' or null. */
  static kindOf(name, mime, text = null) {
    return Board.widgetKind(name, mime, text);
  }

  /** Right-click rows for a widget item. */
  static menu(it) {
    const text = Widgets.sourceText(it), name = it.tool === 'athena' ? 'Athena' : 'Apollo';
    const rows = [
      [`Open in ${name} (new tab)`, 'up-right-from-square', () => DAE.Handoff.open(`../${it.tool}/index.html`, it.name, text), '', !text],
      ['Replace file…', 'folder-open', () => Files.pick('replace', null, it)],
      ['Save file', 'download', () => Files.saveAsset(it.asset)],
    ];
    const extra = Widgets.get(it.id)?.menu?.() ?? [];
    return [...rows, ...extra];
  }
}

/** Shared bits for widget classes. */
class Widget {
  constructor(it, $body) {
    this.id = it.id;
    this.$body = $body;
  }

  get it() { return Board.find(App.b, this.id); }
  get asset() { return Board.asset(App.b, this.it?.asset); }

  text() {
    return Widgets.sourceText(this.it);
  }

  /** Stops board gestures from starting inside an element (the widget handles them). */
  own($el) {
    $el.addEventListener('pointerdown', e => e.stopPropagation());
    return $el;
  }
}
