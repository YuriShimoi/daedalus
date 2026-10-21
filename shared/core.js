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

/** A Web Worker running every core body, then `main(DAE)` (from a Blob URL: works on file://). */
globalThis.DAE_CORE.worker = main => {
  const url = URL.createObjectURL(new Blob([globalThis.DAE_CORE.workerSource(String(main))], { type: 'text/javascript' }));
  const w = new Worker(url);
  setTimeout(() => URL.revokeObjectURL(url), 10000);   // the worker has fetched its script by then
  return w;
};
