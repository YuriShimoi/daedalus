#!/usr/bin/env node
// Athena CLI. Same core as the page. Exit codes: 0 ok/solved, 2 unsolvable, 3 needs combat (check), 1 error.
const fs = require('fs');
const path = require('path');
const DAE = require('./src/core/index.js');
require('../shared/icons.js');
require('../shared/cli.js');
const { Model, Validate, Check, Solver, Rules, Generator, Svg, Layout } = DAE;

const HELP = `athena <command> [options]
  gen      [--seed N --rooms N --branching 0.4 --deepnest 3 --loops 1 --oneWay 0.3 --locks 2 --chests 1
            --combos true --comboDepth 1 --effects true --invulnRate 0.15 --enemyDensity 0.5 --maxWaves 2
            --itemDensity 0.4 --difficulty 0.5 --exits 1 --iterations 40 --tries 30] [--solve] -o map.toon
  check    map.toon [--json]                              quick check (no combat): links, locks, enemy-free route
  solve    map.toon [--top 3 --mode safe|weighted --time 10000 --visits 4] [-o map.toon] [--json]
  validate map.toon [--json]
  play     map.toon --steps "move r1;take potion;..." [--at N] [--save -o map.toon] [--json]
  render   map.toon -o map.svg [--route N | --steps "..."]
  layout   map.toon [--all] [-o out]                        write room x,y (missing ones, or --all) from the auto layout
  edit     map.toon "<op>" ["<op>" ...] [-o out]            edit tables, then validate. Ops:
             add <table> <id> [field=value ...]     tables: rooms items enemies effects chests passages
             set <table> <id|index> field=value ... recipes events solutions slots; player / rules / score take no id
             remove <table> <id|index>              removing a room also removes its passages
             link <a> <b> [dir=a>b] [lock=key:red]  adds a passage with the next free id
  convert  map.toon --to json|toon [-o out]`;

//#region [ Arguments ]
const { parse, value } = DAE.Cli;

function load(file) {
  if(!file) throw new Error('missing map file');
  const text = fs.readFileSync(file, 'utf8');
  return file.endsWith('.json') || text.trimStart().startsWith('{') ? Model.fromDoc(Model.toDoc(JSON.parse(text))) : Model.parse(text);
}

function write(file, text) {
  if(file) fs.writeFileSync(file, text);
  else process.stdout.write(text);
}
//#endregion

//#region [ Editing ]
// Ops work on the file's doc (Model.toDoc), so cells take the same syntax as the .toon file: "ogre:2+rat", "key:red".
const SINGLE = ['player', 'rules', 'score'];

function edit(model, ops) {
  const doc = Model.toDoc(model);
  const rowsOf = t => {
    if(t === 'slots') return ((doc.player ??= {}).slots ??= []);
    if(!/^(rooms|items|enemies|effects|chests|passages|recipes|events|solutions)$/.test(t)) throw new Error(`unknown table "${t}"`);
    return (doc[t] ??= []);
  };
  const find = (rows, t, key) => {
    const i = rows.some(r => r.id !== undefined) ? rows.findIndex(r => String(r.id) === key) : +key;
    if(!(i >= 0 && i < rows.length)) throw new Error(`no ${t} "${key}"`);
    return i;
  };
  const assign = (row, pairs) => pairs.forEach(p => {
    const k = p.indexOf('=');
    if(k < 1) throw new Error(`expected field=value, got "${p}"`);
    const v = p.slice(k + 1);
    row[p.slice(0, k)] = v === '' ? undefined : value(v);
  });
  for(const op of ops) {
    const [verb, ...w] = op.trim().split(/\s+/);
    if(verb === 'link') {
      const rows = rowsOf('passages');
      let n = rows.length;
      while(rows.some(r => r.id === `p${n}`)) n++;
      const row = { id: `p${n}`, a: w[0], b: w[1] };
      assign(row, w.slice(2));
      rows.push(row);
    }
    else if(verb === 'set' && SINGLE.includes(w[0])) assign(doc[w[0]] ??= {}, w.slice(1));
    else if(verb === 'add') {
      const rows = rowsOf(w[0]);
      const row = w[0] === 'recipes' ? {} : { id: w[1] };
      if(row.id !== undefined && rows.some(r => String(r.id) === row.id)) throw new Error(`${w[0]} "${row.id}" already exists`);
      assign(row, w.slice(w[0] === 'recipes' ? 1 : 2));
      rows.push(row);
    }
    else if(verb === 'set') assign(rowsOf(w[0])[find(rowsOf(w[0]), w[0], w[1])], w.slice(2));
    else if(verb === 'remove') {
      const rows = rowsOf(w[0]);
      const [row] = rows.splice(find(rows, w[0], w[1]), 1);
      if(w[0] === 'rooms' && doc.passages) doc.passages = doc.passages.filter(g => g.a !== row.id && g.b !== row.id);
    }
    else throw new Error(`unknown op "${op}"`);
  }
  return Model.fromDoc(doc);
}
//#endregion

