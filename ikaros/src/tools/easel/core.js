// Easel core: spritesheet frames (by grid or by islands of opaque pixels), named animations,
// and the exports (TOON / JSON, Aseprite-style JSON, a tight repacked layout).
// frame: { x, y, w, h, name? }   animation: { name, frames: [index], fps, mode: loop|pingpong|once, durations?: {index: ms}, pivot?: {x, y} }
DAE_CORE(DAE => {
  //#region [ Autotile (ported from panda's TilesetConversor) ]
  // 12 x 4 output tiles; each lists its four quarters (TL, TR, BL, BR) as [source quarter, clockwise turns]
  // or null (plain floor). Source quarters come from the border tile: 0 TL, 1 TR, 2 BL, 3 BR.
  const AUTOTILE = [
    [[3, 3], [3, 0], [0, 2], [0, 0]], [[3, 3], [0, 3], [0, 2], [2, 1]], [[0, 3], [0, 3], [2, 2], [2, 1]], [[0, 3], [3, 0], [2, 2], [0, 0]],
    [null, [2, 0], [2, 2], [2, 1]], [[0, 3], [0, 3], [2, 2], null], [[0, 3], [0, 3], null, [2, 1]], [[2, 3], null, [2, 2], [2, 1]],
    [[3, 3], [0, 3], [0, 2], null], [[2, 3], [2, 0], null, null], [[0, 3], [0, 3], null, null], [[0, 3], [3, 0], null, [0, 0]],

    [[0, 2], [0, 0], [0, 2], [0, 0]], [[0, 2], [2, 0], [0, 2], [2, 1]], [[2, 3], [2, 0], [2, 2], [2, 1]], [[2, 3], [0, 0], [2, 2], [0, 0]],
    [[0, 2], [2, 0], [0, 2], null], [[2, 3], null, null, null], [null, [2, 0], null, null], [[2, 3], [0, 0], null, [0, 0]],
    [[0, 2], null, [0, 2], null], [[2, 3], null, null, [2, 1]], [[1, 0], [1, 0], [1, 0], [1, 0]], [null, [2, 0], null, [2, 1]],

    [[0, 2], [0, 0], [3, 2], [3, 1]], [[0, 2], [2, 0], [3, 2], [0, 1]], [[2, 3], [2, 0], [0, 1], [0, 1]], [[2, 3], [0, 0], [0, 1], [3, 1]],
    [[0, 2], null, [0, 2], [2, 1]], [null, null, [2, 2], null], [null, null, null, [2, 1]], [null, [0, 0], [2, 2], [0, 0]],
    [[2, 3], null, [2, 2], null], [null, null, null, null], [null, [2, 0], [2, 2], null], [null, [0, 0], null, [0, 0]],

    [[3, 3], [3, 0], [3, 2], [3, 1]], [[3, 3], [0, 3], [3, 2], [0, 1]], [[0, 3], [0, 3], [0, 1], [0, 1]], [[0, 3], [3, 0], [0, 1], [3, 1]],
    [[2, 3], [2, 0], null, [2, 1]], [[2, 3], null, [0, 1], [0, 1]], [null, [2, 0], [0, 1], [0, 1]], [[2, 3], [2, 0], [2, 2], null],
    [[0, 2], null, [3, 2], [0, 1]], [null, null, [0, 1], [0, 1]], [null, null, [2, 2], [2, 1]], [null, [0, 0], [0, 1], [3, 1]],
  ];
  // [left, top, right, bottom] sides a quarter trims (rotated with it), as in panda
  const BSLICE = { 0: [0, 0, 1, 0], 2: [1, 0, 0, 1], 3: [0, 1, 1, 0] };
  const rotR = (arr, n) => { const a = [...arr]; for(let i = 0; i < ((n % 4) + 4) % 4; i++) a.unshift(a.pop()); return a; };

  class Img {
    constructor(w, h, px = null) { this.w = w; this.h = h; this.px = px ?? new Uint8ClampedArray(w * h * 4); }
    crop(x0, y0, x1, y1) {
      [x0, y0, x1, y1] = [x0, y0, x1, y1].map(Math.round);
      const out = new Img(Math.max(0, x1 - x0), Math.max(0, y1 - y0));
      for(let y = 0; y < out.h; y++) for(let x = 0; x < out.w; x++) {
        const sx = x0 + x, sy = y0 + y;
        if(sx < 0 || sy < 0 || sx >= this.w || sy >= this.h) continue;
        out.px.set(this.px.subarray((sy * this.w + sx) * 4, (sy * this.w + sx) * 4 + 4), (y * out.w + x) * 4);
      }
      return out;
    }
    copy() { return new Img(this.w, this.h, new Uint8ClampedArray(this.px)); }
    /** Clockwise quarter turns of a square image. */
    turn(k) {
      let img = this;
      for(let t = 0; t < ((k % 4) + 4) % 4; t++) {
        const out = new Img(img.h, img.w);
        for(let y = 0; y < img.h; y++) for(let x = 0; x < img.w; x++) {
          const nx = img.h - 1 - y, ny = x;
          out.px.set(img.px.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 4), (ny * out.w + nx) * 4);
        }
        img = out;
      }
      return img;
    }
    /** Inclusive rectangle cleared to transparent (PIL draw.rectangle). */
    clear(x0, y0, x1, y1) {
      [x0, y0, x1, y1] = [x0, y0, x1, y1].map(Math.round);
      for(let y = Math.max(0, y0); y <= Math.min(this.h - 1, y1); y++) for(let x = Math.max(0, x0); x <= Math.min(this.w - 1, x1); x++) this.px.fill(0, (y * this.w + x) * 4, (y * this.w + x) * 4 + 4);
    }
    /** Paste at (x, y): plain copy, or blended by the source's own alpha (PIL paste with mask). */
    paste(src, x, y, masked = false) {
      x = Math.round(x); y = Math.round(y);
      for(let j = 0; j < src.h; j++) for(let i = 0; i < src.w; i++) {
        const dx = x + i, dy = y + j;
        if(dx < 0 || dy < 0 || dx >= this.w || dy >= this.h) continue;
        const s = (j * src.w + i) * 4, d = (dy * this.w + dx) * 4;
        if(!masked) { this.px.set(src.px.subarray(s, s + 4), d); continue; }
        const m = src.px[s + 3];
        for(let c = 0; c < 4; c++) this.px[d + c] = Math.round((src.px[s + c] * m + this.px[d + c] * (255 - m)) / 255);
      }
    }
  }
  //#endregion

  // neighbor mask of each autotile (N 1, NE 2, E 4, SE 8, S 16, SW 32, W 64, NW 128; corners only
  // count when both sides around them are filled). Read from the generated sheet; tile 22 is the
  // "void" tile (all wall), tile 36 the lone one.
  const MASKS = [16, 20, 84, 80, 213, 92, 116, 87, 28, 125, 124, 112, 17, 21, 85, 81, 29, 127, 253, 113, 31, 119, -1, 245,
    1, 5, 69, 65, 23, 223, 247, 209, 95, 255, 221, 241, 0, 4, 68, 64, 117, 71, 197, 93, 7, 199, 215, 193];
  const BY_MASK = new Map(MASKS.map((m, i) => [m, i]).filter(([m]) => m >= 0));

  class Sprites {
    static AUTOTILE = AUTOTILE;
    static MASKS = MASKS;

    /** Neighbor mask of cell (x, y); `on(x, y)` says if a cell is filled. */
    static blob(on, x, y) {
      const N = on(x, y - 1), E = on(x + 1, y), S = on(x, y + 1), W = on(x - 1, y);
      return (N ? 1 : 0) | (N && E && on(x + 1, y - 1) ? 2 : 0) | (E ? 4 : 0) | (S && E && on(x + 1, y + 1) ? 8 : 0)
        | (S ? 16 : 0) | (S && W && on(x - 1, y + 1) ? 32 : 0) | (W ? 64 : 0) | (N && W && on(x - 1, y - 1) ? 128 : 0);
    }

    /** Autotile index (0..47) for a mask. */
    static tileFor(mask) {
      return BY_MASK.get(mask) ?? 36;
    }

    /** Flood fill on a cell array: cells equal to the start become `value`; returns how many changed. */
    static flood(cells, w, h, x, y, value) {
      const from = cells[y * w + x];
      if(from === value) return 0;
      const stack = [[x, y]];
      let n = 0;
      while(stack.length) {
        const [cx, cy] = stack.pop();
        if(cx < 0 || cy < 0 || cx >= w || cy >= h || cells[cy * w + cx] !== from) continue;
        cells[cy * w + cx] = value;
        n++;
        stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
      }
      return n;
    }

    /** A test map as plain data: rows of comma-separated tile indexes (-1 = empty). */
    static mapData(map) {
      return {
        app: 'easel-map', version: 1, size: { w: map.w, h: map.h }, cell: map.cell,
        layers: map.layers.map(l => ({ name: l.name, kind: l.kind, rows: Array.from({ length: map.h }, (_, y) => Array.from(l.cells.slice(y * map.w, (y + 1) * map.w)).join(',')) })),
      };
    }

    static readMap(d) {
      if(d.app !== 'easel-map') throw new Error('not an Easel map');
      const w = d.size.w, h = d.size.h;
      return {
        w, h, cell: d.cell,
        layers: d.layers.map(l => ({ name: l.name, kind: l.kind ?? 'tiles', cells: Int32Array.from((Array.isArray(l.rows) ? l.rows : [l.rows]).flatMap(r => String(r).split(',').map(Number)).slice(0, w * h)) })),
      };
    }

    /**
     * Full 12 x 4 autotile sheet from a minimal source: two tiles side by side (border, floor), `grid` px each.
     * border: px the floor is cut back on bordered sides; corner: px cut from the floor at corners.
     * @returns {{w, h, px: Uint8ClampedArray}}
     */
    static autotile(px, srcW, srcH, { grid = 16, border = 2, corner = 1 } = {}) {
      grid = Math.max(1, grid | 0);
      if(border >= grid / 2) border = Math.floor(grid / 2 - 1);
      if(!border || border < 0) border = 0;
      if(corner >= grid / 2 - border) corner = Math.floor(grid / 2 - border - 1);
      if(!corner || corner < 0) corner = 0;
      const image = new Img(srcW, srcH, new Uint8ClampedArray(px));
      const base = image.crop(0, 0, grid, grid), floor = image.crop(grid, 0, grid * 2, grid);
      const h2 = grid / 2;
      const slices = [[0, 0, h2, h2], [h2, 0, grid, h2], [0, h2, h2, grid], [h2, h2, grid, grid]];
      const quarters = slices.map(s => base.crop(...s));
      const out = new Img(grid * 12, grid * 4);
      AUTOTILE.forEach((conf, t) => {
        const col = t % 12, row = Math.floor(t / 12);
        conf.forEach((q, s) => {
          const pos = [col * grid + slices[s][0], row * grid + slices[s][1]];
          let f = [...slices[s]];
          if(!q) { out.paste(floor.crop(...f), pos[0], pos[1]); return; }
          const tile = quarters[q[0]].turn(q[1]);
          const fpos = [...pos];
          if(border && (q[0] === 0 || q[0] === 3)) {
            const r = rotR(BSLICE[q[0]], q[1]);
            f = [f[0] + r[0] * border, f[1] + r[1] * border, f[2] - r[2] * border, f[3] - r[3] * border];
            fpos[0] += r[0] * border;
            fpos[1] += r[1] * border;
          }
          const trimmed = floor.copy();
          if(corner && (q[0] === 2 || q[0] === 3)) {
            const r = rotR(BSLICE[2], q[1]);
            trimmed.clear(r[0] ? f[2] - corner : f[0], r[1] ? f[3] - corner : f[1], r[2] ? f[0] + corner - 1 : f[2], r[3] ? f[1] + corner - 1 : f[3]);
          }
          if(q[0] !== 1) out.paste(trimmed.crop(...f), fpos[0], fpos[1]);
          out.paste(tile, pos[0], pos[1], true);
        });
      });
      return { w: out.w, h: out.h, px: out.px };
    }

    /**
     * Grid frames. Either `cell` {w, h} or `count` {cols, rows}; margin around the sheet, spacing between cells.
     * Empty cells are dropped when `rgba` is given and `skipEmpty`.
     */
    static grid(W, H, { cell, count, margin = 0, spacing = 0, rgba = null, skipEmpty = true } = {}) {
      let cw, ch, cols, rows;
      if(count) {
        cols = Math.max(1, count.cols | 0); rows = Math.max(1, count.rows | 0);
        cw = Math.floor((W - margin * 2 - spacing * (cols - 1)) / cols);
        ch = Math.floor((H - margin * 2 - spacing * (rows - 1)) / rows);
      }
      else {
        cw = Math.max(1, cell.w | 0); ch = Math.max(1, cell.h | 0);
        cols = Math.max(0, Math.floor((W - margin * 2 + spacing) / (cw + spacing)));
        rows = Math.max(0, Math.floor((H - margin * 2 + spacing) / (ch + spacing)));
      }
      const out = [];
      for(let r = 0; r < rows; r++) {
        for(let c = 0; c < cols; c++) {
          const f = { x: margin + c * (cw + spacing), y: margin + r * (ch + spacing), w: cw, h: ch };
          if(rgba && skipEmpty && Sprites.empty(rgba, W, f)) continue;
          out.push(f);
        }
      }
      return out;
    }

    static empty(rgba, W, f, alpha = 8) {
      for(let y = f.y; y < f.y + f.h; y++) for(let x = f.x; x < f.x + f.w; x++) if(rgba[(y * W + x) * 4 + 3] > alpha) return false;
      return true;
    }

    /**
     * Islands: boxes of connected opaque pixels; boxes closer than `gap` px merge (a sword apart from its
     * hero stays in the frame). Sorted in reading order (rows by top, then left).
     */
    static islands(rgba, W, H, { gap = 2, alpha = 8, minArea = 4, bg = null } = {}) {
      const solid = new Uint8Array(W * H);
      for(let i = 0; i < W * H; i++) {
        const p = i * 4;
        if(bg) solid[i] = !(Math.abs(rgba[p] - bg[0]) < 4 && Math.abs(rgba[p + 1] - bg[1]) < 4 && Math.abs(rgba[p + 2] - bg[2]) < 4) && rgba[p + 3] > alpha ? 1 : 0;
        else solid[i] = rgba[p + 3] > alpha ? 1 : 0;
      }
      const seen = new Uint8Array(W * H), boxes = [];
      const stack = new Int32Array(W * H);
      for(let i = 0; i < W * H; i++) {
        if(!solid[i] || seen[i]) continue;
        let sp = 0, x0 = W, y0 = H, x1 = 0, y1 = 0, n = 0;
        stack[sp++] = i; seen[i] = 1;
        while(sp) {
          const j = stack[--sp], x = j % W, y = (j / W) | 0;
          n++;
          if(x < x0) x0 = x; if(x > x1) x1 = x; if(y < y0) y0 = y; if(y > y1) y1 = y;
          // 8-neighborhood
          for(let dy = -1; dy <= 1; dy++) {
            const yy = y + dy;
            if(yy < 0 || yy >= H) continue;
            for(let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              if(xx < 0 || xx >= W) continue;
              const k = yy * W + xx;
              if(solid[k] && !seen[k]) { seen[k] = 1; stack[sp++] = k; }
            }
          }
        }
        boxes.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, n });
      }
      // merge boxes within `gap`
      let merged = true;
      while(merged) {
        merged = false;
        for(let a = 0; a < boxes.length && !merged; a++) {
          for(let b = a + 1; b < boxes.length; b++) {
            const A = boxes[a], B = boxes[b];
            if(A.x - gap <= B.x + B.w && B.x - gap <= A.x + A.w && A.y - gap <= B.y + B.h && B.y - gap <= A.y + A.h) {
              const x = Math.min(A.x, B.x), y = Math.min(A.y, B.y);
              boxes[a] = { x, y, w: Math.max(A.x + A.w, B.x + B.w) - x, h: Math.max(A.y + A.h, B.y + B.h) - y, n: A.n + B.n };
              boxes.splice(b, 1);
              merged = true;
              break;
            }
          }
        }
      }
      return Sprites.reading(boxes.filter(b => b.n >= minArea).map(({ x, y, w, h }) => ({ x, y, w, h })));
    }

    /** Reading order: group into rows by vertical overlap, then left to right. */
    static reading(frames) {
      const rest = [...frames].sort((a, b) => a.y - b.y);
      const rows = [];
      for(const f of rest) {
        const row = rows.find(r => f.y < r.y + r.h * .6 && f.y + f.h * .4 > r.y);
        if(row) { row.items.push(f); row.h = Math.max(row.h, f.y + f.h - row.y); }
        else rows.push({ y: f.y, h: f.h, items: [f] });
      }
      return rows.flatMap(r => r.items.sort((a, b) => a.x - b.x));
    }

    /** Frame index sequence one cycle plays (ping-pong goes back without repeating the ends). */
    static sequence(anim) {
      const f = anim.frames;
      if(anim.mode === 'pingpong' && f.length > 2) return [...f, ...f.slice(1, -1).reverse()];
      return [...f];
    }

    /** Duration of each step in ms (per-frame overrides win over fps). */
    static durations(anim) {
      const base = 1000 / Math.max(1, anim.fps || 10);
      return Sprites.sequence(anim).map(i => anim.durations?.[i] ?? base);
    }

    /** Tight shelf packing: [{x, y}] per frame and the sheet size. */
    static pack(frames, { padding = 1, maxW = 0 } = {}) {
      const area = frames.reduce((s, f) => s + (f.w + padding) * (f.h + padding), 0);
      const W = maxW || Math.max(Math.max(0, ...frames.map(f => f.w + padding * 2)), Math.ceil(Math.sqrt(area) * 1.1));
      const order = frames.map((f, i) => i).sort((a, b) => frames[b].h - frames[a].h);
      const pos = new Array(frames.length);
      let x = padding, y = padding, rowH = 0;
      for(const i of order) {
        const f = frames[i];
        if(x + f.w + padding > W) { x = padding; y += rowH + padding; rowH = 0; }
        pos[i] = { x, y };
        x += f.w + padding;
        rowH = Math.max(rowH, f.h);
      }
      return { pos, w: W, h: y + rowH + padding };
    }

    /** The project as plain data (TOON / JSON). */
    static data({ image, w, h, frames, anims }) {
      return {
        app: 'easel', version: 1,
        image, size: { w, h },
        frames: frames.map((f, i) => ({ name: f.name ?? `frame_${i}`, x: f.x, y: f.y, w: f.w, h: f.h })),
        animations: anims.map(a => ({ name: a.name, frames: a.frames.join(','), fps: a.fps, mode: a.mode ?? 'loop', ...(a.pivot ? { pivot: `${a.pivot.x},${a.pivot.y}` } : {}) })),
      };
    }

    /** Back from data(): numbers in "a,b,c" strings become lists again. */
    static read(d) {
      if(d.app !== 'easel') throw new Error('not an Easel file');
      const frames = (d.frames ?? []).map(f => ({ x: f.x, y: f.y, w: f.w, h: f.h, name: f.name }));
      const anims = (d.animations ?? []).map(a => ({
        name: a.name, fps: a.fps ?? 10, mode: a.mode ?? 'loop',
        frames: String(a.frames ?? '').split(',').filter(s => s !== '').map(Number).filter(i => i >= 0 && i < frames.length),
        ...(a.pivot ? { pivot: (([x, y]) => ({ x: +x, y: +y }))(String(a.pivot).split(',')) } : {}),
      }));
      return { image: d.image, w: d.size?.w, h: d.size?.h, frames, anims };
    }

    /** Aseprite "array" JSON (frames + frameTags), what most engines import. */
    static aseprite({ image, w, h, frames, anims }) {
      const base = anims[0] ? 1000 / (anims[0].fps || 10) : 100;
      const dur = i => Math.round(anims.find(a => a.frames.includes(i))?.durations?.[i] ?? 1000 / (anims.find(a => a.frames.includes(i))?.fps || 1000 / base));
      return {
        frames: frames.map((f, i) => ({
          filename: f.name ?? `frame_${i}`, frame: { x: f.x, y: f.y, w: f.w, h: f.h }, rotated: false, trimmed: false,
          spriteSourceSize: { x: 0, y: 0, w: f.w, h: f.h }, sourceSize: { w: f.w, h: f.h }, duration: dur(i),
        })),
        meta: {
          app: 'Daedalus Ikaros Easel', version: '1', image, format: 'RGBA8888', size: { w, h }, scale: '1',
          frameTags: anims.filter(a => a.frames.length).map(a => ({ name: a.name, from: Math.min(...a.frames), to: Math.max(...a.frames), direction: a.mode === 'pingpong' ? 'pingpong' : 'forward' })),
        },
      };
    }

    /** Reads Aseprite JSON (hash or array) into frames + animations. */
    static fromAseprite(json) {
      const list = Array.isArray(json.frames) ? json.frames : Object.entries(json.frames ?? {}).map(([filename, f]) => ({ filename, ...f }));
      const frames = list.map(f => ({ ...f.frame, name: f.filename }));
      const anims = (json.meta?.frameTags ?? []).map(t => {
        const idx = [];
        for(let i = t.from; i <= t.to; i++) idx.push(i);
        const d = list[t.from]?.duration ?? 100;
        return { name: t.name, frames: t.direction === 'reverse' ? idx.reverse() : idx, fps: Math.round(1000 / d), mode: t.direction === 'pingpong' ? 'pingpong' : 'loop' };
      });
      return { image: json.meta?.image, w: json.meta?.size?.w, h: json.meta?.size?.h, frames, anims };
    }
  }

  DAE.Sprites = Sprites;
});
