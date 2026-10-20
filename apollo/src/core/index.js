// Node entry: loads the core in page order (same as the <script> tags) and returns DAE.
// Sample packs in vendor/sounds are loaded and decoded too, so the CLI sounds like the page.
const fs = require('fs');
const path = require('path');
require('../../../shared/core.js');
require('../../../shared/rng.js');
require('../../../shared/toon.js');
for(const f of ['theory', 'keymap', 'instruments', 'samples', 'synth', 'wav', 'sfxr', 'project', 'sequencer']) require(`./${f}.js`);

const packs = path.join(__dirname, '..', '..', 'vendor', 'sounds');
if(fs.existsSync(packs)) for(const f of fs.readdirSync(packs).filter(f => f.endsWith('.js')).sort()) require(path.join(packs, f));
globalThis.DAE.Samples.collect();
module.exports = globalThis.DAE;