//#region [ Printing ]
const print = (args, data, lines) => console.log(args.json ? JSON.stringify(data, null, 2) : lines.join('\n'));

function routeLines(model, route, i) {
  const res = Rules.replay(model, route.steps);
  const out = [`route ${i + 1}: score ${route.score}, hp ${route.hp}/${route.maxhp}, str ${route.str}, def ${route.def}, ${route.moves} moves, ${route.kills} kills${route.cleared ? ', cleared' : ''}`];
  res.log.forEach((l, n) => out.push(`  ${String(n + 1).padStart(3)}. ${l.step}${l.log.length ? '  · ' + l.log.join(' · ') : ''}`));
  return out;
}

function stateLines(model, s) {
  const st = DAE.Effects.player(Rules.ctx(model), s);
  const slots = Object.entries(s.slots).map(([k, e]) => `${k}=${e ? e.id + (e.u !== null ? `(${e.u})` : '') : '-'}`).join(' ');
  return [
    `room ${s.room}${s.fight ? ` (fight, wave ${s.fight.wave})` : ''}${s.won ? ' · exit reached' : ''}${s.dead ? ' · dead' : ''}`,
    `hp ${s.hp}/${st.maxhp} str ${st.str} def ${st.def}${st.invuln ? ' invulnerable' : ''}`,
    `slots ${slots || '-'}`,
    `bag ${s.bag.map(e => e.id).join(', ') || '-'}`,
    `effects ${s.fx.map(f => `${f.id}(${f.t})`).join(', ') || '-'}`,
    `actions ${Rules.actions(model, s).map(Rules.actionStr).join(' | ') || '-'}`,
  ];
}
//#endregion

