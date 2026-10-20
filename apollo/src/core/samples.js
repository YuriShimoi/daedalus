// Sample packs. A pack file is a plain script (file:// safe, also require()-able in Node) that does
//   (globalThis.APOLLO_PACKS ??= []).push({ name, title, credit, license, kind, rate, zones: [{ note | row, mu }] })
// where `mu` is base64 of 8-bit mu-law mono audio. collect() decodes every pushed pack.
DAE_CORE(DAE => {
  const MU = new Float32Array(256);
  for(let i = 0; i < 256; i++) {
    const u = ~i & 0xFF;
    const exp = (u >> 4) & 7;
    const mag = ((((u & 0x0F) << 3) + 0x84) << exp) - 0x84;
    MU[i] = (u & 0x80 ? -mag : mag) / 32768;
  }

  function bytes(b64) {
    if(typeof atob === 'function') {
      const s = atob(b64);
      const out = new Uint8Array(s.length);
      for(let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }

  class Samples {
    static packs = {};

    static decode(b64) {
      const b = bytes(b64);
      const out = new Float32Array(b.length);
      for(let i = 0; i < b.length; i++) out[i] = MU[b[i]];
      return out;
    }

    static register(raw) {
      Samples.packs[raw.name] = {
        name: raw.name, title: raw.title ?? raw.name, credit: raw.credit ?? '', license: raw.license ?? '', kind: raw.kind ?? 'melodic',
        zones: raw.zones.map(z => ({ note: z.note, row: z.row, rate: z.rate ?? raw.rate, data: Samples.decode(z.mu) })),
      };
      return Samples.packs[raw.name];
    }

    /** Decodes every pack pushed by pack scripts since the last call. */
    static collect() {
      for(const raw of (globalThis.APOLLO_PACKS ?? []).splice(0)) Samples.register(raw);
      return Samples.packs;
    }

    static list(kind) {
      return Object.values(Samples.packs).filter(p => !kind || p.kind === kind);
    }
  }

  DAE.Samples = Samples;
});
