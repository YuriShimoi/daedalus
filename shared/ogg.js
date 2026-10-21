// Ogg Opus file writer (RFC 7845): ID header, comment header, then the encoder's Opus packets in
// pages with granule positions, so the browser plays and trims it exactly. The packets come from
// WebCodecs AudioEncoder (page side); this part is plain bytes and runs in Node too.
DAE_CORE(DAE => {
  const CRC = new Uint32Array(256);
  for(let i = 0; i < 256; i++) {
    let r = i << 24;
    for(let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04C11DB7 : r << 1;
    CRC[i] = r >>> 0;
  }
  const ascii = s => Uint8Array.from(s, c => c.charCodeAt(0));

  class Ogg {
    static crc(bytes) {
      let c = 0;
      for(const b of bytes) c = ((c << 8) ^ CRC[((c >>> 24) ^ b) & 0xFF]) >>> 0;
      return c;
    }

    /** One page. `segs` = lacing values, `body` = the packet bytes they describe. */
    static page({ flags = 0, granule = 0, serial, seq, segs, body }) {
      const p = new Uint8Array(27 + segs.length + body.length), v = new DataView(p.buffer);
      p.set(ascii('OggS'), 0);
      p[4] = 0;
      p[5] = flags;
      v.setUint32(6, granule % 2 ** 32, true);
      v.setUint32(10, Math.floor(granule / 2 ** 32), true);
      v.setUint32(14, serial, true);
      v.setUint32(18, seq, true);
      p[26] = segs.length;
      p.set(segs, 27);
      p.set(body, 27 + segs.length);
      v.setUint32(22, Ogg.crc(p), true);
      return p;
    }

    static opusHead(channels, preSkip, rate) {
      const h = new Uint8Array(19), v = new DataView(h.buffer);
      h.set(ascii('OpusHead'), 0);
      h[8] = 1;
      h[9] = channels;
      v.setUint16(10, preSkip, true);
      v.setUint32(12, rate, true);
      return h;   // output gain 0, mapping family 0
    }

    static opusTags(vendor = 'Daedalus Hestia') {
      const ven = ascii(vendor), t = new Uint8Array(8 + 4 + ven.length + 4), v = new DataView(t.buffer);
      t.set(ascii('OpusTags'), 0);
      v.setUint32(8, ven.length, true);
      t.set(ven, 12);
      return t;   // 0 user comments
    }

    /**
     * Builds the file.
     * @param {Array<{data: Uint8Array, samples: number}>} packets - Opus packets, samples at 48 kHz each
     * @param {object} o - channels, preSkip (encoder delay at 48 kHz), rate (input rate, info only), length (real samples, trims the end)
     */
    static opus(packets, { channels = 2, preSkip = 312, rate = 48000, length = null, serial = 0x48455354 } = {}) {
      const pages = [];
      let seq = 0;
      const single = (data, flags) => pages.push(Ogg.page({ flags, granule: 0, serial, seq: seq++, segs: Ogg.lacing(data.length), body: data }));
      single(Ogg.opusHead(channels, preSkip, rate), 0x02);
      single(Ogg.opusTags(), 0);
      const total = packets.reduce((a, p) => a + p.samples, 0), end = preSkip + Math.min(total, length ?? total);
      let segs = [], body = [], granule = preSkip, bytes = 0;
      const flush = last => {
        if(!segs.length) return;
        const all = new Uint8Array(bytes);
        let o = 0;
        for(const b of body) { all.set(b, o); o += b.length; }
        pages.push(Ogg.page({ flags: last ? 0x04 : 0, granule: Math.min(granule, end), serial, seq: seq++, segs: Uint8Array.from(segs), body: all }));
        segs = []; body = []; bytes = 0;
      };
      packets.forEach((p, i) => {
        const lace = Ogg.lacing(p.data.length);
        if(segs.length + lace.length > 255) flush(false);
        segs.push(...lace);
        body.push(p.data);
        bytes += p.data.length;
        granule += p.samples;
        if(segs.length >= 200 || i === packets.length - 1) flush(i === packets.length - 1);
      });
      if(!packets.length) pages.push(Ogg.page({ flags: 0x04, granule: preSkip, serial, seq: seq++, segs: new Uint8Array(0), body: new Uint8Array(0) }));
      const out = new Uint8Array(pages.reduce((a, p) => a + p.length, 0));
      let o = 0;
      for(const p of pages) { out.set(p, o); o += p.length; }
      return out;
    }

    /** Lacing values for one packet (255s, then the rest; a multiple of 255 ends with a 0). */
    static lacing(n) {
      const out = [];
      while(n >= 255) { out.push(255); n -= 255; }
      out.push(n);
      return out;
    }

    /** Reads pages back (tests): [{ flags, granule, seq, packets: [Uint8Array] }]. */
    static read(bytes) {
      const pages = [], v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let o = 0;
      while(o + 27 <= bytes.length) {
        const n = bytes[o + 26], segs = bytes.subarray(o + 27, o + 27 + n);
        let pos = o + 27 + n, cur = [];
        const packets = [];
        for(const s of segs) {
          cur.push(bytes.subarray(pos, pos + s));
          pos += s;
          if(s < 255) { packets.push(Uint8Array.from(cur.flatMap(c => [...c]))); cur = []; }
        }
        const page = bytes.slice(o, pos);
        page[22] = page[23] = page[24] = page[25] = 0;
        pages.push({ flags: bytes[o + 5], granule: v.getUint32(o + 6, true) + v.getUint32(o + 10, true) * 2 ** 32, seq: v.getUint32(o + 18, true),
          packets, crcOk: Ogg.crc(page) === v.getUint32(o + 22, true) });
        o = pos;
      }
      return pages;
    }
  }

  DAE.Ogg = Ogg;
});
