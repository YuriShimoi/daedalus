// Audio for widgets: one shared AudioContext, decoding of any file the browser knows, Apollo song
// render in a Blob worker (file:// safe), Opus encoding (shared/opus.js), and a gapless player.
class AudioKit {
  static #ctx = null;

  static get ctx() {
    AudioKit.#ctx ??= new AudioContext({ latencyHint: 'playback' });
    if(AudioKit.#ctx.state === 'suspended') AudioKit.#ctx.resume();
    return AudioKit.#ctx;
  }

  //#region [ Bytes ]
  static toB64(bytes) {
    let s = '';
    for(let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  static fromB64(b64) {
    const s = atob(b64), out = new Uint8Array(s.length);
    for(let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  static async decode(bytes) {
    return AudioKit.ctx.decodeAudioData(bytes.slice().buffer);
  }
  //#endregion

  //#region [ Apollo render ]
  /** Renders an Apollo song in a worker: { L, R, sr }. */
  static renderSong(p, opts) {
    const packs = {};
    for(const t of p.tracks) {
      const name = t.kind === 'drum' ? (t.kit.mode === 'sample' ? t.kit.pack : null) : t.inst.engine === 'sample' ? t.inst.pack : null;
      if(name && DAE.Samples.packs[name]) packs[name] = DAE.Samples.packs[name];
    }
    const main = DAE => {
      onmessage = e => {
        try {
          const r = DAE.Engine.render(e.data.p, e.data.packs, e.data.opts);
          postMessage({ L: r.L, R: r.R, sr: r.sr }, [r.L.buffer, r.R.buffer]);
        }
        catch(err) { postMessage({ error: err.message }); }
      };
    };
    return new Promise((ok, fail) => {
      const w = DAE_CORE.worker(main);
      w.onmessage = e => { w.terminate(); e.data.error ? fail(new Error(e.data.error)) : ok(e.data); };
      w.onerror = e => { w.terminate(); fail(new Error(e.message || 'render failed')); };
      w.postMessage({ p, packs, opts });
    });
  }
  //#endregion

  //#region [ Encode ]
  /**
   * Best format this browser can write: { bytes, mime, samples }. Opus gets 40 ms more audio than asked
   * (the loop's start again, or silence), because decoders differ on how much they trim at the end;
   * the player cuts the decoded buffer back to `samples`, so loops stay exact.
   */
  static async encode(L, R, sr, loop = false) {
    if(sr === 48000 && await DAE.Opus.supported()) {
      const pad = 1920, PL = new Float32Array(L.length + pad), PR = new Float32Array(R.length + pad);
      PL.set(L); PR.set(R);
      if(loop) for(let i = 0; i < pad; i++) { PL[L.length + i] = L[i % L.length]; PR[R.length + i] = R[i % R.length]; }
      try { return { bytes: await DAE.Opus.encode([PL, PR]), mime: 'audio/ogg', samples: L.length }; }
      catch(err) { console.warn('Opus encode failed, using WAV', err); }
    }
    return { bytes: DAE.Wav.encode([L, R], sr, 16), mime: 'audio/wav', samples: L.length };
  }

  /** A buffer cut to `samples` frames (no-op when it is not longer). */
  static trim(buf, samples) {
    if(!samples || buf.length <= samples) return buf;
    const out = AudioKit.ctx.createBuffer(buf.numberOfChannels, samples, buf.sampleRate);
    for(let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(0, samples), c);
    return out;
  }
  //#endregion

  /** Min / max per column for a waveform. */
  static peaks(buf, cols) {
    const chs = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c)), n = buf.length, out = new Float32Array(cols * 2);
    for(let c = 0; c < cols; c++) {
      const a = Math.floor(c * n / cols), b = Math.max(a + 1, Math.floor((c + 1) * n / cols));
      let lo = 0, hi = 0;
      for(const ch of chs) for(let i = a; i < b; i += Math.max(1, (b - a) >> 6)) { const v = ch[i]; if(v < lo) lo = v; if(v > hi) hi = v; }
      out[c * 2] = lo; out[c * 2 + 1] = hi;
    }
    return out;
  }
}

/** Plays one AudioBuffer: play / pause / seek, gapless loop, volume. */
class Player {
  buffer = null;
  loop = false;
  #src = null;
  #gain = null;
  #start = 0;      // ctx time when offset 0 would have played
  #offset = 0;     // position while paused
  #vol = 0.9;
  onend = null;

  get playing() { return !!this.#src; }
  get duration() { return this.buffer?.duration ?? 0; }

  get time() {
    if(!this.#src) return this.#offset;
    const t = AudioKit.ctx.currentTime - this.#start;
    return this.loop ? t % this.duration : Math.min(t, this.duration);
  }

  set volume(v) {
    this.#vol = v;
    if(this.#gain) this.#gain.gain.value = v;
  }

  get volume() { return this.#vol; }

  set(buffer) {
    this.stop();
    this.buffer = buffer;
    this.#offset = 0;
  }

  play() {
    if(!this.buffer || this.#src) return;
    const ctx = AudioKit.ctx;
    this.#gain ??= ctx.createGain();
    this.#gain.gain.value = this.#vol;
    this.#gain.connect(ctx.destination);
    const s = ctx.createBufferSource();
    s.buffer = this.buffer;
    s.loop = this.loop;
    s.connect(this.#gain);
    const off = this.#offset >= this.duration ? 0 : this.#offset;
    s.start(0, off);
    this.#start = ctx.currentTime - off;
    s.onended = () => {
      if(this.#src !== s) return;
      this.#src = null;
      this.#offset = 0;
      this.onend?.();
    };
    this.#src = s;
  }

  pause() {
    if(!this.#src) return;
    this.#offset = this.time;
    const s = this.#src;
    this.#src = null;
    s.stop();
  }

  stop() {
    this.pause();
    this.#offset = 0;
  }

  seek(t) {
    const was = this.playing;
    this.pause();
    this.#offset = Math.max(0, Math.min(this.duration, t));
    if(was) this.play();
  }

  setLoop(on) {
    const t = this.time, was = this.playing;
    this.pause();
    this.loop = on;
    this.#offset = t;
    if(was) this.play();
  }
}
