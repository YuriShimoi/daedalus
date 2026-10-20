// Live audio. The Engine runs in an AudioWorklet built from a data: URL (file:// safe: every core body is
// re-run inside the worklet). Fallback: the same Engine on the main thread through a ScriptProcessor.
class Audio {
  static ctx = null;
  static node = null;
  static engine = null;   // main-thread engine (fallback only)
  static mode = '';
  static onStatus = null;
  static #ready = null;
  static #sfxSrc = null;

  /** Starts audio on the first user gesture; later calls return the same promise. */
  static init() {
    return Audio.#ready ??= (async () => {
      const ctx = Audio.ctx = new AudioContext({ latencyHint: 'interactive' });
      try {
        const main = function(DAE) {
          class ApolloProcessor extends AudioWorkletProcessor {
            constructor() {
              super();
              this.e = new DAE.Engine(sampleRate);
              this.n = 0;
              this.port.onmessage = m => this.e.handle(m.data);
            }
            process(inputs, outputs) {
              const [L, R] = outputs[0];
              this.e.process(L, R ?? new Float32Array(L.length), L.length);
              if((this.n += L.length) >= sampleRate / 30) { this.n = 0; this.port.postMessage(this.e.status()); }
              return true;
            }
          }
          registerProcessor('apollo', ApolloProcessor);
        };
        // a data: URL, not a Blob: on file:// a blob URL has a null origin and the worklet refuses it
        await ctx.audioWorklet.addModule('data:text/javascript;charset=utf-8,' + encodeURIComponent(DAE_CORE.workerSource(main.toString())));
        Audio.node = new AudioWorkletNode(ctx, 'apollo', { numberOfInputs: 0, outputChannelCount: [2] });
        Audio.node.port.onmessage = m => Audio.onStatus?.(m.data);
        Audio.mode = 'worklet';
      }
      catch(err) {
        console.warn('Apollo: AudioWorklet unavailable, using ScriptProcessor', err);
        const e = Audio.engine = new DAE.Engine(ctx.sampleRate);
        const node = Audio.node = ctx.createScriptProcessor(1024, 0, 2);
        let n = 0;
        node.onaudioprocess = ev => {
          const out = ev.outputBuffer;
          e.process(out.getChannelData(0), out.getChannelData(1), out.length);
          if((n += out.length) >= ctx.sampleRate / 30) { n = 0; Audio.onStatus?.(e.status()); }
        };
        Audio.mode = 'script';
      }
      Audio.node.connect(ctx.destination);
      // packs: decoded once here, sent as Float32Arrays (the worklet has no atob)
      Audio.send({ t: 'packs', packs: DAE.Samples.packs });
      return ctx;
    })();
  }

  static get ready() { return !!Audio.node; }

  static send(msg) {
    if(!Audio.node) return;
    if(Audio.mode === 'worklet') Audio.node.port.postMessage(msg);
    else Audio.engine.handle(msg);
  }

  /** Whole project (re-compiles the song). */
  static project(p) {
    Audio.send({ t: 'project', p: JSON.parse(JSON.stringify(p)) });
  }

  /** Mixer-only change (volume, pan, mute, solo, master): no re-compile. */
  static mix(p) {
    Audio.send({ t: 'mix', p: JSON.parse(JSON.stringify(p)) });
  }

  static async resume() {
    await Audio.init();
    if(Audio.ctx.state !== 'running') await Audio.ctx.resume();
  }

  /** One-shot playback of a rendered mono buffer (SFX), optionally pitched by semitones. */
  static async playBuffer(data, rate, semis = 0, gain = 0.8) {
    await Audio.resume();
    if(!data.length) return;
    try { Audio.#sfxSrc?.stop(); } catch {}
    const buf = Audio.ctx.createBuffer(1, data.length, rate);
    buf.copyToChannel(data, 0);
    const src = Audio.ctx.createBufferSource(), g = Audio.ctx.createGain();
    src.buffer = buf;
    src.playbackRate.value = 2 ** (semis / 12);
    g.gain.value = gain;
    src.connect(g).connect(Audio.ctx.destination);
    src.start();
    Audio.#sfxSrc = src;
  }
}
