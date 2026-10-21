// ZIP writer (stored, no compression): many files in one download without a library.
// PNGs and other packed formats gain nothing from deflate, so "store" keeps it tiny and fast.
DAE_CORE(DAE => {
  const CRC = new Uint32Array(256).map((_, n) => {
    let c = n;
    for(let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });

  class Zip {
    static crc32(bytes) {
      let c = 0xFFFFFFFF;
      for(let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8);
      return (c ^ 0xFFFFFFFF) >>> 0;
    }

    /**
     * @param {Array<{name: string, data: Uint8Array|string}>} files - names may hold folders ("frames/a.png")
     * @returns {Uint8Array} the .zip bytes
     */
    static make(files, date = new Date()) {
      const enc = new TextEncoder();
      const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
      const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
      const parts = [], central = [];
      let offset = 0;
      for(const f of files) {
        const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
        const crc = Zip.crc32(data);
        const head = new DataView(new ArrayBuffer(30));
        head.setUint32(0, 0x04034B50, true);
        head.setUint16(4, 20, true);
        head.setUint16(6, 0x0800, true);          // UTF-8 names
        head.setUint16(10, time, true);
        head.setUint16(12, day, true);
        head.setUint32(14, crc, true);
        head.setUint32(18, data.length, true);
        head.setUint32(22, data.length, true);
        head.setUint16(26, name.length, true);
        parts.push(new Uint8Array(head.buffer), name, data);
        const cen = new DataView(new ArrayBuffer(46));
        cen.setUint32(0, 0x02014B50, true);
        cen.setUint16(4, 20, true);
        cen.setUint16(6, 20, true);
        cen.setUint16(8, 0x0800, true);
        cen.setUint16(12, time, true);
        cen.setUint16(14, day, true);
        cen.setUint32(16, crc, true);
        cen.setUint32(20, data.length, true);
        cen.setUint32(24, data.length, true);
        cen.setUint16(28, name.length, true);
        cen.setUint32(42, offset, true);
        central.push(new Uint8Array(cen.buffer), name);
        offset += 30 + name.length + data.length;
      }
      const size = central.reduce((s, p) => s + p.length, 0);
      const end = new DataView(new ArrayBuffer(22));
      end.setUint32(0, 0x06054B50, true);
      end.setUint16(8, files.length, true);
      end.setUint16(10, files.length, true);
      end.setUint32(12, size, true);
      end.setUint32(16, offset, true);
      const all = [...parts, ...central, new Uint8Array(end.buffer)];
      const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
      let at = 0;
      for(const p of all) { out.set(p, at); at += p.length; }
      return out;
    }
  }

  DAE.Zip = Zip;
});
