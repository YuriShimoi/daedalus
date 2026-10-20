#!/usr/bin/env node
// Apollo CLI. Same core (and sample packs) as the page, so renders match the page export.
const fs = require('fs');
const path = require('path');
const DAE = require('./src/core/index.js');
const { Project, Engine, Sfxr, Wav, Samples, Instruments, Keymap, Toon, Theory } = DAE;
const Edit = require('./src/cli/edit.js');

const HELP = `apollo <command> [options]
  new     [--mode music|sfx] [--bpm N --key C --scale minor --bars 16] [--empty] -o p.toon
                                       starter project (lead, bass, drums with a beat); --empty: one blank track
  edit    p.toon "<op>" ["<op>" ...] [-o out]   apply ops in order, then check. Ops (see USAGE.md):
            song bpm= key= scale= bars= loop=1-4|on|off master=      mode music|sfx · level music|sfx simple|full
            track add melodic|drum [name= engine= preset=] · track set|remove|up|down <track> [vol= volume= pan= ...]
            pattern add <track> [bars=1-8] · pattern set|dup|clear|remove <pat> · pattern transpose <pat> <semis>
            notes add|remove|set <pat> C4:step[:len[:vel[:cents]]] ... (drums: kick:0,4,8 or kick:0-15/4[:vel])
            clip <track> <bar|from-to> <pat|:n|0>        tracks by id or name; patterns by id or Track:n
            kit set <track> mode=synth|sample pack= · kit row <track> <row> vol= tune= decay=
            keys template "FL style"|"One row" [root=C3] · keys set name= root= · keys bind <key> <z>
            keys tune <key> cents= hz= note= · keys equal · keys just [C]
            sfx add <gen> [seed= name=] · sfx set <sound> <param>= wave= lock=a,b|all unlock= name=
            sfx generate|mutate <sound> [seed= gen= amount=] · sfx variants <sound> [n=6] · sfx paste <code> · sfx remove
            mix add <name> layers=zap@0:100,boom@120:80 · mix set|layer|remove ... · set add|set|remove <name> items=a,b
            export rate= bits= normalize=
  presets                                engines, instrument presets and params, drum rows, keyboard templates
  params                                 sound effect params, waves and generators
  extract p.toon --inst <track> | --kit <track> | --keys  -o file.toon     save a preset / kit / keyboard template
  apply   p.toon preset.toon [--track <track>] [-o out]                    load one into the project
  code    p.toon --name SOUND            print the sound's apollo-sfx code (paste it in the page or with sfx paste)
  convert p.toon --to json|toon [-o out]
  render  song.toon -o out.wav [--loop] [--from BAR --to BAR] [--mono]
                                       whole song, or the loop range as a seamless loop (--loop)
  sfx     <generator> [--seed N] [--rate 44100|22050|11025|8000] [--bits 16|8] [--raw] -o out.wav
                                       generators: ${[...Sfxr.GENERATORS, ...Sfxr.EXTRA_GENERATORS].join(' ')}
  sfx     from project.toon --name SOUND [--rate .. --bits .. --raw] -o out.wav
  sfxall  project.toon [-d DIR]          every sound and mix, with the project's export settings
  info    project.toon [--json]          song, tracks, patterns, clip grid, sounds
  packs                                  bundled sample packs`;

//#region [ Arguments ]
function parse(argv) {
  const args = { _: [] };
  for(let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if(a === '-o' || a === '-d') args[a.slice(1)] = argv[++i];
    else if(a.startsWith('--')) {
      const key = a.slice(2), next = argv[i + 1];
      if(next === undefined || next.startsWith('-')) args[key] = true;
      else args[key] = argv[++i];
    }
    else args._.push(a);
  }
  return args;
}

function load(file) {
  if(!file) throw new Error('missing project file');
  return Project.parse(fs.readFileSync(file, 'utf8'));
}

function save(file, p) {
  if(!file) throw new Error('missing -o out.toon');
  fs.writeFileSync(file, Project.stringify(p));
}

/** Track by id or name, of one kind. */
function trackOf(p, ref, kind) {
  const t = p.tracks.find(x => x.kind === kind && (String(x.id) === String(ref) || x.name.toLowerCase() === String(ref).toLowerCase()));
  if(!t) throw new Error(`no ${kind} track "${ref}"`);
  return t;
}

