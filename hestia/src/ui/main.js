// Boot: icons, panels, board input, keyboard shortcuts, clipboard and file drops, last session.
DAE.Icons.mount();
App.$board = document.getElementById('board');
Panels.init();
Tools.init(App.$board);

let lastPointer = null;
App.$board.addEventListener('pointermove', e => { lastPointer = { x: e.clientX, y: e.clientY }; });
const pointerWorld = () => (lastPointer ? App.toWorld(lastPointer.x, lastPointer.y) : App.center());
new ResizeObserver(() => Render.view()).observe(App.$board);

DAE.UI.ranges();   // shared/ui.js: sliders fill up to their thumb

//#region [ Keyboard ]
const typing = () => /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '') || document.activeElement?.isContentEditable;
const KEYS = Object.fromEntries(Tools.TOOLS.filter(Boolean).map(t => [t[2].toLowerCase(), t[0]]));

addEventListener('keydown', e => {
  const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
  if(ctrl && k === 's') { e.preventDefault(); return Files.save(e.shiftKey); }
  if(ctrl && k === 'o') { e.preventDefault(); return Files.open(); }
  if(typing()) return;
  if(ctrl && k === 'f') { e.preventDefault(); return Panels.search(true); }
  if(ctrl && k === 'z') { e.preventDefault(); return e.shiftKey ? App.redo() : App.undo(); }
  if(ctrl && k === 'y') { e.preventDefault(); return App.redo(); }
  if(ctrl && k === 'g') { e.preventDefault(); return Panels.act(e.shiftKey ? 'ungroup' : 'group'); }
  if(ctrl && k === 'd') { e.preventDefault(); return App.duplicate(); }
  if(ctrl && k === 'a') { e.preventDefault(); return App.select(App.b.items.map(i => i.id)); }
  if(ctrl && e.key === ']') { e.preventDefault(); return Panels.act('front'); }
  if(ctrl && e.key === '[') { e.preventDefault(); return Panels.act('back'); }
  if(ctrl && k === '0') { e.preventDefault(); const r = App.$board.getBoundingClientRect(); return App.zoomAt(1 / App.view.zoom, r.left + r.width / 2, r.top + r.height / 2); }
  if(e.shiftKey && e.code === 'Digit1') { e.preventDefault(); return App.fit(); }
  if(e.shiftKey && e.code === 'Digit2' && App.sel.size) { e.preventDefault(); return App.fit(Board.bounds(App.selected)); }
  if(ctrl) return;
  if(e.key === ' ') { e.preventDefault(); if(!Tools.space) { Tools.space = true; App.$board.classList.add('pan'); } return; }
  if(e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); return App.remove(); }
  if(e.key === 'Escape') {
    if(!document.getElementById('search').classList.contains('off')) return Panels.search(false);
    if(App.tool !== 'select') return Tools.set('select');
    App.edgeSel = 0;
    return App.select([]);
  }
  if(e.key === 'Enter' && App.one && ['text', 'note', 'shape'].includes(App.one.kind) && !Board.isLine(App.one)) { e.preventDefault(); return Tools.edit(App.one); }
  if(e.key.startsWith('Arrow') && App.sel.size) {
    e.preventDefault();
    const d = e.shiftKey ? 10 : 1, dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
    return App.change(b => Board.move(b, [...App.sel], dx, dy));
  }
  if((k === 'o' || k === 'd') && !e.altKey) { App.style.shape = k === 'o' ? 'ellipse' : 'diamond'; return Tools.set('shape'); }
  if(KEYS[k] && !e.altKey) {
    Tools.set(KEYS[k]);
  }
});

addEventListener('keyup', e => {
  if(e.key === ' ') { Tools.space = false; App.$board.classList.toggle('pan', App.tool === 'hand'); }
});
//#endregion

//#region [ Clipboard, drop ]
addEventListener('copy', e => {
  if(typing() || !App.copy()) return;
  App.clipMark = `hestia-clip:${Date.now()}`;
  e.clipboardData.setData('text/plain', App.clipMark);
  e.preventDefault();
});

addEventListener('cut', e => {
  if(typing() || !App.copy()) return;
  App.clipMark = `hestia-clip:${Date.now()}`;
  e.clipboardData.setData('text/plain', App.clipMark);
  e.preventDefault();
  App.remove();
});

addEventListener('paste', e => {
  if(typing()) return;
  e.preventDefault();
  const files = [...(e.clipboardData?.files ?? [])];
  if(files.length) return Files.add(files, pointerWorld());
  Files.pasteText(e.clipboardData?.getData('text/plain') ?? '', pointerWorld());
});

App.$board.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
App.$board.addEventListener('drop', e => {
  e.preventDefault();
  const files = [...e.dataTransfer.files];
  if(files.length) Files.add(files, App.toWorld(e.clientX, e.clientY));
});
//#endregion

Files.restore().then(ok => {
  if(!ok) App.load(DAE.Board.create());
  App.render();
});
