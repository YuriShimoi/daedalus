// CLI helpers shared by the tools' Node CLIs: argument parsing, the command runner, and the parts of
// "op strings" (edit ops like `track add drum name="Beat"`): words, key=value fields, values, numbers.
(DAE => {
  class Cli {
    /**
     * argv -> { _: [positionals], o, d, key: value | true }. A --flag takes the next word as its value
     * unless that word is another --flag or a short option (so negative numbers are values).
     */
    static parse(argv, short = ['o', 'd']) {
      const args = { _: [] }, isShort = a => short.some(s => a === `-${s}`);
      for(let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if(isShort(a)) args[a.slice(1)] = argv[++i];
        else if(a.startsWith('--')) {
          const key = a.slice(2), next = argv[i + 1];
          if(next === undefined || next.startsWith('--') || isShort(next)) args[key] = true;
          else args[key] = argv[++i];
        }
        else args._.push(a);
      }
      return args;
    }

    /** Runs `commands[name](args)` with help and errors handled; returns the exit code. */
    static run(tool, help, commands, argv) {
      const args = Cli.parse(argv), cmd = args._.shift();
      if(!cmd || cmd === 'help' || args.help) {
        console.log(help);
        return cmd ? 0 : 1;
      }
      if(!commands[cmd]) {
        console.error(`unknown command "${cmd}"\n\n${help}`);
        return 1;
      }
      try { return commands[cmd](args) ?? 0; }
      catch(err) {
        console.error(`${tool} ${cmd}: ${err.message}`);
        return 1;
      }
    }

    //#region [ Op strings ]
    /** Splits an op into words; "double" or 'single' quotes keep spaces, \n inside quotes is a new line. */
    static words(text) {
      const out = [], rx = /(\S*?)"((?:[^"\\]|\\.)*)"|(\S*?)'((?:[^'\\]|\\.)*)'|(\S+)/g;
      const unq = s => s.replace(/\\n/g, '\n').replace(/\\(["'\\])/g, '$1');
      let m;
      while((m = rx.exec(text))) out.push(m[5] ?? (m[2] !== undefined ? m[1] + unq(m[2]) : m[3] + unq(m[4])));
      return out;
    }

    /** "a=1 b=x" words -> { kv: { a: 1, b: 'x' }, rest: [other words] }. Keys are names (letters, digits, _ and -). */
    static fields(list) {
      const kv = {}, rest = [];
      for(const w of list) {
        const i = w.indexOf('=');
        if(i > 0 && /^[a-z_][\w-]*$/i.test(w.slice(0, i))) kv[w.slice(0, i)] = Cli.value(w.slice(i + 1));
        else rest.push(w);
      }
      return { kv, rest };
    }

    /** 'true' / 'false' -> booleans, numeric text -> numbers, the rest stays text. */
    static value(v) {
      if(v === 'true') return true;
      if(v === 'false') return false;
      if(v !== '' && !isNaN(Number(v))) return Number(v);
      return v;
    }

    static number(v, what) {
      const n = Number(v);
      if(v === undefined || v === '' || isNaN(n)) throw new Error(`${what}: expected a number, got "${v ?? ''}"`);
      return n;
    }
    //#endregion
  }

  DAE.Cli = Cli;
})(globalThis.DAE ??= {});
if(typeof module === 'object') module.exports = globalThis.DAE;
