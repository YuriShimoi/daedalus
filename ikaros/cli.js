#!/usr/bin/env node
// Ikaros CLI: the subtools that make sense without a page. Same cores as the page.
const fs = require('fs');
const path = require('path');
const DAE = require('./src/core/index.js');
const { Tree, Diff, Colors, Cipher, Dice, Wheel, Toon, Rng } = DAE;

const HELP = `ikaros <tool> <command> [options]
  spyglass convert <file> [--to json|toon] [-o out]     TOON <-> JSON (to the other format by default)
  spyglass info <file>                                   format, objects, arrays, values, depth
  spyglass paths <file> [--find text]                    every path with its value (or only matches)
  spyglass get <file> <path>                             value at a path, e.g. rooms[1].items[0]
  caliper <a> <b> [--key id|index|field] [--ignore a,b] [--tol 0.01] [--nocase] [--order]
          [--md | --patch | --toon] [-o out]            changes A -> B; exit code 1 when they differ
  prisma <file|folder> [--ext css,html] [--merge 2] [--sort hue|light|usage|first]
          [-o palette.css|.toon|.json|.gpl|.md] [--refs]  every color found (folders skip node_modules, .git, dist)
  jigsaw list                                            every cipher id
  jigsaw encode|decode <id> "<text>" [--key K] [--key2 K] [--shift 3] [...options]
  jigsaw chain "<id:opt=v,id>" encode|decode "<text>"   several steps (decode runs them backwards)
  jigsaw try "<text>" [--lang en|pt]                     rank keyless decoders, Caesar shifts, Vigenère guess
  jigsaw anagram <letters> [--lang en|pt]
  jigsaw wordsearch "<w1,w2,...>" [--size 12] [--dirs easy|forward|all] [--seed 7]
  scale "<formula>" [-n 5] [--seed 7] [--set 4,6,8,10,12,20,100] [--odds]
  wheel spin <wheel.toon|.json|list.txt> [-n 100] [--seed 3] [--remove]`;

const read = f => { if(!f) throw new Error('missing file'); return fs.readFileSync(f, 'utf8'); };
const out = (args, text) => { if(args.o) { fs.writeFileSync(args.o, text); console.log(`${args.o}: written`); } else process.stdout.write(text.endsWith('\n') ? text : text + '\n'); };
const parsed = f => { const r = Tree.parse(read(f)); if(r.error) throw new Error(`${f}: ${r.error.message}`); return r; };
const rngOf = seed => (seed !== undefined ? (r => () => r.next())(new Rng(seed)) : Math.random);

