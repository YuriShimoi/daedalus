// Keyboard bar: on-screen keys bound to physical keys (learn mode), per-key tuning, templates (TOON),
// octave shift, live play into the selected track (music) or the current sound (sfx), and recording.
class Keyboard {
  static shift = 0;          // octave shift in semitones
  static kSel = 0;           // key selected for editing
  static learning = false;
  static layout = null;      // physical code -> character on the user's layout (when the browser tells)
  static #down = new Map();  // code -> { id, i, at (song step) }
  static #n = 0;

  static init() {
    navigator.keyboard?.getLayoutMap?.().then(m => { Keyboard.layout = m; if(App.p) Keyboard.render(); }).catch(() => {});
  }

  static label(code) {
    const ch = Keyboard.layout?.get(code);
    return ch ? ch.toUpperCase() : DAE.Keymap.label(code);
  }

  static get tpl() { return App.p.keyboard; }

  static render() {
    Keyboard.#ctl();
    Keyboard.#piano();
    Keyboard.#keyed();
  }

  static #ctl() {
    const tpl = Keyboard.tpl, stored = Files.templates().filter(t => !DAE.Keymap.BUILTIN.includes(t.name));
    const names = [...DAE.Keymap.BUILTIN, ...stored.map(t => t.name)];
    if(!names.includes(tpl.name)) names.push(tpl.name);
    const $c = document.getElementById('kbd-ctl');
    $c.innerHTML = `<div class="section" style="margin:0">Keyboard</div>
      <select id="kb-tpl" title="Keyboard template">${names.map(n => `<option ${n === tpl.name ? 'selected' : ''}>${UI.esc(n)}</option>`).join('')}</select>
      <div class="group adv">
        <button class="learn${Keyboard.learning ? ' on' : ''}" id="kb-learn" title="Click a key, then press a physical key">Learn</button>
        <button id="kb-load" title="Load template (.toon)">${UI.icon('folder-open')}</button>
        <button id="kb-save" title="Save template (.toon)">${UI.icon('floppy-disk')}</button>
        <button id="kb-dup" title="Copy as a new template">${UI.icon('clone')}</button>
      </div>
      <div class="group"><label>Octave</label><button id="kb-down" title="Octave down (${Keyboard.label(tpl.octDown)})">−</button>
        <b style="font-family:var(--mono);min-width:26px;text-align:center">${DAE.Theory.name(tpl.root + Keyboard.shift)}</b>
        <button id="kb-up" title="Octave up (${Keyboard.label(tpl.octUp)})">+</button>
        <button class="rec mo${App.rec ? ' on' : ''}" id="kb-rec" title="Record what you play into the pattern while the song plays">● Rec</button></div>`;
    const $ = id => document.getElementById(id);
    $('kb-tpl').onchange = e => {
      const name = e.target.value, saved = Files.templates().find(t => t.name === name);
      App.change(p => { p.keyboard = saved ? DAE.Keymap.normalize(saved) : DAE.Keymap.make(name, p.keyboard.root); }, 'none');
    };
    $('kb-learn').onclick = () => { Keyboard.learning = !Keyboard.learning; Keyboard.render(); };
    $('kb-save').onclick = () => {
      const name = prompt('Template name', DAE.Keymap.BUILTIN.includes(tpl.name) ? 'my keys' : tpl.name);
      if(!name) return;
      App.change(p => { p.keyboard.name = name; }, 'none');
      Files.saveTemplate(App.p.keyboard).then(() => Keyboard.render());
    };
    $('kb-load').onclick = async () => {
      const t = await Files.loadTemplate();
      if(t) App.change(p => { p.keyboard = t; }, 'none');
    };
    $('kb-dup').onclick = () => {
      const name = prompt('New template name', tpl.name + ' copy');
      if(!name) return;
      App.change(p => { p.keyboard.name = name; }, 'none');
      Files.storeTemplate(App.p.keyboard);
      Keyboard.render();
    };
    $('kb-down').onclick = () => Keyboard.octave(-12);
    $('kb-up').onclick = () => Keyboard.octave(12);
    $('kb-rec').onclick = () => { App.rec = !App.rec; Keyboard.render(); };
  }

  static octave(d) {
    Keyboard.shift = Math.max(-36, Math.min(36, Keyboard.shift + d));
    Keyboard.#ctl();
    Keyboard.#piano();
  }

  static #piano() {
    const tpl = Keyboard.tpl, keys = tpl.keys;
    const whites = keys.filter(k => !DAE.Theory.isBlack(k.note)).length || 1, w = 100 / whites;
    let html = '', wi = 0;
    keys.forEach((k, i) => {
      const nm = DAE.Theory.name(k.note + Keyboard.shift), lbl = Keyboard.label(k.code);
      const cls = `${i === Keyboard.kSel && App.level === 'full' ? ' sel' : ''}${Keyboard.#isDown(i) ? ' on' : ''}`;
      const c = k.hz > 0 ? '<span class="cents">Hz</span>' : k.cents ? `<span class="cents">${k.cents > 0 ? '+' : ''}${Math.round(k.cents)}</span>` : '';
      if(DAE.Theory.isBlack(k.note)) html += `<div class="bk${cls}" data-key="${i}" style="left:calc(${wi * w}% - ${w * 0.32}%);width:${w * 0.64}%">${c}<span class="kb">${lbl}</span></div>`;
      else { html += `<div class="wk${cls}" data-key="${i}">${c}<span class="nt">${nm.startsWith('C') && !nm.startsWith('C#') ? nm : ''}</span><span class="kb">${lbl}</span></div>`; wi++; }
    });
    const $p = document.getElementById('piano');
    $p.innerHTML = html;
    $p.querySelectorAll('[data-key]').forEach($k => {
      $k.onpointerdown = e => {
        e.preventDefault();
        const i = Number($k.dataset.key);
        Keyboard.kSel = i;
        Keyboard.press('mouse', i);
        const up = () => { Keyboard.release('mouse'); removeEventListener('pointerup', up); };
        addEventListener('pointerup', up);
        if(App.level === 'full') { Keyboard.#keyed(); $p.querySelectorAll('.sel').forEach($x => $x.classList.remove('sel')); $k.classList.add('sel'); }
      };
    });
  }

  static #isDown(i) {
    for(const d of Keyboard.#down.values()) if(d.i === i) return true;
    return false;
  }

  static #keyed() {
    const $k = document.getElementById('keyed'), tpl = Keyboard.tpl, k = tpl.keys[Keyboard.kSel];
    if(!k) { $k.innerHTML = ''; return; }
    const nm = DAE.Theory.name(k.note);
    $k.innerHTML = `<div class="section" style="margin:0 0 2px">Key · ${nm}</div>
      <div class="row"><span>bound to</span>${k.code ? `<code>${UI.esc(Keyboard.label(k.code))}</code><small style="color:var(--muted)">${k.code}</small>` : '<code>-</code>'}
        <span class="sp"></span><button class="learn${Keyboard.learning ? ' on' : ''}" id="ke-learn">${Keyboard.learning ? 'press a key…' : 'Rebind'}</button></div>
      <div class="row"><span>note</span><select id="ke-pc">${DAE.Theory.NAMES.map((x, i) => `<option value="${i}" ${i === ((k.note % 12) + 12) % 12 ? 'selected' : ''}>${x}</option>`).join('')}</select>
        <input type="number" id="ke-oct" value="${Math.floor(k.note / 12) - 1}" min="-1" max="9" style="width:56px"></div>
      <div class="row"><span>cents</span><input type="range" id="ke-cents" min="-100" max="100" step="1" value="${k.cents}"><b style="font-family:var(--mono);width:34px;text-align:right">${Math.round(k.cents)}</b></div>
      <div class="row"><span>Hz</span><input type="number" id="ke-hz" step="0.01" value="${DAE.Keymap.hz(tpl, Keyboard.kSel).toFixed(2)}"><small style="color:var(--muted)">${k.hz > 0 ? 'override' : 'from note'}</small></div>
      <div class="row"><span>tuning</span><button id="ke-eq" title="Every key: equal temperament">Equal</button><button id="ke-just" title="Every key: just intonation on the song key">Just</button><button id="ke-reset" title="This key: plain note, no offset">Reset</button></div>`;
    const $ = id => document.getElementById(id);
    const setNote = () => App.change(() => { k.note = (Number($('ke-oct').value) + 1) * 12 + Number($('ke-pc').value); k.hz = 0; }, 'none');
    $('ke-learn').onclick = () => { Keyboard.learning = !Keyboard.learning; Keyboard.render(); };
    $('ke-pc').onchange = setNote;
    $('ke-oct').onchange = setNote;
    let started = false;
    $('ke-cents').oninput = e => {
      if(!started) { App.begin(); started = true; }
      k.cents = Number(e.target.value);
      k.hz = 0;
      e.target.nextElementSibling.textContent = k.cents;
      App.live('none');
    };
    $('ke-cents').onchange = () => { started = false; Keyboard.#piano(); Keyboard.#keyed(); };
    $('ke-hz').onchange = e => App.change(() => { k.hz = Math.max(0, Number(e.target.value) || 0); }, 'none');
    $('ke-eq').onclick = () => App.change(p => DAE.Keymap.equal(p.keyboard), 'none');
    $('ke-just').onclick = () => App.change(p => DAE.Keymap.just(p.keyboard, DAE.Theory.keyIndex(p.song.key)), 'none');
    $('ke-reset').onclick = () => App.change(() => { k.cents = 0; k.hz = 0; }, 'none');
  }

  //#region [ Playing ]
  /** Physical key handler; returns true when the key was used. */
  static keydown(e) {
    const tpl = Keyboard.tpl;
    if(Keyboard.learning) {
      if(['Escape', 'Space', 'Tab', 'Enter'].includes(e.code)) { Keyboard.learning = false; Keyboard.render(); return true; }
      App.change(p => DAE.Keymap.bind(p.keyboard, Keyboard.kSel, e.code), 'none');
      Keyboard.learning = false;
      Keyboard.render();
      return true;
    }
    if(e.code === tpl.octDown) { Keyboard.octave(-12); return true; }
    if(e.code === tpl.octUp) { Keyboard.octave(12); return true; }
    const i = DAE.Keymap.find(tpl, e.code);
    if(i < 0) return false;
    if(!Keyboard.#down.has(e.code)) Keyboard.press(e.code, i);
    return true;
  }

  static keyup(e) {
    if(Keyboard.#down.has(e.code)) Keyboard.release(e.code);
  }

  static press(code, i) {
    const tpl = Keyboard.tpl, k = tpl.keys[i];
    Audio.resume();
    const d = { id: 'kb' + ++Keyboard.#n, i, at: App.status.step };
    Keyboard.#down.set(code, d);
    document.querySelector(`#piano [data-key="${i}"]`)?.classList.add('on');
    if(App.mode === 'sfx') {
      const hz = DAE.Keymap.hz(tpl, i, Keyboard.shift);
      Sfx.play(12 * Math.log2(hz / DAE.Theory.hz(60)));
      return;
    }
    const t = App.track;
    if(!t) return;
    const ti = App.p.tracks.indexOf(t), first = tpl.keys[0]?.note ?? 48;
    const pitch = t.kind === 'drum' ? k.note - first : k.note + Keyboard.shift;
    d.pitch = pitch;
    d.cents = k.cents;
    Audio.send({ t: 'on', id: d.id, ti, pitch, vel: 0.8, cents: k.cents, hz: t.kind === 'drum' ? 0 : (k.hz > 0 ? DAE.Keymap.hz(tpl, i, Keyboard.shift) : 0) });
  }

  static release(code) {
    const d = Keyboard.#down.get(code);
    if(!d) return;
    Keyboard.#down.delete(code);
    if(!Keyboard.#isDown(d.i)) document.querySelector(`#piano [data-key="${d.i}"]`)?.classList.remove('on');
    if(App.mode === 'sfx') return;
    Audio.send({ t: 'off', id: d.id });
    if(App.rec && App.status.playing && d.pitch !== undefined) Keyboard.#record(d);
  }

  /**
   * Writes a played note at the song position it was pressed: into the clip playing on the selected track
   * at that bar, or, on an empty bar, into the selected pattern placed there (so it shows on the playlist).
   */
  static #record(d) {
    const t = App.track;
    if(!t) return;
    const spb = DAE.Project.barSteps(App.p), at = Math.round(d.at), bar = Math.floor(at / spb);
    if(bar >= t.clips.length) return;
    let start = -1, pat = null;
    for(let b = bar; b >= 0; b--) {
      const x = t.clips[b] && App.p.patterns.find(q => q.id === t.clips[b]);
      if(x) { if(bar < b + x.bars) { start = b; pat = x; } break; }
    }
    const place = !pat;
    if(place) {
      pat = App.pattern ?? null;
      start = bar;
    }
    let len = Math.max(1, Math.round(App.status.step - d.at));
    if(t.kind === 'drum') len = 1;
    App.change(p => {
      if(!pat) { pat = DAE.Project.pattern(p, t.id); p.patterns.push(pat); }
      if(place) t.clips[bar] = pat.id;
      App.sel.pattern = pat.id;
      const total = pat.bars * spb, step = (at - start * spb) % total;
      pat.notes = pat.notes.filter(n => !(n.step === step && n.pitch === d.pitch));
      pat.notes.push({ step, len: Math.min(len, total - step), pitch: d.pitch, vel: 0.8, cents: d.cents ?? 0 });
    }, 'project', false);
    if(place) Playlist.render();
    Editor.render();
    if(t.kind !== 'drum') Editor.reveal(d.pitch);
  }

  static allOff() {
    for(const code of [...Keyboard.#down.keys()]) Keyboard.release(code);
  }
  //#endregion
}
