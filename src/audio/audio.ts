import { settings } from '../ui/settings';

/**
 * Every sound in the game, synthesised at runtime.
 *
 * There are no audio files on purpose: the whole palette is oscillators and one
 * shared noise buffer, which keeps the download at zero bytes and lets a cue be
 * tuned by changing a number rather than re-exporting a wav. The trade is that
 * everything has to be built out of envelopes — so each cue below is described
 * by what it is imitating, because the code alone won't tell you.
 *
 * Browsers refuse to start an AudioContext until the user has interacted with
 * the page, so nothing here allocates until `unlock()` is called from a real
 * click. Every cue is a no-op before that, and a no-op if the context died.
 */

/** A cue's position in the room, used for stereo placement. */
export interface At {
  x?: number;
  z?: number;
}

/** Arena half-width, roughly. Used to map world x onto the stereo field. */
const PAN_SCALE = 16;

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  /** Live voice count, so a screen full of bolts can't stall the audio thread. */
  private voices = 0;
  private static MAX_VOICES = 28;

  /** Last start time per cue, to collapse the duplicates a single frame emits. */
  private lastAt = new Map<string, number>();

  /** Drone nodes, kept so intensity can be pushed at them each frame. */
  private drone: {
    filter: BiquadFilterNode;
    gain: GainNode;
    beat: GainNode;
    /** Every oscillator, so stopping the bed actually stops it. */
    sources: OscillatorNode[];
  } | null = null;
  private intensity = 0;

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /**
   * Called from a real user gesture. Safe to call repeatedly — a tab that has
   * been backgrounded suspends the context, and the next click resumes it.
   */
  unlock() {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
      } catch {
        return;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.connect(this.master);
      this.musicGain = this.ctx.createGain();
      this.musicGain.connect(this.master);

      // One second of white noise, shared by every percussive cue. Allocating a
      // buffer per hit is what makes naive web audio stutter.
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.applyVolumes();
  }

  /** Push the current settings into the graph. Cheap; call it whenever they change. */
  applyVolumes() {
    if (!this.ctx || !this.sfxGain || !this.musicGain) return;
    const t = this.ctx.currentTime;
    this.sfxGain.gain.setTargetAtTime(settings.sfxVolume, t, 0.05);
    this.musicGain.gain.setTargetAtTime(settings.musicVolume * 0.5, t, 0.2);
  }

  // ------------------------------------------------------------- primitives

  /**
   * Stereo placement from a world position. Deliberately gentle: this camera
   * sees the whole arena, so a hard-panned hit would sound like it happened off
   * screen when it is plainly visible.
   */
  private panner(at?: At) {
    if (!this.ctx) return null;
    const p = this.ctx.createStereoPanner();
    p.pan.value = at?.x === undefined ? 0 : clamp(at.x / PAN_SCALE, -1, 1) * 0.65;
    return p;
  }

  /** Route a voice out through panning and the sfx bus, and count it. */
  private out(node: AudioNode, at: At | undefined, until: number) {
    if (!this.ctx || !this.sfxGain) return;
    const pan = this.panner(at);
    if (pan) {
      node.connect(pan);
      pan.connect(this.sfxGain);
    } else {
      node.connect(this.sfxGain);
    }
    this.voices++;
    const ms = Math.max(0, (until - this.ctx.currentTime) * 1000) + 60;
    setTimeout(() => {
      this.voices--;
      try {
        node.disconnect();
        pan?.disconnect();
      } catch {
        /* already torn down */
      }
    }, ms);
  }

  /** A pitched body: the "thump" half of any impact. */
  private tone(
    freq: number,
    dur: number,
    gain: number,
    type: OscillatorType = 'sine',
    at?: At,
    bend = 0
  ) {
    if (!this.ctx || this.voices > Audio.MAX_VOICES) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (bend) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * bend), t + dur);
    const g = this.ctx.createGain();
    // Instant attack, exponential tail: the shape of everything that is struck.
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    this.out(g, at, t + dur);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** A filtered noise burst: the "texture" half — cloth, grit, sparks, breath. */
  private hiss(
    dur: number,
    gain: number,
    freq: number,
    q: number,
    type: BiquadFilterType = 'bandpass',
    at?: At,
    sweepTo = 0
  ) {
    if (!this.ctx || !this.noise || this.voices > Audio.MAX_VOICES) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 1;
    // Start at a random offset so repeated hits never phase into a tone.
    const offset = Math.random() * 0.8;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    this.out(g, at, t + dur);
    src.start(t, offset, dur + 0.05);
    src.stop(t + dur + 0.05);
  }

  /**
   * Collapse cues that fire many times in one frame. A five-bolt volley should
   * sound like one heavy release, not five copies phasing against each other.
   */
  private throttle(key: string, ms: number) {
    if (!this.ctx) return true;
    const now = this.ctx.currentTime * 1000;
    const last = this.lastAt.get(key) ?? -1e9;
    if (now - last < ms) return true;
    this.lastAt.set(key, now);
    return false;
  }

  // ------------------------------------------------------------------ cues

  /**
   * Play a named cue. Unknown names are ignored rather than thrown — the name
   * travels over the wire to guests, and a version mismatch must not crash a
   * client mid-run.
   */
  play(cue: string, at?: At, power = 1) {
    if (!this.ready) return;
    switch (cue) {
      // --- player attacks ---------------------------------------------------
      case 'swing':
        // Air moving around a blade: noise swept downward, no pitch at all.
        if (this.throttle('swing', 40)) return;
        this.hiss(0.17, 0.09 * power, 2600, 0.9, 'bandpass', at, 700);
        break;
      case 'swingHeavy':
        if (this.throttle('swing', 40)) return;
        this.hiss(0.3, 0.16, 1900, 0.8, 'bandpass', at, 380);
        this.tone(150, 0.22, 0.08, 'triangle', at, 0.5);
        break;
      case 'bolt':
        // Crossbow: the string's snap, then the wooden knock of the stock.
        if (this.throttle('bolt', 45)) return;
        this.hiss(0.07, 0.16, 3000, 3, 'bandpass', at, 1200);
        this.tone(190, 0.09, 0.13, 'square', at, 0.55);
        break;
      case 'orb':
        this.tone(320, 0.28, 0.1, 'sine', at, 2.1);
        this.hiss(0.22, 0.05, 900, 1.2, 'lowpass', at, 2400);
        break;
      case 'cast':
        this.tone(520, 0.3, 0.11, 'triangle', at, 2.4);
        this.hiss(0.16, 0.05, 2200, 1.5, 'bandpass', at);
        break;
      case 'dash':
        this.hiss(0.22, 0.1, 1400, 0.7, 'bandpass', at, 260);
        break;
      case 'step':
        // Deliberately near-subliminal. A step you consciously hear becomes
        // maddening within a minute of holding W.
        this.hiss(0.05, 0.028 * power, 480, 1.6, 'lowpass', at, 200);
        break;

      // --- contact ----------------------------------------------------------
      case 'hit':
        // Meat and armour: a short body plus grit. Power scales both.
        if (this.throttle('hit', 28)) return;
        this.tone(110 + power * 30, 0.1, 0.13 * power, 'triangle', at, 0.45);
        this.hiss(0.07, 0.1 * power, 1800, 1.4, 'bandpass', at, 700);
        break;
      case 'crit':
        this.tone(880, 0.12, 0.1, 'square', at, 1.6);
        this.tone(120, 0.16, 0.16, 'triangle', at, 0.4);
        this.hiss(0.1, 0.13, 2600, 1.2, 'bandpass', at, 800);
        break;
      case 'kill':
        this.tone(90, 0.34, 0.17, 'triangle', at, 0.32);
        this.hiss(0.3, 0.12, 700, 0.8, 'lowpass', at, 160);
        break;
      case 'hurt':
        // The one cue that is never panned: it happened to you, not over there.
        this.tone(196, 0.24, 0.2, 'sawtooth', undefined, 0.55);
        this.hiss(0.2, 0.12, 800, 0.9, 'lowpass');
        break;

      // --- statuses ---------------------------------------------------------
      case 'shock':
        if (this.throttle('shock', 60)) return;
        this.tone(1400, 0.1, 0.09, 'square', at, 0.35);
        this.hiss(0.12, 0.08, 4200, 2.5, 'bandpass', at, 1800);
        break;
      case 'doom':
        // The fuse landing: a low, dry knock with no tail.
        this.tone(70, 0.5, 0.22, 'sine', at, 0.4);
        this.hiss(0.34, 0.16, 500, 0.7, 'lowpass', at, 90);
        break;
      case 'weak':
        this.tone(300, 0.26, 0.06, 'sine', at, 0.5);
        break;

      // --- big moments ------------------------------------------------------
      case 'call':
        // Three stacked fifths and a long noise wash — the only cue allowed to
        // be this loud, because it costs a full gauge.
        this.tone(60, 1.1, 0.26, 'sine', at, 0.7);
        this.tone(180, 0.8, 0.14, 'triangle', at, 0.8);
        this.tone(270, 0.7, 0.09, 'sine', at, 0.85);
        this.hiss(0.9, 0.18, 1200, 0.6, 'lowpass', at, 200);
        break;
      case 'spawn':
        this.tone(140, 0.4, 0.1, 'sawtooth', at, 1.7);
        this.hiss(0.36, 0.08, 400, 0.9, 'lowpass', at, 1600);
        break;
      case 'telegraph':
        // Rising, so it reads as "incoming" even with your eyes elsewhere.
        if (this.throttle('telegraph', 90)) return;
        this.tone(240, 0.3, 0.07, 'sawtooth', at, 1.9);
        break;
      case 'bossTelegraph':
        this.tone(150, 0.55, 0.15, 'sawtooth', at, 2.4);
        this.hiss(0.5, 0.07, 600, 1.1, 'bandpass', at, 2600);
        break;
      case 'gate':
        this.tone(80, 0.7, 0.14, 'triangle', at, 1.5);
        this.hiss(0.6, 0.09, 300, 0.8, 'lowpass', at, 900);
        break;
      case 'boon':
        // The only major-key cue in the game. Reward should sound unlike combat.
        this.tone(523, 0.5, 0.1, 'sine');
        setTimeout(() => this.tone(784, 0.5, 0.09, 'sine'), 90);
        setTimeout(() => this.tone(1047, 0.6, 0.07, 'sine'), 180);
        break;
      case 'down':
        this.tone(160, 0.9, 0.2, 'sawtooth', at, 0.3);
        this.hiss(0.8, 0.1, 500, 0.7, 'lowpass', at, 80);
        break;
      case 'revive':
        this.tone(392, 0.4, 0.1, 'sine', at, 1.6);
        setTimeout(() => this.tone(587, 0.5, 0.09, 'sine', at), 110);
        break;

      // --- interface --------------------------------------------------------
      case 'uiHover':
        this.tone(660, 0.05, 0.03, 'sine');
        break;
      case 'uiClick':
        this.tone(880, 0.08, 0.06, 'square', undefined, 0.7);
        break;
    }
  }

  // ----------------------------------------------------------------- music

  /**
   * The bed under everything: a detuned drone plus a slow pulse.
   *
   * It is not a tune. A loop would wear out over a long run and there is no
   * budget to compose one procedurally that doesn't — so this only tracks
   * tension, opening the filter and pushing the pulse as a room heats up.
   */
  startMusic() {
    if (!this.ctx || !this.musicGain || this.drone) return;
    const t = this.ctx.currentTime;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 220;
    filter.Q.value = 1.2;

    const gain = this.ctx.createGain();
    gain.gain.value = 0.5;
    filter.connect(gain);
    gain.connect(this.musicGain);

    const sources: OscillatorNode[] = [];

    // Three oscillators a hair apart: the beating between them is the movement.
    for (const f of [55, 55.4, 82.5]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const og = this.ctx.createGain();
      og.gain.value = f > 80 ? 0.12 : 0.22;
      o.connect(og);
      og.connect(filter);
      o.start(t);
      sources.push(o);
    }

    // A heartbeat under the drone, gated by an LFO rather than a scheduler so
    // it can never drift out of sync with itself.
    const beat = this.ctx.createGain();
    beat.gain.value = 0;
    const pulseOsc = this.ctx.createOscillator();
    pulseOsc.type = 'sine';
    pulseOsc.frequency.value = 38;
    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.7;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.09;
    lfo.connect(lfoGain);
    lfoGain.connect(beat.gain);
    pulseOsc.connect(beat);
    beat.connect(this.musicGain);
    pulseOsc.start(t);
    lfo.start(t);
    sources.push(pulseOsc, lfo);

    this.drone = { filter, gain, beat, sources };
  }

  /**
   * How dangerous the room currently is, 0..1. Drives the filter and the pulse,
   * eased hard so a single spawn doesn't lurch the whole bed.
   */
  setIntensity(v: number) {
    this.intensity = clamp(v, 0, 1);
    if (!this.ctx || !this.drone) return;
    const t = this.ctx.currentTime;
    this.drone.filter.frequency.setTargetAtTime(200 + this.intensity * 900, t, 1.2);
    this.drone.gain.gain.setTargetAtTime(0.35 + this.intensity * 0.4, t, 1.5);
  }

  stopMusic() {
    if (!this.ctx || !this.drone) return;
    // Let it fall away rather than cut: a hard stop on a drone is a click.
    const t = this.ctx.currentTime;
    this.drone.gain.gain.setTargetAtTime(0.0001, t, 0.25);
    this.drone.beat.gain.setTargetAtTime(0.0001, t, 0.25);
    const dying = this.drone;
    this.drone = null;
    setTimeout(() => {
      try {
        // Stop the oscillators before dropping the nodes. Disconnecting alone
        // only makes them inaudible — they keep running, and every return to
        // the menu would leave another silent bed burning CPU.
        for (const s of dying.sources) s.stop();
        dying.gain.disconnect();
        dying.beat.disconnect();
        dying.filter.disconnect();
      } catch {
        /* already gone */
      }
    }, 1500);
  }
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}
