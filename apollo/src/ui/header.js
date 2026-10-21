// Header: mode / level toggles, transport, song settings, master meter, file buttons.
class Header {
  static init() {
    const $ = id => document.getElementById(id);
    for(const [id, icon] of [['btn-undo', 'rotate-left'], ['btn-redo', 'rotate-right'], ['btn-new', 'file-audio'], ['btn-open', 'folder-open'], ['btn-save', 'floppy-disk']])
      $(id).innerHTML = UI.icon(icon);
    $('btn-wav').innerHTML = `${UI.icon('file-export')} <span id="btn-wav-l">WAV</span>`;
    $('in-key').innerHTML = DAE.Theory.NAMES.map(n => `<option>${n}</option>`).join('');
    $('in-scale').innerHTML = Object.keys(DAE.Theory.SCALES).map(s => `<option value="${s}">${s[0].toUpperCase() + s.slice(1)}</option>`).join('');

    document.querySelectorAll('[data-mode]').forEach($b => $b.onclick = () => App.setMode($b.dataset.mode));
    document.querySelectorAll('[data-level]').forEach($b => $b.onclick = () => App.setLevel($b.dataset.level));
    $('home').onclick = () => Start.show();
    $('btn-play').onclick = () => Header.togglePlay();
    $('btn-loop').onclick = () => App.change(p => { p.song.loop.on = !p.song.loop.on; });
    $('in-bpm').onchange = e => App.change(p => { p.song.bpm = Math.min(300, Math.max(20, Number(e.target.value) || 120)); });
    $('in-key').onchange = e => App.change(p => { p.song.key = e.target.value; }, 'none');
    $('in-scale').onchange = e => App.change(p => { p.song.scale = e.target.value; }, 'none');
    $('in-bars').onchange = e => App.change(p => DAE.Project.setBars(p, Math.min(128, Math.max(1, Math.round(Number(e.target.value) || 16)))));
    $('in-master').oninput = e => { App.p.song.master = Number(e.target.value); App.live('mix'); };
    $('btn-undo').onclick = () => App.undo();
    $('btn-redo').onclick = () => App.redo();
    $('btn-new').onclick = () => Files.newProject();
    $('btn-open').onclick = () => Files.open();
    $('btn-save').onclick = e => Files.save(e.shiftKey);
    $('btn-wav').onclick = e => Files.exportMenu(e);
  }

  static render() {
    const p = App.p, $ = id => document.getElementById(id);
    document.querySelectorAll('[data-mode]').forEach($b => $b.classList.toggle('on', $b.dataset.mode === p.mode));
    document.querySelectorAll('[data-level]').forEach($b => $b.classList.toggle('on', $b.dataset.level === App.level));
    $('btn-loop').classList.toggle('on', p.song.loop.on);
    $('in-bpm').value = p.song.bpm;
    $('in-key').value = p.song.key;
    $('in-scale').value = p.song.scale;
    $('in-bars').value = p.song.bars;
    $('in-master').value = p.song.master;
    $('btn-undo').disabled = !App.history.canUndo;
    $('btn-redo').disabled = !App.history.canRedo;
    $('btn-wav-l').textContent = Files.FORMATS[p.export.format].label;
    $('btn-wav').title = (p.mode === 'sfx' ? 'Export the current sound' : p.song.loop.on ? 'Export the loop range as a seamless loop' : 'Export the whole song') + ' (WAV or Opus)';
    Header.playButton();
    App.setDirty(App.dirty);
  }

  static playButton() {
    const $b = document.getElementById('btn-play');
    $b.innerHTML = UI.icon(App.status.playing ? 'stop' : 'play');
    $b.classList.toggle('on', App.status.playing);
  }

  static async togglePlay() {
    if(App.mode === 'sfx') { Sfx.play(); return; }
    await Audio.resume();
    if(App.status.playing) Audio.send({ t: 'stop' });
    else {
      Audio.project(App.p);
      Audio.send({ t: 'play', from: App.cursor * DAE.Project.barSteps(App.p) });
    }
    App.status.playing = !App.status.playing;
    Header.playButton();
  }

  static meter(peak) {
    const $m = document.getElementById('meter');
    $m.style.width = Math.min(100, peak * 100) + '%';
    $m.className = peak >= 1 ? 'clip' : peak > 0.8 ? 'hot' : '';
  }
}

// Start screen: pick a maker, open a file or a recent project.
class Start {
  static init() {
    document.querySelectorAll('[data-go]').forEach($b => $b.onclick = () => {
      Audio.resume();
      if(App.p && App.dirty && !confirm('Discard unsaved changes?')) return;
      Files.handle = null;
      App.load(DAE.Project.create($b.dataset.go), 'untitled.toon');
    });
    const $o = document.getElementById('start-open');
    $o.innerHTML = `${UI.icon('folder-open')} Open project (.toon)`;
    $o.onclick = () => { Audio.resume(); Files.open(); };
  }

  static show() {
    const list = Files.recent();
    const $r = document.getElementById('recent');
    $r.innerHTML = list.length ? list.map((r, i) => `<button data-r="${i}"><span>${UI.esc(r.name)}</span>
      <span class="tag"><i class="mk ${r.mode === 'sfx' ? 'sfx' : 'music'}"></i>${r.mode === 'sfx' ? 'sfx' : 'music'}</span><span>${Start.ago(r.time)}</span></button>`).join('')
      : '<div class="empty">Saved projects show up here.</div>';
    $r.querySelectorAll('[data-r]').forEach($b => $b.onclick = () => {
      if(App.p && App.dirty && !confirm('Discard unsaved changes?')) return;
      const r = list[Number($b.dataset.r)];
      Audio.resume();
      Files.handle = null;
      try { App.load(DAE.Project.parse(r.text), r.name.replace(/ \(autosave\)$/, '')); if(r.auto) App.setDirty(true); }
      catch(err) { alert(err.message); }
    });
    document.getElementById('start').classList.remove('off');
  }

  static ago(t) {
    const m = Math.round((Date.now() - t) / 60000);
    if(m < 60) return `${Math.max(1, m)} min`;
    const h = Math.round(m / 60);
    if(h < 48) return `${h} h`;
    const d = Math.round(h / 24);
    return d < 14 ? `${d} days` : `${Math.round(d / 7)} weeks`;
  }
}
