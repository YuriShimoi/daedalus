// Spyglass page: text pane (TOON / JSON, line numbers, errors) synced with a card graph
// (objects, arrays, tables), search, collapse, focus, paths, convert, export.
(() => {
  const { Tree, View, FileIO, Menu } = DAE;
  const S = Tree.SIZES;
  const COL = { bg: '#1A1A1A', card: '#212121', head: '#2A2A2A', line: '#44475A', text: '#FFFFFF', muted: '#6F7676', key: '#8BE9FD', string: '#50FA7B', number: '#BD93F9', boolean: '#FF79C6', null: '#6F7676', accent: '#CD7F32', hit: '#F1FA8C' };
  const SAMPLE = `app: athena
version: 1
name: Tutorial
start: r0
rooms[3]:
  - id: r0
    name: Entrance
    x: 0
    y: 0
  - id: r1
    name: Armory
    items[2]{id,kind,name}:
      i0,key,Rusty key
      i1,sword,Short sword
  - id: r2
    name: Vault
    locked: true
    chest:
      gold: 50
      gems[3]: ruby,opal,jade
passages[2]{from,to,lock}:
  r0,r1,
  r1,r2,i0
`;

  const st = {
    api: null, name: 'untitled.toon', format: 'toon', handle: null, dirty: false,
    value: undefined, ranges: new Map(), cards: [], hidden: new Set(), root: 0,
    pos: new Map(), bounds: null, view: View.make(0, 0, 1),
    sel: null, hits: [], hit: -1, parsedText: null,
  };
  let $, code;

  //#region [ Markup ]
  const html = `
    <div class="sg">
      <div class="pane sg-text">
        <div class="bar"><span class="lbl sg-name">untitled</span><span class="sp" style="flex:1"></span>
          <button class="ghost" data-a="format" title="Pretty print (keeps the format)">${Kit.icon('wand-magic-sparkles')}Format</button>
          <button class="ghost" data-a="convert" title="Convert TOON ⇄ JSON">${Kit.icon('right-left')}<span class="sg-to">JSON</span></button></div>
        <div class="sg-code"></div>
        <div class="sg-err"></div>
      </div>
      <div class="split"></div>
      <div class="sg-stage">
        <div class="sg-tools">
          <div class="sg-search">${Kit.icon('magnifying-glass')}<input placeholder="Search keys and values" spellcheck="false"><span class="sg-count"></span>
            <button class="ghost ic-only" data-a="prev" title="Previous (Shift+Enter)">${Kit.icon('chevron-down', 'up')}</button><button class="ghost ic-only" data-a="next" title="Next (Enter)">${Kit.icon('chevron-down')}</button></div>
          <span class="sg-focus"></span>
          <span style="flex:1"></span>
          <select data-a="depth" title="Collapse every branch below a depth"><option value="">Collapse…</option><option value="1">below depth 1</option><option value="2">below depth 2</option><option value="3">below depth 3</option><option value="4">below depth 4</option></select>
          <button data-a="expand" title="Expand all">${Kit.icon('expand')}Expand</button>
          <button data-a="fit" title="Fit (Shift+1)">${Kit.icon('crosshairs')}Fit</button>
        </div>
        <svg class="sg-svg"><g class="sg-world"><g class="sg-edges"></g><g class="sg-cards"></g></g></svg>
        <div class="sg-empty empty"><div class="big">${Kit.icon('ik-spyglass')}</div><div>Open, drop or paste a TOON / JSON file.</div><button data-a="sample">Try a sample</button></div>
        <div class="sg-zoom"><button class="ghost" data-a="zoom-out">−</button><button class="ghost sg-z" data-a="zoom-1">100%</button><button class="ghost" data-a="zoom-in">+</button></div>
      </div>
      <div class="status"><span>path <span class="path sg-path">—</span></span><button data-a="copy-path">copy</button><span class="sp" style="flex:1"></span><span class="sg-stats"></span><span class="sg-pos"></span></div>
    </div>`;
  //#endregion

  //#region [ Text ]
  const setText = (text, name, { handle = null, keepView = false } = {}) => {
    st.name = name ?? st.name;
    st.handle = handle;
    st.format = Tree.detect(text);
    code.setLang(st.format);
    code.value = text;
    st.dirty = false;
    reparse(true, keepView);
    $.querySelector('.sg-name').textContent = st.name;
    st.api.title(st.name);
  };

  const reparse = (fresh = false, keepView = false) => {
    const text = code.value;
    if(text === st.parsedText && !fresh) return;
    st.parsedText = text;
    const fmt = Tree.detect(text);
    if(fmt !== st.format) { st.format = fmt; code.setLang(fmt); }
    $.querySelector('.sg-to').textContent = st.format === 'json' ? 'TOON' : 'JSON';
    const $err = $.querySelector('.sg-err');
    if(!text.trim()) {
      st.value = undefined; st.cards = []; code.error(0);
      $err.textContent = ''; $err.className = 'sg-err';
      draw(); return;
    }
    const r = Tree.parse(text, fmt);
    if(r.error) {
      code.error(r.error.line);
      $err.className = 'sg-err bad';
      $err.textContent = `${fmt.toUpperCase()} · line ${r.error.line}, col ${r.error.col}: ${r.error.reason}`;
      $.querySelector('.sg-svg').classList.add('stale');
      return;
    }
    code.error(0);
    $.querySelector('.sg-svg').classList.remove('stale');
    st.value = r.value;
    st.ranges = r.ranges;
    const old = st.cards;
    st.cards = Tree.cards(r.value);
    // keep collapsed branches by path
    const was = new Set([...st.hidden].map(i => old[i]?.path).filter(p => p !== undefined));
    st.hidden = new Set(st.cards.filter(c => was.has(c.path)).map(c => c.id));
    if(fresh) {
      st.hidden = new Set();
      st.root = 0;
      if(st.cards.length > 1500) {
        st.cards.forEach(c => { if(c.depth >= 2 && c.children.length) st.hidden.add(c.id); });
        st.api.toast(`${st.cards.length} cards: branches below depth 2 start collapsed`);
      }
    }
    if(st.root >= st.cards.length || st.cards[st.root]?.path !== (old[st.root]?.path ?? '')) st.root = 0;
    const s = Tree.stats(r.value);
    $err.className = 'sg-err ok';
    $err.textContent = `● valid ${fmt.toUpperCase()} · ${s.objects} objects · ${s.arrays} arrays · ${s.values} values · depth ${s.depth}`;
    $.querySelector('.sg-stats').textContent = `${st.cards.length} cards · ${s.nodes} nodes`;
    layout();
    if(fresh && !keepView) fit();
    doSearch(false);
  };
  //#endregion

  //#region [ Graph ]
  const layout = () => {
    const r = Tree.layout(st.cards, { root: st.root, hidden: st.hidden });
    st.pos = r.pos;
    st.bounds = r.bounds;
    draw();
  };

  const trunc = (s, n) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s);
  const showVal = v => (typeof v === 'string' ? v : JSON.stringify(v));

  const draw = () => {
    const $edges = $.querySelector('.sg-edges'), $cards = $.querySelector('.sg-cards');
    $.querySelector('.sg-empty').style.display = st.cards.length ? 'none' : '';
    $.querySelector('.sg-focus').innerHTML = st.root ? `<span class="chip">Focus: <b>${Kit.esc(st.cards[st.root].path)}</b> <button class="ghost ic-only" data-a="unfocus" title="Show all">${Kit.icon('xmark')}</button></span>` : '';
    if(!st.cards.length) { $edges.innerHTML = ''; $cards.innerHTML = ''; return; }
    const hitRows = new Map();
    st.hits.forEach((h, i) => { const k = `${h.card}:${h.row}`; hitRows.set(k, i === st.hit ? 'cur' : 'hit'); });
    const e = [], c = [];
    for(const [id, p] of st.pos) {
      const card = st.cards[id];
      // edges to visible children
      if(!st.hidden.has(id)) {
        for(const kid of card.children) {
          const q = st.pos.get(kid);
          if(!q) continue;
          const r = st.cards[kid].row;
          const x1 = p.x + p.w, y1 = p.y + S.HEADER + 4 + r * S.ROW + S.ROW / 2, x2 = q.x, y2 = q.y + S.HEADER / 2, mx = (x1 + x2) / 2;
          const on = st.sel && (st.sel.card === kid || st.sel.card === id && st.sel.row === r);
          e.push(`<path d="M${x1} ${y1}C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}" fill="none" stroke="${on ? COL.accent : COL.line}" stroke-width="${on ? 2 : 1.4}"/>`);
        }
      }
      const sel = st.sel?.card === id;
      const title = card.parent < 0 ? 'root' : typeof card.key === 'number' ? `[${card.key}]` : card.key;
      const kindLbl = card.kind === 'table' ? `table · ${card.rows.length}` : card.kind === 'array' ? `array · ${card.rows.length}` : card.kind === 'object' ? `object · ${card.rows.length}` : Tree.type(card.rows[0]?.value);
      const keyHit = hitRows.get(`${id}:-1`);
      let s = `<g data-card="${id}" transform="translate(${p.x} ${p.y})">`;
      s += `<rect width="${p.w}" height="${p.h}" rx="5" fill="${COL.card}"${sel && st.sel.row < 0 ? ` stroke="${COL.accent}" stroke-width="2"` : keyHit ? ` stroke="${COL.hit}" stroke-width="${keyHit === 'cur' ? 2 : 1}"` : ''}/>`;
      s += `<path d="M0 5a5 5 0 0 1 5-5h${p.w - 10}a5 5 0 0 1 5 5v${S.HEADER - 5}h-${p.w}z" fill="${COL.head}" data-head="1"/>`;
      s += `<text x="10" y="18" class="t-key" fill="${COL.text}" font-weight="700">${Kit.esc(trunc(String(title), Math.floor((p.w - 30 - kindLbl.length * 6 - (card.children.length ? 18 : 0)) / S.CH)))}</text>`;
      s += `<text x="${p.w - 10}" y="18" text-anchor="end" class="t-ui" fill="${COL.muted}">${kindLbl}</text>`;
      if(card.kind === 'table') {
        const size = Tree.size(card);
        let x = 10;
        const cx = size.colW.map(w => { const at = x; x += w; return at; });
        const y0 = S.HEADER + 4;
        card.cols.forEach((col, j) => { s += `<text x="${cx[j]}" y="${y0 + 14}" class="t-ui" fill="${COL.muted}">${Kit.esc(trunc(col, Math.floor(size.colW[j] / S.CH) - 1))}</text>`; });
        card.rows.slice(0, S.TABLE_ROWS).forEach((r, i) => {
          const y = y0 + (i + 1) * S.ROW, hit = hitRows.get(`${id}:${i}`), rs = sel && st.sel.row === i;
          if(hit || rs) s += `<rect x="3" y="${y + 1}" width="${p.w - 6}" height="${S.ROW - 2}" rx="3" fill="${rs ? 'rgba(205,127,50,.18)' : hit === 'cur' ? 'rgba(241,250,140,.22)' : 'rgba(241,250,140,.09)'}"/>`;
          s += `<rect data-row="${i}" x="0" y="${y}" width="${p.w}" height="${S.ROW}" fill="transparent"/>`;
          r.cells.forEach((v, j) => { if(v !== undefined) s += `<text x="${cx[j]}" y="${y + 14}" class="t-mono" fill="${COL[Tree.type(v)] ?? COL.text}" pointer-events="none">${Kit.esc(trunc(showVal(v), Math.floor(size.colW[j] / S.CH) - 1))}</text>`; });
        });
        if(card.rows.length > S.TABLE_ROWS) s += `<text x="10" y="${y0 + (S.TABLE_ROWS + 1) * S.ROW + 14}" class="t-ui" fill="${COL.muted}">+${card.rows.length - S.TABLE_ROWS} more rows</text>`;
      }
      else {
        card.rows.forEach((r, i) => {
          const y = S.HEADER + 4 + i * S.ROW, hit = hitRows.get(`${id}:${i}`), rs = sel && st.sel.row === i;
          if(hit || rs) s += `<rect x="3" y="${y + 1}" width="${p.w - 6}" height="${S.ROW - 2}" rx="3" fill="${rs ? 'rgba(205,127,50,.18)' : hit === 'cur' ? 'rgba(241,250,140,.22)' : 'rgba(241,250,140,.09)'}"/>`;
          s += `<rect data-row="${i}" x="0" y="${y}" width="${p.w}" height="${S.ROW}" fill="transparent"/>`;
          const key = card.kind === 'value' ? '' : typeof r.key === 'number' ? String(r.key) : r.key;
          const maxC = Math.floor((p.w - 20) / S.CH);
          const keyS = trunc(key, Math.max(4, Math.floor(maxC * .55)));
          s += `<text x="10" y="${y + 14}" class="t-mono" fill="${typeof r.key === 'number' ? COL.muted : COL.key}" pointer-events="none">${Kit.esc(keyS)}</text>`;
          if(r.child !== undefined) {
            s += `<text x="${p.w - 14}" y="${y + 14}" text-anchor="end" class="t-mono" fill="${COL.muted}" pointer-events="none">${r.type === 'array' ? `[${r.size}]` : `{${r.size}}`}</text>`;
            s += `<circle cx="${p.w}" cy="${y + S.ROW / 2}" r="3.5" fill="${COL.line}" pointer-events="none"/>`;
          }
          else s += `<text x="${p.w - 10}" y="${y + 14}" text-anchor="end" class="t-mono" fill="${COL[r.type] ?? COL.text}" pointer-events="none">${Kit.esc(trunc(showVal(r.value), Math.max(3, maxC - keyS.length - 2)))}</text>`;
        });
      }
      c.push(s + '</g>');
    }
    $edges.innerHTML = e.join('');
    $cards.innerHTML = c.join('');
    applyView();
  };

  const applyView = () => {
    const v = st.view;
    $.querySelector('.sg-world').setAttribute('transform', `translate(${-v.x * v.zoom} ${-v.y * v.zoom}) scale(${v.zoom})`);
    $.querySelector('.sg-z').textContent = Math.round(v.zoom * 100) + '%';
  };

  const rect = () => $.querySelector('.sg-svg').getBoundingClientRect();
  const fit = () => {
    if(!st.bounds || !st.cards.length) return;
    View.fit(st.view, rect(), { x: st.bounds.x, y: st.bounds.y, w: st.bounds.w + 60, h: st.bounds.h }, { pad: 40, max: 1.2, min: 0.02 });
    applyView();
  };

  /** Pans so a card (and row) is in view. */
  const reveal = (cardId, row = -1, force = false) => {
    const p = st.pos.get(cardId);
    if(!p) return;
    const r = rect(), v = st.view;
    const wy = p.y + (row >= 0 ? S.HEADER + row * S.ROW : p.h / 2);
    const s = View.toScreen(v, r, p.x, wy), s2 = View.toScreen(v, r, p.x + p.w, wy);
    if(force || s.x < r.left + 20 || s2.x > r.right - 20 || s.y < r.top + 50 || s.y > r.bottom - 30) {
      View.center(v, r, p.x + p.w / 2, wy);
      applyView();
    }
  };
  //#endregion

  //#region [ Selection ]
  const pathOf = sel => {
    if(!sel) return null;
    const c = st.cards[sel.card];
    return sel.row >= 0 ? c.rows[sel.row].path : c.path;
  };

  const select = (sel, { fromText = false } = {}) => {
    st.sel = sel;
    const path = pathOf(sel);
    $.querySelector('.sg-path').textContent = path === null ? '—' : path || '(root)';
    draw();
    if(path === null) { code.mark([]); return; }
    const range = st.ranges.get(path);
    if(range) {
      code.mark([{ from: range[0], to: range[1] }]);
      if(!fromText) code.reveal(range[0]);
    }
  };

  /** Opens collapsed parents so a card shows. */
  const unfold = id => {
    let changed = false;
    for(let c = st.cards[id]; c && c.parent >= 0; c = st.cards[c.parent]) {
      if(st.hidden.has(c.parent)) { st.hidden.delete(c.parent); changed = true; }
    }
    if(st.root && !isUnder(id, st.root)) { st.root = 0; changed = true; }
    if(changed) layout();
  };
  const isUnder = (id, root) => { for(let c = st.cards[id]; c; c = st.cards[c.parent]) if(c.id === root) return true; return false; };

  const fromCursor = line => {
    if(!st.cards.length) return;
    const path = Tree.pathAt(st.ranges, line);
    const f = Tree.find(st.cards, path) ?? { card: 0, row: -1 };
    unfold(f.card);
    select(f, { fromText: true });
    reveal(f.card, f.row);
    $.querySelector('.sg-pos').textContent = `Ln ${line}`;
  };
  //#endregion

  //#region [ Search ]
  const doSearch = (jump = true) => {
    const q = $.querySelector('.sg-search input').value;
    st.hits = Tree.search(st.cards, q);
    st.hit = st.hits.length ? Math.min(Math.max(0, st.hit), st.hits.length - 1) : -1;
    $.querySelector('.sg-count').textContent = q ? `${st.hits.length ? st.hit + 1 : 0} / ${st.hits.length}` : '';
    if(jump && st.hits.length) go(0);
    else draw();
  };
  const go = d => {
    if(!st.hits.length) return;
    st.hit = (st.hit + d + st.hits.length) % st.hits.length;
    const h = st.hits[st.hit];
    unfold(h.card);
    $.querySelector('.sg-count').textContent = `${st.hit + 1} / ${st.hits.length}`;
    select({ card: h.card, row: h.row });
    reveal(h.card, h.row, true);
  };
  //#endregion

  //#region [ Files ]
  const TYPES = [{ description: 'TOON / JSON', accept: { 'text/plain': ['.toon', '.json'] } }];
  const pick = async () => {
    const f = await FileIO.open({ types: TYPES, accept: '.toon,.json,.txt' });
    if(!f) return;
    setText(f.text, f.name, { handle: f.handle });
    st.api.recent(f.name, f.text);
  };
  const save = async (as = false) => {
    const ext = st.format === 'json' ? '.json' : '.toon';
    let name = st.name.replace(/\.(toon|json|txt)$/i, '') + ext;
    const h = await FileIO.save(code.value, { name, types: [{ description: st.format.toUpperCase(), accept: { 'text/plain': [ext] } }], handle: st.handle && st.name.endsWith(ext) ? st.handle : null, as });
    if(h === undefined) return;
    st.handle = h;
    if(h?.name) name = h.name;
    st.name = name;
    $.querySelector('.sg-name').textContent = name;
    st.api.title(name);
    st.api.recent(name, code.value);
    st.api.toast(`Saved ${name}`);
  };
  const paste = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if(t.trim()) setText(t, 'pasted' + (Tree.detect(t) === 'json' ? '.json' : '.toon'));
    } catch { st.api.toast('Paste with Ctrl+V in the text pane', true); }
  };

  const svgOut = () => {
    if(!st.bounds) return null;
    const pad = 24, b = st.bounds, w = b.w + pad * 2 + 60, h = b.h + pad * 2;
    const inner = $.querySelector('.sg-world').innerHTML;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${b.x - pad} ${b.y - pad} ${w} ${h}"><style>text{font-size:12px}.t-mono,.t-key{font-family:Consolas,monospace}.t-ui{font-family:'Segoe UI',sans-serif;font-size:11px}</style><rect x="${b.x - pad}" y="${b.y - pad}" width="${w}" height="${h}" fill="${COL.bg}"/>${inner}</svg>`;
  };
  const exportMenu = (e, $btn) => {
    const r = $btn.getBoundingClientRect();
    const base = st.name.replace(/\.(toon|json|txt)$/i, '');
    Menu.show(r.left, r.bottom + 4, [
      'Graph',
      ['image', 'PNG (2×)', async () => {
        const svg = svgOut();
        if(!svg) return;
        const img = new Image();
        img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        await img.decode();
        const k = Math.min(2, 16000 / Math.max(img.width, img.height));
        const cv = Object.assign(document.createElement('canvas'), { width: img.width * k, height: img.height * k });
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        cv.toBlob(b => Kit.download(`${base}.png`, b));
      }],
      ['file-export', 'SVG', () => { const s = svgOut(); if(s) Kit.download(`${base}.svg`, s, 'image/svg+xml'); }],
      '-', 'Text',
      ['download', 'as TOON', () => { try { Kit.download(`${base}.toon`, Tree.stringify(st.value, 'toon')); } catch(err) { st.api.toast(err.message, true); } }],
      ['download', 'as JSON', () => { if(st.value !== undefined) Kit.download(`${base}.json`, Tree.stringify(st.value, 'json'), 'application/json'); }],
    ]);
  };
  //#endregion

  //#region [ Mount ]
  const mount = api => {
    st.api = api;
    $ = api.$el;
    $.innerHTML = html;
    const $g = $.querySelector('.sg');
    code = new Kit.Code($.querySelector('.sg-code'), {
      lang: 'toon',
      onInput: Kit.later(() => { st.dirty = true; reparse(); api.later('text', () => ({ name: st.name, text: code.value }), 600); }, 300),
      onCursor: fromCursor,
    });
    Kit.split($.querySelector('.split'), $.querySelector('.sg-text'), w => $g.style.setProperty('--w', w + 'px'), { min: 220, max: 1100 });

    api.actions([
      ['folder-open', 'Open', pick, { title: 'Open a .toon / .json (Ctrl+O)' }],
      ['paste', 'Paste', paste, { title: 'Paste text from the clipboard' }],
      ['floppy-disk', 'Save', () => save(), { title: 'Save the text (Ctrl+S, Shift for Save as)' }],
      ['file-export', 'Export', exportMenu, { primary: true }],
    ]);

    // toolbar / buttons
    $.addEventListener('click', e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if(!a) return;
      if(a === 'sample') setText(SAMPLE, 'sample.toon');
      if(a === 'format' && st.value !== undefined) { code.value = Tree.stringify(st.value, st.format); reparse(); }
      if(a === 'convert' && st.value !== undefined) {
        try {
          const to = st.format === 'json' ? 'toon' : 'json';
          code.value = Tree.stringify(st.value, to);
          st.name = st.name.replace(/\.(toon|json)$/i, '') + '.' + to;
          $.querySelector('.sg-name').textContent = st.name;
          api.title(st.name);
          reparse(false, true);
        } catch(err) { api.toast(err.message, true); }
      }
      if(a === 'next') go(1);
      if(a === 'prev') go(-1);
      if(a === 'expand') { st.hidden.clear(); layout(); }
      if(a === 'fit') fit();
      if(a === 'unfocus') { st.root = 0; layout(); fit(); }
      if(a === 'zoom-in' || a === 'zoom-out') { View.zoomAt(st.view, rect(), a === 'zoom-in' ? 1.25 : 0.8); applyView(); }
      if(a === 'zoom-1') { View.zoomAt(st.view, rect(), 1 / st.view.zoom); applyView(); }
      if(a === 'copy-path') { const p = pathOf(st.sel); if(p !== null) Kit.copy(p || '(root)', 'Path copied'); }
    });
    $.querySelector('[data-a="depth"]').onchange = e => {
      const d = +e.target.value;
      e.target.value = '';
      if(!d) return;
      st.hidden = new Set(st.cards.filter(c => c.depth >= d - 1 && c.children.length && c.depth >= 0).map(c => c.id).filter(id => st.cards[id].depth >= d - 1));
      layout();
      fit();
    };
    const $q = $.querySelector('.sg-search input');
    $q.addEventListener('input', Kit.later(() => { st.hit = 0; doSearch(true); }, 200));
    $q.addEventListener('keydown', e => { if(e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? -1 : 1); } if(e.key === 'Escape') { $q.value = ''; doSearch(false); } });

    // graph: pan, zoom, click, fold, right-click
    const $svg = $.querySelector('.sg-svg');
    let drag = null;
    $svg.addEventListener('pointerdown', e => {
      if(e.button !== 0 && e.button !== 1) return;
      drag = { x: e.clientX, y: e.clientY, moved: false };
      $svg.setPointerCapture(e.pointerId);
    });
    $svg.addEventListener('pointermove', e => {
      if(!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if(!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      $svg.classList.add('panning');
      View.pan(st.view, dx, dy);
      drag.x = e.clientX; drag.y = e.clientY;
      applyView();
    });
    $svg.addEventListener('pointerup', e => {
      const was = drag;
      drag = null;
      $svg.classList.remove('panning');
      if(!was || was.moved) return;
      const $fold = e.target.closest('[data-fold]');
      if($fold) {
        const id = +$fold.dataset.fold;
        st.hidden.has(id) ? st.hidden.delete(id) : st.hidden.add(id);
        layout();
        return;
      }
      const $card = e.target.closest('[data-card]');
      if(!$card) { select(null); return; }
      const id = +$card.dataset.card, row = e.target.closest('[data-row]') ? +e.target.closest('[data-row]').dataset.row : -1;
      const r = st.cards[id].rows[row];
      if(r?.child !== undefined && e.detail >= 1 && st.hidden.has(id)) { st.hidden.delete(id); layout(); }
      select({ card: id, row });
    });
    $svg.addEventListener('dblclick', e => {
      const $card = e.target.closest('[data-card]');
      if(!$card) return fit();
      const id = +$card.dataset.card, $row = e.target.closest('[data-row]');
      const r = $row ? st.cards[id].rows[+$row.dataset.row] : null;
      if(r?.child !== undefined) { select({ card: r.child, row: -1 }); reveal(r.child, -1, true); }
    });
    $svg.addEventListener('wheel', e => {
      e.preventDefault();
      if(e.ctrlKey || !e.shiftKey && Math.abs(e.deltaY) >= Math.abs(e.deltaX) && !e.altKey) {
        View.zoomAt(st.view, rect(), Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY, 0.02, 4);
      }
      else View.pan(st.view, -e.deltaX || -e.deltaY, 0);
      applyView();
    }, { passive: false });
    $svg.addEventListener('contextmenu', e => {
      e.preventDefault();
      const $card = e.target.closest('[data-card]');
      if(!$card) return Menu.show(e.clientX, e.clientY, [['crosshairs', 'Fit', fit], ['expand', 'Expand all', () => { st.hidden.clear(); layout(); }]]);
      const id = +$card.dataset.card, $row = e.target.closest('[data-row]'), row = $row ? +$row.dataset.row : -1;
      select({ card: id, row });
      const path = pathOf({ card: id, row }), val = Tree.get(st.value, path);
      const card = st.cards[id];
      Menu.show(e.clientX, e.clientY, [
        Kit.esc(path || '(root)'),
        ['copy', 'Copy path', () => Kit.copy(path || '(root)', 'Path copied')],
        ['copy', 'Copy value as JSON', () => Kit.copy(JSON.stringify(val, null, 2), 'Value copied')],
        ['copy', 'Copy value as TOON', () => { try { Kit.copy(Tree.stringify(val && typeof val === 'object' && !Array.isArray(val) ? val : { value: val }, 'toon'), 'Value copied'); } catch(err) { st.api.toast(err.message, true); } }],
        '-',
        card.children.length ? ['layer-group', st.hidden.has(id) ? 'Expand' : 'Collapse', () => { st.hidden.has(id) ? st.hidden.delete(id) : st.hidden.add(id); layout(); }] : null,
        ['crosshairs', 'Focus this branch', () => { st.root = id; st.hidden.delete(id); layout(); fit(); }, { disabled: id === st.root }],
        st.root ? ['expand', 'Show all', () => { st.root = 0; layout(); fit(); }] : null,
      ]);
    });
    new ResizeObserver(() => applyView()).observe($svg);

    // last text
    api.get('text').then(t => { if(t?.text && !st.cards.length && !code.value) setText(t.text, t.name, { keepView: false }); });
  };
  //#endregion

  Hub.register('spyglass', {
    mount,
    pick,
    save,
    async open(file) { setText(file.text, file.name); st.api.recent(file.name, file.text); },
    async drop(files) {
      const f = files[0];
      const text = await f.text();
      setText(text, f.name);
      st.api.recent(f.name, text);
    },
    keys(e) {
      if(e.shiftKey && e.code === 'Digit1' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { e.preventDefault(); fit(); }
      if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $.querySelector('.sg-search input').focus(); }
    },
  });
})();
