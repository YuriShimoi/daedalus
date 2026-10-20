// Inspector: the selected track's instrument (engine, presets, envelope, tone, sample packs) or drum kit.
class Inspector {
  static SOURCES = {
    chip: 'Chip oscillator, own synth core', pluck: 'Karplus-Strong string, own synth core', fm: '2-operator FM, own synth core',
    organ: 'Drawbar organ (additive), own synth core', sample: 'Sample pack',
  };
  static NAMES = { chip: 'chip', pluck: 'pluck', fm: 'fm keys', organ: 'organ', sample: 'sample' };

  static render() {
    const t = App.track, $i = document.getElementById('inspector');
    if(!t) { $i.innerHTML = ''; return; }
    $i.innerHTML = t.kind === 'drum' ? Inspector.#kit(t) : Inspector.#inst(t);
    UI.wire($i);
    Inspector.#bind($i, t);
  }

  static #pct = x => Math.round(x * 100);
  static #sec = x => (x < 1 ? Math.round(x * 1000) + 'ms' : x.toFixed(2) + 's');

  static #inst(t) {
    const i = t.inst, f = UI.field, sec = Inspector.#sec;
    const set = k => v => { i[k] = v; };
    const env = `<div class="adv"><div class="section mt">Envelope</div>
        <svg class="adsr" viewBox="0 0 220 60" preserveAspectRatio="none"><path d="${Inspector.#adsrPath(i)}" fill="none" stroke="${t.color}" stroke-width="2.5" stroke-linejoin="round"/></svg>
        ${f('attack', { get: () => i.a, set: set('a'), min: 0.001, max: 2, step: 0.001, fmt: sec, live: () => Inspector.#adsr(t) })}
        ${f('decay', { get: () => i.d, set: set('d'), min: 0.01, max: 4, step: 0.01, fmt: sec, live: () => Inspector.#adsr(t) })}
        ${f('sustain', { get: () => i.s, set: set('s'), live: () => Inspector.#adsr(t) })}
        ${f('release', { get: () => i.r, set: set('r'), min: 0.005, max: 3, step: 0.005, fmt: sec, live: () => Inspector.#adsr(t) })}</div>`;
    let tone = '';
    switch(i.engine) {
      case 'chip':
        tone = `<div class="waves">${DAE.Instruments.CHIP_WAVES.map(w => `<button data-wave="${w}" class="${w === i.wave ? 'on' : ''}">${w}</button>`).join('')}</div>
          <div class="adv">${f('low-pass', { get: () => i.lpf, set: set('lpf') })}
          ${f('vib depth', { get: () => i.vibDepth, set: set('vibDepth'), max: 1, fmt: x => x.toFixed(2) + 'st' })}
          ${f('vib speed', { get: () => i.vibSpeed, set: set('vibSpeed'), min: 0.5, max: 12, step: 0.1, fmt: x => x.toFixed(1) + 'Hz' })}
          ${f('glide', { get: () => i.glide, set: set('glide'), max: 0.5, step: 0.005, fmt: sec })}</div>`;
        break;
      case 'pluck':
        tone = `<div class="adv">${f('pluck pos', { get: () => i.pos, set: set('pos'), min: 0.02, max: 0.5 })}${f('damping', { get: () => i.damp, set: set('damp') })}
          ${f('body', { get: () => i.body, set: set('body') })}${f('drive', { get: () => i.drive, set: set('drive') })}</div>`;
        break;
      case 'fm':
        tone = `<div class="adv">${f('ratio', { get: () => i.ratio, set: set('ratio'), min: 0.5, max: 8, step: 0.5, fmt: x => x.toFixed(1) })}
          ${f('index', { get: () => i.index, set: set('index'), max: 8, step: 0.1, fmt: x => x.toFixed(1) })}
          ${f('bell', { get: () => i.bell, set: set('bell') })}${f('tremolo', { get: () => i.trem, set: set('trem') })}</div>`;
        break;
      case 'organ':
        tone = `<div class="adv">${['16′', '5⅓′', '8′', '4′', '2⅔′', '2′', '1⅗′', '1⅓′', '1′'].map((nm, k) =>
          f(nm, { get: () => i.drawbars[k], set: v => { i.drawbars[k] = v; }, max: 8, step: 1, fmt: x => x })).join('')}
          ${f('percussion', { get: () => i.perc, set: set('perc') })}</div>`;
        break;
      case 'sample': {
        const packs = DAE.Samples.list('melodic');
        tone = `<div class="chips">${packs.map(p => `<button data-pack="${p.name}" class="${p.name === i.pack ? 'on' : ''}">${UI.esc(p.title.replace(/ \(.*\)$/, ''))}</button>`).join('')}</div>
          <div class="src" style="margin-top:6px">${UI.esc(DAE.Samples.packs[i.pack]?.credit ?? 'pack missing')} · ${UI.esc(DAE.Samples.packs[i.pack]?.license ?? '')}</div>
          <div class="adv">${f('low-pass', { get: () => i.lpf, set: set('lpf') })}</div>`;
        break;
      }
    }
    const presets = Object.keys(DAE.Instruments.PRESETS[i.engine] ?? {});
    return `<div class="section">Instrument · ${UI.esc(t.name)}</div>
      <div class="waves" style="grid-template-columns:repeat(3,1fr)">${DAE.Instruments.ENGINES.map(e => `<button data-engine="${e}" class="${e === i.engine ? 'on' : ''}">${Inspector.NAMES[e]}</button>`).join('')}</div>
      <div class="src">${Inspector.SOURCES[i.engine]}</div>
      <div class="section">Presets</div>
      <div class="chips">${presets.map(p => `<button data-preset="${p}" class="${p === i.preset ? 'on' : ''}">${p}</button>`).join('')}</div>
      <div class="chips adv" style="margin-top:6px"><button data-io="load">${UI.icon('folder-open')} Load .toon</button><button data-io="save">${UI.icon('floppy-disk')} Save .toon</button></div>
      <div class="section mt">Tone</div>
      ${f('volume', { get: () => i.vol, set: set('vol') })}
      ${f('pan', { get: () => t.pan, set: v => { t.pan = v; }, min: -1, max: 1, kind: 'mix', fmt: x => (x === 0 ? 'C' : (x < 0 ? 'L' : 'R') + Math.round(Math.abs(x) * 100)) }, 'adv')}
      ${f('track vol', { get: () => t.vol, set: v => { t.vol = v; }, kind: 'mix' }, 'adv')}
      ${tone}${env}`;
  }

  static #kit(t) {
    const k = t.kit, f = UI.field, hasPack = !!DAE.Samples.packs[k.pack];
    return `<div class="section">Drum kit · ${UI.esc(t.name)}</div>
      <div class="waves" style="grid-template-columns:1fr 1fr"><button data-kit="synth" class="${k.mode === 'synth' ? 'on' : ''}">synth 808</button>
        <button data-kit="sample" class="${k.mode === 'sample' ? 'on' : ''}" ${hasPack ? '' : 'disabled'}>sampled kit</button></div>
      <div class="src">${k.mode === 'sample' ? UI.esc(DAE.Samples.packs[k.pack]?.credit ?? '') + ' · CC0' : 'Synth drum voices, own core'}</div>
      ${f('track vol', { get: () => t.vol, set: v => { t.vol = v; }, kind: 'mix' })}
      ${f('pan', { get: () => t.pan, set: v => { t.pan = v; }, min: -1, max: 1, kind: 'mix', fmt: x => (x === 0 ? 'C' : (x < 0 ? 'L' : 'R') + Math.round(Math.abs(x) * 100)) }, 'adv')}
      ${k.rows.map(r => `<div class="rowname">${r.name}</div>
        ${f('volume', { get: () => r.vol, set: v => { r.vol = v; } })}
        ${f('tune', { get: () => r.tune, set: v => { r.tune = v; }, fmt: x => { const s = Math.round((x - 0.5) * 24); return (s > 0 ? '+' : '') + s + 'st'; } }, 'adv')}
        ${f('decay', { get: () => r.decay, set: v => { r.decay = v; } }, 'adv')}`).join('')}`;
  }

  static #adsrPath(i) {
    const tot = i.a + i.d + 0.6 + i.r, W = 212, sx = x => 4 + x / tot * W;
    const sy = v => 56 - v * 50;
    return `M4 56L${sx(i.a)} 6L${sx(i.a + i.d)} ${sy(i.s)}H${sx(i.a + i.d + 0.6)}L${sx(tot)} 56`;
  }

  static #adsr(t) {
    document.querySelector('#inspector .adsr path')?.setAttribute('d', Inspector.#adsrPath(t.inst));
  }

  static #bind($i, t) {
    $i.querySelectorAll('[data-engine]').forEach($b => $b.onclick = () => App.change(() => {
      const vol = t.inst.vol;
      t.inst = DAE.Instruments.make($b.dataset.engine, Object.keys(DAE.Instruments.PRESETS[$b.dataset.engine])[0]);
      t.inst.vol = vol;
    }));
    $i.querySelectorAll('[data-preset]').forEach($b => $b.onclick = () => App.change(() => {
      const vol = t.inst.vol, pack = t.inst.pack;
      t.inst = DAE.Instruments.make(t.inst.engine, $b.dataset.preset);
      t.inst.vol = vol;
      if(t.inst.engine === 'sample' && !$b.dataset.preset) t.inst.pack = pack;
    }));
    $i.querySelectorAll('[data-wave]').forEach($b => $b.onclick = () => App.change(() => { t.inst.wave = $b.dataset.wave; }));
    $i.querySelectorAll('[data-pack]').forEach($b => $b.onclick = () => App.change(() => { t.inst.pack = $b.dataset.pack; delete t.inst.preset; }));
    $i.querySelectorAll('[data-kit]').forEach($b => $b.onclick = () => App.change(() => { t.kit.mode = $b.dataset.kit; }));
    $i.querySelector('[data-io="save"]')?.addEventListener('click', () => Files.savePreset(t.inst, `${t.inst.engine}-${t.inst.preset ?? t.name}`));
    $i.querySelector('[data-io="load"]')?.addEventListener('click', async () => {
      const obj = await Files.loadPreset();
      if(obj) App.change(() => { t.inst = DAE.Instruments.normalize(obj); });
    });
  }
}