function writeWav(file, channels, rate, bits) {
  if(!file) throw new Error('missing -o out.wav');
  fs.writeFileSync(file, Wav.encode(channels, rate, bits));
}

const safe = name => String(name).replace(/[\\/:*?"<>|]+/g, '_');
//#endregion

//#region [ Commands ]
const commands = {
  new(args) {
    const p = Project.create(args.mode === 'sfx' ? 'sfx' : 'music');
    if(args.empty) {
      p.tracks = [Project.track(p, 'melodic', 'Lead')];
      p.tracks[0].id = 1;
      p.patterns = [Project.pattern(p, 1)];
    }
    const fields = ['bpm', 'key', 'scale', 'bars'].filter(k => args[k] !== undefined).map(k => `${k}=${args[k]}`);
    if(fields.length) Edit.apply(p, [`song ${fields.join(' ')}`]);
    save(args.o, p);
    console.log(`${args.o}: ${p.mode} project, ${p.tracks.length} track(s), ${p.song.bpm} bpm, ${p.song.bars} bars`);
    return 0;
  },

  edit(args) {
    const file = args._[0], p = load(file), ops = args._.slice(1);
    if(!ops.length) throw new Error('no ops given');
    for(const msg of Edit.apply(p, ops)) console.log(`  ${msg}`);
    const out = args.o ?? file;
    save(out, p);
    console.log(`${out}: ${ops.length} op(s) applied`);
    for(const w of Edit.check(p)) console.log(`  warning: ${w}`);
    return 0;
  },

  presets() {
    for(const e of Instruments.ENGINES) {
      const inst = Instruments.make(e), keys = Object.keys(inst).filter(k => k !== 'engine');
      console.log(`${e.padEnd(7)} presets: ${Object.keys(Instruments.PRESETS[e]).join(' ')}`);
      console.log(`        params:  ${keys.map(k => `${k}=${Array.isArray(inst[k]) ? inst[k].join(',') : inst[k]}`).join(' ')}`);
    }
    console.log(`chip waves: ${Instruments.CHIP_WAVES.join(' ')}`);
    console.log(`sample packs: ${Samples.list().map(x => `${x.name} (${x.kind})`).join(', ')}`);
    console.log(`drum rows: ${Instruments.DRUM_ROWS.join(' ')} (vol tune decay 0..1), kit mode synth|sample`);
    console.log(`keyboard templates: ${Keymap.BUILTIN.join(', ')}`);
    console.log(`keys: ${Theory.NAMES.join(' ')} · scales: ${Object.keys(Theory.SCALES).join(' ')}`);
    return 0;
  },

  params() {
    let group = '';
    for(const [key, label, g, signed, def] of Sfxr.PARAMS) {
      if(g !== group) console.log((group = g));
      console.log(`  ${key.padEnd(14)} ${label.padEnd(13)} ${signed ? '-1..1' : ' 0..1'}  default ${def}${Sfxr.SIMPLE.includes(key) ? '  (simple)' : ''}`);
    }
    console.log(`waves: ${Sfxr.WAVES.join(' ')}`);
    console.log(`generators: ${[...Sfxr.GENERATORS, ...Sfxr.EXTRA_GENERATORS].join(' ')}`);
    return 0;
  },

  extract(args) {
    const p = load(args._[0]);
    let doc, label;
    if(args.inst) {
      const t = trackOf(p, args.inst, 'melodic');
      doc = { apolloPreset: t.inst };
      label = `${t.inst.engine} preset from "${t.name}"`;
    }
    else if(args.kit) {
      const t = trackOf(p, args.kit, 'drum');
      doc = { apolloKit: t.kit };
      label = `kit from "${t.name}"`;
    }
    else if(args.keys) {
      doc = { apolloKeyboard: p.keyboard };
      label = `keyboard "${p.keyboard.name}"`;
    }
    else throw new Error('pick --inst <track>, --kit <track> or --keys');
    if(!args.o) throw new Error('missing -o file.toon');
    fs.writeFileSync(args.o, Toon.encode(doc));
    console.log(`${args.o}: ${label}`);
    return 0;
  },

  apply(args) {
    const file = args._[0], p = load(file);
    if(!args._[1]) throw new Error('missing preset file');
    const doc = Toon.decode(fs.readFileSync(args._[1], 'utf8'));
    const pick = kind => (args.track !== undefined ? trackOf(p, args.track, kind) : p.tracks.find(x => x.kind === kind))
      ?? (() => { throw new Error(`no ${kind} track`); })();
    let label;
    if(doc.apolloKeyboard || doc.keyboard) {
      p.keyboard = Keymap.normalize(doc.apolloKeyboard ?? doc.keyboard);
      label = `keyboard "${p.keyboard.name}"`;
    }
    else if(doc.apolloKit) {
      const t = pick('drum');
      t.kit = Instruments.normalizeKit(doc.apolloKit);
      label = `kit -> "${t.name}"`;
    }
    else {
      const t = pick('melodic');
      t.inst = Instruments.normalize(doc.apolloPreset ?? doc);
      label = `${t.inst.engine} preset -> "${t.name}"`;
    }
    const out = args.o ?? file;
    save(out, p);
    console.log(`${out}: ${label}`);
    return 0;
  },

  code(args) {
    const p = load(args._[0]);
    const s = p.sfx.find(x => x.name === args.name);
    if(!s) throw new Error(`no sound named "${args.name}" (have: ${p.sfx.map(x => x.name).join(', ')})`);
    console.log('apollo-sfx:' + Buffer.from(JSON.stringify({ name: s.name, gen: s.gen, seed: s.seed, params: s.params })).toString('base64'));
    return 0;
  },

  convert(args) {
    const p = load(args._[0]);
    if(!['json', 'toon'].includes(args.to)) throw new Error('--to json|toon');
    const text = args.to === 'json' ? JSON.stringify(p, null, 2) : Project.stringify(p);
    if(args.o) {
      fs.writeFileSync(args.o, text);
      console.log(`${args.o}: ${args.to}`);
    }
    else console.log(text);
    return 0;
  },

  render(args) {
    const p = load(args._[0]), l = p.song.loop;
    const loop = !!args.loop;
    const from = args.from !== undefined ? Number(args.from) - 1 : loop ? l.from : 0;
    const to = args.to !== undefined ? Number(args.to) : loop ? l.to : p.song.bars;
    if(!(to > from)) throw new Error('empty range');
    const r = Engine.render(p, Samples.packs, { from, to, loop });
    const ch = args.mono ? [r.L.map((v, i) => (v + r.R[i]) / 2)] : [r.L, r.R];
    writeWav(args.o, ch, 44100, 16);
    console.log(`${args.o}: bars ${from + 1}-${to}${loop ? ' (loop)' : ''}, ${(r.L.length / 44100).toFixed(2)} s${r.clipped ? `, ${r.clipped} samples clipped` : ''}`);
    return 0;
  },

  sfx(args) {
    const rate = Number(args.rate ?? 44100), bits = Number(args.bits ?? 16);
    let x, label;
    if(args._[0] === 'from') {
      const p = load(args._[1]);
      const item = [...p.sfx, ...p.mixes].find(s => s.name === args.name);
      if(!item) throw new Error(`no sound named "${args.name}" (have: ${[...p.sfx, ...p.mixes].map(s => s.name).join(', ')})`);
      x = Sfxr.renderItem(p, item.id, rate);
      label = item.name;
    }
    else {
      const gen = args._[0] ?? 'random';
      if(![...Sfxr.GENERATORS, ...Sfxr.EXTRA_GENERATORS, 'coin', 'shoot', 'boom', 'hurt', 'select', 'step'].includes(gen)) throw new Error(`unknown generator "${gen}"`);
      const seed = Number(args.seed ?? Math.floor(Math.random() * 1e6));
      x = Sfxr.render(Sfxr.generate(gen, seed), seed, rate);
      label = `${gen} seed ${seed}`;
    }
    if(!args.raw) x = Sfxr.normalize01(x);
    writeWav(args.o, [x], rate, bits);
    console.log(`${args.o}: ${label}, ${(x.length / rate).toFixed(2)} s`);
    return 0;
  },

  sfxall(args) {
    const p = load(args._[0]), dir = args.d ?? '.', ex = p.export;
    fs.mkdirSync(dir, { recursive: true });
    for(const item of [...p.sfx, ...p.mixes]) {
      let x = Sfxr.renderItem(p, item.id, ex.rate);
      if(ex.normalize) x = Sfxr.normalize01(x);
      fs.writeFileSync(path.join(dir, safe(item.name) + '.wav'), Wav.encode([x], ex.rate, ex.bits));
    }
    console.log(`${p.sfx.length + p.mixes.length} WAV files -> ${dir}`);
    return 0;
  },

  info(args) {
    const p = load(args._[0]);
    const data = {
      mode: p.mode, bpm: p.song.bpm, bars: p.song.bars, key: `${p.song.key} ${p.song.scale}`, loop: p.song.loop,
      tracks: p.tracks.map(t => ({ name: t.name, kind: t.kind, instrument: t.kind === 'drum' ? `kit ${t.kit.mode}` : t.inst.engine,
        id: t.id, vol: t.vol, pan: t.pan, mute: t.mute, solo: t.solo, preset: t.inst?.preset ?? null, clipMap: t.clips,
        clips: t.clips.filter(Boolean).length, notes: p.patterns.filter(x => x.track === t.id).reduce((a, x) => a + x.notes.length, 0) })),
      patterns: p.patterns.map(x => ({ id: x.id, track: x.track, ref: `${p.tracks.find(t => t.id === x.track).name}:${p.patterns.filter(y => y.track === x.track).indexOf(x) + 1}`,
        bars: x.bars, notes: x.notes.length })),
      sounds: p.sfx.map(s => s.name), mixes: p.mixes.map(m => m.name), sets: p.sets.map(s => `${s.name} x${s.items.length}`),
      keyboard: p.keyboard.name,
    };
    if(args.json) console.log(JSON.stringify(data, null, 2));
    else {
      console.log(`${data.mode} · ${data.bpm} bpm · ${data.bars} bars · ${data.key} · loop ${p.song.loop.on ? `${p.song.loop.from + 1}-${p.song.loop.to}` : 'off'} · keyboard "${data.keyboard}"`);
      for(const t of data.tracks) console.log(`  ${String(t.id).padStart(2)} ${t.name.padEnd(12)} ${t.kind.padEnd(8)} ${(t.instrument + (t.preset ? ' ' + t.preset : '')).padEnd(16)} ${t.clips} clips, ${t.notes} notes${t.mute ? ' (muted)' : ''}`);
      console.log('  patterns: ' + data.patterns.map(x => `${x.id}=${x.ref}${x.bars > 1 ? ` ${x.bars}b` : ''} (${x.notes})`).join(' · '));
      // clip grid: pattern number inside its track, '-' = covered by a longer clip, '.' = empty
      console.log('  ' + ''.padEnd(14) + Array.from({ length: p.song.bars }, (_, i) => String((i + 1) % 10)).join(''));
      for(const t of p.tracks) {
        let row = '', cover = 0;
        t.clips.forEach(id => {
          const pat = id && p.patterns.find(x => x.id === id);
          if(pat) { row += String(p.patterns.filter(y => y.track === t.id).indexOf(pat) + 1).slice(-1); cover = pat.bars - 1; }
          else if(cover > 0) { row += '-'; cover--; }
          else row += '.';
        });
        console.log(`  ${t.name.slice(0, 12).padEnd(14)}${row}`);
      }
      console.log(`  sounds: ${data.sounds.length} · mixes: ${data.mixes.length} · sets: ${data.sets.join(', ') || 0}`);
    }
    return 0;
  },

  packs() {
    for(const p of Samples.list()) console.log(`${p.name.padEnd(14)} ${p.kind.padEnd(8)} ${String(p.zones.length).padStart(2)} zones  ${p.title} (${p.license})`);
    return 0;
  },
};
//#endregion

function main(argv) {
  const args = parse(argv);
  const cmd = args._.shift();
  if(!cmd || cmd === 'help' || args.help) {
    console.log(HELP);
    return cmd ? 0 : 1;
  }
  if(!commands[cmd]) {
    console.error(`unknown command "${cmd}"\n\n${HELP}`);
    return 1;
  }
  try { return commands[cmd](args); }
  catch(err) {
    console.error(`apollo ${cmd}: ${err.message}`);
    return 1;
  }
}

if(require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { main, parse };
