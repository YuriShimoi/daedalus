// Files: board open / save (TOON; shared/files.js: File System Access API with a download fallback),
// autosave and recent boards (shared/store.js: IndexedDB, boards with images outgrow localStorage),
// adding images, tool files and audio by picker, drop or paste, and object URLs for assets.
class Files {
  static #types = [{ description: 'Hestia board or Obsidian canvas', accept: { 'text/plain': ['.toon'], 'application/json': ['.json', '.canvas'] } }];
  static #urls = new Map();   // asset id -> object URL
  static recentList = [];

  //#region [ Assets ]
  static url(id) {
    if(Files.#urls.has(id)) return Files.#urls.get(id);
    const a = Board.asset(App.b, id) ?? App.pool.get(id);
    if(!a) return '';
    const u = URL.createObjectURL(new Blob([AudioKit.fromB64(a.data)], { type: a.mime }));
    Files.#urls.set(id, u);
    return u;
  }

  static async #read(file) {
    return new Uint8Array(await file.arrayBuffer());
  }

  static async saveAsset(id) {
    const a = Board.asset(App.b, id);
    if(a) Files.download(a.name || 'file', new Blob([AudioKit.fromB64(a.data)], { type: a.mime }));
  }

  static download(name, blob) {
    DAE.FileIO.download(name, blob);
  }
  //#endregion

  //#region [ Adding files ]
  /** Opens a picker: 'image' | 'widget' | 'replace' (a widget's file) | 'board'. */
  static async pick(kind, at, it = null) {
    const accept = kind === 'image' ? 'image/*' : kind === 'board' ? '.toon,.json,.canvas' : '.toon,.json,.canvas,audio/*,video/mp4,.mp4,.m4a,.mp3,.wav,.ogg,.opus,.flac';
    const files = await DAE.FileIO.pick({ accept, multiple: kind === 'image' || kind === 'widget' });
    if(!files.length) return;
    if(kind === 'board') return Files.#openFile(files[0], null);
    if(kind === 'replace') return Files.#replace(it, files[0]);
    await Files.add(files, at ?? App.center());
  }

  /**
   * Images become image items, tool files and audio become widgets, an Obsidian .canvas is converted
   * (its file nodes are looked up among the files dropped with it); a board file opens. Returns the new ids.
   */
  static async add(files, at) {
    const made = [];
    let dx = 0;
    const canvases = files.filter(f => /\.canvas$/i.test(f.name));
    if(canvases.length) {
      const byName = new Map();
      for(const f of files) byName.set(f.name.toLowerCase(), await Files.#read(f));
      const read = p => byName.get(String(p).split('/').pop().toLowerCase()) ?? null;
      for(const f of canvases) {
        try {
          const src = DAE.Obsidian.fromCanvas(await f.text(), { read }), box = Board.bounds(src.items);
          if(!box) continue;
          App.change(b => made.push(...Board.merge(b, src, at.x + dx - box.x - box.w / 2, at.y - box.y - box.h / 2)));
          dx += box.w + 80;
        }
        catch(err) { alert(`Can't convert ${f.name}:\n${err.message}`); }
      }
      if(made.length) App.select(made);
      return made;
    }
    for(const f of files) {
      try {
        const bytes = await Files.#read(f), mime = f.type || Files.#mime(f.name);
        if(mime.startsWith('image/')) {
          const id = await Files.#image(bytes, mime, f.name, { x: at.x + dx, y: at.y });
          made.push(id);
          dx += 40;
          continue;
        }
        const isText = /\.(toon|json|txt)$/i.test(f.name);
        const text = isText ? new TextDecoder().decode(bytes) : null;
        const kind = Widgets.kindOf(f.name, mime, text);
        if(kind === 'board') {
          if(files.length === 1 && (!App.dirty || confirm(`Open the board "${f.name}"? Unsaved changes here will be lost.`))) Files.#loadText(text, f.name, null);
          continue;
        }
        if(!kind) { alert(`${f.name}: not an image, an Athena map, an Apollo project or an audio file.`); continue; }
        App.change(b => {
          const a = Board.addAsset(b, { name: f.name, mime: isText ? 'text/toon' : mime, data: AudioKit.toB64(bytes) });
          const it = Board.item(b, 'widget', { tool: kind, asset: a.id, name: f.name, audio: null });
          if(kind === 'apollo') Object.assign(it, { h: 140, fit: true });   // the player sets its height once it knows its content
          Object.assign(it, { x: at.x - it.w / 2 + dx, y: at.y - it.h / 2 + dx });
          b.items.push(it);
          made.push(it.id);
        });
        dx += 30;
      }
      catch(err) { alert(`Can't add ${f.name}:\n${err.message}`); }
    }
    if(made.length) App.select(made);
    return made;
  }

  static #mime(name) {
    const ext = name.split('.').pop().toLowerCase();
    return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
      wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4', mp4: 'video/mp4', flac: 'audio/flac', webm: 'audio/webm' }[ext] ?? 'application/octet-stream';
  }

