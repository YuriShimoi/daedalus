// Playlist: track strips (mute, solo, volume) and a track x bar grid of pattern clips, with the bar ruler
// (click: start point, drag: loop range) and the playhead.
class Playlist {
  static #paint = null;   // { track, value } while painting clips

  static patNumber(pid) {
    const pat = App.p.patterns.find(x => x.id === pid);
    return pat ? App.p.patterns.filter(x => x.track === pat.track).indexOf(pat) + 1 : '';
  }

  static render() {
    const p = App.p, bars = p.song.bars, cols = `repeat(${bars}, minmax(24px, 1fr))`;
    const byId = new Map(p.patterns.map(x => [x.id, x]));
    const strips = p.tracks.map((t, i) => `<div class="strip${t.id === App.sel.track ? ' sel' : ''}" data-t="${t.id}">
        <span class="sw" style="background:${t.color}"></span>
        <span class="nm" title="Double-click to rename">${UI.esc(t.name)}<small>${t.kind === 'drum' ? 'drums' : t.inst.engine}</small></span>
        <button class="ms m${t.mute ? ' on' : ''}" data-mute="${t.id}" title="Mute">M</button>
        <button class="ms s adv${t.solo ? ' on' : ''}" data-solo="${t.id}" title="Solo">S</button>
        ${UI.knob({ get: () => t.vol, set: v => { t.vol = v; }, kind: 'mix' }, 'knob adv', 'Volume')}
        <button class="ms adv" data-up="${t.id}" title="Move up" ${i ? '' : 'disabled'}>↑</button>
        <button class="ms" data-del="${t.id}" title="Delete track" ${App.p.tracks.length > 1 ? "" : "disabled"}>✕</button>
      </div>`).join('');
    const lanes = p.tracks.map(t => {
      const cells = [];
      let cover = 0, coverPat = null;
      t.clips.forEach((pid, b) => {
        const pat = pid && byId.get(pid);
        if(pat) { cover = pat.bars; coverPat = pat; }
        const bar4 = b % 4 === 0 ? ' bar4' : '';
        if(pat) cells.push(`<span class="cell${bar4}" data-c="${t.id}:${b}" style="background:${t.color}${t.mute ? '66' : ''}">${Playlist.patNumber(pid)}</span>`);
        else if(cover > 0 && coverPat) cells.push(`<span class="cell cont${bar4}" data-c="${t.id}:${b}" style="background:${t.color}44"></span>`);
        else cells.push(`<span class="cell empty${bar4}" data-c="${t.id}:${b}"></span>`);
        cover--;
      });
      return `<div class="lanes" style="grid-template-columns:${cols}">${cells.join('')}</div>`;
    }).join('');
    const l = p.song.loop;
    const ruler = Array.from({ length: bars }, (_, i) => `<span data-bar="${i}"${i === App.cursor ? ' style="color:var(--apollo);font-weight:700"' : ''}>${i + 1}</span>`).join('');
    const full = p.tracks.length >= DAE.Project.MAX_TRACKS ? 'disabled' : '';
    const $pl = document.getElementById('playlist');
    $pl.innerHTML = `<div><div class="ruler"></div>${strips}
        <div class="addtrack"><button data-add="melodic" ${full}>${UI.icon('plus')} Track</button><button data-add="drum" ${full}>${UI.icon('drum')} Drums</button></div></div>
      <div class="lanewrap" style="overflow-x:auto"><div style="min-width:${bars * 27}px;position:relative">
        <div class="ruler" id="ruler" style="grid-template-columns:${cols}">${ruler}
          <i class="loop${l.on ? ' on' : ''}" style="left:${l.from / bars * 100}%;width:${(l.to - l.from) / bars * 100}%"></i></div>
        ${lanes}<i class="playhead" id="playhead"></i></div></div>`;
    UI.wire($pl);
    Playlist.#bind($pl);
  }

  static #bind($pl) {
    $pl.querySelectorAll('.strip').forEach($s => {
      $s.onclick = () => Playlist.select(Number($s.dataset.t));
      $s.querySelector('.nm').ondblclick = () => {
        const t = App.p.tracks.find(x => x.id === Number($s.dataset.t));
        const name = prompt('Track name', t.name);
        if(name) App.change(() => { t.name = name.slice(0, 24); }, 'none');
      };
    });
    const tr = id => App.p.tracks.find(x => x.id === Number(id));
    $pl.querySelectorAll('[data-mute]').forEach($b => $b.onclick = e => { e.stopPropagation(); App.change(() => { const t = tr($b.dataset.mute); t.mute = !t.mute; }, 'mix'); });
    $pl.querySelectorAll('[data-solo]').forEach($b => $b.onclick = e => { e.stopPropagation(); App.change(() => { const t = tr($b.dataset.solo); t.solo = !t.solo; }, 'mix'); });
    $pl.querySelectorAll('[data-up]').forEach($b => $b.onclick = e => {
      e.stopPropagation();
      App.change(p => { const i = p.tracks.indexOf(tr($b.dataset.up)); [p.tracks[i - 1], p.tracks[i]] = [p.tracks[i], p.tracks[i - 1]]; });
    });
    $pl.querySelectorAll('[data-del]').forEach($b => $b.onclick = e => {
      e.stopPropagation();
      const t = tr($b.dataset.del);
      if(App.p.tracks.length <= 1 || !confirm(`Delete track "${t.name}" and its patterns?`)) return;
      App.change(p => { p.tracks = p.tracks.filter(x => x !== t); p.patterns = p.patterns.filter(x => x.track !== t.id); });
    });
    $pl.querySelectorAll('[data-add]').forEach($b => $b.onclick = () => App.change(p => {
      const t = DAE.Project.track(p, $b.dataset.add);
      p.tracks.push(t);
      const pat = DAE.Project.pattern(p, t.id);
      p.patterns.push(pat);
      App.sel = { track: t.id, pattern: pat.id };
    }));

