// Prisma core: finds every valid color in text (any # hex, CSS color functions, CSS named colors in
// CSS places), with what it paints when that can be told (selector + property, custom property,
// element + attribute, code key), and organizes them into a palette.
DAE_CORE(DAE => {
  //#region [ Named colors ]
  const NAMED = Object.fromEntries(('aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc bisque ffe4c4 black 000000 blanchedalmond ffebcd blue 0000ff blueviolet 8a2be2 brown a52a2a burlywood deb887 cadetblue 5f9ea0 chartreuse 7fff00 chocolate d2691e coral ff7f50 cornflowerblue 6495ed cornsilk fff8dc crimson dc143c cyan 00ffff darkblue 00008b darkcyan 008b8b darkgoldenrod b8860b darkgray a9a9a9 darkgreen 006400 darkgrey a9a9a9 darkkhaki bdb76b darkmagenta 8b008b darkolivegreen 556b2f darkorange ff8c00 darkorchid 9932cc darkred 8b0000 darksalmon e9967a darkseagreen 8fbc8f darkslateblue 483d8b darkslategray 2f4f4f darkslategrey 2f4f4f darkturquoise 00ced1 darkviolet 9400d3 deeppink ff1493 deepskyblue 00bfff dimgray 696969 dimgrey 696969 dodgerblue 1e90ff firebrick b22222 floralwhite fffaf0 forestgreen 228b22 fuchsia ff00ff gainsboro dcdcdc ghostwhite f8f8ff gold ffd700 goldenrod daa520 gray 808080 green 008000 greenyellow adff2f grey 808080 honeydew f0fff0 hotpink ff69b4 indianred cd5c5c indigo 4b0082 ivory fffff0 khaki f0e68c lavender e6e6fa lavenderblush fff0f5 lawngreen 7cfc00 lemonchiffon fffacd lightblue add8e6 lightcoral f08080 lightcyan e0ffff lightgoldenrodyellow fafad2 lightgray d3d3d3 lightgreen 90ee90 lightgrey d3d3d3 lightpink ffb6c1 lightsalmon ffa07a lightseagreen 20b2aa lightskyblue 87cefa lightslategray 778899 lightslategrey 778899 lightsteelblue b0c4de lightyellow ffffe0 lime 00ff00 limegreen 32cd32 linen faf0e6 magenta ff00ff maroon 800000 mediumaquamarine 66cdaa mediumblue 0000cd mediumorchid ba55d3 mediumpurple 9370db mediumseagreen 3cb371 mediumslateblue 7b68ee mediumspringgreen 00fa9a mediumturquoise 48d1cc mediumvioletred c71585 midnightblue 191970 mintcream f5fffa mistyrose ffe4e1 moccasin ffe4b5 navajowhite ffdead navy 000080 oldlace fdf5e6 olive 808000 olivedrab 6b8e23 orange ffa500 orangered ff4500 orchid da70d6 palegoldenrod eee8aa palegreen 98fb98 paleturquoise afeeee palevioletred db7093 papayawhip ffefd5 peachpuff ffdab9 peru cd853f pink ffc0cb plum dda0dd powderblue b0e0e6 purple 800080 rebeccapurple 663399 red ff0000 rosybrown bc8f8f royalblue 4169e1 saddlebrown 8b4513 salmon fa8072 sandybrown f4a460 seagreen 2e8b57 seashell fff5ee sienna a0522d silver c0c0c0 skyblue 87ceeb slateblue 6a5acd slategray 708090 slategrey 708090 snow fffafa springgreen 00ff7f steelblue 4682b4 tan d2b48c teal 008080 thistle d8bfd8 tomato ff6347 turquoise 40e0d0 violet ee82ee wheat f5deb3 white ffffff whitesmoke f5f5f5 yellow ffff00 yellowgreen 9acd32')
    .split(' ').reduce((a, w, i, all) => (i % 2 ? a : [...a, [w, '#' + all[i + 1]]]), []));
  NAMED.transparent = '#00000000';
  const NAMED_RE = new RegExp(`(?<![\\w#.$-])(${Object.keys(NAMED).sort((a, b) => b.length - a.length).join('|')})(?![\\w(-])`, 'gi');
  //#endregion

  //#region [ Color math ]
  const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
  const lin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const gam = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.sign(c) * Math.abs(c) ** (1 / 2.4) - 0.055);
  const mul = (m, v) => m.map(row => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
  const XYZ65_TO_LRGB = [[3.2409699419045226, -1.537383177570094, -0.4986107602930034], [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559], [0.05563007969699366, -0.20397695888897652, 1.0569715142428786]];
  const LRGB_TO_XYZ65 = [[0.41239079926595934, 0.357584339383878, 0.1804807884018343], [0.21263900587151027, 0.715168678767756, 0.07219231536073371], [0.01933081871559182, 0.11919477979462598, 0.9505321522496607]];
  const D50_TO_D65 = [[0.955473421488075, -0.02309845494876471, 0.06325924320057072], [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323], [0.012314014864481998, -0.020507649298898964, 1.330365926242124]];
  const P3_TO_XYZ65 = [[0.4865709486482162, 0.26566769316909306, 0.1982172852343625], [0.2289745640697488, 0.6917385218365064, 0.079286914093745], [0, 0.04511338185890264, 1.043944368900976]];
  const D50 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];

  const fromLinear = (l, alpha) => [...l.map(c => Math.round(clamp(gam(c)) * 255)), alpha];
  const labToXyz50 = (L, a, b) => {
    const k = 24389 / 27, e = 216 / 24389;
    const fy = (L + 16) / 116, fx = a / 500 + fy, fz = fy - b / 200;
    const xyz = [fx ** 3 > e ? fx ** 3 : (116 * fx - 16) / k, L > k * e ? ((L + 16) / 116) ** 3 : L / k, fz ** 3 > e ? fz ** 3 : (116 * fz - 16) / k];
    return xyz.map((v, i) => v * D50[i]);
  };
  const oklabToLinear = (L, a, b) => {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  };
  const linearToOklab = ([r, g, b]) => {
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
  };
  //#endregion

  //#region [ Parsing CSS color values ]
  const NUM = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?';
  const hueOf = s => {
    const m = s.match(new RegExp(`^(${NUM})(deg|rad|grad|turn)?$`, 'i'));
    if(!m) return s === 'none' ? 0 : NaN;
    const v = +m[1], u = (m[2] ?? 'deg').toLowerCase();
    return u === 'rad' ? v * 180 / Math.PI : u === 'grad' ? v * 0.9 : u === 'turn' ? v * 360 : v;
  };
  /** number or percent: % maps to `pct` (the value of 100%). `need`: 'num' | 'pct' | null (either). */
  const val = (s, pct, need = null) => {
    if(s === 'none') return 0;
    const m = s.match(new RegExp(`^(${NUM})(%)?$`, 'i'));
    if(!m) return NaN;
    if(need === 'num' && m[2] || need === 'pct' && !m[2]) return NaN;
    return m[2] ? +m[1] / 100 * pct : +m[1];
  };
  const alphaOf = s => (s === undefined ? 1 : clamp(val(s, 1)));

  /** Splits the inside of a color function into [args, alpha, legacy] (comma or space syntax). */
  const args = inner => {
    const s = inner.trim().replace(/\s+/g, ' ');
    if(s.includes(',')) {
      if(s.includes('/')) return null;
      const parts = s.split(',').map(x => x.trim());
      return { parts: parts.slice(0, 3), alpha: parts[3], legacy: true, n: parts.length };
    }
    const [main, alpha, extra] = s.split('/').map(x => x.trim());
    if(extra !== undefined || alpha === '') return null;
    const parts = main.split(' ');
    return { parts, alpha, legacy: false, n: parts.length + (alpha !== undefined ? 1 : 0) };
  };

  class Colors {
    static NAMED = NAMED;
    static EXT = ['css', 'scss', 'sass', 'less', 'styl', 'html', 'htm', 'svg', 'vue', 'svelte', 'js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx', 'json', 'toon', 'md', 'xml', 'txt', 'yml', 'yaml', 'ini', 'cfg', 'py', 'cs', 'lua', 'gd', 'kt', 'java', 'swift'];
    static SKIP = ['node_modules', '.git', 'dist', 'build', '.next', '.cache', 'vendor', '__pycache__'];
    static CSS_EXT = ['css', 'scss', 'sass', 'less', 'styl'];

    /**
     * Any CSS color text -> [r, g, b, a] (0..255, alpha 0..1, clamped into sRGB), or null when not a valid color.
     */
    static parse(text) {
      const s = text.trim().toLowerCase();
      let m = s.match(/^#([0-9a-f]{3,8})$/);
      if(m) {
        const h = m[1];
        if(![3, 4, 6, 8].includes(h.length)) return null;
        const full = h.length <= 4 ? [...h].map(c => c + c).join('') : h;
        return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)).concat(full.length === 8 ? +(parseInt(full.slice(6), 16) / 255).toFixed(3) : 1);
      }
      if(NAMED[s]) return Colors.parse(NAMED[s]);
      m = s.match(/^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\((.*)\)$/);
      if(!m) return null;
      const fn = m[1], a = args(m[2]);
      if(!a) return null;
      let out = null;
      if(fn === 'rgb' || fn === 'rgba') {
        if(a.parts.length !== 3 || a.n > 4) return null;
        const pctMode = a.parts[0].endsWith('%');
        if(a.legacy && a.parts.some(p => p.endsWith('%') !== pctMode)) return null;
        const v = a.parts.map(p => val(p, 255));
        if(v.some(Number.isNaN)) return null;
        out = [...v.map(c => Math.round(clamp(c, 0, 255))), alphaOf(a.alpha)];
      }
      else if(fn === 'hsl' || fn === 'hsla') {
        if(a.parts.length !== 3 || a.n > 4) return null;
        const h = hueOf(a.parts[0]);
        const sat = val(a.parts[1], 100, a.legacy ? 'pct' : null), l = val(a.parts[2], 100, a.legacy ? 'pct' : null);
        if([h, sat, l].some(Number.isNaN)) return null;
        out = [...Colors.hsl(h, clamp(sat / 100), clamp(l / 100)), alphaOf(a.alpha)];
      }
      else if(fn === 'hwb') {
        if(a.legacy || a.parts.length !== 3) return null;
        const h = hueOf(a.parts[0]), w = val(a.parts[1], 100), b = val(a.parts[2], 100);
        if([h, w, b].some(Number.isNaN)) return null;
        let W = clamp(w / 100), B = clamp(b / 100);
        if(W + B >= 1) { const g = Math.round(W / (W + B) * 255); out = [g, g, g, alphaOf(a.alpha)]; }
        else out = [...Colors.hsl(h, 1, .5).map(c => Math.round(c * (1 - W - B) + W * 255)), alphaOf(a.alpha)];
      }
      else if(fn === 'lab' || fn === 'lch' || fn === 'oklab' || fn === 'oklch') {
        if(a.legacy || a.parts.length !== 3) return null;
        const ok = fn.startsWith('ok');
        const L = val(a.parts[0], ok ? 1 : 100);
        let x, y;
        if(fn.endsWith('lab')) { x = val(a.parts[1], ok ? 0.4 : 125); y = val(a.parts[2], ok ? 0.4 : 125); }
        else {
          const C = val(a.parts[1], ok ? 0.4 : 150), H = hueOf(a.parts[2]) * Math.PI / 180;
          x = C * Math.cos(H); y = C * Math.sin(H);
        }
        if([L, x, y].some(Number.isNaN)) return null;
        const linear = ok ? oklabToLinear(L, x, y) : mul(XYZ65_TO_LRGB, mul(D50_TO_D65, labToXyz50(L, x, y)));
        out = fromLinear(linear, alphaOf(a.alpha));
      }
      else if(fn === 'color') {
        if(a.legacy) return null;
        const [space, ...rest] = a.parts;
        if(rest.length !== 3) return null;
        const v = rest.map(p => val(p, 1));
        if(v.some(Number.isNaN)) return null;
        let linear;
        if(space === 'srgb') linear = v.map(lin);
        else if(space === 'srgb-linear') linear = v;
        else if(space === 'display-p3') linear = mul(XYZ65_TO_LRGB, mul(P3_TO_XYZ65, v.map(lin)));
        else if(space === 'xyz' || space === 'xyz-d65') linear = mul(XYZ65_TO_LRGB, v);
        else if(space === 'xyz-d50') linear = mul(XYZ65_TO_LRGB, mul(D50_TO_D65, v));
        else return null;
        out = fromLinear(linear, alphaOf(a.alpha));
      }
      if(!out || out.some(Number.isNaN)) return null;
      return out;
    }

    static hsl(h, s, l) {
      h = ((h % 360) + 360) % 360;
      const k = n => (n + h / 30) % 12, A = s * Math.min(l, 1 - l);
      return [0, 8, 4].map(n => Math.round((l - A * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))) * 255));
    }

    static hex([r, g, b, a = 1]) {
      const h = [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
      return '#' + (a < 1 ? h + Math.round(a * 255).toString(16).padStart(2, '0') : h).toUpperCase();
    }

    static oklab([r, g, b]) {
      return linearToOklab([r, g, b].map(c => lin(c / 255)));
    }

    /** Color as hex / rgb / hsl / oklch strings. */
    static formats(rgba) {
      const [r, g, b, a = 1] = rgba;
      const R = r / 255, G = g / 255, B = b / 255, max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2, d = max - min;
      const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
      let h = 0;
      if(d) h = max === R ? 60 * (((G - B) / d) % 6) : max === G ? 60 * ((B - R) / d + 2) : 60 * ((R - G) / d + 4);
      h = (h + 360) % 360;
      const [L, A, Bk] = Colors.oklab(rgba), C = Math.hypot(A, Bk), H = (Math.atan2(Bk, A) * 180 / Math.PI + 360) % 360;
      const al = a < 1 ? ` / ${+a.toFixed(3)}` : '';
      return {
        hex: Colors.hex(rgba),
        rgb: `rgb(${r} ${g} ${b}${al})`,
        hsl: `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%${al})`,
        oklch: `oklch(${(L * 100).toFixed(1)}% ${C.toFixed(3)} ${C < 0.002 ? 0 : H.toFixed(1)}${al})`,
      };
    }

    /** WCAG contrast ratio of two colors (alpha ignored). */
    static contrast(a, b) {
      const Y = ([r, g, bb]) => 0.2126 * lin(r / 255) + 0.7152 * lin(g / 255) + 0.0722 * lin(bb / 255);
      const [hi, lo] = [Y(a), Y(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    }

    /** ΔE in OKLab, scaled ×100 (1 ≈ just noticeable). Alpha difference counts too. */
    static deltaE(a, b) {
      const [l1, a1, b1] = Colors.oklab(a), [l2, a2, b2] = Colors.oklab(b);
      return Math.hypot(l1 - l2, a1 - a2, b1 - b2, ((a[3] ?? 1) - (b[3] ?? 1)) * 0.3) * 100;
    }
    //#endregion

    //#region [ Extraction ]
    static ext(name) {
      const m = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
      return m ? m[1] : '';
    }

    /** CSS regions of a file: [[start, end]] (whole CSS files, <style> blocks, style="" values). */
    static #cssRegions(text, ext) {
      if(Colors.CSS_EXT.includes(ext)) return [[0, text.length]];
      const out = [];
      if(['html', 'htm', 'svg', 'vue', 'svelte', 'xml', 'md'].includes(ext)) {
        for(const m of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) out.push([m.index + m[0].indexOf('>') + 1, m.index + m[0].length - 8]);
      }
      for(const m of text.matchAll(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/gi)) out.push([m.index + m[0].indexOf(m[1]) + 1, m.index + m[0].length - 1]);
      return out;
    }

    /** Selectors of CSS blocks inside a region: [{sel, open, close}] (nested blocks keep their parents). */
    static #blocks(text, [start, end]) {
      const out = [], stack = [];
      let from = start, comment = false;
      for(let i = start; i < end; i++) {
        const c = text[i];
        if(comment) { if(c === '*' && text[i + 1] === '/') { comment = false; i++; from = i + 1; } continue; }
        if(c === '/' && text[i + 1] === '*') { comment = true; i++; continue; }
        if(c === '{') {
          const sel = text.slice(from, i).replace(/\s+/g, ' ').trim().split(';').pop().trim();
          const b = { sel: [...stack.map(s => s.sel), sel].filter(Boolean).join(' › '), open: i, close: end };
          stack.push(b);
          out.push(b);
          from = i + 1;
        }
        else if(c === '}') { const b = stack.pop(); if(b) b.close = i; from = i + 1; }
        else if(c === ';') from = i + 1;
      }
      return out;
    }

    /** Opening tag around offset `at` (for style="" and fill="" attributes): 'rect#id.cls'. */
    static #element(text, at) {
      const open = text.lastIndexOf('<', at);
      if(open < 0) return '';
      const close = text.indexOf('>', open);
      const tag = text.slice(open, close < 0 ? at : close);
      const m = tag.match(/^<([\w:-]+)/);
      if(!m) return '';
      const id = tag.match(/\bid\s*=\s*["']([^"']+)/), cls = tag.match(/\bclass\s*=\s*["']([^"']+)/);
      return m[1] + (id ? '#' + id[1] : '') + (cls ? '.' + cls[1].trim().split(/\s+/).join('.') : '');
    }

    static category(name = '') {
      const n = name.toLowerCase();
      if(n.startsWith('--')) return 'variable';
      if(/background|^bg|-bg|bg-|backdrop|surface/.test(n)) return 'background';
      if(/border|outline|divider|ring/.test(n)) return 'border';
      if(/shadow|glow/.test(n)) return 'shadow';
      if(/fill|stroke|stop-color|flood|lighting/.test(n)) return 'fill';
      if(/^color$|text|font|caret|foreground|^fg|-fg|ink|link/.test(n)) return 'text';
      if(/gradient|image/.test(n)) return 'background';
      return 'other';
    }

    /**
     * Every color in one file.
     * @returns {{hits: Array, uses: Array<{var, sel, prop, file, line}>}} uses = where var(--x) is read
     */
    static extract(text, file = 'pasted') {
      const ext = Colors.ext(file);
      const regions = Colors.#cssRegions(text, ext);
      const blocks = regions.flatMap(r => Colors.#blocks(text, r));
      const starts = [0];
      for(let i = 0; i < text.length; i++) if(text[i] === '\n') starts.push(i + 1);
      const lineOf = off => {
        let lo = 0, hi = starts.length - 1;
        while(lo < hi) { const m = (lo + hi + 1) >> 1; if(starts[m] <= off) lo = m; else hi = m - 1; }
        return lo;
      };
      const inCss = at => regions.some(([a, b]) => at >= a && at < b);
      const hits = [], taken = [];
      const overlaps = (a, b) => taken.some(([x, y]) => a < y && b > x);

      const ref = (at, len) => {
        const r = {};
        const li = lineOf(at), ls = starts[li], le = starts[li + 1] ?? text.length;
        const line = text.slice(ls, le).replace(/\r?\n$/, '');
        if(inCss(at)) {
          r.ctx = 'css';
          const b = blocks.filter(x => at > x.open && at < x.close).pop();
          if(b) r.sel = b.sel;
          // property: from the last ; { or quote before the color
          let s = at;
          while(s > 0 && !';{}"\''.includes(text[s - 1])) s--;
          const decl = text.slice(s, at);
          const pm = decl.match(/^\s*([\w-]+)\s*:/);
          if(pm) { r.prop = pm[1]; if(pm[1].startsWith('--')) r.var = pm[1]; }
          const attr = text.slice(Math.max(0, s - 40), s).match(/style\s*=\s*$/i);
          if(attr || (!b && regions.some(([a]) => text.slice(Math.max(0, a - 8), a).match(/style\s*=\s*["']$/i)))) r.el = Colors.#element(text, at);
        }
        else {
          const before = text.slice(Math.max(ls, at - 120), at);
          const attr = before.match(/([\w:-]+)\s*=\s*["']?\s*$/);
          if(['html', 'htm', 'svg', 'vue', 'svelte', 'xml'].includes(ext) && attr && text.lastIndexOf('<', at) > text.lastIndexOf('>', at - 1)) {
            r.ctx = 'html'; r.attr = attr[1]; r.el = Colors.#element(text, at);
          }
          else {
            r.ctx = 'code';
            const km = before.match(/(["']?)([\w$.-]+)\1\s*[:=]\s*[\[(]?\s*["'`]?[^,;{}]*$/) ?? before.match(/(["']?)([\w$-]+)\1\s*[:=][^:=]*$/);
            if(km) r.key = km[2];
            if(ext === 'toon' && !r.key) { const tm = line.match(/^\s*([\w$.-]+)/); if(tm) r.key = tm[1]; }
          }
        }
        r.cat = Colors.category(r.var ?? r.prop ?? r.attr ?? r.key ?? '');
        return { file, line: li + 1, col: at - ls + 1, preview: line.trim().slice(0, 200), ...r };
      };

      const push = (raw, at, rgba) => {
        taken.push([at, at + raw.length]);
        hits.push({ raw, rgba, hex: Colors.hex(rgba), ...ref(at, raw.length) });
      };

      // functions first (their insides can hold numbers that look like nothing else)
      for(const m of text.matchAll(/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/gi)) {
        if(/var\(|calc\(|from /i.test(m[2])) continue;   // relative / computed colors: not a fixed value
        const rgba = Colors.parse(m[0]);
        if(rgba) push(m[0], m.index, rgba);
      }
      for(const m of text.matchAll(/(?<![\w&#/?=-])#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![\w-])/g)) {
        const at = m.index;
        if(overlaps(at, at + m[0].length)) continue;
        const prev = text.slice(Math.max(0, at - 12), at);
        if(/\b(href|src|id|for|name)\s*=\s*["']?\s*$|url\(\s*["']?$/i.test(prev)) continue;   // links and ids
        const nextCh = text.slice(at + m[0].length).match(/^\s*(.)/)?.[1];
        if(inCss(at) && (nextCh === '{' || nextCh === ',' && !/:[^;{}]*$/.test(text.slice(Math.max(0, at - 200), at)))) continue;   // id selector
        push(m[0], at, Colors.parse(m[0]));
      }
      for(const m of text.matchAll(NAMED_RE)) {
        const at = m.index, name = m[1].toLowerCase();
        if(overlaps(at, at + m[0].length)) continue;
        if(inCss(at)) {
          // only in a declaration value
          let s = at;
          while(s > 0 && !';{}"\''.includes(text[s - 1])) s--;
          if(!/^\s*[\w-]+\s*:/.test(text.slice(s, at))) continue;
          if(/^\s*(transition|animation|font|grid|content|will-change|counter|list-style-type|text-transform)/i.test(text.slice(s, at))) continue;
        }
        else {
          // in code: a quoted string that is only the name, under a color-ish key or property
          const q = text[at - 1], qe = text[at + m[0].length];
          if(!(q && q === qe && `"'\``.includes(q))) continue;
          const before = text.slice(Math.max(0, at - 60), at - 1);
          if(!/(colou?r|fill|stroke|background|bg|border|shadow|outline|tint|style)\w*["']?\s*[:=]\s*$/i.test(before)) continue;
        }
        push(m[0], at, Colors.parse(NAMED[name]));
      }

      // where custom properties are read
      const uses = [];
      for(const m of text.matchAll(/var\(\s*(--[\w-]+)/g)) {
        const r = ref(m.index, m[0].length);
        uses.push({ var: m[1], sel: r.sel ?? r.el ?? '', prop: r.prop ?? r.attr ?? r.key ?? '', file, line: r.line });
      }
      hits.sort((a, b) => a.line - b.line || a.col - b.col);
      return { hits, uses };
    }

    /** Many files ([{name, text}]) -> {hits, uses}, skipping unknown extensions. */
    static scan(files, { ext = Colors.EXT } = {}) {
      const hits = [], uses = [];
      for(const f of files) {
        const e = Colors.ext(f.name);
        if(e && !ext.includes(e)) continue;
        const r = Colors.extract(f.text, f.name);
        hits.push(...r.hits);
        uses.push(...r.uses);
      }
      return { hits, uses };
    }
    //#endregion

    //#region [ Palette ]
    /** Swatches: one per exact color (alpha kept), in first-seen order. */
    static swatches(hits, uses = []) {
      const map = new Map();
      hits.forEach((h, i) => {
        let s = map.get(h.hex);
        if(!s) map.set(h.hex, s = { hex: h.hex, rgba: h.rgba, hits: [], first: i, variants: [] });
        s.hits.push(h);
      });
      const byVar = new Map();
      for(const u of uses) { if(!byVar.has(u.var)) byVar.set(u.var, []); byVar.get(u.var).push(u); }
      for(const s of map.values()) {
        s.count = s.hits.length;
        s.vars = [...new Set(s.hits.map(h => h.var).filter(Boolean))];
        s.uses = s.vars.flatMap(v => byVar.get(v) ?? []);
        s.name = Colors.name(s);
      }
      return [...map.values()];
    }

    /** A readable name: custom property, then code key, then property / attribute + category. */
    static name(s) {
      const h = s.hits;
      const v = h.find(x => x.var)?.var;
      if(v) return v.slice(2);
      const k = h.find(x => x.key)?.key;
      if(k) return k.split('.').pop();
      const p = h.find(x => x.prop || x.attr);
      return p ? (p.prop ?? p.attr) : '';
    }

    /** Merges swatches closer than `tol` ΔE: the most used one stays, the others become its variants. */
    static merge(list, tol) {
      if(!tol) return list.map(s => ({ ...s, variants: [] }));
      const sorted = [...list].sort((a, b) => b.count - a.count || a.first - b.first);
      const out = [];
      for(const s of sorted) {
        const home = out.find(o => Colors.deltaE(o.rgba, s.rgba) <= tol);
        if(home) {
          home.variants.push(s);
          home.total += s.count;
          home.first = Math.min(home.first, s.first);
        }
        else out.push({ ...s, variants: [], total: s.count });
      }
      return out.sort((a, b) => a.first - b.first);
    }

    static sort(list, by = 'hue') {
      const key = s => {
        const [L, a, b] = Colors.oklab(s.rgba), C = Math.hypot(a, b);
        const hue = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
        if(by === 'hue') return C < 0.03 ? [1, -L] : [0, hue, -L];   // grays last, light to dark
        if(by === 'light') return [-L];
        if(by === 'usage') return [-(s.total ?? s.count), s.first];
        return [s.first];
      };
      return [...list].sort((p, q) => {
        const a = key(p), b = key(q);
        for(let i = 0; i < Math.max(a.length, b.length); i++) if((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
        return 0;
      });
    }

    /** Groups for the view: by 'file' | 'cat' | 'var' | 'none' -> [{title, items}]. */
    static group(list, by = 'none') {
      if(by === 'none') return [{ title: '', items: list }];
      const groups = new Map();
      const add = (k, s) => { if(!groups.has(k)) groups.set(k, []); if(!groups.get(k).includes(s)) groups.get(k).push(s); };
      for(const s of list) {
        const hits = [s, ...s.variants].flatMap(x => x.hits);
        if(by === 'file') hits.forEach(h => add(h.file, s));
        if(by === 'cat') hits.forEach(h => add(h.cat, s));
        if(by === 'var') { const v = hits.find(h => h.var)?.var; add(v ? 'custom properties' : 'plain values', s); }
      }
      return [...groups].map(([title, items]) => ({ title, items }));
    }
    //#endregion

    //#region [ Export ]
    static #slug(s) {
      return String(s).replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'color';
    }

    /** Unique names for a palette (from the swatch names, else color-N). */
    static names(list) {
      const used = new Map();
      return list.map((s, i) => {
        let n = Colors.#slug(s.name || `color-${i + 1}`);
        if(used.has(n)) { used.set(n, used.get(n) + 1); n += '-' + used.get(n); }
        else used.set(n, 1);
        return n;
      });
    }

    static css(list) {
      const names = Colors.names(list);
      return `:root {\n${list.map((s, i) => `  --${names[i]}: ${s.hex};`).join('\n')}\n}\n`;
    }

    static data(list) {
      const names = Colors.names(list);
      return {
        app: 'prisma', version: 1,
        colors: list.map((s, i) => ({ name: names[i], hex: s.hex, count: s.total ?? s.count, refs: [...new Set(s.hits.map(h => h.var ?? h.sel ?? h.el ?? h.key ?? h.file))].slice(0, 6).join(' · ') })),
      };
    }

    static gpl(list, title = 'Prisma palette') {
      const names = Colors.names(list);
      return `GIMP Palette\nName: ${title}\nColumns: 8\n#\n${list.map((s, i) => `${s.rgba.slice(0, 3).map(c => String(c).padStart(3)).join(' ')}\t${names[i]}`).join('\n')}\n`;
    }

    static markdown(list) {
      const names = Colors.names(list);
      return ['| Name | Color | Uses | Where |', '|---|---|---|---|', ...list.map((s, i) => `| ${names[i]} | \`${s.hex}\` | ${s.total ?? s.count} | ${[...new Set(s.hits.map(h => h.sel ?? h.el ?? h.key ?? h.file))].slice(0, 3).join(', ').replace(/\|/g, '\\|')} |`)].join('\n') + '\n';
    }
    //#endregion
  }

  DAE.Colors = Colors;
});
