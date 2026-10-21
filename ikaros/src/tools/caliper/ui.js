// Caliper page: two texts (A, B: TOON or JSON, mixed is fine) and their difference as a tree,
// with the change list, jump to next / previous change, options, and exports.
(() => {
  const { Tree, Diff, FileIO, Menu } = DAE;
  const SAMPLE_A = `app: athena
version: 1
name: Tutorial
rooms[3]:
  - id: r0
    name: Entrance
  - id: r1
    name: Armory
    items[1]{id,kind}:
      i0,key
  - id: r2
    name: Vault
    locked: true
tags[2]: start,easy
`;
  const SAMPLE_B = `{
  "app": "athena",
  "version": 2,
  "name": "Tutorial",
  "rooms": [
    { "id": "r1", "name": "Armory", "items": [{ "id": "i0", "kind": "key" }, { "id": "i1", "kind": "gem" }] },
    { "id": "r0", "name": "Entrance hall" },
    { "id": "r3", "name": "Garden" }
  ],
  "tags": ["easy", "start"],
  "author": "Daedalus"
}
`;
  const ICON = { added: '+', removed: '−', changed: '~', moved: '↕', inner: '•', same: '' };

  const st = {
    api: null, sides: { a: { name: 'A', text: '', r: null }, b: { name: 'B', text: '', r: null } },
    opts: { key: 'auto', ignore: [], tol: 0, nocase: false, order: false },
    root: null, open: new Set(), only: false, changes: [], at: -1, sel: null,
  };
  let $, ed = {};

  const html = `
    <div class="cl">
      <div class="cl-texts">
        ${['a', 'b'].map(s => `<div class="pane cl-side" data-side="${s}">
          <div class="bar"><b class="cl-tag cl-${s}">${s.toUpperCase()}</b><span class="lbl cl-name">${s === 'a' ? 'before' : 'after'}</span><span style="flex:1"></span>
            <button class="ghost" data-a="open-${s}" title="Open a file into ${s.toUpperCase()}">${Kit.icon('folder-open')}Open</button>
            <button class="ghost" data-a="paste-${s}" title="Paste into ${s.toUpperCase()}">${Kit.icon('paste')}</button></div>
          <div class="cl-code"></div>
          <div class="cl-err"></div>
        </div>`).join('')}
      </div>
      <div class="cl-hsplit"></div>
      <div class="cl-res">
        <div class="bar cl-opts">
          <span class="cl-sum"></span>
          <button class="ghost ic-only" data-a="prev" title="Previous change ([)">${Kit.icon('chevron-down', 'up')}</button>
          <button class="ghost ic-only" data-a="next" title="Next change (])">${Kit.icon('chevron-down')}</button>
          <label class="cl-chk"><input type="checkbox" data-o="only"> changes only</label>
          <span style="flex:1"></span>
          <span class="lbl">Arrays by</span>
          <select data-o="key" title="How array items are paired"><option value="auto">key (auto: id / name / key)</option><option value="index">index</option><option value="custom">key field…</option></select>
          <input data-o="field" placeholder="field" style="width:80px;display:none">
          <span class="lbl">Ignore</span><input data-o="ignore" placeholder="keys, comma separated" style="width:150px">
          <span class="lbl">±</span><input data-o="tol" type="number" min="0" step="any" value="0" style="width:64px" title="Number tolerance">
          <label class="cl-chk" title="Compare strings ignoring case"><input type="checkbox" data-o="nocase"> Aa</label>
          <label class="cl-chk" title="Arrays of plain values: ignore order"><input type="checkbox" data-o="order"> any order</label>
        </div>
        <div class="cl-body">
          <div class="cl-tree scroll"></div>
          <div class="cl-list scroll"></div>
        </div>
      </div>
    </div>`;

  //#region [ Compare ]
  const parseSide = s => {
    const side = st.sides[s];
    side.text = ed[s].value;
    const $err = $.querySelector(`[data-side="${s}"] .cl-err`);
    if(!side.text.trim()) { side.r = null; ed[s].error(0); $err.className = 'cl-err'; $err.textContent = 'empty'; return; }
    const fmt = Tree.detect(side.text);
    ed[s].setLang(fmt);
    const r = Tree.parse(side.text, fmt);
    side.r = r;
    if(r.error) { ed[s].error(r.error.line); $err.className = 'cl-err bad'; $err.textContent = `${fmt.toUpperCase()} · line ${r.error.line}: ${r.error.reason}`; }
    else { ed[s].error(0); $err.className = 'cl-err ok'; $err.textContent = `● ${fmt.toUpperCase()}`; }
  };

  const compare = () => {
    const A = st.sides.a.r, B = st.sides.b.r;
    if(!A || !B || A.error || B.error) {
      st.root = null; st.changes = [];
      ed.a.mark([]); ed.b.mark([]);
      drawTree(); drawList(); summary();
      return;
    }
    const prevOpen = st.root ? st.open : null;
    st.root = Diff.compare(A.value, B.value, st.opts);
    st.changes = Diff.changes(st.root);
    // open every branch that holds a change (keep what the user opened)
    st.open = new Set(prevOpen ?? []);
    const walk = n => { if(n.status !== 'same' && n.children.length) { st.open.add(n.path); n.children.forEach(walk); } };
    walk(st.root);
    st.open.add('');
    st.at = -1;
    drawTree(); drawList(); summary();
    markTexts();
  };

  const summary = () => {
    const c = st.root ? Diff.count(st.root) : null;
    $.querySelector('.cl-sum').innerHTML = !st.root ? '<span class="muted">Fill A and B to compare</span>'
      : !st.changes.length ? '<span class="cl-same">● same data</span>'
      : `<span class="cl-s-added">+${c.added}</span><span class="cl-s-removed">−${c.removed}</span><span class="cl-s-changed">~${c.changed}</span><span class="cl-s-moved">↕${c.moved}</span>`;
  };

  /** Marks every changed line in both texts. */
  const markTexts = () => {
    const ma = [], mb = [];
    const ra = st.sides.a.r?.ranges, rb = st.sides.b.r?.ranges;
    for(const ch of st.changes) {
      const cls = { added: 'add', removed: 'del', changed: 'mod', moved: 'mod' }[ch.kind];
      const node = findNode(ch.path, ch.kind === 'removed');
      const pa = node?.apath, pb = ch.kind === 'removed' ? null : ch.path;
      if(pa !== undefined && ra?.get(pa) && ch.kind !== 'added') { const [f, t] = ra.get(pa); ma.push({ from: f, to: ch.kind === 'moved' ? f : t, cls }); }
      if(pb !== null && rb?.get(pb)) { const [f, t] = rb.get(pb); mb.push({ from: f, to: ch.kind === 'moved' ? f : t, cls }); }
    }
    ed.a.mark(ma);
    ed.b.mark(mb);
  };

  const findNode = (path, removed = false) => {
    let hit = null;
    const walk = n => {
      if(hit) return;
      if(n.path === path && (!removed || n.status === 'removed')) { hit = n; return; }
      n.children.forEach(walk);
    };
    if(st.root) walk(st.root);
    return hit;
  };
  //#endregion

  //#region [ Tree ]
  const short = v => {
    if(v === undefined) return '';
    if(Array.isArray(v)) return `[${v.length}]`;
    if(v && typeof v === 'object') return `{${Object.keys(v).length}}`;
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.length > 60 ? s.slice(0, 59) + '…' : s;
  };
  const vcls = v => `k-${Tree.type(v) === 'array' || Tree.type(v) === 'object' ? 'punct' : Tree.type(v)}`;

  const drawTree = () => {
    const $t = $.querySelector('.cl-tree');
    if(!st.root) {
      $t.innerHTML = `<div class="empty"><div class="big">${Kit.icon('ik-caliper')}</div><div>Put the old version in A and the new one in B.<br>TOON and JSON can be mixed: Caliper compares the data.</div><button data-a="sample">Try a sample</button></div>`;
      return;
    }
    const rows = [];
    const walk = (n, depth) => {
      if(st.only && n.status === 'same' && depth > 0) return;
      const has = n.children.length > 0, open = st.open.has(n.path + '|' + (n.status === 'removed' ? 'r' : '')) || st.open.has(n.path);
      const key = depth === 0 ? 'root' : typeof n.key === 'number' ? `[${n.key}]` : n.key;
      let val = '';
      if(n.status === 'changed') val = `<span class="${vcls(n.a)} cl-old">${Kit.esc(short(n.a))}</span><span class="cl-arrow">→</span><span class="${vcls(n.b)}">${Kit.esc(short(n.b))}</span>`;
      else if(n.status === 'added') val = `<span class="${vcls(n.b)}">${Kit.esc(short(n.b))}</span>`;
      else if(n.status === 'removed') val = `<span class="${vcls(n.a)} cl-old">${Kit.esc(short(n.a))}</span>`;
      else val = `<span class="${vcls(n.b ?? n.a)}">${Kit.esc(short(n.b ?? n.a))}</span>`;
      const st2 = n.moved ? (n.status === 'inner' ? 'moved inner' : 'moved') : n.status;
      const sel = st.sel === n;
      rows.push(`<div class="cl-row s-${st2.split(' ')[0]}${sel ? ' sel' : ''}" data-path="${Kit.esc(n.path)}" data-rm="${n.status === 'removed' ? 1 : 0}" style="--d:${depth}">
        <span class="cl-fold">${has ? (open ? '▾' : '▸') : ''}</span>
        <span class="cl-badge">${n.moved ? '↕' : ICON[n.status]}</span>
        <span class="cl-key">${Kit.esc(key)}</span>${n.match ? `<span class="chip">${Kit.esc(n.match)}</span>` : ''}${n.moved ? `<span class="chip">from [${n.from}]</span>` : ''}
        <span class="cl-val">${val}</span></div>`);
      if(has && open) n.children.forEach(c => walk(c, depth + 1));
    };
    walk(st.root, 0);
    $t.innerHTML = rows.slice(0, 5000).join('') + (rows.length > 5000 ? `<div class="muted" style="padding:8px">+${rows.length - 5000} rows (use "changes only")</div>` : '');
  };

  const drawList = () => {
    const $l = $.querySelector('.cl-list');
    if(!st.changes.length) { $l.innerHTML = st.root ? '<div class="muted" style="padding:12px">No changes.</div>' : ''; return; }
    $l.innerHTML = `<div class="lbl" style="padding:8px 10px 4px">${st.changes.length} changes</div>` + st.changes.map((c, i) => `<div class="cl-item s-${c.kind}${i === st.at ? ' sel' : ''}" data-i="${i}"><span class="cl-badge">${ICON[c.kind]}</span><span class="mono">${Kit.esc(c.path)}</span></div>`).join('');
  };

  const selectNode = (n, scroll = true) => {
    st.sel = n;
    // open the parents
    const parts = [];
    const walk = (x, trail) => { if(x === n) { parts.push(...trail); return true; } return x.children.some(c => walk(c, [...trail, x.path])); };
    walk(st.root, []);
    parts.forEach(p => st.open.add(p));
    drawTree();
    const $r = $.querySelector('.cl-row.sel');
    if(scroll) $r?.scrollIntoView({ block: 'nearest' });
    const ra = st.sides.a.r?.ranges?.get(n.apath ?? ''), rb = n.status === 'removed' ? null : st.sides.b.r?.ranges?.get(n.path);
    if(ra && n.status !== 'added') { ed.a.reveal(ra[0]); ed.a.select(ra[0], ra[1]); }
    if(rb) { ed.b.reveal(rb[0]); ed.b.select(rb[0], rb[1]); }
  };

  const step = d => {
    if(!st.changes.length) return;
    st.at = (st.at + d + st.changes.length) % st.changes.length;
    const c = st.changes[st.at];
    const n = findNode(c.path, c.kind === 'removed');
    drawList();
    $.querySelector('.cl-item.sel')?.scrollIntoView({ block: 'nearest' });
    if(n) selectNode(n);
  };
  //#endregion

  //#region [ Files ]
  const load = (s, text, name) => {
    ed[s].value = text;
    st.sides[s].name = name;
    $.querySelector(`[data-side="${s}"] .cl-name`).textContent = name;
    parseSide(s);
    compare();
    save();
  };
  const save = () => st.api.later('texts', () => ({ a: { name: st.sides.a.name, text: ed.a.value }, b: { name: st.sides.b.name, text: ed.b.value } }), 600);
  const openSide = async s => {
    const f = await FileIO.open({ types: [{ description: 'TOON / JSON', accept: { 'text/plain': ['.toon', '.json'] } }], accept: '.toon,.json,.txt' });
    if(f) { load(s, f.text, f.name); st.api.recent(f.name, f.text); }
  };
  const exportMenu = (e, $btn) => {
    const r = $btn.getBoundingClientRect();
    if(!st.root) return st.api.toast('Nothing to export yet', true);
    Menu.show(r.left, r.bottom + 4, [
      ['file-export', 'Change list (Markdown)', () => Kit.download('changes.md', Diff.markdown(st.changes), 'text/markdown')],
      ['file-export', 'Change list (TOON)', () => Kit.download('changes.toon', DAE.Toon.encode({ app: 'caliper', a: st.sides.a.name, b: st.sides.b.name, changes: st.changes.map(c => ({ path: c.path, kind: c.kind, ...(c.from !== undefined ? { from: c.from } : {}), ...(c.old !== undefined ? { old: JSON.stringify(c.old) } : {}), ...(c.new !== undefined ? { new: JSON.stringify(c.new) } : {}) })) }))],
      ['file-export', 'JSON Patch A → B (RFC 6902)', () => Kit.download('patch.json', JSON.stringify(Diff.patch(st.sides.a.r.value, st.sides.b.r.value), null, 2), 'application/json')],
      '-',
      ['copy', 'Copy change list', () => Kit.copy(Diff.markdown(st.changes), 'Change list copied')],
    ]);
  };
  //#endregion

  const mount = api => {
    st.api = api;
    $ = api.$el;
    $.innerHTML = html;
    for(const s of ['a', 'b']) {
      ed[s] = new Kit.Code($.querySelector(`[data-side="${s}"] .cl-code`), { lang: 'toon', onInput: Kit.later(() => { parseSide(s); compare(); save(); }, 350) });
    }
    Kit.split($.querySelector('.cl-hsplit'), $.querySelector('.cl-texts'), h => $.querySelector('.cl').style.setProperty('--th', h + 'px'), { axis: 'y', min: 90, max: 900 });
    api.actions([
      ['right-left', 'Swap', () => { const a = ed.a.value, an = st.sides.a.name; load('a', ed.b.value, st.sides.b.name); load('b', a, an); }, { title: 'Swap A and B' }],
      ['file-export', 'Export', exportMenu, { primary: true }],
    ]);
    $.addEventListener('click', e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if(a === 'sample') { load('a', SAMPLE_A, 'tutorial-v1.toon'); load('b', SAMPLE_B, 'tutorial-v2.json'); }
      if(a === 'open-a' || a === 'open-b') openSide(a.slice(-1));
      if(a === 'paste-a' || a === 'paste-b') navigator.clipboard.readText().then(t => load(a.slice(-1), t, 'pasted')).catch(() => api.toast('Paste with Ctrl+V in the text', true));
      if(a === 'next') step(1);
      if(a === 'prev') step(-1);
      const $row = e.target.closest('.cl-row');
      if($row) {
        const n = findNode($row.dataset.path, $row.dataset.rm === '1');
        if(!n) return;
        if(e.target.closest('.cl-fold') && n.children.length) {
          st.open.has(n.path) ? st.open.delete(n.path) : st.open.add(n.path);
          drawTree();
          return;
        }
        selectNode(n, false);
      }
      const $it = e.target.closest('.cl-item');
      if($it) { st.at = +$it.dataset.i - 1; step(1); }
    });
    $.querySelector('.cl-tree').addEventListener('dblclick', e => {
      const $row = e.target.closest('.cl-row');
      const n = $row && findNode($row.dataset.path, $row.dataset.rm === '1');
      if(n?.children.length) { st.open.has(n.path) ? st.open.delete(n.path) : st.open.add(n.path); drawTree(); }
    });
    const $o = $.querySelector('.cl-opts');
    const readOpts = () => {
      const k = $o.querySelector('[data-o=key]').value, $f = $o.querySelector('[data-o=field]');
      $f.style.display = k === 'custom' ? '' : 'none';
      st.opts = {
        key: k === 'custom' ? ($f.value.trim() || 'id') : k,
        ignore: $o.querySelector('[data-o=ignore]').value.split(',').map(s => s.trim()).filter(Boolean),
        tol: Math.max(0, +$o.querySelector('[data-o=tol]').value || 0),
        nocase: $o.querySelector('[data-o=nocase]').checked,
        order: $o.querySelector('[data-o=order]').checked,
      };
      st.only = $o.querySelector('[data-o=only]').checked;
      api.set('opts', { ...st.opts, only: st.only, sel: k });
      compare();
    };
    $o.addEventListener('input', Kit.later(readOpts, 200));
    $o.addEventListener('change', readOpts);
    api.get('opts').then(o => {
      if(!o) return;
      $o.querySelector('[data-o=key]').value = o.sel ?? 'auto';
      if(o.sel === 'custom') { $o.querySelector('[data-o=field]').value = o.key; }
      $o.querySelector('[data-o=ignore]').value = (o.ignore ?? []).join(', ');
      $o.querySelector('[data-o=tol]').value = o.tol ?? 0;
      $o.querySelector('[data-o=nocase]').checked = !!o.nocase;
      $o.querySelector('[data-o=order]').checked = !!o.order;
      $o.querySelector('[data-o=only]').checked = !!o.only;
      readOpts();
    });
    api.get('texts').then(t => {
      if(!t) { compare(); return; }
      for(const s of ['a', 'b']) {
        ed[s].value = t[s].text;
        st.sides[s].name = t[s].name;
        $.querySelector(`[data-side="${s}"] .cl-name`).textContent = t[s].name;
        parseSide(s);
      }
      compare();
    });
    compare();
  };

  Hub.register('caliper', {
    mount,
    pick: () => openSide(!ed.a.value.trim() ? 'a' : 'b'),
    async open(file) { load(!ed.a.value.trim() ? 'a' : 'b', file.text, file.name); },
    async drop(files) {
      const list = files.slice(0, 2);
      const texts = await Promise.all(list.map(f => f.text()));
      if(list.length === 2) { load('a', texts[0], list[0].name); load('b', texts[1], list[1].name); }
      else load(!ed.a.value.trim() ? 'a' : 'b', texts[0], list[0].name);
    },
    keys(e) {
      if(/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
      if(e.key === ']') step(1);
      if(e.key === '[') step(-1);
    },
  });
})();
