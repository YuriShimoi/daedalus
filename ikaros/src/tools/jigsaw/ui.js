// Jigsaw page: a chain of cipher steps between two live texts (type in either one), glyph ciphers
// drawn as SVG, and helpers: try all, letter frequency, Vigenère key guess, anagrams, word search.
(() => {
  const { Cipher, Menu } = DAE;
  const st = { api: null, steps: [{ id: 'vigenere', opts: { key: 'LEMON' } }], lang: 'en', side: 'crack', glyph: 'pigpen', ws: null, busy: false };
  let $;

  const html = `
    <div class="jg">
      <aside class="pane jg-steps scroll">
        <div class="bar"><span class="lbl">Chain</span><span style="flex:1"></span><button class="ghost" data-a="add">${Kit.icon('plus')}Step</button></div>
        <div class="jg-list"></div>
        <p class="muted jg-note">Encode runs the steps top to bottom, decode bottom to top. Type in either text.</p>
      </aside>
      <section class="jg-mid">
        <div class="pane jg-box"><div class="bar"><span class="lbl">Plain</span><span style="flex:1"></span><span class="jg-n" data-n="plain"></span>
          <button class="ghost ic-only" data-a="copy-plain" title="Copy">${Kit.icon('copy')}</button><button class="ghost ic-only" data-a="clear" title="Clear both">${Kit.icon('xmark')}</button></div>
          <textarea data-t="plain" spellcheck="false" placeholder="Plain text…"></textarea></div>
        <div class="jg-arrow"><span>${Kit.icon('chevron-down')} encode</span><span class="jg-err"></span><span>decode ${Kit.icon('chevron-down', 'up')}</span></div>
        <div class="pane jg-box"><div class="bar"><span class="lbl">Cipher</span><span style="flex:1"></span><span class="jg-n" data-n="cipher"></span>
          <button class="ghost ic-only" data-a="copy-cipher" title="Copy">${Kit.icon('copy')}</button></div>
          <textarea data-t="cipher" spellcheck="false" placeholder="Cipher text…"></textarea></div>
      </section>
      <aside class="pane jg-side">
        <div class="bar"><span class="seg" data-k="side"><button data-v="crack">Crack</button><button data-v="glyphs">Glyphs</button><button data-v="words">Words</button></span><span style="flex:1"></span>
          <span class="seg" data-k="lang" title="Language for scores, frequencies and word lists"><button data-v="en">EN</button><button data-v="pt">PT</button></span></div>
        <div class="jg-side-in scroll"></div>
      </aside>
    </div>`;

  //#region [ Steps ]
  const groups = () => {
    const g = new Map();
    for(const c of Cipher.LIST) { if(!g.has(c.group)) g.set(c.group, []); g.get(c.group).push(c); }
    return g;
  };
  const optField = (s, i, o) => {
    const v = s.opts[o.k] ?? o.def;
    const at = `data-step="${i}" data-opt="${o.k}"`;
    if(o.type === 'select') return `<label class="field"><span>${o.label}</span><select ${at}>${o.options.map(x => `<option${x === v ? ' selected' : ''}>${x}</option>`).join('')}</select></label>`;
    if(o.type === 'area') return `<label class="field"><span>${o.label}</span><textarea rows="3" ${at}>${Kit.esc(v)}</textarea></label>`;
    if(o.type === 'int') return `<label class="field"><span>${o.label}</span><input type="number" ${at} value="${v}"${o.min !== undefined ? ` min="${o.min}"` : ''}${o.max !== undefined ? ` max="${o.max}"` : ''}></label>`;
    return `<label class="field"><span>${o.label}</span><input ${at} value="${Kit.esc(v)}" spellcheck="false"></label>`;
  };
  const drawSteps = () => {
    const g = groups();
    $.querySelector('.jg-list').innerHTML = st.steps.map((s, i) => {
      const c = Cipher.get(s.id);
      return `<div class="jg-step">
        <div class="jg-sh"><b>${i + 1}</b><select data-step="${i}" data-pick>${[...g].map(([name, list]) => `<optgroup label="${name}">${list.map(x => `<option value="${x.id}"${x.id === s.id ? ' selected' : ''}>${x.name}</option>`).join('')}</optgroup>`).join('')}</select>
          <button class="ghost ic-only" data-a="up" data-i="${i}" title="Move up"${i ? '' : ' disabled'}>${Kit.icon('chevron-down', 'up')}</button>
          <button class="ghost ic-only" data-a="del" data-i="${i}" title="Remove">${Kit.icon('trash')}</button></div>
        ${c.opts.map(o => optField(s, i, o)).join('')}
      </div>`;
    }).join('') || '<p class="muted jg-note">No steps: both texts stay the same.</p>';
  };

  let last = 'plain';
  const run = (from = last) => {
    last = from;
    const $p = $.querySelector('[data-t=plain]'), $c = $.querySelector('[data-t=cipher]'), $e = $.querySelector('.jg-err');
    try {
      if(from === 'plain') $c.value = Cipher.chain($p.value, st.steps, 'enc');
      else $p.value = Cipher.chain($c.value, st.steps, 'dec');
      $e.textContent = '';
    }
    catch(err) { $e.textContent = err.message; }
    $.querySelector('[data-n=plain]').textContent = `${$p.value.length} chars`;
    $.querySelector('[data-n=cipher]').textContent = `${$c.value.length} chars`;
    st.api.later('state', () => ({ steps: st.steps, plain: $p.value, lang: st.lang, glyph: st.glyph }), 500);
    if(st.side === 'glyphs') drawGlyphs();
  };
  //#endregion

  //#region [ Side: crack ]
  const cipherText = () => $.querySelector('[data-t=cipher]').value;
  const drawCrack = () => {
    const text = cipherText();
    const $s = $.querySelector('.jg-side-in');
    if(!text.trim()) { $s.innerHTML = '<p class="muted jg-note">Paste a cipher text in the lower box: Try all ranks every keyless decoder, Caesar shifts and a Vigenère key guess.</p>'; return; }
    const tries = Cipher.tryAll(text, st.lang, 12);
    const { count, total } = Cipher.freq(text);
    const f = Cipher.FREQ[st.lang], max = Math.max(...Object.values(count).map(n => n / (total || 1) * 100), ...Object.values(f));
    const kl = Cipher.keyLengths(text, 12).slice(0, 5);
    $s.innerHTML = `
      <div class="section">Try all</div>
      ${tries.map((t, i) => `<div class="jg-try" data-try="${i}" title="Use this"><div><b>${Kit.esc(t.name)}</b><em>${t.score.toFixed(1)}</em></div><code>${Kit.esc(t.text.slice(0, 140))}</code></div>`).join('') || '<p class="muted jg-note">Nothing readable.</p>'}
      <div class="section">Letter frequency <span class="muted">IoC ${Cipher.ioc(text).toFixed(4)} · ${st.lang === 'pt' ? 'PT ≈ .072' : 'EN ≈ .066'}, random ≈ .038</span></div>
      <div class="jg-freq">${Object.keys(count).map(c => `<div title="${c}: ${count[c]} (${(count[c] / (total || 1) * 100).toFixed(1)}%) · ${st.lang.toUpperCase()} ${f[c]}%"><i style="height:${count[c] / (total || 1) * 100 / max * 100}%"></i><s style="bottom:${f[c] / max * 100}%"></s><span>${c}</span></div>`).join('')}</div>
      <div class="section">Vigenère key length</div>
      ${kl.map(k => `<div class="jg-kl"><span>${k.len}</span><i style="width:${Math.min(100, k.ioc / .075 * 100)}%"></i><em>IoC ${k.ioc.toFixed(3)}</em><button class="ghost" data-a="vkey" data-len="${k.len}">key?</button></div>`).join('')}`;
    st.tries = tries;
  };
  //#endregion

  //#region [ Side: glyphs ]
  const drawGlyphs = () => {
    const $s = $.querySelector('.jg-side-in');
    const plain = $.querySelector('[data-t=plain]').value;
    const g = Cipher.GLYPHS.find(x => x.id === st.glyph);
    const svg = plain.trim() ? Cipher.glyphs(st.glyph, plain, { size: 34, per: 8 }) : '';
    const key = Cipher.glyphs(st.glyph, g.letters.length > 10 ? [...g.letters.slice(0, 26)].join(' ') : '0 1 2 3 4 5 6 7 8 9 13 20 45', { size: 24, per: 9 });
    $s.innerHTML = `
      <div class="jg-row"><select data-glyph>${Cipher.GLYPHS.map(x => `<option value="${x.id}"${x.id === st.glyph ? ' selected' : ''}>${x.name}</option>`).join('')}</select>
        <button class="ghost" data-a="g-svg" title="Download SVG">${Kit.icon('download')}SVG</button><button class="ghost" data-a="g-png" title="Download PNG">${Kit.icon('image')}PNG</button></div>
      <div class="section">The plain text</div>
      <div class="jg-glyph">${svg || '<span class="muted">Type in Plain.</span>'}</div>
      <div class="section">Key ${g.letters.length > 10 ? '(A–Z, click to type)' : '(numbers)'}</div>
      <div class="jg-key">${g.letters.length > 10 ? [...g.letters.slice(0, 26)].map(c => `<button class="ghost" data-type="${c}" title="${c}">${Cipher.glyphs(st.glyph, c, { size: 22 })}<span>${c}</span></button>`).join('') : key}</div>
      <p class="muted jg-note">Glyph sets are pictures: decode by clicking the key to type letters into Plain.</p>`;
  };
  const glyphPng = () => {
    const svg = Cipher.glyphs(st.glyph, $.querySelector('[data-t=plain]').value || 'A', { size: 48, per: 10 }).replace('<svg ', '<svg style="color:#1A1A1A" ').replace(/currentColor/g, '#1A1A1A');
    const img = new Image();
    img.onload = () => {
      const cv = Object.assign(document.createElement('canvas'), { width: img.width * 2 + 32, height: img.height * 2 + 32 });
      const g = cv.getContext('2d');
      g.fillStyle = '#F8F4E8'; g.fillRect(0, 0, cv.width, cv.height);
      g.drawImage(img, 16, 16, img.width * 2, img.height * 2);
      cv.toBlob(b => Kit.download(`${st.glyph}.png`, b));
    };
    img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  };
  //#endregion

  //#region [ Side: words ]
  const ensureWords = async () => {
    if(Cipher.words(st.lang).length) return true;
    $.querySelector('.jg-wstate') && ($.querySelector('.jg-wstate').textContent = 'loading word list…');
    try { await Hub.need('jigsaw', `words-${st.lang}.js`); return true; }
    catch { st.api.toast('Word list failed to load', true); return false; }
  };
  const drawWords = () => {
    const $s = $.querySelector('.jg-side-in');
    $s.innerHTML = `
      <div class="section">Anagrams</div>
      <div class="jg-row"><input data-w="ana" placeholder="letters, e.g. listen" spellcheck="false"><button data-a="ana">${Kit.icon('shuffle')}Find</button></div>
      <div class="jg-ana"><span class="muted jg-wstate">${Cipher.words(st.lang).length ? `${Cipher.words(st.lang).length} ${st.lang.toUpperCase()} words loaded` : `${st.lang.toUpperCase()} word list loads on first use`}</span></div>
      <div class="section">Word search</div>
      <label class="field"><span>Words (one per line or commas)</span><textarea rows="4" data-w="ws" spellcheck="false">DRAGON, SWORD, CASTLE, KEY, TOWER, GOLD</textarea></label>
      <div class="jg-row"><label class="field"><span>Size (0 = auto)</span><input type="number" min="0" max="30" value="0" data-w="size"></label>
        <label class="field"><span>Directions</span><select data-w="dirs"><option value="easy">→ ↓</option><option value="forward">forward + diagonal</option><option value="all" selected>all 8</option></select></label></div>
      <div class="jg-row"><button class="primary" data-a="ws">${Kit.icon('border-all')}Make grid</button><button class="ghost" data-a="ws-svg">${Kit.icon('download')}SVG</button><label class="jg-chk"><input type="checkbox" data-w="show"> answers</label></div>
      <div class="jg-ws"></div>`;
    if(st.ws) drawWs();
  };
  const wsSvg = (answers = false) => {
    const { grid, placed } = st.ws, n = grid.length, c = 30;
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n * c} ${n * c}" width="${n * c}" height="${n * c}"><rect width="100%" height="100%" fill="#F8F4E8"/>`;
    if(answers) for(const p of placed) {
      const x1 = p.c * c + c / 2, y1 = p.r * c + c / 2, x2 = (p.c + p.dc * (p.word.length - 1)) * c + c / 2, y2 = (p.r + p.dr * (p.word.length - 1)) * c + c / 2;
      s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#CD7F32" stroke-opacity=".45" stroke-width="${c * .7}" stroke-linecap="round"/>`;
    }
    grid.forEach((row, r) => row.forEach((ch, k) => { s += `<text x="${k * c + c / 2}" y="${r * c + c * .68}" text-anchor="middle" font-family="Consolas, monospace" font-size="${c * .55}" font-weight="700" fill="#1A1A1A">${ch}</text>`; }));
    return s + '</svg>';
  };
  const drawWs = () => {
    const show = $.querySelector('[data-w=show]')?.checked;
    $.querySelector('.jg-ws').innerHTML = `${wsSvg(show)}<div class="muted jg-note">${st.ws.placed.map(p => p.word).join(' · ')}${st.ws.missed.length ? ` · <b style="color:var(--bad)">did not fit: ${st.ws.missed.join(', ')}</b>` : ''}</div>`;
  };
  //#endregion

  const drawSide = () => {
    $.querySelectorAll('.jg-side .seg[data-k]').forEach($s => $s.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === st[$s.dataset.k])));
    if(st.side === 'crack') drawCrack();
    if(st.side === 'glyphs') drawGlyphs();
    if(st.side === 'words') drawWords();
  };

  const mount = api => {
    st.api = api;
    $ = api.$el;
    $.innerHTML = html;
    api.actions([
      ['shuffle', 'Swap texts', () => { const p = $.querySelector('[data-t=plain]'), c = $.querySelector('[data-t=cipher]'); [p.value, c.value] = [c.value, p.value]; run('cipher'); drawSide(); }, { title: 'Put the cipher text in Plain and decode' }],
      ['file-export', 'Export', (e, $b) => {
        const r = $b.getBoundingClientRect();
        Menu.show(r.left, r.bottom + 4, [
          ['download', 'Cipher text (.txt)', () => Kit.download('cipher.txt', $.querySelector('[data-t=cipher]').value)],
          ['download', 'Chain (TOON)', () => Kit.download('chain.jigsaw.toon', DAE.Toon.encode({ app: 'jigsaw', steps: st.steps.map(s => ({ id: s.id, ...s.opts })) }))],
          ['image', 'Glyphs (PNG)', glyphPng],
        ]);
      }, { primary: true }],
    ]);
    const $p = $.querySelector('[data-t=plain]'), $c = $.querySelector('[data-t=cipher]');
    $p.addEventListener('input', () => { run('plain'); if(st.side === 'crack') crackLater(); });
    $c.addEventListener('input', () => { run('cipher'); if(st.side === 'crack') crackLater(); });
    const crackLater = Kit.later(drawCrack, 400);

    $.querySelector('.jg-steps').addEventListener('change', e => {
      const t = e.target, i = +t.dataset.step;
      if(t.dataset.pick !== undefined) { st.steps[i] = { id: t.value, opts: {} }; drawSteps(); run(); }
    });
    $.querySelector('.jg-steps').addEventListener('input', e => {
      const t = e.target, i = +t.dataset.step;
      if(t.dataset.opt) { st.steps[i].opts[t.dataset.opt] = t.type === 'number' ? +t.value : t.value; run(); }
    });
    $.addEventListener('click', e => {
      const $seg = e.target.closest('.seg[data-k] [data-v]');
      if($seg) { st[$seg.parentElement.dataset.k] = $seg.dataset.v; drawSide(); return; }
      const $try = e.target.closest('[data-try]');
      if($try) { const t = st.tries[+$try.dataset.try]; $p.value = t.text; api.toast(`${t.name}: put in Plain`); return; }
      const $ty = e.target.closest('[data-type]');
      if($ty) { $p.value += $ty.dataset.type; run('plain'); return; }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if(!a) return;
      const i = +(e.target.closest('[data-i]')?.dataset.i ?? -1);
      if(a === 'add') { st.steps.push({ id: 'caesar', opts: {} }); drawSteps(); run(); }
      if(a === 'del') { st.steps.splice(i, 1); drawSteps(); run(); }
      if(a === 'up' && i > 0) { [st.steps[i - 1], st.steps[i]] = [st.steps[i], st.steps[i - 1]]; drawSteps(); run(); }
      if(a === 'copy-plain') Kit.copy($p.value);
      if(a === 'copy-cipher') Kit.copy($c.value);
      if(a === 'clear') { $p.value = ''; $c.value = ''; run('plain'); drawSide(); }
      if(a === 'vkey') {
        const key = Cipher.vigenereKey(cipherText(), +e.target.closest('[data-len]').dataset.len, st.lang);
        st.steps = [{ id: 'vigenere', opts: { key } }];
        drawSteps();
        run('cipher');
        api.toast(`Key guess: ${key}`);
      }
      if(a === 'g-svg') Kit.download(`${st.glyph}.svg`, Cipher.glyphs(st.glyph, $p.value || 'A', { size: 48, per: 10 }).replace(/currentColor/g, '#1A1A1A'), 'image/svg+xml');
      if(a === 'g-png') glyphPng();
      if(a === 'ana') (async () => {
        const q = $.querySelector('[data-w=ana]').value;
        if(!q.trim()) return;
        if(!await ensureWords()) return;
        const r = Cipher.anagrams(q, Cipher.words(st.lang), { max: 40 });
        $.querySelector('.jg-ana').innerHTML = `<div class="lbl">Exact</div><div class="jg-words">${r.exact.map(w => `<span class="chip">${Kit.esc(w)}</span>`).join('') || '<span class="muted">none</span>'}</div>
          <div class="lbl">Two words</div><div class="jg-words">${r.pairs.map(w => `<span class="chip">${Kit.esc(w)}</span>`).join('') || '<span class="muted">none</span>'}</div>
          <div class="lbl">Longest words inside</div><div class="jg-words">${r.fit.slice(0, 30).map(w => `<span class="chip">${Kit.esc(w)}</span>`).join('') || '<span class="muted">none</span>'}</div>`;
      })();
      if(a === 'ws') {
        const words = $.querySelector('[data-w=ws]').value.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
        st.ws = Cipher.wordSearch(words, { size: +$.querySelector('[data-w=size]').value || 0, dirs: $.querySelector('[data-w=dirs]').value, seed: Date.now() });
        drawWs();
      }
      if(a === 'ws-svg' && st.ws) Kit.download('word-search.svg', wsSvg($.querySelector('[data-w=show]').checked), 'image/svg+xml');
    });
    $.querySelector('.jg-side-in').addEventListener('change', e => {
      if(e.target.dataset.glyph !== undefined) { st.glyph = e.target.value; drawGlyphs(); }
      if(e.target.dataset.w === 'show' && st.ws) drawWs();
    });
    $.querySelector('.jg-side-in').addEventListener('keydown', e => { if(e.key === 'Enter' && e.target.dataset.w === 'ana') $.querySelector('[data-a=ana]').click(); });

    api.get('state').then(s => {
      if(s) { st.steps = s.steps ?? st.steps; st.lang = s.lang ?? 'en'; st.glyph = s.glyph ?? 'pigpen'; $p.value = s.plain ?? ''; }
      else $p.value = 'Meet me at the old tower at dawn';
      drawSteps();
      run('plain');
      drawSide();
    });
  };

  Hub.register('jigsaw', {
    mount,
    async open(file) { $.querySelector('[data-t=cipher]').value = file.text; run('cipher'); drawSide(); },
    async drop(files) { const t = await files[0].text(); $.querySelector('[data-t=cipher]').value = t; run('cipher'); drawSide(); },
  });
})();
