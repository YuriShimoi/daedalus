// Board drawing: one element per item (kept between renders, rebuilt only when its content changes,
// so widgets keep playing), the edges layer, the selection overlay and the view transform + grid.
class Render {
  static #els = new Map();    // id -> { el, sig }
  static flash = 0;           // search hit to outline

  static reset() {
    for(const { el } of Render.#els.values()) el.remove();
    Render.#els.clear();
  }

  static el(id) {
    return Render.#els.get(id)?.el ?? null;
  }

  static all() {
    const b = App.b, $items = document.getElementById('items'), seen = new Set();
    Board.ordered(b).forEach((it, i) => {
      seen.add(it.id);
      let rec = Render.#els.get(it.id);
      if(!rec) {
        rec = { el: document.createElement('div'), sig: null };
        rec.el.dataset.id = it.id;
        Render.#els.set(it.id, rec);
      }
      const el = rec.el;
      if(el.parentNode !== $items || $items.children[i] !== el) $items.insertBefore(el, $items.children[i] ?? null);
      el.className = `it k-${it.kind}${it.locked ? ' locked' : ''}`;
      el.style.zIndex = i + 1;
      // border outline and a note's color bar share box-shadow, so they are set together
      el.style.boxShadow = [it.border && Render.boxed(it) ? `0 0 0 2px ${it.border}` : '', it.kind === 'note' && it.color ? `inset 0 3px 0 ${it.color}` : ''].filter(Boolean).join(', ');
      const sig = Render.#sig(it) + '|' + (it.border ?? '');
      if(sig !== rec.sig) {
        rec.sig = sig;
        Render.#content(it, el);
      }
      Render.#place(it, el);
    });
    for(const [id, rec] of Render.#els) {
      if(seen.has(id)) continue;
      Widgets.unmount(id);
      rec.el.remove();
      Render.#els.delete(id);
    }
    Render.edges();
    Render.overlay();
    Render.view();
    document.getElementById('empty').classList.toggle('on', !b.items.length);
  }

  //#region [ Items ]
  static #sig(it) {
    const ed = App.editing === it.id ? 'E' : '';
    switch(it.kind) {
      case 'stroke': return `${it.color}|${it.width}|${it.points.length}|${it.vw}|${it.vh}`;
      case 'shape': return Board.isLine(it) ? `${it.shape}|${it.x1}|${it.y1}|${it.x2}|${it.y2}|${it.mx}|${it.my}|${it.curve}|${it.color}|${it.width}`
        : `${it.shape}|${it.w}|${it.h}|${it.color}|${it.fill}|${it.width}|${it.text ?? ''}|${it.size}|${ed}`;
      case 'text': return `${it.text}|${it.size}|${it.color}|${ed}`;
      case 'note': return `${it.md}|${it.color ?? ''}|${ed}|${App.b.assets.length}`;
      case 'image': return it.asset;
      case 'group': return `${it.label}|${it.color}`;
      case 'widget': return `${it.tool}|${it.asset}|${it.name}`;
    }
    return '';
  }

  /** Items whose border is an outline around their box (shapes, lines and strokes draw it as a casing). */
  static boxed(it) {
    return DAE.Draw.boxed(it);
  }

