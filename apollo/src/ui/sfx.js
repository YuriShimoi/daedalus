// SFX maker: generators, the current sound's wave + params (with locks), sounds list, layer mixer,
// variant sets and export settings.
class Sfx {
  static tab = 'mix';
  static setSel = 0;
  static #cache = { key: '', data: null };

  static newId() {
    const p = App.p;
    return DAE.Project.nextId([...p.sfx, ...p.mixes, ...p.sets]);
  }

  static get current() {
    return App.p.sfx.find(s => s.id === App.sfxSel) ?? null;
  }

  static get currentMix() {
    return App.p.mixes.find(m => m.id === App.sfxSel) ?? null;
  }

  /** Rendered data of the selected item (cached by its content). */
  static data(id = App.sfxSel) {
    const item = App.p.sfx.find(s => s.id === id) ?? App.p.mixes.find(m => m.id === id);
    if(!item) return new Float32Array(0);
    const key = JSON.stringify([item, App.p.mixes.some(m => m.id === id) ? App.p.sfx : null]);
    if(Sfx.#cache.key !== key) Sfx.#cache = { key, data: DAE.Sfxr.normalize01(DAE.Sfxr.renderItem(App.p, id, 44100)) };
    return Sfx.#cache.data;
  }

  static play(semis = 0) {
    Audio.playBuffer(Sfx.data(), 44100, semis);
  }

  static #name(gen) {
    const used = new Set(App.p.sfx.map(s => s.name));
    for(let i = 1; ; i++) { const n = `${gen}_${String(i).padStart(2, '0')}`; if(!used.has(n)) return n; }
  }

  /** New sound from a generator; locked params come from the current sound. */
  static generate(gen) {
    const cur = Sfx.current, seed = Math.floor(Math.random() * 1e6);
    const locks = cur?.locks ?? [];
    App.change(p => {
      const s = { id: Sfx.newId(), name: Sfx.#name(gen), gen, seed, params: DAE.Sfxr.generate(gen, seed, locks, cur?.params), locks: [...locks] };
      p.sfx.push(s);
      App.sfxSel = s.id;
    }, 'none');
    Sfx.play();
  }

  static mutate() {
    const s = Sfx.current;
    if(!s) return;
    App.change(() => { s.params = DAE.Sfxr.mutate(s.params, Math.floor(Math.random() * 1e6), s.locks); }, 'none');
    Sfx.play();
  }

  static render() {
    const p = App.p;
    if(!p.sfx.length) {   // a first sound to play with
      const seed = 4127;
      p.sfx.push({ id: Sfx.newId(), name: 'laser_01', gen: 'laser', seed, params: DAE.Sfxr.generate('laser', seed), locks: [] });
      App.sfxSel = p.sfx[0].id;
    }
    if(!App.p.sfx.some(s => s.id === App.sfxSel) && !App.p.mixes.some(m => m.id === App.sfxSel)) App.sfxSel = p.sfx[0].id;
    Sfx.#left();
    Sfx.#main();
    Sfx.#right();
  }

  //#region [ Left: generators + sounds ]
  static #left() {
    const p = App.p, $l = document.getElementById('sfx-left');
    const items = [...p.sfx.map(s => ({ id: s.id, name: s.name, kind: s.gen })), ...p.mixes.map(m => ({ id: m.id, name: m.name, kind: 'mix' }))];
    $l.innerHTML = `<div class="section">Generate</div>
      <div class="gens">${DAE.Sfxr.GENERATORS.map(g => `<button data-gen="${g}">${g}</button>`).join('')}
        ${DAE.Sfxr.EXTRA_GENERATORS.map(g => `<button class="adv" data-gen="${g}">${g}</button>`).join('')}</div>
      <div class="section">Sounds</div>
      <div class="bank">${items.map(x => `<div data-item="${x.id}" class="${x.id === App.sfxSel ? 'on' : ''}"><span title="${UI.esc(x.kind)} · double-click to rename">${UI.esc(x.name)}</span>
        <button data-play="${x.id}" title="Play">${UI.icon('play')}</button><button class="adv" data-dup="${x.id}" title="Duplicate">${UI.icon('clone')}</button>
        <button data-del="${x.id}" title="Delete">${UI.icon('trash')}</button></div>`).join('')}</div>`;
    $l.querySelectorAll('[data-gen]').forEach($b => $b.onclick = () => Sfx.generate($b.dataset.gen));
    $l.querySelectorAll('[data-item]').forEach($d => {
      $d.onclick = () => { App.sfxSel = Number($d.dataset.item); App.render(); Sfx.play(); };
      $d.querySelector('span').ondblclick = e => { e.stopPropagation(); Sfx.rename(Number($d.dataset.item)); };
    });
    $l.querySelectorAll('[data-play]').forEach($b => $b.onclick = e => { e.stopPropagation(); Audio.playBuffer(Sfx.data(Number($b.dataset.play)), 44100); });
    $l.querySelectorAll('[data-dup]').forEach($b => $b.onclick = e => {
      e.stopPropagation();
      const src = [...App.p.sfx, ...App.p.mixes].find(x => x.id === Number($b.dataset.dup));
      App.change(q => {
        const c = { ...JSON.parse(JSON.stringify(src)), id: Sfx.newId(), name: src.name + '_copy' };
        (src.layers ? q.mixes : q.sfx).push(c);
        App.sfxSel = c.id;
      }, 'none');
    });
    $l.querySelectorAll('[data-del]').forEach($b => $b.onclick = e => {
      e.stopPropagation();
      const id = Number($b.dataset.del);
      App.change(q => {
        q.sfx = q.sfx.filter(x => x.id !== id);
        q.mixes = q.mixes.filter(x => x.id !== id);
        for(const m of q.mixes) for(const l of m.layers) if(l.sfx === id) l.sfx = 0;
        for(const st of q.sets) st.items = st.items.filter(x => x !== id);
      }, 'none');
    });
  }

