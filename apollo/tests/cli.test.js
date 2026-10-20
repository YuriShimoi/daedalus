const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { main } = require('../cli.js');
const { Project, Sfxr, Wav, Engine, Samples } = require('./load.js');

const quiet = fn => {
  const log = console.log;
  console.log = () => {};
  try { return fn(); } finally { console.log = log; }
};

test('render matches the page export and sfx / sfxall write WAVs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-cli-'));
  const p = Project.create();
  p.sfx.push(Sfxr.normalize({ id: 20, name: 'zap', gen: 'zap', seed: 3, params: Sfxr.generate('zap', 3) }));
  const song = path.join(dir, 'song.toon');
  fs.writeFileSync(song, Project.stringify(p));

  const loopWav = path.join(dir, 'loop.wav');
  assert.strictEqual(quiet(() => main(['render', song, '--loop', '-o', loopWav])), 0);
  const got = Wav.decode(fs.readFileSync(loopWav));
  const want = Engine.render(Project.parse(Project.stringify(p)), Samples.packs, { from: p.song.loop.from, to: p.song.loop.to, loop: true });
  assert.strictEqual(got.channels[0].length, want.L.length);
  assert.ok(Math.abs(got.channels[0][5000] - want.L[5000]) < 1e-3);

  const sfx = path.join(dir, 'coin.wav');
  assert.strictEqual(quiet(() => main(['sfx', 'pickup', '--seed', '7', '--rate', '22050', '--bits', '8', '-o', sfx])), 0);
  assert.strictEqual(Wav.decode(fs.readFileSync(sfx)).rate, 22050);
  assert.strictEqual(quiet(() => main(['sfx', 'from', song, '--name', 'zap', '-o', path.join(dir, 'zap.wav')])), 0);
  assert.strictEqual(quiet(() => main(['sfxall', song, '-d', path.join(dir, 'all')])), 0);
  assert.ok(fs.existsSync(path.join(dir, 'all', 'zap.wav')));
  assert.strictEqual(quiet(() => main(['info', song])), 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('bad input exits with 1', () => {
  const err = console.error;
  console.error = () => {};
  try {
    assert.strictEqual(main(['nope']), 1);
    assert.strictEqual(main(['sfx', 'not-a-generator', '-o', 'x.wav']), 1);
  } finally { console.error = err; }
});
