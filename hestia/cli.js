#!/usr/bin/env node
// Hestia CLI: make and edit boards, import Obsidian canvases and vaults, export to Obsidian / SVG.
// Same core as the page, so boards made here open there unchanged.
const fs = require('fs');
const path = require('path');
const DAE = require('./src/core/index.js');
const { Board, Obsidian, Draw, Toon } = DAE;
const Ops = require('./src/cli/ops.js');

const HELP = `hestia <command> [options]
  new      -o board.toon                       empty board
  info     board.toon [--json]                 items by kind, groups, links, widgets, assets
  list     board.toon                          one line per item: id, kind, box, text
  edit     board.toon "<op>" ["<op>" ...] [-o out]   apply ops in order. Ops (see USAGE.md):
             note add "# Title\\nbody" [x= y= w= h= color=] · text add "Act 1" [x= y= size= color=]
             shape add <rect|ellipse|diamond|triangle|hexagon|parallelogram|star|cylinder|bubble> [x= y= w= h= text= color= fill= width=]
             arrow|line add from=<id|x,y> to=<id|x,y> [mid=x,y curve=true color= width=]
             link <a> <b> [label= color=] · unlink <a> <b> · group <id,id,..> [label= color=] · ungroup <id>
             set <id> field=value ... (x y w h md text label name color border fill width size shape curve mid locked)
             move <id,id> dx dy · remove <id,id> · view fit | view x= y= zoom=
           (new items without x= y= go to the right of the board; colors: white gray pink purple cyan green yellow orange red dark none or #hex)
  add      board.toon <file> [<file> ...] [--at x,y]   images, Athena / Apollo .toon, audio (widgets), .md (note), .canvas (merged)
  import   <file.canvas | vault folder> [--vault folder] -o board.toon    Obsidian -> Hestia
  export   board.toon --to canvas|svg|json -o out    canvas: images and widget files go to <out>-files/
  render   board.toon -o board.svg [--ids 1,2]   SVG picture (Athena maps drawn at their start, audio widgets as a box)
  convert  board.toon --to json|toon [-o out]`;

//#region [ Arguments, files ]
const { parse } = DAE.Cli;

function load(file) {
  if(!file) throw new Error('missing board file');
  return Board.parse(fs.readFileSync(file, 'utf8'));
}

function save(file, b) {
  if(!file) throw new Error('missing -o out.toon');
  fs.writeFileSync(file, Board.stringify(b));
}

const unb64 = s => new Uint8Array(Buffer.from(s, 'base64'));

