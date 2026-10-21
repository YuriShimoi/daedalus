// Header actions, tool rail, context bar (style of the selection or the active tool), zoom box,
// empty-board start panel and search.
class Panels {
  static init() {
    const I = DAE.Icons.html;
    // header
    const acts = [
      ['undo', 'rotate-left', 'Undo (Ctrl+Z)', () => App.undo()], ['redo', 'rotate-right', 'Redo (Ctrl+Y)', () => App.redo()], null,
      ['search', 'magnifying-glass', 'Search (Ctrl+F)', () => Panels.search(true)], null,
      ['new', 'file-circle-plus', 'New board', () => Files.newBoard(), true], ['open', 'folder-open', 'Open board (Ctrl+O)', () => Files.open()],
      ['save', 'floppy-disk', 'Save board (Ctrl+S)', () => Files.save()], ['export', 'file-export', 'Export PNG / SVG', e => Menu.exportMenu(e)],
    ];
    const $a = document.getElementById('actions');
    for(const a of acts) {
      if(!a) { $a.insertAdjacentHTML('beforeend', '<span class="sep"></span>'); continue; }
      const $b = document.createElement('button');
      $b.id = `btn-${a[0]}`;
      $b.title = a[2];
      $b.innerHTML = I(a[1]);
      $b.onclick = a[3];
      $a.append($b);
    }
    // rail
    const $r = document.getElementById('rail');
    for(const t of Tools.TOOLS) {
      if(!t) { $r.insertAdjacentHTML('beforeend', '<span class="sep"></span>'); continue; }
      const [id, icon, key, label] = t;
      $r.insertAdjacentHTML('beforeend', `<button data-tool="${id}" title="${label} (${key})">${I(icon)}<kbd>${key}</kbd></button>`);
    }
    $r.onclick = e => { const $b = e.target.closest('[data-tool]'); if($b) Tools.set($b.dataset.tool); };
    // zoom box
    document.getElementById('zoom').innerHTML = `<button data-z="out" title="Zoom out">−</button><button data-z="reset" id="zoom-label" title="Reset to 100%">100%</button><button data-z="in" title="Zoom in">+</button><button data-z="fit" title="Zoom to fit (Shift+1)">${I('expand')}</button>`;
    document.getElementById('zoom').onclick = e => {
      const z = e.target.closest('[data-z]')?.dataset.z, r = App.$board.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if(z === 'in') App.zoomAt(1.25, cx, cy);
      else if(z === 'out') App.zoomAt(0.8, cx, cy);
      else if(z === 'reset') App.zoomAt(1 / App.view.zoom, cx, cy);
      else if(z === 'fit') App.fit();
    };
    // search
    const $s = document.getElementById('search-in');
    $s.oninput = () => Panels.#find(0);
    $s.onkeydown = e => {
      e.stopPropagation();
      if(e.key === 'Enter') Panels.#find(e.shiftKey ? -1 : 1);
      if(e.key === 'Escape') Panels.search(false);
    };
  }

  static update() {
    document.querySelectorAll('#rail [data-tool]').forEach($b => $b.classList.toggle('on', $b.dataset.tool === App.tool));
    document.getElementById('btn-undo').disabled = !App.history.canUndo;
    document.getElementById('btn-redo').disabled = !App.history.canRedo;
    Panels.#ctx();
    Panels.#empty();
  }

  static zoomLabel() {
    const $l = document.getElementById('zoom-label');
    if($l) $l.textContent = `${Math.round(App.view.zoom * 100)}%`;
  }

