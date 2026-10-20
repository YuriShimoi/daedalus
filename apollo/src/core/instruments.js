// Instrument and drum kit defaults + presets. Times in seconds, levels 0..1.
DAE_CORE(DAE => {
  const clone = o => JSON.parse(JSON.stringify(o));   // structuredClone is missing in AudioWorklet scope
  const ENGINES = ['chip', 'pluck', 'fm', 'organ', 'sample'];
  const CHIP_WAVES = ['pulse12', 'pulse25', 'pulse50', 'tri', 'saw', 'sine', 'noise'];
  const DRUM_ROWS = ['kick', 'snare', 'hat-closed', 'hat-open', 'tom-lo', 'tom-hi', 'clap', 'crash'];

  const BASE = { vol: 0.7, a: 0.005, d: 0.2, s: 0.7, r: 0.15 };
  const DEFAULTS = {
    chip:   { wave: 'pulse25', lpf: 1, vibDepth: 0, vibSpeed: 5, glide: 0 },
    pluck:  { pos: 0.3, damp: 0.4, body: 0.5, drive: 0, a: 0.001, d: 1.5, s: 0.6, r: 0.25 },
    fm:     { ratio: 1, index: 2.5, bell: 0.4, trem: 0, a: 0.002, d: 1.2, s: 0.4, r: 0.3 },
    organ:  { drawbars: [8, 8, 8, 0, 0, 0, 0, 0, 0], perc: 0.3, a: 0.004, d: 0.1, s: 1, r: 0.06 },
    sample: { pack: 'fluid-piano', lpf: 1, a: 0.001, d: 2, s: 0.8, r: 0.35 },
  };

  const PRESETS = {
    chip: {
      lead:  { wave: 'pulse25', a: 0.005, d: 0.15, s: 0.6, r: 0.1, vibDepth: 0.15, vibSpeed: 5.5 },
      bass:  { wave: 'tri', a: 0.002, d: 0.1, s: 0.9, r: 0.05 },
      arp:   { wave: 'pulse12', a: 0.001, d: 0.08, s: 0.3, r: 0.05 },
      pad:   { wave: 'saw', a: 0.4, d: 0.5, s: 0.7, r: 0.8, lpf: 0.45, vibDepth: 0.08, vibSpeed: 4 },
      bell:  { wave: 'sine', a: 0.001, d: 0.9, s: 0, r: 0.6 },
      noise: { wave: 'noise', a: 0.001, d: 0.15, s: 0, r: 0.05 },
    },
    pluck: {
      acoustic: { pos: 0.25, damp: 0.35, body: 0.6, drive: 0 },
      electric: { pos: 0.12, damp: 0.25, body: 0.2, drive: 0.55 },
      bass:     { pos: 0.4, damp: 0.6, body: 0.7, drive: 0.1 },
      harp:     { pos: 0.5, damp: 0.2, body: 0.4, drive: 0 },
      nylon:    { pos: 0.35, damp: 0.55, body: 0.8, drive: 0 },
    },
    fm: {
      'e-piano': { ratio: 1, index: 2.5, bell: 0.4, trem: 0.15 },
      bell:      { ratio: 3.5, index: 4, bell: 0.7, trem: 0, d: 2.5, s: 0 },
      clav:      { ratio: 2, index: 3, bell: 0.9, trem: 0, d: 0.3, s: 0.2 },
      tine:      { ratio: 7, index: 1.5, bell: 0.8, trem: 0.1 },
    },
    organ: {
      jazz:   { drawbars: [8, 8, 8, 0, 0, 0, 0, 0, 0], perc: 0.4 },
      full:   { drawbars: [8, 8, 8, 8, 8, 8, 8, 8, 8], perc: 0 },
      flute:  { drawbars: [0, 0, 8, 4, 0, 0, 0, 0, 0], perc: 0 },
      church: { drawbars: [8, 6, 8, 6, 4, 2, 0, 4, 2], perc: 0, a: 0.05, r: 0.4 },
    },
    sample: {
      piano:    { pack: 'fluid-piano' },
      guitar:   { pack: 'fluid-guitar' },
      'e-piano': { pack: 'fluid-epiano' },
    },
  };

  const KIT_DEFAULT = { kick: [0.9, 0.5, 0.5], snare: [0.7, 0.5, 0.5], 'hat-closed': [0.45, 0.5, 0.4], 'hat-open': [0.4, 0.5, 0.5],
    'tom-lo': [0.7, 0.4, 0.5], 'tom-hi': [0.65, 0.6, 0.5], clap: [0.6, 0.5, 0.5], crash: [0.4, 0.5, 0.6] };

  class Instruments {
    static ENGINES = ENGINES;
    static CHIP_WAVES = CHIP_WAVES;
    static DRUM_ROWS = DRUM_ROWS;
    static PRESETS = PRESETS;

    static make(engine = 'chip', preset) {
      const inst = { engine, ...BASE, ...clone(DEFAULTS[engine] ?? DEFAULTS.chip) };
      if(preset) Object.assign(inst, clone(PRESETS[engine]?.[preset] ?? {}), { preset });
      return inst;
    }

    /** Keeps known fields and fills the rest (for loaded files and engine switches). */
    static normalize(inst) {
      const engine = ENGINES.includes(inst?.engine) ? inst.engine : 'chip';
      const out = Instruments.make(engine);
      for(const k of Object.keys(out)) if(inst?.[k] !== undefined) out[k] = k === 'drawbars' ? [...inst[k]].map(Number) : inst[k];
      if(inst?.preset) out.preset = inst.preset;
      return out;
    }

    static makeKit(mode = 'synth') {
      return { mode, pack: 'vcsl-kit', rows: DRUM_ROWS.map(name => {
        const [vol, tune, decay] = KIT_DEFAULT[name];
        return { name, vol, tune, decay };
      }) };
    }

    static normalizeKit(kit) {
      const out = Instruments.makeKit(kit?.mode === 'sample' ? 'sample' : 'synth');
      if(kit?.pack) out.pack = kit.pack;
      for(const row of out.rows) {
        const r = kit?.rows?.find(x => x.name === row.name);
        if(r) for(const k of ['vol', 'tune', 'decay']) if(r[k] !== undefined) row[k] = Number(r[k]);
      }
      return out;
    }
  }

  DAE.Instruments = Instruments;
});
