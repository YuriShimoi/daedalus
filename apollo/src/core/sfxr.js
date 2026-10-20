// Sound effect generator: sfxr synthesis ported from tools/media/sfx.py (same params and core math, so
// effects made by the CLI tool open here) plus bfxr-style extras (more waves, compression, harmonics,
// bit crush, pitch jump). Generators follow jsfxr (Unlicense) / bfxr2 (MIT) / sfx.py presets.
DAE_CORE(DAE => {
  const WAVES = ['square', 'saw', 'sine', 'triangle', 'noise', 'pink', '1-bit', 'breaker', 'tan', 'whistle', 'buzz'];
  const OLD_WAVES = ['tri', 'metal'];   // sfx.py waves: NES stepped triangle, looped noise
  const PY_WAVES = ['square', 'saw', 'sine', 'noise', 'tri', 'metal'];   // sfx.py preset indexes

  // [key, label, group, signed (-1..1), default]
  const PARAMS = [
    ['attack', 'attack', 'Envelope', false, 0], ['sustain', 'sustain', 'Envelope', false, 0.3], ['punch', 'punch', 'Envelope', false, 0],
    ['decay', 'decay', 'Envelope', false, 0.4], ['compression', 'compress', 'Envelope', false, 0], ['vol', 'volume', 'Envelope', false, 0.5],
    ['base_freq', 'base freq', 'Frequency', false, 0.3], ['freq_limit', 'min freq', 'Frequency', false, 0], ['freq_ramp', 'slide', 'Frequency', true, 0],
    ['freq_dramp', 'delta slide', 'Frequency', true, 0], ['jump_amount', 'pitch jump', 'Frequency', true, 0], ['jump_onset', 'jump onset', 'Frequency', false, 0.5],
    ['vib_strength', 'depth', 'Vibrato', false, 0], ['vib_speed', 'speed', 'Vibrato', false, 0],
    ['arp_mod', 'arp mult', 'Arp / repeat', true, 0], ['arp_speed', 'arp speed', 'Arp / repeat', false, 0], ['repeat_speed', 'repeat', 'Arp / repeat', false, 0],
    ['duty', 'duty', 'Duty / tone', false, 0], ['duty_ramp', 'duty sweep', 'Duty / tone', true, 0], ['harmonics', 'harmonics', 'Duty / tone', false, 0],
    ['bit_crush', 'bit crush', 'Duty / tone', false, 0],
    ['pha_offset', 'flanger', 'Filters / flanger', true, 0], ['pha_ramp', 'flange sweep', 'Filters / flanger', true, 0],
    ['lpf_freq', 'low-pass', 'Filters / flanger', false, 1], ['lpf_ramp', 'lp sweep', 'Filters / flanger', true, 0],
    ['lpf_resonance', 'resonance', 'Filters / flanger', false, 0], ['hpf_freq', 'high-pass', 'Filters / flanger', false, 0],
    ['hpf_ramp', 'hp sweep', 'Filters / flanger', true, 0],
  ];
  const SIMPLE = ['attack', 'sustain', 'decay', 'base_freq', 'freq_ramp', 'lpf_freq'];
  const DEFAULTS = Object.fromEntries([['wave', 'square'], ...PARAMS.map(p => [p[0], p[4]])]);
  const GENERATORS = ['pickup', 'laser', 'explosion', 'powerup', 'hit', 'jump', 'blip', 'click', 'synth', 'tone', 'footstep', 'random'];
  const EXTRA_GENERATORS = ['menu', 'error', 'zap', 'teleport', 'thud'];   // sfx.py extras

  class Sfxr {
    static WAVES = WAVES;
    static PARAMS = PARAMS;
    static SIMPLE = SIMPLE;
    static DEFAULTS = DEFAULTS;
    static GENERATORS = GENERATORS;
    static EXTRA_GENERATORS = EXTRA_GENERATORS;

    static param(key) {
      return PARAMS.find(p => p[0] === key);
    }

    static normalize(x) {
      const params = { ...DEFAULTS };
      for(const k of Object.keys(params)) if(x?.params?.[k] !== undefined) params[k] = k === 'wave' ? String(x.params[k]) : Number(x.params[k]);
      if(!WAVES.includes(params.wave) && !OLD_WAVES.includes(params.wave)) params.wave = 'square';
      return { id: Number(x?.id ?? 0), name: String(x?.name ?? 'sound'), gen: String(x?.gen ?? 'random'), seed: Number(x?.seed ?? 0),
        params, locks: (x?.locks ?? []).map(String).filter(k => k in DEFAULTS) };
    }

    //#region [ Generators ]
    /** sfx.py / jsfxr presets. Locked params keep the values of `keep`. */
    static generate(gen, seed, locks = [], keep = null) {
      const R = new DAE.Rng(seed);
      const rnd = n => R.int(0, n), frnd = r => R.next() * r;
      const p = { ...DEFAULTS };
      switch(gen) {
        case 'pickup': case 'coin':
          Object.assign(p, { base_freq: 0.4 + frnd(0.5), sustain: frnd(0.1), decay: 0.1 + frnd(0.4), punch: 0.3 + frnd(0.3) });
          if(rnd(1)) Object.assign(p, { arp_speed: 0.5 + frnd(0.2), arp_mod: 0.2 + frnd(0.4) });
          break;
        case 'laser': case 'shoot': {
          let w = rnd(2);
          if(w === 2 && rnd(1)) w = rnd(1);
          p.wave = PY_WAVES[w];
          p.base_freq = 0.5 + frnd(0.5);
          p.freq_limit = Math.max(0.2, p.base_freq - 0.2 - frnd(0.6));
          p.freq_ramp = -0.15 - frnd(0.2);
          if(rnd(2) === 0) Object.assign(p, { base_freq: 0.3 + frnd(0.6), freq_limit: frnd(0.1), freq_ramp: -0.35 - frnd(0.3) });
          if(rnd(1)) Object.assign(p, { duty: frnd(0.5), duty_ramp: frnd(0.2) });
          else Object.assign(p, { duty: 0.4 + frnd(0.5), duty_ramp: -frnd(0.7) });
          Object.assign(p, { sustain: 0.1 + frnd(0.2), decay: frnd(0.4) });
          if(rnd(1)) p.punch = frnd(0.3);
          if(rnd(2) === 0) Object.assign(p, { pha_offset: frnd(0.2), pha_ramp: -frnd(0.2) });
          if(rnd(1)) p.hpf_freq = frnd(0.3);
          break;
        }
        case 'explosion': case 'boom':
          p.wave = 'noise';
          if(rnd(1)) Object.assign(p, { base_freq: 0.1 + frnd(0.4), freq_ramp: -0.1 + frnd(0.4) });
          else Object.assign(p, { base_freq: 0.2 + frnd(0.7), freq_ramp: -0.2 - frnd(0.2) });
          p.base_freq **= 2;
          if(rnd(4) === 0) p.freq_ramp = 0;
          if(rnd(2) === 0) p.repeat_speed = 0.3 + frnd(0.5);
          Object.assign(p, { sustain: 0.1 + frnd(0.3), decay: frnd(0.5), punch: 0.2 + frnd(0.6) });
          if(rnd(1) === 0) Object.assign(p, { pha_offset: -0.3 + frnd(0.9), pha_ramp: -frnd(0.3) });
          if(rnd(1)) Object.assign(p, { vib_strength: frnd(0.7), vib_speed: frnd(0.6) });
          if(rnd(2) === 0) Object.assign(p, { arp_speed: 0.6 + frnd(0.3), arp_mod: 0.8 - frnd(1.6) });
          break;
        case 'powerup':
          if(rnd(1)) p.wave = 'saw';
          else p.duty = frnd(0.6);
          if(rnd(1)) Object.assign(p, { base_freq: 0.2 + frnd(0.3), freq_ramp: 0.1 + frnd(0.4), repeat_speed: 0.4 + frnd(0.4) });
          else {
            Object.assign(p, { base_freq: 0.2 + frnd(0.3), freq_ramp: 0.05 + frnd(0.2) });
            if(rnd(1)) Object.assign(p, { vib_strength: frnd(0.7), vib_speed: frnd(0.6) });
          }
          Object.assign(p, { sustain: frnd(0.4), decay: 0.1 + frnd(0.4) });
          break;
        case 'hit': case 'hurt': {
          const w = rnd(2);
          p.wave = w === 2 ? 'noise' : PY_WAVES[w];
          if(w === 0) p.duty = frnd(0.6);
          Object.assign(p, { base_freq: 0.2 + frnd(0.6), freq_ramp: -0.3 - frnd(0.4), sustain: frnd(0.1), decay: 0.1 + frnd(0.2) });
          if(rnd(1)) p.hpf_freq = frnd(0.3);
          break;
        }
        case 'jump':
          Object.assign(p, { duty: frnd(0.6), base_freq: 0.3 + frnd(0.3), freq_ramp: 0.1 + frnd(0.2), sustain: 0.1 + frnd(0.3), decay: 0.1 + frnd(0.2) });
          if(rnd(1)) p.hpf_freq = frnd(0.3);
          if(rnd(1)) p.lpf_freq = 1 - frnd(0.6);
          break;
        case 'blip': case 'select':
          p.wave = PY_WAVES[rnd(1)];
          if(p.wave === 'square') p.duty = frnd(0.6);
          Object.assign(p, { base_freq: 0.2 + frnd(0.4), sustain: 0.1 + frnd(0.1), decay: frnd(0.2), hpf_freq: 0.1 });
          break;
        case 'click':
          Object.assign(p, { wave: R.pick(['square', 'noise', '1-bit']), base_freq: 0.55 + frnd(0.35), sustain: frnd(0.02), decay: 0.02 + frnd(0.06),
            hpf_freq: 0.15 + frnd(0.3), duty: frnd(0.6) });
          break;
        case 'synth':
          Object.assign(p, { wave: R.pick(['square', 'saw', 'sine', 'triangle']), base_freq: R.pick([0.2723171360931539, 0.19255692561524382, 0.13615778746815396]),
            attack: rnd(4) > 3 ? frnd(0.5) : 0, sustain: frnd(0.6) + 0.1, punch: frnd(0.2), decay: frnd(0.4) + 0.1, duty: frnd(0.6), duty_ramp: frnd(0.2) - 0.1,
            lpf_freq: rnd(1) ? 1 : 0.4 + frnd(0.6), lpf_resonance: frnd(0.5), vib_strength: rnd(2) === 0 ? frnd(0.2) : 0, vib_speed: frnd(0.6) });
          if(rnd(1)) Object.assign(p, { arp_mod: R.pick([0.5, 0.3, -0.3]), arp_speed: 0.5 + frnd(0.3) });
          break;
        case 'tone':
          Object.assign(p, { wave: 'sine', base_freq: 0.35173364, sustain: 0.6641, decay: 0, punch: 0 });   // 440 Hz, 1 s
          break;
        case 'footstep': case 'step':
          Object.assign(p, { wave: 'noise', base_freq: 0.35 + frnd(0.25), sustain: 0.01 + frnd(0.02), decay: 0.05 + frnd(0.08), hpf_freq: 0.05 + frnd(0.15), lpf_freq: 0.5 + frnd(0.3) });
          break;
        case 'menu':
          Object.assign(p, { wave: R.pick(['square', 'tri']), duty: R.pick([0, 0.5, 0.75]), base_freq: 0.45 + frnd(0.2), sustain: 0.03 + frnd(0.04), decay: 0.05 + frnd(0.1) });
          break;
        case 'error':
          Object.assign(p, { wave: 'square', duty: 0.5, base_freq: 0.12 + frnd(0.08), sustain: 0.15 + frnd(0.1), decay: 0.1 + frnd(0.1), repeat_speed: 0.55 + frnd(0.15) });
          break;
        case 'zap':
          Object.assign(p, { wave: R.pick(['saw', 'square']), base_freq: 0.6 + frnd(0.3), freq_ramp: -0.5 - frnd(0.3), vib_strength: 0.3 + frnd(0.4), vib_speed: 0.6 + frnd(0.3),
            sustain: 0.05 + frnd(0.1), decay: 0.1 + frnd(0.15) });
          break;
        case 'teleport':
          Object.assign(p, { wave: R.pick(['sine', 'tri', 'square']), base_freq: 0.2 + frnd(0.2), freq_ramp: 0.25 + frnd(0.2), vib_strength: 0.2 + frnd(0.3), vib_speed: 0.5 + frnd(0.4),
            repeat_speed: 0.3 + frnd(0.3), sustain: 0.2 + frnd(0.2), decay: 0.2 + frnd(0.2), pha_offset: frnd(0.3), pha_ramp: frnd(0.2) });
          break;
        case 'thud':
          Object.assign(p, { wave: R.pick(['noise', 'tri']), base_freq: 0.08 + frnd(0.1), freq_ramp: -0.2 - frnd(0.2), sustain: 0.02 + frnd(0.05), decay: 0.15 + frnd(0.2),
            punch: 0.4 + frnd(0.4), lpf_freq: 0.3 + frnd(0.3) });
          break;
        default:   // random
          Object.assign(p, { wave: R.pick(WAVES), base_freq: frnd(1) ** 2, freq_ramp: frnd(2) - 1, freq_dramp: frnd(0.4) - 0.2,
            duty: frnd(1), duty_ramp: frnd(0.4) - 0.2, vib_strength: frnd(0.5) ** 2, vib_speed: frnd(1),
            attack: frnd(0.3) ** 3, sustain: frnd(0.5) ** 2 + 0.05, decay: frnd(0.6), punch: frnd(0.4) ** 2,
            lpf_freq: 1 - frnd(1) ** 3, lpf_resonance: frnd(1), hpf_freq: frnd(1) ** 5,
            pha_offset: frnd(0.5) - 0.25, repeat_speed: rnd(2) === 0 ? frnd(1) : 0, arp_speed: frnd(1), arp_mod: frnd(2) - 1,
            harmonics: rnd(3) === 0 ? frnd(0.6) : 0, bit_crush: rnd(4) === 0 ? frnd(0.5) : 0, compression: rnd(3) === 0 ? frnd(0.6) : 0 });
          if(p.freq_ramp < 0 && p.base_freq < 0.2) p.base_freq += 0.3;
          if(p.attack + p.sustain + p.decay < 0.2) { p.sustain += 0.2 + frnd(0.3); p.decay += 0.2 + frnd(0.3); }
      }
      if(keep) for(const k of locks) p[k] = keep[k];
      return p;
    }

    /** Small random change of every unlocked param (each moves with 50% chance). */
    static mutate(params, seed, locks = [], amount = 0.05) {
      const R = new DAE.Rng(seed), p = { ...params };
      for(const [k, , , signed] of PARAMS) {
        if(locks.includes(k) || k === 'vol' || !R.chance(0.5)) continue;
        p[k] = Math.max(signed ? -1 : 0, Math.min(1, p[k] + (R.next() * 2 - 1) * amount));
      }
      return p;
    }
    //#endregion

    //#region [ Synthesis ]
    /** Raw render at 44.1 kHz, then resampled to `rate`. Port of sfx.py synth() + extras. */
    static render(p, seed = 1, rate = 44100) {
      const R = new DAE.Rng(seed);
      const wave = p.wave;
      const st = {};
      let noise = Array.from({ length: 32 }, () => R.next() * 2 - 1);
      let pink = Sfxr.#pinkBuf(R);
      let lfsr = 1, lfsrQ = -1, buzz = 1, buzzQ = -1;

      const reset = restart => {
        st.fperiod = 100 / (p.base_freq ** 2 + 0.001);
        st.fmaxperiod = 100 / (p.freq_limit ** 2 + 0.001);
        st.fslide = 1 - p.freq_ramp ** 3 * 0.01;
        st.fdslide = -(p.freq_dramp ** 3) * 0.000001;
        st.duty = 0.5 - p.duty * 0.5;
        st.duty_slide = -p.duty_ramp * 0.00005;
        const am = p.arp_mod;
        st.arp_mod = am >= 0 ? 1 - am ** 2 * 0.9 : 1 + am ** 2 * 10;
        st.arp_time = 0;
        st.arp_limit = p.arp_speed === 1 ? 0 : Math.trunc((1 - p.arp_speed) ** 2 * 20000 + 32);
        if(restart) return;
        Object.assign(st, { phase: 0, fltp: 0, fltdp: 0, fltphp: 0, vib_phase: 0, env_stage: 0, env_time: 0, rep_time: 0, ipp: 0, jumped: false, t: 0 });
        st.fltw = p.lpf_freq ** 3 * 0.1;
        st.fltw_d = 1 + p.lpf_ramp * 0.0001;
        st.fltdmp = Math.min(0.8, 5 / (1 + p.lpf_resonance ** 2 * 20) * (0.01 + st.fltw));
        st.flthp = p.hpf_freq ** 2 * 0.1;
        st.flthp_d = 1 + p.hpf_ramp * 0.0003;
        st.vib_speed = p.vib_speed ** 2 * 0.01;
        st.vib_amp = p.vib_strength * 0.5;
        st.env_len = [Math.trunc(p.attack ** 2 * 100000), Math.trunc(p.sustain ** 2 * 100000), Math.trunc(p.decay ** 2 * 100000)];
        st.fphase = Math.sign(p.pha_offset) * p.pha_offset ** 2 * 1020;
        st.fdphase = Math.sign(p.pha_ramp) * p.pha_ramp ** 2;
        st.iphase = Math.abs(Math.trunc(st.fphase));
        st.phaser = new Float32Array(1024);
        st.rep_limit = p.repeat_speed === 0 ? 0 : Math.trunc((1 - p.repeat_speed) ** 2 * 20000 + 32);
        st.jump_at = p.jump_amount ? Math.trunc((st.env_len[0] + st.env_len[1] + st.env_len[2]) * p.jump_onset) : -1;
      };

      const osc = fp => {
        switch(wave) {
          case 'square': return fp < st.duty ? 0.5 : -0.5;
          case 'saw': return 1 - fp * 2;
          case 'sine': return Math.sin(fp * 2 * Math.PI);
          case 'tri': return (Math.round((1 - Math.abs(fp * 2 - 1)) * 15) / 15) * 2 - 1;
          case 'triangle': return fp < 0.5 ? fp * 4 - 1 : 3 - fp * 4;
          case 'pink': return pink[Math.trunc(fp * 32) % 32];
          case '1-bit': {
            const q = Math.trunc(fp * 32);
            if(q !== lfsrQ) { lfsrQ = q; const b = (lfsr ^ (lfsr >> 1)) & 1; lfsr = (lfsr >> 1) | (b << 14); }
            return lfsr & 1 ? 0.5 : -0.5;
          }
          case 'buzz': {   // short 7-bit LFSR loop: metallic buzz
            const q = Math.trunc(fp * 32);
            if(q !== buzzQ) { buzzQ = q; const b = (buzz ^ (buzz >> 1)) & 1; buzz = ((buzz >> 1) | (b << 6)) & 0x7F; }
            return buzz & 1 ? 0.5 : -0.5;
          }
          case 'breaker': { const a = (fp + 0.8660254) % 1; return Math.abs(1 - a * a * 2) - 1; }
          case 'tan': return Math.max(-1, Math.min(1, Math.tan(Math.PI * fp) * 0.5));
          case 'whistle': return 0.75 * Math.sin(fp * 2 * Math.PI) + 0.25 * Math.sin(fp * 40 * Math.PI);
          default: return noise[Math.trunc(fp * 32) % 32];   // noise, metal
        }
      };

      const harm = Math.round(p.harmonics * 8), crushN = 1 + Math.floor(p.bit_crush ** 2 * 30);
      const comp = 1 / (1 + 4 * p.compression);
      let crushT = 0, crushV = 0;
      reset(false);
      const out = [];
      while(true) {
        st.rep_time++;
        if(st.rep_limit && st.rep_time >= st.rep_limit) { st.rep_time = 0; reset(true); }
        st.arp_time++;
        if(st.arp_limit && st.arp_time >= st.arp_limit) { st.arp_limit = 0; st.fperiod *= st.arp_mod; }
        if(st.jump_at >= 0 && !st.jumped && st.t++ >= st.jump_at) { st.jumped = true; st.fperiod *= 1 - p.jump_amount * 0.5; }   // +1: octave up, -1: a fifth down
        st.fslide += st.fdslide;
        st.fperiod *= st.fslide;
        if(st.fperiod > st.fmaxperiod) {
          st.fperiod = st.fmaxperiod;
          if(p.freq_limit > 0) break;
        }
        let rfperiod = st.fperiod;
        if(st.vib_amp > 0) {
          st.vib_phase += st.vib_speed;
          rfperiod = st.fperiod * (1 + Math.sin(st.vib_phase) * st.vib_amp);
        }
        const period = Math.max(8, Math.trunc(rfperiod));
        st.duty = Math.min(0.5, Math.max(0, st.duty + st.duty_slide));
        st.env_time++;
        if(st.env_time > st.env_len[st.env_stage]) {
          st.env_time = 0;
          st.env_stage++;
          if(st.env_stage === 3) break;
        }
        const et = st.env_time, el = st.env_len[st.env_stage];
        let ev;
        if(st.env_stage === 0) ev = el ? et / el : 1;
        else if(st.env_stage === 1) ev = 1 + (el ? 1 - et / el : 0) * 2 * p.punch;
        else ev = el ? 1 - et / el : 0;
        st.fphase += st.fdphase;
        st.iphase = Math.min(1023, Math.abs(Math.trunc(st.fphase)));
        if(st.flthp_d !== 1) st.flthp = Math.min(0.1, Math.max(0.00001, st.flthp * st.flthp_d));
        let ssample = 0;
        for(let k = 0; k < 8; k++) {
          st.phase++;
          if(st.phase >= period) {
            st.phase %= period;
            if(wave === 'noise') noise = noise.map(() => R.next() * 2 - 1);
            if(wave === 'pink') pink = Sfxr.#pinkBuf(R);
          }
          const fp = st.phase / period;
          let s = osc(fp);
          if(harm) {
            let norm = 1, fall = 1;
            for(let h = 1; h <= harm; h++) { fall *= 0.55; s += osc((fp * (h + 1)) % 1) * fall; norm += fall; }
            s /= norm;
          }
          const pp = st.fltp;
          st.fltw = Math.min(0.1, Math.max(0, st.fltw * st.fltw_d));
          if(p.lpf_freq !== 1) {
            st.fltdp += (s - st.fltp) * st.fltw;
            st.fltdp -= st.fltdp * st.fltdmp;
          }
          else { st.fltp = s; st.fltdp = 0; }
          st.fltp += st.fltdp;
          st.fltphp += st.fltp - pp;
          st.fltphp -= st.fltphp * st.flthp;
          s = st.fltphp;
          const ph = st.phaser;
          ph[st.ipp & 1023] = s;
          s += ph[(st.ipp - st.iphase + 1024) & 1023];
          st.ipp = (st.ipp + 1) & 1023;
          ssample += s * ev;
        }
        let v = ssample / 8 * 0.05 * 2 * p.vol;
        if(p.compression > 0) v = v > 0 ? v ** comp : -((-v) ** comp);
        if(crushN > 1) { if(crushT++ % crushN === 0) crushV = v; v = crushV; }
        out.push(Math.max(-1, Math.min(1, v)));
        if(out.length > 44100 * 6) break;
      }
      const x = Float32Array.from(out);
      return rate === 44100 ? x : DAE.Wav.resample(x, 44100, rate);
    }

    /** 32 values of pink noise (Paul Kellet's filter). */
    static #pinkBuf(R) {
      let b0 = 0, b1 = 0, b2 = 0;
      const out = [];
      for(let i = 0; i < 64; i++) {
        const w = R.next() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        if(i >= 32) out.push((b0 + b1 + b2 + w * 0.1848) * 0.25);
      }
      return out;
    }

    /** Peak-normalized copy (-1 dBFS); silent input stays as is. */
    static normalize01(x, db = -1) {
      let peak = 0;
      for(const v of x) peak = Math.max(peak, Math.abs(v));
      if(peak < 1e-6) return x;
      const g = 10 ** (db / 20) / peak, out = new Float32Array(x.length);
      for(let i = 0; i < x.length; i++) out[i] = x[i] * g;
      return out;
    }

    /** One sound, a mix (layers with delay ms and vol %) or a set item, rendered at `rate`. */
    static renderItem(project, id, rate = 44100) {
      const sfx = project.sfx.find(s => s.id === id);
      if(sfx) return Sfxr.render(sfx.params, sfx.seed, rate);
      const mix = project.mixes.find(m => m.id === id);
      if(mix) return Sfxr.renderMix(project, mix, rate);
      return new Float32Array(0);
    }

    static renderMix(project, mix, rate = 44100) {
      const parts = mix.layers.filter(l => l.sfx && l.vol > 0).map(l => {
        const s = project.sfx.find(x => x.id === l.sfx);
        return s ? { x: Sfxr.render(s.params, s.seed, rate), at: Math.round(l.delay / 1000 * rate), g: l.vol / 100 } : null;
      }).filter(Boolean);
      const len = parts.reduce((m, q) => Math.max(m, q.at + q.x.length), 0);
      const out = new Float32Array(len);
      for(const q of parts) for(let i = 0; i < q.x.length; i++) out[q.at + i] += q.x[i] * q.g;
      return out;
    }

    /** Length, size, peak (dBFS) and clipped samples of a render. */
    static info(x, rate = 44100, bits = 16) {
      let peak = 0, clipped = 0;
      for(const v of x) { const a = Math.abs(v); if(a > peak) peak = a; if(a >= 0.9999) clipped++; }
      return { seconds: x.length / rate, samples: x.length, bytes: 44 + x.length * bits / 8, peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity, clipped };
    }
    //#endregion
  }

  DAE.Sfxr = Sfxr;
});
