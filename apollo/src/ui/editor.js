// Pattern editor: piano roll (melodic tracks) or channel rack steps (drum tracks), pattern picker,
// transpose, copy / paste and a velocity lane.
class Editor {
  static LO = 24;   // C1
  static HI = 108;  // C8
  static sel = new Set();
  static clip = [];
  static lastLen = 2;
  static #scroll = {};
  static #drag = null;
  static #pv = 0;

  static get steps() {
    return (App.pattern?.bars ?? 1) * DAE.Project.barSteps(App.p);
  }

  static render() {
    const t = App.track, pat = App.pattern;
    const $h = document.getElementById('edhead'), $e = document.getElementById('editor');
    if(!t) { $h.innerHTML = ''; $e.innerHTML = '<p class="hint">Add a track to start.</p>'; return; }
    const pats = App.p.patterns.filter(x => x.track === t.id);
    const drum = t.kind === 'drum';
    $h.innerHTML = `<div class="section">${UI.esc(t.name)} · pattern ${pats.indexOf(pat) + 1 || '-'} · ${drum ? 'channel rack' : 'piano roll'}</div>
      <div class="pats">${pats.map((x, i) => `<button data-pat="${x.id}" class="${x.id === App.sel.pattern ? 'on' : ''}">${i + 1}</button>`).join('')}</div>
      <button data-act="new" title="New pattern">${UI.icon('plus')}</button>
      <button class="adv" data-act="dup" title="Duplicate pattern">${UI.icon('clone')}</button>
      ${drum ? '' : `<button class="adv" data-act="t-1" title="Transpose down a semitone">−1</button><button class="adv" data-act="t1" title="Transpose up a semitone">+1</button>
      <button class="adv" data-act="t-12" title="Octave down">−12</button><button class="adv" data-act="t12" title="Octave up">+12</button>`}
      <select data-act="bars" title="Pattern length">${[1, 2, 3, 4, 5, 6, 7, 8].map(b => `<option value="${b}" ${pat?.bars === b ? 'selected' : ''}>${b} bar${b > 1 ? 's' : ''}</option>`).join('')}</select>
      <button class="adv" data-act="clear" title="Remove every note">${UI.icon('eraser')}</button>
      <button data-act="del" title="Delete pattern" ${pat ? '' : 'disabled'}>${UI.icon('trash')}</button>`;
    $h.querySelectorAll('[data-pat]').forEach($b => $b.onclick = () => { App.sel.pattern = Number($b.dataset.pat); Editor.sel.clear(); App.render(); });
    $h.querySelectorAll('[data-act]').forEach($b => {
      const act = $b.dataset.act;
      if(act === 'bars') $b.onchange = () => App.change(() => { pat.bars = Number($b.value); });
      else $b.onclick = () => Editor.action(act);
    });
    if(!pat) { $e.innerHTML = '<p class="hint">No pattern yet: press + to make one.</p>'; return; }
    if(drum) Editor.#renderSteps($e, t, pat);
    else Editor.#renderRoll($e, t, pat);
  }

  static action(act) {
    const t = App.track, pat = App.pattern;
    if(act === 'new') {
      App.change(p => { const x = DAE.Project.pattern(p, t.id); p.patterns.push(x); App.sel.pattern = x.id; }, 'none');
      return;
    }
    if(!pat) return;
    if(act === 'dup') App.change(p => { const x = { ...JSON.parse(JSON.stringify(pat)), id: DAE.Project.nextId(p.patterns) }; p.patterns.push(x); App.sel.pattern = x.id; }, 'none');
    else if(act === 'clear') App.change(() => { pat.notes = []; });
    else if(act === 'del') {
      const used = App.p.tracks.some(x => x.clips.includes(pat.id));
      if((pat.notes.length || used) && !confirm(`Delete pattern ${App.p.patterns.filter(x => x.track === t.id).indexOf(pat) + 1}${used ? ' and its clips' : ''}?`)) return;
      App.change(p => {
        DAE.Project.removePattern(p, pat.id);
        App.sel.pattern = p.patterns.find(x => x.track === t.id)?.id ?? 0;
        Editor.sel.clear();
      });
    }
    else if(act.startsWith('t')) Editor.transpose(Number(act.slice(1)));
  }

