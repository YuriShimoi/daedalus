// Small key-value store in IndexedDB (one database per tool): autosave, recent files, templates.
// IndexedDB holds far more than localStorage (boards with images, projects with samples). Reads give
// null when storage is blocked, writes fail quietly; values are structured-cloned.
(DAE => {
  class Store {
    #db = null;

    /** @param {string} name - database name, e.g. 'apollo' */
    constructor(name) {
      this.name = name;
    }

    #tx(mode) {
      this.#db ??= new Promise((ok, fail) => {
        const r = indexedDB.open(this.name, 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => ok(r.result);
        r.onerror = () => fail(r.error);
      });
      return this.#db.then(db => db.transaction('kv', mode).objectStore('kv'));
    }

    async get(key, fallback = null) {
      try {
        const s = await this.#tx('readonly');
        return await new Promise(ok => { const r = s.get(key); r.onsuccess = () => ok(r.result ?? fallback); r.onerror = () => ok(fallback); });
      } catch { return fallback; }
    }

    async set(key, value) {
      try { (await this.#tx('readwrite')).put(value, key); } catch {}
    }

    async del(key) {
      try { (await this.#tx('readwrite')).delete(key); } catch {}
    }

    /** Debounced set (autosave): the last value wins after `ms`. */
    later(key, make, ms = 800) {
      clearTimeout((this.timers ??= {})[key]);
      this.timers[key] = setTimeout(() => this.set(key, make()), ms);
    }

    /** Puts `entry` first in a list stored under `key` (same `id` replaced), keeping `max`. */
    static push(list, entry, max = 6, id = 'name') {
      return [entry, ...(list ?? []).filter(x => x[id] !== entry[id])].slice(0, max);
    }

    /** Moves old localStorage keys into the store once (kept for pages that used localStorage). */
    async adopt(keys) {
      for(const [from, to] of Object.entries(keys)) {
        try {
          const raw = localStorage.getItem(from);
          if(raw === null) continue;
          if(await this.get(to) === null) await this.set(to, JSON.parse(raw));
          localStorage.removeItem(from);
        } catch {}
      }
    }
  }

  DAE.Store = Store;
})(globalThis.DAE ??= {});
if(typeof module === 'object') module.exports = globalThis.DAE;
