// Apollo widget: a player (play / pause, waveform seek bar, time, loop, volume) for any audio file the
// browser decodes, or for an Apollo .toon: the song is rendered locally (worker, 48 kHz), encoded to
// Opus in Ogg and cached in the board; an SFX project lists its sounds and mixes to play.
const APOLLO_CORE = ['theory', 'keymap', 'instruments', 'samples', 'synth', 'wav', 'sfxr', 'project', 'sequencer'].map(f => `../apollo/src/core/${f}.js`);

class ApolloWidget extends Widget {
  player = new Player();
  project = null;
  peaks = null;
  cur = 'song';       // 'song' or a sound / mix id
  #raf = 0;

  async mount() {
    const a = this.asset;
    if(!a) throw new Error('no file in this widget');
    const I = DAE.Icons.html;
    this.$body.innerHTML = `<div class="ap">
      <div class="ap-row"><button class="ap-play" title="Play / pause" disabled>${I('play')}</button>
        <div class="ap-wave" title="Click or drag to seek"><canvas></canvas><i class="ap-head"></i></div>
        <span class="ap-time">0:00</span></div>
      <div class="ap-row"><button class="tog ap-loop" title="Loop (gapless)">${I('repeat')} Loop</button>
        ${I('volume-high')}<input type="range" class="ap-vol" min="0" max="1" step="0.01" value="0.9"><span class="ap-info"></span></div>
      <div class="ap-list"></div><div class="ap-status"></div></div>`;
    this.own(this.$body.querySelector('.ap'));
    this.$play = this.$body.querySelector('.ap-play');
    this.$wave = this.$body.querySelector('.ap-wave');
    this.$play.onclick = () => this.toggle();
    this.$body.querySelector('.ap-loop').onclick = () => this.setLoop(!this.player.loop);
    const $v = this.$body.querySelector('.ap-vol');
    $v.style.setProperty('--p', 0.9);
    $v.oninput = () => { this.player.volume = Number($v.value); $v.style.setProperty('--p', $v.value); };
    this.#bindSeek();
    this.player.onend = () => this.#tick();
    new ResizeObserver(() => this.#draw()).observe(this.$wave);

    if(/toon|json|text/.test(a.mime)) await this.#loadProject();
    else {
      this.status('Decoding…');
      const buf = await AudioKit.decode(AudioKit.fromB64(a.data));
      this.#set(buf, `${a.mime.split('/')[1] ?? 'audio'} · ${ApolloWidget.size(a.data)}`);
      this.status('');
    }
    this.#fit();
  }

  /** New widgets take the height of their content once (title bar + player + sound list). */
  #fit() {
    const it = this.it, $ap = this.$body.querySelector('.ap');
    if(!it?.fit || !$ap) return;
    $ap.style.flex = 'none';
    const need = Math.ceil(30 + $ap.offsetHeight);
    $ap.style.flex = '';
    delete it.fit;
    if(Math.abs(need - it.h) > 2) { it.h = Math.min(420, need); App.render(); }
  }

