// Load first. Core files register through DAE_CORE(DAE => {...}): the body runs now, and its
// source is kept in DAE.src so the same code can be started inside a Blob Web Worker (file:// safe).
globalThis.DAE_CORE ??= function(body) {
  const DAE = globalThis.DAE ??= {};
  (DAE.src ??= []).push(body);
  body(DAE);
  return DAE;
};

/** Source text for a worker: every registered core body, then `main` (a function source). */
globalThis.DAE_CORE.workerSource = main => 'const DAE = { src: [] };\n'
  + globalThis.DAE.src.map(f => `(${f})(DAE);`).join('\n') + `\n(${main})(DAE);\n`;
