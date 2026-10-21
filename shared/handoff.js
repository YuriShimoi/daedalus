// Cross-tool handoff: one page leaves a file for another tab (localStorage key + ?open=<id>).
// localStorage is shared by every file:// page in Chrome and by every page of one site, so it works
// from disk and on GitHub Pages. The reader removes the key once it took the file.
(DAE => {
  const PREFIX = 'daedalus.handoff.';
  const DAY = 864e5;

  class Handoff {
    /** Stores a file for another page; returns its id. */
    static give(name, text) {
      Handoff.sweep();
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      localStorage.setItem(PREFIX + id, JSON.stringify({ name, text, time: Date.now() }));
      return id;
    }

    /** Opens `page` (relative URL) in a new tab with the file. */
    static open(page, name, text) {
      const id = Handoff.give(name, text);
      return window.open(`${page}?open=${id}`, '_blank');
    }

    /** The file left for this page (from ?open=<id>), or null. Drops the param from the address bar. */
    static take() {
      const id = new URLSearchParams(location.search).get('open');
      if(!id) return null;
      let file = null;
      try {
        file = JSON.parse(localStorage.getItem(PREFIX + id));
        localStorage.removeItem(PREFIX + id);
      } catch {}
      history.replaceState(null, '', location.pathname);
      return file;
    }

    /** Removes handoffs nobody took within a day. */
    static sweep() {
      try {
        for(let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if(!k?.startsWith(PREFIX)) continue;
          const t = JSON.parse(localStorage.getItem(k))?.time ?? 0;
          if(Date.now() - t > DAY) localStorage.removeItem(k);
        }
      } catch {}
    }
  }

  DAE.Handoff = Handoff;
})(globalThis.DAE ??= {});
if(typeof module === 'object') module.exports = globalThis.DAE;
