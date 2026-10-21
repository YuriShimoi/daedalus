// Node entry: loads the shared files and the Hestia core in page order and returns DAE.
require('../../../shared/core.js');
require('../../../shared/rng.js');
require('../../../shared/toon.js');
require('../../../shared/icons.js');
require('../../../shared/markdown.js');
require('../../../shared/ogg.js');
require('../../../shared/cli.js');
for(const f of ['board', 'draw', 'obsidian']) require(`./${f}.js`);
module.exports = globalThis.DAE;