/** Vault reader: vault-relative path, else any file with that name (Obsidian resolves by name). */
function vaultReader(root) {
  const index = new Map();
  const walk = dir => {
    for(const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if(e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = path.join(dir, e.name);
      if(e.isDirectory()) walk(p);
      else if(!index.has(e.name.toLowerCase())) index.set(e.name.toLowerCase(), p);
    }
  };
  walk(root);
  return rel => {
    const direct = path.join(root, rel);
    const p = fs.existsSync(direct) && fs.statSync(direct).isFile() ? direct : index.get(path.basename(String(rel)).toLowerCase())
      ?? index.get((path.basename(String(rel)) + '.md').toLowerCase());
    return p ? new Uint8Array(fs.readFileSync(p)) : null;
  };
}

/** The vault a canvas lives in: the nearest folder above it with .obsidian, else its own folder. */
function vaultOf(file) {
  let dir = path.dirname(path.resolve(file));
  for(let d = dir; ; d = path.dirname(d)) {
    if(fs.existsSync(path.join(d, '.obsidian'))) return d;
    if(path.dirname(d) === d) return dir;
  }
}

function athenaSvg(b, it, w, h) {
  try {
    require('../athena/src/core/index.js');
    const a = Board.asset(b, it.asset), model = DAE.Model.parse(Buffer.from(a.data, 'base64').toString('utf8'));
    const svg = DAE.Svg.render(model, { standalone: true });
    return `<svg x="0" y="30" width="${w}" height="${h - 30}" ${/viewBox="[^"]+"/.exec(svg)[0]}>${svg.replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg>`;
  } catch { return ''; }
}
//#endregion

//#region [ Commands ]
const commands = {
  new(args) {
    save(args.o, Board.create());
    console.log(`${args.o}: empty board`);
    return 0;
  },

  info(args) {
    const b = load(args._[0]), kinds = {};
    for(const it of b.items) kinds[it.kind] = (kinds[it.kind] ?? 0) + 1;
    const data = {
      items: b.items.length, kinds, links: b.edges.length,
      groups: b.items.filter(i => i.kind === 'group').map(g => ({ id: g.id, label: g.label, members: g.items ?? [] })),
      widgets: b.items.filter(i => i.kind === 'widget').map(w => ({ id: w.id, tool: w.tool, file: w.name })),
      assets: b.assets.map(a => ({ id: a.id, name: a.name, mime: a.mime, kb: Math.round(a.data.length * 3 / 4 / 1024) })),
      box: Board.bounds(b.items),
    };
    if(args.json) console.log(JSON.stringify(data, null, 2));
    else {
      console.log(`${data.items} items (${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ') || 'none'}) · ${data.links} links · ${b.assets.length} assets`);
      for(const g of data.groups) console.log(`  group ${g.id} "${g.label}": ${g.members.join(', ')}`);
      for(const w of data.widgets) console.log(`  widget ${w.id}: ${w.tool} · ${w.file}`);
      for(const a of data.assets) console.log(`  asset ${a.id}: ${a.name} (${a.mime}, ${a.kb} KB)`);
    }
    return 0;
  },

  list(args) {
    const b = load(args._[0]);
    for(const it of Board.ordered(b)) {
      const txt = (it.md ?? it.text ?? it.label ?? it.name ?? it.shape ?? '').replace(/\s+/g, ' ').slice(0, 50);
      const extra = Board.isLine(it) ? ` ${it.from ?? '·'}→${it.to ?? '·'}` : it.kind === 'group' ? ` [${(it.items ?? []).join(',')}]` : '';
      console.log(`${String(it.id).padStart(4)} ${it.kind.padEnd(7)} ${[it.x, it.y, it.w, it.h].map(Math.round).join(',').padEnd(22)}${extra} ${txt}`);
    }
    for(const e of b.edges) console.log(`  link ${e.id}: ${e.from} → ${e.to}${e.label ? ` "${e.label}"` : ''}`);
    return 0;
  },

  edit(args) {
    const file = args._[0], b = load(file), ops = args._.slice(1);
    if(!ops.length) throw new Error('no ops given');
    for(const msg of Ops.apply(b, ops)) console.log(`  ${msg}`);
    save(args.o ?? file, b);
    console.log(`${args.o ?? file}: ${ops.length} op(s) applied`);
    return 0;
  },

  add(args) {
    const file = args._[0], b = load(file), list = args._.slice(1);
    if(!list.length) throw new Error('no files given');
    let [x, y] = args.at ? String(args.at).split(',').map(Number) : (() => { const a = Board.bounds(b.items); return a ? [a.x + a.w + 60, a.y] : [0, 0]; })();
    for(const f of list) {
      const name = path.basename(f), bytes = new Uint8Array(fs.readFileSync(f)), mime = Obsidian.mime(name);
      let made = [];
      if(/\.canvas$/i.test(name)) {
        const src = Obsidian.fromCanvas(Buffer.from(bytes).toString('utf8'), { read: vaultReader(vaultOf(f)) }), box = Board.bounds(src.items);
        if(box) made = Board.merge(b, src, x - box.x, y - box.y);
      }
      else if(/\.md$/i.test(name)) {
        const it = Board.item(b, 'note', { x, y, w: 300, h: 220, md: Obsidian.md(Buffer.from(bytes).toString('utf8'), b, vaultReader(path.dirname(path.resolve(f)))) });
        if(!/^\s*# /.test(it.md)) it.md = `# ${name.replace(/\.md$/i, '')}\n\n${it.md}`;
        b.items.push(it); made = [it.id];
      }
      else if(mime.startsWith('image/')) {
        const a = Board.addAsset(b, { name, mime, data: Obsidian.b64(bytes) });
        const it = Board.item(b, 'image', { x, y, w: 320, h: 240, asset: a.id, name });
        b.items.push(it); made = [it.id];
      }
      else {
        const isText = /\.(toon|json)$/i.test(name), kind = Board.widgetKind(name, mime, isText ? Buffer.from(bytes).toString('utf8') : null);
        if(kind !== 'athena' && kind !== 'apollo') throw new Error(`${name}: not an image, .md, .canvas, Athena map, Apollo project or audio file`);
        const a = Board.addAsset(b, { name, mime: isText ? 'text/toon' : mime, data: Obsidian.b64(bytes) });
        const it = Board.item(b, 'widget', { x, y, tool: kind, asset: a.id, name, audio: null, ...(kind === 'apollo' ? { h: 140, fit: true } : {}) });
        b.items.push(it); made = [it.id];
      }
      Board.bind(b);
      const box = Board.bounds(made.map(id => Board.find(b, id)));
      console.log(`  ${name} -> ${made.join(', ')}`);
      if(box) x = box.x + box.w + 60;
    }
    save(args.o ?? file, b);
    return 0;
  },

  import(args) {
    const src = args._[0];
    if(!src) throw new Error('import <file.canvas | vault folder> -o board.toon');
    let b;
    if(fs.statSync(src).isDirectory()) {
      const notes = [], root = path.resolve(src);
      const walk = dir => {
        for(const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if(e.name.startsWith('.')) continue;
          const p = path.join(dir, e.name);
          if(e.isDirectory()) walk(p);
          else if(/\.md$/i.test(e.name)) notes.push({ path: path.relative(root, p).split(path.sep).join('/'), text: fs.readFileSync(p, 'utf8') });
        }
      };
      walk(root);
      if(!notes.length) throw new Error(`no .md notes in ${src}`);
      b = Obsidian.fromVault(notes, { read: vaultReader(root), name: path.basename(root) });
      console.log(`${args.o}: vault, ${notes.length} notes, ${b.edges.length} links, ${b.items.filter(i => i.kind === 'group').length} folders`);
    }
    else {
      b = Obsidian.fromCanvas(fs.readFileSync(src, 'utf8'), { read: vaultReader(args.vault ? path.resolve(args.vault) : vaultOf(src)) });
      const kinds = {};
      for(const it of b.items) kinds[it.kind] = (kinds[it.kind] ?? 0) + 1;
      console.log(`${args.o}: canvas, ${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')}, ${b.edges.length} links`);
    }
    save(args.o, b);
    return 0;
  },

  export(args) {
    const b = load(args._[0]), out = args.o;
    if(!out) throw new Error('missing -o out');
    if(args.to === 'canvas') {
      const dir = path.basename(out).replace(/\.canvas$/i, '') + '-files';
      const r = Obsidian.toCanvas(b, { dir, unb64 });
      fs.writeFileSync(out, JSON.stringify(r.canvas, null, '\t'));
      for(const f of r.files) {
        const p = path.join(path.dirname(path.resolve(out)), f.path);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, f.bytes);
      }
      console.log(`${out}: ${r.canvas.nodes.length} nodes, ${r.canvas.edges.length} edges, ${r.files.length} files in ${dir}/${r.skipped ? ` (${r.skipped} free strokes / lines left out)` : ''}`);
    }
    else if(args.to === 'svg') return commands.render({ ...args, _: [args._[0]] });
    else if(args.to === 'json') { fs.writeFileSync(out, JSON.stringify(b, null, 2)); console.log(`${out}: json`); }
    else throw new Error('--to canvas|svg|json');
    return 0;
  },

  render(args) {
    const b = load(args._[0]);
    if(!args.o) throw new Error('missing -o board.svg');
    const items = args.ids ? String(args.ids).split(',').map(id => Board.find(b, Number(id))).filter(Boolean) : b.items;
    const svg = Draw.board(b, items, { widget: (it, w, h) => it.tool === 'athena' ? athenaSvg(b, it, w, h) : '' });
    fs.writeFileSync(args.o, svg);
    console.log(`${args.o}: ${items.length} items, ${/width="(\d+)" height="(\d+)"/.exec(svg).slice(1).join('x')}`);
    return 0;
  },

  convert(args) {
    const b = load(args._[0]);
    if(!['json', 'toon'].includes(args.to)) throw new Error('--to json|toon');
    const text = args.to === 'json' ? JSON.stringify(b, null, 2) : Board.stringify(b);
    if(args.o) { fs.writeFileSync(args.o, text); console.log(`${args.o}: ${args.to}`); }
    else console.log(text);
    return 0;
  },
};
//#endregion

function main(argv) {
  return DAE.Cli.run('hestia', HELP, commands, argv);
}

if(require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { main, parse };
