// CLI edit ops: one string per change ("track add drum name=Beat"), applied in order to a project.
// Node only (used by cli.js and the tests); the page edits through the UI.
const DAE = require('../core/index.js');
const { Project, Instruments, Keymap, Sfxr, Theory } = DAE;

//#region [ Values ]
require('../../../shared/cli.js');
const { words, fields, value, number } = DAE.Cli;   // shared op-string helpers

/** "3", "1-8" (1-based, inclusive) -> [from, to] 0-based. */
function barRange(text, bars) {
  const [a, b = a] = String(text).split('-').map(x => number(x, 'bar'));
  if(a < 1 || b > bars || b < a) throw new Error(`bars ${text}: song has bars 1-${bars}`);
  return [a - 1, b - 1];
}

/** Steps: "4", "0,4,8", "0-15/4" (from-to every n). */
function steps(text) {
  const out = [];
  for(const part of String(text).split(',')) {
    const m = /^(\d+)-(\d+)(?:\/(\d+))?$/.exec(part);
    if(m) for(let s = Number(m[1]); s <= Number(m[2]); s += Number(m[3] ?? 1)) out.push(s);
    else out.push(number(part, 'step'));
  }
  return out;
}

/** Note name (C4, F#3, Bb2) or midi number. */
function pitch(text) {
  const n = /^\d+$/.test(text) ? Number(text) : Theory.parse(text);
  if(isNaN(n) || n < 0 || n > 127) throw new Error(`bad note "${text}" (use C4, F#3, Bb2 or a midi number)`);
  return n;
}

/** Physical key: KeyZ / Digit2 / Comma, or a plain character (z, 2, ,). */
function keyCode(text) {
  if(/^(Key|Digit|Numpad)|^[A-Z][a-z]+/.test(text) && text.length > 1) return text;
  const c = String(text).toUpperCase();
  if(/^[A-Z]$/.test(c)) return 'Key' + c;
  if(/^\d$/.test(c)) return 'Digit' + c;
  const named = { ',': 'Comma', '.': 'Period', '/': 'Slash', ';': 'Semicolon', "'": 'Quote', '-': 'Minus', '=': 'Equal',
    '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash', '`': 'Backquote' };
  if(named[text]) return named[text];
  throw new Error(`bad key "${text}"`);
}
//#endregion

//#region [ Lookups ]
function track(p, ref) {
  const t = p.tracks.find(x => String(x.id) === String(ref)) ?? p.tracks.find(x => x.name.toLowerCase() === String(ref).toLowerCase());
  if(!t) throw new Error(`no track "${ref}" (have: ${p.tracks.map(x => `${x.id}:${x.name}`).join(', ')})`);
  return t;
}

/** Pattern by id ("4") or by its number inside a track ("Drums:2", as the page shows it). */
function pattern(p, ref) {
  const s = String(ref), i = s.lastIndexOf(':');
  if(i > 0) {
    const t = track(p, s.slice(0, i)), n = number(s.slice(i + 1), 'pattern number');
    const pat = p.patterns.filter(x => x.track === t.id)[n - 1];
    if(!pat) throw new Error(`track "${t.name}" has no pattern ${n}`);
    return pat;
  }
  const pat = p.patterns.find(x => String(x.id) === s);
  if(!pat) throw new Error(`no pattern "${ref}" (ids: ${p.patterns.map(x => x.id).join(', ') || 'none'})`);
  return pat;
}

function sound(p, ref, list = 'sfx') {
  const x = p[list].find(s => s.name === ref) ?? p[list].find(s => String(s.id) === String(ref));
  if(!x) throw new Error(`no ${list === 'sfx' ? 'sound' : list.slice(0, -1)} "${ref}" (have: ${p[list].map(s => s.name).join(', ') || 'none'})`);
  return x;
}

const newId = p => Project.nextId([...p.sfx, ...p.mixes, ...p.sets]);

