// Files: projects, keyboard templates and instrument presets as TOON (File System Access API with
// upload / download fallback), WAV export, autosave and the recent list (localStorage, convenience only).
class Files {
  static handle = null;
  static #types = [{ description: 'Apollo TOON', accept: { 'text/plain': ['.toon'] } }];

  //#region [ Generic text I/O ]
  /** Asks for a text file; returns { name, text } or null. */
  static async pick() {
    if(window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({ types: Files.#types });
        const file = await handle.getFile();
        return { name: file.name, text: await file.text(), handle };
      }
      catch(err) {
        if(err.name === 'AbortError') return null;
      }
    }
    return new Promise(resolve => {
      const $in = document.getElementById('file-input');
      $in.value = '';
      $in.onchange = async () => {
        const file = $in.files[0];
        resolve(file ? { name: file.name, text: await file.text() } : null);
      };
      $in.click();
    });
  }

  /** Saves text; reuses `handle` when given. Returns the handle (or null on download). */
  static async write(name, text, handle = null, as = false) {
    if(window.showSaveFilePicker) {
      try {
        if(as || !handle) handle = await window.showSaveFilePicker({ suggestedName: name, types: Files.#types });
        const w = await handle.createWritable();
        await w.write(text);
        await w.close();
        return handle;
      }
      catch(err) {
        if(err.name === 'AbortError') return undefined;
      }
    }
    Files.download(name, new Blob([text], { type: 'text/plain' }));
    return null;
  }

  static download(name, blob) {
    const $a = document.createElement('a');
    $a.href = URL.createObjectURL(blob);
    $a.download = name;
    $a.click();
    setTimeout(() => URL.revokeObjectURL($a.href), 2000);
  }
  //#endregion

  //#region [ Project ]
  static newProject(mode = App.p?.mode ?? 'music') {
    if(App.dirty && !confirm('Discard unsaved changes?')) return;
    Files.handle = null;
    App.load(DAE.Project.create(mode), 'untitled.toon');
  }

  static async open() {
    if(App.dirty && !confirm('Discard unsaved changes?')) return;
    const f = await Files.pick();
    if(!f) return;
    try {
      App.load(DAE.Project.parse(f.text), f.name.replace(/\.\w+$/, '') + '.toon');
      Files.handle = f.handle ?? null;
    }
    catch(err) {
      alert(`Can't read ${f.name}:\n${err.message}`);
    }
  }

  static async save(as = false) {
    const text = DAE.Project.stringify(App.p);
    const h = await Files.write(App.fileName, text, Files.handle, as);
    if(h === undefined) return;
    Files.handle = h;
    if(h) App.fileName = h.name;
    App.setDirty(false);
    Files.remember(text);
  }
  //#endregion

  //#region [ Local storage ]
  static #get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  }

  static #set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch {}
  }

  static #timer = 0;
  static autosave() {
    clearTimeout(Files.#timer);
    Files.#timer = setTimeout(() => Files.#set('apollo.autosave', { name: App.fileName, mode: App.p.mode, time: Date.now(), text: DAE.Project.stringify(App.p) }), 800);
  }

  /** Recent list: the last 6 saved projects (their text, so they reopen without a file picker). */
  static remember(text) {
    const list = Files.#get('apollo.recent', []).filter(r => r.name !== App.fileName);
    list.unshift({ name: App.fileName, mode: App.p.mode, time: Date.now(), text });
    Files.#set('apollo.recent', list.slice(0, 6));
  }

  static recent() {
    const list = Files.#get('apollo.recent', []);
    const auto = Files.#get('apollo.autosave', null);
    if(auto?.text) list.unshift({ ...auto, name: auto.name + ' (autosave)', auto: true });
    return list;
  }

  static templates() {
    return Files.#get('apollo.templates', []);
  }

  static storeTemplate(tpl) {
    const list = Files.templates().filter(t => t.name !== tpl.name);
    list.unshift(JSON.parse(JSON.stringify(tpl)));
    Files.#set('apollo.templates', list.slice(0, 20));
  }
  //#endregion

  //#region [ Templates and presets ]
  static async saveTemplate(tpl) {
    await Files.write(`${tpl.name.replace(/[^\w-]+/g, '_')}.toon`, DAE.Toon.encode({ apolloKeyboard: tpl }));
    Files.storeTemplate(tpl);
  }

  static async loadTemplate() {
    const f = await Files.pick();
    if(!f) return null;
    try {
      const doc = DAE.Toon.decode(f.text);
      const tpl = DAE.Keymap.normalize(doc.apolloKeyboard ?? doc.keyboard ?? doc);
      Files.storeTemplate(tpl);
      return tpl;
    }
    catch(err) { alert(`Can't read ${f.name}:\n${err.message}`); return null; }
  }

  static async savePreset(obj, name) {
    await Files.write(`${name.replace(/[^\w-]+/g, '_')}.toon`, DAE.Toon.encode({ apolloPreset: obj }));
  }

  static async loadPreset() {
    const f = await Files.pick();
    if(!f) return null;
    try {
      const doc = DAE.Toon.decode(f.text);
      return doc.apolloPreset ?? doc;
    }
    catch(err) { alert(`Can't read ${f.name}:\n${err.message}`); return null; }
  }
  //#endregion

  //#region [ WAV ]
  static #wav(name, channels, rate, bits) {
    Files.download(name.endsWith('.wav') ? name : name + '.wav', new Blob([DAE.Wav.encode(channels, rate, bits)], { type: 'audio/wav' }));
  }

  /** Music: the loop range when looping, else the whole song. Stereo 44.1 kHz 16-bit. */
  static exportSong() {
    const p = App.p, l = p.song.loop, loop = l.on && l.to > l.from;
    const r = DAE.Engine.render(p, DAE.Samples.packs, { from: loop ? l.from : 0, to: loop ? l.to : p.song.bars, loop });
    const base = App.fileName.replace(/\.toon$/, '');
    Files.#wav(loop ? `${base}-loop` : base, [r.L, r.R], 44100, 16);
    if(r.clipped) App.toast(`Exported, but ${r.clipped} samples clipped: lower the master or track volumes.`);
  }

  /** One sound or mix with the project's export settings (mono). */
  static sfxData(id) {
    const ex = App.p.export;
    let x = DAE.Sfxr.renderItem(App.p, id, ex.rate);
    if(ex.normalize) x = DAE.Sfxr.normalize01(x);
    return x;
  }

  static exportSfx(id) {
    const item = App.p.sfx.find(s => s.id === id) ?? App.p.mixes.find(m => m.id === id);
    if(!item) return;
    Files.#wav(item.name, [Files.sfxData(id)], App.p.export.rate, App.p.export.bits);
  }

  /** Several sounds: into a folder when the browser can, else one download each. */
  static async exportMany(ids, folder = 'sounds') {
    const ex = App.p.export;
    const items = ids.map(id => ({ id, item: App.p.sfx.find(s => s.id === id) ?? App.p.mixes.find(m => m.id === id) })).filter(x => x.item);
    if(window.showDirectoryPicker) {
      try {
        const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
        for(const { id, item } of items) {
          const fh = await dir.getFileHandle(item.name + '.wav', { create: true });
          const w = await fh.createWritable();
          await w.write(DAE.Wav.encode([Files.sfxData(id)], ex.rate, ex.bits));
          await w.close();
        }
        App.toast(`${items.length} WAV files written.`);
        return;
      }
      catch(err) {
        if(err.name === 'AbortError') return;
      }
    }
    items.forEach(({ id, item }, i) => setTimeout(() => Files.#wav(item.name, [Files.sfxData(id)], ex.rate, ex.bits), i * 300));
  }
  //#endregion
}
