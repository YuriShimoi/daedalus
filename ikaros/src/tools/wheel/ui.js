// Wheel page: items (label, %, color, icon, on / lock), the wheel itself (click or flick to spin;
// the winner is picked first and the wheel lands on it with an easing curve), tick sounds,
// elimination rounds, history with the real spread, saved wheels.
(() => {
  const { Wheel, Ease, Menu, FileIO, Toon } = DAE;
  const ICONS = ['', 'star', 'heart', 'gem', 'key', 'skull', 'dragon', 'ghost', 'crown', 'gift', 'bomb', 'fire', 'bolt', 'shield-halved', 'hammer', 'flask', 'chest', 'dice-d20', 'music', 'sun', 'moon', 'flag', 'lock', 'face-smile'];
  const st = {
    api: null,
    items: Wheel.parseList('Gold | 30\nSword | 20\nPotion | 20\nKey | 15\nNothing | 10\nDragon | 5'),
    mode: 'odds', palette: 'dracula', pointer: 'top', remove: false, sound: true, secs: 5,
    rot: 0, spinning: false, history: [], winner: null, name: 'loot',
  };
  st.items.forEach((it, i) => { it.icon = ['gem', 'shield-halved', 'flask', 'key', '', 'dragon'][i]; });
  let $, audio = null;

  const html = `
    <div class="wh">
      <aside class="pane wh-items">
        <div class="bar"><span class="lbl">Items</span><span style="flex:1"></span>
          <button class="ghost" data-a="even" title="Same odds for all">even</button>
          <button class="ghost" data-a="paste" title="Edit as text: label | weight | #color">${Kit.icon('list')}text</button>
          <button class="ghost" data-a="add">${Kit.icon('plus')}</button></div>
        <div class="wh-list scroll"></div>
        <textarea class="wh-text" spellcheck="false" style="display:none"></textarea>
        <div class="wh-opts">
          <div class="wh-row"><span class="lbl">Slices</span><span class="seg" data-k="mode"><button data-v="odds" title="Slice size follows the odds">by odds</button><button data-v="equal" title="Same size, odds hidden">equal</button></span></div>
          <div class="wh-row"><span class="lbl">Colors</span><select data-o="palette">${Object.keys(Wheel.PALETTES).map(p => `<option>${p}</option>`).join('')}</select><button class="ghost" data-a="recolor">apply</button></div>
          <div class="wh-row"><span class="lbl">Pointer</span><span class="seg" data-k="pointer"><button data-v="top">top</button><button data-v="right">right</button></span></div>
          <div class="wh-row"><span class="lbl">Spin</span><input type="range" min="2" max="10" step="0.5" data-o="secs"><b class="wh-secs mono"></b></div>
          <label class="wh-chk"><input type="checkbox" data-o="remove"> remove the winner (elimination)</label>
          <label class="wh-chk"><input type="checkbox" data-o="sound"> tick sound</label>
        </div>
      </aside>
      <section class="wh-main">
        <div class="wh-wrap"><svg class="wh-svg" viewBox="-220 -220 440 440"><g class="wh-rot"></g><g class="wh-ptr"></g><g class="wh-hub" data-a="spin"><circle r="38"/><text y="6" text-anchor="middle">SPIN</text></g></svg></div>
        <div class="wh-win"></div>
      </section>
      <aside class="pane wh-side">
        <div class="bar"><span class="lbl">Results</span><span style="flex:1"></span><span class="muted wh-n"></span><button class="ghost ic-only" data-a="clear" title="Clear history">${Kit.icon('trash')}</button></div>
        <div class="wh-spread scroll"></div>
        <div class="bar"><span class="lbl">Saved wheels</span><span style="flex:1"></span><button class="ghost" data-a="save">${Kit.icon('floppy-disk')}Save</button></div>
        <div class="wh-saved scroll"></div>
      </aside>
    </div>`;

  //#region [ Wheel drawing ]
  const R = 200;
  const ptrOff = () => (st.pointer === 'right' ? 0.25 : 0);
  const ink = hex => { const n = parseInt(hex.slice(1, 7), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255; return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#1A1A1A' : '#FFFFFF'; };
  const colorOf = (it, i) => it.color ?? Wheel.colors(st.items.length, Wheel.PALETTES[st.palette])[i];

  const drawWheel = () => {
    const sl = Wheel.slices(st.items, st.mode);
    const P = a => [Math.sin(a * 2 * Math.PI) * R, -Math.cos(a * 2 * Math.PI) * R];
    const out = sl.map(s => {
      const it = s.item, c = colorOf(it, s.index);
      const [x0, y0] = P(s.a0), [x1, y1] = P(s.a1), big = s.a1 - s.a0 > 0.5 ? 1 : 0;
      const mid = (s.a0 + s.a1) / 2, deg = mid * 360;
      const size = s.a1 - s.a0, fs = Math.max(9, Math.min(17, size * 260));
      const path = sl.length === 1 ? `M0 ${-R}A${R} ${R} 0 1 1 -.01 ${-R}Z` : `M0 0L${x0} ${y0}A${R} ${R} 0 ${big} 1 ${x1} ${y1}Z`;
      const win = st.winner === s.index;
      const label = it.label.length > 16 ? it.label.slice(0, 15) + '…' : it.label;
      return `<g class="wh-sl${win ? ' win' : ''}"><path d="${path}" fill="${c}"/>
        <g transform="rotate(${deg - 90})">
          ${it.icon ? `<use href="#i-${it.icon}" x="${R - 44}" y="-11" width="22" height="22" fill="${ink(c)}" transform="rotate(90 ${R - 33} 0)"/>` : ''}
          <text x="${R - (it.icon ? 54 : 18)}" y="${fs * .35}" text-anchor="end" font-size="${fs}" fill="${ink(c)}">${Kit.esc(label)}</text>
        </g></g>`;
    }).join('');
    $.querySelector('.wh-rot').innerHTML = (sl.length ? out : `<circle r="${R}" fill="#2A2A2A"/><text text-anchor="middle" y="-60" fill="#6F7676" font-size="15">add items</text>`)
      + `<circle r="${R}" fill="none" stroke="#1A1A1A" stroke-width="6"/>` + sl.map(s => { const [x, y] = P(s.a0); return `<line x1="0" y1="0" x2="${x}" y2="${y}" stroke="#1A1A1A" stroke-width="2"/>`; }).join('');
    const pr = st.pointer === 'right';
    $.querySelector('.wh-ptr').innerHTML = `<path d="M-14 ${-R - 16}L14 ${-R - 16}L0 ${-R + 14}Z" fill="#F8F8F2" stroke="#1A1A1A" stroke-width="3" stroke-linejoin="round"${pr ? ' transform="rotate(90)"' : ''}/>`;
    applyRot();
  };
  const applyRot = () => { $.querySelector('.wh-rot').setAttribute('transform', `rotate(${(st.rot % 1) * 360})`); };
  //#endregion

  //#region [ Items ]
  const drawItems = () => {
    const p = Wheel.percents(st.items);
    $.querySelector('.wh-list').innerHTML = st.items.map((it, i) => `<div class="wh-it${it.on === false ? ' off' : ''}" data-i="${i}">
      <input type="checkbox" data-f="on"${it.on !== false ? ' checked' : ''} title="In the wheel">
      <label class="wh-sw" title="Color"><input type="color" data-f="color" value="${colorOf(it, i)}"><i style="background:${colorOf(it, i)}"></i></label>
      <input class="wh-label" data-f="label" value="${Kit.esc(it.label)}" spellcheck="false">
      <select data-f="icon" title="Icon">${ICONS.map(n => `<option value="${n}"${(it.icon ?? '') === n ? ' selected' : ''}>${n || '—'}</option>`).join('')}</select>
      <input class="wh-pct mono" type="number" min="0" max="100" step="0.1" data-f="pct" value="${+p[i].toFixed(1)}" title="Odds %">
      <button class="ghost ic-only${it.lock ? ' on' : ''}" data-a="lock" title="${it.lock ? 'Unlock' : 'Lock'} its %">${Kit.icon(it.lock ? 'lock' : 'lock-open')}</button>
      <button class="ghost ic-only" data-a="del" title="Remove">${Kit.icon('xmark')}</button></div>`).join('');
  };

  const drawSide = () => {
    const spread = Wheel.spread(st.items, st.history.map(h => h.label));
    $.querySelector('.wh-n').textContent = st.history.length ? `${st.history.length} spins` : '';
    $.querySelector('.wh-spread').innerHTML = st.history.length ? spread.map((s, i) => `<div class="wh-sp"><i style="background:${colorOf(st.items[i], i)}"></i><span>${Kit.esc(s.label)}</span><b>${s.count}</b><em>${s.pct.toFixed(1)}% <span class="muted">/ ${s.expected.toFixed(1)}%</span></em><div class="wh-bar"><b style="width:${s.pct}%"></b><s style="left:${s.expected}%"></s></div></div>`).join('')
      + `<div class="lbl" style="margin:10px 0 4px">Last spins</div><div class="wh-last">${st.history.slice(0, 30).map(h => `<span class="chip">${Kit.esc(h.label)}</span>`).join('')}</div>` : '<p class="muted wh-note">Spin to see results: real counts against the odds.</p>';
    st.api.get('saved', []).then(list => {
      $.querySelector('.wh-saved').innerHTML = list.map((w, i) => `<div class="wh-sv" data-sv="${i}"><span>${Kit.esc(w.name)}</span><em>${w.items.length} items</em><button class="ghost ic-only" data-a="unsave" data-i="${i}">${Kit.icon('xmark')}</button></div>`).join('') || '<p class="muted wh-note">No saved wheels.</p>';
    });
  };

  const opts = () => {
    $.querySelectorAll('.wh .seg[data-k]').forEach($s => $s.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === st[$s.dataset.k])));
    $.querySelector('[data-o=palette]').value = st.palette;
    $.querySelector('[data-o=secs]').value = st.secs;
    $.querySelector('.wh-secs').textContent = `${st.secs}s`;
    $.querySelector('[data-o=remove]').checked = st.remove;
    $.querySelector('[data-o=sound]').checked = st.sound;
    DAE.UI.ranges();
  };

  const all = () => { drawItems(); drawWheel(); drawSide(); opts(); save(); };
  const save = () => st.api.later('state', () => ({ items: st.items, mode: st.mode, palette: st.palette, pointer: st.pointer, remove: st.remove, sound: st.sound, secs: st.secs, history: st.history.slice(0, 2000), name: st.name }), 400);
  //#endregion

  //#region [ Spin ]
  const tick = () => {
    if(!st.sound) return;
    try {
      audio ??= new AudioContext();
      const t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(1500, t);
      o.frequency.exponentialRampToValueAtTime(500, t + 0.03);
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + 0.06);
    } catch {}
  };
  const ding = () => {
    if(!st.sound) return;
    try {
      audio ??= new AudioContext();
      const t = audio.currentTime;
      [660, 880, 1320].forEach((f, i) => {
        const o = audio.createOscillator(), g = audio.createGain();
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + i * .08);
        g.gain.exponentialRampToValueAtTime(0.15, t + i * .08 + .01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + i * .08 + .4);
        o.connect(g).connect(audio.destination);
        o.start(t + i * .08); o.stop(t + i * .08 + .45);
      });
    } catch {}
  };

  const ease = Ease.make(Ease.curve('ease-out-quart'));
  const spin = (strength = 1) => {
    if(st.spinning) return;
    const live = Wheel.live(st.items);
    if(!live.length) return st.api.toast('Turn some items on', true);
    const rnd = DAE.Dice ? Math.random : Math.random;
    const idx = Wheel.pick(st.items, rnd);
    const sl = Wheel.slices(st.items, st.mode);
    const off = ptrOff();
    const turns = [Math.round(3 + strength * 2), Math.round(4 + strength * 3)];
    const end = Wheel.landing(sl, idx, { from: st.rot - off, turns, rnd }) + off;
    const from = st.rot, dur = st.secs * (0.7 + strength * 0.3) * 1000, t0 = performance.now();
    st.spinning = true;
    st.winner = null;
    $.querySelector('.wh-win').innerHTML = '';
    drawWheel();
    let lastSlice = Wheel.under(sl, from - off)?.index;
    const step = now => {
      const p = Math.min(1, (now - t0) / dur);
      st.rot = from + (end - from) * ease(p);
      applyRot();
      const u = Wheel.under(sl, st.rot - off)?.index;
      if(u !== lastSlice) { lastSlice = u; tick(); }
      if(p < 1) return requestAnimationFrame(step);
      st.spinning = false;
      st.rot = end % 1;
      const it = st.items[idx];
      st.winner = idx;
      st.history.unshift({ label: it.label, time: Date.now() });
      ding();
      $.querySelector('.wh-win').innerHTML = `<div class="wh-banner" style="--c:${colorOf(it, idx)}">${it.icon ? Kit.icon(it.icon) : ''}<b>${Kit.esc(it.label)}</b>${st.remove ? '<span>removed for the next spin</span>' : ''}</div>`;
      drawWheel();
      if(st.remove) {
        setTimeout(() => { it.on = false; st.winner = null; all(); }, 1400);
      }
      drawSide();
      save();
    };
    requestAnimationFrame(step);
  };
  //#endregion

  const loadWheel = w => {
    st.items = (w.items ?? []).map(x => Wheel.item(String(x.label), { weight: +x.weight || 1, color: x.color || null, icon: x.icon || null, on: x.on !== false, lock: !!x.lock }));
    for(const k of ['mode', 'palette', 'pointer', 'name']) if(w[k]) st[k] = w[k];
    st.winner = null;
    Wheel.normalize(st.items);
    all();
  };
  const wheelData = () => ({ app: 'wheel', version: 1, name: st.name, mode: st.mode, palette: st.palette, pointer: st.pointer, items: st.items.map(i => ({ label: i.label, weight: +(+i.weight).toFixed(3), color: i.color ?? '', icon: i.icon ?? '', on: i.on !== false, lock: !!i.lock })) });

  const mount = api => {
    st.api = api;
    $ = api.$el;
    $.innerHTML = html;
    api.actions([
      ['folder-open', 'Open', async () => { const f = await FileIO.open({ accept: '.toon,.json,.txt' }); if(f) openText(f.text, f.name); }],
      ['file-export', 'Export', (e, $b) => {
        const r = $b.getBoundingClientRect();
        Menu.show(r.left, r.bottom + 4, [
          ['download', 'Wheel (TOON)', () => Kit.download(`${st.name}.wheel.toon`, Toon.encode(wheelData()))],
          ['download', 'Wheel (JSON)', () => Kit.download(`${st.name}.wheel.json`, JSON.stringify(wheelData(), null, 2), 'application/json')],
          ['image', 'Wheel (PNG)', () => {
            const svg = $.querySelector('.wh-svg').cloneNode(true);
            svg.querySelector('.wh-hub').remove();
            svg.setAttribute('width', 880); svg.setAttribute('height', 880);
            svg.querySelectorAll('use').forEach($u => { const id = $u.getAttribute('href'); const sym = document.querySelector(id); if(sym) { const g = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); g.setAttribute('viewBox', sym.getAttribute('viewBox')); ['x', 'y', 'width', 'height', 'fill', 'transform'].forEach(a => $u.getAttribute(a) && g.setAttribute(a, $u.getAttribute(a))); g.innerHTML = sym.innerHTML; $u.replaceWith(g); } });
            const img = new Image();
            img.onload = () => { const cv = Object.assign(document.createElement('canvas'), { width: 880, height: 880 }); cv.getContext('2d').drawImage(img, 0, 0); cv.toBlob(b => Kit.download(`${st.name}.png`, b)); };
            img.src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg).replace('<svg', '<svg font-family="Segoe UI, sans-serif" font-weight="600"')], { type: 'image/svg+xml' }));
          }],
          ['download', 'Results (CSV)', () => Kit.download('spins.csv', 'time,label\n' + st.history.map(h => `${new Date(h.time).toISOString()},"${h.label}"`).join('\n'), 'text/csv')],
        ]);
      }],
      ['dharmachakra', 'Spin', () => spin(1), { primary: true, title: 'Spin (Space)' }],
    ]);
    const openText = (text, name = 'wheel') => {
      try {
        const t = text.trim();
        const d = t.startsWith('{') ? JSON.parse(t) : /^app:\s*wheel/m.test(t) ? Toon.decode(t) : null;
        if(d) loadWheel(d);
        else { st.items = Wheel.parseList(t); Wheel.normalize(st.items); all(); }
        st.name = name.replace(/(\.wheel)?\.(toon|json|txt)$/i, '');
      } catch(err) { api.toast(err.message, true); }
    };
    st.openText = openText;

    $.querySelector('.wh-list').addEventListener('change', e => {
      const $r = e.target.closest('[data-i]'), i = +$r.dataset.i, f = e.target.dataset.f, it = st.items[i];
      if(f === 'on') { it.on = e.target.checked; Wheel.normalize(st.items); }
      if(f === 'color') it.color = e.target.value;
      if(f === 'icon') it.icon = e.target.value || null;
      if(f === 'pct') Wheel.setPercent(st.items, i, +e.target.value || 0);
      if(f === 'label') it.label = e.target.value || '?';
      all();
    });
    $.querySelector('.wh-list').addEventListener('input', e => {
      if(e.target.dataset.f === 'label') { st.items[+e.target.closest('[data-i]').dataset.i].label = e.target.value; drawWheel(); save(); }
      if(e.target.dataset.f === 'color') { const i = +e.target.closest('[data-i]').dataset.i; st.items[i].color = e.target.value; e.target.nextElementSibling.style.background = e.target.value; drawWheel(); }
    });
    $.querySelector('.wh-text').addEventListener('input', Kit.later(e => { const old = st.items; st.items = Wheel.parseList(e.target.value); st.items.forEach((it, i) => { it.icon ??= old.find(o => o.label === it.label)?.icon ?? null; void i; }); Wheel.normalize(st.items); drawWheel(); drawSide(); save(); }, 400));
    $.querySelector('.wh-opts').addEventListener('input', e => {
      const o = e.target.dataset.o;
      if(o === 'secs') { st.secs = +e.target.value; $.querySelector('.wh-secs').textContent = `${st.secs}s`; }
      if(o === 'remove' || o === 'sound') st[o] = e.target.checked;
      if(o === 'palette') st.palette = e.target.value;
      save();
    });
    $.addEventListener('click', e => {
      const $seg = e.target.closest('.seg[data-k] [data-v]');
      if($seg) { st[$seg.parentElement.dataset.k] = $seg.dataset.v; all(); return; }
      const $sv = e.target.closest('[data-sv]');
      const a = e.target.closest('[data-a]')?.dataset.a;
      if($sv && !a) { api.get('saved', []).then(list => loadWheel(list[+$sv.dataset.sv])); return; }
      if(!a) return;
      const i = +(e.target.closest('[data-i]')?.dataset.i ?? -1);
      if(a === 'spin') spin(1);
      if(a === 'add') { st.items.push(Wheel.item(`Item ${st.items.length + 1}`, { weight: 100 / Math.max(1, Wheel.live(st.items).length + 1) })); Wheel.normalize(st.items); all(); $.querySelector('.wh-list .wh-it:last-child .wh-label')?.select(); }
      if(a === 'del') { st.items.splice(i, 1); Wheel.normalize(st.items); all(); }
      if(a === 'lock') { st.items[i].lock = !st.items[i].lock; drawItems(); save(); }
      if(a === 'even') { Wheel.even(st.items); all(); }
      if(a === 'recolor') { st.items.forEach(it => { it.color = null; }); const cs = Wheel.colors(st.items.length, Wheel.PALETTES[st.palette]); st.items.forEach((it, k) => { it.color = cs[k]; }); all(); }
      if(a === 'paste') {
        const $t = $.querySelector('.wh-text'), show = $t.style.display === 'none';
        $t.style.display = show ? '' : 'none';
        $.querySelector('.wh-list').style.display = show ? 'none' : '';
        if(show) $t.value = Wheel.listText(st.items); else drawItems();
      }
      if(a === 'clear') { st.history = []; st.winner = null; $.querySelector('.wh-win').innerHTML = ''; drawWheel(); drawSide(); save(); }
      if(a === 'save') {
        const name = prompt('Name for this wheel', st.name);
        if(!name) return;
        st.name = name;
        api.get('saved', []).then(list => { api.set('saved', [{ ...wheelData(), name }, ...list.filter(w => w.name !== name)]).then(drawSide); });
      }
      if(a === 'unsave') api.get('saved', []).then(list => { list.splice(i, 1); api.set('saved', list).then(drawSide); });
    });

    // flick to spin: a fast drag on the wheel
    const $svg = $.querySelector('.wh-svg');
    let fl = null;
    $svg.addEventListener('pointerdown', e => { if(!e.target.closest('.wh-hub')) fl = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    addEventListener('pointerup', e => {
      if(!fl) return;
      const d = Math.hypot(e.clientX - fl.x, e.clientY - fl.y), dt = performance.now() - fl.t;
      fl = null;
      if(d < 6) return spin(1);
      spin(Math.max(0.4, Math.min(1.8, d / Math.max(60, dt) * 0.9)));
    });

    api.get('state').then(s => {
      if(s) { Object.assign(st, s); st.history ??= []; }
      Wheel.normalize(st.items);
      all();
    });
  };

  Hub.register('wheel', {
    mount,
    async open(file) { st.openText(file.text, file.name); },
    async drop(files) { st.openText(await files[0].text(), files[0].name); },
    keys(e) {
      if(/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
      if(e.key === ' ' || e.key === 'Enter') { e.preventDefault(); spin(1); }
    },
  });
})();