function freeName(p, base) {
  const used = new Set([...p.sfx, ...p.mixes, ...p.sets].map(s => s.name));
  for(let i = 1; ; i++) { const n = `${base}_${String(i).padStart(2, '0')}`; if(!used.has(n)) return n; }
}

/** Key index of the keyboard template: index number or the note it plays (C3). */
function keyIndex(p, ref) {
  const keys = p.keyboard.keys;
  let i = /^\d+$/.test(ref) && Number(ref) < keys.length ? Number(ref) : keys.findIndex(k => k.note === pitch(ref));
  if(i < 0 || !keys[i]) throw new Error(`no key "${ref}" in the keyboard template`);
  return i;
}
//#endregion

//#region [ Ops ]
const SONG_KEYS = ['bpm', 'key', 'scale', 'bars', 'loop', 'master', 'beatsPerBar', 'stepsPerBeat'];

const OPS = {
  mode(p, [m]) {
    if(m !== 'music' && m !== 'sfx') throw new Error('mode music|sfx');
    p.mode = m;
  },

  level(p, [m, l]) {
    if(!['music', 'sfx'].includes(m) || !['simple', 'full'].includes(l)) throw new Error('level music|sfx simple|full');
    p.level[m] = l;
  },

  song(p, args) {
    const { kv } = fields(args), s = p.song;
    for(const [k, v] of Object.entries(kv)) {
      if(!SONG_KEYS.includes(k)) throw new Error(`song: unknown field "${k}" (${SONG_KEYS.join(' ')})`);
      if(k === 'bars') Project.setBars(p, Math.min(128, Math.max(1, number(v, 'bars'))));
      else if(k === 'key') {
        if(!Theory.NAMES.includes(String(v))) throw new Error(`song key: one of ${Theory.NAMES.join(' ')}`);
        s.key = String(v);
      }
      else if(k === 'scale') {
        if(!Theory.SCALES[v]) throw new Error(`song scale: one of ${Object.keys(Theory.SCALES).join(' ')}`);
        s.scale = v;
      }
      else if(k === 'loop') {
        if(v === 'off' || v === false) s.loop.on = false;
        else if(v === 'on' || v === true) s.loop.on = true;
        else { const [a, b] = barRange(v, s.bars); s.loop = { on: true, from: a, to: b + 1 }; }
      }
      else if(k === 'bpm') s.bpm = Math.min(300, Math.max(20, number(v, 'bpm')));
      else s[k] = number(v, k);
    }
  },

  track(p, [act, ...args]) {
    if(act === 'add') {
      const { kv, rest } = fields(args);
      const kind = rest[0] === 'drum' ? 'drum' : 'melodic';
      if(rest[0] && !['drum', 'melodic'].includes(rest[0])) throw new Error('track add melodic|drum');
      if(p.tracks.length >= Project.MAX_TRACKS) throw new Error(`at most ${Project.MAX_TRACKS} tracks`);
      const t = Project.track(p, kind, kv.name !== undefined ? String(kv.name) : undefined);
      p.tracks.push(t);
      delete kv.name;
      setTrack(t, kv);
      p.patterns.push(Project.pattern(p, t.id));
      return `track ${t.id} "${t.name}"`;
    }
    const t = track(p, args[0]);
    if(act === 'set') setTrack(t, fields(args.slice(1)).kv);
    else if(act === 'remove') {
      if(p.tracks.length <= 1) throw new Error('the last track stays');
      p.tracks = p.tracks.filter(x => x !== t);
      p.patterns = p.patterns.filter(x => x.track !== t.id);
    }
    else if(act === 'up' || act === 'down') {
      const i = p.tracks.indexOf(t), j = act === 'up' ? i - 1 : i + 1;
      if(j < 0 || j >= p.tracks.length) return;
      [p.tracks[i], p.tracks[j]] = [p.tracks[j], p.tracks[i]];
    }
    else throw new Error('track add|set|remove|up|down');
  },

  pattern(p, [act, ...args]) {
    if(act === 'add') {
      const t = track(p, args[0]), { kv } = fields(args.slice(1));
      const pat = Project.pattern(p, t.id, kv.bars ? Math.min(8, Math.max(1, number(kv.bars, 'bars'))) : 1);
      p.patterns.push(pat);
      return `pattern ${pat.id} (${t.name}:${p.patterns.filter(x => x.track === t.id).length})`;
    }
    const pat = pattern(p, args[0]);
    if(act === 'set') {
      const { kv } = fields(args.slice(1));
      if(kv.bars !== undefined) pat.bars = Math.min(8, Math.max(1, number(kv.bars, 'bars')));
    }
    else if(act === 'dup') {
      const x = { ...JSON.parse(JSON.stringify(pat)), id: Project.nextId(p.patterns) };
      p.patterns.push(x);
      return `pattern ${x.id}`;
    }
    else if(act === 'clear') pat.notes = [];
    else if(act === 'remove') Project.removePattern(p, pat.id);
    else if(act === 'transpose') {
      const semis = number(args[1], 'semitones');
      if(p.tracks.find(t => t.id === pat.track).kind === 'drum') throw new Error('drum patterns have rows, not pitches');
      for(const n of pat.notes) n.pitch = Math.max(0, Math.min(127, n.pitch + semis));
    }
    else throw new Error('pattern add|set|dup|clear|remove|transpose');
  },

  /** notes add|remove|set <pattern> <note> ... ; melodic C4:step[:len[:vel[:cents]]], drum kick:step[:vel] */
  notes(p, [act, ref, ...list]) {
    if(!['add', 'remove', 'set'].includes(act)) throw new Error('notes add|remove|set <pattern> <notes...>');
    const pat = pattern(p, ref), t = p.tracks.find(x => x.id === pat.track), drum = t.kind === 'drum';
    const max = pat.bars * Project.barSteps(p);
    const parsed = [];
    for(const w of list.flatMap(x => x.split(/\s+/)).filter(Boolean)) {
      const [name, at, a, b, c] = w.split(':');
      let row;
      if(drum) {
        row = /^\d+$/.test(name) ? Number(name) : Instruments.DRUM_ROWS.indexOf(name);
        if(row < 0 || row >= Instruments.DRUM_ROWS.length) throw new Error(`bad drum row "${name}" (${Instruments.DRUM_ROWS.join(' ')})`);
      }
      for(const step of steps(at ?? '0')) {
        if(step < 0 || step >= max) throw new Error(`step ${step} is outside the pattern (0-${max - 1})`);
        parsed.push(drum
          ? { step, len: 1, pitch: row, vel: a !== undefined ? number(a, 'velocity') : 0.75, cents: 0 }
          : { step, len: Math.max(1, Math.min(max - step, a !== undefined ? number(a, 'length') : 1)), pitch: pitch(name),
              vel: b !== undefined ? number(b, 'velocity') : 0.8, cents: c !== undefined ? number(c, 'cents') : 0 });
      }
    }
    const same = (x, n) => x.step === n.step && x.pitch === n.pitch;
    if(act === 'set') pat.notes = [];
    if(act === 'remove') { pat.notes = pat.notes.filter(x => !parsed.some(n => same(x, n))); return; }
    for(const n of parsed) {
      pat.notes = pat.notes.filter(x => !same(x, n));
      pat.notes.push(n);
    }
    pat.notes.sort((x, y) => x.step - y.step || x.pitch - y.pitch);
    return `${pat.notes.length} notes in pattern ${pat.id}`;
  },

  /** clip <track> <bar|from-to> <pattern|:n|0>: pattern id, Track:n, or :n (the track's own pattern n).
   *  Long patterns go once per their length, like painting on the page. */
  clip(p, [ref, range, value]) {
    const t = track(p, ref), [a, b] = barRange(range, p.song.bars);
    let id = 0, span = 1;
    if(value !== undefined && value !== '0') {
      const s = String(value);
      const pat = pattern(p, s.startsWith(':') ? `${t.id}${s}` : s);
      if(pat.track !== t.id) throw new Error(`pattern ${pat.id} belongs to another track`);
      id = pat.id;
      span = pat.bars;
    }
    for(let bar = a; bar <= b; bar++) t.clips[bar] = (bar - a) % span === 0 ? id : 0;
  },

  kit(p, [act, ref, ...args]) {
    const t = track(p, ref);
    if(t.kind !== 'drum') throw new Error(`track "${t.name}" is not a drum track`);
    if(act === 'set') {
      const { kv } = fields(args);
      if(kv.mode !== undefined) {
        if(!['synth', 'sample'].includes(kv.mode)) throw new Error('kit mode synth|sample');
        t.kit.mode = kv.mode;
      }
      if(kv.pack !== undefined) t.kit.pack = String(kv.pack);
    }
    else if(act === 'row') {
      const row = t.kit.rows.find(r => r.name === args[0]) ?? t.kit.rows[Number(args[0])];
      if(!row) throw new Error(`bad drum row "${args[0]}" (${Instruments.DRUM_ROWS.join(' ')})`);
      for(const [k, v] of Object.entries(fields(args.slice(1)).kv)) {
        if(!['vol', 'tune', 'decay'].includes(k)) throw new Error('kit row fields: vol tune decay');
        row[k] = Math.max(0, Math.min(1, number(v, k)));
      }
    }
    else throw new Error('kit set|row <track> ...');
  },

  keys(p, [act, ...args]) {
    const kb = p.keyboard;
    if(act === 'template') {
      const { kv, rest } = fields(args), name = rest.join(' ');
      if(!Keymap.BUILTIN.includes(name)) throw new Error(`templates: ${Keymap.BUILTIN.join(', ')}`);
      p.keyboard = Keymap.make(name, kv.root !== undefined ? pitchOrNumber(kv.root) : 48);
    }
    else if(act === 'set') {
      const { kv } = fields(args);
      if(kv.name !== undefined) kb.name = String(kv.name);
      if(kv.root !== undefined) {
        const shift = pitchOrNumber(kv.root) - kb.root;
        kb.root += shift;
        for(const k of kb.keys) k.note += shift;
      }
      if(kv.octDown !== undefined) kb.octDown = keyCode(String(kv.octDown));
      if(kv.octUp !== undefined) kb.octUp = keyCode(String(kv.octUp));
    }
    else if(act === 'bind') Keymap.bind(kb, keyIndex(p, args[0]), keyCode(args[1]));
    else if(act === 'tune') {
      const k = kb.keys[keyIndex(p, args[0])], { kv } = fields(args.slice(1));
      if(kv.cents !== undefined) k.cents = number(kv.cents, 'cents');
      if(kv.hz !== undefined) k.hz = number(kv.hz, 'hz');
      if(kv.note !== undefined) k.note = pitchOrNumber(kv.note);
    }
    else if(act === 'equal') Keymap.equal(kb);
    else if(act === 'just') Keymap.just(kb, Theory.keyIndex(args[0] ?? p.song.key));
    else throw new Error('keys template|set|bind|tune|equal|just');
  },

  sfx(p, [act, ...args]) {
    if(act === 'add') {
      const { kv, rest } = fields(args), gen = rest[0] ?? 'random';
      if(![...Sfxr.GENERATORS, ...Sfxr.EXTRA_GENERATORS].includes(gen)) throw new Error(`generators: ${[...Sfxr.GENERATORS, ...Sfxr.EXTRA_GENERATORS].join(' ')}`);
      const seed = kv.seed !== undefined ? number(kv.seed, 'seed') : Math.floor(Math.random() * 1e6);
      const s = { id: newId(p), name: kv.name !== undefined ? String(kv.name) : freeName(p, gen), gen, seed, params: Sfxr.generate(gen, seed), locks: [] };
      p.sfx.push(s);
      return `sound "${s.name}" seed ${seed}`;
    }
    if(act === 'paste') {
      const code = String(args[0] ?? '');
      if(!code.startsWith('apollo-sfx:')) throw new Error('sfx paste apollo-sfx:<code>');
      const x = JSON.parse(Buffer.from(code.slice(11), 'base64').toString('utf8'));
      const { kv } = fields(args.slice(1));
      const s = Sfxr.normalize({ ...x, id: newId(p), name: kv.name ?? x.name ?? freeName(p, x.gen ?? 'sound') });
      p.sfx.push(s);
      return `sound "${s.name}"`;
    }
    const s = sound(p, args[0]);
    if(act === 'set') {
      for(const [k, v] of Object.entries(fields(args.slice(1)).kv)) {
        if(k === 'name') s.name = String(v);
        else if(k === 'seed') s.seed = number(v, 'seed');
        else if(k === 'wave') {
          if(!Sfxr.WAVES.includes(String(v))) throw new Error(`waves: ${Sfxr.WAVES.join(' ')}`);
          s.params.wave = String(v);
        }
        else if(k === 'lock' || k === 'unlock') {
          const keys = String(v) === 'all' ? Sfxr.PARAMS.map(x => x[0]) : String(v).split(',');
          for(const key of keys) if(!Sfxr.param(key)) throw new Error(`no param "${key}"`);
          s.locks = k === 'lock' ? [...new Set([...s.locks, ...keys])] : s.locks.filter(x => !keys.includes(x));
        }
        else {
          const def = Sfxr.param(k);
          if(!def) throw new Error(`no param "${k}" (see: apollo params)`);
          s.params[k] = Math.max(def[3] ? -1 : 0, Math.min(1, number(v, k)));
        }
      }
    }
    else if(act === 'generate') {
      // new values from the sound's generator (or gen=), keeping locked params
      const { kv } = fields(args.slice(1)), gen = kv.gen !== undefined ? String(kv.gen) : s.gen;
      const seed = kv.seed !== undefined ? number(kv.seed, 'seed') : Math.floor(Math.random() * 1e6);
      s.params = Sfxr.generate(gen, seed, s.locks, s.params);
      Object.assign(s, { gen, seed });
    }
    else if(act === 'mutate') {
      const { kv } = fields(args.slice(1));
      s.params = Sfxr.mutate(s.params, kv.seed !== undefined ? number(kv.seed, 'seed') : Math.floor(Math.random() * 1e6), s.locks, kv.amount !== undefined ? number(kv.amount, 'amount') : 0.05);
    }
    else if(act === 'variants') {
      const n = Math.max(1, Math.min(20, number(fields(args.slice(1)).kv.n ?? 6, 'n'))), base = s.name.replace(/_\d+$/, '');
      const ids = [];
      for(let i = 1; i <= n; i++) {
        const v = { id: newId(p), name: `${base}_v${i}`, gen: s.gen, seed: s.seed, params: Sfxr.mutate(s.params, s.seed * 31 + i, s.locks, 0.08), locks: [...s.locks] };
        p.sfx.push(v);
        ids.push(v.id);
      }
      const st = { id: newId(p), name: `${base}_set`, items: [s.id, ...ids] };
      p.sets.push(st);
      return `set "${st.name}" with ${st.items.length} sounds`;
    }
    else if(act === 'remove') {
      p.sfx = p.sfx.filter(x => x !== s);
      for(const m of p.mixes) for(const l of m.layers) if(l.sfx === s.id) l.sfx = 0;
      for(const st of p.sets) st.items = st.items.filter(i => i !== s.id);
    }
    else throw new Error('sfx add|paste|set|generate|mutate|variants|remove');
  },

  /** mix add <name> layers=zap@0:100,boom@120:80 (sound@delay ms:vol %), mix layer <mix> <i> sfx= delay= vol= */
  mix(p, [act, ref, ...args]) {
    const layers = text => String(text).split(',').slice(0, 5).map(x => {
      const m = /^([^@:]+)(?:@(-?\d+(?:\.\d+)?))?(?::(\d+(?:\.\d+)?))?$/.exec(x);
      if(!m) throw new Error(`bad layer "${x}" (sound@delay:vol)`);
      return { sfx: sound(p, m[1]).id, delay: Number(m[2] ?? 0), vol: Number(m[3] ?? 100) };
    });
    if(act === 'add') {
      const { kv } = fields(args);
      if([...p.sfx, ...p.mixes, ...p.sets].some(x => x.name === ref)) throw new Error(`name "${ref}" is taken`);
      p.mixes.push({ id: newId(p), name: String(ref), layers: kv.layers ? layers(kv.layers) : [] });
      return;
    }
    const m = sound(p, ref, 'mixes');
    if(act === 'set') {
      const { kv } = fields(args);
      if(kv.name !== undefined) m.name = String(kv.name);
      if(kv.layers !== undefined) m.layers = layers(kv.layers);
    }
    else if(act === 'layer') {
      const i = number(args[0], 'layer');
      if(i < 0 || i > 4) throw new Error('layers 0-4');
      while(m.layers.length <= i) m.layers.push({ sfx: 0, delay: 0, vol: 100 });
      const { kv } = fields(args.slice(1)), l = m.layers[i];
      if(kv.sfx !== undefined) l.sfx = String(kv.sfx) === '0' ? 0 : sound(p, String(kv.sfx)).id;
      if(kv.delay !== undefined) l.delay = number(kv.delay, 'delay');
      if(kv.vol !== undefined) l.vol = Math.max(0, number(kv.vol, 'vol'));
    }
    else if(act === 'remove') p.mixes = p.mixes.filter(x => x !== m);
    else throw new Error('mix add|set|layer|remove');
  },

  set(p, [act, ref, ...args]) {
    const items = text => String(text).split(',').map(n => (p.sfx.find(s => s.name === n) ?? p.mixes.find(s => s.name === n) ?? sound(p, n)).id);
    if(act === 'add') {
      if([...p.sfx, ...p.mixes, ...p.sets].some(x => x.name === ref)) throw new Error(`name "${ref}" is taken`);
      const { kv } = fields(args);
      p.sets.push({ id: newId(p), name: String(ref), items: kv.items ? items(kv.items) : [] });
      return;
    }
    const st = sound(p, ref, 'sets');
    if(act === 'set') {
      const { kv } = fields(args);
      if(kv.name !== undefined) st.name = String(kv.name);
      if(kv.items !== undefined) st.items = items(kv.items);
    }
    else if(act === 'remove') p.sets = p.sets.filter(x => x !== st);
    else throw new Error('set add|set|remove');
  },

  export(p, args) {
    for(const [k, v] of Object.entries(fields(args).kv)) {
      if(k === 'rate') {
        if(![44100, 22050, 11025, 8000].includes(v)) throw new Error('export rate 44100|22050|11025|8000');
        p.export.rate = v;
      }
      else if(k === 'bits') {
        if(![16, 8].includes(v)) throw new Error('export bits 16|8');
        p.export.bits = v;
      }
      else if(k === 'normalize') p.export.normalize = v === true;
      else if(k === 'format') {
        if(!['wav', 'opus'].includes(v)) throw new Error('export format wav|opus');
        p.export.format = v;
      }
      else throw new Error('export rate= bits= normalize= format=');
    }
  },
};

