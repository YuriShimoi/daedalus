// Kit: small UI pieces shared by the Ikaros subtools (code editor with line numbers and
// highlight, splitters, copy / download, html escaping, a debounce).
class Kit {
  static esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  static icon(name, cls = '') {
    return DAE.Icons.html(name, cls);
  }

  static later(fn, ms = 250) {
    let t = 0;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  /** Element from html (first element). */
  static el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  static async copy(text, what = 'Copied') {
    try {
      await navigator.clipboard.writeText(text);
      Hub.toast(what);
    }
    catch {
      const $t = Object.assign(document.createElement('textarea'), { value: text });
      document.body.append($t);
      $t.select();
      document.execCommand('copy');
      $t.remove();
      Hub.toast(what);
    }
  }

  static download(name, data, mime = 'text/plain') {
    DAE.FileIO.download(name, data instanceof Blob ? data : new Blob([data], { type: mime }));
  }

  /** Drag a splitter: calls set(px) with the new size of the pane before it (or after it with `after`). */
  static split($split, $pane, set, { min = 160, max = 900, after = false, axis = 'x' } = {}) {
    $split.addEventListener('pointerdown', e => {
      e.preventDefault();
      const start = axis === 'x' ? e.clientX : e.clientY, base = axis === 'x' ? $pane.offsetWidth : $pane.offsetHeight;
      $split.classList.add('drag');
      const move = ev => {
        const d = (axis === 'x' ? ev.clientX : ev.clientY) - start;
        set(Math.max(min, Math.min(max, base + (after ? -d : d))));
      };
      const up = () => { $split.classList.remove('drag'); removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
    });
  }

  //#region [ Highlight ]
  static #tok(s, cls) {
    return `<span class="k-${cls}">${Kit.esc(s)}</span>`;
  }

  static highlightJSON(text) {
    return text.replace(/("(?:[^"\\\n]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b|([{}[\],:])|([^"\d\-tfn{}[\],:]+|.)/g,
      (m, str, colon, num, bool, nul, punct, other) => {
        if(str) return colon ? Kit.#tok(str, 'key') + Kit.esc(colon) : Kit.#tok(str, 'string');
        if(num) return Kit.#tok(num, 'number');
        if(bool) return Kit.#tok(bool, 'boolean');
        if(nul) return Kit.#tok(nul, 'null');
        if(punct) return Kit.#tok(punct, 'punct');
        return Kit.esc(other ?? m);
      });
  }

  static #toonValue(v) {
    if(!v) return '';
    const t = v.trim();
    if(/^".*"$/.test(t)) return Kit.#tok(v, 'string');
    if(/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(t)) return Kit.#tok(v, 'number');
    if(t === 'true' || t === 'false') return Kit.#tok(v, 'boolean');
    if(t === 'null') return Kit.#tok(v, 'null');
    if(t.includes(',')) return v.split(/(,)/).map(p => (p === ',' ? Kit.#tok(',', 'punct') : Kit.#toonValue(p))).join('');
    return Kit.#tok(v, 'string');
  }

  static highlightTOON(text) {
    return text.split('\n').map(line => {
      const m = line.match(/^(\s*)(- )?([\w$.-]+|"(?:[^"\\]|\\.)*")?(\[\d+\])?(\{[^}]*\})?(:)( ?)(.*)$/);
      if(line.trimStart().startsWith('#')) return Kit.#tok(line, 'null');
      if(!m) {
        const lm = line.match(/^(\s*)(- )?(.*)$/);
        return Kit.esc(lm[1]) + (lm[2] ? Kit.#tok(lm[2], 'punct') : '') + Kit.#toonValue(lm[3]);
      }
      const [, ind, dash, key, count, fields, colon, sp, rest] = m;
      return Kit.esc(ind) + (dash ? Kit.#tok(dash, 'punct') : '') + (key ? Kit.#tok(key, 'key') : '') + (count ? Kit.#tok(count, 'head') : '')
        + (fields ? Kit.#tok(fields, 'head') : '') + Kit.#tok(colon, 'punct') + sp + Kit.#toonValue(rest);
    }).join('\n');
  }
  //#endregion
}

/**
 * Code editor: a textarea over a highlighted <pre>, a gutter with line numbers, and line marks.
 * new Kit.Code($host, { lang: 'json' | 'toon' | null, onInput(text), onCursor(line), readOnly })
 */
Kit.Code = class Code {
  static MAX_HL = 400000;   // characters: past this the text stays plain

  constructor($host, o = {}) {
    this.o = o;
    this.lang = o.lang ?? null;
    this.$ = Kit.el(`<div class="code"><div class="gut"></div><div class="body"><pre><div class="in"><div class="marks"></div><code></code></div></pre><textarea spellcheck="false" autocomplete="off"></textarea></div></div>`);
    $host.append(this.$);
    this.$gut = this.$.querySelector('.gut');
    this.$pre = this.$.querySelector('pre');
    this.$in = this.$.querySelector('.in');
    this.$code = this.$.querySelector('code');
    this.$marks = this.$.querySelector('.marks');
    this.$ta = this.$.querySelector('textarea');
    this.$ta.readOnly = !!o.readOnly;
    this.marks = [];
    this.errLine = 0;
    this.$ta.addEventListener('input', () => { this.#render(); o.onInput?.(this.value); });
    this.$ta.addEventListener('scroll', () => this.#sync());
    const cursor = () => o.onCursor?.(this.line());
    this.$ta.addEventListener('click', cursor);
    this.$ta.addEventListener('keyup', e => { if(e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key.startsWith('Page')) cursor(); });
    this.$ta.addEventListener('keydown', e => {
      if(e.key === 'Tab' && !this.$ta.readOnly) {
        e.preventDefault();
        document.execCommand('insertText', false, '  ');
      }
    });
    this.#render();
  }

  get value() {
    return this.$ta.value;
  }

  set value(v) {
    this.$ta.value = v;
    this.#render();
    this.$ta.scrollTop = 0;
    this.#sync();
  }

  setLang(lang) {
    this.lang = lang;
    this.#render();
  }

  /** Current line of the caret (1-based). */
  line() {
    return this.$ta.value.slice(0, this.$ta.selectionStart).split('\n').length;
  }

  /** Line marks: [{from, to, cls}] (1-based, inclusive). */
  mark(list) {
    this.marks = list;
    this.#drawMarks();
  }

  error(line) {
    this.errLine = line || 0;
    this.#gutter();
    this.#drawMarks();
  }

  /** Scrolls so `line` shows about a third from the top (only when it is out of view). */
  reveal(line, force = false) {
    const row = parseFloat(getComputedStyle(this.$).lineHeight) || 20;
    const y = (line - 1) * row, top = this.$ta.scrollTop, h = this.$ta.clientHeight;
    if(force || y < top || y > top + h - row * 2) this.$ta.scrollTop = Math.max(0, y - h / 3);
    this.#sync();
  }

  /** Selects whole lines from..to (for "click a card, see its text"). */
  select(from, to) {
    const lines = this.$ta.value.split('\n');
    let a = 0;
    for(let i = 0; i < from - 1; i++) a += lines[i].length + 1;
    let b = a;
    for(let i = from - 1; i < to; i++) b += (lines[i]?.length ?? 0) + 1;
    this.$ta.setSelectionRange(a, Math.max(a, b - 1));
  }

  focus() {
    this.$ta.focus();
  }

  #render() {
    const text = this.$ta.value;
    const plain = !this.lang || text.length > Code.MAX_HL;
    this.$.classList.toggle('plain', plain);
    this.$code.innerHTML = plain ? '' : (this.lang === 'json' ? Kit.highlightJSON(text) : Kit.highlightTOON(text)) + '\n';
    this.#gutter();
    this.#sync();
  }

  #gutter() {
    const n = this.$ta.value.split('\n').length;
    if(n === this.lines && this.errShown === this.errLine) return;
    this.lines = n;
    this.errShown = this.errLine;
    const out = [];
    for(let i = 1; i <= n; i++) out.push(i === this.errLine ? `<span class="e">${i}</span>` : i);
    this.$gut.innerHTML = out.join('\n') + '\n\n';
  }

  #drawMarks() {
    const row = parseFloat(getComputedStyle(this.$).lineHeight) || 20;
    const all = [...this.marks];
    if(this.errLine) all.push({ from: this.errLine, to: this.errLine, cls: 'err' });
    this.$marks.innerHTML = all.map(m => `<div class="${m.cls ?? ''}" style="top:${(m.from - 1) * row}px;height:${(m.to - m.from + 1) * row}px"></div>`).join('');
  }

  #sync() {
    const x = this.$ta.scrollLeft, y = this.$ta.scrollTop;
    this.$in.style.transform = `translate(${-x}px, ${-y}px)`;
    this.$gut.scrollTop = y;
  }
};
