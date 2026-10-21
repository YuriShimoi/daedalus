// Boot: icons, header, start screen, global keys and the audio status loop.
DAE.Icons.mount();
DAE.Samples.collect();
Header.init();
Start.init();
Keyboard.init();

Audio.onStatus = st => {
  const was = App.status.playing;
  App.status = st;
  Header.meter(st.peak);
  if(was !== st.playing) Header.playButton();
  if(App.p?.mode === 'music') {
    Playlist.playhead(st);
    Editor.tick(st);
  }
};

DAE.UI.ranges();   // shared/ui.js: sliders fill up to their thumb

addEventListener('pointerdown', () => { Audio.resume(); }, { once: true, capture: true });
addEventListener('pointerup', () => Playlist.endPaint());
addEventListener('blur', () => Keyboard.allOff());

addEventListener('keydown', e => {
  if(!App.p || !document.getElementById('start').classList.contains('off')) return;
  const tag = document.activeElement?.tagName, typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(tag) && document.activeElement.type !== 'range';
  const ctrl = e.ctrlKey || e.metaKey;
  if(ctrl) {
    const k = e.key.toLowerCase();
    if(k === 's') { e.preventDefault(); Files.save(e.shiftKey); }
    else if(k === 'o') { e.preventDefault(); Files.open(); }
    else if(typing) return;
    else if(k === 'z') { e.preventDefault(); e.shiftKey ? App.redo() : App.undo(); }
    else if(k === 'y') { e.preventDefault(); App.redo(); }
    else if(App.mode === 'music' && k === 'c') { e.preventDefault(); Editor.copy(); }
    else if(App.mode === 'music' && k === 'v') { e.preventDefault(); Editor.paste(); }
    else if(App.mode === 'music' && k === 'a') { e.preventDefault(); Editor.selectAll(); }
    return;
  }
  if(typing || e.altKey) return;
  if(e.code === 'Space' && !Keyboard.learning) { e.preventDefault(); if(!e.repeat) Header.togglePlay(); return; }
  if(App.mode === 'music' && Editor.sel.size && (e.code === 'Delete' || e.code === 'Backspace')) { e.preventDefault(); Editor.deleteSel(); return; }
  if(App.mode === 'music' && Editor.sel.size && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) { e.preventDefault(); Editor.transpose((e.code === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1)); return; }
  if(e.repeat) { if(DAE.Keymap.find(App.p.keyboard, e.code) >= 0) e.preventDefault(); return; }
  if(Keyboard.keydown(e)) e.preventDefault();
});
addEventListener('keyup', e => Keyboard.keyup(e));

addEventListener('beforeunload', e => { if(App.dirty) e.preventDefault(); });

// stored lists first (recent, autosave, templates), then a project sent from Hestia (?open=), else the start screen
Files.init().then(() => {
  const handed = DAE.Handoff.take();
  let opened = false;
  if(handed) {
    try { App.load(DAE.Project.parse(handed.text), handed.name.replace(/\.\w+$/, '') + '.toon'); opened = true; }
    catch(err) { alert(`Can't read ${handed.name}:\n${err.message}`); }
  }
  if(!opened) Start.show();
});