  static #targets(pat) {
    const sel = pat.notes.filter(n => Editor.sel.has(n));
    return sel.length ? sel : pat.notes;
  }

  static transpose(semis) {
    const pat = App.pattern;
    if(!pat || App.track.kind === 'drum') return;
    App.change(() => { for(const n of Editor.#targets(pat)) n.pitch = Math.max(Editor.LO, Math.min(Editor.HI, n.pitch + semis)); });
  }

  /** Scrolls the piano roll so a pitch row is visible. */
  static reveal(pitch) {
    const $e = document.getElementById('editor'), y = (Editor.HI - pitch) * 13;
    if(!document.getElementById('roll-grid')) return;
    if(y < $e.scrollTop || y > $e.scrollTop + $e.clientHeight - 26) $e.scrollTop = Math.max(0, y - $e.clientHeight / 2);
  }

  static preview(pitch, cents = 0) {
    const ti = App.p.tracks.indexOf(App.track);
    Audio.resume().then(() => {
      const id = 'pv' + ++Editor.#pv;
      Audio.send({ t: 'on', id, ti, pitch, vel: 0.8, cents });
      setTimeout(() => Audio.send({ t: 'off', id }), 220);
    });
  }

  //#region [ Piano roll ]
  static #renderRoll($e, t, pat) {
    const { LO, HI } = Editor, s = App.p.song, steps = Editor.steps, spb = DAE.Project.barSteps(App.p);
    let keys = '', lanes = '';
    for(let p = HI; p >= LO; p--) {
      const nm = DAE.Theory.name(p), out = !DAE.Theory.inScale(p, s.key, s.scale);
      keys += `<div data-k="${p}" class="${DAE.Theory.isBlack(p) ? 'blk' : ''}${out ? ' out' : ''}">${p % 12 === 0 ? nm : ''}</div>`;
      lanes += `<div class="lane${out ? ' out' : ''}${(p - DAE.Theory.keyIndex(s.key)) % 12 === 0 ? ' root' : ''}"></div>`;
    }
    let lines = '';
    for(let k = 1; k < steps; k++) lines += `<i class="vline${k % spb === 0 ? ' bar' : k % s.stepsPerBeat === 0 ? ' beat' : ''}" style="left:${k / steps * 100}%"></i>`;
    // each bar takes the full visible width, so longer patterns scroll sideways
    const wide = `style="width:calc(54px + (100% - 54px) * ${pat.bars})"`;
    $e.innerHTML = `<div class="roll" ${wide}><div class="keys" id="roll-keys">${keys}</div>
        <div class="grid" id="roll-grid">${lanes}${lines}<div id="roll-notes"></div><i class="playhead" id="roll-head"></i></div></div>
      <div class="vel adv" ${wide}><span>velocity</span><div class="bars" id="roll-vel"></div></div>
      <p class="hint">Click: add · drag: move · drag the right edge: length · right-click: delete · shift-drag: select · Ctrl+C / V, Del, arrows ↑↓ transpose</p>`;
    Editor.#drawNotes();
    const key = `${pat.id}`;
    if(Editor.#scroll[key] === undefined) {
      const avg = pat.notes.length ? pat.notes.reduce((a, n) => a + n.pitch, 0) / pat.notes.length : 62;
      Editor.#scroll[key] = Math.max(0, (HI - avg) * 13 - $e.clientHeight / 2);
    }
    $e.scrollTop = Editor.#scroll[key];
    $e.onscroll = () => { Editor.#scroll[key] = $e.scrollTop; };
    document.getElementById('roll-keys').onpointerdown = e => {
      const p = Number(e.target.dataset.k);
      if(p) Editor.preview(p);
    };
    Editor.#bindRoll(document.getElementById('roll-grid'), pat);
    Editor.#bindVel(document.getElementById('roll-vel'), pat);
  }

  static #drawNotes() {
    const pat = App.pattern, t = App.track, $n = document.getElementById('roll-notes');
    if(!pat || !$n) return;
    const steps = Editor.steps;
    for(const n of [...Editor.sel]) if(!pat.notes.includes(n)) Editor.sel.delete(n);
    $n.innerHTML = pat.notes.map((n, i) => `<i class="note${Editor.sel.has(n) ? ' sel' : ''}" data-i="${i}" style="background:${t.color};opacity:${0.45 + n.vel * 0.55};left:calc(${n.step / steps * 100}% + 1px);width:calc(${n.len / steps * 100}% - 2px);top:${(Editor.HI - n.pitch) * 13 + 1}px"></i>`).join('');
    const $v = document.getElementById('roll-vel');
    if($v) $v.innerHTML = pat.notes.map(n => `<i style="background:${t.color};left:calc(${n.step / steps * 100}% + 1px);height:${n.vel * 100}%"></i>`).join('');
  }

  static #at($g, e) {
    const r = $g.getBoundingClientRect();
    return {
      step: Math.max(0, Math.min(Editor.steps - 0.001, (e.clientX - r.left) / r.width * Editor.steps)),
      pitch: Math.max(Editor.LO, Math.min(Editor.HI, Editor.HI - Math.floor((e.clientY - r.top) / 13))),
      x: e.clientX - r.left, y: e.clientY - r.top,
    };
  }

  static #bindRoll($g, pat) {
    $g.oncontextmenu = e => e.preventDefault();
    $g.onpointerdown = e => {
      const at = Editor.#at($g, e), $note = e.target.closest('.note');
      const hit = $note ? pat.notes[Number($note.dataset.i)] : null;
      if(e.button === 2) {
        if(hit) { App.begin(); pat.notes.splice(pat.notes.indexOf(hit), 1); Editor.sel.delete(hit); Editor.#drawNotes(); App.live(); }
        return;
      }
      if(e.button !== 0) return;
      $g.setPointerCapture(e.pointerId);
      if(hit) {
        if(!Editor.sel.has(hit)) { if(!e.shiftKey) Editor.sel.clear(); Editor.sel.add(hit); }
        const r = $note.getBoundingClientRect(), edge = e.clientX > r.right - 7;
        App.begin();
        Editor.preview(hit.pitch, hit.cents);
        Editor.#drag = { mode: edge ? 'resize' : 'move', at, orig: [...Editor.sel].map(n => ({ n, step: n.step, pitch: n.pitch, len: n.len })) };
      }
      else if(e.shiftKey) Editor.#drag = { mode: 'box', at };
      else {
        App.begin();
        const n = { step: Math.floor(at.step), len: Math.min(Editor.lastLen, Editor.steps - Math.floor(at.step)), pitch: at.pitch, vel: 0.8, cents: 0 };
        pat.notes.push(n);
        Editor.sel.clear();
        Editor.sel.add(n);
        Editor.preview(n.pitch);
        Editor.#drag = { mode: 'new', at, orig: [{ n, step: n.step, pitch: n.pitch, len: n.len }] };
      }
      Editor.#drawNotes();
    };
    $g.onpointermove = e => {
      const d = Editor.#drag;
      if(!d) return;
      const at = Editor.#at($g, e), steps = Editor.steps;
      const ds = Math.round(at.step - d.at.step), dp = at.pitch - d.at.pitch;
      if(d.mode === 'box') {
        const x0 = Math.min(d.at.x, at.x), y0 = Math.min(d.at.y, at.y), w = Math.abs(at.x - d.at.x), h = Math.abs(at.y - d.at.y);
        let $b = document.getElementById('selbox');
        if(!$b) { $b = document.createElement('div'); $b.id = 'selbox'; $b.className = 'selbox'; $g.append($b); }
        Object.assign($b.style, { left: x0 + 'px', top: y0 + 'px', width: w + 'px', height: h + 'px' });
        const s0 = Math.min(d.at.step, at.step), s1 = Math.max(d.at.step, at.step), p0 = Math.min(d.at.pitch, at.pitch), p1 = Math.max(d.at.pitch, at.pitch);
        Editor.sel = new Set(pat.notes.filter(n => n.step + n.len > s0 && n.step < s1 && n.pitch >= p0 && n.pitch <= p1));
        $g.querySelectorAll('.note').forEach($n => $n.classList.toggle('sel', Editor.sel.has(pat.notes[Number($n.dataset.i)])));
        return;
      }
      let moved = false;
      for(const o of d.orig) {
        if(d.mode === 'move') {
          const step = Math.max(0, Math.min(steps - o.len, o.step + ds)), pitch = Math.max(Editor.LO, Math.min(Editor.HI, o.pitch + dp));
          moved ||= step !== o.n.step || pitch !== o.n.pitch;
          if(pitch !== o.n.pitch && d.orig.length === 1) Editor.preview(pitch, o.n.cents);
          o.n.step = step;
          o.n.pitch = pitch;
        }
        else {
          const len = d.mode === 'new' ? Math.max(1, Math.floor(at.step) - o.step + 1) : Math.max(1, o.len + ds);
          o.n.len = Math.min(len, steps - o.n.step);
          moved = true;
        }
      }
      if(moved) Editor.#drawNotes();
    };
    $g.onpointerup = () => {
      const d = Editor.#drag;
      Editor.#drag = null;
      document.getElementById('selbox')?.remove();
      if(!d || d.mode === 'box') return;
      if(d.orig.length === 1) Editor.lastLen = d.orig[0].n.len;
      App.live();
      Header.render();
    };
  }

  static #bindVel($v, pat) {
    if(!$v) return;
    const set = e => {
      const r = $v.getBoundingClientRect(), step = (e.clientX - r.left) / r.width * Editor.steps;
      const vel = Math.max(0.05, Math.min(1, 1 - (e.clientY - r.top) / r.height));
      const pool = Editor.sel.size ? pat.notes.filter(n => Editor.sel.has(n)) : pat.notes;
      let changed = false;
      for(const n of pool) if(Math.abs(n.step + 0.5 - step) < 0.75) { n.vel = Math.round(vel * 100) / 100; changed = true; }
      if(changed) Editor.#drawNotes();
    };
    $v.onpointerdown = e => {
      App.begin();
      $v.setPointerCapture(e.pointerId);
      set(e);
      $v.onpointermove = set;
    };
    $v.onpointerup = () => { $v.onpointermove = null; App.live(); };
  }
  //#endregion

  //#region [ Channel rack ]
  static #renderSteps($e, t, pat) {
    const steps = Editor.steps, s = App.p.song, rows = t.kit.rows;
    const cols = `110px repeat(${steps}, minmax(12px, var(--step)))`;
    const html = rows.map((row, r) => `<span class="lb" data-row="${r}">${row.name}</span>` + Array.from({ length: steps }, (_, k) => {
      const n = pat.notes.find(x => x.pitch === r && x.step === k);
      const beatGroup = Math.floor(k / s.stepsPerBeat) % 2;
      return `<span class="st${n ? (n.vel >= 0.95 ? ' acc' : ' on') : beatGroup ? ' q' : ''}" data-s="${r}:${k}"></span>`;
    }).join('')).join('');
    $e.innerHTML = `<div class="steps" id="steps" style="grid-template-columns:${cols}">${html}</div>
      <p class="hint">Click: toggle · shift-click: accent · drag: paint · click a name: listen. The keyboard plays the rows too (first key = kick).</p>`;
    const $s = document.getElementById('steps');
    $s.querySelectorAll('[data-row]').forEach($l => $l.onpointerdown = () => Editor.preview(Number($l.dataset.row)));
    let paint = null;
    const apply = ($c, shift) => {
      const [r, k] = $c.dataset.s.split(':').map(Number);
      const i = pat.notes.findIndex(x => x.pitch === r && x.step === k);
      if(paint === null) paint = shift ? 'acc' : i < 0 ? 'on' : 'off';
      if(i >= 0) pat.notes.splice(i, 1);
      if(paint !== 'off') pat.notes.push({ step: k, len: 1, pitch: r, vel: paint === 'acc' ? 1 : 0.75, cents: 0 });
      $c.className = 'st' + (paint === 'off' ? (Math.floor(k / s.stepsPerBeat) % 2 ? ' q' : '') : paint === 'acc' ? ' acc' : ' on');
      if(paint !== 'off') Editor.preview(r);
    };
    $s.onpointerdown = e => {
      const $c = e.target.closest('[data-s]');
      if(!$c || e.button !== 0) return;
      e.preventDefault();
      App.begin();
      paint = null;
      apply($c, e.shiftKey);
      $s.onpointerover = ev => { const $x = ev.target.closest('[data-s]'); if($x) apply($x, false); };
    };
    $s.onpointerup = $s.onpointerleave = () => {
      if(paint === null) return;
      paint = null;
      $s.onpointerover = null;
      App.live();
      Header.render();
    };
  }
  //#endregion

  //#region [ Clipboard and keys ]
  static copy() {
    const pat = App.pattern;
    if(!pat) return;
    const sel = pat.notes.filter(n => Editor.sel.has(n));
    Editor.clip = JSON.parse(JSON.stringify(sel.length ? sel : pat.notes));
  }

  static paste() {
    const pat = App.pattern;
    if(!pat || !Editor.clip.length) return;
    const start = Math.min(...Editor.clip.map(n => n.step)), end = Math.max(...Editor.clip.map(n => n.step + n.len));
    const at = Editor.sel.size ? Math.max(...pat.notes.filter(n => Editor.sel.has(n)).map(n => n.step + n.len)) : start;
    const off = (Editor.sel.size ? at : end) - start;
    App.change(() => {
      Editor.sel.clear();
      for(const c of Editor.clip) {
        const n = { ...c, step: c.step + off };
        if(n.step >= Editor.steps) continue;
        n.len = Math.min(n.len, Editor.steps - n.step);
        pat.notes.push(n);
        Editor.sel.add(n);
      }
    });
  }

  static deleteSel() {
    const pat = App.pattern;
    if(!pat || !Editor.sel.size) return;
    App.change(() => { pat.notes = pat.notes.filter(n => !Editor.sel.has(n)); });
  }

  static selectAll() {
    Editor.sel = new Set(App.pattern?.notes ?? []);
    Editor.#drawNotes();
  }
  //#endregion

  /** Playhead inside the pattern while the song plays one of its clips. */
  static tick(st) {
    const pat = App.pattern, t = App.track;
    if(!pat || !t || App.mode !== 'music') return;
    const spb = DAE.Project.barSteps(App.p), bar = Math.floor(st.step / spb);
    let local = -1;
    if(st.playing) {
      for(let b = bar; b >= 0 && b > bar - pat.bars; b--) if(t.clips[b] === pat.id) { local = st.step - b * spb; break; }
    }
    const $h = document.getElementById('roll-head');
    if($h) {
      $h.classList.toggle('on', local >= 0);
      if(local >= 0) $h.style.left = local / Editor.steps * 100 + '%';
    }
    const $s = document.getElementById('steps');
    if($s) {
      const k = local >= 0 ? Math.floor(local) : -1;
      if($s.dataset.now !== String(k)) {
        $s.dataset.now = k;
        $s.querySelectorAll('.now').forEach($c => $c.classList.remove('now'));
        if(k >= 0) $s.querySelectorAll(`[data-s$=":${k}"]`).forEach($c => $c.classList.add('now'));
      }
    }
  }
}
