// Snapping for editors: a moved box snaps to other boxes' edges and centers (with guide lines to draw),
// else to a grid; a single coordinate (a dragged edge) snaps the same way. Pure math, no DOM.
// Boxes are { x, y, w, h } (w = h = 0 for points, e.g. graph nodes).
(DAE => {
  const AX = { x: ['x', 'w', 'y', 'h'], y: ['y', 'h', 'x', 'w'] };

  class Snap {
    /**
     * Offset that snaps a box moved by `raw`: { off: { x, y }, guides: [{ ax, at, lo, hi }] }.
     * Per axis: the nearest edge / center of a target within `tol`, else the grid (grid 0: none).
     */
    static move(box, raw, targets, { tol = 7, grid = 24 } = {}) {
      const b = { x: box.x + raw.x, y: box.y + raw.y, w: box.w, h: box.h }, off = { ...raw }, guides = [];
      for(const ax of ['x', 'y']) {
        const [p, sz, cross, csz] = AX[ax], mine = [b[p], b[p] + b[sz] / 2, b[p] + b[sz]];
        let best = null;
        for(const o of targets) for(const t of [o[p], o[p] + o[sz] / 2, o[p] + o[sz]]) for(const m of mine) {
          const d = t - m;
          if(Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, t, o };
        }
        if(best) {
          off[ax] += best.d;
          guides.push(Snap.#guide(ax, best.t, b, best.o, cross, csz));
        }
        else if(grid) off[ax] += Math.round(b[p] / grid) * grid - b[p];
      }
      return { off, guides };
    }

    /** One coordinate on axis 'x' or 'y' (`box` gives the guide's extent): { v, guide | null }. */
    static value(v, ax, targets, box, { tol = 7, grid = 24 } = {}) {
      const [p, sz, cross, csz] = AX[ax];
      let best = null;
      for(const o of targets) for(const t of [o[p], o[p] + o[sz] / 2, o[p] + o[sz]]) if(Math.abs(t - v) <= tol && (!best || Math.abs(t - v) < Math.abs(best.t - v))) best = { t, o };
      if(!best) return { v: grid ? Math.round(v / grid) * grid : v, guide: null };
      return { v: best.t, guide: Snap.#guide(ax, best.t, box, best.o, cross, csz) };
    }

    static #guide(ax, at, a, b, cross, csz) {
      return { ax, at, lo: Math.min(a[cross], b[cross]), hi: Math.max(a[cross] + a[csz], b[cross] + b[csz]) };
    }
  }

  DAE.Snap = Snap;
})(globalThis.DAE ??= {});
if(typeof module === 'object') module.exports = globalThis.DAE;
