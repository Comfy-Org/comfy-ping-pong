/**
 * Sound effects. The ping pong and footstep sounds are recorded clips (public/sfx/, made by
 * scripts/generate-sfx.mjs with ElevenLabs Sound Effects). Each clip holds several separate
 * hits or steps, which are cut apart at load time and picked at random, with a small random
 * pitch and level change, so no two in a row sound the same. Sounds with a position in the
 * world are placed in 3D around the camera (and get quieter with distance), and everything
 * goes through a little room reverb.
 *
 * The short UI blips (meter ready, point won, chess, arcade hoops) are synthesized, and the
 * synthesized versions also stand in for the clips until they have loaded.
 */

/** How to cut each clip apart: minimum time between events, and how long each one rings. */
const CLIPS = {
  paddle_hit: { gap: 0.18, len: 0.32 },
  paddle_smash: { gap: 0.3, len: 0.55 },
  table_bounce: { gap: 0.15, len: 0.26 },
  floor_bounce: { gap: 0.06, len: 0.14, rel: 0.12 },
  net: { gap: 0.3, len: 0.4 },
  steps_wood: { gap: 0.28, len: 0.4 },
  steps_carpet: { gap: 0.28, len: 0.4 },
  steps_concrete: { gap: 0.28, len: 0.4 },
};

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.clips = {}; // name -> [AudioBuffer]
    this._last = {};
    // Fetch the clips right away; decode once the browser lets audio start.
    this._raw = Object.fromEntries(
      Object.keys(CLIPS).map((n) => [n, fetch(`/sfx/${n}.mp3`).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null)]),
    );
    const unlock = () => {
      if (!this.ctx) this._setup(new (window.AudioContext || window.webkitAudioContext)());
      this.ctx.resume?.();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  _setup(ctx) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    // A gentle limiter so a smash next to the camera doesn't clip.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(ctx.destination);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = roomImpulse(ctx, 1.1);
    this.reverb.connect(this.master);
    for (const [name, raw] of Object.entries(this._raw)) {
      raw.then((ab) => ab && ctx.decodeAudioData(ab)).then((buf) => {
        if (buf) this.clips[name] = slice(ctx, buf, CLIPS[name]);
      }).catch(() => {});
    }
  }

  get _on() {
    return this.ctx && !this.muted && this.ctx.state === 'running';
  }

  /** Keep the 3D listener on the camera (called every frame). */
  setListener(camera) {
    const ctx = this.ctx;
    if (!ctx) return;
    const L = ctx.listener;
    const p = camera.position;
    const e = camera.matrixWorld.elements;
    // Camera looks down its -Z; up is its +Y.
    const f = [-e[8], -e[9], -e[10]];
    const u = [e[4], e[5], e[6]];
    if (L.positionX) {
      L.positionX.value = p.x;
      L.positionY.value = p.y;
      L.positionZ.value = p.z;
      L.forwardX.value = f[0];
      L.forwardY.value = f[1];
      L.forwardZ.value = f[2];
      L.upX.value = u[0];
      L.upY.value = u[1];
      L.upZ.value = u[2];
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(...f, ...u);
    }
  }

  /**
   * Play one random cut of a recorded clip. Returns false if it hasn't loaded yet.
   * @param pos world position ({x, y, z}) or null for a sound at the listener
   */
  _play(name, { pos = null, gain = 1, rate = 1, wet = 0.12, near = 1.6, falloff = null, muffled = false } = {}) {
    const list = this.clips[name];
    if (!list?.length) return false;
    if (!this._on) return true;
    const ctx = this.ctx;
    // Too far away to hear at all: don't play it.
    if (pos && falloff && this._dist(pos) > falloff.max) return true;
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === this._last[name]) i = (i + 1) % list.length;
    this._last[name] = i;
    const src = ctx.createBufferSource();
    src.buffer = list[i];
    src.playbackRate.value = rate * (1 + (Math.random() - 0.5) * 0.08);
    const g = ctx.createGain();
    g.gain.value = gain * (0.88 + Math.random() * 0.24);
    src.connect(g);
    let out = g;
    if (muffled) {
      // Through a wall: duller and quieter.
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 700;
      g.gain.value *= 0.5;
      g.connect(lp);
      out = lp;
    }
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = falloff ? 'exponential' : 'inverse';
      p.refDistance = near;
      p.rolloffFactor = falloff ? falloff.rolloff : 1.1;
      p.maxDistance = falloff ? falloff.max : 60;
      if (p.positionX) {
        p.positionX.value = pos.x;
        p.positionY.value = pos.y ?? 0;
        p.positionZ.value = pos.z;
      } else p.setPosition(pos.x, pos.y ?? 0, pos.z);
      out.connect(p);
      out = p;
    }
    out.connect(this.master);
    // Reverb is sent from after the distance fall-off, so far sounds stay roomy but quiet.
    const send = ctx.createGain();
    send.gain.value = wet;
    out.connect(send).connect(this.reverb);
    src.start();
    return true;
  }

  // ------------------------------------------------------------------ ping pong

  hit(power = 0.5, pos = null) {
    if (this._play('paddle_hit', { pos, gain: 0.55 + power * 0.5, rate: 0.96 + power * 0.08 })) return;
    this._blip(1100 + power * 500, 0.05, { type: 'triangle', gain: 0.25 + power * 0.15 });
  }
  bounce(speed = 4, pos = null) {
    const k = Math.min(1, Math.max(0.3, Math.abs(speed) / 6));
    if (this._play('table_bounce', { pos, gain: 0.35 + 0.6 * k })) return;
    this._blip(750, 0.045, { type: 'sine', gain: 0.22 });
  }
  net(pos = null) {
    if (this._play('net', { pos, gain: 0.8 })) return;
    this._blip(160, 0.12, { type: 'square', gain: 0.06, slide: 0.8 });
  }
  floor(speed = 3, pos = null) {
    const k = Math.min(1, Math.abs(speed) / 5);
    if (k < 0.08) return; // the last tiny bounces before it rolls
    if (this._play('floor_bounce', { pos, gain: 0.25 + 0.75 * k, rate: 0.95 + 0.1 * k })) return;
    this._blip(380, 0.06, { type: 'sine', gain: 0.12 * k });
  }
  /** Super smash: the recorded smash, with a low thump under it. */
  smash(pos = null) {
    this._blip(90, 0.35, { type: 'sine', gain: 0.22, slide: 0.4 });
    if (this._play('paddle_smash', { pos, gain: 1.1, wet: 0.2 })) return;
    this._blip(2200, 0.09, { type: 'square', gain: 0.12, slide: 0.5 });
  }

  // ------------------------------------------------------------------ footsteps

  /**
   * One footstep.
   * @param surface 'wood' (game room), 'carpet' (desks, lounge, meeting rooms) or 'concrete' (kitchen)
   */
  step(pos, speed = 1.4, surface = 'carpet', muffled = false) {
    const jog = Math.min(1, Math.max(0, (speed - 1.6) / 1.7));
    const gain = (surface === 'carpet' ? 0.12 : 0.1) * (0.75 + 0.45 * jog);
    // Steep fall-off: your own steps (about 3 m from the camera) are clear, someone across
    // the room is faint, and the far end of the office is silent.
    this._play(`steps_${surface}`, {
      pos: { x: pos.x, y: 0.05, z: pos.z }, gain, rate: 1 + 0.06 * jog, wet: 0.06,
      near: 2.5, falloff: { rolloff: 1.8, max: 15 }, muffled,
    });
  }

  /** Distance from the listener (the camera). */
  _dist(pos) {
    const L = this.ctx.listener;
    const lx = L.positionX ? L.positionX.value : 0;
    const ly = L.positionY ? L.positionY.value : 0;
    const lz = L.positionZ ? L.positionZ.value : 0;
    return Math.hypot(pos.x - lx, (pos.y ?? 0) - ly, pos.z - lz);
  }

  /** Generic hook for UI code (the work computer uses it for a filed group). */
  play(name) {
    if (name === 'hit') this._blip(1250, 0.04, { type: 'triangle', gain: 0.12, slide: 0.8 });
    else this[name]?.();
  }

  // ------------------------------------------------------------------ synthesized blips

  _blip(freq, dur, { type = 'sine', gain = 0.2, slide = 0.6 } = {}) {
    if (!this._on) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
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
    if (!this._on) return;
    const ctx = this.ctx;
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
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }
  // Arcade hoops: a rubber basketball, a metal rim, a hollow backboard (no ping-pong clips).

  /** Ball through the net (`clean`: nothing but net, a fuller swish). */
  swish(clean = true) {
    this._noise(0.32, { gain: clean ? 0.32 : 0.22, freq: 1800, q: 0.5 });
    this._noise(0.18, { gain: clean ? 0.12 : 0.08, freq: 4200, q: 0.9 });
  }
  /** Ball leaves your hands: a soft whoosh. */
  shoot() {
    this._noise(0.2, { gain: 0.1, freq: 600, q: 0.7 });
  }
  /** Rubber ball on the ramp: a deep, short thump (louder when it lands harder). */
  ballBounce(speed = 2) {
    const k = Math.min(1, speed / 4);
    this._blip(105, 0.14, { type: 'sine', gain: 0.12 + k * 0.22, slide: 0.55 });
    this._noise(0.06, { gain: 0.05 + k * 0.1, freq: 260, q: 1.2 });
  }
  /** Ball off the metal rim: a bright clang. */
  rim(power = 0.5) {
    this._blip(640, 0.22, { type: 'triangle', gain: 0.05 + power * 0.08, slide: 0.99 });
    this._blip(1730, 0.16, { type: 'sine', gain: 0.03 + power * 0.06, slide: 0.99 });
    this._blip(2690, 0.08, { type: 'sine', gain: 0.02 + power * 0.04, slide: 0.99 });
  }
  /** Ball off the backboard: a hollow thud with a little rattle. */
  board() {
    this._blip(120, 0.12, { type: 'sine', gain: 0.24, slide: 0.6 });
    this._noise(0.1, { gain: 0.08, freq: 900, q: 1.5 });
  }
  /** End of the round. */
  buzzer() {
    this._blip(150, 0.9, { type: 'sawtooth', gain: 0.12, slide: 0.98 });
    this._blip(154, 0.9, { type: 'square', gain: 0.06, slide: 0.98 });
  }
}

