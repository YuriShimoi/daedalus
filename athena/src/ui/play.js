// Play mode: the map by hand with the same rules engine. Legal actions, prep pauses before
// each wave, a log, undo, and "save as route".
class Play {
  static stack = [];   // { state, step, log }

  static toggle() {
    App.mode === 'play' ? Play.stop() : Play.start();
  }

  static start() {
    if(!App.issues.ok) {
      alert('Fix the validation errors before playing.');
      return;
    }
    SolverPanel.stop(true);
    SolverPanel.leave();
    App.mode = 'play';
    Play.stack = [{ state: DAE.Rules.init(App.model), step: null, log: ['start'] }];
    document.getElementById('btn-play').classList.add('primary');
    const $b = document.getElementById('mode-banner');
    $b.hidden = false;
    $b.textContent = 'Play mode · click a linked room to move · Esc to leave';
    document.getElementById('hint').hidden = true;
    Play.#draw();
  }

  static stop() {
    if(App.mode !== 'play') return;
    App.mode = 'edit';
    App.view = null;
    App.route = null;
    document.getElementById('btn-play').classList.remove('primary');
    document.getElementById('mode-banner').hidden = true;
    document.getElementById('hint').hidden = false;
    Playback.clear();
    App.render();
  }

  static get state() {
    return Play.stack[Play.stack.length - 1].state;
  }

  static act(a) {
    try {
      const r = DAE.Rules.apply(App.model, Play.state, a);
      Play.stack.push({ state: r.state, step: DAE.Rules.actionStr(a), log: r.log });
    }
    catch(err) {
      Play.stack[Play.stack.length - 1].log.push(err.message);
    }
    Play.#draw();
  }

  static back() {
    if(Play.stack.length > 1) Play.stack.pop();
    Play.#draw();
  }

  /** A click on a room moves there when a move is legal. */
  static clickRoom(id) {
    const a = DAE.Rules.actions(App.model, Play.state).find(x => x.a === 'move' && x.to === id);
    if(a) Play.act(a);
  }

  static #steps() {
    return Play.stack.slice(1).map(x => x.step);
  }

  static #draw() {
    const I = DAE.Icons.html;
    const s = Play.state;
    App.view = { state: s };
    App.route = Play.#steps();
    App.render();
    const acts = DAE.Rules.actions(App.model, s);
    const cls = a => a.a === 'fight' ? 'fight' : a.a === 'move' ? 'go' : '';
    const recent = Play.stack.slice(-6).map((x, k, all) => {
      const n = Play.stack.length - all.length + k;
      return `${x.step ? `<span class="cur">${n}. ${Tables.esc(x.step)}</span>` : ''}${x.log.map(l => '\n   ' + Tables.esc(l)).join('')}`;
    }).join('\n');
    const $s = SolverPanel.$side;
    $s.innerHTML = `<div class="section">Play</div>
      <div class="dock-row">
        <button id="pl-back" title="Undo (Ctrl+Z)">${I('rotate-left')} Back</button>
        <button id="pl-save" ${s.won ? 'class="primary"' : ''} title="Add this run to the map's solutions">${I('floppy-disk')} Save as route</button>
        <button id="pl-stop">${I('stop')} Leave</button>
      </div>
      ${Playback.statsCard(s)}
      <div class="section">${s.fight ? (s.fight.turn ? 'Between turns' : `Prep before wave ${s.fight.wave}`) : 'Actions'}</div>
      <div class="actions">${acts.map((a, i) => `<button class="${cls(a)}" data-a="${i}">${Tables.esc(DAE.Rules.actionStr(a))}</button>`).join('') || '<span class="muted">No actions left.</span>'}</div>
      <div class="section">Log</div>
      <div class="log">${recent}</div>`;
    $s.querySelectorAll('[data-a]').forEach($b => { $b.onclick = () => Play.act(acts[+$b.dataset.a]); });
    $s.querySelector('#pl-back').onclick = () => Play.back();
    $s.querySelector('#pl-stop').onclick = () => Play.stop();
    $s.querySelector('#pl-save').onclick = () => {
      const steps = Play.#steps();
      if(!steps.length) return;
      Play.stop();
      SolverPanel.saveRoute(steps);
    };
  }
}
