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
  enabled = false;

  /** Must be called from a user gesture. */
  async toggle(): Promise<boolean> {
    if (!this.ctx) this.init();
    if (!this.ctx) return false;
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.enabled = !this.enabled;
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
    master.connect(comp).connect(ctx.destination);
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

  /** Level of the ambient bed, 0..1. */
  setWind(level: number) {
    if (!this.ctx || !this.windGain || !this.windFilter) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(level * 0.3, t, 0.4);
    this.windFilter.frequency.setTargetAtTime(500 + level * 1100, t, 0.6);
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
   * A whinny: the real horse call. A descending, heavily vibrato'd source
   * pushed through three sliding formants, with a breath layer and the
   * characteristic amplitude flutter that makes it read as a horse rather
   * than a synth tone.
   */
  whinny(intensity = 1) {
    if (!this.ctx || !this.master || !this.noiseBuffer || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.02;
    const dur = 1.15 + Math.random() * 0.25;
    const out = ctx.createGain();
    out.gain.value = 0.9 * Math.min(1.4, Math.max(0.4, intensity));

    // ---- source: two detuned saws, falling in pitch ----
    const f0 = 720 + Math.random() * 90;
    const f1 = 330 + Math.random() * 60;
    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    oscA.type = "sawtooth";
    oscB.type = "sawtooth";
    for (const [osc, detune] of [[oscA, 0], [oscB, 12]] as const) {
      osc.detune.value = detune;
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f0 * 0.82, t + 0.22);
      osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    }

    // deep vibrato — this is most of what makes it sound equine
    const vib = ctx.createOscillator();
    vib.frequency.value = 21 + Math.random() * 6;
    const vibDepth = ctx.createGain();
    vibDepth.gain.setValueAtTime(30, t);
    vibDepth.gain.linearRampToValueAtTime(75, t + 0.25);
    vib.connect(vibDepth);
    vibDepth.connect(oscA.frequency);
    vibDepth.connect(oscB.frequency);

    // ---- formants: the vowel of the call ----
    const formants: Array<[number, number, number]> = [
      [820, 5.5, 1.0],
      [1450, 7.0, 0.55],
      [2650, 9.0, 0.22],
    ];
    const voice = ctx.createGain();
    voice.gain.value = 0.5;
    for (const [freq, q, gain] of formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.setValueAtTime(freq * 1.12, t);
      bp.frequency.linearRampToValueAtTime(freq * 0.86, t + dur);
      bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = gain;
      voice.connect(bp).connect(g).connect(out);
    }
    // a little raw source so it is not purely resonant
    const dry = ctx.createGain();
    dry.gain.value = 0.06;
    voice.connect(dry).connect(out);
    oscA.connect(voice);
    oscB.connect(voice);

    // ---- breath ----
    const breath = ctx.createBufferSource();
    breath.buffer = this.noiseBuffer;
    breath.playbackRate.value = 0.85;
    const breathBand = ctx.createBiquadFilter();
    breathBand.type = "bandpass";
    breathBand.frequency.setValueAtTime(1900, t);
    breathBand.frequency.linearRampToValueAtTime(900, t + dur);
    breathBand.Q.value = 1.2;
    const breathGain = ctx.createGain();
    breathGain.gain.value = 0.05;
    breath.connect(breathBand).connect(breathGain).connect(out);
    breath.start(t);
    breath.stop(t + dur + 0.1);

    // ---- amplitude: envelope plus the flutter of the call ----
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(0.5, t + 0.07);
    amp.gain.exponentialRampToValueAtTime(0.22, t + 0.45);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const flutter = ctx.createOscillator();
    flutter.frequency.value = 8.5 + Math.random() * 3;
    const flutterDepth = ctx.createGain();
    flutterDepth.gain.setValueAtTime(0.08, t);
    flutterDepth.gain.linearRampToValueAtTime(0.3, t + dur * 0.7);
    flutterDepth.gain.linearRampToValueAtTime(0, t + dur);
    flutter.connect(flutterDepth).connect(amp.gain);
    out.connect(amp);
    amp.connect(this.master);

    oscA.start(t);
    oscB.start(t);
    vib.start(t);
    flutter.start(t);
    const stop = t + dur + 0.05;
    oscA.stop(stop);
    oscB.stop(stop);
    vib.stop(stop);
    flutter.stop(stop);
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
