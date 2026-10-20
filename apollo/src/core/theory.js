// Notes, scales and tuning (MIDI numbers, cents, Hz).
DAE_CORE(DAE => {
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLATS = { Db: 1, Eb: 3, Gb: 6, Ab: 8, Bb: 10 };
  const SCALES = {
    major:     [0, 2, 4, 5, 7, 9, 11],
    minor:     [0, 2, 3, 5, 7, 8, 10],
    penta:     [0, 2, 4, 7, 9],
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  };
  // 5-limit just intonation, cents away from equal temperament per interval from the root
  const JUST = [0, 11.73, 3.91, 15.64, -13.69, -1.96, -9.78, 1.96, 13.69, -15.64, 17.60, -11.73];

  class Theory {
    static NAMES = NAMES;
    static SCALES = SCALES;
    static JUST = JUST;

    /** 60 -> 'C4' */
    static name(midi) {
      return NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
    }

    /** 'C4' / 'C#4' / 'Db4' -> MIDI number, or NaN */
    static parse(text) {
      const m = /^([A-G])([#b]?)(-?\d+)$/.exec(String(text).trim());
      if(!m) return NaN;
      const pc = m[2] === 'b' ? FLATS[m[1] + 'b'] ?? NAMES.indexOf(m[1]) - 1 : NAMES.indexOf(m[1] + m[2]);
      return (Number(m[3]) + 1) * 12 + pc;
    }

    static hz(midi, cents = 0) {
      return 440 * 2 ** ((midi - 69 + cents / 100) / 12);
    }

    static keyIndex(key) {
      const i = NAMES.indexOf(key);
      return i < 0 ? 0 : i;
    }

    static inScale(midi, key, scale) {
      const steps = SCALES[scale] ?? SCALES.chromatic;
      return steps.includes(((midi - Theory.keyIndex(key)) % 12 + 12) % 12);
    }

    static isBlack(midi) {
      return [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
    }
  }

  DAE.Theory = Theory;
});
