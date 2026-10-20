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

// range fill: --p follows the value (on input, and for every slider a render adds or resets)
const fillRange = $i => {
  const min = $i.min === '' ? 0 : Number($i.min), max = $i.max === '' ? 100 : Number($i.max);
  $i.style.setProperty('--p', max > min ? (Number($i.value) - min) / (max - min) : 0);
};
addEventListener('input', e => { if(e.target.type === 'range') fillRange(e.target); }, true);
new MutationObserver(() => document.querySelectorAll('input[type=range]').forEach(fillRange))
  .observe(document.body, { childList: true, subtree: true });

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

Start.show();
