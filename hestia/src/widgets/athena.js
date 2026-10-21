// Athena widget: the map with every room, passage and icon at its saved position, and a step bar
// that replays the map's solution (◀ step label ▶). Wheel zooms and drag pans inside the window.
const ATHENA_CORE = ['model', 'effects', 'events', 'rules', 'layout', 'svg'].map(f => `../athena/src/core/${f}.js`);

class AthenaWidget extends Widget {
  model = null;
  route = 0;
  step = 0;
  replay = null;
  box = null;     // viewBox [x, y, w, h]
  full = null;

  async mount() {
    await Widgets.load(ATHENA_CORE);
    const text = this.text();
    if(!text) throw new Error('no map in this widget');
    this.model = DAE.Model.parse(text);
    if(!this.model.rooms.length) throw new Error('the map has no rooms');
    this.$body.innerHTML = `<div class="aw-map"></div><div class="aw-bar"><button data-s="prev" title="Previous step">${DAE.Icons.html('backward-step')}</button>
      <span class="lab"></span><button data-s="fit" title="Fit the map in the view (or double-click the map)">${DAE.Icons.html('expand')}</button><select class="aw-route" title="Route"></select><button data-s="next" title="Next step">${DAE.Icons.html('forward-step')}</button></div>`;
    this.$map = this.own(this.$body.querySelector('.aw-map'));
    this.own(this.$body.querySelector('.aw-bar'));
    const sols = this.model.solutions;
    const $r = this.$body.querySelector('.aw-route');
    $r.innerHTML = sols.map((s, i) => `<option value="${i}">${DAE.Markdown.esc(s.id)} · ${s.steps.length} steps</option>`).join('');
    $r.style.display = sols.length > 1 ? '' : 'none';
    $r.onchange = () => { this.route = Number($r.value); this.#prepare(); this.go(0); };
    this.$body.querySelector('[data-s=prev]').onclick = () => this.go(this.step - 1);
    this.$body.querySelector('[data-s=next]').onclick = () => this.go(this.step + 1);
    this.$body.querySelector('[data-s=fit]').onclick = () => this.fit();
    this.#bindView();
    this.#prepare();
    this.go(0);
  }

  get steps() {
    return this.model.solutions[this.route]?.steps ?? [];
  }

  #prepare() {
    this.replay = this.steps.length ? DAE.Rules.replay(this.model, this.steps) : null;
  }

  /** Shows the state after step i (0 = start). */
  go(i) {
    const n = this.replay ? this.replay.states.length - 1 : 0;
    this.step = Math.max(0, Math.min(n, i));
    const state = this.replay?.states[this.step];
    const svg = DAE.Svg.render(this.model, { state, route: this.steps.slice(0, this.step) });
    const vb = /viewBox="([^"]+)"/.exec(svg)[1].split(' ').map(Number);
    if(!this.full || this.full.join() !== vb.join()) { this.full = vb; this.box = [...vb]; }
    this.$map.innerHTML = svg.replace(/ width="[^"]+" height="[^"]+"/, '');
    this.#applyBox();
    const $l = this.$body.querySelector('.lab'), total = this.steps.length;
    $l.classList.remove('err');
    if(!total) $l.innerHTML = '<small>no route</small>start';
    else if(this.step === 0) $l.innerHTML = `<small>0/${total}</small>start`;
    else $l.innerHTML = `<small>${this.step}/${total}</small>${DAE.Markdown.esc(this.steps[this.step - 1])}`;
    if(this.replay?.error && this.step === n && n < total) {
      $l.classList.add('err');
      $l.innerHTML += ` · stops: ${DAE.Markdown.esc(this.replay.error)}`;
    }
    this.$body.querySelector('[data-s=prev]').disabled = this.step === 0;
    this.$body.querySelector('[data-s=next]').disabled = this.step >= n;
  }

  #applyBox() {
    this.$map.querySelector('svg')?.setAttribute('viewBox', this.box.join(' '));
  }

  #bindView() {
    const $m = this.$map;
    $m.addEventListener('wheel', e => {
      if(e.ctrlKey) return;   // Ctrl+wheel zooms the board
      e.preventDefault();
      e.stopPropagation();
      const r = $m.getBoundingClientRect(), [x, y, w, h] = this.box, f = Math.exp(e.deltaY * 0.0015);
      const s = Math.max(w / r.width, h / r.height), ox = x - (s * r.width - w) / 2, oy = y - (s * r.height - h) / 2;
      const px = ox + (e.clientX - r.left) * s, py = oy + (e.clientY - r.top) * s;
      const nw = Math.min(this.full[2] * 4, Math.max(40, w * f)), nh = nw * h / w;
      this.box = [px - (px - x) * nw / w, py - (py - y) * nh / h, nw, nh];
      this.#applyBox();
    }, { passive: false });
    $m.addEventListener('pointerdown', e => {
      if(e.button !== 0) return;
      // map units per screen pixel (the board zoom is already in the rect)
      const r = $m.getBoundingClientRect(), [, , w, h] = this.box, s = Math.max(w / r.width, h / r.height);
      let lx = e.clientX, ly = e.clientY;
      $m.setPointerCapture(e.pointerId);
      $m.onpointermove = ev => {
        this.box[0] -= (ev.clientX - lx) * s;
        this.box[1] -= (ev.clientY - ly) * s;
        lx = ev.clientX; ly = ev.clientY;
        this.#applyBox();
      };
      $m.onpointerup = () => { $m.onpointermove = $m.onpointerup = null; };
    });
    $m.addEventListener('dblclick', e => { e.stopPropagation(); this.fit(); });
  }

  /** Shows every room. */
  fit() {
    this.box = [...this.full];
    this.#applyBox();
  }

  menu() {
    return [['Fit map', 'expand', () => this.fit()]];
  }

  /** Picture for export: the map at the current step, fitted in w x h. */
  exportSvg(w, h) {
    if(!this.model) return '';
    const svg = DAE.Svg.render(this.model, { state: this.replay?.states[this.step], route: this.steps.slice(0, this.step), standalone: true });
    const lab = this.$body.querySelector('.lab')?.textContent ?? '';
    return `<svg x="0" y="30" width="${w}" height="${h - 64}" viewBox="${this.box.join(' ')}">${svg.replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg>`
      + `<rect x="0" y="${h - 34}" width="${w}" height="34" fill="#1A1A1A"/><text x="10" y="${h - 12}" font-size="12" font-family="Consolas, monospace" fill="#FFFFFF">${DAE.Markdown.esc(lab)}</text>`;
  }
}

Widgets.register('athena', AthenaWidget);
