// CLI edit ops: one string per change ("note add '# Plan' x=0 y=0"), applied in order to a board.
// Node only (cli.js and the tests); the page edits through its UI.
const DAE = require('../core/index.js');
const { Board } = DAE;

//#region [ Values ]
const { words, fields, value, number } = DAE.Cli;   // shared op-string helpers

const COLORS = { white: '#FFFFFF', gray: '#A3A3A3', grey: '#A3A3A3', pink: '#FF79C6', purple: '#BD93F9', cyan: '#8BE9FD', green: '#50FA7B', yellow: '#F1FA8C', orange: '#FFB86C', red: '#FF5555', dark: '#111111', none: '' };

/** Color name (pink, cyan...), #hex, or none. */
function color(v) {
  const s = String(v);
  if(s in COLORS) return COLORS[s];
  if(/^#[0-9a-f]{3,8}$/i.test(s)) return s.toUpperCase();
  throw new Error(`bad color "${v}" (${Object.keys(COLORS).join(' ')} or #hex)`);
}

function item(b, ref) {
  const it = Board.find(b, Number(ref));
  if(!it) throw new Error(`no item ${ref} (ids: ${b.items.map(i => i.id).join(', ') || 'none'})`);
  return it;
}

/** An end of a line: an item id (attached) or x,y (free). */
function end(b, v) {
  const s = String(v);
  if(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(s)) { const [x, y] = s.split(',').map(Number); return { x, y, id: null }; }
  const it = item(b, s);
  return { ...Board.center(it), id: it.id };
}

/** Where a new item goes: given x / y, else to the right of everything. */
function place(b, kv, w, h) {
  const all = Board.bounds(b.items);
  return { x: kv.x !== undefined ? number(kv.x, 'x') : all ? all.x + all.w + 60 : 0, y: kv.y !== undefined ? number(kv.y, 'y') : all ? all.y : 0,
    w: kv.w !== undefined ? number(kv.w, 'w') : w, h: kv.h !== undefined ? number(kv.h, 'h') : h };
}
//#endregion

//#region [ Ops ]
const SET_FIELDS = ['x', 'y', 'w', 'h', 'md', 'text', 'label', 'name', 'color', 'border', 'fill', 'width', 'size', 'shape', 'curve', 'locked', 'mid'];

const OPS = {
  note(b, [act, md = '', ...args]) {
    if(act !== 'add') throw new Error('note add "<markdown>" [x= y= w= h= color=]');
    const { kv } = fields(args), p = place(b, kv, 240, 160);
    const it = Board.item(b, 'note', { ...p, md: String(md), ...(kv.color ? { color: color(kv.color) } : {}) });
    b.items.push(it);
    return `note ${it.id}`;
  },

  text(b, [act, text = '', ...args]) {
    if(act !== 'add') throw new Error('text add "<text>" [x= y= size= color=]');
    const { kv } = fields(args), p = place(b, kv, 100, 30);
    const it = Board.item(b, 'text', { x: p.x, y: p.y, text: String(text), size: kv.size ? number(kv.size, 'size') : 20, color: kv.color ? color(kv.color) : '#FFFFFF', border: '' });
    it.w = Math.max(8, String(text).split('\n').reduce((m, l) => Math.max(m, l.length), 0) * it.size * 0.55);
    it.h = String(text).split('\n').length * it.size * 1.3;
    b.items.push(it);
    return `text ${it.id}`;
  },

  shape(b, [act, shape = 'rect', ...args]) {
    if(act !== 'add' || !Board.BOXES.includes(shape)) throw new Error(`shape add <${Board.BOXES.join('|')}> [x= y= w= h= text= color= fill=none|tint|solid width= size=]`);
    const { kv } = fields(args), p = place(b, kv, 160, 100);
    const it = Board.item(b, 'shape', { ...p, shape, text: String(kv.text ?? ''), color: kv.color ? color(kv.color) : '#FFFFFF', fill: kv.fill ?? 'none',
      width: kv.width ? number(kv.width, 'width') : 2, size: kv.size ? number(kv.size, 'size') : 20 });
    b.items.push(it);
    return `shape ${it.id}`;
  },

  arrow(b, args) { return OPS.line(b, args, 'arrow'); },

  /** line|arrow add from=<id|x,y> to=<id|x,y> [mid=x,y curve=true color= width=] */
  line(b, [act, ...args], kind = 'line') {
    if(act !== 'add') throw new Error(`${kind} add from=<id|x,y> to=<id|x,y> [mid=x,y curve=true color= width=]`);
    const { kv } = fields(args);
    if(kv.from === undefined || kv.to === undefined) throw new Error(`${kind} add needs from= and to=`);
    const A = end(b, kv.from), B = end(b, kv.to);
    const it = Board.item(b, 'shape', { shape: kind, x1: A.x, y1: A.y, x2: B.x, y2: B.y, from: A.id, to: B.id, border: '',
      color: kv.color ? color(kv.color) : '#FFFFFF', width: kv.width ? number(kv.width, 'width') : 2 });
    if(kv.mid) { const [x, y] = String(kv.mid).split(',').map(Number); Object.assign(it, { mx: x, my: y }); }
    if(kv.curve === true) it.curve = true;
    b.items.push(it);
    Board.bind(b);
    return `${kind} ${it.id}`;
  },

  link(b, [a, c, ...args]) {
    const A = item(b, a), C = item(b, c), { kv } = fields(args);
    if(b.edges.some(e => e.from === A.id && e.to === C.id)) throw new Error(`${A.id} and ${C.id} are linked already`);
    const e = Board.edge(b, A.id, C.id, { label: String(kv.label ?? ''), color: kv.color ? color(kv.color) : '' });
    return `link ${e.id}`;
  },

  unlink(b, [a, c]) {
    const n = b.edges.length;
    b.edges = b.edges.filter(e => !((e.from === Number(a) && e.to === Number(c)) || (e.from === Number(c) && e.to === Number(a))));
    if(b.edges.length === n) throw new Error(`no link between ${a} and ${c}`);
  },

  group(b, [ids, ...args]) {
    const list = String(ids ?? '').split(',').filter(Boolean).map(id => item(b, id).id), { kv } = fields(args);
    if(!list.length) throw new Error('group <id,id,...> [label= color=]');
    const g = Board.group(b, list, { ...(kv.label !== undefined ? { label: String(kv.label) } : {}), ...(kv.color ? { color: color(kv.color) } : {}) });
    return `group ${g.id}`;
  },

  ungroup(b, [id]) {
    const g = item(b, id);
    if(g.kind !== 'group') throw new Error(`${id} is not a group`);
    b.items = b.items.filter(x => x !== g);
  },

  set(b, [id, ...args]) {
    const it = item(b, id), { kv } = fields(args);
    for(const [k, v] of Object.entries(kv)) {
      if(!SET_FIELDS.includes(k)) throw new Error(`set: unknown field "${k}" (${SET_FIELDS.join(' ')})`);
      if(k === 'color') it.color = color(v) || '#FFFFFF';
      else if(k === 'border') { const c = color(v); if(c) it.border = c; else delete it.border; }
      else if(k === 'shape') { if(!Board.BOXES.includes(v) || it.kind !== 'shape' || Board.isLine(it)) throw new Error(`shape: ${Board.BOXES.join(' ')} (box shapes only)`); it.shape = v; }
      else if(k === 'mid') { if(!Board.isLine(it)) throw new Error('mid: lines and arrows only'); if(v === 'none') { delete it.mx; delete it.my; delete it.curve; } else { const [x, y] = String(v).split(',').map(Number); Object.assign(it, { mx: x, my: y }); } }
      else if(k === 'curve') { if(v === true) it.curve = true; else delete it.curve; }
      else if(['x', 'y'].includes(k)) Board.move(b, [it.id], k === 'x' ? number(v, k) - it.x : 0, k === 'y' ? number(v, k) - it.y : 0);
      else if(['w', 'h'].includes(k)) Board.resize(it, it.x, it.y, k === 'w' ? number(v, k) : it.w, k === 'h' ? number(v, k) : it.h);
      else if(['width', 'size'].includes(k)) it[k] = number(v, k);
      else if(k === 'locked') it.locked = v === true;
      else it[k] = String(v);
    }
  },

  move(b, [ids, dx, dy]) {
    Board.move(b, String(ids).split(',').map(id => item(b, id).id), number(dx, 'dx'), number(dy, 'dy'));
  },

  remove(b, [ids]) {
    Board.remove(b, String(ids ?? '').split(',').filter(Boolean).map(id => item(b, id).id));
  },

  view(b, args) {
    const { kv, rest } = fields(args);
    if(rest[0] === 'fit') {
      const all = Board.bounds(b.items);
      if(all) b.view = { x: all.x - 60, y: all.y - 60, zoom: 1 };
      return;
    }
    for(const k of ['x', 'y', 'zoom']) if(kv[k] !== undefined) b.view[k] = number(kv[k], k);
  },
};
//#endregion

/** Runs ops in order; returns their messages. Throws on the first bad op with its text. */
function apply(b, ops) {
  const out = [];
  for(const text of ops) {
    const [name, ...args] = words(text);
    if(!OPS[name]) throw new Error(`unknown op "${name}" (${Object.keys(OPS).join(' ')})`);
    try {
      const msg = OPS[name](b, args);
      if(msg) out.push(msg);
    }
    catch(err) { throw new Error(`"${text}": ${err.message}`); }
    Board.bind(b);
  }
  return out;
}

module.exports = { apply, words, OPS, color };
