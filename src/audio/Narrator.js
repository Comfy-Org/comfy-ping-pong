/**
 * The narrator: a dry, faintly exasperated British storyteller who describes
 * what you do in the third person, past tense, as if it were already a story
 * (in the spirit of The Stanley Parable; the lines are our own). He covers the
 * open world, ping pong and chess. His words also appear on screen, revealed
 * in time with his voice, so the narration works with the sound off too.
 *
 *   C → narrator on/off (remembered between visits; off by default)
 *
 * Voice clips are ElevenLabs v4 lines generated through Comfy Router
 * (scripts/generate-narrator.mjs) from scripts/narrator-lines.json and served
 * from /narrator/<file>.mp3. Lines marked `per` name the local player and exist
 * once per character (<id>_matt.mp3, <id>_deep.mp3). A missing clip is shown as
 * text only, never read by a synthetic voice.
 */

import LINES from '../../scripts/narrator-lines.json';

const BY_ID = new Map(LINES.map((l) => [l.id, l]));
/** Spoken caption: the script minus ElevenLabs performance tags like [whispers]. */
const caption = (text, name) => text.replace(/\[[^\]]*\]\s*/g, '').replaceAll('{name}', name).trim();
const pick = (ids) => ids[Math.floor(Math.random() * ids.length)];

const STORE = 'narrator';
const MIN_GAP = 3.5; // seconds between ordinary lines, so it doesn't talk over itself
const IDLE_AFTER = 30; // seconds standing still in the office before he remarks on it
const TV_STARE = 12; // seconds standing still near the TV
const LOSE_STREAK = 5; // points lost in a row

