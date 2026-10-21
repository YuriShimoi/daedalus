// Prisma page: sources (files, a whole folder, pasted text) -> every color found, as a palette
// grouped / sorted / merged, with what each color paints and exports.
(() => {
  const { Colors, FileIO, Menu } = DAE;
  const SAMPLE = `:root {
  --bg: #1A1A1A;
  --raised: #212121;
  --text: #FFFFFF;
  --accent: #CD7F32;
  --good: hsl(135 94% 65%);
  --bad: rgb(255 85 85);
}
body { background: var(--bg); color: var(--text); }
.btn { background: var(--accent); color: #1a1a1a; border: 1px solid #44475A; }
.btn:hover { background: #E3A869; box-shadow: 0 0 0 2px rgba(205, 127, 50, .4); }
.tag.warn { color: #FFB86C; background: oklch(80% 0.12 60 / 15%); }
.link { color: cornflowerblue; }
`;

  const st = { api: null, files: [], off: new Set(), hits: [], uses: [], sort: 'hue', group: 'none', view: 'cards', merge: 0, q: '', sel: null, busy: false, ext: Colors.EXT.join(', ') };
  let $, worker = null;

  const html = `
    <div class="pr">
      <aside class="pane pr-src">
        <div class="bar"><span class="lbl">Sources</span><span style="flex:1"></span><button class="ghost ic-only" data-a="clear" title="Remove all">${Kit.icon('trash')}</button></div>
        <div class="pr-files scroll"></div>
        <div class="pr-paste"><textarea placeholder="…or paste CSS / HTML / code here" spellcheck="false"></textarea></div>
        <label class="field pr-ext"><span>File types read from folders</span><input data-o="ext" spellcheck="false"></label>
      </aside>
      <div class="split"></div>
      <section class="pr-main">
        <div class="bar pr-opts">
          <span class="lbl">Sort</span><span class="seg" data-o="sort"><button data-v="hue">hue</button><button data-v="light">light</button><button data-v="usage">usage</button><button data-v="first">first seen</button></span>
          <span class="lbl">Group</span><span class="seg" data-o="group"><button data-v="none">none</button><button data-v="file">file</button><button data-v="cat">what it paints</button><button data-v="var">variables</button></span>
          <span class="lbl">View</span><span class="seg" data-o="view"><button data-v="cards">cards</button><button data-v="compact">compact</button></span>
          <span class="lbl" title="Merge colors closer than this (ΔE OKLab)">Merge</span><input type="range" min="0" max="12" step="0.5" value="0" data-o="merge"><span class="pr-merge-v mono">off</span>
          <span style="flex:1"></span>
          <input data-o="q" placeholder="Filter: #hex, name, file…" style="width:180px">
        </div>
        <div class="pr-pal scroll"></div>
        <div class="status"><span class="pr-count"></span><span style="flex:1"></span><span class="pr-prog"></span></div>
      </section>
      <aside class="pane pr-detail scroll"></aside>
    </div>`;

  //#region [ Scan ]
  const scan = () => {
    const files = st.files.filter(f => !st.off.has(f.name));
    const paste = $.querySelector('.pr-paste textarea').value;
    if(paste.trim()) files.push({ name: 'pasted.css', text: paste });
    const exts = st.ext.split(/[\s,]+/).map(s => s.replace(/^\./, '').toLowerCase()).filter(Boolean);
    const total = files.reduce((s, f) => s + f.text.length, 0);
    const done = r => { st.hits = r.hits; st.uses = r.uses; st.busy = false; $.querySelector('.pr-prog').textContent = ''; draw(); };
    if(total < 400000 || typeof Worker === 'undefined') return done(Colors.scan(files, { ext: [...exts, 'css'] }));
    // big: in a worker so the page stays responsive
    st.busy = true;
    $.querySelector('.pr-prog').textContent = `scanning ${files.length} files…`;
    worker?.terminate();
    worker = DAE_CORE.worker(DAE => { onmessage = e => postMessage(DAE.Colors.scan(e.data.files, { ext: e.data.ext })); });
    worker.onmessage = e => { done(e.data); worker.terminate(); worker = null; };
    worker.onerror = e => { st.api.toast('Scan failed: ' + e.message, true); worker = null; done(Colors.scan(files, { ext: [...exts, 'css'] })); };
    worker.postMessage({ files, ext: [...exts, 'css'] });
  };

  const accept = name => {
    const e = Colors.ext(name);
    const exts = st.ext.split(/[\s,]+/).map(s => s.replace(/^\./, '').toLowerCase());
    return exts.includes(e) && !/\.min\.(js|css)$/i.test(name);
  };

  const addFiles = async (list, { replace = false } = {}) => {
    if(replace) { st.files = []; st.off.clear(); }
    for(const f of list) {
      if(f.size > 3e6) continue;
      const text = f.text !== undefined && typeof f.text === 'string' ? f.text : await f.text();
      const name = f.path ?? f.webkitRelativePath ?? f.name;
      st.files = st.files.filter(x => x.name !== (name || f.name));
      st.files.push({ name: name || f.name, text, size: text.length });
    }
    drawFiles();
    scan();
  };

  const walkHandle = async (dir, prefix = '') => {
    const out = [];
    for await (const [name, h] of dir.entries()) {
      if(h.kind === 'directory') {
        if(Colors.SKIP.includes(name) || name.startsWith('.')) continue;
        out.push(...await walkHandle(h, `${prefix}${name}/`));
      }
      else if(accept(name)) {
        const f = await h.getFile();
        if(f.size <= 3e6) out.push({ path: prefix + name, text: await f.text(), size: f.size });
      }
      if(out.length > 5000) break;
    }
    return out;
  };

  const walkEntry = entry => new Promise(ok => {
    if(entry.isFile) {
      if(!accept(entry.name)) return ok([]);
      entry.file(f => (f.size > 3e6 ? ok([]) : f.text().then(text => ok([{ path: entry.fullPath.replace(/^\//, ''), text, size: f.size }]))), () => ok([]));
      return;
    }
    if(Colors.SKIP.includes(entry.name)) return ok([]);
    const reader = entry.createReader(), all = [];
    const read = () => reader.readEntries(async batch => {
      if(!batch.length) {
        const nested = await Promise.all(all.map(walkEntry));
        return ok(nested.flat());
      }
      all.push(...batch);
      read();
    }, () => ok([]));
    read();
  });

  const pickFolder = async () => {
    try {
      if(window.showDirectoryPicker) {
        const dir = await window.showDirectoryPicker();
        $.querySelector('.pr-prog').textContent = 'reading folder…';
        const files = await walkHandle(dir, dir.name + '/');
        addFiles(files, { replace: true });
        st.api.title(dir.name + '/');
        st.api.toast(`${files.length} files read from ${dir.name}`);
        return;
      }
    } catch(e) { if(e.name === 'AbortError') return; }
    const files = await FileIO.pick({ multiple: true });
    addFiles(files.filter(f => accept(f.name)));
  };

  const pickFolderInput = () => new Promise(ok => {
    const $in = Object.assign(document.createElement('input'), { type: 'file', webkitdirectory: true, multiple: true });
    $in.onchange = () => ok([...$in.files]);
    $in.click();
  });
  //#endregion

  //#region [ Draw ]
  const swatchesNow = () => {
    let list = Colors.merge(Colors.swatches(st.hits, st.uses), st.merge);
    if(st.q) {
      const q = st.q.toLowerCase();
      list = list.filter(s => [s, ...s.variants].some(x => x.hex.toLowerCase().includes(q) || (x.name ?? '').toLowerCase().includes(q) || x.hits.some(h => [h.file, h.sel, h.prop, h.key, h.var, h.el].some(v => v && String(v).toLowerCase().includes(q)))));
    }
    return Colors.sort(list, st.sort);
  };

  const ink = rgba => (Colors.contrast(rgba, [255, 255, 255]) > Colors.contrast(rgba, [26, 26, 26]) ? '#FFFFFF' : '#1A1A1A');

  const draw = () => {
    const list = swatchesNow();
    st.list = list;
    const $p = $.querySelector('.pr-pal');
    $.querySelector('.pr-count').textContent = st.hits.length ? `${list.length} colors · ${st.hits.length} uses · ${new Set(st.hits.map(h => h.file)).size} files` : '';
    if(!st.hits.length) {
      $p.innerHTML = `<div class="empty"><div class="big">${Kit.icon('ik-prism')}</div><div>Pick a folder, open files, drop them here, or paste text on the left.<br>Prisma lists every valid color and what it paints.</div><div style="display:flex;gap:6px"><button data-a="folder">${Kit.icon('folder-open')}Folder</button><button data-a="sample">Try a sample</button></div></div>`;
      drawDetail();
      return;
    }
    const groups = Colors.group(list, st.group);
    $p.classList.toggle('compact', st.view === 'compact');
    if(st.view === 'compact') {
      $p.innerHTML = groups.map(g => `${g.title ? `<div class="section pr-gt">${Kit.esc(g.title)} <span class="muted">${g.items.length}</span></div>` : ''}<div class="pr-strip">${g.items.map(s => {
        const i = list.indexOf(s);
        return `<div class="pr-cell sw${st.sel === s.hex ? ' sel' : ''}" data-i="${i}" title="${s.hex}${s.name ? ' · ' + Kit.esc(s.name) : ''} · ${s.total ?? s.count} uses"><i style="background:${s.hex}"></i></div>`;
      }).join('')}</div>`).join('');
      drawDetail();
      return;
    }
    $p.innerHTML = groups.map(g => `${g.title ? `<div class="section pr-gt">${Kit.esc(g.title)} <span class="muted">${g.items.length}</span></div>` : ''}<div class="pr-grid">${g.items.map(s => {
      const i = list.indexOf(s);
      return `<div class="pr-sw${st.sel === s.hex ? ' sel' : ''}" data-i="${i}" title="${s.hex}${s.name ? ' · ' + Kit.esc(s.name) : ''}">
        <div class="pr-chip sw"><i style="background:${s.hex}"></i><b style="color:${ink(s.rgba)}">${s.total ?? s.count}</b>${s.variants.length ? `<em style="color:${ink(s.rgba)}">+${s.variants.length}</em>` : ''}</div>
        <div class="pr-meta"><span class="mono">${s.hex}</span><span class="pr-nm">${Kit.esc(s.name || '')}</span></div></div>`;
    }).join('')}</div>`).join('');
    drawDetail();
  };

  const drawFiles = () => {
    const $f = $.querySelector('.pr-files');
    if(!st.files.length) { $f.innerHTML = `<div class="muted pr-none">No files yet.<br><button data-a="folder">${Kit.icon('folder-open')}Pick a folder</button></div>`; return; }
    const by = new Map();
    for(const h of st.hits) by.set(h.file, (by.get(h.file) ?? 0) + 1);
    $f.innerHTML = st.files.map(f => `<label class="pr-file${st.off.has(f.name) ? ' off' : ''}" title="${Kit.esc(f.name)}"><input type="checkbox" data-f="${Kit.esc(f.name)}"${st.off.has(f.name) ? '' : ' checked'}><span>${Kit.esc(f.name)}</span><em>${by.get(f.name) ?? 0}</em></label>`).join('');
  };

  const drawDetail = () => {
    const $d = $.querySelector('.pr-detail');
    const s = st.list?.find(x => x.hex === st.sel);
    $.querySelector('.pr').classList.toggle('has-detail', !!s);
    if(!s) { $d.innerHTML = ''; return; }
    const f = Colors.formats(s.rgba);
    const darkest = st.list.reduce((m, x) => (Colors.oklab(x.rgba)[0] < Colors.oklab(m.rgba)[0] ? x : m), st.list[0]);
    const con = [['white', [255, 255, 255]], ['black', [0, 0, 0]], [`darkest (${darkest.hex})`, darkest.rgba]].map(([n, c]) => {
      const r = Colors.contrast(s.rgba, c);
      return `<div class="pr-con"><span class="sw"><i style="background:rgb(${c.join(' ')})"></i></span><span>${n}</span><b>${r.toFixed(2)}</b><em class="${r >= 7 ? 'ok' : r >= 4.5 ? 'ok' : r >= 3 ? 'mid' : 'bad'}">${r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? 'AA large' : 'fail'}</em></div>`;
    }).join('');
    const all = [s, ...s.variants];
    const refs = all.flatMap(x => x.hits.map(h => ({ ...h, hex: x.hex })));
    const where = h => [h.var ? `<b>${Kit.esc(h.var)}</b>` : '', h.sel ? Kit.esc(h.sel) : '', h.el ? Kit.esc(h.el) : '', h.prop && !h.var ? `› ${Kit.esc(h.prop)}` : '', h.attr ? `› ${Kit.esc(h.attr)}` : '', h.key ? `<b>${Kit.esc(h.key)}</b>` : ''].filter(Boolean).join(' ');
    $d.innerHTML = `
      <div class="pr-big sw"><i style="background:${s.hex}"></i><span style="color:${ink(s.rgba)}">${Kit.esc(s.name || s.hex)}</span></div>
      <div class="pr-fmts">${Object.entries(f).map(([k, v]) => `<button class="ghost" data-copy="${Kit.esc(v)}" title="Copy"><span class="lbl">${k}</span><span class="mono">${Kit.esc(v)}</span>${Kit.icon('copy')}</button>`).join('')}</div>
      <div class="section">Contrast</div>${con}
      ${s.variants.length ? `<div class="section">Merged variants</div><div class="pr-vars">${s.variants.map(v => `<span class="chip"><span class="sw"><i style="background:${v.hex}"></i></span>${v.hex} · ${v.count}</span>`).join('')}</div>` : ''}
      ${s.uses?.length ? `<div class="section">Read through var()</div>${s.uses.map(u => `<div class="pr-ref"><div>${Kit.esc(u.sel)} › ${Kit.esc(u.prop)} <span class="muted">${Kit.esc(u.var)}</span></div><div class="muted mono">${Kit.esc(u.file)}:${u.line}</div></div>`).join('')}` : ''}
      <div class="section">Where (${refs.length})</div>
      ${refs.slice(0, 300).map(h => `<div class="pr-ref" title="${Kit.esc(h.preview)}"><div><span class="pr-cat">${h.cat}</span> ${where(h) || '<span class="muted">value</span>'}${h.hex !== s.hex ? ` <span class="chip">${h.hex}</span>` : ''}</div><div class="muted mono">${Kit.esc(h.file)}:${h.line}:${h.col}</div><code>${Kit.esc(h.preview)}</code></div>`).join('')}`;
  };
  //#endregion

  //#region [ Export ]
  const exportList = () => st.list ?? [];
  const png = () => {
    const list = exportList(), cols = 8, cw = 150, ch = 110, pad = 16;
    const rows = Math.ceil(list.length / cols);
    const cv = Object.assign(document.createElement('canvas'), { width: pad * 2 + cols * cw, height: pad * 2 + rows * ch });
    const g = cv.getContext('2d');
    g.fillStyle = '#1A1A1A';
    g.fillRect(0, 0, cv.width, cv.height);
    const names = Colors.names(list);
    list.forEach((s, i) => {
      const x = pad + (i % cols) * cw, y = pad + Math.floor(i / cols) * ch;
      g.fillStyle = s.hex;
      g.beginPath(); g.roundRect(x + 4, y + 4, cw - 8, 64, 6); g.fill();
      g.fillStyle = '#FFFFFF'; g.font = '600 12px Consolas, monospace';
      g.fillText(s.hex, x + 6, y + 86);
      g.fillStyle = '#A3A3A3'; g.font = '11px "Segoe UI", sans-serif';
      g.fillText(names[i].slice(0, 22), x + 6, y + 102);
    });
    cv.toBlob(b => Kit.download('palette.png', b));
  };
  /** Every color as a block in one tight rectangle (a palette texture for 3D models). */
  const compactPng = (cell, pot = false) => {
    const list = exportList(), n = list.length;
    let cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
    let w = cols * cell, h = rows * cell;
    if(pot) {
      const p2 = v => 2 ** Math.ceil(Math.log2(Math.max(1, v)));
      w = p2(w); h = p2(h);
      cols = Math.floor(w / cell); rows = Math.ceil(n / cols);
      h = p2(rows * cell);
    }
    const cv = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const g = cv.getContext('2d');
    list.forEach((s, i) => {
      g.fillStyle = s.hex;
      g.fillRect((i % cols) * cell, Math.floor(i / cols) * cell, cell, cell);
    });
    cv.toBlob(b => Kit.download(`palette-${n}x${cell}px${pot ? '-pot' : ''}.png`, b));
  };

  const exportMenu = (e, $btn) => {
    if(!st.list?.length) return st.api.toast('No colors yet', true);
    const r = $btn.getBoundingClientRect(), list = exportList();
    Menu.show(r.left, r.bottom + 4, [
      ['file-export', 'CSS variables', () => Kit.download('palette.css', Colors.css(list), 'text/css')],
      ['file-export', 'TOON', () => Kit.download('palette.toon', DAE.Toon.encode(Colors.data(list)))],
      ['file-export', 'JSON', () => Kit.download('palette.json', JSON.stringify(Colors.data(list), null, 2), 'application/json')],
      ['file-export', 'GIMP palette (.gpl)', () => Kit.download('palette.gpl', Colors.gpl(list))],
      ['image', 'PNG swatch sheet', png],
      'Compact PNG (3D palette texture)',
      ['border-all', '1 px per color', () => compactPng(1)],
      ['border-all', '8 px per color', () => compactPng(8)],
      ['border-all', '16 px per color, power-of-two size', () => compactPng(16, true)],
      '-',
      ['file-export', 'Markdown table', () => Kit.download('palette.md', Colors.markdown(list), 'text/markdown')],
      '-',
      ['copy', 'Copy CSS variables', () => Kit.copy(Colors.css(list), 'CSS copied')],
    ]);
  };
  //#endregion

  const mount = api => {
    st.api = api;
    $ = api.$el;
    $.innerHTML = html;
    Kit.split($.querySelector('.split'), $.querySelector('.pr-src'), w => $.querySelector('.pr').style.setProperty('--sw', w + 'px'), { min: 180, max: 600 });
    $.querySelector('[data-o=ext]').value = st.ext;
    api.actions([
      ['folder-open', 'Folder', pickFolder, { title: 'Read every text file in a folder (skips node_modules, .git, dist)' }],
      ['file-circle-plus', 'Files', async () => addFiles(await FileIO.pick({ multiple: true })), { title: 'Add files' }],
      ['file-export', 'Export', exportMenu, { primary: true }],
    ]);
    const segs = () => $.querySelectorAll('.pr-opts .seg').forEach($s => $s.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === st[$s.dataset.o])));
    segs();
    $.addEventListener('click', e => {
      const $seg = e.target.closest('.seg [data-v]');
      if($seg) { st[$seg.parentElement.dataset.o] = $seg.dataset.v; segs(); draw(); api.set('view', { sort: st.sort, group: st.group, merge: st.merge, view: st.view }); return; }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if(a === 'folder') pickFolder();
      if(a === 'sample') { $.querySelector('.pr-paste textarea').value = SAMPLE; scan(); }
      if(a === 'clear') { st.files = []; st.off.clear(); $.querySelector('.pr-paste textarea').value = ''; st.sel = null; drawFiles(); scan(); api.title(''); }
      const $sw = e.target.closest('.pr-sw, .pr-cell');
      if($sw) { const s = st.list[+$sw.dataset.i]; st.sel = st.sel === s.hex ? null : s.hex; draw(); }
      const $c = e.target.closest('[data-copy]');
      if($c) Kit.copy($c.dataset.copy, `Copied ${$c.dataset.copy}`);
    });
    $.querySelector('.pr-files').addEventListener('change', e => {
      const n = e.target.dataset.f;
      if(n === undefined) return;
      e.target.checked ? st.off.delete(n) : st.off.add(n);
      drawFiles(); scan();
    });
    $.querySelector('.pr-paste textarea').addEventListener('input', Kit.later(scan, 400));
    $.querySelector('[data-o=ext]').addEventListener('change', e => { st.ext = e.target.value; api.set('ext', st.ext); });
    $.querySelector('[data-o=merge]').addEventListener('input', e => {
      st.merge = +e.target.value;
      $.querySelector('.pr-merge-v').textContent = st.merge ? `ΔE ${st.merge}` : 'off';
      draw();
    });
    $.querySelector('[data-o=q]').addEventListener('input', Kit.later(e => { st.q = e.target.value.trim(); draw(); }, 150));
    api.get('view').then(v => { if(v) { Object.assign(st, v); segs(); $.querySelector('[data-o=merge]').value = st.merge; $.querySelector('.pr-merge-v').textContent = st.merge ? `ΔE ${st.merge}` : 'off'; DAE.UI.fill($.querySelector('[data-o=merge]')); draw(); } });
    api.get('ext').then(v => { if(v) { st.ext = v; $.querySelector('[data-o=ext]').value = v; } });
    drawFiles();
    draw();
  };

  Hub.register('prisma', {
    mount,
    pick: pickFolder,
    async open(file) { addFiles([{ name: file.name, text: file.text }]); },
    async drop(files) { addFiles(files.filter(f => accept(f.name) || !Colors.ext(f.name))); },
    async dropItems(entries) {
      const files = (await Promise.all(entries.filter(Boolean).map(walkEntry))).flat();
      addFiles(files, { replace: true });
      st.api.toast(`${files.length} files read`);
    },
    pickFolderInput,
  });
})();
