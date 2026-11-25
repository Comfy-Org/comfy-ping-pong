/** Tiny synthesized sound effects — no asset files needed. */
export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    const unlock = () => {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.ctx.resume?.();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  _blip(freq, dur, { type = 'sine', gain = 0.2, slide = 0.6 } = {}) {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  hit(power = 0.5) {
    this._blip(1100 + power * 500, 0.05, { type: 'triangle', gain: 0.25 + power * 0.15 });
  }
  bounce() {
    this._blip(750, 0.045, { type: 'sine', gain: 0.22 });
  }
  net() {
    this._blip(160, 0.12, { type: 'square', gain: 0.06, slide: 0.8 });
  }
  floor() {
    this._blip(380, 0.06, { type: 'sine', gain: 0.12 });
  }
  /** Super smash: low thump + bright crack. */
  smash() {
    this._blip(90, 0.35, { type: 'sawtooth', gain: 0.18, slide: 0.4 });
    this._blip(2200, 0.09, { type: 'square', gain: 0.12, slide: 0.5 });
  }
  /** Meter filled. */
  ready() {
    this._blip(880, 0.12, { type: 'triangle', gain: 0.12, slide: 1.5 });
  }
  /** Chess piece set down on the board: a soft wooden tock (a sharper double tock on a capture). */
  chessMove(capture = false) {
    this._blip(520, 0.05, { type: 'triangle', gain: 0.14, slide: 0.7 });
    if (capture) setTimeout(() => this._blip(380, 0.06, { type: 'triangle', gain: 0.16, slide: 0.6 }), 70);
  }
  point(won) {
    this._blip(won ? 660 : 300, 0.25, { type: 'triangle', gain: 0.15, slide: won ? 1.5 : 0.6 });
  }

  /** Short filtered noise burst (net swish). */
  _noise(dur, { gain = 0.15, freq = 3000, q = 0.8 } = {}) {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t);
  }
  /** Arcade hoops: a clean basket. */
  swish() {
    this._noise(0.28, { gain: 0.35, freq: 2600, q: 0.6 });
    this._blip(990, 0.18, { type: 'triangle', gain: 0.08, slide: 1.4 });
  }
  /** Ball off the metal rim. */
  rim(power = 0.5) {
    this._blip(520, 0.12, { type: 'square', gain: 0.04 + power * 0.06, slide: 0.97 });
    this._blip(1560, 0.08, { type: 'triangle', gain: 0.05 + power * 0.05, slide: 0.98 });
  }
  /** Ball off the backboard. */
  board() {
    this._blip(170, 0.09, { type: 'triangle', gain: 0.2, slide: 0.6 });
  }
  /** End of the round. */
  buzzer() {
    this._blip(150, 0.9, { type: 'sawtooth', gain: 0.12, slide: 0.98 });
    this._blip(154, 0.9, { type: 'square', gain: 0.06, slide: 0.98 });
  }
}