function pitchOrNumber(v) {
  return typeof v === 'number' ? v : pitch(String(v));
}

/** Applies a melodic track's or drum track's fields; engine / preset rebuild the instrument like the page. */
function setTrack(t, kv) {
  for(const [k, v] of Object.entries(kv)) {
    if(k === 'name') t.name = String(v).slice(0, 24);
    else if(k === 'color') t.color = String(v);
    else if(k === 'vol') t.vol = Math.max(0, Math.min(1, number(v, 'vol')));
    else if(k === 'pan') t.pan = Math.max(-1, Math.min(1, number(v, 'pan')));
    else if(k === 'mute' || k === 'solo') t[k] = v === true;
    else if(k === 'volume' && t.inst) t.inst.vol = Math.max(0, Math.min(1, number(v, 'volume')));   // instrument level ("volume" on the page)
    else if(t.kind === 'drum') {
      if(k === 'kit' || k === 'mode') t.kit.mode = v === 'sample' ? 'sample' : 'synth';
      else if(k === 'pack') t.kit.pack = String(v);
      else throw new Error(`drum track: unknown field "${k}" (name color vol pan mute solo kit pack)`);
    }
    else if(k === 'engine' || k === 'preset') {
      const engine = k === 'engine' ? String(v) : t.inst.engine, preset = k === 'preset' ? String(v) : kv.preset;
      if(!Instruments.ENGINES.includes(engine)) throw new Error(`engines: ${Instruments.ENGINES.join(' ')}`);
      if(preset !== undefined && !Instruments.PRESETS[engine]?.[preset]) throw new Error(`${engine} presets: ${Object.keys(Instruments.PRESETS[engine] ?? {}).join(' ')}`);
      if(k === 'preset' && kv.engine !== undefined) continue;   // applied with the engine
      const vol = t.inst.vol;
      t.inst = Instruments.make(engine, preset);
      t.inst.vol = vol;
    }
    else if(k in t.inst) {
      if(k === 'drawbars') t.inst.drawbars = String(v).split(',').map(x => Math.max(0, Math.min(8, number(x, 'drawbar'))));
      else if(k === 'wave' || k === 'pack') {
        if(k === 'wave' && !Instruments.CHIP_WAVES.includes(String(v))) throw new Error(`chip waves: ${Instruments.CHIP_WAVES.join(' ')}`);
        t.inst[k] = String(v);
        if(k === 'pack') delete t.inst.preset;
      }
      else t.inst[k] = number(v, k);
    }
    else throw new Error(`${t.inst.engine} track: unknown field "${k}" (${['name', 'color', 'vol', 'volume', 'pan', 'mute', 'solo', 'engine', 'preset', ...Object.keys(t.inst).filter(x => !['engine', 'preset', 'vol'].includes(x))].join(' ')})`);
  }
}
//#endregion

