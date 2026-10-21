// Metronome page: easing curves (edit a cubic-bezier by its handles, springs, steps, any CSS timing
// function) with a live preview and a race of up to 4 curves; animation templates (Font Awesome
// style variables) shown on an icon (a circle by default); copy as CSS / JS / TOON.
(() => {
  const { Ease, Anim, Menu } = DAE;
  const ICONS = ['circle', 'square', 'heart', 'star', 'bell', 'spinner', 'circle-notch', 'gear', 'rocket', 'envelope', 'face-smile', 'arrow-up', 'gift', 'sun', 'moon', 'fire', 'feather', 'cloud', 'bomb', 'crown', 'bolt', 'gem', 'key', 'skull', 'dragon', 'ghost', 'music', 'flag', 'heart', 'house', 'lock', 'dice-d20', 'puzzle-piece', 'hammer', 'flask', 'chest'];
  const st = {
    api: null, mode: 'curves',
    curve: { id: 'ease-out-back', spec: Ease.curve('ease-out-back') },
    dur: 1.2, delay: 0.25, loop: true, alt: false,
    race: [],
    anim: 'beat', vals: {}, adur: null, atiming: null, aiter: null, adir: null, icon: 'circle', size: 64, color: '#CD7F32',
  };
  let $, fn = Ease.make(st.curve.spec), t0 = performance.now();

  const html = `
    <div class="mt">
      <aside class="pane mt-list scroll"></aside>
      <section class="mt-main scroll"></section>
      <aside class="pane mt-out scroll"></aside>
    </div>`;

  //#region [ Lists ]
  const groupBy = (list, k) => { const g = new Map(); for(const x of list) { if(!g.has(x[k])) g.set(x[k], []); g.get(x[k]).push(x); } return g; };
  const drawList = () => {
    const $l = $.querySelector('.mt-list');
    if(st.mode === 'curves') {
      $l.innerHTML = [...groupBy(Ease.CURVES, 'group')].map(([g, list]) => `<div class="lbl mt-g">${g}</div>${list.map(c => `<div class="mt-it${st.curve.id === c.id ? ' on' : ''}" data-curve="${c.id}">${mini(Ease.make(c))}<span>${c.name}</span></div>`).join('')}`).join('');
    }
    else {
      $l.innerHTML = [...groupBy(Anim.LIST, 'group')].map(([g, list]) => `<div class="lbl mt-g">${g}</div>${list.map(a => `<div class="mt-it${st.anim === a.id ? ' on' : ''}" data-anim="${a.id}"><span class="mt-ai">${Kit.icon('circle')}</span><span>${a.name}</span></div>`).join('')}`).join('');
    }
  };
  /** A tiny plot of a curve (for the list). */
  const mini = f => {
    const pts = Ease.sample(f, 24, 3).map((y, i) => `${(i / 24 * 28 + 2).toFixed(1)},${(26 - y * 20).toFixed(1)}`).join(' ');
    return `<svg class="mt-mini" viewBox="0 0 32 32"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  };
  //#endregion

  //#region [ Curves ]
  const G = { W: 320, H: 320, pad: 40, lo: -0.5, hi: 1.5 };
  const gx = x => G.pad + x * (G.W - G.pad * 2);
  const gy = y => G.H - G.pad - (y - 0) * (G.H - G.pad * 2) / 1;
  const plot = f => {
    const pts = [];
    for(let i = 0; i <= 160; i++) { const x = i / 160; pts.push(`${gx(x).toFixed(1)},${gy(Math.max(G.lo, Math.min(G.hi, f(x)))).toFixed(1)}`); }
    return pts.join(' ');
  };

  const drawCurve = () => {
    const sp = st.curve.spec, $m = $.querySelector('.mt-main');
    const handles = sp.kind === 'bezier' ? (() => {
      const [x1, y1, x2, y2] = sp.def;
      return `<line x1="${gx(0)}" y1="${gy(0)}" x2="${gx(x1)}" y2="${gy(y1)}" class="mt-arm"/><line x1="${gx(1)}" y1="${gy(1)}" x2="${gx(x2)}" y2="${gy(y2)}" class="mt-arm"/>
        <circle cx="${gx(x1)}" cy="${gy(y1)}" r="8" class="mt-h" data-h="1"/><circle cx="${gx(x2)}" cy="${gy(y2)}" r="8" class="mt-h" data-h="2"/>`;
    })() : '';
    const extra = sp.kind === 'spring' ? `<div class="mt-row">${[['stiffness', 0, 20, 500, 1], ['damping', 1, 1, 100, 1], ['mass', 2, .1, 10, .1]].map(([n, i, lo, hi, step]) => `<label class="field"><span>${n} <b>${sp.def[i]}</b></span><input type="range" min="${lo}" max="${hi}" step="${step}" value="${sp.def[i]}" data-sp="${i}"></label>`).join('')}</div><p class="muted mt-note">Settles in ${Ease.spring(...sp.def).settle}s at mass ${sp.def[2]}: use that as the duration for a real-time feel.</p>`
      : sp.kind === 'steps' ? `<div class="mt-row"><label class="field"><span>Steps <b>${sp.def[0]}</b></span><input type="range" min="1" max="24" step="1" value="${sp.def[0]}" data-st="n"></label><label class="field"><span>Jump</span><select data-st="jump">${['jump-end', 'jump-start', 'jump-none', 'jump-both'].map(j => `<option${(sp.def[1] ?? 'jump-end') === j ? ' selected' : ''}>${j}</option>`).join('')}</select></label></div>`
      : sp.kind === 'bezier' ? `<p class="muted mt-note">Drag the handles. Up or down past the box makes it overshoot.</p>` : `<p class="muted mt-note">This curve has no CSS bezier: CSS gets it as <code>linear()</code> points. Drag a handle to turn it into a bezier.</p>`;
    $m.innerHTML = `
      <div class="mt-ed">
        <svg class="mt-graph" viewBox="0 0 ${G.W} ${G.H}">
          <rect x="${gx(0)}" y="${gy(1)}" width="${gx(1) - gx(0)}" height="${gy(0) - gy(1)}" class="mt-box"/>
          ${[0.25, 0.5, 0.75].map(v => `<line x1="${gx(v)}" y1="${gy(1)}" x2="${gx(v)}" y2="${gy(0)}" class="mt-gl"/><line x1="${gx(0)}" y1="${gy(v)}" x2="${gx(1)}" y2="${gy(v)}" class="mt-gl"/>`).join('')}
          <line x1="${gx(0)}" y1="${gy(0)}" x2="${gx(1)}" y2="${gy(1)}" class="mt-diag"/>
          <polyline points="${plot(fn)}" class="mt-curve"/>
          ${handles}
          <circle r="5" class="mt-dot"/>
          <text x="${gx(0)}" y="${gy(0) + 18}" class="mt-t">0</text><text x="${gx(1)}" y="${gy(0) + 18}" class="mt-t" text-anchor="end">time 1</text><text x="${gx(0) - 8}" y="${gy(1) + 4}" class="mt-t" text-anchor="end">1</text>
        </svg>
        <div class="mt-side">
          <label class="field"><span>CSS timing function</span><input class="mt-css mono" spellcheck="false" value="${Kit.esc(Ease.css(sp).length > 80 ? '' : Ease.css(sp))}" placeholder="cubic-bezier(…) / steps(…) / linear(…)"></label>
          ${extra}
          <div class="mt-row"><label class="field"><span>Duration <b>${st.dur}s</b></span><input type="range" min="0.1" max="5" step="0.05" value="${st.dur}" data-p="dur"></label>
            <label class="field"><span>Pause <b>${st.delay}s</b></span><input type="range" min="0" max="2" step="0.05" value="${st.delay}" data-p="delay"></label></div>
          <div class="mt-row"><label class="mt-chk"><input type="checkbox" data-p="alt"${st.alt ? ' checked' : ''}> back and forth</label>
          <button class="ghost" data-a="race-add" title="Add this curve to the race below">${Kit.icon('plus')}Race it</button></div>
        </div>
      </div>
      <div class="mt-prev">
        <div class="mt-lane"><span class="lbl">Move</span><div class="mt-track"><i class="mt-ball" data-p="x"></i></div></div>
        <div class="mt-lane"><span class="lbl">Scale</span><div class="mt-track mt-c"><i class="mt-ball" data-p="s"></i></div></div>
        <div class="mt-lane"><span class="lbl">Turn</span><div class="mt-track mt-c"><i class="mt-sq" data-p="r"></i></div></div>
        <div class="mt-lane"><span class="lbl">Fade</span><div class="mt-track mt-c"><i class="mt-ball" data-p="o"></i></div></div>
        <div class="mt-lane"><span class="lbl">Progress</span><div class="mt-track"><b class="mt-bar" data-p="w"></b></div></div>
      </div>
      <div class="section">Race <span class="muted">up to 4</span></div>
      <div class="mt-race">${st.race.map((r, i) => `<div class="mt-lane"><span class="lbl" title="${Kit.esc(r.name)}">${Kit.esc(r.name)}</span><div class="mt-track"><i class="mt-ball r${i}" data-race="${i}"></i></div><button class="ghost ic-only" data-a="race-del" data-i="${i}">${Kit.icon('xmark')}</button></div>`).join('') || '<p class="muted mt-note">Add curves with "Race it" to compare them side by side.</p>'}</div>`;
    UI.ranges();
    drawOut();
  };

  const setSpec = (spec, id = 'custom') => {
    st.curve = { id, spec };
    fn = Ease.make(spec);
    drawList();
    drawCurve();
    save();
  };

  const curveName = () => Ease.curve(st.curve.id)?.name ?? 'custom';
  //#endregion

  //#region [ Animations ]
  const drawAnim = () => {
    const a = Anim.get(st.anim), $m = $.querySelector('.mt-main');
    const vals = Anim.values(a, st.vals);
    $m.innerHTML = `
      <div class="mt-stage" data-bg="dark"><div class="mt-actor">${Kit.icon(st.icon)}</div></div>
      <div class="mt-ctrl">
        <div class="mt-row">
          <label class="field"><span>Duration <b>${st.adur ?? a.dur}s</b></span><input type="range" min="0.1" max="5" step="0.05" value="${st.adur ?? a.dur}" data-av="dur"></label>
          <label class="field"><span>Timing</span><select data-av="timing"><option value="">${Kit.esc(a.timing)} (template)</option>${Ease.CURVES.filter(c => c.kind === 'bezier' || c.kind === 'steps').map(c => `<option value="${Kit.esc(Ease.css(c))}"${st.atiming === Ease.css(c) ? ' selected' : ''}>${c.name}</option>`).join('')}</select></label>
          <label class="field"><span>Repeat</span><select data-av="iter">${['', '1', '2', '3', 'infinite'].map(v => `<option value="${v}"${(st.aiter ?? '') === v ? ' selected' : ''}>${v || `${a.iter} (template)`}</option>`).join('')}</select></label>
          <label class="field"><span>Direction</span><select data-av="dir">${['', 'normal', 'reverse', 'alternate', 'alternate-reverse'].map(v => `<option value="${v}"${(st.adir ?? '') === v ? ' selected' : ''}>${v || 'template'}</option>`).join('')}</select></label>
        </div>
        ${a.vars.length ? `<div class="section">Variables <span class="muted">--ik-*</span></div><div class="mt-vars">${a.vars.map(v => `<label class="field"><span>${v.name} <b>${vals[v.name]}${v.unit}</b></span><input type="range" min="${v.min}" max="${v.max}" step="${v.step}" value="${vals[v.name]}" data-var="${v.name}"></label>`).join('')}</div>` : '<p class="muted mt-note">No variables: duration and timing shape it.</p>'}
        <div class="section">Icon <span class="muted">(only for the preview)</span></div>
        <div class="mt-icons">${[...new Set(ICONS)].map(n => `<button class="ghost${n === st.icon ? ' on' : ''}" data-icon="${n}" title="${n}">${Kit.icon(n)}</button>`).join('')}</div>
        <div class="mt-row"><label class="field"><span>Size <b>${st.size}px</b></span><input type="range" min="16" max="160" step="2" value="${st.size}" data-av="size"></label>
          <label class="field"><span>Color</span><input type="color" value="${st.color}" data-av="color"></label>
          <button data-a="replay">${Kit.icon('rotate-right')}Replay</button></div>
      </div>`;
    UI.ranges();
    play();
    drawOut();
  };

  const aopts = () => ({ vals: st.vals, dur: st.adur ?? undefined, timing: st.atiming || undefined, iter: st.aiter || undefined, dir: st.adir || undefined });

  const play = () => {
    const a = Anim.get(st.anim), $a = $.querySelector('.mt-actor');
    if(!$a) return;
    let $s = document.getElementById('mt-kf');
    if(!$s) { $s = document.createElement('style'); $s.id = 'mt-kf'; document.head.append($s); }
    $s.textContent = Anim.LIST.map(Anim.keyframes).join('\n');
    $a.style.cssText = `font-size:${st.size}px;color:${st.color};`;
    void $a.offsetWidth;
    $a.style.cssText += Anim.style(a, aopts());
  };
  //#endregion

  //#region [ Output ]
  const outs = () => {
    if(st.mode === 'curves') {
      const sp = st.curve.spec;
      return [
        ['CSS', Ease.css(sp)],
        ['JS function', Ease.js(sp)],
        ['TOON', DAE.Toon.encode({ app: 'metronome', curve: curveName(), kind: sp.kind, ...(sp.kind === 'bezier' || sp.kind === 'steps' || sp.kind === 'spring' ? { def: sp.def } : {}), css: Ease.css(sp) })],
        ['Samples (11)', Ease.sample(fn, 10).join(', ')],
      ];
    }
    const a = Anim.get(st.anim);
    return [['CSS', Anim.css(a, aopts())], ['JS (element.animate)', Anim.js(a, aopts())]];
  };
  const drawOut = () => {
    $.querySelector('.mt-out').innerHTML = outs().map(([t, v], i) => `<div class="mt-o"><div class="bar"><span class="lbl">${t}</span><span style="flex:1"></span><button class="ghost ic-only" data-copy="${i}" title="Copy">${Kit.icon('copy')}</button></div><pre class="mono">${Kit.esc(v)}</pre></div>`).join('');
  };
  //#endregion

  //#region [ Loop ]
  const UI = DAE.UI;
  const frame = now => {
    requestAnimationFrame(frame);
    if(Hub.active !== 'metronome' || st.mode !== 'curves' || !$) return;
    const cycle = st.dur + st.delay;
    let t = ((now - t0) / 1000) % (st.alt ? cycle * 2 : cycle);
    let back = false;
    if(st.alt && t >= cycle) { t -= cycle; back = true; }
    let p = Math.min(1, t / st.dur);
    if(back) p = 1 - p;
    const v = fn(p);
    const $m = $.querySelector('.mt-main');
    const set = (sel, css) => { const $e = $m.querySelector(sel); if($e) $e.style.cssText = css; };
    set('[data-p=x]', `left:calc(${v * 100}% - ${v * 22}px)`);
    set('[data-p=s]', `transform:scale(${0.2 + v * 0.8})`);
    set('[data-p=r]', `transform:rotate(${v * 180}deg)`);
    set('[data-p=o]', `opacity:${Math.max(0, Math.min(1, v))}`);
    set('[data-p=w]', `width:${Math.max(0, Math.min(100, v * 100))}%`);
    const $dot = $m.querySelector('.mt-dot');
    if($dot) { $dot.setAttribute('cx', gx(p)); $dot.setAttribute('cy', gy(Math.max(G.lo, Math.min(G.hi, v)))); }
    st.race.forEach((r, i) => { const $b = $m.querySelector(`[data-race="${i}"]`); if($b) { const rv = r.fn(p); $b.style.left = `calc(${rv * 100}% - ${rv * 22}px)`; } });
  };
  //#endregion

  const save = () => st.api.later('state', () => ({ mode: st.mode, curve: st.curve, dur: st.dur, delay: st.delay, alt: st.alt, anim: st.anim, vals: st.vals, icon: st.icon, size: st.size, color: st.color, race: st.race.map(r => ({ name: r.name, spec: r.spec })) }), 500);

  const draw = () => {
    document.querySelectorAll('#tool-bar [data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === st.mode));
    drawList();
    st.mode === 'curves' ? drawCurve() : drawAnim();
  };

  const mount = api => {
    st.api = api;
    $ = api.$el;
    $.innerHTML = html;
    const $tabs = Kit.el(`<span class="seg"><button data-mode="curves">Curves</button><button data-mode="anims">Animations</button></span>`);
    $tabs.onclick = e => { const m = e.target.closest('[data-mode]')?.dataset.mode; if(m) { st.mode = m; draw(); save(); } };
    api.bar($tabs);
    api.actions([
      ['copy', 'Copy CSS', () => Kit.copy(outs()[0][1], 'CSS copied'), { primary: true }],
      ['file-export', 'Download', (e, $b) => {
        const r = $b.getBoundingClientRect(), name = st.mode === 'curves' ? st.curve.id : st.anim;
        Menu.show(r.left, r.bottom + 4, outs().map(([t, v]) => ['download', t, () => Kit.download(`${name}${t.startsWith('JS') ? '.js' : t === 'TOON' ? '.toon' : t.startsWith('Samples') ? '.txt' : '.css'}`, v)]));
      }],
    ]);

    $.addEventListener('click', e => {
      const $c = e.target.closest('[data-curve]');
      if($c) { const c = Ease.curve($c.dataset.curve); setSpec({ kind: c.kind, def: structuredClone(c.def), dir: c.dir }, c.id); return; }
      const $an = e.target.closest('[data-anim]');
      if($an) { st.anim = $an.dataset.anim; st.vals = {}; st.adur = st.atiming = st.aiter = st.adir = null; drawList(); drawAnim(); save(); return; }
      const $ic = e.target.closest('[data-icon]');
      if($ic) { st.icon = $ic.dataset.icon; drawAnim(); save(); return; }
      const $cp = e.target.closest('[data-copy]');
      if($cp) { Kit.copy(outs()[+$cp.dataset.copy][1]); return; }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if(a === 'race-add') { if(st.race.length >= 4) st.race.shift(); st.race.push({ name: curveName(), spec: structuredClone(st.curve.spec), fn: Ease.make(st.curve.spec) }); drawCurve(); save(); }
      if(a === 'race-del') { st.race.splice(+e.target.closest('[data-i]').dataset.i, 1); drawCurve(); save(); }
      if(a === 'replay') play();
    });
    $.addEventListener('input', e => {
      const t = e.target;
      if(t.dataset.p === 'dur' || t.dataset.p === 'delay') { st[t.dataset.p] = +t.value; t.previousElementSibling.querySelector('b').textContent = `${t.value}s`; t0 = performance.now(); save(); }
      if(t.dataset.p === 'alt') { st.alt = t.checked; save(); }
      if(t.dataset.sp !== undefined) { const d = [...st.curve.spec.def]; d[+t.dataset.sp] = +t.value; st.curve.spec = { kind: 'spring', def: d }; fn = Ease.make(st.curve.spec); t.previousElementSibling.querySelector('b').textContent = t.value; refreshPlot(); }
      if(t.dataset.st) { const d = [...st.curve.spec.def]; if(t.dataset.st === 'n') d[0] = +t.value; else d[1] = t.value; st.curve.spec = { kind: 'steps', def: d }; fn = Ease.make(st.curve.spec); if(t.dataset.st === 'n') t.previousElementSibling.querySelector('b').textContent = t.value; refreshPlot(); }
      if(t.classList.contains('mt-css')) {
        const sp = Ease.parse(t.value);
        t.classList.toggle('bad', !sp);
        if(sp) { st.curve = { id: 'custom', spec: sp }; fn = Ease.make(sp); refreshPlot(); drawList(); }
      }
      if(t.dataset.var) { st.vals[t.dataset.var] = +t.value; const v = Anim.get(st.anim).vars.find(x => x.name === t.dataset.var); t.previousElementSibling.querySelector('b').textContent = `${t.value}${v.unit}`; play(); drawOut(); save(); }
      if(t.dataset.av) {
        const k = t.dataset.av;
        if(k === 'dur') { st.adur = +t.value; t.previousElementSibling.querySelector('b').textContent = `${t.value}s`; }
        if(k === 'timing') st.atiming = t.value || null;
        if(k === 'iter') st.aiter = t.value || null;
        if(k === 'dir') st.adir = t.value || null;
        if(k === 'size') { st.size = +t.value; t.previousElementSibling.querySelector('b').textContent = `${t.value}px`; }
        if(k === 'color') st.color = t.value;
        play(); drawOut(); save();
      }
    });
    const refreshPlot = () => {
      const $p = $.querySelector('.mt-curve');
      if($p) $p.setAttribute('points', plot(fn));
      drawOut();
      save();
    };

    // bezier handles
    let dragH = 0;
    $.addEventListener('pointerdown', e => {
      const $h = e.target.closest('.mt-h');
      const $g = e.target.closest('.mt-graph');
      if(!$g) return;
      if(!$h && st.curve.spec.kind === 'bezier') return;
      if(!$h) {
        // any other curve: start a bezier fitted roughly to it
        const s = Ease.sample(fn, 3);
        setSpec({ kind: 'bezier', def: [1 / 3, s[1], 2 / 3, s[2]] });
        return;
      }
      dragH = +$h.dataset.h;
      e.target.setPointerCapture?.(e.pointerId);
    });
    $.addEventListener('pointermove', e => {
      if(!dragH) return;
      const $g = $.querySelector('.mt-graph'), r = $g.getBoundingClientRect();
      const sx = (e.clientX - r.left) / r.width * G.W, sy = (e.clientY - r.top) / r.height * G.H;
      const x = Math.max(0, Math.min(1, (sx - G.pad) / (G.W - G.pad * 2)));
      const y = Math.max(-1, Math.min(2, (G.H - G.pad - sy) / (G.H - G.pad * 2)));
      const d = [...st.curve.spec.def];
      d[dragH === 1 ? 0 : 2] = +x.toFixed(3);
      d[dragH === 1 ? 1 : 3] = +y.toFixed(3);
      st.curve = { id: 'custom', spec: { kind: 'bezier', def: d } };
      fn = Ease.make(st.curve.spec);
      // move only what changed (keeps the drag smooth)
      $g.querySelector(`[data-h="${dragH}"]`).setAttribute('cx', gx(x));
      $g.querySelector(`[data-h="${dragH}"]`).setAttribute('cy', gy(y));
      const arms = $g.querySelectorAll('.mt-arm');
      arms[dragH - 1].setAttribute('x2', gx(x));
      arms[dragH - 1].setAttribute('y2', gy(y));
      $g.querySelector('.mt-curve').setAttribute('points', plot(fn));
      const $css = $.querySelector('.mt-css');
      $css.value = Ease.css(st.curve.spec);
      $css.classList.remove('bad');
      drawOut();
    });
    $.addEventListener('pointerup', () => { if(dragH) { dragH = 0; drawList(); save(); } });

    requestAnimationFrame(frame);
    api.get('state').then(s => {
      if(s) {
        Object.assign(st, { ...s, race: (s.race ?? []).map(r => ({ ...r, fn: Ease.make(r.spec) })) });
        fn = Ease.make(st.curve.spec);
      }
      draw();
    });
  };

  Hub.register('metronome', { mount, show() { if($ && st.mode === 'anims') play(); } });
})();
