// Dock, left and middle: quick check chip, solver run/stop with live progress, route list.
class SolverPanel {
  static $check = null;
  static $routes = null;
  static $side = null;      // right column: playback or play mode
  static run = null;
  static routes = [];       // { steps, score?, hp?, ... , saved? }
  static current = -1;
  static quick = null;

  static init($dock) {
    const I = DAE.Icons.html;
    $dock.innerHTML = `<div id="dock-solver">
        <div class="section">Quick check</div>
        <div class="dock-row"><button id="qc-run">${I('circle-check')} Quick check</button><span id="qc-chip"></span></div>
        <div class="note" id="qc-detail"></div>
        <div class="section">Full search</div>
        <div class="dock-row">
          <select id="sv-top" title="routes to keep"><option value="1">top 1</option><option value="3" selected>top 3</option></select>
          <select id="sv-mode"><option value="safe">safe</option><option value="weighted">weighted</option></select>
          <button id="sv-run" class="primary">${I('play')} Solve</button>
        </div>
        <div class="progress" id="sv-progress"></div>
      </div>
      <div id="dock-routes"><div class="section">Routes</div><div class="routes" id="routes"></div></div>
      <div id="dock-side"></div>`;
    SolverPanel.$check = $dock.querySelector('#qc-chip');
    SolverPanel.$routes = $dock.querySelector('#routes');
    SolverPanel.$side = $dock.querySelector('#dock-side');
    $dock.querySelector('#qc-run').onclick = () => SolverPanel.quickCheck();
    $dock.querySelector('#sv-run').onclick = () => SolverPanel.run ? SolverPanel.stop() : SolverPanel.solve();
  }

  /** A new map: saved solutions become the route list. */
  static reset() {
    SolverPanel.stop(true);
    SolverPanel.quick = null;
    SolverPanel.routes = App.model.solutions.map(s => ({ steps: s.steps, saved: true, id: s.id }));
    SolverPanel.current = -1;
    document.getElementById('sv-mode').value = App.model.score.mode;
    document.getElementById('sv-progress').textContent = '';
    SolverPanel.#chip();
    SolverPanel.#list();
    Playback.clear();
  }

  static modelChanged() {
    // results describe the old map: keep the list, but mark the quick check as stale
    if(SolverPanel.quick) {
      SolverPanel.quick = null;
      App.marks = new Set();
      SolverPanel.#chip();
    }
    if(SolverPanel.current >= 0 && App.mode === 'edit') Playback.refresh();
  }

  //#region [ Quick check ]
  static quickCheck() {
    const r = DAE.Check.run(App.model);
    SolverPanel.quick = r;
    App.marks = new Set((r.blockers ?? []).map(b => b.id));
    if(r.route) {
      SolverPanel.routes = [{ steps: r.route, label: 'enemy-free route' }, ...SolverPanel.routes.filter(x => x.label !== 'enemy-free route')];
      SolverPanel.#list();
      SolverPanel.select(0);
    }
    else App.render();
    SolverPanel.#chip();
  }

