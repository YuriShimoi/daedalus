// Opus audio in an Ogg file, encoded by the browser (WebCodecs AudioEncoder) and packed by DAE.Ogg
// (shared/ogg.js). Opus runs at 48 kHz: give it 48 kHz samples. Page only (Node has no AudioEncoder).
(DAE => {
  class Opus {
    static RATE = 48000;

    static async supported(channels = 2, bitrate = 128000) {
      if(typeof AudioEncoder === 'undefined') return false;
      try { return (await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: channels, bitrate })).supported; }
      catch { return false; }
    }

    /**
     * Float channels at 48 kHz -> Ogg Opus bytes.
     * @param {Float32Array[]} chs - 1 (mono) or 2 (stereo) channels of equal length
     */
    static async encode(chs, { bitrate = chs.length > 1 ? 128000 : 96000 } = {}) {
      const n = chs.length, len = chs[0].length, packets = [];
      let preSkip = 312, fail = null;
      const enc = new AudioEncoder({
        output: (chunk, meta) => {
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          packets.push({ data, samples: Math.round((chunk.duration ?? 20000) * 48000 / 1e6) });
          const desc = meta?.decoderConfig?.description;   // OpusHead: the encoder's own pre-skip
          if(desc && desc.byteLength >= 12) preSkip = new DataView(desc instanceof ArrayBuffer ? desc : desc.buffer, desc.byteOffset ?? 0).getUint16(10, true);
        },
        error: e => { fail = e; },
      });
      enc.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: n, bitrate });
      const N = 4800;
      for(let i = 0; i < len; i += N) {
        const k = Math.min(N, len - i), planar = new Float32Array(k * n);
        chs.forEach((c, j) => planar.set(c.subarray(i, i + k), j * k));
        const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: k, numberOfChannels: n, timestamp: Math.round(i / 48 * 1000), data: planar });
        enc.encode(ad);
        ad.close();
        if(enc.encodeQueueSize > 40) await new Promise(r => setTimeout(r, 0));
      }
      await enc.flush();
      enc.close();
      if(fail) throw fail;
      return DAE.Ogg.opus(packets, { channels: n, preSkip, rate: 48000, length: len });
    }
  }

  DAE.Opus = Opus;
})(globalThis.DAE ??= {});
if(typeof module === 'object') module.exports = globalThis.DAE;
