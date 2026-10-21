// SVG drawing of board items and links, shared by the page (rendering, export) and the CLI (render).
// Pure strings: no DOM. Widgets draw their own picture through the `widget` callback of board().
DAE_CORE(DAE => {
  const FONT = 'Segoe UI, system-ui, sans-serif';
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  class Draw {
    //#region [ Items ]
    static stroke(it) {
      const p = it.points;
      if(p.length < 4) return `<circle cx="${p[0]}" cy="${p[1]}" r="${it.width / 2}" fill="${it.color}"/>`;
      // midpoint quadratic smoothing
      let d = `M${p[0]} ${p[1]}`;
      for(let i = 2; i + 3 < p.length; i += 2) d += ` Q${p[i]} ${p[i + 1]} ${(p[i] + p[i + 2]) / 2} ${(p[i + 1] + p[i + 3]) / 2}`;
      d += ` L${p[p.length - 2]} ${p[p.length - 1]}`;
      const path = (c, w) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
      return (it.border ? path(it.border, it.width + 5) : '') + path(it.color, it.width);
    }

    /** Outline path of a box shape in a w x h box, inset by `i` (the half stroke); null for rect / ellipse. */
    static shapePath(shape, w, h, i) {
      const P = pts => 'M' + pts.map(p => `${p[0]} ${p[1]}`).join('L') + 'Z';
      switch(shape) {
        case 'diamond': return P([[w / 2, i], [w - i, h / 2], [w / 2, h - i], [i, h / 2]]);
        case 'triangle': return P([[w / 2, i], [w - i, h - i], [i, h - i]]);
        case 'hexagon': return P([[w * 0.25, i], [w * 0.75, i], [w - i, h / 2], [w * 0.75, h - i], [w * 0.25, h - i], [i, h / 2]]);
        case 'parallelogram': return P([[w * 0.22, i], [w - i, i], [w * 0.78, h - i], [i, h - i]]);
        case 'star': {
          const pts = [], cx = w / 2, cy = h / 2 + h * 0.04, rx = w / 2 - i, ry = h / 2 - i;
          for(let k = 0; k < 10; k++) {
            const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 0.42 : 1;
            pts.push([cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r]);
          }
          return P(pts);
        }
        case 'cylinder': {
          const ry = Math.min(h * 0.14, w * 0.25);
          return `M${i} ${ry + i}A${w / 2 - i} ${ry} 0 0 1 ${w - i} ${ry + i}L${w - i} ${h - ry - i}A${w / 2 - i} ${ry} 0 0 1 ${i} ${h - ry - i}Z`
            + `M${i} ${ry + i}A${w / 2 - i} ${ry} 0 0 0 ${w - i} ${ry + i}`;
        }
        case 'bubble': {
          const r = Math.min(10, w / 6, h / 6), b = h * 0.78, tx = w * 0.22;
          return `M${i + r} ${i}L${w - i - r} ${i}Q${w - i} ${i} ${w - i} ${i + r}L${w - i} ${b - r}Q${w - i} ${b} ${w - i - r} ${b}`
            + `L${tx + w * 0.12} ${b}L${tx - w * 0.02} ${h - i}L${tx} ${b}L${i + r} ${b}Q${i} ${b} ${i} ${b - r}L${i} ${i + r}Q${i} ${i} ${i + r} ${i}Z`;
        }
      }
      return null;
    }

    /** A box shape in a w x h box (stroke kept inside), with its border as a casing behind. */
    static shape(it) {
      const sw = it.width ?? 2, h2 = sw / 2, w = it.w, h = it.h;
      const fill = it.fill === 'solid' ? it.color : it.fill === 'tint' ? `${it.color}33` : 'none';
      const one = (f, c, s) => {
        const a = `fill="${f}" stroke="${c}" stroke-width="${s}" stroke-linejoin="round"`;
        if(it.shape === 'ellipse') return `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${Math.max(0, w / 2 - h2)}" ry="${Math.max(0, h / 2 - h2)}" ${a}/>`;
        const d = Draw.shapePath(it.shape, w, h, h2);
        if(d) return `<path d="${d}" ${a}/>`;
        return `<rect x="${h2}" y="${h2}" width="${Math.max(0, w - sw)}" height="${Math.max(0, h - sw)}" rx="6" ${a}/>`;
      };
      return (it.border ? one('none', it.border, sw + 5) : '') + one(fill, it.color, sw);
    }

    /** Line / arrow relative to (bx, by): straight, with a sharp middle corner, or curved through it. Returns inner markup. */
    static line(it, bx, by) {
      const B = DAE.Board, sw = it.width ?? 2, P = p => ({ x: p.x - bx, y: p.y - by });
      const a = P({ x: it.x1, y: it.y1 }), b = P({ x: it.x2, y: it.y2 });
      let d = `M${a.x} ${a.y}L${b.x} ${b.y}`, from = a;   // `from`: where the last stretch comes from (arrow head angle)
      if(it.mx != null) {
        if(it.curve) { const c = P(B.ctrl(it)); d = `M${a.x} ${a.y}Q${c.x} ${c.y} ${b.x} ${b.y}`; from = c; }
        else { const m = P(B.mid(it)); d = `M${a.x} ${a.y}L${m.x} ${m.y}L${b.x} ${b.y}`; from = m; }
      }
      let head = '';
      if(it.shape === 'arrow') {
        const ang = Math.atan2(b.y - from.y, b.x - from.x), L = 8 + sw * 3;
        const p = s => `${b.x - L * Math.cos(ang + s)} ${b.y - L * Math.sin(ang + s)}`;
        head = `<path d="M${p(0.45)}L${b.x} ${b.y}L${p(-0.45)}" fill="none" stroke="${it.color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
      }
      return `<path d="${d}" fill="none" stroke="${it.color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>${head}`;
    }

    /** Items whose border is an outline around their box (shapes and strokes draw it as a casing, text as an underline, lines have none). */
    static boxed(it) {
      return it.kind !== 'stroke' && it.kind !== 'shape' && it.kind !== 'text';
    }
    //#endregion

    //#region [ Links ]
    /** Cubic path between two items' facing sides: { d, mid, end, ang }. */
    static edgeGeom(A, B) {
      const Bd = DAE.Board, [sa, sb] = Bd.sides(A, B), p = Bd.side(A, sa), q = Bd.side(B, sb);
      const n = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };
      const k = Math.max(40, Math.hypot(q.x - p.x, q.y - p.y) / 3);
      const c1 = { x: p.x + n[sa][0] * k, y: p.y + n[sa][1] * k }, c2 = { x: q.x + n[sb][0] * k, y: q.y + n[sb][1] * k };
      const mid = { x: (p.x + 3 * c1.x + 3 * c2.x + q.x) / 8, y: (p.y + 3 * c1.y + 3 * c2.y + q.y) / 8 };
      return { d: `M${p.x} ${p.y}C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${q.x} ${q.y}`, mid, end: q, ang: Math.atan2(q.y - c2.y, q.x - c2.x) };
    }

    static edges(b, sel = 0) {
      const out = [];
      for(const e of b.edges) {
        const A = DAE.Board.find(b, e.from), B = DAE.Board.find(b, e.to);
        if(!A || !B) continue;
        const g = Draw.edgeGeom(A, B), col = e.id === sel ? '#8BE9FD' : e.color || '#A3A3A3';
        const L = 10, p = s => `${g.end.x - L * Math.cos(g.ang + s)} ${g.end.y - L * Math.sin(g.ang + s)}`;
        out.push(`<g data-edge="${e.id}"><path class="hit" d="${g.d}" fill="none" stroke="none"/><path d="${g.d}" fill="none" stroke="${col}" stroke-width="2"/>`
          + `<path d="M${p(0.5)}L${g.end.x} ${g.end.y}L${p(-0.5)}" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`);
        if(e.label) {
          const w = e.label.length * 7 + 14;
          out.push(`<rect x="${g.mid.x - w / 2}" y="${g.mid.y - 11}" width="${w}" height="22" rx="4" fill="#212121"/><text x="${g.mid.x}" y="${g.mid.y + 4}" text-anchor="middle" font-size="12" fill="${col}" font-family="${FONT}">${esc(e.label)}</text>`);
        }
        out.push('</g>');
      }
      return out.join('');
    }
    //#endregion

    //#region [ Whole board ]
    static wrap(text, size, width) {
      const max = Math.max(4, Math.floor(width / (size * 0.55))), out = [];
      for(const para of String(text).split('\n')) {
        let line = '';
        for(const word of para.split(' ')) {
          if((line + ' ' + word).trim().length > max && line) { out.push(line); line = word; }
          else line = (line + ' ' + word).trim();
        }
        out.push(line);
      }
      return out;
    }

    static text(lines, x, y, size, color, lh = 1.3, anchor = 'start') {
      return `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" text-anchor="${anchor}" font-family="${FONT}">`
        + lines.map((l, i) => `<tspan x="${x}" dy="${i ? size * lh : 0}">${esc(l) || ' '}</tspan>`).join('') + '</text>';
    }

    /**
     * Standalone SVG of items (all by default) and the links between them.
     * @param {object} o - widget(it, w, h): inner picture of a widget window (default: none)
     */
    static board(b, items = b.items, o = {}) {
      const Bd = DAE.Board, box = Bd.bounds(items) ?? { x: 0, y: 0, w: 100, h: 100 }, pad = 40;
      const vx = box.x - pad, vy = box.y - pad, W = Math.ceil(box.w + pad * 2), H = Math.ceil(box.h + pad * 2);
      const ids = new Set(items.map(i => i.id)), out = [];
      out.push(Draw.edges({ ...b, edges: b.edges.filter(e => ids.has(e.from) && ids.has(e.to)) }, 0));
      for(const it of Bd.ordered(b).filter(i => ids.has(i.id))) {
        out.push(Draw.#item(b, it, o));
        if(it.border && Draw.boxed(it)) out.push(`<rect x="${it.x - 1}" y="${it.y - 1}" width="${it.w + 2}" height="${it.h + 2}" rx="${['note', 'widget', 'group'].includes(it.kind) ? 7 : 2}" fill="none" stroke="${it.border}" stroke-width="2"/>`);
      }
      const sprite = DAE.Icons ? DAE.Icons.sprite.replace(/^<svg[^>]*>|<\/svg>$/g, '') : '';
      return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="${vx} ${vy} ${W} ${H}">`
        + `<defs>${sprite}</defs><rect x="${vx}" y="${vy}" width="${W}" height="${H}" fill="#212121"/>${out.join('')}</svg>`;
    }

    static #item(b, it, o) {
      const g = c => `<g transform="translate(${it.x} ${it.y})">${c}</g>`;
      switch(it.kind) {
        case 'stroke':
          return `<svg x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" viewBox="0 0 ${it.vw || 1} ${it.vh || 1}" preserveAspectRatio="none" overflow="visible">${Draw.stroke(it)}</svg>`;
        case 'shape': {
          if(DAE.Board.isLine(it)) return `<g>${Draw.line(it, 0, 0)}</g>`;
          const size = it.size ?? 20, lines = it.text ? Draw.wrap(it.text, size, it.w - 12) : [];
          const ty = it.h / 2 - (lines.length - 1) * size * 1.3 / 2 + size * 0.35;
          return g(Draw.shape(it) + (lines.length ? Draw.text(lines, it.w / 2, ty, size, it.color, 1.3, 'middle') : ''));
        }
        case 'text': {
          const size = it.size ?? 20, lines = String(it.text ?? '').split('\n');
          const under = it.border ? lines.map((l, k) => `<rect x="0" y="${size * 0.95 + k * size * 1.3 + size * 0.2}" width="${l.length * size * 0.55}" height="2" fill="${it.border}"/>`).join('') : '';
          return g(Draw.text(lines, 0, size * 0.95, size, it.color) + under);
        }
        case 'note': {
          let y = 24, body = '';
          for(const l of DAE.Markdown.plain(it.md)) {
            const size = l.head ? [0, 20, 17, 15, 14][l.head] : 13;
            const lines = Draw.wrap(l.text, size, it.w - 28);
            if(y + size > it.h - 6) break;
            body += Draw.text(lines, 14, y, size, l.head ? '#FFFFFF' : '#A3A3A3', 1.45);
            y += lines.length * size * 1.45 + (l.head ? 4 : 0);
          }
          const tint = it.color ? `<rect width="${it.w}" height="3" fill="${it.color}"/>` : '';
          return g(`<svg width="${it.w}" height="${it.h}"><rect width="${it.w}" height="${it.h}" rx="6" fill="#1A1A1A"/>${tint}${body}</svg>`);
        }
        case 'image': {
          const a = DAE.Board.asset(b, it.asset);
          return `<image x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" href="${a ? `data:${a.mime};base64,${a.data}` : ''}" preserveAspectRatio="xMidYMid meet"/>`;
        }
        case 'group': {
          const c = it.color || '#8BE9FD';
          return g(`<rect width="${it.w}" height="${it.h}" rx="6" fill="${c}" fill-opacity="0.09"/><rect y="-26" width="${Math.min(it.w, (it.label || 'Group').length * 8 + 16)}" height="22" rx="4" fill="${c}" fill-opacity="0.3"/>`
            + Draw.text([it.label || 'Group'], 8, -10, 13, '#FFFFFF'));
        }
        case 'widget': {
          const inner = o.widget?.(it, it.w, it.h) ?? '';
          return g(`<svg width="${it.w}" height="${it.h}"><rect width="${it.w}" height="${it.h}" rx="6" fill="#1A1A1A"/><rect width="${it.w}" height="30" fill="#101010"/>`
            + `${Draw.text([it.name || it.tool], 12, 19, 12, '#FFFFFF')}${inner}</svg>`);
        }
      }
      return '';
    }
    //#endregion
  }

  DAE.Draw = Draw;
});