  //#region [ Context bar ]
  static #ctx() {
    const $c = document.getElementById('ctx'), I = DAE.Icons.html, items = App.selected.filter(i => !i.locked);
    const drawing = ['pen', 'shape', 'line', 'arrow', 'text'].includes(App.tool);
    const out = [];
    if(App.edgeSel) {
      const e = App.b.edges.find(x => x.id === App.edgeSel);
      out.push('<span class="lbl">Link</span>', Panels.#swatches(e?.color || '#A3A3A3'), `<button data-act="edge-label">Label</button><button data-act="delete" title="Delete (Del)">${I('trash')}</button>`);
    }
    else if(items.length || drawing) {
      const first = items[0], kinds = new Set(items.map(i => i.kind));
      const color = first ? first.color ?? App.style.color : App.style.color;
      if(!kinds.size || [...kinds].some(k => ['stroke', 'shape', 'text', 'group', 'note'].includes(k))) out.push('<span class="lbl">Color</span>', Panels.#swatches(color, kinds.has('note') && kinds.size === 1));
      const allText = kinds.size ? [...kinds].every(k => k === 'text') : App.tool === 'text';
      const lines = items.filter(i => Board.isLine(i)), onlyLines = items.length ? lines.length === items.length : ['line', 'arrow'].includes(App.tool);
      if(lines.length) {
        const bent = lines.some(i => i.mx != null), curved = lines.some(i => i.curve);
        out.unshift('<span class="lbl">Path</span>', `<button class="${curved ? '' : 'on'}" data-curve="0" title="Sharp corner at the middle point">sharp</button>`,
          `<button class="${curved ? 'on' : ''}" data-curve="1" title="Curve through the middle point">curve</button>`,
          bent ? '<button data-act="straight" title="Remove the middle point">straight</button>' : '', '<span class="sep"></span>');
      }
      if(!onlyLines) out.push(`<span class="lbl">${allText ? 'Underline' : 'Border'}</span>`, Panels.#swatches(first ? first.border ?? '' : App.style.border, true, 'border'));
      const shapes = items.filter(i => i.kind === 'shape' && !Board.isLine(i));
      if(shapes.length || App.tool === 'shape') {
        const cur = shapes[0]?.shape ?? App.style.shape;
        out.unshift('<span class="lbl">Shape</span>', ...Board.BOXES.map(s => `<button class="shp${cur === s ? ' on' : ''}" data-shape="${s}" title="${s}">${Panels.shapeIcon(s)}</button>`), '<span class="sep"></span>');
      }
      if(shapes.length || App.tool === 'shape') {
        const f = shapes[0]?.fill ?? App.style.fill;
        out.push('<span class="lbl">Fill</span>', ...['none', 'tint', 'solid'].map(v => `<button class="${f === v ? 'on' : ''}" data-fill="${v}">${v}</button>`));
      }
      if(!kinds.size || [...kinds].some(k => k === 'stroke' || k === 'shape')) {
        const wi = items.find(i => i.width), lv = wi ? wi.width / (wi.kind === 'stroke' ? 1.5 : 1) : App.style.width;
        const near = [1, 2, 4].reduce((a, v) => (Math.abs(v - lv) < Math.abs(a - lv) ? v : a));
        out.push('<span class="lbl">Width</span>', ...[[1, 'thin'], [2, 'medium'], [4, 'bold']].map(([v, l]) => `<button class="${near === v ? 'on' : ''}" data-width="${v}">${l}</button>`));
      }
      if(kinds.has('text') || shapes.length || App.tool === 'text') {
        const sz = items.find(i => i.size)?.size ?? App.style.size;
        out.push('<span class="lbl">Size</span>', ...[[14, 'S'], [20, 'M'], [32, 'L'], [52, 'XL']].map(([v, l]) => `<button class="${sz === v ? 'on' : ''}" data-size="${v}">${l}</button>`));
      }
      if(items.length) {
        out.push('<span class="sep"></span>');
        if(items.length > 1) out.push(...[['left', 'Align left'], ['hcenter', 'Center'], ['top', 'Align top'], ['vcenter', 'Middle']].map(([k, t]) => `<button data-align="${k}" title="${t}">${t}</button>`));
        out.push(`<button data-act="front" title="Bring to front (Ctrl+])">Front</button><button data-act="back" title="Send to back (Ctrl+[)">Back</button>`);
        out.push(`<button data-act="dup" title="Duplicate (Ctrl+D)">${I('clone')}</button><button data-act="lock" title="Lock">${I('lock')}</button><button data-act="delete" title="Delete (Del)">${I('trash')}</button>`);
      }
    }
    else if(App.selected.some(i => i.locked)) out.push(`<span class="hint">Locked</span><button data-act="unlock">${DAE.Icons.html('lock-open')} Unlock</button>`);
    else out.push(`<span class="hint">${Panels.#hint()}</span>`);
    $c.innerHTML = out.join('');
    $c.onclick = Panels.#ctxClick;
  }

  static #hint() {
    const h = {
      select: 'Click to select · drag to move (snaps; hold Alt to move freely) · drag the board to box-select · double-click: text · wheel: pan · Ctrl+wheel: zoom · drag a selected item\'s side dot to link it',
      hand: 'Drag to pan',
      note: 'Click to place a Markdown note', image: 'Click to place an image (or paste / drop one)', widget: 'Click to place a widget: pick an Athena map, an Apollo .toon or an audio file',
    };
    return h[App.tool] ?? '';
  }

  /** Small outline picture of a box shape (for the picker). */
  static shapeIcon(shape) {
    return `<svg width="20" height="16" viewBox="-1 -1 22 18">${Render.shapeSvg({ shape, w: 20, h: 16, width: 1.6, color: 'currentColor', fill: 'none' })}</svg>`;
  }

  /** Color buttons; `none` adds an empty first choice. */
  static #swatches(cur, none = false, attr = 'color') {
    const list = attr === 'border' ? ['', ...Board.BORDERS] : none ? ['', ...Board.COLORS] : Board.COLORS;
    return list.map(c => `<button class="sw${(c || '') === (cur || '') ? ' on' : ''}" data-${attr}="${c}" title="${c || 'none'}" style="background:${c || 'var(--raised)'}">${c ? '' : '<i class="no"></i>'}</button>`).join('');
  }

