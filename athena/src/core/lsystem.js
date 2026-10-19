// Parametric L-System for room trees. Axiom: E R(0) X. Rules on R(d):
//   R(d) -> R(d) [ R(d+1) ]   side branch, chance `branching`, only while d < deepnest
//   R(d) -> R(d) [ X ]        extra exit, while exits < `exits`
//   R(d) -> R(d) R(d)         stretch
// The bracket string is read as a turtle: R links to the previous room, [ pushes, ] pops.
DAE_CORE(DAE => {
  class LSystem {
    static str(symbols) {
      return symbols.map(s => s.t === 'R' ? `R${s.d}` : s.t).join(' ');
    }

    /**
     * @param {Rng} rng
     * @param {{rooms, branching, deepnest, iterations, exits}} p - rooms counts every room, entry and exits included
     */
    static grow(rng, { rooms = 12, branching = 0.4, deepnest = 3, iterations = 40, exits = 1 } = {}) {
      let symbols = [{ t: 'E' }, { t: 'R', d: 0 }, { t: 'X' }];
      const count = list => list.filter(s => s.t === 'R' || s.t === 'E' || s.t === 'X').length;
      let exitCount = 1;
      for(let it = 0; it < iterations && count(symbols) < rooms; it++) {
        const out = [];
        let budget = rooms - count(symbols);
        for(const s of symbols) {
          if(s.t !== 'R' || budget <= 0) {
            out.push(s);
            continue;
          }
          const d = s.d;
          if(d < deepnest && rng.chance(branching)) {
            out.push(s, { t: '[' }, { t: 'R', d: d + 1 }, { t: ']' });
            budget--;
          }
          else if(exitCount < exits && rng.chance(0.15)) {
            out.push(s, { t: '[' }, { t: 'X' }, { t: ']' });
            exitCount++;
            budget--;
          }
          else if(rng.chance(0.6)) {
            out.push(s, { t: 'R', d });
            budget--;
          }
          else out.push(s);
        }
        symbols = out;
      }
      return symbols;
    }

    /** Turtle reading: nodes {id, kind, depth} and tree edges [a, b] (indexes). */
    static interpret(symbols) {
      const nodes = [], edges = [], stack = [];
      let cur = -1;
      const add = (kind, depth) => {
        nodes.push({ kind, depth });
        const id = nodes.length - 1;
        if(cur >= 0) edges.push([cur, id]);
        return id;
      };
      for(const s of symbols) {
        if(s.t === 'E') cur = add('entry', 0);
        else if(s.t === 'R') cur = add('room', s.d);
        else if(s.t === 'X') {
          const id = add('exit', nodes[cur]?.depth ?? 0);
          if(stack.length === 0) cur = id;
        }
        else if(s.t === '[') stack.push(cur);
        else if(s.t === ']') cur = stack.pop();
      }
      return { nodes, edges };
    }
  }

  DAE.LSystem = LSystem;
});