//#region [ Commands ]
const commands = {
  spyglass(args) {
    const [cmd, file, p] = args._;
    if(cmd === 'convert') {
      const r = parsed(file);
      out(args, Tree.stringify(r.value, args.to ?? (r.format === 'json' ? 'toon' : 'json')));
      return 0;
    }
    if(cmd === 'info') {
      const r = parsed(file), s = Tree.stats(r.value);
      console.log(`${file}: ${r.format} · ${s.objects} objects · ${s.arrays} arrays · ${s.values} values · depth ${s.depth} · ${Tree.cards(r.value).length} cards`);
      return 0;
    }
    if(cmd === 'paths') {
      const r = parsed(file), q = args.find ? String(args.find).toLowerCase() : null;
      const lines = [];
      const walk = (v, at) => {
        if(v && typeof v === 'object') { for(const [k, x] of Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v)) walk(x, Tree.join(at, Array.isArray(v) ? +k : k)); return; }
        const line = `${at || '(root)'} = ${JSON.stringify(v)}`;
        if(!q || line.toLowerCase().includes(q)) lines.push(line);
      };
      walk(r.value, '');
      out(args, lines.join('\n'));
      return 0;
    }
    if(cmd === 'get') {
      const v = Tree.get(parsed(file).value, p ?? '');
      out(args, JSON.stringify(v, null, 2));
      return v === undefined ? 1 : 0;
    }
    throw new Error('spyglass convert|info|paths|get');
  },

  caliper(args) {
    const [fa, fb] = args._;
    const a = parsed(fa).value, b = parsed(fb).value;
    const opts = { key: args.key ?? 'auto', ignore: args.ignore ? String(args.ignore).split(',') : [], tol: +(args.tol ?? 0), nocase: !!args.nocase, order: !!args.order };
    const root = Diff.compare(a, b, opts), list = Diff.changes(root), c = Diff.count(root);
    if(args.patch) out(args, JSON.stringify(Diff.patch(a, b), null, 2));
    else if(args.md) out(args, Diff.markdown(list));
    else if(args.toon) out(args, Toon.encode({ app: 'caliper', a: fa, b: fb, changes: list.map(x => ({ path: x.path, kind: x.kind, ...(x.from !== undefined ? { from: x.from } : {}), ...(x.old !== undefined ? { old: JSON.stringify(x.old) } : {}), ...(x.new !== undefined ? { new: JSON.stringify(x.new) } : {}) })) }));
    else {
      const sign = { added: '+', removed: '-', changed: '~', moved: '↕' };
      const short = v => { const s = JSON.stringify(v); return s && s.length > 60 ? s.slice(0, 57) + '...' : s; };
      for(const x of list) console.log(`${sign[x.kind]} ${x.path}${x.kind === 'changed' ? `: ${short(x.old)} -> ${short(x.new)}` : x.kind === 'added' ? `: ${short(x.new)}` : x.kind === 'removed' ? `: ${short(x.old)}` : ` (from [${x.from}])`}`);
      console.log(list.length ? `+${c.added} -${c.removed} ~${c.changed} ↕${c.moved}` : 'same data');
    }
    return list.length ? 1 : 0;
  },

  prisma(args) {
    const target = args._[0];
    if(!target) throw new Error('missing file or folder');
    const ext = args.ext ? String(args.ext).split(',') : Colors.EXT;
    const files = [];
    const walk = dir => {
      for(const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if(e.isDirectory()) { if(!Colors.SKIP.includes(e.name) && !e.name.startsWith('.')) walk(p); }
        else if(ext.includes(Colors.ext(e.name)) && !/\.min\.(js|css)$/.test(e.name) && fs.statSync(p).size < 3e6) files.push({ name: path.relative(process.cwd(), p).replace(/\\/g, '/'), text: fs.readFileSync(p, 'utf8') });
      }
    };
    fs.statSync(target).isDirectory() ? walk(target) : files.push({ name: target, text: read(target) });
    const { hits, uses } = Colors.scan(files, { ext: [...ext, ''] });
    const list = Colors.sort(Colors.merge(Colors.swatches(hits, uses), +(args.merge ?? 0)), args.sort ?? 'hue');
    const kind = args.o ? Colors.ext(args.o) : '';
    if(kind === 'css') out(args, Colors.css(list));
    else if(kind === 'toon') out(args, Toon.encode(Colors.data(list)));
    else if(kind === 'json') out(args, JSON.stringify(Colors.data(list), null, 2));
    else if(kind === 'gpl') out(args, Colors.gpl(list));
    else if(kind === 'md') out(args, Colors.markdown(list));
    else {
      const names = Colors.names(list);
      for(const [i, s] of list.entries()) {
        console.log(`${s.hex.padEnd(10)} ${String(s.total ?? s.count).padStart(4)}  ${names[i]}`);
        if(args.refs) for(const h of [s, ...s.variants].flatMap(x => x.hits).slice(0, 8)) console.log(`             ${h.file}:${h.line}  ${[h.var, h.sel, h.el, h.prop ?? h.attr, h.key].filter(Boolean).join(' › ')}`);
      }
      console.log(`${list.length} colors · ${hits.length} uses · ${files.length} files`);
    }
    return 0;
  },

  jigsaw(args) {
    const [cmd, a, b, c] = args._;
    const optsOf = () => Object.fromEntries(Object.entries(args).filter(([k]) => k !== '_' && k !== 'o' && k !== 'lang'));
    if(cmd === 'list') { for(const x of Cipher.LIST) console.log(`${x.id.padEnd(12)} ${x.name} (${x.group})${x.opts.length ? ' · ' + x.opts.map(o => `--${o.k}`).join(' ') : ''}`); return 0; }
    if(cmd === 'encode' || cmd === 'decode') {
      if(!Cipher.get(a)) throw new Error(`unknown cipher ${a} (ikaros jigsaw list)`);
      out(args, Cipher.run(b ?? '', { id: a, opts: optsOf() }, cmd === 'encode' ? 'enc' : 'dec'));
      return 0;
    }
    if(cmd === 'chain') {
      const steps = String(a).split(',').map(s => {
        const [id, ...kv] = s.split(':');
        return { id: id.trim(), opts: Object.fromEntries(kv.join(':').split(';').filter(Boolean).map(p => p.split('=').map(x => x.trim()))) };
      });
      out(args, Cipher.chain(c ?? '', steps, b === 'decode' ? 'dec' : 'enc'));
      return 0;
    }
    if(cmd === 'try') {
      for(const t of Cipher.tryAll(a ?? '', args.lang ?? 'en', 10)) console.log(`${t.score.toFixed(1).padStart(6)}  ${t.name.padEnd(22)} ${t.text.slice(0, 90)}`);
      return 0;
    }
    if(cmd === 'anagram') {
      DAE.loadWords(args.lang ?? 'en');
      const r = Cipher.anagrams(a ?? '', Cipher.words(args.lang ?? 'en'));
      console.log(`exact: ${r.exact.join(', ') || '-'}\npairs: ${r.pairs.slice(0, 20).join(', ') || '-'}\ninside: ${r.fit.slice(0, 20).join(', ') || '-'}`);
      return 0;
    }
    if(cmd === 'wordsearch') {
      const ws = Cipher.wordSearch(String(a).split(/[,\s]+/).filter(Boolean), { size: +(args.size ?? 0), dirs: args.dirs ?? 'all', seed: args.seed ?? Date.now() });
      out(args, ws.grid.map(r => r.join(' ')).join('\n') + `\n\n${ws.placed.map(p => `${p.word} @ row ${p.r + 1}, col ${p.c + 1}, dir ${p.dr},${p.dc}`).join('\n')}${ws.missed.length ? `\nmissed: ${ws.missed.join(', ')}` : ''}`);
      return 0;
    }
    throw new Error('jigsaw list|encode|decode|chain|try|anagram|wordsearch');
  },

  scale(args) {
    const set = args.set ? String(args.set).split(',').map(Number) : Dice.DEFAULT_SET;
    const formula = args._[0];
    if(!formula) throw new Error('missing formula, e.g. "(3D6+1D12)*2+1D100"');
    const rnd = rngOf(args.seed);
    const n = Math.max(1, +(args.n ?? 1));
    for(let i = 0; i < n; i++) {
      const r = Dice.roll(formula, { set, rnd });
      console.log(`${String(r.total).padStart(5)}  ${r.shown}`);
    }
    if(args.odds) {
      const o = Dice.odds(formula, { set });
      console.log(`odds (${o.exact ? 'exact' : 'sampled'}): min ${o.min} · mean ${o.mean.toFixed(2)} · max ${o.max}`);
      const top = Math.max(...o.dist.map(([, p]) => p));
      for(const [v, p] of o.dist) console.log(`${String(v).padStart(5)} ${(p * 100).toFixed(2).padStart(6)}% ${'█'.repeat(Math.round(p / top * 40))}`);
    }
    return 0;
  },

  wheel(args) {
    const [cmd, file] = args._;
    if(cmd !== 'spin') throw new Error('wheel spin <file>');
    const text = read(file).trim();
    const d = text.startsWith('{') ? JSON.parse(text) : /^app:\s*wheel/m.test(text) ? Toon.decode(text) : null;
    const items = d ? d.items.map(x => Wheel.item(String(x.label), { weight: +x.weight || 1, on: x.on !== false })) : Wheel.parseList(text);
    Wheel.normalize(items);
    const rnd = rngOf(args.seed), n = Math.max(1, +(args.n ?? 1)), hist = [];
    for(let i = 0; i < n; i++) {
      const k = Wheel.pick(items, rnd);
      if(k < 0) break;
      hist.push(items[k].label);
      if(n <= 20) console.log(items[k].label);
      if(args.remove) { items[k].on = false; Wheel.normalize(items); }
    }
    if(n > 20 || args.remove) for(const s of Wheel.spread(items, hist)) console.log(`${s.label.padEnd(20)} ${String(s.count).padStart(5)}  ${s.pct.toFixed(1).padStart(5)}%  (odds ${s.expected.toFixed(1)}%)`);
    return 0;
  },
};
//#endregion

function main(argv) {
  // -n is a count here (the shared parser only knows -o / -d as short options)
  return DAE.Cli.run('ikaros', HELP, commands, argv.map(a => (a === '-n' ? '--n' : a)));
}

if(require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { main };
