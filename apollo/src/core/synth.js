// Sample-level voices: chip, Karplus-Strong pluck, 2-op FM, drawbar organ, sampler and synth drums.
// Every voice returns one mono sample per next(); the engine mixes, pans and schedules them.
DAE_CORE(DAE => {
  const TAU = Math.PI * 2;

  //#region [ Building blocks ]
  /** Linear attack, exponential decay / release. */
  class Env {
    constructor(a, d, s, r, sr) {
      this.a = Math.max(a, 0.001) * sr;
      this.dc = Math.exp(-4.6 / (Math.max(d, 0.002) * sr));
      this.rc = Math.exp(-6.9 / (Math.max(r, 0.004) * sr));
      this.s = Math.max(0, Math.min(1, s));
      this.stage = 0;
      this.t = 0;
      this.v = 0;
    }

    release() {
      if(this.stage < 3) this.stage = 3;
    }

    get done() { return this.stage === 4; }

    next() {
      if(this.stage === 0) {
        this.v = ++this.t / this.a;
        if(this.t >= this.a) this.stage = 1;
      }
      else if(this.stage === 1 || this.stage === 2) {
        this.v = this.s + (this.v - this.s) * this.dc;
        if(this.s < 0.0005 && this.v < 0.0005) this.stage = 4;
      }
      else if(this.stage === 3) {
        this.v *= this.rc;
        if(this.v < 0.0003) { this.stage = 4; this.v = 0; }
      }
      else this.v = 0;
      return this.v;
    }
  }

  /** 12 dB low-pass (two one-poles). cut: 0..1, 1 = open. */
  class Lowpass {
    constructor(cut, sr) {
      this.on = cut < 0.995;
      const fc = Math.min(60 * 2 ** (cut * 8.4), sr * 0.45);
      this.g = 1 - Math.exp(-TAU * fc / sr);
      this.a = 0;
      this.b = 0;
    }

    run(x) {
      if(!this.on) return x;
      this.a += (x - this.a) * this.g;
      this.b += (this.a - this.b) * this.g;
      return this.b;
    }
  }

  /** RBJ band-pass biquad (constant peak gain). */
  class Bandpass {
    constructor(fc, q, sr) {
      const w = TAU * fc / sr, al = Math.sin(w) / (2 * q), a0 = 1 + al;
      this.b0 = al / a0; this.b2 = -al / a0;
      this.a1 = -2 * Math.cos(w) / a0; this.a2 = (1 - al) / a0;
      this.x1 = this.x2 = this.y1 = this.y2 = 0;
    }

    run(x) {
      const y = this.b0 * x + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
      this.x2 = this.x1; this.x1 = x;
      this.y2 = this.y1; this.y1 = y;
      return y;
    }
  }

  /** xorshift32 noise, deterministic per seed. */
  class Noise {
    constructor(seed = 1) { this.s = (seed >>> 0) || 0x9E3779B9; }
    next() {
      let s = this.s;
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      this.s = s >>> 0;
      return this.s / 2147483648 - 1;
    }
  }
  //#endregion

  //#region [ Voices ]
  class Voice {
    /** o: { sr, hz, vel, gate (samples, Infinity = until release), inst, seed } */
    constructor(o, env) {
      this.sr = o.sr;
      this.hz = o.hz;
      this.vel = o.vel ?? 0.8;
      this.gate = o.gate ?? Infinity;
      this.env = env;
      this.done = false;
      this.quiet = 0;
      this.t = 0;
    }

    release() { this.env?.release(); }

    next() {
      if(this.gate !== Infinity && --this.gate <= 0) { this.gate = Infinity; this.release(); }
      const v = this.sample();
      this.t++;
      // ends on envelope end, or after 0.3 s of near silence (decaying strings, one-shots)
      if(Math.abs(v) < 0.0002) { if(++this.quiet > this.sr * 0.3 && this.t > this.sr * 0.05) this.done = true; }
      else this.quiet = 0;
      if(this.env?.done) this.done = true;
      return v;
    }
  }

  class ChipVoice extends Voice {
    constructor(o) {
      const i = o.inst;
      super(o, new Env(i.a, i.d, i.s, i.r, o.sr));
      this.i = i;
      this.ph = 0;
      this.q = -1;
      this.lfsr = 1;
      this.lp = new Lowpass(i.lpf ?? 1, o.sr);
      this.duty = { pulse12: 0.125, pulse25: 0.25, pulse50: 0.5 }[i.wave] ?? 0.5;
      this.cur = o.fromHz > 0 && i.glide > 0 ? o.fromHz : o.hz;
      this.glideK = this.cur === o.hz ? 1 : Math.exp(Math.log(o.hz / this.cur) / (i.glide * o.sr));
    }

    sample() {
      const i = this.i;
      if(this.glideK !== 1) {
        this.cur *= this.glideK;
        if((this.glideK > 1 && this.cur >= this.hz) || (this.glideK < 1 && this.cur <= this.hz)) { this.cur = this.hz; this.glideK = 1; }
      }
      let f = this.cur;
      if(i.vibDepth > 0) f *= 2 ** (i.vibDepth * Math.sin(TAU * i.vibSpeed * this.t / this.sr) / 12);
      this.ph += f / this.sr;
      if(this.ph >= 1) this.ph -= Math.floor(this.ph);
      const p = this.ph;
      let s;
      switch(i.wave) {
        case 'tri': s = Math.round((1 - Math.abs(p * 2 - 1)) * 15) / 15 * 2 - 1; break;   // NES 4-bit triangle
        case 'saw': s = 1 - p * 2; break;
        case 'sine': s = Math.sin(TAU * p); break;
        case 'noise': {
          const q = (p * 16) | 0;
          if(q !== this.q) {
            this.q = q;
            const bit = (this.lfsr ^ (this.lfsr >> 1)) & 1;   // NES 15-bit LFSR
            this.lfsr = (this.lfsr >> 1) | (bit << 14);
          }
          s = this.lfsr & 1 ? 0.8 : -0.8;
          break;
        }
        default: s = p < this.duty ? 0.6 : -0.6;
      }
      return this.lp.run(s) * this.env.next() * this.vel * i.vol;
    }
  }

  class PluckVoice extends Voice {
    constructor(o) {
      const i = o.inst;
      super(o, new Env(i.a, i.d, i.s, i.r, o.sr));
      this.i = i;
      this.len = Math.max(2, o.sr / o.hz - 0.5);   // the 2-tap average adds half a sample of delay
      this.n = Math.ceil(this.len) + 3;
      this.buf = new Float32Array(this.n);
      this.w = 0;
      const t60 = 0.6 + (1 - i.damp) * 7;
      this.rho = 10 ** (-3 / (t60 * o.hz));
      this.relRho = 10 ** (-3 / (0.12 * o.hz));
      // excitation: noise, darker for soft notes, pick-position comb filter
      const rng = new Noise(o.seed), L = Math.ceil(this.len), e = new Float32Array(L);
      let lp = 0;
      const bright = 0.35 + 0.6 * this.vel;
      for(let k = 0; k < L; k++) { lp += (rng.next() - lp) * bright; e[k] = lp; }
      const P = Math.max(1, Math.round(i.pos * L));
      for(let k = 0; k < L; k++) this.buf[k] = e[k] - e[(k - P + L) % L] * 0.9;
      this.w = L;
      this.body = new Bandpass(190, 1.4, o.sr);
      this.body2 = new Bandpass(420, 2, o.sr);
      this.drive = 1 + i.drive * 12;
      this.norm = 1 / Math.tanh(this.drive);
    }

    release() {
      super.release();
      this.rho = this.relRho;
    }

    #read(d) {
      let pos = this.w - d;
      while(pos < 0) pos += this.n;
      const i0 = Math.floor(pos), fr = pos - i0;
      return this.buf[i0 % this.n] * (1 - fr) + this.buf[(i0 + 1) % this.n] * fr;
    }

    sample() {
      const y = this.rho * 0.5 * (this.#read(this.len) + this.#read(this.len + 1));
      this.buf[this.w] = y;
      this.w = (this.w + 1) % this.n;
      let s = y + this.i.body * (this.body.run(y) * 1.6 + this.body2.run(y) * 0.8);
      if(this.i.drive > 0) s = Math.tanh(s * this.drive) * this.norm;
      return s * 0.55 * this.env.next() * this.vel * this.i.vol;
    }
  }

  class FmVoice extends Voice {
    constructor(o) {
      const i = o.inst;
      super(o, new Env(i.a, i.d, i.s, i.r, o.sr));
      this.i = i;
      this.pc = 0;
      this.pm = 0;
      this.mt = o.sr * (0.03 + (1 - i.bell) * 1.5);
    }

    sample() {
      const i = this.i;
      const idx = i.index * (0.4 + 0.6 * this.vel) * (i.bell > 0 ? Math.exp(-this.t / this.mt) : 1);
      this.pc += this.hz / this.sr;
      this.pm += this.hz * i.ratio / this.sr;
      if(this.pc >= 1) this.pc -= 1;
      if(this.pm >= 1) this.pm -= Math.floor(this.pm);
      let s = Math.sin(TAU * this.pc + idx * Math.sin(TAU * this.pm));
      if(i.trem > 0) s *= 1 - i.trem * 0.5 * (1 + Math.sin(TAU * 5 * this.t / this.sr));
      return s * 0.5 * this.env.next() * this.vel * i.vol;
    }
  }

  const DRAW = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8];   // drawbar footages as harmonic ratios
  class OrganVoice extends Voice {
    constructor(o) {
      const i = o.inst;
      super(o, new Env(i.a, i.d, i.s, i.r, o.sr));
      this.i = i;
      this.ph = new Float64Array(9);
      this.lv = DRAW.map((r, k) => (o.hz * r < o.sr * 0.45 ? (i.drawbars[k] ?? 0) / 8 : 0));
      this.norm = 0.5 / Math.max(1, this.lv.reduce((a, b) => a + b, 0) * 0.6);
      this.pt = o.sr * 0.25;
    }

    sample() {
      let s = 0;
      for(let k = 0; k < 9; k++) {
        if(!this.lv[k] && !(k === 4 && this.i.perc > 0)) continue;
        this.ph[k] += this.hz * DRAW[k] / this.sr;
        if(this.ph[k] >= 1) this.ph[k] -= 1;
        let lv = this.lv[k];
        if(k === 4) lv += this.i.perc * Math.exp(-this.t / this.pt);   // 3rd harmonic percussion
        s += Math.sin(TAU * this.ph[k]) * lv;
      }
      return s * this.norm * this.env.next() * this.vel * this.i.vol;
    }
  }

  class SampleVoice extends Voice {
    /** o.zone: { rate, data, note? }; o.ratio: playback ratio vs the recorded pitch */
    constructor(o) {
      const i = o.inst;
      super(o, new Env(i.a ?? 0.001, i.d ?? 10, i.s ?? 1, i.r ?? 0.2, o.sr));
      this.i = i;
      this.data = o.zone.data;
      this.step = o.ratio * o.zone.rate / o.sr;
      this.pos = 0;
      this.lp = new Lowpass(i.lpf ?? 1, o.sr);
      this.fade = o.fade ?? 0;   // samples time constant of an extra decay (drum "decay" knob), 0 = none
      this.gain = o.gain ?? 1;
    }

    sample() {
      const k = this.pos | 0;
      if(k + 1 >= this.data.length) { this.done = true; return 0; }
      const fr = this.pos - k;
      let s = this.data[k] * (1 - fr) + this.data[k + 1] * fr;
      this.pos += this.step;
      if(this.fade) s *= Math.exp(-this.t / this.fade);
      return this.lp.run(s) * this.env.next() * this.vel * (this.i.vol ?? 1) * this.gain;
    }
  }

  class DrumVoice extends Voice {
    /** o.row: { name, vol, tune, decay } */
    constructor(o) {
      super(o, null);
      this.row = o.row;
      this.kind = o.row.name;
      this.tf = 2 ** ((o.row.tune - 0.5) * 2);
      this.ds = 0.25 * 16 ** o.row.decay;
      this.rng = new Noise(o.seed);
      this.ph = 0;
      this.mph = new Float64Array(6);
      this.hp = 0;
      this.hpx = 0;
      this.bp = new Bandpass(1200 * this.tf, 1.2, o.sr);
      this.sbp = new Bandpass(3500 * this.tf, 0.8, o.sr);
    }

    release() {}   // one-shot

    #metal() {
      let s = 0;
      const base = 330 * this.tf;
      [1, 1.5, 2.08, 2.715, 3.395, 4.105].forEach((r, k) => {
        this.mph[k] += base * r / this.sr;
        if(this.mph[k] >= 1) this.mph[k] -= 1;
        s += this.mph[k] < 0.5 ? 1 : -1;
      });
      return s / 6;
    }

    #highpass(x) {   // one-pole high-pass around 6 kHz
      this.hp = 0.6 * (this.hp + x - this.hpx);
      this.hpx = x;
      return this.hp;
    }

    sample() {
      const t = this.t / this.sr, n = this.rng.next(), ds = this.ds;
      let s, amp;
      switch(this.kind) {
        case 'kick': {
          const f = (48 + 120 * Math.exp(-t / 0.035)) * this.tf;
          this.ph += f / this.sr;
          amp = Math.exp(-t / (0.22 * ds));
          s = Math.sin(TAU * this.ph) * amp + n * Math.exp(-t / 0.002) * 0.3;
          break;
        }
        case 'snare':
          this.ph += 185 * this.tf / this.sr;
          amp = Math.exp(-t / (0.13 * ds));
          s = Math.sin(TAU * this.ph) * Math.exp(-t / (0.06 * ds)) * 0.5 + this.sbp.run(n) * 1.6 * amp;
          break;
        case 'hat-closed':
        case 'hat-open':
          amp = Math.exp(-t / ((this.kind === 'hat-open' ? 0.28 : 0.035) * ds));
          s = this.#highpass(this.#metal() * 0.6 + n * 0.5) * amp;
          break;
        case 'tom-lo':
        case 'tom-hi': {
          const f = (this.kind === 'tom-lo' ? 95 : 150) * this.tf * (1 + 0.6 * Math.exp(-t / 0.04));
          this.ph += f / this.sr;
          amp = Math.exp(-t / (0.28 * ds));
          s = Math.sin(TAU * this.ph) * amp + n * Math.exp(-t / 0.004) * 0.15;
          break;
        }
        case 'clap': {
          const burst = t < 0.03 ? Math.exp(-((t * 1000) % 10) / 3) : 0;
          amp = Math.max(burst, t >= 0.02 ? Math.exp(-(t - 0.02) / (0.14 * ds)) : 0);
          s = this.bp.run(n) * 2.2 * amp;
          break;
        }
        default:   // crash
          amp = Math.exp(-t / (0.45 * ds));
          s = this.#highpass(n * 0.7 + this.#metal() * 0.5) * amp;
      }
      if(amp < 0.0004 && this.t > this.sr * 0.01) this.done = true;
      return s * this.row.vol * this.vel * 0.9;
    }
  }
  //#endregion

  class Synth {
    static Env = Env;
    static Noise = Noise;
    static Lowpass = Lowpass;

    /** Nearest zone of a melodic pack, or undefined. */
    static zone(pack, midi) {
      let best, dist = Infinity;
      for(const z of pack?.zones ?? []) {
        const d = Math.abs(z.note - midi);
        if(z.note !== undefined && d < dist) { best = z; dist = d; }
      }
      return best;
    }

    /**
     * New voice for a track. o: { sr, kind, inst, kit, pitch, hz, vel, gate, seed, fromHz, packs }
     * Melodic: hz is the sounding frequency. Drum: pitch is the row index.
     */
    static voice(o) {
      if(o.kind === 'drum') {
        const kit = o.kit;
        const row = kit.rows[((o.pitch % kit.rows.length) + kit.rows.length) % kit.rows.length];
        const z = kit.mode === 'sample' ? o.packs?.[kit.pack]?.zones.find(x => x.row === row.name) : null;
        if(z) {
          const fade = row.decay < 0.95 ? o.sr * 0.03 * 60 ** row.decay : 0;
          return new SampleVoice({ ...o, inst: { vol: row.vol }, zone: z, ratio: 2 ** ((row.tune - 0.5) * 2), fade, gate: Infinity });
        }
        return new DrumVoice({ ...o, row });
      }
      const inst = o.inst;
      switch(inst.engine) {
        case 'pluck': return new PluckVoice(o);
        case 'fm': return new FmVoice(o);
        case 'organ': return new OrganVoice(o);
        case 'sample': {
          const pack = o.packs?.[inst.pack];
          const midi = 69 + 12 * Math.log2(o.hz / 440);
          const z = Synth.zone(pack, midi);
          if(z) return new SampleVoice({ ...o, zone: z, ratio: o.hz / DAE.Theory.hz(z.note), gain: 0.9 });
          return new FmVoice({ ...o, inst: { ...DAE.Instruments.make('fm'), vol: inst.vol, a: inst.a, d: inst.d, s: inst.s, r: inst.r } });   // pack missing
        }
        default: return new ChipVoice(o);
      }
    }
  }

  DAE.Synth = Synth;
});