export class Narrator {
  constructor(game) {
    this.game = game;
    this.on = read() === '1';
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.speaking = false;
    this.lastAt = -Infinity;
    this.audio.addEventListener('ended', () => this._done());
    this.audio.addEventListener('error', () => this._current && this._silent(this._current));
    // Once the clip's length is known, pace the on-screen words to match it.
    this.audio.addEventListener('loadedmetadata', () => this._reveal(this.audio.duration));

    this.el = document.createElement('div');
    this.el.className = 'narration';
    this.el.setAttribute('role', 'status'); // screen readers announce each line as he says it
    game.hud.el.appendChild(this.el);

    this._bindGame();
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.code !== 'KeyC' || e.repeat) return;
      this.setOn(!this.on);
    });
  }

  setOn(on, { quiet = false } = {}) {
    this.on = on;
    write(on ? '1' : '0');
    if (!on) this.stop(); // off means silent and nothing on screen, right away
    if (quiet) return;
    // Easter egg: switching him off and on again repeatedly does not go unnoticed.
    const now = performance.now() / 1000;
    if (on) this._ons = [...(this._ons ?? []).filter((t) => now - t < 60), now];
    const n = this._ons?.length ?? 0;
    if (on) this.say(n >= 5 ? 'narr_toggle_2' : n >= 3 ? 'narr_toggle_1' : 'narrator_on', { force: true });
    else {
      this.game.hud.message('Narrator off', 'C to bring him back', 1.2);
    }
  }

  /**
   * Say a line (or one of several). Ordinary lines wait their turn and are
   * dropped if the narrator spoke a moment ago; `force` interrupts.
   */
  say(ids, { force = false } = {}) {
    if (!this.on) return;
    const now = performance.now() / 1000;
    if (!force && (this.speaking || now - this.lastAt < MIN_GAP)) return;
    const base = BY_ID.get(Array.isArray(ids) ? pick(ids) : ids);
    if (!base) return;
    const me = this.game.players[this.game.localSide].def;
    const line = { ...base, file: base.per ? `${base.id}_${me.id}` : base.id, spoken: caption(base.text, me.name) };
    this.stop();
    this.lastAt = now;
    this.speaking = true;
    this._current = line;
    this._caption(line.spoken);
    this.audio.src = `/narrator/${line.file}.mp3`;
    this.audio.volume = 1;
    this.audio.play().catch(() => this._silent(line));
  }

  /** Cut him off mid-line and clear his words from the screen. */
  stop() {
    this.audio.pause();
    clearTimeout(this._silentT);
    clearTimeout(this._hideT);
    clearTimeout(this._backstopT);
    this.speaking = false;
    this._current = null;
    this.el.classList.remove('show');
  }

  /** No audio (clip missing or playback blocked): let the words tell it at reading pace. */
  _silent(line) {
    const secs = 1 + line.spoken.split(/\s+/).length * 0.32;
    this._reveal(secs);
    clearTimeout(this._silentT);
    this._silentT = setTimeout(() => this._done(), secs * 1000);
  }

  _done() {
    clearTimeout(this._backstopT);
    this.speaking = false;
    this._current = null;
    clearTimeout(this._hideT);
    this._hideT = setTimeout(() => this.el.classList.remove('show'), 1600);
  }

  /** Lay the line out as words that fade in one after another (see _reveal). */
  _caption(text) {
    clearTimeout(this._hideT);
    this.el.replaceChildren(
      ...text.split(' ').map((w) => Object.assign(document.createElement('span'), { textContent: `${w} ` }))
    );
    this.el.classList.add('show');
  }

  /** Reveal the words over `secs`, weighting each by its length so the text keeps pace with the voice. */
  _reveal(secs) {
    const words = [...this.el.children];
    if (!words.length || !isFinite(secs)) return;
    void this.el.offsetWidth; // start the transitions from the hidden state
    const weight = words.map((w) => w.textContent.length + 2);
    const total = weight.reduce((a, b) => a + b, 0);
    let t = 0;
    words.forEach((w, i) => {
      w.style.transitionDelay = `${((t / total) * secs * 0.92).toFixed(2)}s`;
      t += weight[i];
      w.classList.add('on');
    });
    // Backstop: if the clip stalls and never reports ending, the words still go away.
    clearTimeout(this._backstopT);
    this._backstopT = setTimeout(() => this._current && this._done(), (secs + 3) * 1000);
  }

  // ------------------------------------------------------------ what he calls

  _bindGame() {
    const g = this.game;
    const live = () => !g.demo && !g.paused;
    const idOf = (side) => g.players[side].def.id;

    // A fresh match is announced once, on its first serve. Checked a tick later
    // so a reset that's immediately followed by walking off stays quiet.
    let announced = false;
    g.on('pointStart', () => setTimeout(() => {
      const [a, b] = g.match.score;
      if (!live()) return;
      if (a + b === 0) {
        if (!announced) this.say('pp_start', { force: true });
        announced = true;
        return;
      }
      const need = 10; // one away from 11
      if ((a >= need || b >= need) && a !== b) this.say('pp_matchpoint');
    }));
    g.on('super', () => live() && this.say(['pp_super_1', 'pp_super_2'], { force: true }));
    g.on('hit', () => live() && g.rally?.hitCount === 12 && this.say('pp_rally'));
    g.on('point', ({ score }) => {
      if (!live() || g.match.winner !== null) return;
      if (score[0] + score[1] > 1 && Math.random() < 0.35) this.say(['pp_point_1', 'pp_point_2']);
    });
    g.on('gameOver', ({ winner }) => {
      announced = false;
      if (!g.demo) this.say(`pp_win_${idOf(winner)}`, { force: true });
    });

    // The open world.
    g.on('officeStart', () => this.say('office_enter', { force: true }));
    g.on('walkAway', () => this.say('walk_away', { force: true }));
    g.on('walkBack', () => {
      const fresh = g.match.score[0] + g.match.score[1] === 0 && !announced;
      announced ||= fresh;
      this.say(fresh ? 'pp_start' : 'back_to_table', { force: true });
    });
    let still = 0;
    let lastPos = null;
    setInterval(() => {
      const me = g.players[g.localSide];
      const pos = me.walk?.pos;
      if (!g.explore.active || g.explore.chess?.seated || !pos) return (still = 0), (lastPos = null);
      const moved = !lastPos || Math.hypot(pos.x - lastPos.x, pos.z - lastPos.z) > 0.05;
      lastPos = { x: pos.x, z: pos.z };
      still = moved ? 0 : still + 1;
      // Easter egg: standing in front of the TV, watching it instead of getting on with the story.
      const tv = g.tv?.screen?.position;
      const nearTV = tv && g.tv.items.length && Math.hypot(pos.x - tv.x, pos.z - tv.z) < 3.2;
      if (nearTV && still === TV_STARE) this.say('tv_stare');
      else if (still === IDLE_AFTER) this.say('idle');
    }, 1000);

    // Easter eggs in the office.
    let bumps = [];
    g.on('bumpWall', () => {
      const now = performance.now() / 1000;
      bumps = [...bumps.filter((t) => now - t < 20), now];
      if (bumps.length >= 3) {
        bumps = [];
        this.say('wall_bump', { force: true });
      }
    });
    g.on('spot', ({ id }) => {
      if (id === 'cards') this.say('cards_soon', { force: true });
      else if (id === 'sofa') this.say('sofa_soon', { force: true });
      else if (id === 'door') this.say('door', { force: true });
    });
    // First visit to each part of the floor.
    g.on('zoneEnter', ({ id, first }) => first && this.say(`zone_${id}`));
    g.on('chessQuit', () => this.say('chess_quit', { force: true }));
    // Easter egg: a losing streak at ping pong (he stops the commentary out of mercy).
    let lost = 0;
    g.on('point', ({ winner }) => {
      if (g.demo) return;
      lost = winner === g.localSide ? 0 : lost + 1;
      if (lost === LOSE_STREAK) this.say('lose_streak', { force: true });
    });
    g.on('pointStart', () => g.match.score[0] + g.match.score[1] === 0 && (lost = 0));

    g.on('chessStart', () => this.say('ch_start', { force: true }));
    g.on('chessMove', ({ m, check }) => {
      if (m.captured && m.captured.toLowerCase() === 'q') return this.say('ch_queen', { force: true });
      if (m.promo) return this.say('ch_promo', { force: true });
      if (check) return this.say(['ch_check_1', 'ch_check_2']);
      if (m.castle) return this.say('ch_castle');
      if (m.captured && Math.random() < 0.6) this.say(['ch_capture_1', 'ch_capture_2']);
    });
    g.on('chessOver', ({ status, winnerSide }) =>
      this.say(status === 'checkmate' ? `ch_mate_${idOf(winnerSide)}` : 'ch_draw', { force: true })
    );
  }
}

function read() {
  try {
    return localStorage.getItem(STORE);
  } catch {
    return null;
  }
}
function write(v) {
  try {
    localStorage.setItem(STORE, v);
  } catch {}
}
