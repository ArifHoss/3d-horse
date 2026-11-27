/**
 * Sound, synthesised: hoofbeats from filtered noise, wind beds, and the odd
 * nicker. No samples — every bit of it is generated at runtime.
 */

export class StableAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private lastWind = 0;
  /** the ambience bed is only on when sound was explicitly switched on */
  private ambienceOn = false;
  /** wind is muted while a whinny plays */
  private duckUntil = 0;
  enabled = false;

  /** Must be called from a user gesture. */
  async toggle(): Promise<boolean> {
    if (!this.ctx) this.init();
    if (!this.ctx) return false;
    if (this.ctx.state === "suspended") await this.ctx.resume();
    // a voice-only session: the first click turns the ambience bed on
    if (this.enabled && !this.ambienceOn) {
      this.ambienceOn = true;
      this.setWind(this.lastWind);
      return true;
    }
    this.enabled = !this.enabled;
    this.ambienceOn = this.enabled;
    if (this.master) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(this.enabled ? 0.9 : 0, this.ctx.currentTime, 0.15);
    }
    return this.enabled;
  }

  private init() {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    // keep overlapping hoofbeats from clipping
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.18;
    // a small synthetic room so calls and hooves sit in the field rather
    // than in a vacuum
    const convolver = ctx.createConvolver();
    convolver.buffer = this.makeImpulse(ctx, 1.5);
    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    master.connect(comp);
    master.connect(convolver);
    convolver.connect(wet).connect(comp);
    comp.connect(ctx.destination);
    this.master = master;
    this.compressor = comp;

    // 1 s of white noise, reused for every impact
    const len = Math.floor(ctx.sampleRate * 1.0);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;

    // wind bed: brown-ish noise through a slowly moving low-pass
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    filter.Q.value = 0.5;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    // a slow tremolo so the bed breathes like wind rather than hiss
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.35;
    const trem = ctx.createGain();
    trem.gain.value = 0.75;
    lfo.connect(lfoGain).connect(trem.gain);
    src.connect(filter).connect(trem).connect(gain).connect(master);
    src.start();
    lfo.start();
    this.windGain = gain;
    this.windFilter = filter;
  }

  /** A short decaying-noise impulse: cheap outdoor reverb. */
  private makeImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // fast early decay, long soft tail, slightly dark
        const env = Math.pow(1 - t, 2.6) * Math.exp(-t * 2.2);
        data[i] = (Math.random() * 2 - 1) * env;
      }
    }
    return buf;
  }

  /** Level of the ambient bed, 0..1. */
  setWind(level: number) {
    if (!this.ctx || !this.windGain || !this.windFilter) return;
    this.lastWind = level;
    const t = this.ctx.currentTime;
    const ducked = t < this.duckUntil;
    const target = this.ambienceOn && !ducked ? level * 0.3 : 0;
    this.windGain.gain.setTargetAtTime(target, t, ducked ? 0.08 : 0.4);
    this.windFilter.frequency.setTargetAtTime(500 + level * 1100, t, 0.6);
  }

  /**
   * Turn on just enough of the audio system to speak: the context and the
   * master gain, but not the wind bed. Used by the whinny, so clicking the
   * horse gives you a horse and not a gale.
   */
  async ensureVoice(): Promise<boolean> {
    if (!this.ctx) this.init();
    if (!this.ctx) return false;
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.enabled = true;
    this.ambienceOn = false;
    if (this.master) {
      this.master.gain.setTargetAtTime(0.9, this.ctx.currentTime, 0.1);
    }
    this.setWind(this.lastWind);
    return true;
  }

  get ambienceEnabled() {
    return this.ambienceOn;
  }

  /**
   * One hoof hitting the ground. `strength` scales volume and brightness,
   * `leg` just spreads the timing so four legs don't sound identical.
   */
  hoof(strength: number, leg = 0, pan = 0) {
    if (!this.ctx || !this.master || !this.noiseBuffer || !this.enabled) return;
    const ctx = this.ctx;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    const t = ctx.currentTime + 0.001;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.2;

    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 420 + leg * 40 + Math.random() * 120;
    band.Q.value = 1.1;

    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 120;

    const env = ctx.createGain();
    const peak = 0.1 + strength * 0.34;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.10 + strength * 0.05);

    src.connect(band).connect(hp).connect(env).connect(panner).connect(this.master);
    src.start(t);
    src.stop(t + 0.22);

    // low thump: the mass of the horse landing
    const osc = ctx.createOscillator();
    osc.type = "sine";
    const f0 = 92 + leg * 6 + Math.random() * 12;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + 0.12);
    const oenv = ctx.createGain();
    oenv.gain.setValueAtTime(0.0001, t);
    oenv.gain.exponentialRampToValueAtTime(0.06 + strength * 0.26, t + 0.008);
    oenv.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(oenv).connect(panner);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  /**
   * A whinny. Built from what actually makes a neigh sound equine:
   * a harmonic-rich glottal source gliding down, a deep and *slowing*
   * vibrato, three formants sliding through the "ih" vowel, breath noise,
   * and an amplitude flutter that grows into the heh-heh-heh tail.
   */
  whinny(intensity = 1) {
    if (!this.ctx || !this.master || !this.noiseBuffer || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.02;
    const dur = 1.3 + Math.random() * 0.25;
    this.duckUntil = t + dur + 0.4;
    this.setWind(this.lastWind);
    this.synthWhinny(ctx, this.master, t, dur, intensity);
  }

  /** Render one whinny offline, for testing the synthesis. */
  async renderWhinnyOffline(sampleRate = 44100, seconds = 1.9): Promise<Float32Array | null> {
    const Ctx = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
    if (!Ctx) return null;
    const ctx: OfflineAudioContext = new Ctx(1, Math.floor(sampleRate * seconds), sampleRate);
    // the noise buffer has to belong to this context
    const len = Math.floor(sampleRate * 1.0);
    const buffer = ctx.createBuffer(1, len, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
    const dry = ctx.createGain();
    dry.gain.value = 1;
    dry.connect(ctx.destination);
    this.synthWhinny(ctx, dry, 0.02, 1.35, 1);
    const rendered = await ctx.startRendering();
    return rendered.getChannelData(0);
  }

  private static stopAt(t: number, dur: number) { return t + dur + 0.02; }

  private synthWhinny(ctx: BaseAudioContext, dest: AudioNode, t: number, dur: number, intensity: number) {
    const out = ctx.createGain();
    out.gain.value = 0.85 * Math.min(1.4, Math.max(0.4, intensity));
    out.connect(dest);

    // ---- glottal source: a harmonic wave, not a raw saw ----
    const harmonics = 28;
    const real = new Float32Array(harmonics);
    const imag = new Float32Array(harmonics);
    for (let n = 1; n < harmonics; n++) {
      // vocal-cord-like spectrum: energy falls off, with a slight tilt
      imag[n] = Math.pow(n, -1.05) * (n % 2 === 0 ? 0.55 : 1);
    }
    const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });

    const f0 = 690 + Math.random() * 90;
    const fMid = 560 + Math.random() * 70;
    const fEnd = 300 + Math.random() * 50;

    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    oscA.setPeriodicWave(wave);
    oscB.setPeriodicWave(wave);
    oscB.detune.value = 9;
    for (const osc of [oscA, oscB]) {
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(fMid, t + 0.13);
      osc.frequency.exponentialRampToValueAtTime(fEnd, t + dur * 0.82);
      osc.frequency.exponentialRampToValueAtTime(fEnd * 0.9, t + dur);
    }

    // deep vibrato that slows and deepens — the signature of a neigh
    const vib = ctx.createOscillator();
    vib.frequency.setValueAtTime(24 + Math.random() * 5, t);
    vib.frequency.linearRampToValueAtTime(13, t + dur);
    const vibDepth = ctx.createGain();
    vibDepth.gain.setValueAtTime(26, t);
    vibDepth.gain.linearRampToValueAtTime(34, t + 0.3);
    vibDepth.gain.linearRampToValueAtTime(58, t + dur * 0.85);
    vib.connect(vibDepth).connect(oscA.frequency);
    vibDepth.connect(oscB.frequency);

    // slow pitch jitter: no animal holds a pure tone
    const jitter = ctx.createOscillator();
    jitter.type = "triangle";
    jitter.frequency.value = 5.5 + Math.random() * 3;
    const jitterDepth = ctx.createGain();
    jitterDepth.gain.value = 9;
    jitter.connect(jitterDepth).connect(oscA.frequency);
    jitterDepth.connect(oscB.frequency);

    // a subharmonic for the creaky onset — real neighs start hoarse
    const sub = ctx.createOscillator();
    sub.type = "sawtooth";
    sub.frequency.setValueAtTime(f0 * 0.5, t);
    sub.frequency.exponentialRampToValueAtTime(fMid * 0.5, t + 0.13);
    sub.frequency.exponentialRampToValueAtTime(fEnd * 0.5, t + dur * 0.82);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.5, t);
    subGain.gain.linearRampToValueAtTime(0.0, t + 0.35);

    const source = ctx.createGain();
    source.gain.value = 0.42;
    oscA.connect(source);
    oscB.connect(source);
    sub.connect(subGain).connect(source);

    // roughness: a little noise modulating the source keeps it from sounding
    // like a pure tone
    if (this.noiseBuffer) {
      const rough = ctx.createBufferSource();
      rough.buffer = this.noiseBuffer;
      rough.loop = true;
      const roughBand = ctx.createBiquadFilter();
      roughBand.type = "bandpass";
      roughBand.frequency.value = f0 * 2;
      roughBand.Q.value = 2.2;
      const roughGain = ctx.createGain();
      roughGain.gain.value = 0.14;
      rough.connect(roughBand).connect(roughGain).connect(source);
      rough.start(t);
      rough.stop(t + dur + 0.05);
    }

    // ---- formants: the "ih" of a neigh, sliding shut ----
    const formants: Array<[number, number, number, number]> = [
      [1080, 720, 4.2, 1.0],
      [2100, 1480, 6.0, 0.55],
      [3100, 2350, 8.0, 0.2],
    ];
    for (const [fStart, fStop, q, gain] of formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.setValueAtTime(fStart, t);
      bp.frequency.linearRampToValueAtTime(fStop, t + dur);
      bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = gain;
      source.connect(bp).connect(g).connect(out);
    }
    // a little dry source so the call has body
    const dry = ctx.createGain();
    dry.gain.value = 0.1;
    source.connect(dry).connect(out);

    // ---- breath ----
    if (this.noiseBuffer) {
      const breath = ctx.createBufferSource();
      breath.buffer = this.noiseBuffer;
      breath.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.setValueAtTime(2400, t);
      band.frequency.linearRampToValueAtTime(1200, t + dur);
      band.Q.value = 0.9;
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.0, t);
      bg.gain.linearRampToValueAtTime(0.075, t + 0.08);
      bg.gain.linearRampToValueAtTime(0.02, t + dur);
      breath.connect(band).connect(bg).connect(out);
      breath.start(t);
      breath.stop(t + dur + 0.05);
    }

    // ---- amplitude: envelope, then the heh-heh-heh flutter ----
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(0.85, t + 0.045);
    amp.gain.exponentialRampToValueAtTime(0.5, t + 0.5);
    amp.gain.exponentialRampToValueAtTime(0.28, t + dur * 0.85);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    out.connect(amp).connect(dest);

    const flutter = ctx.createOscillator();
    flutter.frequency.setValueAtTime(8, t);
    flutter.frequency.linearRampToValueAtTime(13, t + dur);
    const flutterDepth = ctx.createGain();
    flutterDepth.gain.setValueAtTime(0.02, t);
    flutterDepth.gain.linearRampToValueAtTime(0.085, t + dur * 0.7);
    flutterDepth.gain.linearRampToValueAtTime(0, t + dur);
    flutter.connect(flutterDepth).connect(amp.gain);
    // a slow second ripple so the flutter is not perfectly periodic
    const drift = ctx.createOscillator();
    drift.frequency.value = 3.1 + Math.random() * 1.4;
    const driftDepth = ctx.createGain();
    driftDepth.gain.value = 0.035;
    drift.connect(driftDepth).connect(amp.gain);
    drift.start(t);
    drift.stop(StableAudio.stopAt(t, dur));

    const stop = t + dur + 0.02;
    oscA.start(t); oscB.start(t); vib.start(t); jitter.start(t); flutter.start(t);
    sub.start(t);
    oscA.stop(stop); oscB.stop(stop); vib.stop(stop); jitter.stop(stop); flutter.stop(stop);
    sub.stop(stop);
  }

  /** A nicker: a low, wobbling vowel-ish tone. */
  nicker() {
    if (!this.ctx || !this.master || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.02;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.linearRampToValueAtTime(118, t + 0.45);

    const formant = ctx.createBiquadFilter();
    formant.type = "bandpass";
    formant.frequency.setValueAtTime(700, t);
    formant.frequency.linearRampToValueAtTime(520, t + 0.45);
    formant.Q.value = 3.2;

    const trem = ctx.createGain();
    trem.gain.value = 1;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 26;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.4;
    lfo.connect(lfoGain).connect(trem.gain);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.06, t + 0.06);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);

    osc.connect(formant).connect(trem).connect(env).connect(this.master);
    lfo.start(t);
    osc.start(t);
    osc.stop(t + 0.55);
    lfo.stop(t + 0.55);
  }
}
