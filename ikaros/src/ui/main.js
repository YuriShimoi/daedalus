// Boot: icons, rail, keyboard, drops, then the subtool from the address (?tool=, ?open= handoff).
DAE.Icons.mount();
Hub.init();
DAE.UI.ranges();

//#region [ Keyboard ]
addEventListener('keydown', e => {
  if(e.altKey && !e.ctrlKey && /^Digit[0-8]$/.test(e.code)) {
    e.preventDefault();
    const n = +e.code.slice(5);
    return Hub.show(n ? Hub.TOOLS[n - 1].id : null);
  }
  const ui = Hub.active && Hub.tools[Hub.active];
  if(!ui) return;
  const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if(ctrl && k === 'o' && ui.pick) { e.preventDefault(); return ui.pick(); }
  if(ctrl && k === 's' && ui.save) { e.preventDefault(); return ui.save(e.shiftKey); }
  ui.keys?.(e);
});
//#endregion

//#region [ Drop, paste ]
let depth = 0;
addEventListener('dragenter', e => { if(e.dataTransfer?.types.includes('Files')) { depth++; document.body.classList.add('dragging'); } });
addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if(!depth) document.body.classList.remove('dragging'); });
addEventListener('dragover', e => { if(e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
addEventListener('drop', e => {
  if(!e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  depth = 0;
  document.body.classList.remove('dragging');
  const ui = Hub.active && Hub.tools[Hub.active];
  // folders (Prisma reads them whole)
  if(ui?.dropItems && [...e.dataTransfer.items].some(i => i.webkitGetAsEntry?.()?.isDirectory)) return ui.dropItems([...e.dataTransfer.items].map(i => i.webkitGetAsEntry()));
  Hub.drop([...e.dataTransfer.files]);
});
//#endregion

//#region [ Start ]
(async () => {
  const params = new URLSearchParams(location.search);
  const id = params.get('tool');
  const file = DAE.Handoff.take();
  await Hub.show(id ?? (file ? 'spyglass' : null), { file });
})();
//#endregion
