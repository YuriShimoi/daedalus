// Open / save (shared/files.js: File System Access API, with upload / download fallback) and the generate dialog.
class Files {
  static handle = null;
  static #types = [{ description: 'Athena map', accept: { 'text/plain': ['.toon'], 'application/json': ['.json'] } }];

  static newMap() {
    if(App.dirty && !confirm('Discard unsaved changes?')) return;
    Files.handle = null;
    App.load(App.starter(), 'untitled.toon');
  }

  static async open() {
    if(App.dirty && !confirm('Discard unsaved changes?')) return;
    const f = await DAE.FileIO.open({ types: Files.#types, accept: '.toon,.json' });
    if(f && Files.#read(f.text, f.name)) Files.handle = f.handle;
  }

  /** Opens a map handed over by another tool (Hestia). */
  static openText(text, name) {
    Files.handle = null;
    return Files.#read(text, name);
  }

  static #read(text, name) {
    try {
      const { Model } = DAE;
      const model = name.endsWith('.json') || text.trimStart().startsWith('{')
        ? Model.fromDoc(Model.toDoc(JSON.parse(text))) : Model.parse(text);
      App.load(model, name.replace(/\.json$/, '.toon'));
      return true;
    }
    catch(err) {
      alert(`Can't read ${name}:\n${err.message}`);
      return false;
    }
  }

  static async save(as = false) {
    let name = App.fileName;
    if(!name.endsWith('.toon')) name += '.toon';
    const h = await DAE.FileIO.save(DAE.Model.stringify(App.toSave()), { name, types: Files.#types, handle: Files.handle, as, ask: true });
    if(h === undefined) return;
    Files.handle = h;
    if(h) App.fileName = h.name;
    App.setDirty(false);
  }

  //#region [ Generate ]
  static #fields = [
    ['seed', 'Seed', 'num'], ['rooms', 'Rooms', 'num'], ['branching', 'Branching', 'num', 0.05], ['deepnest', 'Deep nest', 'num'],
    ['loops', 'Loops', 'num'], ['oneWay', 'One-way share', 'num', 0.1], ['locks', 'Locks', 'num'], ['chests', 'Chests', 'num'],
    ['combos', 'Recipes', 'bool'], ['comboDepth', 'Recipe depth', 'num'], ['enemyDensity', 'Enemy density', 'num', 0.05],
    ['maxWaves', 'Max waves', 'num'], ['itemDensity', 'Item density', 'num', 0.05], ['difficulty', 'Difficulty', 'num', 0.05],
    ['effects', 'Effects', 'bool'], ['invulnRate', 'Invuln rate', 'num', 0.05], ['exits', 'Exits', 'num'], ['iterations', 'Iterations', 'num'],
  ];
  static #last = { ...DAE.Generator.DEFAULTS };

  static #newSeed() {
    return Math.floor(Math.random() * 100000);
  }

  static generateDialog() {
    const $d = document.getElementById('gen-dialog');
    const p = Files.#last;
    p.seed = Files.#newSeed();   // every opening starts from a fresh seed
    $d.innerHTML = `<h3>${DAE.Icons.html('wand-magic-sparkles')} Generate a map</h3>
      <div class="grid">${Files.#fields.map(([k, label, type, step]) => `<div class="row"><label for="g-${k}">${label}</label>${type === 'bool'
        ? `<input type="checkbox" id="g-${k}" ${p[k] ? 'checked' : ''}>`
        : k === 'seed'
          ? `<div class="seed"><input type="number" id="g-seed" value="${p.seed}" step="1"><button id="g-dice" title="New seed">${DAE.Icons.html('dice')}</button></div>`
          : `<input type="number" id="g-${k}" value="${p[k]}" step="${step ?? 1}">`}</div>`).join('')}</div>
      <p class="note" id="g-status">The map is re-rolled with the next seed until the solver finds a route.</p>
      <div class="buttons"><button id="g-cancel">Cancel</button>
        <button class="primary" id="g-go">${DAE.Icons.html('wand-magic-sparkles')} Generate</button></div>`;
    $d.querySelector('#g-dice').onclick = () => { $d.querySelector('#g-seed').value = Files.#newSeed(); };
    $d.querySelector('#g-cancel').onclick = () => $d.close();
    $d.querySelector('#g-go').onclick = () => {
      if(App.dirty && !confirm('Discard unsaved changes?')) return;
      const params = {};
      for(const [k, , type] of Files.#fields) {
        const $i = $d.querySelector('#g-' + k);
        params[k] = type === 'bool' ? $i.checked : Number($i.value);
      }
      Files.#last = params;
      $d.querySelector('#g-status').textContent = 'Generating…';
      setTimeout(() => {
        try {
          Files.#generate(params);
          $d.close();
        }
        catch(err) {
          $d.querySelector('#g-status').textContent = err.message;
        }
      }, 30);
    };
    $d.showModal();
  }

  /** A new map with the last settings and a fresh seed, no dialog. */
  static reroll() {
    if(App.dirty && !confirm('Discard unsaved changes?')) return;
    const $b = document.getElementById('btn-reroll');
    $b.disabled = true;
    document.body.style.cursor = 'progress';
    setTimeout(() => {
      try {
        Files.#last = { ...Files.#last, seed: Files.#newSeed() };
        Files.#generate(Files.#last);
      }
      catch(err) {
        alert(err.message);
      }
      $b.disabled = false;
      document.body.style.cursor = '';
    }, 30);
  }

  /** Loads a generated map. It stays clean: an untouched map can be rebuilt from its seed, so replacing it never asks. */
  static #generate(params) {
    const g = DAE.Generator.generate(params);
    Files.handle = null;
    App.load(g.model, `gen-${g.seed}.toon`);
  }
  //#endregion
}