//#region [ Apply + check ]
/** Runs ops in order; returns the messages they printed. Throws on the first bad op with its text. */
function apply(p, ops) {
  const out = [];
  for(const text of ops) {
    const [name, ...args] = words(text);
    if(!OPS[name]) throw new Error(`unknown op "${name}" (${Object.keys(OPS).join(' ')})`);
    try {
      const msg = OPS[name](p, args);
      if(msg) out.push(msg);
    }
    catch(err) { throw new Error(`"${text}": ${err.message}`); }
  }
  return out;
}

/** Warnings for things the page would hide or ignore. */
function check(p) {
  const warn = [], spb = Project.barSteps(p);
  for(const pat of p.patterns) {
    const t = p.tracks.find(x => x.id === pat.track);
    const out = pat.notes.filter(n => n.step >= pat.bars * spb).length;
    if(out) warn.push(`pattern ${pat.id} (${t.name}): ${out} notes past its ${pat.bars} bar(s), not played`);
  }
  for(const t of p.tracks) {
    t.clips.forEach((id, bar) => {
      const pat = id && p.patterns.find(x => x.id === id);
      if(pat && bar + pat.bars > p.song.bars) warn.push(`${t.name}: clip at bar ${bar + 1} runs past the song end`);
    });
  }
  for(const m of p.mixes) if(!m.layers.some(l => l.sfx)) warn.push(`mix "${m.name}" has no sounds`);
  return warn;
}
//#endregion

module.exports = { apply, check, words, OPS };