  static #ctxClick = e => {
    const $b = e.target.closest('button');
    if(!$b) return;
    const d = $b.dataset, items = App.selected.filter(i => !i.locked);
    const apply = fn => { if(items.length) App.change(() => items.forEach(fn)); else App.render(); };
    if(d.color !== undefined) {
      if(App.edgeSel) { const ed = App.b.edges.find(x => x.id === App.edgeSel); App.change(() => { ed.color = d.color; }); return; }
      if(d.color) App.style.color = d.color;
      apply(i => { if(i.kind === 'note') i.color = d.color || undefined; else if(i.kind !== 'image' && i.kind !== 'widget') i.color = d.color || '#FFFFFF'; });
    }
    else if(d.curve !== undefined) apply(i => {
      if(!Board.isLine(i)) return;
      if(d.curve === '1') { i.curve = true; if(i.mx == null) Object.assign(i, (({ x, y }) => ({ mx: x + (i.y2 - i.y1) * 0.2, my: y - (i.x2 - i.x1) * 0.2 }))(Board.mid(i))); }
      else delete i.curve;
    });
    else if(d.shape) { App.style.shape = d.shape; apply(i => { if(i.kind === 'shape' && !Board.isLine(i)) i.shape = d.shape; }); }
    else if(d.border !== undefined) { App.style.border = Board.border = d.border; apply(i => { if(d.border) i.border = d.border; else delete i.border; }); }
    else if(d.fill) { App.style.fill = d.fill; apply(i => { if(i.kind === 'shape') i.fill = d.fill; }); }
    else if(d.width) { App.style.width = Number(d.width); apply(i => { if(i.kind === 'shape') i.width = Number(d.width); if(i.kind === 'stroke') i.width = Number(d.width) * 1.5; }); }
    else if(d.size) { App.style.size = Number(d.size); apply(i => { if(i.kind === 'text' || i.kind === 'shape') i.size = Number(d.size); }); }
    else if(d.align) Panels.align(d.align);
    else if(d.act) Panels.act(d.act);
  };

  static act(a) {
    const items = App.selected;
    switch(a) {
      case 'delete': return App.remove();
      case 'dup': return App.duplicate();
      case 'lock': return App.change(() => items.forEach(i => { i.locked = true; }));
      case 'unlock': return App.change(() => items.forEach(i => { i.locked = false; }));
      case 'front': return App.change(b => { let z = Board.top(b); items.forEach(i => { i.z = ++z; }); });
      case 'back': return App.change(b => { let z = Math.min(...b.items.map(i => i.z)) - items.length; items.forEach(i => { i.z = z++; }); });
      case 'edge-label': return Tools.editEdge(App.edgeSel);
      case 'straight': return App.change(() => items.forEach(i => { delete i.mx; delete i.my; delete i.curve; }));
      case 'group': {
        const ids = items.filter(i => i.kind !== 'group' && !i.locked).map(i => i.id);
        if(!ids.length) return;
        let g = null;
        App.change(b => { g = Board.group(b, ids); });
        return App.select([g.id]);
      }
      case 'ungroup': return App.change(b => { b.items = b.items.filter(i => !(i.kind === 'group' && App.sel.has(i.id))); });
    }
  }

  static align(k) {
    const items = App.selected.filter(i => !i.locked), box = Board.bounds(items);
    App.change(b => {
      for(const i of items) {
        const dx = k === 'left' ? box.x - i.x : k === 'hcenter' ? box.x + box.w / 2 - (i.x + i.w / 2) : 0;
        const dy = k === 'top' ? box.y - i.y : k === 'vcenter' ? box.y + box.h / 2 - (i.y + i.h / 2) : 0;
        Board.move(b, [i.id], dx, dy);
      }
    });
  }
  //#endregion

  //#region [ Empty board, search ]
  static #empty() {
    const $e = document.getElementById('empty');
    if(App.b.items.length) { $e.innerHTML = ''; return; }
    if($e.dataset.built === App.fileName) return;
    $e.dataset.built = App.fileName;
    const recent = Files.recent();
    $e.innerHTML = `<div class="start"><h2>An empty board</h2>
      <p>Draw, write Markdown notes, paste images, link cards, and drop an Athena map, an Apollo song or an audio file to get a live widget.</p>
      <div class="row"><button data-e="note">${DAE.Icons.html('note-sticky')} Note</button><button data-e="widget">${DAE.Icons.html('window-maximize')} Widget</button><button data-e="open">${DAE.Icons.html('folder-open')} Open board</button></div>
      ${recent.length ? `<div class="section">Recent</div><div class="recent">${recent.map((r, i) => `<button data-recent="${i}"><span>${DAE.Markdown.esc(r.name)}</span><span>${new Date(r.time).toLocaleDateString()}</span></button>`).join('')}</div>` : ''}</div>`;
    $e.onclick = e => {
      const $b = e.target.closest('button');
      if(!$b) return;
      if($b.dataset.e === 'note') Tools.newNote(App.center());
      else if($b.dataset.e === 'widget') Files.pick('widget', App.center());
      else if($b.dataset.e === 'open') Files.open();
      else if($b.dataset.recent) Files.openRecent(Number($b.dataset.recent));
    };
  }

  static #hits = [];
  static #at = -1;

  static search(on) {
    const $s = document.getElementById('search');
    $s.classList.toggle('off', !on);
    if(on) { const $i = document.getElementById('search-in'); $i.focus(); $i.select(); Panels.#find(0); }
    else { Render.flash = 0; Render.overlay(); App.$board.focus(); }
  }

  static #find(step) {
    const q = document.getElementById('search-in').value;
    if(step === 0) { Panels.#hits = Board.search(App.b, q); Panels.#at = -1; step = 1; }
    const n = Panels.#hits.length;
    document.getElementById('search-count').textContent = n ? '' : q ? '0' : '';
    if(!n) { Render.flash = 0; Render.overlay(); return; }
    Panels.#at = (Panels.#at + step + n) % n;
    const it = Board.find(App.b, Panels.#hits[Panels.#at]);
    document.getElementById('search-count').textContent = `${Panels.#at + 1}/${n}`;
    Render.flash = it.id;
    const r = App.$board.getBoundingClientRect(), v = App.view;
    v.x = it.x + it.w / 2 - r.width / 2 / v.zoom;
    v.y = it.y + it.h / 2 - r.height / 2 / v.zoom;
    Render.view();
    Render.overlay();
  }
  //#endregion
}