    // clips: left = place / pick, right = clear, drag paints along the row
    $pl.querySelectorAll('[data-c]').forEach($c => {
      $c.onpointerdown = e => {
        e.preventDefault();
        const [tid, bar] = $c.dataset.c.split(':').map(Number);
        const t = tr(tid);
        let value = 0;
        if(e.button === 0) {
          const pid = t.clips[bar];
          if(pid) { App.sel = { track: tid, pattern: pid }; value = pid; }
          else {
            if(App.sel.track !== tid || !App.pattern) App.sel = { track: tid, pattern: App.p.patterns.find(x => x.track === tid)?.id ?? 0 };
            value = App.sel.pattern || Playlist.#newPattern(tid);
          }
        }
        App.begin();
        Playlist.#paint = { tid, value, from: bar, span: (value && App.p.patterns.find(x => x.id === value)?.bars) || 1 };
        Playlist.#set(t, bar, value);
        App.render();
      };
      $c.onpointerenter = () => {
        if(!Playlist.#paint) return;
        const [tid, bar] = $c.dataset.c.split(':').map(Number);
        if(tid !== Playlist.#paint.tid) return;
        // long patterns paint one clip per pattern length, with the bars in between left free
        const { from, span, value } = Playlist.#paint, t = tr(tid);
        if(span === 1) {
          Playlist.#set(t, bar, value);
          $c.className = 'cell' + (value ? '' : ' empty');
          $c.style.background = value ? t.color : '';
          $c.textContent = value ? Playlist.patNumber(value) : '';
          return;
        }
        const [lo, hi] = [Math.min(from, bar), Math.max(from, bar)];
        for(let b = lo; b <= hi; b++) Playlist.#set(t, b, (b - from) % span === 0 ? value : 0);
        Playlist.render();
      };
      $c.oncontextmenu = e => e.preventDefault();
    });

    // ruler: click = start point (or seek while playing), drag = loop range
    const $r = document.getElementById('ruler');
    const barAt = e => { const r = $r.getBoundingClientRect(); return Math.max(0, Math.min(App.p.song.bars - 1, Math.floor((e.clientX - r.left) / r.width * App.p.song.bars))); };
    $r.onpointerdown = e => {
      const a = barAt(e);
      let b = a;
      $r.setPointerCapture(e.pointerId);
      $r.onpointermove = ev => {
        b = barAt(ev);
        const $l = $r.querySelector('.loop');
        $l.style.left = Math.min(a, b) / App.p.song.bars * 100 + '%';
        $l.style.width = (Math.abs(b - a) + 1) / App.p.song.bars * 100 + '%';
      };
      $r.onpointerup = () => {
        $r.onpointermove = $r.onpointerup = null;
        if(a === b) {
          App.cursor = a;
          if(App.status.playing) Audio.send({ t: 'play', from: a * DAE.Project.barSteps(App.p) });
          Playlist.render();
        }
        else App.change(p => { p.song.loop = { on: true, from: Math.min(a, b), to: Math.max(a, b) + 1 }; });
      };
    };
  }

  static #newPattern(tid) {
    const pat = DAE.Project.pattern(App.p, tid);
    App.p.patterns.push(pat);
    App.sel = { track: tid, pattern: pat.id };
    return pat.id;
  }

  static #set(t, bar, value) {
    t.clips[bar] = value;
  }

  static select(tid) {
    if(App.sel.track === tid) return;
    const t = App.p.tracks.find(x => x.id === tid);
    const firstClip = t.clips.find(c => c);
    App.sel = { track: tid, pattern: firstClip || App.p.patterns.find(x => x.track === tid)?.id || 0 };
    App.render();
  }

  static endPaint() {
    if(!Playlist.#paint) return;
    Playlist.#paint = null;
    App.live('project');
    App.render();
  }

  static playhead(st) {
    const $h = document.getElementById('playhead');
    if(!$h) return;
    $h.classList.toggle('on', st.playing);
    if(st.playing) $h.style.left = st.step / (App.p.song.bars * DAE.Project.barSteps(App.p)) * 100 + '%';
  }
}
