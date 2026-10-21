// Scale page: a dice set (D4 to D100), formulas like (3D6+1D12)*2+1D100, the last roll with every
// die, the odds of the formula, a roll history and saved formulas.
(() => {
  const { Dice } = DAE;
  const st = { api: null, set: [...Dice.DEFAULT_SET], formula: '(3D6+1D12)*2+1D100', last: null, history: [], saved: [{ name: 'Fireball', formula: '8d6' }, { name: 'Ability score', formula: '4d6kh3' }, { name: 'Advantage', formula: 'adv+5' }], filter: '', at: '' };
  let $;

  const html = `
    <div class="sc">
      <section class="sc-main scroll">
        <div class="sc-top">
          <div class="sc-f"><input class="sc-in mono" spellcheck="false" placeholder="(3D6+1D12)*2+1D100"><button class="primary sc-roll" data-a="roll">${Kit.icon('dice-d20')}Roll</button></div>
          <div class="sc-err"></div>
          <div class="sc-dice"></div>
          <div class="sc-set"><span class="lbl">Dice set</span><span class="sc-chips"></span><input class="sc-add mono" placeholder="D7" title="Add a die: 4 to 100 sides"><button class="ghost" data-a="reset" title="Back to D4 D6 D8 D10 D12 D20 D100">reset</button></div>
          <p class="muted sc-help">Click a die to roll it, Shift+click to add it to the formula. Formulas: <code>NdS</code>, <code>+ − × ÷</code> (whole numbers), <code>( )</code>, keep / drop <code>4d6kh3 2d20kl1 5d8dl2</code>, explode <code>d6!</code>, reroll low once <code>d10r2</code>, <code>adv</code> / <code>dis</code>, <code>d%</code>.</p>
        </div>
        <div class="sc-result"></div>
        <div class="sc-odds"></div>
      </section>
      <aside class="pane sc-side">
        <div class="bar"><span class="lbl">Saved</span><span style="flex:1"></span><button class="ghost" data-a="save" title="Save the formula with a name">${Kit.icon('plus')}Save</button></div>
        <div class="sc-saved"></div>
        <div class="bar"><span class="lbl">History</span><span style="flex:1"></span><input class="sc-filter" placeholder="filter" spellcheck="false"><button class="ghost ic-only" data-a="clear" title="Clear (keeps pinned)">${Kit.icon('trash')}</button></div>
        <div class="sc-hist scroll"></div>
      </aside>
    </div>`;

  //#region [ Draw ]
  const dieSvg = (sides, v, cls = '') => {
    const shape = { 4: 'M16 3 30 28H2Z', 6: 'M4 4h24v24H4Z', 8: 'M16 2 30 16 16 30 2 16Z', 10: 'M16 2 30 13 16 30 2 13Z', 12: 'M16 2 29 11 24 27H8L3 11Z', 20: 'M16 2 29 9V23L16 30 3 23V9Z' }[sides] ?? 'M16 2a14 14 0 1 0 .1 0Z';
    return `<span class="sc-die ${cls}" title="D${sides}"><svg viewBox="0 0 32 32"><path d="${shape}"/></svg><b>${v}</b></span>`;
  };

  const drawDice = () => {
    $.querySelector('.sc-dice').innerHTML = st.set.map(s => `<button class="sc-qd" data-d="${s}" title="Roll 1D${s} (Shift: add to formula)">${dieSvg(s, `D${s}`)}</button>`).join('');
    $.querySelector('.sc-chips').innerHTML = st.set.map(s => `<span class="chip">D${s}<button class="ghost ic-only" data-rm="${s}" title="Remove D${s}">${Kit.icon('xmark')}</button></span>`).join('');
  };

  const drawResult = () => {
    const r = st.last, $r = $.querySelector('.sc-result');
    if(!r) { $r.innerHTML = `<div class="empty"><div class="big">${Kit.icon('scale-balanced')}</div>Roll something.</div>`; return; }
    $r.innerHTML = `<div class="sc-total"><b>${r.total}</b><span class="mono">${Kit.esc(r.formula)}</span></div>
      <div class="sc-shown mono">${Kit.esc(r.shown)}</div>
      <div class="sc-groups">${r.groups.map(g => `<div class="sc-g"><span class="lbl">${Kit.esc(g.text)}</span><div class="sc-gd">${g.rolls.map(d => dieSvg(g.sides, d.v, [d.drop && 'drop', d.exploded && 'boom', d.v === g.sides && 'max', d.v === 1 && 'min'].filter(Boolean).join(' ')) + (d.was !== undefined ? `<span class="sc-was" title="rerolled from ${d.was}">↺${d.was}</span>` : '')).join('')}</div><em>= ${g.sum}</em></div>`).join('')}</div>`;
  };

  const drawOdds = () => {
    const $o = $.querySelector('.sc-odds');
    let o;
    try { o = Dice.odds(st.formula, { set: st.set }); } catch { $o.innerHTML = ''; return; }
    const pmax = Math.max(...o.dist.map(([, p]) => p));
    const W = 640, H = 120, n = o.dist.length, bw = W / Math.max(1, n);
    const x = +st.at || Math.round(o.mean);
    const ge = Dice.chance(o, x), le = Dice.chance(o, x, true);
    const bars = o.dist.map(([v, p], i) => `<rect x="${i * bw + (bw > 3 ? .5 : 0)}" y="${H - p / pmax * H}" width="${Math.max(.6, bw - (bw > 3 ? 1 : 0))}" height="${p / pmax * H}" fill="${v >= x ? '#CD7F32' : '#525568'}"><title>${v}: ${(p * 100).toFixed(2)}%</title></rect>`).join('');
    $o.innerHTML = `<div class="section">Odds of ${Kit.esc(Dice.text(Dice.parse(st.formula, st.set)))} <span class="muted">${o.exact ? 'exact' : 'from 20,000 rolls'}</span></div>
      <div class="sc-stats"><span>min <b>${o.min}</b></span><span>mean <b>${o.mean.toFixed(2)}</b></span><span>max <b>${o.max}</b></span>
        <span class="sc-at">chance of ≥ <input type="number" class="sc-x" value="${x}"> <b>${(ge * 100).toFixed(2)}%</b> · ≤ ${x}: <b>${(le * 100).toFixed(2)}%</b></span></div>
      <svg class="sc-chart" viewBox="0 0 ${W} ${H + 16}" preserveAspectRatio="none">${bars}<text x="0" y="${H + 13}" class="t">${o.min}</text><text x="${W}" y="${H + 13}" text-anchor="end" class="t">${o.max}</text></svg>`;
  };

  const ago = t => { const s = (Date.now() - t) / 1000; return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : new Date(t).toLocaleDateString(); };
  const drawSide = () => {
    $.querySelector('.sc-saved').innerHTML = st.saved.map((s, i) => `<div class="sc-sv" data-sv="${i}" title="Click: roll · ${Kit.esc(s.formula)}"><span>${Kit.esc(s.name)}</span><code>${Kit.esc(s.formula)}</code><button class="ghost ic-only" data-a="unsave" data-i="${i}">${Kit.icon('xmark')}</button></div>`).join('') || '<p class="muted sc-note">No saved formulas.</p>';
    const q = st.filter.toLowerCase();
    const list = st.history.map((h, i) => ({ ...h, i })).filter(h => !q || h.formula.toLowerCase().includes(q) || String(h.total) === q);
    $.querySelector('.sc-hist').innerHTML = list.slice(0, 300).map(h => `<div class="sc-h${h.pin ? ' pin' : ''}" data-h="${h.i}">
      <b>${h.total}</b><div><code>${Kit.esc(h.formula)}</code><span class="muted">${Kit.esc(h.shown.replace(/ = -?\d+$/, ''))}</span></div>
      <em>${ago(h.time)}</em>
      <span class="sc-ha"><button class="ghost ic-only" data-a="pin" title="Pin">${Kit.icon('thumbtack')}</button><button class="ghost ic-only" data-a="again" title="Roll again">${Kit.icon('arrows-rotate')}</button><button class="ghost ic-only" data-a="copy" title="Copy">${Kit.icon('copy')}</button></span></div>`).join('') || '<p class="muted sc-note">No rolls yet.</p>';
  };
  //#endregion

  //#region [ Actions ]
  const check = () => {
    const $e = $.querySelector('.sc-err');
    try { Dice.parse(st.formula, st.set); $e.textContent = ''; $.querySelector('.sc-in').classList.remove('bad'); return true; }
    catch(err) { $e.textContent = err.message; $.querySelector('.sc-in').classList.add('bad'); return false; }
  };
  const roll = (formula = st.formula) => {
    let r;
    try { r = Dice.roll(formula, { set: st.set }); }
    catch(err) { st.api.toast(err.message, true); return; }
    st.last = r;
    st.history.unshift({ formula: r.formula, total: r.total, shown: r.shown, time: Date.now(), groups: r.groups.map(g => ({ text: g.text, sides: g.sides, rolls: g.rolls })) });
    const pins = st.history.filter(h => h.pin), rest = st.history.filter(h => !h.pin).slice(0, 500);
    st.history = st.history.filter(h => h.pin || rest.includes(h));
    void pins;
    drawResult(); drawSide();
    const $t = $.querySelector('.sc-total b');
    $t?.animate([{ transform: 'scale(.7)', opacity: .3 }, { transform: 'scale(1.08)' }, { transform: 'scale(1)', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.34,1.56,.64,1)' });
    save();
  };
  const save = () => st.api.later('state', () => ({ set: st.set, formula: st.formula, history: st.history, saved: st.saved }), 400);
  const setFormula = f => { st.formula = f; $.querySelector('.sc-in').value = f; if(check()) drawOdds(); save(); };
  //#endregion

  const mount = api => {
    st.api = api;
    $ = api.$el;
    $.innerHTML = html;
    api.actions([
      ['download', 'History', () => Kit.download('rolls.csv', 'time,formula,total,dice\n' + st.history.map(h => `${new Date(h.time).toISOString()},"${h.formula}",${h.total},"${h.groups.map(g => `${g.text}:${g.rolls.map(d => (d.drop ? `(${d.v})` : d.v)).join(' ')}`).join(' | ')}"`).join('\n'), 'text/csv'), { title: 'History as CSV' }],
      ['dice-d20', 'Roll', () => roll(), { primary: true, title: 'Roll (Enter)' }],
    ]);
    const $in = $.querySelector('.sc-in');
    $in.addEventListener('input', Kit.later(() => { st.formula = $in.value; if(check()) drawOdds(); save(); }, 200));
    $in.addEventListener('keydown', e => { if(e.key === 'Enter') { st.formula = $in.value; if(check()) roll(); } });
    $.querySelector('.sc-add').addEventListener('keydown', e => {
      if(e.key !== 'Enter') return;
      const n = +e.target.value.replace(/\D/g, '');
      if(n < Dice.MIN_SIDES || n > Dice.MAX_SIDES) return api.toast(`Dice go from D${Dice.MIN_SIDES} to D${Dice.MAX_SIDES}`, true);
      if(!st.set.includes(n)) st.set = [...st.set, n].sort((a, b) => a - b);
      e.target.value = '';
      drawDice(); check(); drawOdds(); save();
    });
    $.querySelector('.sc-filter').addEventListener('input', e => { st.filter = e.target.value.trim(); drawSide(); });
    $.addEventListener('input', e => { if(e.target.classList.contains('sc-x')) { st.at = e.target.value; const p = e.target.selectionStart; drawOdds(); const $x = $.querySelector('.sc-x'); $x.focus(); $x.setSelectionRange(p, p); } });
    $.addEventListener('click', e => {
      const $d = e.target.closest('[data-d]');
      if($d) {
        const d = +$d.dataset.d;
        if(e.shiftKey) setFormula(st.formula.trim() ? `${st.formula}+1D${d}` : `1D${d}`);
        else roll(`1D${d}`);
        return;
      }
      const $rm = e.target.closest('[data-rm]');
      if($rm) { st.set = st.set.filter(s => s !== +$rm.dataset.rm); drawDice(); check(); drawOdds(); save(); return; }
      const a = e.target.closest('[data-a]')?.dataset.a;
      const $sv = e.target.closest('[data-sv]');
      if($sv && !a) { setFormula(st.saved[+$sv.dataset.sv].formula); roll(); return; }
      const $h = e.target.closest('[data-h]'), h = $h && st.history[+$h.dataset.h];
      if(!a) { if(h) setFormula(h.formula); return; }
      if(a === 'roll') { st.formula = $in.value; if(check()) roll(); }
      if(a === 'reset') { st.set = [...Dice.DEFAULT_SET]; drawDice(); check(); drawOdds(); save(); }
      if(a === 'save') { const name = prompt('Name for this formula', st.formula); if(name) { st.saved.push({ name, formula: st.formula }); drawSide(); save(); } }
      if(a === 'unsave') { st.saved.splice(+e.target.closest('[data-i]').dataset.i, 1); drawSide(); save(); }
      if(a === 'clear') { st.history = st.history.filter(x => x.pin); drawSide(); save(); }
      if(a === 'pin' && h) { h.pin = !h.pin; drawSide(); save(); }
      if(a === 'again' && h) { setFormula(h.formula); roll(); }
      if(a === 'copy' && h) Kit.copy(`${h.formula} → ${h.shown}`, 'Roll copied');
    });
    api.get('state').then(s => {
      if(s) Object.assign(st, { set: s.set ?? st.set, formula: s.formula ?? st.formula, history: s.history ?? [], saved: s.saved ?? st.saved });
      $in.value = st.formula;
      drawDice(); check(); drawResult(); drawOdds(); drawSide();
    });
  };

  Hub.register('scale', {
    mount,
    keys(e) {
      if(/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
      if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); roll(); }
    },
  });
})();