//#region [ Commands ]
const commands = {
  gen(args) {
    const params = {};
    for(const k of Object.keys(Generator.DEFAULTS)) if(k in args) params[k] = value(args[k]);
    const g = Generator.generate(params);
    if(args.solve) {
      const r = Solver.solve(g.model, { top: 3 });
      g.model.solutions = r.routes.map((x, i) => ({ id: `s${i}`, steps: x.steps }));
    }
    write(args.o, Model.stringify(g.model));
    console.error(`seed ${g.seed} (${g.tries} ${g.tries > 1 ? 'tries' : 'try'}): ${g.model.rooms.length} rooms, quick check: ${g.quick.label}`);
    return 0;
  },

  check(args) {
    const r = Check.run(load(args._[0]));
    const lines = [r.label];
    if(r.route) lines.push('route: ' + (r.route.join('; ') || '(start is an exit)'));
    r.blockers?.forEach(b => lines.push(`blocked: ${b.kind ?? 'room'} ${b.id}${b.need.length ? ' needs ' + b.need.join(' + ') : ''}`));
    if(r.truncated) lines.push(`(enemy-free search stopped at ${r.states} states)`);
    print(args, r, lines);
    return { 'no-enemies': 0, combat: 3 }[r.verdict] ?? 2;
  },

  solve(args) {
    const model = load(args._[0]);
    const opts = { top: +(args.top ?? 1), mode: args.mode, timeLimitMs: args.time && +args.time, maxRoomVisits: args.visits && +args.visits };
    Object.keys(opts).forEach(k => opts[k] === undefined && delete opts[k]);
    const r = Solver.solve(model, opts);
    const lines = [`${r.label} · ${r.states} states · ${r.ms} ms · mode ${r.mode}`];
    r.routes.forEach((x, i) => lines.push(...routeLines(model, x, i)));
    print(args, r, lines);
    if(args.o) {
      model.solutions = r.routes.map((x, i) => ({ id: `s${i}`, steps: x.steps }));
      fs.writeFileSync(args.o, Model.stringify(model));
    }
    return r.routes.length ? 0 : 2;
  },

  validate(args) {
    const v = Validate.run(load(args._[0]));
    const lines = [v.ok ? 'valid' : `${v.errors.length} error(s)`];
    v.errors.forEach(e => lines.push(`error   ${e.code.padEnd(12)} ${e.msg}`));
    v.warnings.forEach(e => lines.push(`warning ${e.code.padEnd(12)} ${e.msg}`));
    print(args, v, lines);
    return v.ok ? 0 : 1;
  },

  play(args) {
    const model = load(args._[0]);
    const steps = String(args.steps ?? '').split(';').map(x => x.trim()).filter(Boolean);
    const r = Rules.replay(model, steps);
    // --at N: the state after step N (0 = start), like the page's playback slider
    const at = args.at === undefined ? r.states.length - 1 : Math.max(0, Math.min(+args.at, r.states.length - 1));
    const state = r.states[at];
    const lines = r.log.slice(0, at).map((l, n) => `${String(n + 1).padStart(3)}. ${l.step}${l.log.length ? '  · ' + l.log.join(' · ') : ''}`);
    if(r.error && at === r.states.length - 1) lines.push(`step ${r.at + 1}: ${r.error}`);
    lines.push(...stateLines(model, state));
    if(args.save) {
      if(r.error) throw new Error('not saved: the route fails');
      let n = model.solutions.length;
      while(model.solutions.some(s => s.id === `s${n}`)) n++;
      model.solutions.push({ id: typeof args.save === 'string' ? args.save : `s${n}`, steps });
      write(args.o ?? args._[0], Model.stringify(model));
      lines.push(`saved as solution ${model.solutions.at(-1).id}`);
    }
    print(args, { error: r.error, at: r.at, step: at, log: r.log.slice(0, at), state, actions: Rules.actions(model, state).map(Rules.actionStr) }, lines);
    return r.error ? 1 : 0;
  },

  render(args) {
    const model = load(args._[0]);
    let route = null;
    if(args.steps) route = String(args.steps).split(';').map(x => x.trim()).filter(Boolean);
    else if(args.route) {
      route = model.solutions[+args.route - 1]?.steps;
      if(!route) throw new Error(`no solution ${args.route} in the map (it has ${model.solutions.length})`);
    }
    write(args.o, Svg.render(model, { route, standalone: true }));
    return 0;
  },

  layout(args) {
    const model = load(args._[0]);
    const L = Layout.place(model, { all: !!args.all });
    const snap = v => Math.round(v / 40) * 40;   // the page's grid
    model.rooms.forEach(r => { const p = L.pos.get(r.id); r.x = snap(p.x); r.y = snap(p.y); });
    write(args.o, Model.stringify(model));
    return 0;
  },

  edit(args) {
    const [file, ...ops] = args._;
    if(!ops.length) throw new Error('no edit ops');
    const model = edit(load(file), ops);
    write(args.o, Model.stringify(model));
    const v = Validate.run(model);
    console.error(`${ops.length} op${ops.length > 1 ? 's' : ''} · ${v.ok ? 'valid' : `${v.errors.length} error(s)`}${v.warnings.length ? `, ${v.warnings.length} warning(s)` : ''}`);
    v.errors.forEach(e => console.error(`error   ${e.code.padEnd(12)} ${e.msg}`));
    return 0;
  },

  convert(args) {
    const model = load(args._[0]);
    const to = args.to ?? 'json';
    if(to !== 'json' && to !== 'toon') throw new Error('--to json|toon');
    write(args.o, to === 'json' ? JSON.stringify(model, null, 2) + '\n' : Model.stringify(model));
    return 0;
  },
};
//#endregion

function main(argv) {
  return DAE.Cli.run('athena', HELP, commands, argv);
}

if(require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { main, parse, edit };
