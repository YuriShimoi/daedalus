// Node entry: loads the core in page order (same as the <script> tags) and returns DAE.
require('../../../shared/core.js');
require('../../../shared/rng.js');
require('../../../shared/toon.js');
for(const f of ['model', 'validate', 'effects', 'events', 'rules', 'check', 'solver', 'lsystem', 'generator', 'layout', 'svg']) {
  try { require.resolve(`./${f}.js`); } catch { continue; }
  require(`./${f}.js`);
}
module.exports = globalThis.DAE;
