// WAV encode / decode (PCM 8-bit unsigned or 16-bit) and linear resampling.
DAE_CORE(DAE => {
  class Wav {
    static resample(x, src, dst) {
      if(src === dst) return x;
      const n = Math.max(1, Math.round(x.length * dst / src)), out = new Float32Array(n), r = src / dst;
      for(let i = 0; i < n; i++) {
        const p = i * r, k = Math.floor(p), f = p - k;
        out[i] = (x[k] ?? 0) * (1 - f) + (x[k + 1] ?? x[k] ?? 0) * f;
      }
      return out;
    }

    /** channels: Float32Array[] (1 = mono, 2 = stereo), all the same length. Returns Uint8Array. */
    static encode(channels, rate = 44100, bits = 16) {
      const nc = channels.length, n = channels[0].length, bps = bits / 8;
      const size = n * nc * bps, buf = new ArrayBuffer(44 + size), v = new DataView(buf);
      const str = (o, s) => { for(let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      str(0, 'RIFF'); v.setUint32(4, 36 + size, true); str(8, 'WAVE');
      str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nc, true);
      v.setUint32(24, rate, true); v.setUint32(28, rate * nc * bps, true); v.setUint16(32, nc * bps, true); v.setUint16(34, bits, true);
      str(36, 'data'); v.setUint32(40, size, true);
      let o = 44;
      for(let i = 0; i < n; i++) {
        for(let c = 0; c < nc; c++) {
          const s = Math.max(-1, Math.min(1, channels[c][i]));
          if(bits === 8) v.setUint8(o, Math.round(s * 127 + 128));
          else v.setInt16(o, Math.round(s * 32767), true);
          o += bps;
        }
      }
      return new Uint8Array(buf);
    }

    /** Minimal reader for PCM WAV (tests, CLI). Returns { rate, channels: Float32Array[] }. */
    static decode(bytes) {
      const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let o = 12, fmt = null, data = null;
      while(o + 8 <= v.byteLength) {
        const id = String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3)), len = v.getUint32(o + 4, true);
        if(id === 'fmt ') fmt = { nc: v.getUint16(o + 10, true), rate: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
        if(id === 'data') data = [o + 8, len];
        o += 8 + len + (len & 1);
      }
      if(!fmt || !data) throw new Error('not a PCM wav');
      const bps = fmt.bits / 8, n = Math.floor(data[1] / (bps * fmt.nc));
      const ch = Array.from({ length: fmt.nc }, () => new Float32Array(n));
      for(let i = 0; i < n; i++) {
        for(let c = 0; c < fmt.nc; c++) {
          const p = data[0] + (i * fmt.nc + c) * bps;
          ch[c][i] = fmt.bits === 8 ? (v.getUint8(p) - 128) / 128 : v.getInt16(p, true) / 32768;
        }
      }
      return { rate: fmt.rate, channels: ch };
    }
  }

  DAE.Wav = Wav;
});