/**
 * Cut a clip of several separate events into one buffer per event: find each sharp rise in
 * loudness (at least `gap` seconds after the last), back up to just before it, keep `len`
 * seconds with a fade-out, and level each cut to the same peak.
 */
export function slice(ctx, buf, { gap, len, rel = 0.25 }) {
  const sr = buf.sampleRate;
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  const d = chans[0];
  const win = Math.max(1, Math.floor(sr * 0.002));
  const env = [];
  for (let i = 0; i < d.length; i += win) {
    let m = 0;
    for (let j = i, e = Math.min(i + win, d.length); j < e; j++) {
      const a = Math.abs(d[j]);
      if (a > m) m = a;
    }
    env.push(m);
  }
  let peak = 0;
  for (const v of env) peak = Math.max(peak, v);
  const thr = peak * rel;
  // First find where each event starts...
  const starts = [];
  let last = -1e9;
  let quiet = true; // loudness has dropped back since the last event
  for (let k = 0; k < env.length; k++) {
    const t = k * 0.002;
    if (env[k] < thr * 0.5) quiet = true;
    if (env[k] < thr || t - last < gap || !quiet) continue;
    // Back up to where this event starts (up to 20 ms).
    let s = k;
    while (s > 0 && k - s < 10 && env[s - 1] > env[k] * 0.08) s--;
    starts.push(Math.max(0, s * win - Math.floor(sr * 0.003)));
    last = t;
    quiet = false;
  }
  // ...then cut each one, stopping short of the next so cuts never carry two events.
  const out = [];
  starts.forEach((start, idx) => {
    const end = Math.min(d.length, start + Math.floor(len * sr), (starts[idx + 1] ?? Infinity) - Math.floor(sr * 0.004));
    const n = end - start;
    if (n < sr * 0.05) return;
    const cut = ctx.createBuffer(chans.length, n, sr);
    let m = 0;
    for (const ch of chans) for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(ch[start + i]));
    const norm = m > 0 ? 0.9 / m : 1;
    chans.forEach((ch, c) => {
      const o = cut.getChannelData(c);
      for (let i = 0; i < n; i++) {
        const fade = i > n * 0.6 ? (n - i) / (n * 0.4) : 1;
        const fadeIn = Math.min(1, i / (sr * 0.002));
        o[i] = ch[start + i] * norm * fade * fadeIn;
      }
    });
    out.push(cut);
  });
  return out;
}

/** A small, fairly live room: decaying stereo noise with a few early reflections. */
function roomImpulse(ctx, seconds) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const ir = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 6.5) * Math.min(1, t / 0.008);
    }
    for (const [ms, a] of [[11, 0.5], [19, 0.35], [29, 0.3], [43, 0.2]]) {
      const i = Math.floor((ms + c * 3) * sr / 1000);
      if (i < n) d[i] += a * (c ? -1 : 1);
    }
  }
  return ir;
}
