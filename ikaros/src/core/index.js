// Node entry: loads the shared files and every Ikaros subtool core in page order and returns DAE.
require('../../../shared/core.js');
require('../../../shared/rng.js');
require('../../../shared/toon.js');
require('../../../shared/cli.js');
require('../../../shared/zip.js');
require('../../../shared/gif.js');
for(const t of ['spyglass', 'caliper', 'prisma', 'easel', 'jigsaw', 'scale', 'wheel', 'metronome']) require(`../tools/${t}/core.js`);
module.exports = globalThis.DAE;

/** Loads a Jigsaw word list ('en' | 'pt') into DAE.Words. */
module.exports.loadWords = lang => require(`../tools/jigsaw/words-${lang}.js`);
