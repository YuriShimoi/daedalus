// Keyboard templates: physical keys (KeyboardEvent.code, layout independent) -> notes with per-key tuning.
// Template: { name, root, octDown, octUp, keys: [{ code, note, cents, hz }] }; hz (when set) overrides note + cents.
DAE_CORE(DAE => {
  const FL_LOWER = ['KeyZ', 'KeyS', 'KeyX', 'KeyD', 'KeyC', 'KeyV', 'KeyG', 'KeyB', 'KeyH', 'KeyN', 'KeyJ', 'KeyM'];
  const FL_UPPER = ['KeyQ', 'Digit2', 'KeyW', 'Digit3', 'KeyE', 'KeyR', 'Digit5', 'KeyT', 'Digit6', 'KeyY', 'Digit7', 'KeyU',
    'KeyI', 'Digit9', 'KeyO', 'Digit0', 'KeyP'];
  // one row: white keys on the home row, black keys above (C .. F of the next octave)
  const ONE_ROW = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ',
    'KeyK', 'KeyO', 'KeyL', 'KeyP', 'Semicolon', 'Quote'];

  const LABELS = { Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", Minus: '-', Equal: '=',
    BracketLeft: '[', BracketRight: ']', Backslash: '\\', Backquote: '`', Space: '␣' };

  class Keymap {
    static BUILTIN = ['FL style', 'One row'];

    /** A fresh copy of a built-in template. */
    static make(name = 'FL style', root = 48) {
      const codes = name === 'One row' ? ONE_ROW : [...FL_LOWER, ...FL_UPPER];
      const oct = name === 'One row' ? ['KeyZ', 'KeyX'] : ['Minus', 'Equal'];
      return {
        name, root, octDown: oct[0], octUp: oct[1],
        keys: codes.map((code, i) => ({ code, note: root + i, cents: 0, hz: 0 })),
      };
    }

    static label(code) {
      if(!code) return '';
      return LABELS[code] ?? code.replace(/^Key|^Digit|^Numpad/, '');
    }

    static find(tpl, code) {
      return tpl.keys.findIndex(k => k.code === code);
    }

    /** Frequency of key i with an octave shift in semitones. */
    static hz(tpl, i, shift = 0) {
      const k = tpl.keys[i];
      return k.hz > 0 ? k.hz * 2 ** (shift / 12) : DAE.Theory.hz(k.note + shift, k.cents);
    }

    /** Binds `code` to key i; the code is taken from any other key first. */
    static bind(tpl, i, code) {
      for(const k of tpl.keys) if(k.code === code) k.code = '';
      tpl.keys[i].code = code;
    }

    static equal(tpl) {
      for(const k of tpl.keys) { k.cents = 0; k.hz = 0; }
    }

    /** 5-limit just intonation around a root pitch class. */
    static just(tpl, rootPc = 0) {
      for(const k of tpl.keys) {
        k.hz = 0;
        k.cents = DAE.Theory.JUST[((k.note - rootPc) % 12 + 12) % 12];
      }
    }

    /** Fills missing fields of a loaded template. */
    static normalize(t) {
      const base = Keymap.make(t?.name === 'One row' ? 'One row' : 'FL style', t?.root ?? 48);
      if(!t || !Array.isArray(t.keys)) return base;
      return {
        name: String(t.name ?? 'custom'), root: Number(t.root ?? 48), octDown: t.octDown ?? base.octDown, octUp: t.octUp ?? base.octUp,
        keys: t.keys.map((k, i) => ({ code: k.code ?? '', note: Number(k.note ?? base.root + i), cents: Number(k.cents ?? 0), hz: Number(k.hz ?? 0) })),
      };
    }
  }

  DAE.Keymap = Keymap;
});
