// Snapshot undo / redo (generic): push a snapshot before each change.
(DAE => {
  class History {
    #past = [];
    #future = [];

    /** @param {number} limit - snapshots kept */
    constructor(limit = 100) {
      this.limit = limit;
    }

    get canUndo() { return this.#past.length > 0; }
    get canRedo() { return this.#future.length > 0; }

    /** Records the state before a change. Snapshots are stored as given (pass copies). */
    push(snapshot) {
      this.#past.push(snapshot);
      if(this.#past.length > this.limit) this.#past.shift();
      this.#future = [];
    }

    /** @returns the state to restore, or undefined */
    undo(current) {
      if(!this.#past.length) return;
      this.#future.push(current);
      return this.#past.pop();
    }

    redo(current) {
      if(!this.#future.length) return;
      this.#past.push(current);
      return this.#future.pop();
    }

    clear() {
      this.#past = [];
      this.#future = [];
    }
  }

  DAE.History = History;
})(globalThis.DAE ??= {});
if(typeof module === 'object') module.exports = globalThis.DAE;
