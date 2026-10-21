// Easel page: a spritesheet (one blob URL; frame thumbnails are CSS background offsets of it, as in
// JSEngine's sprite palette) sliced by grid or islands, animations with a preview, the autotile
// generator (ported from panda) and a test map painted with the frames or the autotile terrain.
(() => {
  const { Sprites, View, FileIO, Menu, Zip, Gif, Toon } = DAE;

  const st = {
    api: null, tab: 'slice',
    sheet: null,                 // { name, url, img, w, h, data (ImageData, lazy), blob }
    frames: [], sel: new Set(), last: -1,
    anims: [], cur: -1,
    slice: { mode: 'grid', by: 'size', cw: 16, ch: 16, cols: 4, rows: 4, margin: 0, spacing: 0, skip: true, gap: 2, min: 4 },
    view: View.make(0, 0, 2),
    play: { on: true, t0: 0, scale: 4, bg: 'checker', onion: false, step: -1 },
    auto: { grid: 16, border: 2, corner: 1, src: null, out: null },   // src: {name, url, img, w, h}; out: canvas
    map: null, paint: { layer: 1, tool: 'brush', tile: 0, view: View.make(-20, -20, 2) },
  };
  let $;

  //#region [ Markup ]
  const html = `
    <div class="ea" data-tab="slice">
      <aside class="pane ea-side scroll">
        <div class="ea-p" data-for="slice">
          <div class="section">Slice</div>
          <div class="seg ea-wide" data-k="mode"><button data-v="grid">${Kit.icon('border-all')}Grid</button><button data-v="islands">${Kit.icon('wand-magic-sparkles')}Islands</button></div>
          <div class="ea-grid-o">
            <div class="seg ea-wide" data-k="by"><button data-v="size">cell size</button><button data-v="count">rows × cols</button></div>
            <div class="ea-row ea-by-size"><label class="field"><span>Width</span><input type="number" min="1" data-n="cw"></label><label class="field"><span>Height</span><input type="number" min="1" data-n="ch"></label></div>
            <div class="ea-row ea-by-count"><label class="field"><span>Columns</span><input type="number" min="1" data-n="cols"></label><label class="field"><span>Rows</span><input type="number" min="1" data-n="rows"></label></div>
            <div class="ea-row"><label class="field"><span>Margin</span><input type="number" min="0" data-n="margin"></label><label class="field"><span>Spacing</span><input type="number" min="0" data-n="spacing"></label></div>
            <label class="ea-chk"><input type="checkbox" data-c="skip"> skip empty cells</label>
          </div>
          <div class="ea-isl-o">
            <div class="ea-row"><label class="field"><span>Merge gap (px)</span><input type="number" min="0" data-n="gap"></label><label class="field"><span>Min pixels</span><input type="number" min="1" data-n="min"></label></div>
            <p class="muted ea-note">Boxes around connected opaque pixels; parts closer than the gap stay in one frame.</p>
          </div>
          <button class="primary ea-wide" data-a="slice">${Kit.icon('border-all')}Slice</button>
          <p class="muted ea-note">Click a frame to select, Shift for a range, Ctrl to add. Drag a frame to move it, its corner to resize. <kbd>Del</kbd> removes, <kbd>N</kbd> + drag draws a new one.</p>
          <div class="section">Frames <span class="muted ea-fcount"></span></div>
          <div class="ea-thumbs"></div>
        </div>
        <div class="ea-p" data-for="animate">
          <div class="section">Animations</div>
          <div class="ea-anims"></div>
          <button class="ea-wide" data-a="anim-new">${Kit.icon('plus')}New from selected frames</button>
          <div class="ea-anim-o"></div>
          <p class="muted ea-note">Click frames on the sheet to add them to the current animation. Click the preview to set the pivot.</p>
        </div>
        <div class="ea-p" data-for="autotile">
          <div class="section">Autotile</div>
          <p class="muted ea-note">Source: two tiles side by side (border, floor), each one grid wide. Makes the full 48-tile set (12 × 4) for every neighbor mix.</p>
          <button class="ea-wide" data-a="auto-open">${Kit.icon('folder-open')}Open a source</button>
          <button class="ea-wide" data-a="auto-sheet">Use the current sheet</button>
          <div class="ea-row"><label class="field"><span>Grid</span><input type="number" min="2" data-u="grid"></label></div>
          <label class="field"><span>Border <b class="ea-v" data-uv="border"></b></span><input type="range" min="0" max="8" step="1" data-u="border"></label>
          <label class="field"><span>Corner <b class="ea-v" data-uv="corner"></b></span><input type="range" min="0" max="8" step="1" data-u="corner"></label>
          <button class="primary ea-wide" data-a="auto-use">${Kit.icon('check')}Use as sheet (map terrain)</button>
          <button class="ea-wide" data-a="auto-png">${Kit.icon('download')}Download PNG</button>
          <button class="ea-wide" data-a="auto-masks">${Kit.icon('download')}Download mask table</button>
        </div>
        <div class="ea-p" data-for="map">
          <div class="section">Test map</div>
          <div class="ea-row"><label class="field"><span>Width</span><input type="number" min="1" max="256" data-m="w"></label><label class="field"><span>Height</span><input type="number" min="1" max="256" data-m="h"></label></div>
          <div class="section">Layer</div>
          <div class="ea-layers"></div>
          <div class="section">Tool</div>
          <div class="seg ea-wide" data-k="tool"><button data-v="brush" title="Brush (B)">${Kit.icon('pen')}</button><button data-v="rect" title="Rectangle (R)">${Kit.icon('square')}</button><button data-v="fill" title="Fill (F)">${Kit.icon('wand-magic-sparkles')}</button><button data-v="erase" title="Erase (E)">${Kit.icon('eraser')}</button></div>
          <div class="section ea-pal-t">Tiles</div>
          <div class="ea-thumbs ea-pal"></div>
          <p class="muted ea-note">Right click erases. The terrain layer picks autotiles by their neighbors (needs a 48-tile autotile sheet: make one in Autotile).</p>
        </div>
      </aside>
      <div class="split"></div>
      <section class="ea-main">
        <canvas class="ea-cv"></canvas>
        <div class="ea-empty empty"><div class="big">${Kit.icon('ik-easel')}</div><div>Open or drop a spritesheet (PNG, GIF, WebP).</div><div style="display:flex;gap:6px"><button data-a="open">${Kit.icon('folder-open')}Open image</button><button data-a="sample">Try a sample</button></div></div>
        <div class="ea-auto"></div>
        <div class="ea-zoom"><button class="ghost" data-a="z-out">−</button><button class="ghost ea-z" data-a="z-fit">fit</button><button class="ghost" data-a="z-in">+</button></div>
      </section>
      <aside class="pane ea-prev">
        <div class="bar"><span class="lbl ea-prev-t">Preview</span><span style="flex:1"></span>
          <button class="ghost ic-only" data-a="p-step-b" title="Step back">${Kit.icon('backward-step')}</button>
          <button class="ghost ic-only" data-a="p-play" title="Play / pause (Space)">${Kit.icon('pause')}</button>
          <button class="ghost ic-only" data-a="p-step-f" title="Step">${Kit.icon('forward-step')}</button></div>
        <div class="ea-stage"><canvas class="ea-pcv"></canvas></div>
        <div class="bar ea-pbar">
          <span class="seg" data-k="scale">${[1, 2, 4, 8].map(s => `<button data-v="${s}">${s}×</button>`).join('')}</span>
          <span class="seg" data-k="bg"><button data-v="checker" title="Checker">▦</button><button data-v="dark" title="Dark">■</button><button data-v="light" title="Light">□</button></span>
          <label class="ea-chk" title="Show the previous frame faintly"><input type="checkbox" data-a="p-onion"> onion</label>
        </div>
        <div class="ea-timeline"></div>
      </aside>
      <div class="status ea-status"><span class="ea-s1"></span><span style="flex:1"></span><span class="ea-s2"></span></div>
    </div>`;
  //#endregion

  //#region [ Sheet ]
  const loadImage = url => new Promise((ok, fail) => { const img = new Image(); img.onload = () => ok(img); img.onerror = () => fail(new Error('not an image')); img.src = url; });

  const setSheet = async (blob, name, { keep = false } = {}) => {
    const url = URL.createObjectURL(blob);
    let img;
    try { img = await loadImage(url); } catch(e) { st.api.toast(e.message, true); return; }
    if(st.sheet?.url) URL.revokeObjectURL(st.sheet.url);
    st.sheet = { name, url, img, w: img.naturalWidth, h: img.naturalHeight, data: null, blob };
    if(!keep) { st.frames = []; st.anims = []; st.cur = -1; st.sel.clear(); }
    st.api.title(name);
    fitView();
    drawAll();
    persist();
  };

  /** Pixels of the sheet, read once. */
  const pixels = () => {
    if(st.sheet.data) return st.sheet.data;
    const cv = Object.assign(document.createElement('canvas'), { width: st.sheet.w, height: st.sheet.h });
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(st.sheet.img, 0, 0);
    return st.sheet.data = g.getImageData(0, 0, st.sheet.w, st.sheet.h);
  };

  const doSlice = () => {
    if(!st.sheet) return;
    const o = st.slice, W = st.sheet.w, H = st.sheet.h;
    st.frames = o.mode === 'islands'
      ? Sprites.islands(pixels().data, W, H, { gap: o.gap, minArea: o.min })
      : Sprites.grid(W, H, { ...(o.by === 'count' ? { count: { cols: o.cols, rows: o.rows } } : { cell: { w: o.cw, h: o.ch } }), margin: o.margin, spacing: o.spacing, rgba: o.skip ? pixels().data : null, skipEmpty: o.skip });
    st.sel.clear();
    st.anims.forEach(a => { a.frames = a.frames.filter(i => i < st.frames.length); });
    st.api.toast(`${st.frames.length} frames`);
    drawAll();
    persist();
  };

  /** A frame thumbnail: the sheet's blob URL as a background, scaled so the frame fits `box` px. */
  const thumb = (f, i, box = 48, extra = '') => {
    const k = Math.min(box / f.w, box / f.h, 8);
    return `<div class="ea-th${extra}" data-f="${i}" title="#${i} · ${f.w}×${f.h}${f.name ? ' · ' + Kit.esc(f.name) : ''}"><div style="width:${f.w * k}px;height:${f.h * k}px;background-image:url(${st.sheet.url});background-size:${st.sheet.w * k}px ${st.sheet.h * k}px;background-position:${-f.x * k}px ${-f.y * k}px"></div><em>${i}</em></div>`;
  };
  //#endregion

  //#region [ Sheet view (canvas) ]
  const $cv = () => $.querySelector('.ea-cv');
  const crect = () => $cv().getBoundingClientRect();
  const fitView = () => {
    if(st.tab === 'map' && st.map) { View.fit(st.paint.view, crect(), { x: 0, y: 0, w: st.map.w * st.map.cell, h: st.map.h * st.map.cell }, { pad: 30, max: 8 }); return; }
    if(!st.sheet) return;
    View.fit(st.view, crect(), { x: 0, y: 0, w: st.sheet.w, h: st.sheet.h }, { pad: 30, max: 12, min: 0.1 });
  };

  const drawSheet = () => {
    const cv = $cv(), r = crect();
    const dpr = devicePixelRatio || 1;
    if(cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, r.width, r.height);
    if(st.tab === 'map') return drawMap(g, r);
    if(!st.sheet) return;
    const v = st.view;
    g.imageSmoothingEnabled = false;
    // checker under the sheet
    const sx = -v.x * v.zoom, sy = -v.y * v.zoom, sw = st.sheet.w * v.zoom, sh = st.sheet.h * v.zoom;
    g.fillStyle = '#2A2A2A';
    g.fillRect(sx, sy, sw, sh);
    g.fillStyle = '#333';
    const ck = Math.max(4, 8 * Math.max(1, Math.round(v.zoom / 2)));
    for(let y = 0; y < sh; y += ck) for(let x = (Math.floor(y / ck) % 2) * ck; x < sw; x += ck * 2) g.fillRect(sx + x, sy + y, Math.min(ck, sw - x), Math.min(ck, sh - y));
    g.drawImage(st.sheet.img, sx, sy, sw, sh);
    const anim = st.anims[st.cur];
    const inAnim = new Set(st.tab === 'animate' && anim ? anim.frames : []);
    g.font = '600 10px Consolas, monospace';
    st.frames.forEach((f, i) => {
      const x = sx + f.x * v.zoom, y = sy + f.y * v.zoom, w = f.w * v.zoom, h = f.h * v.zoom;
      const sel = st.sel.has(i), cur = st.play.step >= 0 && st.tab === 'animate' && Sprites.sequence(anim ?? { frames: [] })[st.play.step] === i;
      g.strokeStyle = cur ? '#F1FA8C' : sel ? '#CD7F32' : inAnim.has(i) ? '#BD93F9' : 'rgba(139,233,253,.55)';
      g.lineWidth = sel || cur ? 2 : 1;
      g.strokeRect(x + .5, y + .5, w - 1, h - 1);
      if(sel) { g.fillStyle = 'rgba(205,127,50,.12)'; g.fillRect(x, y, w, h); }
      if(w > 18 && h > 12) {
        g.fillStyle = sel ? '#CD7F32' : 'rgba(26,26,26,.75)';
        const t = String(i), tw = g.measureText(t).width + 6;
        g.fillRect(x + 1, y + 1, tw, 13);
        g.fillStyle = sel ? '#1A1A1A' : '#A3A3A3';
        g.fillText(t, x + 4, y + 11);
      }
      if(sel && st.sel.size === 1 && st.tab === 'slice') { g.fillStyle = '#CD7F32'; g.fillRect(x + w - 5, y + h - 5, 8, 8); }
    });
    if(drawNew) {
      g.strokeStyle = '#50FA7B';
      g.setLineDash([4, 3]);
      const a = drawNew;
      g.strokeRect(sx + Math.min(a.x0, a.x1) * v.zoom, sy + Math.min(a.y0, a.y1) * v.zoom, Math.abs(a.x1 - a.x0) * v.zoom, Math.abs(a.y1 - a.y0) * v.zoom);
      g.setLineDash([]);
    }
    $.querySelector('.ea-z').textContent = Math.round(v.zoom * 100) + '%';
  };

  let drawNew = null, drag = null, newMode = false;
  const at = e => { const p = View.toWorld(st.view, crect(), e.clientX, e.clientY); return { x: Math.floor(p.x), y: Math.floor(p.y), fx: p.x, fy: p.y }; };
  const frameAt = (x, y) => { for(let i = st.frames.length - 1; i >= 0; i--) { const f = st.frames[i]; if(x >= f.x && y >= f.y && x < f.x + f.w && y < f.y + f.h) return i; } return -1; };

  const sheetDown = e => {
    if(!st.sheet || st.tab === 'map' || st.tab === 'autotile') return;
    const p = at(e);
    if(e.button === 1 || e.button === 0 && (spaceDown || e.altKey)) { drag = { pan: true, x: e.clientX, y: e.clientY }; return; }
    if(e.button !== 0) return;
    if(newMode && st.tab === 'slice') { drawNew = { x0: p.x, y0: p.y, x1: p.x + 1, y1: p.y + 1 }; drag = { draw: true }; return; }
    const i = frameAt(p.fx, p.fy);
    if(st.tab === 'animate') {
      if(i >= 0) {
        if(st.cur < 0) newAnim([i]); else { st.anims[st.cur].frames.push(i); drawPanels(); persist(); }
        drawSheet();
      }
      else drag = { pan: true, x: e.clientX, y: e.clientY };
      return;
    }
    if(i < 0) { if(!e.ctrlKey && !e.shiftKey) st.sel.clear(); drag = { pan: true, x: e.clientX, y: e.clientY }; drawAll(); return; }
    const f = st.frames[i];
    const corner = st.sel.has(i) && st.sel.size === 1 && p.fx > f.x + f.w - 6 / st.view.zoom && p.fy > f.y + f.h - 6 / st.view.zoom;
    if(e.shiftKey && st.last >= 0) { const [a, b] = [Math.min(st.last, i), Math.max(st.last, i)]; for(let k = a; k <= b; k++) st.sel.add(k); }
    else if(e.ctrlKey || e.metaKey) st.sel.has(i) ? st.sel.delete(i) : st.sel.add(i);
    else if(!st.sel.has(i)) { st.sel.clear(); st.sel.add(i); }
    st.last = i;
    drag = { frame: i, sx: p.fx, sy: p.fy, ox: f.x, oy: f.y, ow: f.w, oh: f.h, resize: corner, moved: false };
    drawAll();
  };
  const sheetMove = e => {
    if(!drag) { if(st.sheet && st.tab === 'slice') { const p = at(e); const i = frameAt(p.fx, p.fy); $.querySelector('.ea-s2').textContent = `${p.x}, ${p.y}${i >= 0 ? ` · frame ${i}` : ''}`; } return; }
    if(drag.pan) { View.pan(st.tab === 'map' ? st.paint.view : st.view, e.clientX - drag.x, e.clientY - drag.y); drag.x = e.clientX; drag.y = e.clientY; drawSheet(); return; }
    const p = at(e);
    if(drag.draw) { drawNew.x1 = p.x + 1; drawNew.y1 = p.y + 1; drawSheet(); return; }
    const f = st.frames[drag.frame], dx = Math.round(p.fx - drag.sx), dy = Math.round(p.fy - drag.sy);
    if(!drag.moved && !dx && !dy) return;
    drag.moved = true;
    if(drag.resize) { f.w = Math.max(1, drag.ow + dx); f.h = Math.max(1, drag.oh + dy); }
    else { f.x = Math.max(0, Math.min(st.sheet.w - f.w, drag.ox + dx)); f.y = Math.max(0, Math.min(st.sheet.h - f.h, drag.oy + dy)); }
    drawSheet();
  };
  const sheetUp = () => {
    if(drag?.draw && drawNew) {
      const a = drawNew, f = { x: Math.max(0, Math.min(a.x0, a.x1)), y: Math.max(0, Math.min(a.y0, a.y1)), w: Math.abs(a.x1 - a.x0), h: Math.abs(a.y1 - a.y0) };
      if(f.w > 0 && f.h > 0) { st.frames.push(f); st.sel = new Set([st.frames.length - 1]); }
      drawNew = null;
      newMode = false;
      $.querySelector('.ea-main').classList.remove('drawing');
      drawAll();
      persist();
    }
    else if(drag?.moved) { drawPanels(); persist(); }
    drag = null;
  };
  //#endregion

  //#region [ Animations ]
  const newAnim = frames => {
    st.anims.push({ name: `anim_${st.anims.length + 1}`, frames, fps: 8, mode: 'loop' });
    st.cur = st.anims.length - 1;
    st.play.t0 = performance.now();
    drawPanels();
    persist();
  };

  const drawAnims = () => {
    const $l = $.querySelector('.ea-anims');
    $l.innerHTML = st.anims.length ? st.anims.map((a, i) => `<div class="ea-anim${i === st.cur ? ' on' : ''}" data-anim="${i}"><span>${Kit.esc(a.name)}</span><em>${a.frames.length} · ${a.fps} fps</em><button class="ghost ic-only" data-a="anim-del" data-i="${i}" title="Delete">${Kit.icon('trash')}</button></div>`).join('') : '<p class="muted ea-note">No animations yet.</p>';
    const a = st.anims[st.cur];
    $.querySelector('.ea-anim-o').innerHTML = a ? `
      <label class="field"><span>Name</span><input data-ao="name" value="${Kit.esc(a.name)}"></label>
      <div class="ea-row"><label class="field"><span>FPS</span><input type="number" min="1" max="60" data-ao="fps" value="${a.fps}"></label>
      <label class="field"><span>Mode</span><select data-ao="mode">${['loop', 'pingpong', 'once'].map(m => `<option${a.mode === m ? ' selected' : ''}>${m}</option>`).join('')}</select></label></div>
      <div class="muted ea-note">Pivot: ${a.pivot ? `${a.pivot.x}, ${a.pivot.y} <button class="ghost" data-a="pivot-clear">clear</button>` : 'none'}</div>` : '';
  };

  const drawTimeline = () => {
    const $t = $.querySelector('.ea-timeline');
    const a = st.anims[st.cur];
    $.querySelector('.ea-prev-t').textContent = a ? a.name : 'Preview';
    if(!a || !st.sheet) { $t.innerHTML = '<p class="muted ea-note" style="padding:8px">Select frames and make an animation.</p>'; return; }
    const seq = Sprites.sequence(a);
    $t.innerHTML = a.frames.map((i, k) => {
      const f = st.frames[i];
      if(!f) return '';
      return `<div class="ea-tl${seq[st.play.step] === i && k === (st.play.step < a.frames.length ? st.play.step : -1) ? ' on' : ''}" data-k="${k}">${thumb(f, i, 40)}<input type="number" min="10" step="10" data-dur="${i}" value="${a.durations?.[i] ?? ''}" placeholder="${Math.round(1000 / a.fps)}" title="ms (empty = fps)"><button class="ghost ic-only" data-a="tl-del" data-k="${k}" title="Remove">${Kit.icon('xmark')}</button></div>`;
    }).join('');
  };

  const frameTimer = { last: 0 };
  const tick = now => {
    requestAnimationFrame(tick);
    if(!$ || !$.isConnected || Hub.active !== 'easel') return;
    const a = st.anims[st.cur];
    const cv = $.querySelector('.ea-pcv');
    if(!a || !a.frames.length || !st.sheet) { cv.width = cv.width; return; }
    const durs = Sprites.durations(a), seq = Sprites.sequence(a);
    let step = st.play.step;
    if(st.play.on) {
      const total = durs.reduce((s, d) => s + d, 0);
      let t = now - st.play.t0;
      if(a.mode === 'once' && t >= total) t = total - 1;
      t %= total;
      step = 0;
      while(t >= durs[step]) { t -= durs[step]; step++; }
    }
    step = Math.max(0, Math.min(seq.length - 1, step));
    if(step !== st.play.step) { st.play.step = step; drawTimeline(); if(st.tab === 'animate') drawSheet(); }
    // size the canvas to the biggest frame of the animation
    const fr = a.frames.map(i => st.frames[i]).filter(Boolean);
    const bw = Math.max(...fr.map(f => f.w)), bh = Math.max(...fr.map(f => f.h)), k = st.play.scale;
    if(cv.width !== bw * k || cv.height !== bh * k) { cv.width = bw * k; cv.height = bh * k; }
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, cv.width, cv.height);
    const draw = (i, alpha) => {
      const f = st.frames[i];
      if(!f) return;
      g.globalAlpha = alpha;
      // pivot: frames line up on the pivot point (bottom-center when none)
      const px = a.pivot ? a.pivot.x : f.w / 2, py = a.pivot ? a.pivot.y : f.h;
      const ox = (bw / 2 - px) * k + (a.pivot ? 0 : 0), oy = (a.pivot ? (bh / 2 - py) : (bh - f.h)) * k;
      g.drawImage(st.sheet.img, f.x, f.y, f.w, f.h, a.pivot ? ox : (bw - f.w) / 2 * k, oy, f.w * k, f.h * k);
    };
    if(st.play.onion && seq.length > 1) draw(seq[(step - 1 + seq.length) % seq.length], 0.3);
    draw(seq[step], 1);
    g.globalAlpha = 1;
    if(a.pivot) { g.fillStyle = '#FF79C6'; g.fillRect(bw / 2 * k - 2, bh / 2 * k - 2, 4, 4); }
  };
  //#endregion

  //#region [ Autotile ]
  const runAuto = () => {
    const s = st.auto.src, $a = $.querySelector('.ea-auto');
    $.querySelectorAll('[data-uv]').forEach($v => { $v.textContent = st.auto[$v.dataset.uv]; });
    if(!s) { $a.innerHTML = `<div class="empty"><div class="big">${Kit.icon('border-all')}</div><div>Open a minimal tileset (2 tiles wide, 1 tall), or use the current sheet.</div><button data-a="auto-demo">Try a demo source</button></div>`; return; }
    const cv = Object.assign(document.createElement('canvas'), { width: s.w, height: s.h });
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(s.img, 0, 0);
    const grid = st.auto.grid;
    if(s.w < grid * 2 || s.h < grid) { $a.innerHTML = `<div class="empty">Source is ${s.w}×${s.h}: it needs ${grid * 2}×${grid} (two tiles of the grid). Change the grid.</div>`; return; }
    const r = Sprites.autotile(g.getImageData(0, 0, s.w, s.h).data, s.w, s.h, st.auto);
    const out = Object.assign(document.createElement('canvas'), { width: r.w, height: r.h });
    out.getContext('2d').putImageData(new ImageData(r.px, r.w, r.h), 0, 0);
    st.auto.out = out;
    // a small demo map painted with it
    const demo = ['..........', '.####..##.', '.#######..', '.##..###..', '.##..####.', '..######..', '....##....', '..........'];
    const on = (x, y) => demo[y]?.[x] === '#';
    const dm = Object.assign(document.createElement('canvas'), { width: 10 * grid, height: 8 * grid });
    const dg = dm.getContext('2d');
    for(let y = 0; y < 8; y++) for(let x = 0; x < 10; x++) {
      if(!on(x, y)) continue;
      const t = Sprites.tileFor(Sprites.blob(on, x, y));
      dg.drawImage(out, (t % 12) * grid, Math.floor(t / 12) * grid, grid, grid, x * grid, y * grid, grid, grid);
    }
    const k = Math.max(2, Math.floor(Math.min(900 / r.w, 6))), ks = Math.max(k, Math.floor(Math.min(320 / s.w, 10)));
    $a.innerHTML = `<div class="ea-auto-in">
      <div class="lbl">Source</div><div class="ea-pix" style="width:${s.w * ks}px"><img src="${s.url}" style="width:${s.w * ks}px"></div>
      <div class="lbl">Autotile set (12 × 4)</div><div class="ea-pix ea-out" style="width:${r.w * k}px"><img src="${out.toDataURL()}" style="width:${r.w * k}px"></div>
      <div class="lbl">Demo map</div><div class="ea-pix" style="width:${dm.width * k}px"><img src="${dm.toDataURL()}" style="width:${dm.width * k}px"></div></div>`;
  };

  const demoSource = () => {
    // a tiny minimal source drawn here: wall quarters (navy + blue border) and a floor tile
    const g16 = 16, cv = Object.assign(document.createElement('canvas'), { width: 32, height: 16 });
    const g = cv.getContext('2d');
    g.fillStyle = '#4A6A8A'; g.fillRect(16, 0, 16, 16);
    g.fillStyle = '#56789A'; for(let i = 0; i < 16; i += 4) { g.fillRect(16 + i, i % 8, 2, 2); g.fillRect(16 + (i + 6) % 16, (i + 9) % 16, 2, 2); }
    // border tile quarters (8 x 8): TL edge (floor left, wall right), TR full wall, BL outer corner, BR inner corner
    const W = '#1E2240', B = '#2E7FB8', q = (qx, qy, list, c) => { g.fillStyle = c; for(const [x, y, w, h] of list) g.fillRect(qx + x, qy + y, w, h); };
    q(0, 0, [[6, 0, 2, 8]], W); q(0, 0, [[4, 0, 2, 8]], B);
    q(8, 0, [[0, 0, 8, 8]], W);
    q(0, 8, [[6, 0, 2, 4]], W); q(0, 8, [[4, 0, 2, 6], [4, 4, 4, 2]], B);
    q(8, 8, [[0, 0, 2, 4]], W); q(8, 8, [[2, 0, 2, 6], [0, 4, 4, 2]], B);
    void g16;
    cv.toBlob(async b => {
      const url = URL.createObjectURL(b);
      st.auto.src = { name: 'demo-minimal.png', url, img: await loadImage(url), w: 32, h: 16 };
      st.auto.grid = 16;
      syncAutoInputs();
      runAuto();
    });
  };

  const syncAutoInputs = () => {
    $.querySelectorAll('[data-u]').forEach($i => { $i.value = st.auto[$i.dataset.u]; if($i.type === 'range') { $i.max = Math.max(1, Math.floor(st.auto.grid / 2)); DAE.UI.fill($i); } });
  };

  const useAuto = () => {
    if(!st.auto.out) return st.api.toast('Make an autotile set first', true);
    st.auto.out.toBlob(async b => {
      await setSheet(b, (st.auto.src?.name ?? 'autotile').replace(/\.\w+$/, '') + '-autotile.png');
      st.frames = Sprites.grid(st.sheet.w, st.sheet.h, { cell: { w: st.auto.grid, h: st.auto.grid }, skipEmpty: false });
      st.frames.forEach((f, i) => { f.name = `tile_${i}`; });
      ensureMap(true);
      st.paint.layer = 0;
      setTab('map');
      st.api.toast('Autotile set loaded: paint on the Terrain layer');
    });
  };
  //#endregion

  //#region [ Map ]
  const ensureMap = (reset = false) => {
    const cell = st.frames[0]?.w ?? 16;
    if(st.map && !reset && st.map.cell) return;
    const w = st.map?.w ?? 20, h = st.map?.h ?? 14;
    st.map = { w, h, cell, layers: [{ name: 'Terrain', kind: 'terrain', cells: new Int32Array(w * h) }, { name: 'Tiles', kind: 'tiles', cells: new Int32Array(w * h).fill(-1) }] };
  };
  const isAutoSheet = () => st.frames.length === 48 && st.frames.every(f => f.w === st.frames[0].w && f.h === st.frames[0].w);
  const terrainSrc = () => (isAutoSheet() ? { img: st.sheet.img, at: t => st.frames[t] } : st.auto.out ? { img: st.auto.out, at: t => ({ x: (t % 12) * st.auto.grid, y: Math.floor(t / 12) * st.auto.grid, w: st.auto.grid, h: st.auto.grid }) } : null);

  const drawMap = (g, r) => {
    if(!st.map) return;
    const v = st.paint.view, m = st.map, c = m.cell;
    g.save();
    g.translate(-v.x * v.zoom, -v.y * v.zoom);
    g.scale(v.zoom, v.zoom);
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#222';
    g.fillRect(0, 0, m.w * c, m.h * c);
    const ter = m.layers.find(l => l.kind === 'terrain'), src = terrainSrc();
    const on = (x, y) => x >= 0 && y >= 0 && x < m.w && y < m.h && ter.cells[y * m.w + x] > 0;
    if(src) {
      for(let y = 0; y < m.h; y++) for(let x = 0; x < m.w; x++) {
        if(!on(x, y)) continue;
        const f = src.at(Sprites.tileFor(Sprites.blob(on, x, y)));
        g.drawImage(src.img, f.x, f.y, f.w, f.h, x * c, y * c, c, c);
      }
    }
    else {
      g.fillStyle = 'rgba(205,127,50,.5)';
      for(let y = 0; y < m.h; y++) for(let x = 0; x < m.w; x++) if(on(x, y)) g.fillRect(x * c, y * c, c, c);
    }
    const tl = m.layers.find(l => l.kind === 'tiles');
    if(st.sheet) for(let y = 0; y < m.h; y++) for(let x = 0; x < m.w; x++) {
      const t = tl.cells[y * m.w + x], f = st.frames[t];
      if(t >= 0 && f) g.drawImage(st.sheet.img, f.x, f.y, f.w, f.h, x * c + (c - f.w) / 2, y * c + c - f.h, f.w, f.h);
    }
    // grid
    g.strokeStyle = 'rgba(255,255,255,.06)';
    g.lineWidth = 1 / v.zoom;
    g.beginPath();
    for(let x = 0; x <= m.w; x++) { g.moveTo(x * c, 0); g.lineTo(x * c, m.h * c); }
    for(let y = 0; y <= m.h; y++) { g.moveTo(0, y * c); g.lineTo(m.w * c, y * c); }
    g.stroke();
    if(paintRect) {
      g.strokeStyle = '#CD7F32';
      g.lineWidth = 2 / v.zoom;
      const [x0, y0, x1, y1] = [Math.min(paintRect.x0, paintRect.x1), Math.min(paintRect.y0, paintRect.y1), Math.max(paintRect.x0, paintRect.x1), Math.max(paintRect.y0, paintRect.y1)];
      g.strokeRect(x0 * c, y0 * c, (x1 - x0 + 1) * c, (y1 - y0 + 1) * c);
    }
    if(hover) { g.strokeStyle = 'rgba(241,250,140,.7)'; g.lineWidth = 1.5 / v.zoom; g.strokeRect(hover.x * c, hover.y * c, c, c); }
    g.restore();
    $.querySelector('.ea-z').textContent = Math.round(v.zoom * 100) + '%';
  };

  let paintRect = null, hover = null, painting = null;
  const cellAt = e => { const p = View.toWorld(st.paint.view, crect(), e.clientX, e.clientY); return { x: Math.floor(p.x / st.map.cell), y: Math.floor(p.y / st.map.cell) }; };
  const layer = () => st.map.layers[st.paint.layer];
  const valueFor = erase => (erase ? (layer().kind === 'terrain' ? 0 : -1) : layer().kind === 'terrain' ? 1 : st.paint.tile);
  const setCell = (x, y, val) => { if(x < 0 || y < 0 || x >= st.map.w || y >= st.map.h) return; layer().cells[y * st.map.w + x] = val; };

  const mapDown = e => {
    if(st.tab !== 'map' || !st.map) return false;
    if(e.button === 1 || spaceDown || e.altKey) { drag = { pan: true, x: e.clientX, y: e.clientY }; return true; }
    const c = cellAt(e), erase = e.button === 2 || st.paint.tool === 'erase', val = valueFor(erase);
    if(st.paint.tool === 'fill' && !erase) { if(c.x >= 0 && c.y >= 0 && c.x < st.map.w && c.y < st.map.h) Sprites.flood(layer().cells, st.map.w, st.map.h, c.x, c.y, val); drawSheet(); persist(); return true; }
    if(st.paint.tool === 'rect') { paintRect = { x0: c.x, y0: c.y, x1: c.x, y1: c.y, val }; drawSheet(); return true; }
    painting = { val };
    setCell(c.x, c.y, val);
    drawSheet();
    return true;
  };
  const mapMove = e => {
    if(st.tab !== 'map' || !st.map) return false;
    if(drag?.pan) return false;
    const c = cellAt(e);
    hover = c;
    $.querySelector('.ea-s2').textContent = `${c.x}, ${c.y}`;
    if(paintRect) { paintRect.x1 = c.x; paintRect.y1 = c.y; }
    else if(painting) setCell(c.x, c.y, painting.val);
    drawSheet();
    return true;
  };
  const mapUp = () => {
    if(paintRect) {
      const r = paintRect;
      for(let y = Math.min(r.y0, r.y1); y <= Math.max(r.y0, r.y1); y++) for(let x = Math.min(r.x0, r.x1); x <= Math.max(r.x0, r.x1); x++) setCell(x, y, r.val);
      paintRect = null;
      drawSheet();
      persist();
    }
    if(painting) { painting = null; persist(); }
  };

  const drawMapPanel = () => {
    if(!st.map) ensureMap();
    $.querySelector('[data-m=w]').value = st.map.w;
    $.querySelector('[data-m=h]').value = st.map.h;
    $.querySelector('.ea-layers').innerHTML = st.map.layers.map((l, i) => `<div class="ea-anim${i === st.paint.layer ? ' on' : ''}" data-layer="${i}"><span>${l.name}</span><em>${l.kind === 'terrain' ? (terrainSrc() ? 'autotile' : 'no autotile set') : 'frames'}</em></div>`).join('');
    const tiles = layer().kind === 'tiles';
    $.querySelector('.ea-pal-t').style.display = tiles ? '' : 'none';
    $.querySelector('.ea-pal').innerHTML = tiles && st.sheet ? st.frames.map((f, i) => thumb(f, i, 34, i === st.paint.tile ? ' on' : '')).join('') : '';
    $.querySelectorAll('[data-k=tool] button').forEach(b => b.classList.toggle('on', b.dataset.v === st.paint.tool));
  };

  const mapPng = () => {
    const m = st.map, c = m.cell;
    const cv = Object.assign(document.createElement('canvas'), { width: m.w * c, height: m.h * c });
    const g = cv.getContext('2d');
    const keep = st.paint.view;
    st.paint.view = View.make(0, 0, 1);
    const hv = hover;
    hover = null;
    drawMap(g, { width: cv.width, height: cv.height });
    st.paint.view = keep;
    hover = hv;
    cv.toBlob(b => Kit.download('test-map.png', b));
  };
  //#endregion

  //#region [ Panels ]
  const setTab = tab => {
    st.tab = tab;
    $.querySelector('.ea').dataset.tab = tab;
    document.querySelectorAll('#tool-bar [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    if(tab === 'map') { ensureMap(); drawMapPanel(); }
    if(tab === 'autotile') { syncAutoInputs(); runAuto(); }
    requestAnimationFrame(() => { fitView(); drawAll(); });
  };

  const drawPanels = () => {
    const o = st.slice;
    $.querySelectorAll('.ea-side .seg[data-k]').forEach($s => $s.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(o[$s.dataset.k] ?? st.paint[$s.dataset.k]))));
    $.querySelectorAll('.ea-pbar .seg[data-k]').forEach($s => $s.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(st.play[$s.dataset.k]))));
    $.querySelector('.ea-grid-o').style.display = o.mode === 'grid' ? '' : 'none';
    $.querySelector('.ea-isl-o').style.display = o.mode === 'islands' ? '' : 'none';
    $.querySelector('.ea-by-size').style.display = o.by === 'size' ? '' : 'none';
    $.querySelector('.ea-by-count').style.display = o.by === 'count' ? '' : 'none';
    $.querySelectorAll('[data-n]').forEach($i => { if(document.activeElement !== $i) $i.value = o[$i.dataset.n]; });
    $.querySelector('[data-c=skip]').checked = o.skip;
    $.querySelector('.ea-fcount').textContent = st.frames.length ? `${st.frames.length}${st.sel.size ? ` · ${st.sel.size} selected` : ''}` : '';
    $.querySelector('[data-for=slice] .ea-thumbs').innerHTML = st.sheet ? st.frames.slice(0, 600).map((f, i) => thumb(f, i, 40, st.sel.has(i) ? ' on' : '')).join('') : '';
    drawAnims();
    drawTimeline();
    if(st.tab === 'map') drawMapPanel();
    $.querySelector('.ea-empty').style.display = !st.sheet && st.tab !== 'autotile' && st.tab !== 'map' ? '' : 'none';
    $.querySelector('.ea-s1').textContent = st.sheet ? `${st.sheet.name} · ${st.sheet.w}×${st.sheet.h} · ${st.frames.length} frames · ${st.anims.length} animations` : '';
    $.querySelector('[data-a=p-play]').innerHTML = Kit.icon(st.play.on ? 'pause' : 'play');
    $.querySelector('[data-a=p-onion]').checked = st.play.onion;
  };

  const drawAll = () => { drawPanels(); drawSheet(); };
  //#endregion

  //#region [ Files ]
  const project = () => Sprites.data({ image: st.sheet?.name ?? '', w: st.sheet?.w ?? 0, h: st.sheet?.h ?? 0, frames: st.frames, anims: st.anims });
  const base = () => (st.sheet?.name ?? 'sheet').replace(/\.\w+$/, '');

  const persist = Kit.later(() => {
    if(!st.sheet) return;
    st.api.set('project', { blob: st.sheet.blob, name: st.sheet.name, frames: st.frames, anims: st.anims, slice: st.slice, map: st.map && Sprites.mapData(st.map) });
  }, 600);

  const openFile = async f => {
    const e = Hub.ext(f.name);
    if(['toon', 'json'].includes(e)) {
      const text = await f.text();
      let d;
      try { d = e === 'json' ? JSON.parse(text) : Toon.decode(text); } catch(err) { st.api.toast(err.message, true); return; }
      if(d.app === 'easel-map') { st.map = Sprites.readMap(d); setTab('map'); return; }
      const p = d.app === 'easel' ? Sprites.read(d) : d.meta && d.frames ? Sprites.fromAseprite(d) : null;
      if(!p) return st.api.toast('Not an Easel or Aseprite file', true);
      if(!st.sheet) st.api.toast(`Now open the image ${p.image ?? ''}`);
      st.frames = p.frames; st.anims = p.anims; st.cur = st.anims.length ? 0 : -1;
      drawAll(); persist();
      return;
    }
    if(st.tab === 'autotile') {
      const url = URL.createObjectURL(f);
      const img = await loadImage(url);
      st.auto.src = { name: f.name, url, img, w: img.naturalWidth, h: img.naturalHeight };
      if(img.naturalWidth === img.naturalHeight * 2) st.auto.grid = img.naturalHeight;
      syncAutoInputs();
      runAuto();
      return;
    }
    await setSheet(f, f.name);
    st.api.recent(f.name);
  };

  const pick = async () => {
    const files = await FileIO.pick({ accept: 'image/*,.toon,.json', multiple: true });
    files.sort((a, b) => (a.type.startsWith('image/') ? -1 : 1) - (b.type.startsWith('image/') ? -1 : 1));
    for(const f of files) await openFile(f);
  };

  /** RGBA of one frame (cut from the sheet). */
  const cut = f => {
    const cv = Object.assign(document.createElement('canvas'), { width: f.w, height: f.h });
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(st.sheet.img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
    return cv;
  };
  const pngBytes = cv => new Promise(ok => cv.toBlob(async b => ok(new Uint8Array(await b.arrayBuffer())), 'image/png'));

  const exportMenu = (e, $btn) => {
    const r = $btn.getBoundingClientRect();
    const needSheet = fn => () => (st.sheet && st.frames.length ? fn() : st.api.toast('Open a sheet and slice it first', true));
    const a = st.anims[st.cur];
    Menu.show(r.left, r.bottom + 4, [
      'Frames',
      ['file-export', 'Project (TOON)', needSheet(() => Kit.download(`${base()}.easel.toon`, Toon.encode(project())))],
      ['file-export', 'Frames + animations (JSON)', needSheet(() => Kit.download(`${base()}.json`, JSON.stringify(project(), null, 2), 'application/json'))],
      ['file-export', 'Aseprite JSON', needSheet(() => Kit.download(`${base()}.aseprite.json`, JSON.stringify(Sprites.aseprite({ image: st.sheet.name, w: st.sheet.w, h: st.sheet.h, frames: st.frames, anims: st.anims }), null, 2), 'application/json'))],
      ['download', 'Every frame as PNG (zip)', needSheet(async () => {
        const files = [];
        for(const [i, f] of st.frames.entries()) files.push({ name: `${base()}/${f.name ?? `frame_${String(i).padStart(3, '0')}`}.png`, data: await pngBytes(cut(f)) });
        Kit.download(`${base()}-frames.zip`, new Blob([Zip.make(files)], { type: 'application/zip' }));
      })],
      ['image', 'Repacked tight sheet + JSON', needSheet(async () => {
        const p = Sprites.pack(st.frames);
        const cv = Object.assign(document.createElement('canvas'), { width: p.w, height: p.h });
        const g = cv.getContext('2d');
        st.frames.forEach((f, i) => g.drawImage(st.sheet.img, f.x, f.y, f.w, f.h, p.pos[i].x, p.pos[i].y, f.w, f.h));
        const frames = st.frames.map((f, i) => ({ ...f, x: p.pos[i].x, y: p.pos[i].y }));
        Kit.download(`${base()}-packed.zip`, new Blob([Zip.make([
          { name: `${base()}-packed.png`, data: await pngBytes(cv) },
          { name: `${base()}-packed.json`, data: JSON.stringify(Sprites.aseprite({ image: `${base()}-packed.png`, w: p.w, h: p.h, frames, anims: st.anims }), null, 2) },
        ])], { type: 'application/zip' }));
      })],
      '-', 'Animation',
      ['film', a ? `GIF of "${a.name}"` : 'GIF (pick an animation)', () => {
        if(!a || !a.frames.length) return st.api.toast('Pick an animation first', true);
        const fr = a.frames.map(i => st.frames[i]).filter(Boolean);
        const bw = Math.max(...fr.map(f => f.w)), bh = Math.max(...fr.map(f => f.h));
        const durs = Sprites.durations(a);
        const frames = Sprites.sequence(a).map((i, k) => {
          const f = st.frames[i], cv = Object.assign(document.createElement('canvas'), { width: bw, height: bh });
          const g = cv.getContext('2d', { willReadFrequently: true });
          g.drawImage(st.sheet.img, f.x, f.y, f.w, f.h, Math.floor((bw - f.w) / 2), bh - f.h, f.w, f.h);
          return { rgba: g.getImageData(0, 0, bw, bh).data, delay: durs[k] };
        });
        Kit.download(`${base()}-${a.name}.gif`, new Blob([Gif.encode({ w: bw, h: bh, frames, loop: a.mode === 'once' ? 1 : 0 })], { type: 'image/gif' }));
      }],
      '-', 'Test map',
      ['file-export', 'Map (TOON)', () => st.map ? Kit.download('test-map.toon', Toon.encode(Sprites.mapData(st.map))) : st.api.toast('No map yet', true)],
      ['file-export', 'Map (JSON)', () => st.map ? Kit.download('test-map.json', JSON.stringify(Sprites.mapData(st.map), null, 2), 'application/json') : st.api.toast('No map yet', true)],
      ['image', 'Map (PNG)', () => (st.map ? mapPng() : st.api.toast('No map yet', true))],
    ]);
  };

  const sample = () => {
    // a 4-frame bouncing ball strip + a 3-frame star, drawn here (no files needed)
    const cv = Object.assign(document.createElement('canvas'), { width: 64, height: 48 });
    const g = cv.getContext('2d');
    [[8, 0], [6, 2], [2, 5], [0, 7]].forEach(([y, sq], i) => {
      g.fillStyle = '#CD7F32';
      g.beginPath(); g.ellipse(i * 16 + 8, 16 - y + sq / 2, 6 + sq / 3, 6 - sq / 3, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#F2D0A4'; g.fillRect(i * 16 + 5, 12 - y + sq / 2, 2, 2);
    });
    for(let i = 0; i < 3; i++) {
      g.save(); g.translate(i * 16 + 8, 36); g.rotate(i * Math.PI / 7.5);
      g.fillStyle = '#F1FA8C';
      g.beginPath();
      for(let k = 0; k < 10; k++) { const rr = k % 2 ? 2.6 : 6, ang = k * Math.PI / 5; g.lineTo(Math.sin(ang) * rr, -Math.cos(ang) * rr); }
      g.fill(); g.restore();
    }
    cv.toBlob(async b => {
      await setSheet(b, 'sample-sheet.png');
      st.slice = { ...st.slice, mode: 'grid', by: 'size', cw: 16, ch: 24, margin: 0, spacing: 0, skip: true };
      doSlice();
      newAnim([0, 1, 2, 3]);
      st.anims[0].name = 'bounce'; st.anims[0].mode = 'pingpong';
      st.anims.push({ name: 'spin', frames: [4, 5, 6], fps: 10, mode: 'loop' });
      drawAll();
    });
  };
  //#endregion

  //#region [ Mount ]
  let spaceDown = false;
  const mount = api => {
    st.api = api;
    $ = api.$el;
    $.innerHTML = html;
    Kit.split($.querySelector('.split'), $.querySelector('.ea-side'), w => $.querySelector('.ea').style.setProperty('--sw', w + 'px'), { min: 200, max: 520 });
    const $tabs = Kit.el(`<span class="seg">${[['slice', 'Slice'], ['animate', 'Animate'], ['autotile', 'Autotile'], ['map', 'Map']].map(([k, l]) => `<button data-tab="${k}"${k === st.tab ? ' class="on"' : ''}>${l}</button>`).join('')}</span>`);
    $tabs.onclick = e => { const t = e.target.closest('[data-tab]')?.dataset.tab; if(t) setTab(t); };
    api.bar($tabs);
    api.actions([
      ['folder-open', 'Open', pick, { title: 'Open an image, an Easel / Aseprite file or a map (Ctrl+O)' }],
      ['file-export', 'Export', exportMenu, { primary: true }],
    ]);

    // side panel inputs
    $.querySelector('.ea-side').addEventListener('input', e => {
      const t = e.target;
      if(t.dataset.n) st.slice[t.dataset.n] = Math.max(+t.min || 0, +t.value || 0);
      if(t.dataset.c) st.slice[t.dataset.c] = t.checked;
      if(t.dataset.u) { st.auto[t.dataset.u] = +t.value; if(t.dataset.u === 'grid') syncAutoInputs(); runAuto(); }
      if(t.dataset.ao && st.anims[st.cur]) {
        const a = st.anims[st.cur];
        a[t.dataset.ao] = t.dataset.ao === 'fps' ? Math.max(1, +t.value || 1) : t.value;
        drawAnims();
        const $f = $.querySelector(`[data-ao="${t.dataset.ao}"]`);
        $f?.focus();
        if($f && t.dataset.ao === 'name') $f.setSelectionRange($f.value.length, $f.value.length);
        persist();
      }
      if(t.dataset.m) {
        const w = Math.max(1, Math.min(256, +$.querySelector('[data-m=w]').value || 1)), h = Math.max(1, Math.min(256, +$.querySelector('[data-m=h]').value || 1));
        const old = st.map;
        st.map = { ...old, w, h, layers: old.layers.map(l => { const c = new Int32Array(w * h).fill(l.kind === 'terrain' ? 0 : -1); for(let y = 0; y < Math.min(h, old.h); y++) for(let x = 0; x < Math.min(w, old.w); x++) c[y * w + x] = l.cells[y * old.w + x]; return { ...l, cells: c }; }) };
        drawSheet(); persist();
      }
    });
    $.querySelector('.ea-side').addEventListener('change', e => {
      if(e.target.dataset.ao) { drawAnims(); }
    });
    $.querySelector('.ea-timeline').addEventListener('input', e => {
      const a = st.anims[st.cur], i = e.target.dataset.dur;
      if(!a || i === undefined) return;
      a.durations ??= {};
      if(e.target.value) a.durations[i] = +e.target.value; else delete a.durations[i];
      persist();
    });

    $.addEventListener('click', e => {
      const $seg = e.target.closest('.seg[data-k] [data-v]');
      if($seg) {
        const k = $seg.parentElement.dataset.k, v = $seg.dataset.v;
        if(k in st.slice) st.slice[k] = v;
        else if(k in st.play) st.play[k] = k === 'scale' ? +v : v;
        else if(k === 'tool') st.paint.tool = v;
        if(k === 'bg') $.querySelector('.ea-stage').dataset.bg = v;
        drawPanels();
        return;
      }
      const a = e.target.closest('[data-a]')?.dataset.a;
      const $th = e.target.closest('.ea-th');
      if($th && e.target.closest('.ea-pal')) { st.paint.tile = +$th.dataset.f; drawMapPanel(); return; }
      if($th && e.target.closest('[data-for=slice]')) { const i = +$th.dataset.f; if(e.ctrlKey) st.sel.has(i) ? st.sel.delete(i) : st.sel.add(i); else st.sel = new Set([i]); st.last = i; drawAll(); return; }
      const $an = e.target.closest('[data-anim]');
      if($an && !a) { st.cur = +$an.dataset.anim; st.play.t0 = performance.now(); drawAll(); return; }
      const $ly = e.target.closest('[data-layer]');
      if($ly) { st.paint.layer = +$ly.dataset.layer; drawMapPanel(); return; }
      if(!a) return;
      if(a === 'open') pick();
      if(a === 'sample') sample();
      if(a === 'slice') doSlice();
      if(a === 'anim-new') { if(!st.sel.size) return api.toast('Select frames on the sheet first (Slice tab)', true); newAnim([...st.sel].sort((x, y) => x - y)); setTab('animate'); }
      if(a === 'anim-del') { st.anims.splice(+e.target.closest('[data-i]').dataset.i, 1); st.cur = Math.min(st.cur, st.anims.length - 1); drawAll(); persist(); }
      if(a === 'tl-del') { st.anims[st.cur].frames.splice(+e.target.closest('[data-k]').dataset.k, 1); drawAll(); persist(); }
      if(a === 'pivot-clear') { delete st.anims[st.cur].pivot; drawAnims(); persist(); }
      if(a === 'p-play') { st.play.on = !st.play.on; st.play.t0 = performance.now() - 0; drawPanels(); }
      if(a === 'p-step-f' || a === 'p-step-b') { st.play.on = false; const n = Sprites.sequence(st.anims[st.cur] ?? { frames: [] }).length || 1; st.play.step = (st.play.step + (a === 'p-step-f' ? 1 : -1) + n) % n; drawPanels(); }
      if(a === 'p-onion') { st.play.onion = e.target.checked; }
      if(a === 'z-in' || a === 'z-out') { View.zoomAt(st.tab === 'map' ? st.paint.view : st.view, crect(), a === 'z-in' ? 1.25 : 0.8, undefined, undefined, 0.1, 40); drawSheet(); }
      if(a === 'z-fit') { fitView(); drawSheet(); }
      if(a === 'auto-open') FileIO.pick({ accept: 'image/*' }).then(([f]) => { if(f) { const t = st.tab; st.tab = 'autotile'; openFile(f).then(() => { st.tab = t; }); } });
      if(a === 'auto-sheet') { if(!st.sheet) return api.toast('No sheet open', true); st.auto.src = { ...st.sheet }; if(st.sheet.w === st.sheet.h * 2) st.auto.grid = st.sheet.h; syncAutoInputs(); runAuto(); }
      if(a === 'auto-demo') demoSource();
      if(a === 'auto-use') useAuto();
      if(a === 'auto-png') st.auto.out ? st.auto.out.toBlob(b => Kit.download('autotile.png', b)) : api.toast('Make one first', true);
      if(a === 'auto-masks') Kit.download('autotile-masks.toon', Toon.encode({ app: 'easel-autotile', grid: st.auto.grid, cols: 12, rows: 4, bits: 'N1 NE2 E4 SE8 S16 SW32 W64 NW128 (corners only with both sides)', tiles: Sprites.MASKS.map((mask, i) => ({ tile: i, x: i % 12, y: Math.floor(i / 12), mask })) }));
    });

    // preview: click sets the pivot (in frame px of the biggest frame box)
    $.querySelector('.ea-pcv').addEventListener('click', e => {
      const a = st.anims[st.cur];
      if(!a) return;
      const r = e.target.getBoundingClientRect(), k = st.play.scale * (r.width / e.target.width);
      a.pivot = { x: Math.round((e.clientX - r.left) / k), y: Math.round((e.clientY - r.top) / k) };
      drawAnims(); persist();
    });

    const $main = $.querySelector('.ea-main'), $c = $cv();
    $c.addEventListener('pointerdown', e => { $c.setPointerCapture(e.pointerId); if(!mapDown(e)) sheetDown(e); });
    $c.addEventListener('pointermove', e => { if(drag?.pan) return sheetMove(e); if(!mapMove(e)) sheetMove(e); });
    $c.addEventListener('pointerup', () => { mapUp(); sheetUp(); });
    $c.addEventListener('pointerleave', () => { hover = null; if(st.tab === 'map') drawSheet(); });
    $c.addEventListener('contextmenu', e => e.preventDefault());
    $c.addEventListener('wheel', e => {
      e.preventDefault();
      View.zoomAt(st.tab === 'map' ? st.paint.view : st.view, crect(), Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY, 0.1, 40);
      drawSheet();
    }, { passive: false });
    new ResizeObserver(() => drawSheet()).observe($main);
    requestAnimationFrame(tick);
    addEventListener('keyup', e => { if(e.key === ' ') spaceDown = false; });

    // last project
    api.get('project').then(async p => {
      if(!p?.blob || st.sheet) { drawAll(); return; }
      await setSheet(p.blob, p.name);
      st.frames = p.frames ?? []; st.anims = p.anims ?? []; st.cur = st.anims.length ? 0 : -1;
      if(p.slice) st.slice = { ...st.slice, ...p.slice };
      if(p.map) try { st.map = Sprites.readMap(p.map); } catch {}
      drawAll();
    });
    drawAll();
  };
  //#endregion

  Hub.register('easel', {
    mount,
    pick,
    show() { requestAnimationFrame(() => drawAll()); },
    async open(file) {
      // a handoff from Hestia carries the image as a data URL
      if(typeof file.text === 'string' && file.text.startsWith('data:')) {
        const blob = await (await fetch(file.text)).blob();
        return openFile(new File([blob], file.name, { type: blob.type }));
      }
      if(file.blob) openFile(file.blob);
    },
    async drop(files) { for(const f of files) await openFile(f); },
    keys(e) {
      if(/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
      const k = e.key.toLowerCase();
      if(e.key === ' ') { spaceDown = true; if(st.tab === 'animate') { e.preventDefault(); st.play.on = !st.play.on; st.play.t0 = performance.now(); drawPanels(); } return; }
      if((e.key === 'Delete' || e.key === 'Backspace') && st.tab === 'slice' && st.sel.size) {
        e.preventDefault();
        const drop = [...st.sel].sort((a, b) => b - a);
        for(const i of drop) {
          st.frames.splice(i, 1);
          st.anims.forEach(a => { a.frames = a.frames.filter(x => x !== i).map(x => (x > i ? x - 1 : x)); });
        }
        st.sel.clear(); drawAll(); persist();
      }
      if(k === 'n' && st.tab === 'slice' && st.sheet) { newMode = true; $.querySelector('.ea-main').classList.add('drawing'); }
      if(k === 'a' && (e.ctrlKey || e.metaKey) && st.tab === 'slice') { e.preventDefault(); st.sel = new Set(st.frames.map((_, i) => i)); drawAll(); }
      if(st.tab === 'map' && !e.ctrlKey) { const t = { b: 'brush', r: 'rect', f: 'fill', e: 'erase' }[k]; if(t) { st.paint.tool = t; drawMapPanel(); } }
      if(k === '1' && e.shiftKey) { fitView(); drawSheet(); }
    },
  });
})();
