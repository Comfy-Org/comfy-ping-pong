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
  point(won) {
    this._blip(won ? 660 : 300, 0.25, { type: 'triangle', gain: 0.15, slide: won ? 1.5 : 0.6 });
  }
}
