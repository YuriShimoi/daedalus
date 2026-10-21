// Dock, right column in edit mode: step through a route (slider, prev/next/play) with a stats card.
class Playback {
  static steps = null;
  static states = [];
  static logs = [];
  static index = 0;
  static error = null;
  static #timer = null;

  static clear() {
    Playback.#pause();
    if(Playback.steps && App.mode === 'edit') Playback.#banner(false);
    Playback.steps = null;
    App.route = null;
    App.view = null;
    SolverPanel.$side.innerHTML = '<div class="section">Playback</div><div class="empty">Pick a route to step through it.</div>';
  }

  static show(steps) {
    Playback.#pause();
    Playback.steps = steps;
    Playback.index = 0;
    Playback.#banner(true);
    Playback.refresh();
  }

  /** Route view banner on the canvas, like play mode's. */
  static #banner(on) {
    const $b = document.getElementById('mode-banner');
    $b.hidden = !on;
    $b.textContent = 'Route view · Esc to leave';
    document.getElementById('hint').hidden = on;
  }

  /** Re-runs the route on the current map (after edits too). */
  static refresh() {
    if(!Playback.steps) return;
    const r = DAE.Rules.replay(App.model, Playback.steps);
    Playback.states = r.states;
    Playback.logs = r.log;
    Playback.error = r.error ? `step ${r.at + 1}: ${r.error}` : null;
    Playback.index = Math.min(Playback.index, Playback.states.length - 1);
    Playback.go(Playback.index);
  }

  static go(i) {
    Playback.index = Math.max(0, Math.min(i, Playback.states.length - 1));
    App.route = Playback.steps;
    App.view = { state: Playback.states[Playback.index] };
    App.render();
    Playback.#draw();
  }

  static #play() {
    if(Playback.#timer) return Playback.#pause();
    if(Playback.index >= Playback.states.length - 1) Playback.index = 0;
    Playback.#timer = setInterval(() => {
      if(Playback.index >= Playback.states.length - 1) return Playback.#pause();
      Playback.go(Playback.index + 1);
    }, 650);
    Playback.#draw();
  }

  static #pause() {
    clearInterval(Playback.#timer);
    Playback.#timer = null;
    Playback.#playIcon();
  }

  static #playIcon() {
    const $b = SolverPanel.$side.querySelector('#pb-play');
    if(!$b) return;
    $b.innerHTML = DAE.Icons.html(Playback.#timer ? 'pause' : 'play');
    $b.title = Playback.#timer ? 'Pause' : 'Play';
  }

  /** The controls are built once per route and then only updated, so a click during playback isn't lost to a re-render. */
  static #draw() {
    const I = DAE.Icons.html;
    const $s = SolverPanel.$side;
    if(!$s.querySelector('#pb-range')) {
      $s.innerHTML = `<div class="section">Playback <button class="sec-btn" id="pb-leave" title="Leave the route view (Esc)">${I('stop')} Leave</button></div>
        <div class="slider">
          <button id="pb-prev" title="Previous step">${I('backward-step')}</button>
          <button id="pb-play"></button>
          <button id="pb-next" title="Next step">${I('forward-step')}</button>
          <input type="range" id="pb-range" min="0">
          <span class="progress" id="pb-progress"></span>
        </div>
        <div id="pb-body"></div>`;
      $s.querySelector('#pb-prev').onclick = () => { Playback.#pause(); Playback.go(Playback.index - 1); };
      $s.querySelector('#pb-next').onclick = () => { Playback.#pause(); Playback.go(Playback.index + 1); };
      $s.querySelector('#pb-play').onclick = () => Playback.#play();
      $s.querySelector('#pb-leave').onclick = () => SolverPanel.leave();
      $s.querySelector('#pb-range').oninput = e => { Playback.#pause(); Playback.go(+e.target.value); };
    }
    const n = Playback.states.length - 1;
    const i = Playback.index;
    const cur = Playback.logs[i - 1];
    const $r = $s.querySelector('#pb-range');
    $r.max = n;
    $r.value = i;
    $r.style.setProperty('--p', n ? i / n : 0);   // 0..1, as shared/ui.js sets it
    $s.querySelector('#pb-progress').textContent = `${i}/${n}`;
    Playback.#playIcon();
    $s.querySelector('#pb-body').innerHTML = `${Playback.statsCard(Playback.states[i])}
      <div class="log">${cur ? `<span class="cur">${i}. ${Tables.esc(cur.step)}</span>${cur.log.map(l => '\n   ' + Tables.esc(l)).join('')}` : 'start'}${Playback.error ? `\n<span class="chip bad">${Tables.esc(Playback.error)}</span>` : ''}</div>`;
  }

  /** HP, STR, DEF, slots, bag and effects at a state. */
  static statsCard(s) {
    const st = DAE.Effects.player(DAE.Rules.ctx(App.model), s);
    const slots = Object.entries(s.slots).map(([k, e]) => `${Tables.esc(k)}: <b>${e ? Tables.itemIcon(e.id) + Tables.esc(e.id) + (e.u !== null ? ` (${e.u})` : '') : '—'}</b>`).join(' · ');
    const bag = s.bag.map(e => Tables.itemIcon(e.id) + Tables.esc(e.id) + (e.u !== null && e.u > 1 ? `×${e.u}` : '')).join(', ');
    const status = s.dead ? '<span class="chip bad">dead</span>' : s.won ? '<span class="chip good">exit reached</span>'
      : s.fight ? `<span class="chip warn">fight · wave ${s.fight.wave}</span>` : '';
    return `<div class="stats">
        <span class="k">room</span><span>${Tables.esc(s.room)}</span><span class="k">hp</span><span>${s.hp}/${st.maxhp}</span>
        <span class="k">str</span><span>${st.str}</span><span class="k">def</span><span>${st.def}${st.invuln ? ' ✦' : ''}</span>
      </div>
      <div class="kv">${status} ${slots || '<span class="muted">no slots</span>'}</div>
      ${App.model.player.inventory ? `<div class="kv">bag: <b>${bag || '—'}</b></div>` : ''}
      <div class="kv">effects: <b>${s.fx.map(f => `${Tables.esc(f.id)}${f.t !== 'perm' ? ` (${f.t})` : ''}`).join(', ') || '—'}</b></div>`;
  }
}
