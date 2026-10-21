const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { main } = require('../cli.js');

/** Runs the CLI, returning [exit code, printed text]. */
function run(...argv) {
  const lines = [], log = console.log, err = console.error, write = process.stdout.write;
  console.log = console.error = (...a) => lines.push(a.join(' '));
  process.stdout.write = s => { lines.push(String(s).replace(/\n$/, '')); return true; };
  try { return [main(argv), lines.join('\n')]; }
  finally { console.log = log; console.error = err; process.stdout.write = write; }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ikaros-'));
const A = path.join(dir, 'a.toon'), B = path.join(dir, 'b.json');
fs.writeFileSync(A, 'name: x\nrooms[2]{id,n}:\n  r0,1\n  r1,2\n');
fs.writeFileSync(B, JSON.stringify({ name: 'x', rooms: [{ id: 'r1', n: 2 }, { id: 'r0', n: 5 }] }));

test('cli: spyglass convert / get, caliper exit codes', () => {
  const [c1, t1] = run('spyglass', 'convert', A);
  assert.strictEqual(c1, 0);
  assert.deepStrictEqual(JSON.parse(t1), { name: 'x', rooms: [{ id: 'r0', n: 1 }, { id: 'r1', n: 2 }] });
  assert.strictEqual(run('spyglass', 'get', A, 'rooms[1].id')[1], '"r1"');
  const [c2, t2] = run('caliper', A, B);
  assert.strictEqual(c2, 1);
  assert.match(t2, /~ rooms\[1\]\.n: 1 -> 5/);
  assert.strictEqual(run('caliper', A, A)[0], 0);
  assert.strictEqual(JSON.parse(run('caliper', A, B, '--patch')[1]).length > 0, true);
});

test('cli: prisma, jigsaw, scale, wheel', () => {
  const css = path.join(dir, 's.css');
  fs.writeFileSync(css, ':root { --accent: #CD7F32; }\na { color: #cd7f32; background: rgb(0 0 0); }\n');
  const [, p] = run('prisma', css);
  assert.match(p, /#CD7F32\s+2\s+accent/);
  assert.match(p, /2 colors · 3 uses · 1 files/);
  assert.strictEqual(run('jigsaw', 'encode', 'vigenere', 'ATTACKATDAWN', '--key', 'LEMON')[1], 'LXFOPVEFRNHR');
  assert.strictEqual(run('jigsaw', 'chain', 'atbash,base64', 'decode', run('jigsaw', 'chain', 'atbash,base64', 'encode', 'hello')[1])[1], 'hello');
  const [, s] = run('scale', '2d6+3', '-n', '4', '--seed', '1');
  assert.strictEqual(s.split('\n').length, 4);
  assert.strictEqual(run('scale', '2d7')[0], 1);
  const w = path.join(dir, 'w.txt');
  fs.writeFileSync(w, 'Gold | 50\nSword | 50\n');
  const [, out] = run('wheel', 'spin', w, '-n', '400', '--seed', '5');
  assert.match(out, /Gold\s+\d+\s+[\d.]+%\s+\(odds 50\.0%\)/);
});