  static async #image(bytes, mime, name, at) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const img = new Image();
    await new Promise((ok, fail) => { img.onload = ok; img.onerror = () => fail(new Error('not a readable image')); img.src = url; });
    URL.revokeObjectURL(url);
    const k = Math.min(1, 480 / Math.max(img.naturalWidth || 240, img.naturalHeight || 180));
    let id = 0;
    App.change(b => {
      const a = Board.addAsset(b, { name, mime, data: AudioKit.toB64(bytes) });
      const w = Math.round((img.naturalWidth || 240) * k), h = Math.round((img.naturalHeight || 180) * k);
      const it = Board.item(b, 'image', { asset: a.id, name, x: at.x - w / 2, y: at.y - h / 2, w, h });
      b.items.push(it);
      id = it.id;
    });
    return id;
  }

  static async #replace(it, f) {
    const bytes = await Files.#read(f), mime = f.type || Files.#mime(f.name), isText = /\.(toon|json|txt)$/i.test(f.name);
    const kind = Widgets.kindOf(f.name, mime, isText ? new TextDecoder().decode(bytes) : null);
    if(kind !== 'athena' && kind !== 'apollo') return alert(`${f.name}: not an Athena map, an Apollo project or an audio file.`);
    App.change(b => {
      const a = Board.addAsset(b, { name: f.name, mime: isText ? 'text/toon' : mime, data: AudioKit.toB64(bytes) });
      Object.assign(it, { tool: kind, asset: a.id, name: f.name, audio: null });
      Board.gc(b);
    });
  }

  /** Pasted text: the copied items (marker), or a note with the text. */
  static pasteText(text, at) {
    if(App.clip && text === App.clipMark) return App.paste(at);
    if(text.trim()) Tools.newNote(at, text.trim());
  }
  //#endregion

  //#region [ Boards ]
  static newBoard() {
    if(App.dirty && !confirm('Start a new board? Unsaved changes will be lost.')) return;
    App.load(Board.create());
  }

  static async open() {
    if(App.dirty && !confirm('Open another board? Unsaved changes will be lost.')) return;
    const f = await DAE.FileIO.open({ types: Files.#types, accept: '.toon,.json,.canvas' });
    if(f) Files.#loadText(f.text, f.name, f.handle);
  }

  static async #openFile(file, handle) {
    Files.#loadText(await file.text(), file.name, handle);
  }

  static #loadText(text, name, handle) {
    try {
      // an Obsidian canvas opens as a new board (its file nodes can't be read from here: they become placeholders)
      if(/\.canvas$/i.test(name) || Board.widgetKind(name, '', text) === 'canvas') {
        App.load(DAE.Obsidian.fromCanvas(text), name.replace(/\.canvas$/i, '') + '.hestia.toon');
        App.setDirty(true);
        return;
      }
      const b = Board.parse(text);
      App.load(b, name.endsWith('.toon') ? name : name.replace(/\.\w+$/, '') + '.hestia.toon', handle);
      Files.remember(name, text);
    }
    catch(err) { alert(`Can't read ${name}:\n${err.message}`); }
  }

  static async save(as = false) {
    const text = Board.stringify(App.b);
    const h = await DAE.FileIO.save(text, { name: App.fileName, types: Files.#types, handle: App.handle, as });
    if(h === undefined) return;
    App.handle = h;
    if(h) App.fileName = h.name;
    App.setDirty(false);
    Files.remember(App.fileName, text);
  }

  static saveJson() {
    Files.download(App.fileName.replace(/\.toon$/, '') + '.json', new Blob([JSON.stringify(App.b)], { type: 'application/json' }));
  }
  //#endregion

  //#region [ Autosave, recent (shared/store.js) ]
  static #store = new DAE.Store('hestia');

  static autosave() {
    Files.#store.later('autosave', () => ({ name: App.fileName, dirty: App.dirty, time: Date.now(), text: Board.stringify(App.b) }));
  }

  static recent() {
    return Files.recentList;
  }

  static remember(name, text) {
    Files.recentList = DAE.Store.push(Files.recentList, { name, time: Date.now(), text });
    Files.#store.set('recent', Files.recentList);
  }

  static openRecent(i) {
    const r = Files.recentList[i];
    if(r) Files.#loadText(r.text, r.name, null);
  }

  /** Boot: recent list, then the last session's board. */
  static async restore() {
    Files.recentList = await Files.#store.get('recent', []);
    const a = await Files.#store.get('autosave');
    if(!a?.text) return false;
    try {
      App.load(Board.parse(a.text), a.name);
      App.setDirty(!!a.dirty);
      return true;
    } catch { return false; }
  }
  //#endregion
}
