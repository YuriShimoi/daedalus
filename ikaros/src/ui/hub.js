// Hub: the rail of subtools, the home grid, loading a subtool's files the first time it opens,
// header actions per subtool, recent files, handoffs from other Daedalus tools, drops.
// A subtool's ui.js calls Hub.register(id, { mount(api), show?, hide?, open?(file), drop?(files), keys?(e) }).
class Hub {
  static TOOLS = [
    { id: 'spyglass', name: 'Spyglass', icon: 'ik-spyglass', job: 'TOON / JSON as cards and edges: synced text, search, collapse, paths, convert.', files: ['core.js', 'ui.js'], ext: ['toon', 'json'] },
    { id: 'caliper', name: 'Caliper', icon: 'ik-caliper', job: 'Compare two TOON / JSON files as trees: added, removed, changed, moved.', files: ['../spyglass/core.js', 'core.js', 'ui.js'], ext: [] },
    { id: 'prisma', name: 'Prisma', icon: 'ik-prism', job: 'Every color in files or a whole folder, as a palette with what each one paints.', files: ['core.js', 'ui.js'], ext: ['css', 'scss', 'less', 'sass', 'html', 'htm', 'svg', 'vue'] },
    { id: 'easel', name: 'Easel', icon: 'ik-easel', job: 'Slice a spritesheet by grid or islands, build animations, preview and export.', files: ['../../../../shared/zip.js', '../../../../shared/gif.js', 'core.js', 'ui.js'], ext: ['png', 'gif', 'webp', 'jpg', 'jpeg', 'bmp'] },
    { id: 'jigsaw', name: 'Jigsaw', icon: 'ik-jigsaw', job: 'Encrypt and decrypt: 50+ ciphers, codes and glyph sets, chains, crack helpers.', files: ['core.js', 'ui.js'], ext: [] },
    { id: 'scale', name: 'Scale', icon: 'ik-scale', job: 'Dice D4 to D100, formulas like (3D6+1D12)*2+1D100, odds and a roll history.', files: ['core.js', 'ui.js'], ext: [] },
    { id: 'wheel', name: 'Wheel', icon: 'ik-wheel', job: 'A spinning wheel: items, weights, colors, icons, elimination rounds.', files: ['../metronome/core.js', 'core.js', 'ui.js'], ext: [] },
    { id: 'metronome', name: 'Metronome', icon: 'ik-metronome', job: 'Easing curves and animation templates (Font Awesome style), copy as CSS / JS.', files: ['core.js', 'ui.js'], ext: [] },
  ];

  // the two-tone icons split Font Awesome shapes into two layers; one-color places use the originals
  static MONO = { 'ik-jigsaw': 'puzzle-piece', 'ik-scale': 'scale-balanced', 'ik-wheel': 'dharmachakra' };

  static store = new DAE.Store('ikaros');
  static tools = {};       // registered ui objects
  static #loaded = {};     // id -> Promise
  static #files = new Set();
  static active = null;    // id or null (home)

  static tool(id) {
    return Hub.TOOLS.find(t => t.id === id) ?? null;
  }

  static register(id, ui) {
    Hub.tools[id] = ui;
  }

  //#region [ Loading ]
  static #script(src) {
    if(Hub.#files.has(src)) return Promise.resolve();
    Hub.#files.add(src);
    return new Promise((ok, fail) => {
      const $s = document.createElement('script');
      $s.src = src;
      $s.onload = ok;
      $s.onerror = () => fail(new Error(`could not load ${src}`));
      document.body.append($s);
    });
  }