  static #chip() {
    const r = SolverPanel.quick;
    const $d = document.getElementById('qc-detail');
    if(!r) {
      SolverPanel.$check.innerHTML = '';
      $d.textContent = 'Links, locks and keys, then an enemy-free route. No combat simulation.';
      return;
    }
    const cls = { 'no-path': 'bad', locks: 'bad', 'no-route': 'bad', 'no-enemies': 'good', combat: 'info' }[r.verdict];
    SolverPanel.$check.innerHTML = `<span class="chip ${cls}">${Tables.esc(r.label)}</span>`;
    $d.innerHTML = r.blockers?.length
      ? 'Blocked: ' + r.blockers.map(b => `<b>${Tables.esc(b.id)}</b>${b.need.length ? ' needs ' + Tables.esc(b.need.join(' + ')) : ''}`).join(' · ')
      : r.verdict === 'combat' ? 'Every way to an exit goes through enemies. Run the full search.'
      : r.route ? `Route of ${r.route.length} steps, shown in the list.` : '';
  }
  //#endregion

  //#region [ Full search ]
  static solve() {
    if(SolverPanel.run) return;
    if(!App.issues.ok) {
      document.getElementById('sv-progress').textContent = 'Fix the validation errors first.';
      return;
    }
    const opts = { top: +document.getElementById('sv-top').value, mode: document.getElementById('sv-mode').value };
    const $btn = document.getElementById('sv-run');
    const $prog = document.getElementById('sv-progress');
    $btn.innerHTML = `${DAE.Icons.html('stop')} Stop`;
    $btn.classList.remove('primary');
    $prog.textContent = 'starting…';
    const model = App.model;
    SolverPanel.run = DAE.Solver.start(model, opts, {
      onProgress: p => { $prog.textContent = `${p.states} states · ${(p.ms / 1000).toFixed(1)} s · ${p.found} route${p.found === 1 ? '' : 's'}${p.best !== undefined ? ' · best ' + p.best : ''}`; },
      onDone: r => {
        SolverPanel.run = null;
        $btn.innerHTML = `${DAE.Icons.html('play')} Solve`;
        $btn.classList.add('primary');
        $prog.textContent = `${r.label} · ${r.states} states · ${(r.ms / 1000).toFixed(1)} s`;
        if(model !== App.model) return; // the map changed while solving
        SolverPanel.routes = r.routes.map(x => ({ ...x }));
        SolverPanel.#list();
        if(r.routes.length) SolverPanel.select(0);
      },
    });
  }

  static stop(silent = false) {
    if(!SolverPanel.run) return;
    SolverPanel.run.stop();
    if(silent) SolverPanel.run = null;
  }
  //#endregion

  //#region [ Routes ]
  static #list() {
    const $r = SolverPanel.$routes;
    if(!SolverPanel.routes.length) {
      $r.innerHTML = '<div class="empty">No routes yet. Run the quick check or the full search.</div>';
      return;
    }
    $r.innerHTML = SolverPanel.routes.map((x, i) => `<div class="route${i === SolverPanel.current ? ' on' : ''}" data-i="${i}">
        <span class="n">${i + 1}</span>
        <span>${x.label ?? (x.saved ? `saved ${Tables.esc(x.id)}` : `score ${x.score}`)}<br><span class="meta">${x.steps.length} steps${x.hp !== undefined ? ` · hp ${x.hp}/${x.maxhp} · ${x.kills} kills${x.cleared ? ' · cleared' : ''}` : ''}</span></span>
        <span class="route-btns"><button class="del" data-script="${i}" title="Script: every step of the route">${DAE.Icons.html('scroll')}</button>${x.saved ? '' : `<button class="del" data-save="${i}" title="Save into the map (solutions)">${DAE.Icons.html('floppy-disk')}</button>`}</span>
      </div>`).join('');
    $r.querySelectorAll('.route').forEach($x => { $x.onclick = e => { if(!e.target.closest('[data-save], [data-script]')) SolverPanel.select(+$x.dataset.i); }; });
    $r.querySelectorAll('[data-script]').forEach($b => { $b.onclick = () => SolverPanel.script(+$b.dataset.script); });
    $r.querySelectorAll('[data-save]').forEach($b => { $b.onclick = () => SolverPanel.saveRoute(SolverPanel.routes[+$b.dataset.save].steps); });
  }

  /** Every step of a route in a dialog; a click on a step shows the route at that step. */
  static script(i) {
    const I = DAE.Icons.html;
    const x = SolverPanel.routes[i];
    const $d = document.getElementById('script-dialog');
    $d.innerHTML = `<h3>${I('scroll')} Route ${i + 1} script <span class="muted">· ${x.steps.length} steps</span></h3>
      <ol class="script">${x.steps.map((st, k) => `<li data-k="${k}">${Tables.esc(st)}</li>`).join('')}</ol>
      <div class="buttons"><button id="sc-copy">${I('copy')} Copy</button><button class="primary" id="sc-close">Close</button></div>`;
    $d.querySelectorAll('li').forEach($li => {
      $li.onclick = () => {
        if(SolverPanel.current !== i) SolverPanel.select(i);
        Playback.go(+$li.dataset.k + 1);
        $d.close();
      };
    });
    $d.querySelector('#sc-copy').onclick = () => navigator.clipboard?.writeText(x.steps.join('\n'));
    $d.querySelector('#sc-close').onclick = () => $d.close();
    $d.showModal();
  }

  static select(i) {
    if(App.mode === 'play') Play.stop();
    SolverPanel.current = i;
    SolverPanel.#list();
    Playback.show(SolverPanel.routes[i].steps);
  }

  /** Leaves the route view: no route picked, quick check marks cleared, map back to plain editing. */
  static leave() {
    SolverPanel.current = -1;
    SolverPanel.#list();
    App.marks = new Set();
    Playback.clear();
    App.render();
  }

  static saveRoute(steps) {
    App.edit(m => {
      let n = m.solutions.length;
      while(m.solutions.some(s => s.id === `s${n}`)) n++;
      m.solutions.push({ id: `s${n}`, steps: [...steps] });
    });
    SolverPanel.routes = [...App.model.solutions.map(s => ({ steps: s.steps, saved: true, id: s.id })),
      ...SolverPanel.routes.filter(r => !r.saved && r.steps.join(';') !== steps.join(';'))];
    SolverPanel.current = -1;
    SolverPanel.#list();
  }
  //#endregion
}