  static #place(it, el) {
    const s = el.style;
    if(Board.isLine(it)) {
      const pad = 16 + (it.width ?? 2) * 3;
      Object.assign(s, { left: `${it.x - pad}px`, top: `${it.y - pad}px`, width: `${it.w + pad * 2}px`, height: `${it.h + pad * 2}px` });
      return;
    }
    Object.assign(s, { left: `${it.x}px`, top: `${it.y}px`, width: `${it.w}px`, height: `${it.h}px` });
    if(it.kind === 'text' && App.editing !== it.id) {
      // text boxes take the size of their text
      const $t = el.firstChild;
      if($t) { s.width = 'auto'; s.height = 'auto'; it.w = Math.max(8, $t.offsetWidth); it.h = Math.max(8, $t.offsetHeight); }
    }
  }

  static #content(it, el) {
    const esc = DAE.Markdown.esc;
    switch(it.kind) {
      case 'stroke': {
        el.innerHTML = `<svg width="100%" height="100%" viewBox="0 0 ${it.vw || 1} ${it.vh || 1}" preserveAspectRatio="none">${Render.strokePath(it)}</svg>`;
        break;
      }
      case 'shape': {
        if(Board.isLine(it)) { el.innerHTML = Render.lineSvg(it); break; }
        const label = App.editing === it.id ? `<textarea class="editor" style="background:transparent;text-align:center;font:${it.size ?? 20}px/1.3 var(--font);color:${it.color}">${esc(it.text ?? '')}</textarea>`
          : it.text ? `<div class="lb" style="font-size:${it.size ?? 20}px;color:${it.color}">${esc(it.text)}</div>` : '';
        el.innerHTML = `<svg width="${it.w}" height="${it.h}">${Render.shapeSvg(it)}</svg>${label}`;
        break;
      }
      case 'text': {
        el.innerHTML = App.editing === it.id
          ? `<textarea class="editor" style="position:static;width:${Math.max(160, it.w + 40)}px;height:${Math.max(it.h, (it.size ?? 20) * 1.4) + 10}px;padding:0;background:transparent;font:${it.size ?? 20}px/1.3 var(--font);color:${it.color}">${esc(it.text ?? '')}</textarea>`
          : `<div class="tx" style="font-size:${it.size ?? 20}px;color:${it.color}${it.border ? `;text-decoration:underline ${it.border} 2px;text-underline-offset:.18em` : ''}">${esc(it.text || ' ')}</div>`;
        break;
      }
      case 'note': {
        el.innerHTML = App.editing === it.id ? `<textarea class="editor" spellcheck="false">${esc(it.md ?? '')}</textarea>`
          : `<div class="md">${DAE.Markdown.render(it.md, { asset: id => Files.url(id) })}</div>`;
        break;
      }
      case 'image': {
        el.innerHTML = `<img src="${Files.url(it.asset)}" alt="" draggable="false">`;
        break;
      }
      case 'group': {
        el.style.setProperty('--gc', it.color || '#8BE9FD');
        el.innerHTML = `<span class="gl">${esc(it.label || 'Group')}</span>`;
        break;
      }
      case 'widget': {
        if(!el.querySelector('.win-body')) {
          el.innerHTML = `<div class="win-bar" data-drag="1"><img src="${Widgets.icon(it.tool)}" alt=""><b></b></div><div class="win-body"></div><i class="grip" data-grip="1"></i>`;
        }
        el.querySelector('.win-bar b').textContent = it.name || it.tool;
        Widgets.mount(it, el.querySelector('.win-body'));
        break;
      }
    }
    // the editor gets the focus once it is in the page
    const $ed = el.querySelector('.editor');
    if($ed) { $ed.focus({ preventScroll: true }); $ed.setSelectionRange($ed.value.length, $ed.value.length); }
  }

  // the drawing itself lives in core/draw.js (shared with the CLI)
  static strokePath(it) { return DAE.Draw.stroke(it); }
  static shapeSvg(it) { return DAE.Draw.shape(it); }

  /** Line / arrow inside its padded element box. */
  static lineSvg(it) {
    const pad = 16 + (it.width ?? 2) * 3;
    return `<svg width="100%" height="100%">${DAE.Draw.line(it, it.x - pad, it.y - pad)}</svg>`;
  }
  //#endregion

  //#region [ Edges ]
  static edgeGeom(A, B) { return DAE.Draw.edgeGeom(A, B); }
  static edgesSvg(b, sel = 0) { return DAE.Draw.edges(b, sel); }

  static edges() {
    document.getElementById('edges').innerHTML = Render.edgesSvg(App.b, App.edgeSel);
  }
  //#endregion

  //#region [ Overlay, view ]
  static overlay() {
    const out = [], items = App.selected, one = App.one;
    for(const it of items) {
      if(Board.isLine(it) && one) continue;
      out.push(`<div class="sel-box${items.length > 1 ? ' multi' : ''}" style="left:${it.x}px;top:${it.y}px;width:${it.w}px;height:${it.h}px"></div>`);
    }
    if(one && !one.locked && App.editing !== one.id) {
      if(Board.isLine(one)) {
        const m = Board.mid(one);
        out.push(`<i class="hd end" data-end="1" style="left:${one.x1}px;top:${one.y1}px;cursor:move"></i><i class="hd end" data-end="2" style="left:${one.x2}px;top:${one.y2}px;cursor:move"></i>`
          + `<i class="hd mid${one.mx != null ? ' set' : ''}" data-mid="1" title="Drag to bend · double-click: straight" style="left:${m.x}px;top:${m.y}px;cursor:move"></i>`);
      }
      else {
        const { x, y, w, h } = one;
        const H = { nw: [x, y], n: [x + w / 2, y], ne: [x + w, y], e: [x + w, y + h / 2], se: [x + w, y + h], s: [x + w / 2, y + h], sw: [x, y + h], w: [x, y + h / 2] };
        if(one.kind !== 'group') for(const [k, [hx, hy]] of Object.entries(H)) out.push(`<i class="hd" data-hd="${k}" style="left:${hx}px;top:${hy}px;cursor:${k}-resize"></i>`);
        if(one.kind !== 'stroke') {
          const g = 18 / App.view.zoom;
          for(const [k, hx, hy] of [['top', x + w / 2, y - g], ['right', x + w + g, y + h / 2], ['bottom', x + w / 2, y + h + g], ['left', x - g, y + h / 2]])
            out.push(`<i class="dot" data-dot="${k}" title="Drag to link" style="left:${hx}px;top:${hy}px"></i>`);
        }
      }
    }
    const f = Render.flash && Board.find(App.b, Render.flash);
    if(f) out.push(`<div class="hit-flash" style="left:${f.x - 4}px;top:${f.y - 4}px;width:${f.w + 8}px;height:${f.h + 8}px"></div>`);
    document.getElementById('overlay').innerHTML = out.join('');
  }

  static view() {
    const v = App.view, $w = document.getElementById('world'), $b = App.$board;
    $w.style.transform = `scale(${v.zoom}) translate(${-v.x}px, ${-v.y}px)`;
    document.documentElement.style.setProperty('--zi', 1 / v.zoom);
    // dot grid: 24 world units, coarser when it would get dense
    let s = 24 * v.zoom;
    while(s < 12) s *= 4;
    const dot = Math.max(1, Math.min(1.6, v.zoom));
    $b.style.backgroundImage = `radial-gradient(circle, #44475A ${dot}px, transparent ${dot + 0.2}px)`;
    $b.style.backgroundSize = `${s}px ${s}px`;
    $b.style.backgroundPosition = `${-v.x * v.zoom % s - s / 2}px ${-v.y * v.zoom % s - s / 2}px`;
    Panels.zoomLabel();
    if(App.sel.size) Render.overlay();
  }
  //#endregion
}