  static #css(href) {
    if(Hub.#files.has(href)) return;
    Hub.#files.add(href);
    document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href }));
  }

  /** Loads extra files for a tool (e.g. word lists), once. */
  static need(id, file) {
    return Hub.#script(`src/tools/${id}/${file}`);
  }

  static load(id) {
    return Hub.#loaded[id] ??= (async () => {
      const t = Hub.tool(id);
      Hub.#css(`src/tools/${id}/style.css`);
      for(const f of t.files) await Hub.#script(`src/tools/${id}/${f}`);
      const ui = Hub.tools[id];
      if(!ui) throw new Error(`${id} did not register`);
      const $el = document.getElementById(`v-${id}`);
      $el.classList.remove('loading');
      ui.mount(Hub.#api(id, $el));
      return ui;
    })();
  }
  //#endregion

  //#region [ Tool API ]
  static #api(id, $el) {
    const api = {
      id, $el,
      store: Hub.store,
      /** Header buttons: [icon, label, fn, {primary, title, on, menu}] or '|' for a separator. */
      actions(list) { api._actions = list; if(Hub.active === id) Hub.#drawActions(); },
      /** Controls left of the header actions (a DOM node or html). */
      bar(node) { api._bar = node; if(Hub.active === id) Hub.#drawActions(); },
      async get(key, def = null) { return Hub.store.get(`${id}.${key}`, def); },
      set(key, value) { return Hub.store.set(`${id}.${key}`, value); },
      later(key, make, ms) { Hub.store.later(`${id}.${key}`, make, ms); },
      /** Remembers a file in the tool's recent list (text kept when it is not huge). */
      async recent(name, text) {
        const list = await Hub.store.get(`${id}.recent`, []);
        const entry = { name, time: Date.now(), ...(text && text.length < 1.5e6 ? { text } : {}) };
        await Hub.store.set(`${id}.recent`, DAE.Store.push(list, entry, 6));
      },
      toast: Hub.toast,
      title(name) { api._title = name; if(Hub.active === id) Hub.#crumb(); },
    };
    Hub.tools[id].api = api;
    return api;
  }

  static #crumb() {
    const t = Hub.tool(Hub.active);
    const title = t && Hub.tools[t.id]?.api?._title;
    document.getElementById('crumb').innerHTML = t ? `/ <b>${t.name}</b>${title ? ` <span class="muted">· ${Kit.esc(title)}</span>` : ''}` : '';
    document.title = t ? `${t.name} · Ikaros` : 'Ikaros · Daedalus';
  }

  static #drawActions() {
    const $a = document.getElementById('actions'), $b = document.getElementById('tool-bar');
    $a.innerHTML = '';
    $b.innerHTML = '';
    const api = Hub.tools[Hub.active]?.api;
    if(!api) return;
    if(api._bar) typeof api._bar === 'string' ? ($b.innerHTML = api._bar) : $b.append(api._bar);
    for(const a of api._actions ?? []) {
      if(a === '|') { $a.insertAdjacentHTML('beforeend', '<span class="sep"></span>'); continue; }
      const [icon, label, fn, o = {}] = a;
      const $btn = document.createElement('button');
      $btn.className = [o.primary && 'primary', o.on && 'on'].filter(Boolean).join(' ');
      $btn.title = o.title ?? label;
      $btn.innerHTML = `${icon ? Kit.icon(icon) : ''}${label ? `<span>${Kit.esc(label)}</span>` : ''}`;
      $btn.onclick = e => fn(e, $btn);
      $a.append($btn);
    }
  }
  //#endregion

  //#region [ Switching ]
  static async show(id, { file = null, push = true } = {}) {
    if(id && !Hub.tool(id)) id = null;
    const prev = Hub.active;
    if(prev && prev !== id) Hub.tools[prev]?.hide?.();
    Hub.active = id;
    document.querySelectorAll('#stage > .view').forEach($v => $v.classList.toggle('on', $v.id === (id ? `v-${id}` : 'home')));
    document.querySelectorAll('#rail [data-tool]').forEach($b => $b.classList.toggle('on', $b.dataset.tool === (id ?? '')));
    if(push) history.replaceState(null, '', id ? `?tool=${id}` : location.pathname);
    Hub.#crumb();
    Hub.#drawActions();
    if(!id) { Hub.home(); return null; }
    let ui;
    try { ui = await Hub.load(id); }
    catch(e) { Hub.toast(e.message, true); return null; }
    if(Hub.active !== id) return ui;
    Hub.#crumb();
    Hub.#drawActions();
    ui.show?.();
    const used = await Hub.store.get('hub.used', {});
    used[id] = Date.now();
    Hub.store.set('hub.used', used);
    if(file) ui.open?.(file);
    return ui;
  }

  static async home() {
    const used = await Hub.store.get('hub.used', {});
    const $g = document.getElementById('home-grid');
    const list = [...Hub.TOOLS].map((t, i) => ({ ...t, n: i + 1 })).sort((a, b) => (used[b.id] ?? 0) - (used[a.id] ?? 0) || a.n - b.n);
    const rec = await Promise.all(list.map(t => Hub.store.get(`${t.id}.recent`, [])));
    $g.innerHTML = list.map((t, k) => `<div class="card" data-go="${t.id}">
      <div class="t"><i>${Kit.icon(t.icon)}</i>${t.name}</div>
      <div class="d">${Kit.esc(t.job)}</div>
      ${rec[k].length ? `<div class="r">${rec[k].slice(0, 4).map((r, j) => `<button data-recent="${t.id}:${j}" title="${Kit.esc(r.name)}">${Kit.esc(r.name)}</button>`).join('')}</div>` : ''}
    </div>`).join('');
    $g.onclick = async e => {
      const $r = e.target.closest('[data-recent]');
      if($r) {
        e.stopPropagation();
        const [id, j] = $r.dataset.recent.split(':');
        const r = (await Hub.store.get(`${id}.recent`, []))[+j];
        return Hub.show(id, { file: r?.text !== undefined ? { name: r.name, text: r.text } : null });
      }
      const $c = e.target.closest('[data-go]');
      if($c) Hub.show($c.dataset.go);
    };
  }
  //#endregion

  //#region [ Files ]
  static ext(name) {
    return (String(name).toLowerCase().match(/\.([a-z0-9]+)$/) ?? [])[1] ?? '';
  }

  /** Files dropped on the page: the active tool takes them, else the tool that knows the type. */
  static async drop(files) {
    if(!files.length) return;
    const ui = Hub.active && Hub.tools[Hub.active];
    if(ui?.drop) return ui.drop(files);
    const e = Hub.ext(files[0].name);
    const t = Hub.TOOLS.find(x => x.ext.includes(e)) ?? (files[0].type.startsWith('image/') ? Hub.tool('easel') : Hub.tool('spyglass'));
    const tool = await Hub.show(t.id);
    tool?.drop?.(files);
  }

  static toast(msg, bad = false) {
    const $t = document.getElementById('toast');
    $t.textContent = msg;
    $t.classList.toggle('bad', !!bad);
    $t.classList.add('on');
    clearTimeout(Hub.toastTimer);
    Hub.toastTimer = setTimeout(() => $t.classList.remove('on'), bad ? 4000 : 1800);
  }
  //#endregion

  static init() {
    const $rail = document.getElementById('rail'), $stage = document.getElementById('stage');
    $rail.innerHTML = `<button data-tool="" title="Home (Alt+0)">${Kit.icon('house')}</button><span class="rule"></span>`
      + Hub.TOOLS.map((t, i) => `<button data-tool="${t.id}" title="${t.name} (Alt+${i + 1}): ${Kit.esc(t.job)}">${Kit.icon(Hub.MONO[t.icon] ?? t.icon)}</button>`).join('')
      + `<span class="gap"></span><a href="USAGE.md" target="_blank" title="How to use"><button>${Kit.icon('circle-question')}</button></a>`;
    $rail.onclick = e => {
      const $b = e.target.closest('[data-tool]');
      if($b) Hub.show($b.dataset.tool || null);
    };
    for(const t of Hub.TOOLS) $stage.insertAdjacentHTML('beforeend', `<section class="view loading" id="v-${t.id}"></section>`);
    document.getElementById('home-link').onclick = e => { e.preventDefault(); Hub.show(null); };
  }
}