  static rename(id) {
    const item = [...App.p.sfx, ...App.p.mixes, ...App.p.sets].find(x => x.id === id);
    const name = item && prompt('Name', item.name);
    if(name) App.change(() => { item.name = name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 40); }, 'none');
  }
  //#endregion

  //#region [ Main: current sound ]
  static #main() {
    const $m = document.getElementById('sfx-main'), s = Sfx.current, mix = Sfx.currentMix;
    const data = Sfx.data(), ex = App.p.export;
    const info = DAE.Sfxr.info(DAE.Sfxr.renderItem(App.p, App.sfxSel, ex.rate), ex.rate, ex.bits);
    const head = `<div class="acts">
        <button class="play" id="sx-play" title="Play (Space)">${UI.icon('play')}</button>
        <input class="name" id="sx-name" value="${UI.esc((s ?? mix)?.name ?? '')}" title="Name (also the WAV file name)">
        ${s ? `<small class="adv" style="color:var(--muted);font-family:var(--mono)">${UI.esc(s.gen)} · seed ${s.seed}</small>` : ''}
        <span class="sp"></span>
        ${s ? `<button id="sx-random">${UI.icon('dice')} Random</button><button id="sx-mutate">${UI.icon('wand-magic-sparkles')} Mutate</button>
          <button class="adv" id="sx-lockall" title="Lock / unlock every param">${UI.icon(s.locks.length ? 'lock-open' : 'lock')} ${s.locks.length ? 'Unlock all' : 'Lock all'}</button>
          <button class="adv" id="sx-var" title="Make mutated variants of this sound into a set">${UI.icon('clone')} Variants</button>` : ''}
      </div>
      <canvas class="wave" id="sx-wave" width="1000" height="120" title="Click to play"></canvas>
      <div class="info adv"><span>length <b>${info.seconds.toFixed(2)} s</b></span><span>samples <b>${info.samples}</b></span><span>size <b>${(info.bytes / 1024).toFixed(1)} KB</b></span>
        <span>peak <b>${Number.isFinite(info.peakDb) ? info.peakDb.toFixed(1) : '-∞'} dB</b></span><span class="${info.clipped ? 'bad' : ''}">clipped <b>${info.clipped}</b></span>
        <span>export <b>${ex.rate / 1000}k ${ex.bits}-bit${ex.normalize ? ' norm' : ''}</b></span></div>`;
    if(!s) {
      $m.innerHTML = head + `<p class="hint">A mix: edit its layers in the Mixer panel (Full).</p>`;
    }
    else {
      const groups = {};
      for(const prm of DAE.Sfxr.PARAMS) (groups[prm[2]] ??= []).push(prm);
      const pg = Object.entries(groups).map(([g, list]) => {
        const simple = list.some(x => DAE.Sfxr.SIMPLE.includes(x[0]));
        return `<div class="${simple ? '' : 'adv'}"><div class="section">${g}</div>${list.map(([k, label, , signed]) => {
          const on = s.locks.includes(k), v = s.params[k];
          return `<label class="pf${on ? ' locked' : ''}${DAE.Sfxr.SIMPLE.includes(k) ? '' : ' adv'}"><button class="lk adv${on ? ' on' : ''}" data-lock="${k}" title="${on ? 'Locked: random and mutate keep it' : 'Lock'}">${UI.icon(on ? 'lock' : 'lock-open')}</button>${label}
            <input type="range" data-p="${k}" min="${signed ? -1 : 0}" max="1" step="0.001" value="${v}"><b>${v.toFixed(2)}</b></label>`;
        }).join('')}</div>`;
      }).join('');
      const waves = DAE.Sfxr.WAVES.map((w, i) => `<button data-w="${w}" class="${w === s.params.wave || (w === 'triangle' && s.params.wave === 'tri') || (w === '1-bit' && s.params.wave === 'metal') ? 'on' : ''}${i > 4 ? ' adv' : ''}">${w}</button>`).join('');
      $m.innerHTML = head + `<div class="wtypes">${waves}</div><div class="pgroups">${pg}</div>`;
    }
    Sfx.#drawWave(data);
    const $ = id => document.getElementById(id);
    $('sx-play').onclick = () => Sfx.play();
    $('sx-wave').onclick = () => Sfx.play();
    $('sx-name').onchange = e => { const it = s ?? mix; App.change(() => { it.name = e.target.value.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 40) || it.name; }, 'none'); };
    if(!s) return;
    $('sx-random').onclick = () => Sfx.generate('random');
    $('sx-mutate').onclick = () => Sfx.mutate();
    $('sx-lockall').onclick = () => App.change(() => { s.locks = s.locks.length ? [] : DAE.Sfxr.PARAMS.map(x => x[0]); }, 'none');
    $('sx-var').onclick = () => Sfx.variants(s);
    $m.querySelectorAll('[data-w]').forEach($b => $b.onclick = () => { App.change(() => { s.params.wave = $b.dataset.w; }, 'none'); Sfx.play(); });
    $m.querySelectorAll('[data-lock]').forEach($b => $b.onclick = e => {
      e.preventDefault();
      const k = $b.dataset.lock;
      App.change(() => { s.locks = s.locks.includes(k) ? s.locks.filter(x => x !== k) : [...s.locks, k]; }, 'none');
    });
    $m.querySelectorAll('[data-p]').forEach($i => {
      let started = false;
      $i.oninput = () => {
        if(!started) { App.begin(); started = true; }
        s.params[$i.dataset.p] = Number($i.value);
        $i.nextElementSibling.textContent = Number($i.value).toFixed(2);
        App.live('none');
      };
      $i.onchange = () => { started = false; App.render(); Sfx.play(); };
    });
  }

  static #drawWave(x) {
    const $c = document.getElementById('sx-wave');
    if(!$c) return;
    const g = $c.getContext('2d'), W = $c.width, H = $c.height;
    g.clearRect(0, 0, W, H);
    g.strokeStyle = '#44475A';
    g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
    if(!x.length) return;
    g.fillStyle = '#C0C6D0';
    const per = x.length / W;
    for(let px = 0; px < W; px++) {
      let lo = 1, hi = -1;
      const a = Math.floor(px * per), b = Math.max(a + 1, Math.floor((px + 1) * per));
      for(let i = a; i < b && i < x.length; i++) { if(x[i] < lo) lo = x[i]; if(x[i] > hi) hi = x[i]; }
      if(hi < lo) continue;
      g.fillRect(px, H / 2 - hi * H * 0.45, 1, Math.max(1, (hi - lo) * H * 0.45));
    }
  }
  //#endregion

  //#region [ Right: mixer, sets, export ]
  static variants(s, n = 6) {
    const base = s.name.replace(/_\d+$/, '');
    App.change(p => {
      const ids = [];
      for(let i = 1; i <= n; i++) {
        const v = { id: Sfx.newId(), name: `${base}_v${i}`, gen: s.gen, seed: s.seed, params: DAE.Sfxr.mutate(s.params, s.seed * 31 + i, s.locks, 0.08), locks: [...s.locks] };
        p.sfx.push(v);
        ids.push(v.id);
      }
      const st = { id: Sfx.newId(), name: `${base}_set`, items: [s.id, ...ids] };
      p.sets.push(st);
      Sfx.setSel = st.id;
      Sfx.tab = 'sets';
    }, 'none');
  }

  static #right() {
    const p = App.p, $r = document.getElementById('sfx-right'), ex = p.export;
    const sounds = p.sfx;
    const opt = (sel) => `<option value="0">(empty)</option>` + sounds.map(s => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${UI.esc(s.name)}</option>`).join('');
    let body;
    if(Sfx.tab === 'mix') {
      const mix = Sfx.currentMix;
      if(!mix) body = `<p class="note-p">A mix layers up to 5 sounds, each with its own delay and volume, into one sound.</p>
        <button id="mx-new" class="mt">${UI.icon('layer-group')} New mix from this sound</button>`;
      else {
        const layers = Array.from({ length: 5 }, (_, i) => mix.layers[i] ?? { sfx: 0, delay: 0, vol: 100 });
        const len = layers.reduce((m, l) => { const s = p.sfx.find(x => x.id === l.sfx); return s ? Math.max(m, l.delay + DAE.Sfxr.render(s.params, s.seed, 11025).length / 11.025) : m; }, 1);
        body = `<div class="section">${UI.esc(mix.name)} · ${mix.layers.filter(l => l.sfx).length} layers</div><div class="mix">${layers.map((l, i) => {
          const s = p.sfx.find(x => x.id === l.sfx), w = s ? DAE.Sfxr.render(s.params, s.seed, 11025).length / 11.025 : 0;
          return `<div class="tr${s ? '' : ' off'}"><b style="font-family:var(--mono);color:var(--muted)">${i + 1}</b>
            <select data-ls="${i}">${opt(l.sfx)}</select><input type="number" data-lv="${i}" value="${l.vol}" min="0" max="200" title="Volume %">
            <span class="dl"><input type="number" data-ld="${i}" value="${l.delay}" min="0" step="10" title="Delay (ms)">ms<span class="lane">${s ? `<i style="left:${l.delay / len * 100}%;width:${w / len * 100}%;background:${layerColor(i)}"></i>` : ''}</span></span></div>`;
        }).join('')}</div><button id="mx-play" class="mt">${UI.icon('play')} Play mix</button>`;
      }
    }
    else {
      const st = p.sets.find(x => x.id === Sfx.setSel) ?? p.sets[0];
      if(st) Sfx.setSel = st.id;
      body = `<div class="bank">${p.sets.length ? p.sets.map(x => `<div data-set="${x.id}" class="${x.id === Sfx.setSel ? 'on' : ''}"><span>${UI.esc(x.name)}</span><small>x${x.items.length}</small>
          <button data-setplay="${x.id}" title="Play a random item">${UI.icon('dice')}</button><button data-setdel="${x.id}" title="Delete set">${UI.icon('trash')}</button></div>`).join('')
          : '<div class="empty">No sets yet. "Variants" makes one from the current sound.</div>'}</div>
        ${st ? `<div class="section mt">${UI.esc(st.name)}</div><div class="bank">${st.items.map(id => {
          const it = [...p.sfx, ...p.mixes].find(x => x.id === id);
          return it ? `<div data-si="${id}"><span>${UI.esc(it.name)}</span><button data-siplay="${id}">${UI.icon('play')}</button><button data-sirm="${id}" title="Remove from set">${UI.icon('xmark')}</button></div>` : '';
        }).join('')}</div><button id="set-add" class="mt">${UI.icon('plus')} Add current sound</button>` : ''}
        <p class="note-p">A set groups variants (e.g. 6 footsteps) the game picks from at random. Export writes one WAV per item.</p>`;
    }
    $r.innerHTML = `<div class="tabs" style="display:inline-flex;margin-bottom:10px"><button data-tab="mix" class="${Sfx.tab === 'mix' ? 'on' : ''}">Mixer</button>
        <button data-tab="sets" class="${Sfx.tab === 'sets' ? 'on' : ''}">Sets</button></div>${body}
      <div class="section mt">Export</div>
      <div class="opts">
        <span>format</span><div class="seg">${Object.entries(Files.FORMATS).map(([f, x]) => `<button data-format="${f}" class="${ex.format === f ? 'on' : ''}" title="${x.title}">${x.label}</button>`).join('')}</div>
        <span class="${ex.format === 'opus' ? 'off' : ''}">rate</span><div class="seg${ex.format === 'opus' ? ' off' : ''}">${[44100, 22050, 11025, 8000].map(r => `<button data-rate="${r}" class="${ex.rate === r ? 'on' : ''}">${Math.round(r / 1000)}k</button>`).join('')}</div>
        <span class="${ex.format === 'opus' ? 'off' : ''}">bits</span><div class="seg${ex.format === 'opus' ? ' off' : ''}">${[16, 8].map(b => `<button data-bits="${b}" class="${ex.bits === b ? 'on' : ''}">${b}</button>`).join('')}</div>
        <span>normalize</span><div class="seg"><button data-norm="1" class="${ex.normalize ? 'on' : ''}">on</button><button data-norm="0" class="${ex.normalize ? '' : 'on'}">off</button></div>
      </div>
      <div class="chips" style="margin-top:10px">
        <button class="primary" id="ex-one">${UI.icon('file-export')} ${Files.FORMATS[ex.format].label}</button>
        <button id="ex-many" title="${Sfx.tab === 'sets' && Sfx.setSel ? 'Every item of the set' : 'Every sound and mix'}">${Sfx.tab === 'sets' && Sfx.setSel ? 'Whole set' : 'All sounds'}</button>
        <button id="ex-copy" title="Copy params as text">${UI.icon('copy')}</button><button id="ex-paste" title="Paste params from text">${UI.icon('paste')}</button>
      </div>`;
    Sfx.#bindRight($r);
  }

  static #bindRight($r) {
    const p = App.p, mix = Sfx.currentMix, ex = p.export;
    $r.querySelectorAll('[data-tab]').forEach($b => $b.onclick = () => { Sfx.tab = $b.dataset.tab; Sfx.#right(); });
    $r.querySelector('#mx-new')?.addEventListener('click', () => App.change(q => {
      const m = { id: Sfx.newId(), name: (Sfx.current?.name ?? 'mix') + '_mix', layers: [{ sfx: Sfx.current?.id ?? 0, delay: 0, vol: 100 }] };
      q.mixes.push(m);
      App.sfxSel = m.id;
    }, 'none'));
    $r.querySelector('#mx-play')?.addEventListener('click', () => Sfx.play());
    const layer = i => { while(mix.layers.length <= i) mix.layers.push({ sfx: 0, delay: 0, vol: 100 }); return mix.layers[i]; };
    $r.querySelectorAll('[data-ls]').forEach($s => $s.onchange = () => App.change(() => { layer(Number($s.dataset.ls)).sfx = Number($s.value); }, 'none'));
    $r.querySelectorAll('[data-lv]').forEach($s => $s.onchange = () => App.change(() => { layer(Number($s.dataset.lv)).vol = Math.max(0, Number($s.value) || 0); }, 'none'));
    $r.querySelectorAll('[data-ld]').forEach($s => $s.onchange = () => App.change(() => { layer(Number($s.dataset.ld)).delay = Math.max(0, Number($s.value) || 0); }, 'none'));
    $r.querySelectorAll('[data-set]').forEach($d => {
      $d.onclick = () => { Sfx.setSel = Number($d.dataset.set); Sfx.#right(); };
      $d.querySelector('span').ondblclick = () => Sfx.rename(Number($d.dataset.set));
    });
    $r.querySelectorAll('[data-setplay]').forEach($b => $b.onclick = e => {
      e.stopPropagation();
      const st = p.sets.find(x => x.id === Number($b.dataset.setplay));
      if(st?.items.length) Audio.playBuffer(Sfx.data(st.items[Math.floor(Math.random() * st.items.length)]), 44100);
    });
    $r.querySelectorAll('[data-setdel]').forEach($b => $b.onclick = e => { e.stopPropagation(); App.change(q => { q.sets = q.sets.filter(x => x.id !== Number($b.dataset.setdel)); }, 'none'); });
    $r.querySelectorAll('[data-siplay]').forEach($b => $b.onclick = () => Audio.playBuffer(Sfx.data(Number($b.dataset.siplay)), 44100));
    $r.querySelectorAll('[data-sirm]').forEach($b => $b.onclick = () => App.change(q => {
      const st = q.sets.find(x => x.id === Sfx.setSel);
      st.items = st.items.filter(x => x !== Number($b.dataset.sirm));
    }, 'none'));
    $r.querySelector('#set-add')?.addEventListener('click', () => App.change(q => {
      const st = q.sets.find(x => x.id === Sfx.setSel);
      if(!st.items.includes(App.sfxSel)) st.items.push(App.sfxSel);
    }, 'none'));
    $r.querySelectorAll('[data-format]').forEach($b => $b.onclick = () => App.change(() => { ex.format = $b.dataset.format; }, 'none'));
    $r.querySelectorAll('[data-rate]').forEach($b => $b.onclick = () => App.change(() => { ex.rate = Number($b.dataset.rate); }, 'none'));
    $r.querySelectorAll('[data-bits]').forEach($b => $b.onclick = () => App.change(() => { ex.bits = Number($b.dataset.bits); }, 'none'));
    $r.querySelectorAll('[data-norm]').forEach($b => $b.onclick = () => App.change(() => { ex.normalize = $b.dataset.norm === '1'; }, 'none'));
    $r.querySelector('#ex-one').onclick = () => Files.exportSfx(App.sfxSel);
    $r.querySelector('#ex-many').onclick = () => {
      const st = Sfx.tab === 'sets' ? p.sets.find(x => x.id === Sfx.setSel) : null;
      Files.exportMany(st ? st.items : [...p.sfx, ...p.mixes].map(x => x.id));
    };
    $r.querySelector('#ex-copy').onclick = async () => {
      const s = Sfx.current;
      if(!s) return;
      const text = 'apollo-sfx:' + btoa(JSON.stringify({ name: s.name, gen: s.gen, seed: s.seed, params: s.params }));
      try { await navigator.clipboard.writeText(text); App.toast('Params copied.'); }
      catch { prompt('Copy this code', text); }
    };
    $r.querySelector('#ex-paste').onclick = async () => {
      let text = '';
      try { text = await navigator.clipboard.readText(); } catch {}
      if(!text.startsWith('apollo-sfx:')) text = prompt('Paste an apollo-sfx code') ?? '';
      if(!text.startsWith('apollo-sfx:')) return;
      try {
        const raw = JSON.parse(atob(text.slice(11)));
        App.change(q => { const s = DAE.Sfxr.normalize({ ...raw, id: Sfx.newId() }); q.sfx.push(s); App.sfxSel = s.id; }, 'none');
        Sfx.play();
      }
      catch { App.toast('Not a valid code.'); }
    };
  }
  //#endregion
}

const layerColor = i => DAE.Project.COLORS[i % 8];
