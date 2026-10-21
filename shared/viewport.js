// Pan / zoom math for a 2D view, on a plain { x, y, zoom } object (x, y: world point at the top-left
// of the element; zoom: screen px per world unit), so it can live inside a saved document.
// `r` is the element's client rect (getBoundingClientRect()).
(DAE => {
  class View {
    static make(x = 0, y = 0, zoom = 1) {
      return { x, y, zoom };
    }

    /** Client point -> world point. */
    static toWorld(v, r, cx, cy) {
      return { x: (cx - r.left) / v.zoom + v.x, y: (cy - r.top) / v.zoom + v.y };
    }

    /** World point -> client point. */
    static toScreen(v, r, wx, wy) {
      return { x: (wx - v.x) * v.zoom + r.left, y: (wy - v.y) * v.zoom + r.top };
    }

    /** World box seen by the element. */
    static box(v, r) {
      return { x: v.x, y: v.y, w: r.width / v.zoom, h: r.height / v.zoom };
    }

    /** Zooms by `f` keeping the world point under client (cx, cy) in place (the center when omitted). */
    static zoomAt(v, r, f, cx = r.left + r.width / 2, cy = r.top + r.height / 2, min = 0.05, max = 8) {
      const before = View.toWorld(v, r, cx, cy);
      v.zoom = Math.min(max, Math.max(min, v.zoom * f));
      const after = View.toWorld(v, r, cx, cy);
      v.x += before.x - after.x;
      v.y += before.y - after.y;
      return v;
    }

    /** Pans by a client-pixel drag. */
    static pan(v, dx, dy) {
      v.x -= dx / v.zoom;
      v.y -= dy / v.zoom;
      return v;
    }

    /** Fits a world box with `pad` client px around it (zoom capped at `max`). */
    static fit(v, r, box, { pad = 60, min = 0.05, max = 2 } = {}) {
      const w = Math.max(1, box.w), h = Math.max(1, box.h);
      v.zoom = Math.min(max, Math.max(min, Math.min((r.width - pad * 2) / w, (r.height - pad * 2) / h)));
      return View.center(v, r, box.x + box.w / 2, box.y + box.h / 2);
    }

    /** Puts a world point at the middle of the element. */
    static center(v, r, wx, wy) {
      v.x = wx - r.width / 2 / v.zoom;
      v.y = wy - r.height / 2 / v.zoom;
      return v;
    }
  }

  DAE.View = View;
})(globalThis.DAE ??= {});
if(typeof module === 'object') module.exports = globalThis.DAE;
