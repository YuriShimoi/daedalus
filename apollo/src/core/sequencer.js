// Engine: turns the song into timed note events and mixes voices into stereo blocks.
// The same class runs inside the AudioWorklet, in a ScriptProcessor fallback and offline (export, CLI, tests).
DAE_CORE(DAE => {
  const MAX_VOICES = 64;

  class Engine {
    constructor(sr = 44100) {
      this.sr = sr;
      this.p = null;
      this.packs = {};
      this.voices = [];
      this.events = [];
      this.ei = 0;
      this.pos = 0;          // song position in samples
      this.playing = false;
      this.peak = 0;
      this.clipped = 0;
      this.seed = 1;
      this.live = new Map();  // live note id -> voice
      this.lastHz = [];       // per track, for glide
      this.gains = [];
    }

    //#region [ Song ]
    get stepLen() {
      const s = this.p.song;
      return this.sr * 60 / s.bpm / s.stepsPerBeat;
    }

    get barLen() {
      return this.stepLen * DAE.Project.barSteps(this.p);
    }

    /** Song -> sorted events { t, dur (samples), ti, pitch, vel, cents }. */
    static compile(p, sr) {
      const s = p.song, stepLen = sr * 60 / s.bpm / s.stepsPerBeat, spb = s.beatsPerBar * s.stepsPerBeat;
      const byId = new Map(p.patterns.map(x => [x.id, x]));
      const events = [];
      p.tracks.forEach((t, ti) => {
        t.clips.forEach((pid, bar) => {
          const pat = pid && byId.get(pid);
          if(!pat) return;
          const steps = pat.bars * spb;
          for(const n of pat.notes) {
            if(n.step >= steps) continue;
            const len = Math.min(n.len, steps - n.step);
            events.push({ t: Math.round((bar * spb + n.step) * stepLen), dur: Math.max(1, Math.round(len * stepLen - 1)), ti, pitch: n.pitch, vel: n.vel, cents: n.cents ?? 0 });
          }
        });
      });
      return events.sort((a, b) => a.t - b.t || a.ti - b.ti);
    }

    setProject(p) {
      this.p = p;
      this.events = Engine.compile(p, this.sr);
      this.#seek(this.pos);
      this.#mix();
    }

    setPacks(packs) {
      this.packs = packs ?? {};
    }

    #seek(pos) {
      let lo = 0, hi = this.events.length;
      while(lo < hi) {
        const m = (lo + hi) >> 1;
        if(this.events[m].t < pos) lo = m + 1;
        else hi = m;
      }
      this.ei = lo;
    }

    /** Per-track stereo gains: volume, equal-power pan, mute / solo, master. */
    #mix() {
      const solo = this.p.tracks.some(t => t.solo), m = this.p.song.master;
      this.gains = this.p.tracks.map(t => {
        const on = solo ? t.solo : !t.mute;
        const a = (Math.max(-1, Math.min(1, t.pan)) + 1) * Math.PI / 4;
        const g = on ? t.vol * m : 0;
        return [g * Math.cos(a), g * Math.sin(a)];   // -3 dB at center
      });
    }

    get loopRange() {
      const l = this.p.song.loop;
      if(!l.on || l.to <= l.from) return null;
      return [Math.round(l.from * this.barLen), Math.round(l.to * this.barLen)];
    }

    get songEnd() {
      return Math.round(this.p.song.bars * this.barLen);
    }

    play(fromStep = 0) {
      this.pos = Math.round(fromStep * this.stepLen);
      const loop = this.loopRange;
      if(loop && (this.pos < loop[0] || this.pos >= loop[1])) this.pos = loop[0];
      this.#seek(this.pos);
      this.playing = true;
    }

    stop() {
      this.playing = false;
      for(const v of this.voices) if(v.seq) v.release();
    }
    //#endregion

    //#region [ Voices ]
    #start(ti, pitch, vel, cents, gate, wait, hz) {
      const t = this.p.tracks[ti];
      if(!t) return null;
      const freq = hz > 0 ? hz : DAE.Theory.hz(pitch, cents);
      const v = DAE.Synth.voice({ sr: this.sr, kind: t.kind, inst: t.inst, kit: t.kit, pitch, hz: freq, vel, gate,
        seed: this.seed = (this.seed * 1103515245 + 12345) >>> 0, fromHz: this.lastHz[ti], packs: this.packs });
      if(t.kind !== 'drum') this.lastHz[ti] = freq;
      v.ti = ti;
      v.wait = wait;
      if(this.voices.length >= MAX_VOICES) this.voices.shift();   // steal the oldest
      this.voices.push(v);
      return v;
    }

    /** Live note (keyboard). Returns nothing; release with noteOff(id). */
    noteOn(id, ti, pitch, vel = 0.8, cents = 0, hz = 0) {
      const v = this.#start(ti, pitch, vel, cents, Infinity, 0, hz);
      if(v) this.live.set(id, v);
    }

    noteOff(id) {
      this.live.get(id)?.release();
      this.live.delete(id);
    }

    allOff() {
      for(const v of this.voices) v.release();
      this.live.clear();
    }
    //#endregion

    /** Fills L and R (Float32Array, n samples). */
    process(L, R, n) {
      L.fill(0, 0, n);
      R.fill(0, 0, n);
      if(!this.p) return;
      let o = 0;
      while(o < n) {
        let chunk = n - o;
        const loop = this.playing ? this.loopRange : null;
        if(this.playing) {
          const end = loop ? loop[1] : this.songEnd;
          chunk = Math.min(chunk, Math.max(1, end - this.pos));
          // schedule events starting inside this chunk
          while(this.ei < this.events.length && this.events[this.ei].t < this.pos + chunk) {
            const e = this.events[this.ei++];
            if(e.t < this.pos) continue;
            const v = this.#start(e.ti, e.pitch, e.vel, e.cents, e.dur, e.t - this.pos, 0);
            if(v) v.seq = true;
          }
        }
        this.#render(L, R, o, o + chunk);
        o += chunk;
        if(this.playing) {
          this.pos += chunk;
          if(loop && this.pos >= loop[1]) { this.pos = loop[0]; this.#seek(this.pos); }
          else if(!loop && this.pos >= this.songEnd) this.playing = false;
        }
      }
    }

    #render(L, R, from, to) {
      const g = this.gains;
      for(let k = this.voices.length - 1; k >= 0; k--) {
        const v = this.voices[k];
        const [gl, gr] = g[v.ti] ?? [0, 0];
        for(let i = from; i < to; i++) {
          if(v.wait > 0) { v.wait--; continue; }
          const s = v.next();
          L[i] += s * gl;
          R[i] += s * gr;
          if(v.done) break;
        }
        if(v.done) this.voices.splice(k, 1);
      }
      for(let i = from; i < to; i++) {
        const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
        if(a > this.peak) this.peak = a;
        if(a > 1) this.clipped++;
      }
    }

    /** Snapshot for the UI (playhead in steps, peak since last call). */
    status() {
      const st = { t: 'status', playing: this.playing, step: this.p ? this.pos / this.stepLen : 0, peak: this.peak, voices: this.voices.length };
      this.peak = 0;
      return st;
    }

    /** Message entry point shared by the worklet and the main-thread fallback. */
    handle(m) {
      switch(m.t) {
        case 'project': this.setProject(m.p); break;
        case 'mix': this.p = m.p; this.#mix(); break;
        case 'packs': this.setPacks(m.packs); break;
        case 'play': this.play(m.from ?? 0); break;
        case 'stop': this.stop(); break;
        case 'on': this.noteOn(m.id, m.ti, m.pitch, m.vel, m.cents, m.hz); break;
        case 'off': this.noteOff(m.id); break;
        case 'alloff': this.allOff(); break;
      }
    }

    //#region [ Offline ]
    /**
     * Renders bars [from, to) to stereo arrays. loop: true wraps the release tail onto the start
     * (seamless loop); otherwise the tail (up to `tail` seconds, trimmed at silence) is appended.
     */
    static render(p, packs, { sr = 44100, from = 0, to = p.song.bars, loop = false, tail = 4 } = {}) {
      const e = new Engine(sr);
      e.setPacks(packs);
      const q = structuredCloneSafe(p);
      q.song.loop = { on: false, from: 0, to: 0 };
      e.setProject(q);
      const start = Math.round(from * e.barLen), end = Math.round(to * e.barLen);
      e.pos = start;
      e.playing = true;
      e.events = e.events.filter(x => x.t >= start && x.t < end);
      e.ei = 0;
      const len = end - start, max = len + Math.round(tail * sr);
      const L = new Float32Array(max), R = new Float32Array(max);
      const B = 512, bl = new Float32Array(B), br = new Float32Array(B);
      let i = 0, lastLoud = len;
      while(i < max) {
        const n = Math.min(B, max - i);
        if(i >= len) e.playing = false;
        e.process(bl, br, n);
        L.set(bl.subarray(0, n), i);
        R.set(br.subarray(0, n), i);
        for(let k = 0; k < n; k++) if(Math.abs(bl[k]) > 1e-4 || Math.abs(br[k]) > 1e-4) lastLoud = i + k + 1;
        i += n;
        if(i >= len && !e.voices.length) break;
      }
      const total = Math.max(len, lastLoud);
      if(!loop) return { L: L.slice(0, total), R: R.slice(0, total), sr, clipped: e.clipped };
      const oL = L.slice(0, len), oR = R.slice(0, len);
      for(let k = len; k < total; k++) { oL[(k - len) % len] += L[k]; oR[(k - len) % len] += R[k]; }
      return { L: oL, R: oR, sr, clipped: e.clipped };
    }
    //#endregion
  }

  const structuredCloneSafe = o => JSON.parse(JSON.stringify(o));

  DAE.Engine = Engine;
});
