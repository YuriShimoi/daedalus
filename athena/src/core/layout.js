// Deterministic force layout (adapted): BFS-level start positions,
// repulsion + springs + a pull toward the level column, then an overlap pass, then each room snaps to an
// even lattice (one cell per link, nearest free cell on a clash, empty rows and columns dropped). Same map, same picture.
DAE_CORE(DAE => {
  class Layout {
    static GAP = 120; // target distance between linked rooms in the force pass
    static CELL = 120; // lattice step of the final picture (a multiple of the editor's 40 snap; room for badges and lock marks)

    /**
     * Positions for a map file: the saved room x,y where present, the automatic layout for the rest (all of them
     * with all: true). Shifted so the top-left room sits one cell in, like run().
     * @returns {{pos: Map<string, {x, y}>, width, height}}
     */
    static place(model, { all = false, ...opts } = {}) {
      const pos = new Map(Layout.run(model, opts).pos);
      if(!all) for(const r of model.rooms) if(r.x != null && r.y != null) pos.set(r.id, { x: r.x, y: r.y });
      if(!pos.size) return { pos, width: 0, height: 0 };
      const pts = [...pos.values()];
      const dx = Layout.CELL - Math.min(...pts.map(p => p.x)), dy = Layout.CELL - Math.min(...pts.map(p => p.y));
      for(const [id, p] of pos) pos.set(id, { x: p.x + dx, y: p.y + dy });
      return {
        pos,
        width: Math.max(...pts.map(p => p.x)) + dx + Layout.CELL,
        height: Math.max(...pts.map(p => p.y)) + dy + Layout.CELL,
      };
    }

    /** @returns {{pos: Map<string, {x, y}>, width, height}} */
    static run(model, { iterations = 300, seed = 1 } = {}) {
      const rooms = model.rooms.map(r => r.id);
      const n = rooms.length;
      const pos = new Map();
      if(!n) return { pos, width: 0, height: 0 };
      const index = new Map(rooms.map((id, i) => [id, i]));
      const links = model.passages.filter(g => index.has(g.a) && index.has(g.b) && g.a !== g.b)
        .map(g => [index.get(g.a), index.get(g.b)]);

      // levels from the entry (undirected); unreachable rooms go one level past the deepest
      const adj = rooms.map(() => []);
      links.forEach(([a, b]) => { adj[a].push(b); adj[b].push(a); });
      const level = new Array(n).fill(-1);
      const start = Math.max(0, model.rooms.findIndex(r => r.entry));
      level[start] = 0;
      const queue = [start];
      while(queue.length) {
        const i = queue.shift();
        for(const j of adj[i]) if(level[j] < 0) { level[j] = level[i] + 1; queue.push(j); }
      }
      const deepest = Math.max(0, ...level);
      level.forEach((l, i) => { if(l < 0) level[i] = deepest + 1; });

      const rng = new DAE.Rng(seed);
      const byLevel = new Map();
      level.forEach((l, i) => (byLevel.get(l) ?? byLevel.set(l, []).get(l)).push(i));
      const x = new Float64Array(n), y = new Float64Array(n);
      for(const [l, list] of byLevel) list.forEach((i, k) => {
        x[i] = l * Layout.GAP + rng.next();
        y[i] = (k - (list.length - 1) / 2) * Layout.GAP + rng.next();
      });

      const vx = new Float64Array(n), vy = new Float64Array(n);
      for(let it = 0; it < iterations; it++) {
        const heat = 1 - it / iterations;
        vx.fill(0); vy.fill(0);
        for(let i = 0; i < n; i++) for(let j = i + 1; j < n; j++) {
          let dx = x[i] - x[j], dy = y[i] - y[j];
          let d2 = dx * dx + dy * dy;
          if(d2 < 1) { dx = 1; dy = 0; d2 = 1; }
          if(d2 > 9 * Layout.GAP * Layout.GAP) continue;
          const f = Layout.GAP * Layout.GAP / d2;
          vx[i] += dx * f * 0.08; vy[i] += dy * f * 0.08;
          vx[j] -= dx * f * 0.08; vy[j] -= dy * f * 0.08;
        }
        for(const [a, b] of links) {
          const dx = x[b] - x[a], dy = y[b] - y[a];
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const f = (d - Layout.GAP) / d * 0.1;
          vx[a] += dx * f; vy[a] += dy * f;
          vx[b] -= dx * f; vy[b] -= dy * f;
        }
        for(let i = 0; i < n; i++) {
          vx[i] += (level[i] * Layout.GAP - x[i]) * 0.02; // keep the entry-to-exit flow left to right
          const step = Math.min(Layout.GAP * 0.4 * heat + 2, Math.hypot(vx[i], vy[i]));
          const len = Math.hypot(vx[i], vy[i]) || 1;
          x[i] += vx[i] / len * step;
          y[i] += vy[i] / len * step;
        }
      }

      // overlap pass: no two rooms closer than 0.75 GAP
      const min = Layout.GAP * 0.75;
      for(let pass = 0; pass < 50; pass++) {
        let moved = false;
        for(let i = 0; i < n; i++) for(let j = i + 1; j < n; j++) {
          const dx = x[j] - x[i], dy = y[j] - y[i];
          const d = Math.hypot(dx, dy);
          if(d >= min) continue;
          const push = (min - d) / 2 + 0.5;
          const ux = d ? dx / d : 1, uy = d ? dy / d : 0;
          x[i] -= ux * push; y[i] -= uy * push;
          x[j] += ux * push; y[j] += uy * push;
          moved = true;
        }
        if(!moved) break;
      }

      // lattice: a link of GAP becomes one cell; rooms take cells in BFS order, a taken cell sends the room
      // to the nearest free one (by distance to its spot), so rows and columns line up and the map stays compact
      const gx = new Int32Array(n), gy = new Int32Array(n);
      const taken = new Set();
      const order = [...Array(n).keys()].sort((a, b) => level[a] - level[b] || a - b);
      for(const i of order) {
        const fx = x[i] / Layout.GAP, fy = y[i] / Layout.GAP;
        let best = null;
        for(let r = 0; !best; r++) {
          for(let cx = Math.round(fx) - r; cx <= Math.round(fx) + r; cx++) for(let cy = Math.round(fy) - r; cy <= Math.round(fy) + r; cy++) {
            if(taken.has(cx + ',' + cy)) continue;
            const d = (cx - fx) ** 2 + (cy - fy) ** 2;
            if(!best || d < best.d) best = { cx, cy, d };
          }
        }
        taken.add(best.cx + ',' + best.cy);
        gx[i] = best.cx; gy[i] = best.cy;
      }

      // drop empty rows and columns, so long links shrink and the map stays tight
      const squeeze = g => {
        const used = [...new Set(g)].sort((a, b) => a - b);
        const at = new Map(used.map((v, k) => [v, k]));
        for(let i = 0; i < n; i++) g[i] = at.get(g[i]);
      };
      squeeze(gx);
      squeeze(gy);

      const minX = Math.min(...gx), minY = Math.min(...gy);
      const pad = Layout.CELL;
      rooms.forEach((id, i) => pos.set(id, { x: (gx[i] - minX) * Layout.CELL + pad, y: (gy[i] - minY) * Layout.CELL + pad }));
      return {
        pos,
        width: (Math.max(...gx) - minX) * Layout.CELL + pad * 2,
        height: (Math.max(...gy) - minY) * Layout.CELL + pad * 2,
      };
    }
  }

  DAE.Layout = Layout;
});
