// Project document: song, tracks (each with its own instrument or drum kit), patterns, keyboard template,
// sound effects, mixes and sets. Saved as TOON.
DAE_CORE(DAE => {
  const COLORS = ['#FF79C6', '#8BE9FD', '#BD93F9', '#50FA7B', '#FFB86C', '#F1FA8C', '#FF5555', '#6272A4'];
  const MAX_TRACKS = 8;
  const num = (v, d) => (v === undefined || v === null || v === '' || isNaN(Number(v)) ? d : Number(v));
  const bool = (v, d = false) => (v === undefined || v === null ? d : v === true || v === 'true');

  class Project {
    static COLORS = COLORS;
    static MAX_TRACKS = MAX_TRACKS;

    static nextId(list) {
      return list.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
    }

    static track(p, kind = 'melodic', name) {
      const id = Project.nextId(p.tracks);
      const t = {
        id, name: name ?? (kind === 'drum' ? 'Drums' : `Track ${id}`), color: COLORS[(id - 1) % COLORS.length], kind,
        vol: 0.8, pan: 0, mute: false, solo: false, clips: new Array(p.song.bars).fill(0),
      };
      if(kind === 'drum') t.kit = DAE.Instruments.makeKit();
      else t.inst = DAE.Instruments.make('chip', 'lead');
      return t;
    }

    static pattern(p, trackId, bars = 1) {
      return { id: Project.nextId(p.patterns), track: trackId, bars, notes: [] };
    }

    /** Starter project: one lead, one bass, one drum track with a beat. */
    static create(mode = 'music') {
      const p = {
        app: 'apollo', version: 1, mode,
        level: { music: 'simple', sfx: 'simple' },
        song: { bpm: 120, beatsPerBar: 4, stepsPerBeat: 4, key: 'C', scale: 'minor', bars: 16, loop: { on: true, from: 0, to: 4 }, master: 0.8 },
        tracks: [], patterns: [],
        keyboard: DAE.Keymap.make('FL style'),
        sfx: [], mixes: [], sets: [],
        export: { rate: 44100, bits: 16, normalize: true, format: 'wav' },
      };
      p.tracks.push(Project.track(p, 'melodic', 'Lead'));
      p.tracks.push(Project.track(p, 'melodic', 'Bass'));
      p.tracks.push(Project.track(p, 'drum', 'Drums'));
      p.tracks[1].inst = DAE.Instruments.make('chip', 'bass');
      for(const t of p.tracks) {
        const pat = Project.pattern(p, t.id);
        p.patterns.push(pat);
        if(t.kind === 'drum') {
          for(let s = 0; s < 16; s += 4) pat.notes.push({ step: s, len: 1, pitch: 0, vel: 0.9, cents: 0 });
          for(const s of [4, 12]) pat.notes.push({ step: s, len: 1, pitch: 1, vel: 0.8, cents: 0 });
          for(let s = 2; s < 16; s += 4) pat.notes.push({ step: s, len: 1, pitch: 2, vel: 0.6, cents: 0 });
          t.clips.fill(pat.id, 0, 4);
        }
      }
      return p;
    }

    //#region [ Normalize ]
    /** Fills defaults and fixes types after TOON / JSON decode (TOON keeps strings for some fields). */
    static normalize(raw) {
      const d = Project.create(raw?.mode === 'sfx' ? 'sfx' : 'music');
      const s = raw?.song ?? {};
      const p = {
        app: 'apollo', version: 1, mode: raw?.mode === 'sfx' ? 'sfx' : 'music',
        level: { music: raw?.level?.music === 'full' ? 'full' : 'simple', sfx: raw?.level?.sfx === 'full' ? 'full' : 'simple' },
        song: {
          bpm: Math.min(300, Math.max(20, num(s.bpm, 120))), beatsPerBar: num(s.beatsPerBar, 4), stepsPerBeat: num(s.stepsPerBeat, 4),
          key: DAE.Theory.NAMES.includes(s.key) ? s.key : 'C', scale: DAE.Theory.SCALES[s.scale] ? s.scale : 'minor',
          bars: Math.min(128, Math.max(1, num(s.bars, 16))),
          loop: { on: bool(s.loop?.on, true), from: num(s.loop?.from, 0), to: num(s.loop?.to, 4) }, master: num(s.master, 0.8),
        },
        tracks: [], patterns: [],
        keyboard: DAE.Keymap.normalize(raw?.keyboard),
        sfx: [], mixes: [], sets: [],
        export: { rate: num(raw?.export?.rate, 44100), bits: num(raw?.export?.bits, 16), normalize: bool(raw?.export?.normalize, true), format: raw?.export?.format === 'opus' ? 'opus' : 'wav' },
      };
      const bars = p.song.bars;
      for(const t of (raw?.tracks ?? d.tracks).slice(0, MAX_TRACKS)) {
        const kind = t.kind === 'drum' ? 'drum' : 'melodic';
        const clips = Array.from({ length: bars }, (_, i) => num(t.clips?.[i], 0));
        const tr = { id: num(t.id, Project.nextId(p.tracks)), name: String(t.name ?? 'Track'), color: t.color ?? COLORS[p.tracks.length % 8], kind,
          vol: num(t.vol, 0.8), pan: num(t.pan, 0), mute: bool(t.mute), solo: bool(t.solo), clips };
        if(kind === 'drum') tr.kit = DAE.Instruments.normalizeKit(t.kit);
        else tr.inst = DAE.Instruments.normalize(t.inst);
        p.tracks.push(tr);
      }
      for(const pt of raw?.patterns ?? d.patterns) {
        if(!p.tracks.some(t => t.id === num(pt.track, -1))) continue;
        p.patterns.push({ id: num(pt.id, Project.nextId(p.patterns)), track: num(pt.track, 0), bars: Math.min(8, Math.max(1, num(pt.bars, 1))),
          notes: (pt.notes ?? []).map(n => ({ step: num(n.step, 0), len: Math.max(1, num(n.len, 1)), pitch: num(n.pitch, 60), vel: num(n.vel, 0.8), cents: num(n.cents, 0) })) });
      }
      // clips must point to a pattern of their own track
      for(const t of p.tracks) t.clips = t.clips.map(c => (p.patterns.some(x => x.id === c && x.track === t.id) ? c : 0));
      for(const x of raw?.sfx ?? []) p.sfx.push(DAE.Sfxr.normalize(x));
      for(const m of raw?.mixes ?? []) p.mixes.push({ id: num(m.id, 0), name: String(m.name ?? 'mix'),
        layers: (m.layers ?? []).slice(0, 5).map(l => ({ sfx: num(l.sfx, 0), delay: num(l.delay, 0), vol: num(l.vol, 100) })) });
      for(const st of raw?.sets ?? []) p.sets.push({ id: num(st.id, 0), name: String(st.name ?? 'set'), items: (st.items ?? []).map(Number) });
      return p;
    }
    //#endregion

    static stringify(p) {
      return DAE.Toon.encode(p);
    }

    static parse(text) {
      const t = text.trimStart();
      return Project.normalize(t.startsWith('{') ? JSON.parse(t) : DAE.Toon.decode(text));
    }

    /** Length of a song bar in steps. */
    static barSteps(p) {
      return p.song.beatsPerBar * p.song.stepsPerBeat;
    }

    /** Deletes a pattern and clears the clips that point to it. */
    static removePattern(p, id) {
      p.patterns = p.patterns.filter(x => x.id !== id);
      for(const t of p.tracks) t.clips = t.clips.map(c => (c === id ? 0 : c));
    }

    /** Changes the song length, keeping clips. */
    static setBars(p, bars) {
      p.song.bars = bars;
      for(const t of p.tracks) t.clips = Array.from({ length: bars }, (_, i) => t.clips[i] ?? 0);
      p.song.loop.to = Math.min(p.song.loop.to, bars);
      p.song.loop.from = Math.min(p.song.loop.from, p.song.loop.to - 1);
    }
  }

  DAE.Project = Project;
});