  unmount() {
    this.player.stop();
    cancelAnimationFrame(this.#raf);
  }

  status(text, bad = false) {
    const $s = this.$body.querySelector('.ap-status');
    if(!$s) return;
    $s.textContent = text;
    $s.classList.toggle('bad', bad);
  }

  static size(b64) {
    const n = b64.length * 3 / 4;
    return n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`;
  }

  static time(t) {
    return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  }

  //#region [ Apollo projects ]
  async #loadProject() {
    await Widgets.load(APOLLO_CORE);
    const text = this.text();
    this.project = DAE.Project.parse(text);
    const p = this.project, sounds = [...p.sfx, ...p.mixes];
    const hasSong = p.mode === 'music' || !sounds.length;
    const $l = this.$body.querySelector('.ap-list');
    $l.innerHTML = (hasSong && sounds.length ? '<button data-snd="song">song</button>' : '')
      + sounds.map(s => `<button data-snd="${s.id}">${DAE.Markdown.esc(s.name)}</button>`).join('');
    $l.onclick = e => {
      const $b = e.target.closest('[data-snd]');
      if($b) this.pick($b.dataset.snd === 'song' ? 'song' : Number($b.dataset.snd), true);
    };
    await this.pick(hasSong ? 'song' : sounds[0].id, false);
  }

  /** Song: cached render or a new one. Sound / mix: rendered on the spot (short). */
  async pick(what, play) {
    this.cur = what;
    this.$body.querySelectorAll('[data-snd]').forEach($b => $b.classList.toggle('on', String($b.dataset.snd) === String(what)));
    const p = this.project;
    if(what === 'song') {
      await this.#song();
      this.setLoop(p.song.loop.on, false);
    }
    else {
      const x = DAE.Sfxr.renderItem(p, what, 44100), buf = AudioKit.ctx.createBuffer(1, Math.max(1, x.length), 44100);
      buf.copyToChannel(DAE.Sfxr.normalize01(x), 0);
      this.#set(buf, `sound · ${(x.length / 44100).toFixed(2)} s`);
      this.setLoop(false, false);
    }
    if(play) this.player.play();
    this.#tick();
  }

  async #song() {
    const p = this.project, l = p.song.loop, it = this.it;
    const range = l.on ? [l.from, l.to] : [0, p.song.bars];
    const key = `${Board.hash(this.text())}:${range.join('-')}:${l.on ? 'loop' : 'song'}`;
    let a = it.audio && Board.asset(App.b, it.audio);
    if(!a || a.source !== key) {
      this.status('Rendering the song…');
      await this.#packs();
      const r = await AudioKit.renderSong(p, { sr: 48000, from: range[0], to: range[1], loop: l.on });
      this.status('Encoding…');
      const enc = await AudioKit.encode(r.L, r.R, r.sr, l.on);
      a = Board.addAsset(App.b, { name: `${this.it.name.replace(/\.\w+$/, '')}.${enc.mime === 'audio/ogg' ? 'ogg' : 'wav'}`, mime: enc.mime, data: AudioKit.toB64(enc.bytes), source: key, samples: enc.samples });
      App.pool.set(a.id, a);
      this.it.audio = a.id;
      Board.gc(App.b);
      App.setDirty(true);
      Files.autosave();
    }
    this.status('');
    const buf = AudioKit.trim(await AudioKit.decode(AudioKit.fromB64(a.data)), a.samples);
    const label = a.mime === 'audio/ogg' ? 'Opus 128k' : 'WAV';
    this.#set(buf, `${label} · ${ApolloWidget.size(a.data)} · ${l.on ? `loop bars ${l.from + 1}-${l.to}` : `${p.song.bars} bars`}`);
  }

  /** Script-loads the sample packs this song uses. */
  async #packs() {
    const names = new Set();
    for(const t of this.project.tracks) {
      if(t.kind === 'drum' && t.kit.mode === 'sample') names.add(t.kit.pack);
      if(t.kind !== 'drum' && t.inst.engine === 'sample') names.add(t.inst.pack);
    }
    const need = [...names].filter(n => !DAE.Samples.packs[n]);
    if(!need.length) return;
    await Widgets.load(need.map(n => `../apollo/vendor/sounds/${n}.js`));
    DAE.Samples.collect();
  }
  //#endregion

  //#region [ Player ]
  #set(buf, info) {
    this.player.set(buf);
    this.peaks = null;
    this.$play.disabled = false;
    this.$body.querySelector('.ap-info').textContent = info;
    this.#draw();
    this.#tick();
  }

  toggle() {
    if(this.player.playing) this.player.pause();
    else this.player.play();
    this.#tick();
  }

  setLoop(on, keep = true) {
    if(keep) this.player.setLoop(on);
    else this.player.loop = on;
    this.$body.querySelector('.ap-loop').classList.toggle('on', on);
  }

  #bindSeek() {
    const $w = this.$wave, at = e => { const r = $w.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
    $w.addEventListener('pointerdown', e => {
      if(!this.player.buffer) return;
      $w.setPointerCapture(e.pointerId);
      this.player.seek(at(e) * this.player.duration);
      this.#tick();
      $w.onpointermove = ev => { this.player.seek(at(ev) * this.player.duration); this.#tick(); };
      $w.onpointerup = () => { $w.onpointermove = $w.onpointerup = null; };
    });
  }

  #tick = () => {
    cancelAnimationFrame(this.#raf);
    if(!this.$body.isConnected) return;
    const p = this.player, d = p.duration, t = p.time;
    this.$play.innerHTML = DAE.Icons.html(p.playing ? 'pause' : 'play');
    this.$body.querySelector('.ap-head').style.left = `${d ? t / d * 100 : 0}%`;
    this.$body.querySelector('.ap-time').textContent = `${ApolloWidget.time(t)} / ${ApolloWidget.time(d)}`;
    if(p.playing) this.#raf = requestAnimationFrame(this.#tick);
  };

  #draw() {
    const $c = this.$wave.querySelector('canvas'), buf = this.player.buffer;
    const W = Math.max(1, $c.clientWidth), H = Math.max(1, $c.clientHeight), dpr = Math.min(2, devicePixelRatio || 1);
    $c.width = Math.round(W * dpr);
    $c.height = Math.round(H * dpr);
    const g = $c.getContext('2d');
    g.clearRect(0, 0, $c.width, $c.height);
    if(!buf) return;
    const cols = Math.max(1, Math.floor(W / 2));
    if(!this.peaks || this.peaks.length !== cols * 2) this.peaks = AudioKit.peaks(buf, cols);
    g.fillStyle = '#8BE9FD';
    const mid = $c.height / 2, sx = $c.width / cols;
    for(let c = 0; c < cols; c++) {
      const lo = this.peaks[c * 2], hi = this.peaks[c * 2 + 1];
      const y0 = mid - hi * mid * 0.95, y1 = mid - lo * mid * 0.95;
      g.fillRect(c * sx, y0, Math.max(1, sx - dpr), Math.max(dpr, y1 - y0));
    }
  }
  //#endregion

  menu() {
    const rows = [[this.player.playing ? 'Pause' : 'Play', this.player.playing ? 'pause' : 'play', () => this.toggle()]];
    if(this.project && this.cur === 'song') rows.push(['Render the song again', 'rotate-right', () => { this.it.audio = null; this.pick('song', false); }]);
    return rows;
  }

  /** Picture for export: name, waveform and time. */
  exportSvg(w, h) {
    const cols = Math.max(1, Math.floor((w - 24) / 3)), pk = this.player.buffer ? AudioKit.peaks(this.player.buffer, cols) : null;
    const top = 30 + 14, wh = Math.min(60, h - 30 - 40), mid = top + wh / 2;
    let bars = `<rect x="12" y="${top}" width="${w - 24}" height="${wh}" rx="4" fill="#212121"/>`;
    if(pk) for(let c = 0; c < cols; c++) {
      const y0 = mid - pk[c * 2 + 1] * wh / 2 * 0.95, y1 = mid - pk[c * 2] * wh / 2 * 0.95;
      bars += `<rect x="${12 + c * 3}" y="${y0}" width="2" height="${Math.max(1, y1 - y0)}" fill="#8BE9FD"/>`;
    }
    const info = this.$body.querySelector('.ap-info')?.textContent ?? '';
    return bars + `<text x="12" y="${top + wh + 20}" font-size="11" font-family="Consolas, monospace" fill="#6F7676">${DAE.Markdown.esc(`${ApolloWidget.time(this.player.duration)} · ${info}`)}</text>`;
  }
}

Widgets.register('apollo', ApolloWidget);
