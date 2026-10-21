// Files: projects, keyboard templates and instrument presets as TOON (shared/files.js: File System
// Access API with upload / download fallback), WAV / Opus export, autosave, recent list and templates
// (shared/store.js, IndexedDB; loaded into a cache by init() so the UI reads them right away).
class Files {
  static handle = null;
  static #types = [{ description: 'Apollo TOON', accept: { 'text/plain': ['.toon'] } }];

  //#region [ Generic text I/O ]
  /** Asks for a text file; returns { name, text, handle } or null. */
  static pick() {
    return DAE.FileIO.open({ types: Files.#types, accept: '.toon' });
  }

  /** Saves text; reuses `handle` when given. Returns the handle, null on download, undefined when cancelled. */
  static write(name, text, handle = null, as = false) {
    return DAE.FileIO.save(text, { name, types: Files.#types, handle, as });
  }

  static download(name, blob) {
    DAE.FileIO.download(name, blob);
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

  //#region [ Stored lists ]
  static #store = new DAE.Store('apollo');
  static #cache = { recent: [], autosave: null, templates: [] };

  /** Loads the stored lists (moving the old localStorage ones over once). Call before the start screen. */
  static async init() {
    await Files.#store.adopt({ 'apollo.recent': 'recent', 'apollo.autosave': 'autosave', 'apollo.templates': 'templates' });
    for(const k of ['recent', 'autosave', 'templates']) Files.#cache[k] = await Files.#store.get(k, Files.#cache[k]);
  }

  static autosave() {
    Files.#cache.autosave = { name: App.fileName, mode: App.p.mode, time: Date.now(), text: DAE.Project.stringify(App.p) };
    Files.#store.later('autosave', () => Files.#cache.autosave);
  }

  /** Recent list: the last 6 saved projects (their text, so they reopen without a file picker). */
  static remember(text) {
    Files.#cache.recent = DAE.Store.push(Files.#cache.recent, { name: App.fileName, mode: App.p.mode, time: Date.now(), text });
    Files.#store.set('recent', Files.#cache.recent);
  }

  static recent() {
    const list = [...Files.#cache.recent], auto = Files.#cache.autosave;
    if(auto?.text) list.unshift({ ...auto, name: auto.name + ' (autosave)', auto: true });
    return list;
  }

  static templates() {
    return Files.#cache.templates;
  }

  static storeTemplate(tpl) {
    Files.#cache.templates = DAE.Store.push(Files.#cache.templates, JSON.parse(JSON.stringify(tpl)), 20);
    Files.#store.set('templates', Files.#cache.templates);
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

  //#region [ Audio export ]
  static FORMATS = { wav: { label: 'WAV', ext: 'wav', title: 'lossless' }, opus: { label: 'Opus', ext: 'opus', title: 'small file, 48 kHz' } };

  /** Encoded file for float channels: WAV at `rate` / `bits`, or Opus (channels must be 48 kHz). */
  static async #encode(chs, rate, bits, format) {
    if(format === 'opus') {
      if(await DAE.Opus.supported(chs.length)) return { data: await DAE.Opus.encode(chs), ext: 'opus', mime: 'audio/ogg' };
      App.toast('This browser has no Opus encoder: exported as WAV.');
    }
    return { data: DAE.Wav.encode(chs, rate, bits), ext: 'wav', mime: 'audio/wav' };
  }

  static #save(base, f) {
    Files.download(`${base}.${f.ext}`, new Blob([f.data], { type: f.mime }));
  }

  /** Music: the loop range when looping, else the whole song. Stereo 44.1 kHz 16-bit WAV, or Opus at 48 kHz. */
  static async exportSong(format = App.p.export.format) {
    const p = App.p, l = p.song.loop, loop = l.on && l.to > l.from, sr = format === 'opus' ? 48000 : 44100;
    const r = DAE.Engine.render(p, DAE.Samples.packs, { sr, from: loop ? l.from : 0, to: loop ? l.to : p.song.bars, loop });
    const base = App.fileName.replace(/\.toon$/, '');
    Files.#save(loop ? `${base}-loop` : base, await Files.#encode([r.L, r.R], sr, 16, format));
    if(r.clipped) App.toast(`Exported, but ${r.clipped} samples clipped: lower the master or track volumes.`);
  }

  /** One sound or mix with the project's export settings (mono), at `rate`. */
  static sfxData(id, rate = App.p.export.rate) {
    let x = DAE.Sfxr.renderItem(App.p, id, rate);
    if(App.p.export.normalize) x = DAE.Sfxr.normalize01(x);
    return x;
  }

  static async #sfxFile(id, format) {
    const ex = App.p.export, rate = format === 'opus' ? 48000 : ex.rate;
    return Files.#encode([Files.sfxData(id, rate)], rate, ex.bits, format);
  }

  static async exportSfx(id, format = App.p.export.format) {
    const item = App.p.sfx.find(s => s.id === id) ?? App.p.mixes.find(m => m.id === id);
    if(item) Files.#save(item.name, await Files.#sfxFile(id, format));
  }

  /** Several sounds: into a folder when the browser can, else one download each. */
  static async exportMany(ids, format = App.p.export.format) {
    const items = ids.map(id => ({ id, item: App.p.sfx.find(s => s.id === id) ?? App.p.mixes.find(m => m.id === id) })).filter(x => x.item);
    const files = [];
    for(const { id, item } of items) {
      const f = await Files.#sfxFile(id, format);
      files.push({ name: `${item.name}.${f.ext}`, data: f.data });
    }
    if(await DAE.FileIO.saveMany(files, { mime: 'audio/*' })) App.toast(`${files.length} files written.`);
  }

  /** Header export button: picks the format, then exports the song or the current sound. */
  static exportMenu(e) {
    const r = e.currentTarget.getBoundingClientRect(), sfx = App.mode === 'sfx';
    const run = f => { App.change(p => { p.export.format = f; }, 'none'); sfx ? Files.exportSfx(App.sfxSel, f) : Files.exportSong(f); };
    DAE.Menu.show(r.left, r.bottom + 4, [
      sfx ? 'Export the sound' : App.p.song.loop.on ? 'Export the loop' : 'Export the song',
      ['file-audio', `WAV · ${Files.FORMATS.wav.title}`, () => run('wav'), { on: App.p.export.format === 'wav' }],
      ['file-audio', `Opus · ${Files.FORMATS.opus.title}`, () => run('opus'), { on: App.p.export.format === 'opus' }],
    ]);
  }
  //#endregion
}
