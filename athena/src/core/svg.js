// SVG picture of a map (used by `athena render` and by the page's graph view).
// Rooms and passages carry data-room / data-passage so the page can hit-test them.
DAE_CORE(DAE => {
  const C = {
    bg: '#1A1A1A', raised: '#212121', line: '#44475A', text: '#FFFFFF', text2: '#A3A3A3', muted: '#6F7676',
    accent: '#F4B740', cyan: '#8BE9FD', green: '#50FA7B', red: '#FF5555', yellow: '#F1FA8C', orange: '#FFB86C', pink: '#FF79C6', purple: '#BD93F9',
  };
  const KEY_COLORS = [C.pink, C.purple, C.orange, C.green, C.yellow, C.cyan, C.red];
  const NAMED = { red: C.red, blue: C.purple, green: C.green, gold: C.yellow, yellow: C.yellow, pink: C.pink, orange: C.orange, cyan: C.cyan };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const R = 24;

  class Svg {
    static C = C;

    /** A stable color for a key color name. */
    static keyColor(name) {
      return NAMED[name] ?? KEY_COLORS[DAE.Rng.hash(name) % KEY_COLORS.length];
    }

    /**
     * @param {object} opts - layout, route (action strings), state (rules state for playback),
     *   selected (room or passage id), marks (Set of ids to flag), standalone (embed icon symbols)
     */
    static render(model, opts = {}) {
      const L = opts.layout ?? DAE.Layout.place(model);
      const P = id => L.pos.get(id) ?? { x: 0, y: 0 };
      const used = new Set();
      const icon = (name, x, y, size, color) => {
        used.add(name);
        return `<use href="#i-${name}" x="${x}" y="${y}" width="${size}" height="${size}" fill="${color}"/>`;
      };
      const s = opts.state;
      const marks = opts.marks ?? new Set();
      const out = [];

      // route: rooms in visit order and the passages walked
      const routeRooms = [], walked = new Set();
      if(opts.route) {
        let at = model.rooms.find(r => r.entry)?.id;
        routeRooms.push(at);
        for(const step of opts.route) {
          const m = step.match(/^move (\S+)/);
          if(!m) continue;
          const g = model.passages.find(x => (x.a === at && x.b === m[1]) || (x.b === at && x.a === m[1] && x.dir === 'both'));
          if(g) walked.add(g.id);
          at = m[1];
          routeRooms.push(at);
        }
      }

      //#region [ Passages ]
      for(const g of model.passages) {
        if(!L.pos.has(g.a) || !L.pos.has(g.b)) continue;
        const a = P(g.a), b = P(g.b);
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
        const ux = dx / d, uy = dy / d;
        const x1 = a.x + ux * R, y1 = a.y + uy * R, x2 = b.x - ux * (R + (g.dir === 'a>b' ? 4 : 0)), y2 = b.y - uy * (R + (g.dir === 'a>b' ? 4 : 0));
        const key = g.lock.find(c => c.t === 'key');
        const color = key ? Svg.keyColor(key.v) : C.line;
        const dash = g.lock.some(c => c.t === 'kill') ? ' stroke-dasharray="7 5"' : '';
        const sel = opts.selected === g.id;
        const isOpen = s && s.opened.includes(g.id), sealed = s && s.sealed.includes(g.id);
        out.push(`<g class="passage" data-passage="${esc(g.id)}">`);
        out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="transparent" stroke-width="14"/>`);
        if(walked.has(g.id)) out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${C.accent}" stroke-width="8" stroke-opacity=".35" stroke-linecap="round"/>`);
        out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${sel ? C.accent : color}" stroke-width="${sel ? 4 : 3}"${dash}${g.dir === 'a>b' ? ' marker-end="url(#dae-arrow)"' : ''}/>`);
        if(g.lock.length) {
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          const ring = marks.has(g.id) ? C.red : sealed ? C.red : color;
          out.push(`<circle cx="${mx}" cy="${my}" r="11" fill="${C.raised}" stroke="${ring}" stroke-width="${marks.has(g.id) ? 3 : 1.5}"/>`);
          out.push(icon(isOpen && !sealed ? 'lock-open' : 'lock', mx - 6, my - 6, 12, color));
        }
        out.push('</g>');
      }
      //#endregion

      //#region [ Rooms ]
      const hasEvents = new Set(model.events.map(e => e.room));
      model.rooms.forEach(r => {
        const { x, y } = P(r.id);
        const here = s?.room === r.id;
        const foes = s ? (s.foes[r.id] ?? []) : r.enemies;
        const itemIds = s ? (s.floor[r.id] ?? []).map(e => e.id) : r.items;
        const chests = r.chests.filter(c => !s?.looted.includes(c)).length;
        const ring = r.entry ? C.green : r.exit ? C.red : null;
        out.push(`<g class="room${here ? ' here' : ''}" data-room="${esc(r.id)}">`);
        if(here) out.push(`<circle class="pulse" cx="${x}" cy="${y}" r="${R + 8}" fill="none" stroke="${C.accent}" stroke-width="2"/>`);
        if(r.mark === 'required') out.push(`<circle cx="${x}" cy="${y}" r="${R + 5}" fill="none" stroke="${C.yellow}" stroke-width="2" stroke-dasharray="4 3"/>`);
        if(marks.has(r.id)) out.push(`<circle cx="${x}" cy="${y}" r="${R + 5}" fill="none" stroke="${C.red}" stroke-width="3"/>`);
        const fill = opts.selected === r.id ? C.line : (s && s.visits[r.id] ? '#2A2A2A' : C.raised);
        // entry/exit ring wins; otherwise the selection color, or a plain border so rooms show on any background
        const stroke = ring ?? (opts.selected === r.id ? C.accent : C.muted);
        out.push(`<circle cx="${x}" cy="${y}" r="${R}" fill="${fill}" stroke="${stroke}" stroke-width="${ring || opts.selected === r.id ? 3 : 2}"/>`);
        out.push(`<text x="${x}" y="${y + 4.5}" text-anchor="middle" font-size="13" font-weight="600" fill="${C.text}">${esc(r.id)}</text>`);
        if(r.mark === 'important') out.push(icon('star', x + R - 10, y - R - 2, 13, C.yellow));
        if(hasEvents.has(r.id)) out.push(icon('bolt', x - R - 2, y - R - 2, 13, C.orange));

        // token badges under the room
        const badges = [];
        if(foes.length) {
          const waves = new Set(foes.map(f => f.wave)).size;
          badges.push(['skull', C.red, foes.length + (waves > 1 ? `·${waves}w` : '')]);
        }
        // key items get a key badge in their key color (one per color, count when more than one)
        const keys = new Map();
        let plain = 0;
        for(const id of itemIds) {
          const k = model.items.find(t => t.id === id)?.key;
          if(k) keys.set(k, (keys.get(k) ?? 0) + 1);
          else plain++;
        }
        if(plain) badges.push(['gem', C.accent, plain]);
        for(const [k, n] of keys) badges.push(['key', Svg.keyColor(k), n > 1 ? n : '']);
        if(chests) badges.push(['chest', C.orange, chests]);
        if(r.builders.length) badges.push(['hammer', C.purple, r.builders.length]);
        const widths = badges.map(([, , t]) => t === '' ? 20 : 22 + String(t).length * 6.5);
        let bx = x - (widths.reduce((a, b) => a + b, 0) + (badges.length - 1) * 3) / 2;
        badges.forEach(([name, color, t], i) => {
          const w = widths[i], by = y + R + 5;
          out.push(`<rect x="${bx}" y="${by}" width="${w}" height="16" rx="8" fill="${C.raised}"/>`);
          out.push(icon(name, bx + 5, by + 3, 10, color));
          out.push(`<text x="${bx + 18}" y="${by + 12}" font-size="11" fill="${C.text2}">${esc(t)}</text>`);
          bx += w + 3;
        });
        out.push('</g>');
      });
      //#endregion

      // first-visit order numbers along the route
      const order = [];
      routeRooms.forEach(id => { if(id && !order.includes(id)) order.push(id); });
      order.forEach((id, i) => {
        const { x, y } = P(id);
        out.push(`<g class="step"><circle cx="${x + R - 2}" cy="${y + R - 6}" r="9" fill="${C.accent}"/><text x="${x + R - 2}" y="${y + R - 2}" text-anchor="middle" font-size="10" font-weight="700" fill="${C.bg}">${i + 1}</text></g>`);
      });

      let defs = `<marker id="dae-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${C.text2}"/></marker>`;
      if(opts.standalone && DAE.Icons) {
        for(const name of used) {
          const m = DAE.Icons.sprite.match(new RegExp(`<symbol id="i-${name}"[^>]*>.*?</symbol>`));
          if(m) defs += m[0];
        }
      }
      const bg = opts.standalone ? `<rect width="100%" height="100%" fill="${C.bg}"/>` : '';
      return `<svg xmlns="http://www.w3.org/2000/svg" class="dae-map" viewBox="0 0 ${L.width} ${L.height}" width="${L.width}" height="${L.height}" font-family="Segoe UI, system-ui, sans-serif"><defs>${defs}</defs>${bg}${out.join('')}</svg>`;
    }
  }

  DAE.Svg = Svg;
});
