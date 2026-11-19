import * as THREE from 'three';
import { PHYSICS, PLAY, SPIN, SUPER } from '../config.js';
import { buildArena } from '../entities/Arena.js';
import { loadOffice } from '../entities/Office.js';
import { Ball } from '../entities/Ball.js';
import { Character } from '../characters/Character.js';
import { ROSTER } from '../characters/roster.js';
import { HumanController } from '../controllers/HumanController.js';
import { AIController } from '../controllers/AIController.js';
import { RemoteController } from '../controllers/RemoteController.js';
import { stepBall, predictInterception, spinFor, HALF_W } from '../physics/ballPhysics.js';
import { solveShot, solveServe } from '../physics/trajectory.js';
import { Match } from './Match.js';
import { HUD } from '../ui/HUD.js';
import { Sfx } from '../audio/Sfx.js';
import { Explore } from '../world/Explore.js';

/** Split a spin vector into topspin (+) / backspin (−) and sidespin, relative to travel. */
function spinParts(vel, spin) {
  const h = Math.hypot(vel.x, vel.z) || 1;
  return { top: (spin.x * vel.z - spin.z * vel.x) / h, side: spin.y };
}

/**
 * Phases:
 *  serveReady → (toss) → toss → (auto contact) → serve → (lands on receiver) → rally
 *  any live phase → (rule broken) → pointOver → serveReady | gameOver
 */
export class Game {
  constructor(container, { characters = [ROSTER.matt, ROSTER.deep], difficulty = 'medium' } = {}) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 60);
    this.camera.position.set(0, 2.25, 3.45);
    this._lookAt = new THREE.Vector3(0, 0.78, -0.35);

    this.arena = buildArena(this.scene);
    this.officeReady = loadOffice(this.scene, this.arena);
    this.ball = new Ball(this.scene);
    this.players = characters.map((def, side) => new Character(def, side));
    this.players.forEach((p) => p.addTo(this.scene));

    this.difficulty = difficulty;
    this.human = new HumanController(0, this.camera, this.renderer.domElement);
    this.controllers = [this.human, new AIController(1, difficulty)];
    this.demo = false;
    this.net = null; // NetSession when playing online
    this.localSide = 0; // which side this client controls (and views from)
    this._netSendT = 0;

    this.match = new Match(0);
    /** Super meters, 0..1 per side; armed = next hit is a smash. */
    this.meters = [0, 0];
    this.armed = [false, false];
    this._slowmo = 0;
    this._shake = 0;
    this._shakeOffset = new THREE.Vector3();
    this.hud = new HUD(container, characters.map((c) => c.name));
    this.sfx = new Sfx();

    // Aim-assist ring: shows where the incoming ball will cross your hit plane.
    this.assist = true;
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.06, 0.08, 32),
      new THREE.MeshBasicMaterial({ color: 0x7cf7c5, transparent: true, opacity: 0.8, depthTest: false })
    );
    this.marker.renderOrder = 10;
    this.marker.visible = false;
    this.scene.add(this.marker);
    this._assistRecalc = 0;

    this.events = [];
    this._timers = [];
    this.accumulator = 0;
    this.clock = new THREE.Clock();
    this.listeners = {}; // simple event bus for future hooks (camera shakes, replays, etc.)

    /** Players who have walked away from the table (the match pauses while anyone is away). */
    this.away = [false, false];
    this.explore = new Explore(this);

    this._applyViewpoint();
    this._bindKeys();
    window.addEventListener('resize', () => this._resize());
    this._resize();
  }

  on(name, fn) {
    (this.listeners[name] ??= []).push(fn);
  }
  emit(name, data) {
    this.listeners[name]?.forEach((fn) => fn(data));
  }

  // ------------------------------------------------------------------ flow

  start() {
    this.resetMatch();
    this.renderer.setAnimationLoop(() => this._frame());
  }

  resetMatch() {
    this._timers.length = 0;
    this.match.reset();
    this.meters = [0, 0];
    this.armed = [false, false];
    this.startPoint();
    this.hud.message('First to 11', 'Click or press Space to serve', 2.5);
  }

  startPoint() {
    this.phase = 'serveReady';
    this.rally = { lastHitter: -1, bounces: [0, 0], hitCount: this.rally ? this.rally.hitCount + 1 : 0, time: 0, touchedNet: false };
    this.ball.held = true;
    this.ball.vel.set(0, 0, 0);
    this.ball.spin.set(0, 0, 0);
    this.ball.superFlight = false;
    if (this.match.winner === null) for (const p of this.players) if (p._emote?.loop === THREE.LoopRepeat) p.stopEmote();
    this.hud.setScore(this.match.score, this.match.server);
    this._updateMeters();
    this._updateStatus();
    this.emit('pointStart', { server: this.match.server });
  }

  /** Server throws the ball up; contact happens automatically on the way down. */
  toss(side, remote = null) {
    if (this.phase !== 'serveReady' || this.match.server !== side) return;
    const paddle = this.players[side].paddle;
    const x = remote ? remote.x : paddle.position.x;
    this._tossY = remote ? remote.y : Math.max(paddle.position.y + 0.12, 1.02);
    this.phase = 'toss';
    this.ball.held = false;
    this.ball.pos.set(x, this._tossY, this.players[side].hitPlaneZ);
    this.ball.vel.set(0, PLAY.tossSpeed, 0);
    this.ball.spin.set(0, 0, 0);
    this.hud.message('');
    if (this.net && !remote) this.net.send({ t: 'toss', side, x, y: this._tossY });
  }

  _serveContact(side) {
    const serve = this.controllers[side].chooseServe(this);
    const spinFn = (v) => spinFor(v, serve.top ?? 0, serve.side ?? 0);
    const sol = solveServe(this.ball.pos, serve.target, spinFn);
    if (!sol) {
      // Unsolvable (contact too low) — re-toss rather than punish.
      this.startPoint();
      return;
    }
    this.ball.vel.copy(sol.vel);
    this.ball.spin.copy(spinFn(sol.vel)).multiplyScalar(sol.spinScale);
    this.rally.shotSpin = spinParts(this.ball.vel, this.ball.spin);
    this.phase = 'serve';
    this._registerHit(side, 0.4);
    this._sendHit(side);
  }

  _hit(side) {
    const shot = this.controllers[side].chooseShot(this);
    const ball = this.ball;
    ball.pos.z = this.players[side].hitPlaneZ;

    // The spin the opponent put on it (not what the bounce added — every ball rolls a little).
    const { top: inTop, side: inSide } = this.rally.shotSpin ?? { top: 0, side: 0 };

    const smash = this.armed[side];
    let { target, speed } = shot;
    let top = shot.top ?? 0;
    let sideSpin = shot.side ?? 0;
    if (smash) {
      this.armed[side] = false;
      this.meters[side] = 0;
      speed = SUPER.smashSpeed;
      top = SUPER.smashTopspin;
      sideSpin *= 0.3;
      target = target.clone();
      target.z = Math.sign(target.z) * 1.15;
      target.x = THREE.MathUtils.clamp(target.x * 1.2, -HALF_W + 0.1, HALF_W - 0.1);
    }
    const spinFn = (v) => spinFor(v, top, sideSpin);
    const sol = solveShot(ball.pos, target, speed, spinFn);
    ball.vel.copy(sol.vel);
    ball.spin.copy(spinFn(ball.vel)).multiplyScalar(sol.spinScale);
    this.rally.shotSpin = spinParts(ball.vel, ball.spin);

    // Uncontrolled incoming spin throws the return off: topspin kicks it up/long,
    // backspin drags it down into the net, sidespin pushes it sideways. Smashes overpower it.
    if (!smash) {
      const miss = 1 - THREE.MathUtils.clamp(shot.control ?? SPIN.passiveControl, 0, 1);
      ball.vel.y += SPIN.incomingError * (inTop / SPIN.max) * miss;
      ball.vel.x += SPIN.incomingError * 0.5 * (inSide / SPIN.max) * miss * Math.sign(ball.vel.z);
    }
    ball.superFlight = smash;

    this._registerHit(side, Math.min(1, speed / 9), true);
    if (smash) this._smashFx(side);
    else this._spinCallout();
    this._sendHit(side);
  }

  _smashFx(side) {
    this._slowmo = SUPER.slowmoTime;
    this._shake = 0.06;
    this.sfx.smash();
    this.hud.flash('SUPER SMASH!', 'super');
    this.emit('super', { side });
  }

  _spinCallout() {
    const kind = this.ball.spinKind();
    const w = this.ball.spin.length();
    if (kind === 'plain' || w < 80) return;
    this.hud.flash({ top: 'TOPSPIN', back: 'BACKSPIN', side: 'SIDESPIN' }[kind], kind);
  }

  armSuper(side) {
    if (this.meters[side] < 1 || this.armed[side] || !this.isLive() && this.phase !== 'serveReady') return;
    this.armed[side] = true;
    this.sfx.ready();
    this._updateMeters();
  }

  _gainMeter(side, amount) {
    if (this.armed[side]) return;
    const was = this.meters[side];
    this.meters[side] = Math.min(1, was + amount);
    if (was < 1 && this.meters[side] >= 1 && side === this.localSide && this.controllers[side].isHuman) {
      this.sfx.ready();
    }
    this._updateMeters();
  }

  _updateMeters() {
    const local = this.localSide;
    const human = this.controllers[local].isHuman;
    this.hud.setMeters(this.meters, this.armed, human ? local : -1);
  }

  // ------------------------------------------------------------- walking away

  get paused() {
    return this.away[0] || this.away[1];
  }

  canWalkAway() {
    return !this.demo && this.controllers[this.localSide].isHuman;
  }

  /** Called by Explore when the local player leaves the table. */
  onWalkAway() {
    this._setAway(this.localSide, true);
    this.net?.send({ t: 'away', on: true });
  }

  /** Called by Explore when the local player is back at the table. */
  onWalkBack() {
    Object.assign(this.human, { wantsServe: false, wantsSuper: false, pressed: false });
    this.net?.send({ t: 'away', on: false });
    this._setAway(this.localSide, false);
  }

  _setAway(side, on) {
    if (this.away[side] === on) return;
    this.away[side] = on;
    const name = this.players[side].def.name;
    if (on) {
      if (side !== this.localSide) this.players[side].startWalking();
      // A point in progress is replayed when play resumes.
      if (this.phase !== 'gameOver' && this.phase !== 'pointOver') this.startPoint();
      const you = side === this.localSide;
      this.hud.message(you ? 'Match paused' : `${name} walked away`, you ? 'Walk back to the table and press F to play' : 'Match paused until they come back', 3);
    } else {
      if (side !== this.localSide) this.players[side].stopWalking();
      if (!this.paused && this.phase !== 'gameOver') {
        this.startPoint();
        this.hud.message(side === this.localSide ? 'Back to it' : `${name} is back`, '', 1.5);
      } else if (this.paused) {
        const other = this.players[this.away[0] ? 0 : 1].def.name;
        this.hud.message(`Waiting for ${other}`, 'Match paused until they come back', 3);
      }
    }
    this._updateStatus();
  }

  // ----------------------------------------------------------------- network
  //
  // Ball flight is deterministic, so a hit only ships the ball state. Each flight
  // is judged by the player it is flying TOWARD (they see their own hit/miss with
  // zero lag); they broadcast the outcome, and the other client defers to it.

  _sendHit(side) {
    this.net?.send({
      t: 'hit',
      side,
      phase: this.phase,
      hitCount: this.rally.hitCount,
      pos: this.ball.pos.toArray(),
      vel: this.ball.vel.toArray(),
      spin: this.ball.spin.toArray(),
      super: this.ball.superFlight,
      meters: this.meters,
    });
  }

  /** Is this client the judge of the current flight? Always true offline. */
  isAuthority() {
    return !this.net || 1 - this.rally.lastHitter === this.localSide;
  }

  goOnline(net, localSide) {
    this.net = net;
    this.localSide = localSide;
    this.demo = false;
    const remote = 1 - localSide;
    this.human.side = localSide;
    this.controllers[localSide] = this.human;
    this.controllers[remote] = new RemoteController(remote);
    this._applyViewpoint();

    net.on('paddle', (m) => this.controllers[remote].receive?.(m));
    net.on('toss', (m) => {
      if (this.phase !== 'serveReady') this.startPoint(); // our pause ran a little long
      this.toss(m.side, m);
    });
    net.on('hit', (m) => this._applyRemoteHit(m));
    net.on('point', (m) => this._awardPoint(m.winner, m.reason, m));
    net.on('start', () => this.resetMatch());
    net.on('restart', () => this.resetMatch());
    net.on('rtt', () => this._updateStatus());
    net.on('walk', (m) => {
      this.players[remote].setWalkTarget(m.x, m.z, m.yaw, m.s);
      this.explore.chess?.applyRemoteSit(remote, !!m.sit);
    });
    net.on('chess', (m) => this.explore.chess?.receive(m));
    net.on('away', (m) => this._setAway(remote, m.on));
    net.on('peer-left', () => this.goOffline('Opponent left'));
    net.on('close', () => this.net && this.goOffline('Connection lost'));
    this._updateStatus();
  }

  /** Drop back to single player; the AI takes over the opponent's side. */
  goOffline(reason = '') {
    const net = this.net;
    this.net = null;
    net?.close();
    const remote = 1 - this.localSide;
    if (this.away[remote]) this._setAway(remote, false);
    this.controllers[remote] = new AIController(remote, this.difficulty);
    if (reason) this.hud.message(reason, 'The computer takes over', 3);
    this._updateStatus();
  }

  _applyRemoteHit(m) {
    if (this.phase === 'gameOver') return;
    this.ball.held = false;
    this.ball.pos.fromArray(m.pos);
    this.ball.vel.fromArray(m.vel);
    this.ball.spin.fromArray(m.spin ?? [0, 0, 0]);
    this.ball.superFlight = !!m.super;
    this.rally.shotSpin = spinParts(this.ball.vel, this.ball.spin);
    this.phase = m.phase;
    this.rally.hitCount = m.hitCount - 1;
    this._registerHit(m.side, Math.min(1, this.ball.vel.length() / 9), m.phase === 'rally');
    // The hitter's meters are the truth for their side.
    if (m.meters) {
      this.meters[m.side] = m.meters[m.side];
      this.armed[m.side] = false;
      this._updateMeters();
    }
    if (m.super) this._smashFx(m.side);
    else this._spinCallout();
    // The packet is ~half an RTT old: fast-forward so both views line up.
    const lead = Math.min(this.net.rtt / 2, 0.15) * PHYSICS.timeScale;
    for (let t = 0; t < lead; t += PHYSICS.step) this._physicsStep(PHYSICS.step);
  }

  _applyViewpoint() {
    const s = this.localSide;
    const sign = s === 0 ? 1 : -1;
    this.camera.position.set(0, 2.25, 3.45 * sign);
    this._lookAt.set(0, 0.78, -0.35 * sign);
    this.players.forEach((p, i) => {
      p.setOpacity(i === s ? 0.18 : 1); // near-camera player shouldn't block the table
      p.label.visible = i !== s; // the scoreboard already says who you are
    });
  }

  _registerHit(side, power, isReturn = false) {
    if (isReturn) {
      const extra = this.rally.hitCount > 6 ? SUPER.perLongRallyHit : 0;
      const gained = (this.rally.gained ??= [0, 0]);
      const add = Math.min(SUPER.perReturn + extra, SUPER.maxPerRally - gained[side]);
      if (!this.ball.superFlight && add > 0) {
        gained[side] += add;
        this._gainMeter(side, add);
      }
    }
    this.rally.lastHitter = side;
    this.rally.bounces = [0, 0];
    this.rally.hitCount++;
    this.rally.time = 0;
    this.rally.touchedNet = false;
    this.players[side].swing();
    this.sfx.hit(power);
    this.emit('hit', { side, power });
  }

  _awardPoint(winner, reason, remote = null) {
    if (this.phase === 'pointOver' || this.phase === 'gameOver') return;
    if (remote) {
      this.match.score = [...remote.score];
      this.match.winner = remote.matchWinner;
    } else {
      if (!this.isAuthority()) return; // the other client judges this flight
      this.match.award(winner);
      this.net?.send({ t: 'point', winner, reason, score: this.match.score, matchWinner: this.match.winner });
    }
    this.phase = 'pointOver';
    this.armed = [false, false];
    this._gainMeter(winner, SUPER.onPointWon);
    this._gainMeter(1 - winner, SUPER.onPointLost);
    this.ball.superFlight = false;
    if (this.match.winner !== null) this.players[winner].celebrateWin();
    else this.players[winner].celebrate();
    this.players[1 - winner].sulk();
    this.sfx.point(winner === this.localSide || this.controllers[winner].isHuman);
    this.hud.setScore(this.match.score, this.match.server);
    const name = this.players[winner].def.name;
    this.emit('point', { winner, reason, score: [...this.match.score] });

    if (this.match.winner !== null) {
      this.hud.message(`${name} wins!`, `${this.match.score[0]} – ${this.match.score[1]} · press R for a rematch`);
      this._after(PLAY.pointPause, () => (this.phase = "gameOver"));
      this.emit('gameOver', { winner });
      return;
    }
    this.hud.message(`Point ${name}`, reason, PLAY.pointPause);
    this._after(PLAY.pointPause, () => this.startPoint());
  }

  /** Game-time timer (pauses with the sim, deterministic under fast-forward). */
  _after(seconds, fn) {
    this._timers.push({ t: seconds, fn });
  }

  _tickTimers(dt) {
    for (const timer of [...this._timers]) {
      timer.t -= dt;
      if (timer.t <= 0) {
        this._timers.splice(this._timers.indexOf(timer), 1);
        timer.fn();
      }
    }
  }

  // ----------------------------------------------------------------- rules

  isLive() {
    return this.phase === 'serve' || this.phase === 'rally';
  }

  /** True when `side` is the one who must return the ball in flight. */
  isIncoming(side) {
    return this.isLive() && this.rally.lastHitter !== side;
  }

  canHit(side) {
    return this.phase === 'rally' && this.rally.lastHitter !== side && this.rally.bounces[side] >= 1;
  }

  _onBallEvent(e) {
    if (e.type === 'table') this.sfx.bounce();
    else if (e.type === 'net') this.sfx.net();
    else if (e.type === 'floor') this.sfx.floor();
    if (!this.isLive()) return;

    const h = this.rally.lastHitter;
    const o = 1 - h;
    const b = this.rally.bounces;
    const netNote = this.rally.touchedNet ? 'Into the net' : null;

    if (e.type === 'net') {
      this.rally.touchedNet = true;
      return;
    }

    if (this.phase === 'serve') {
      if (e.type === 'floor') return this._awardPoint(o, netNote ?? 'Service fault');
      if (e.side === h) {
        if (b[h] >= 1) return this._awardPoint(o, netNote ?? 'Service fault');
        b[h] = 1;
      } else {
        if (b[h] === 0) return this._awardPoint(o, 'Serve must bounce on your side first');
        b[o] = 1;
        this.phase = 'rally';
      }
      return;
    }

    // rally
    if (e.type === 'floor') {
      return b[o] >= 1 ? this._awardPoint(h, 'Missed return') : this._awardPoint(o, netNote ?? 'Out');
    }
    if (e.side === h) {
      return b[o] >= 1 ? this._awardPoint(h, 'Missed return') : this._awardPoint(o, netNote ?? 'Bounced on own side');
    }
    b[o]++;
    if (b[o] >= 2) this._awardPoint(h, 'Double bounce');
  }

  // --------------------------------------------------------------- physics

  _physicsStep(dt) {
    const ball = this.ball;
    if (ball.held) {
      const p = this.players[this.match.server].paddle.position;
      ball.pos.set(p.x, p.y + 0.13, p.z);
      return;
    }
    const prevZ = ball.pos.z;
    this.events.length = 0;
    stepBall(ball.pos, ball.vel, ball.spin, dt, this.events);
    for (const e of this.events) this._onBallEvent(e);

    const ownsServe = !this.net || this.match.server === this.localSide;
    if (this.phase === 'toss' && ownsServe && ball.vel.y < 0 && ball.pos.y <= this._tossY) {
      this._serveContact(this.match.server);
      return;
    }

    for (const side of [0, 1]) {
      if (!this.canHit(side) || (this.net && side !== this.localSide)) continue;
      const pz = this.players[side].hitPlaneZ;
      const crossed = side === 0 ? prevZ < pz && ball.pos.z >= pz : prevZ > pz && ball.pos.z <= pz;
      if (!crossed) continue;
      const paddle = this.players[side].paddle.position;
      const reach = ball.superFlight ? SUPER.receiverReach : PLAY.reach;
      if (Math.hypot(ball.pos.x - paddle.x, ball.pos.y - paddle.y) <= reach) this._hit(side);
    }

    if (this.isLive()) {
      this.rally.time += dt;
      if (this.rally.time > PLAY.rallyTimeout) this._onBallEvent({ type: 'floor' });
    }
  }

  // ----------------------------------------------------------------- frame

  _frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const paused = this.paused;
    if (!paused) {
      this._tickTimers(dt);
      for (const c of this.controllers) c.update(dt, this);
    }
    this.explore.update(dt);

    // Hit-stop on a smash: the sim crawls for a moment (real time, not game time).
    let scale = 1;
    if (this._slowmo > 0) {
      this._slowmo -= dt;
      scale = SUPER.slowmoScale;
    }
    this.accumulator += paused ? 0 : dt * PHYSICS.timeScale * scale;
    let steps = 0;
    while (this.accumulator >= PHYSICS.step && steps++ < PHYSICS.maxStepsPerFrame) {
      this._physicsStep(PHYSICS.step);
      this.accumulator -= PHYSICS.step;
    }
    if (steps >= PHYSICS.maxStepsPerFrame) this.accumulator = 0;

    if (this.net) {
      this._netSendT -= dt;
      const w = this.players[this.localSide].walk;
      if (this._netSendT <= 0 && w) {
        this._netSendT = 1 / 20;
        this.net.send({ t: 'walk', x: +w.pos.x.toFixed(3), z: +w.pos.z.toFixed(3), yaw: +w.yaw.toFixed(3), s: +w.speed.toFixed(2), sit: w.sit ? 1 : 0 });
      } else if (this._netSendT <= 0) {
        this._netSendT = 1 / 30;
        const p = this.players[this.localSide].paddle.position;
        this.net.send({
          t: 'paddle',
          x: +p.x.toFixed(4),
          y: +p.y.toFixed(4),
          z: +p.z.toFixed(4),
          p: this.human.pressed,
          a: this.armed[this.localSide],
        });
      }
    }

    if (this.net) {
      const r = this.controllers[1 - this.localSide];
      if (r.isRemote && r.armed !== undefined && r.armed !== this.armed[r.side] && this.meters[r.side] >= 1) {
        this.armed[r.side] = r.armed;
        this._updateMeters();
      }
    }
    for (const p of this.players) p.update(dt);
    this.ball.update(dt);
    if (this.explore.active) this.marker.visible = false;
    else {
      this._updateAssist(dt);
      this._updateCamera(dt);
    }
    this.hud.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  _updateAssist(dt) {
    const side = this.localSide;
    const show = this.assist && this.controllers[side].isHuman && this.isIncoming(side);
    if (!show) {
      this.marker.visible = false;
      return;
    }
    this._assistRecalc -= dt;
    if (this._assistRecalc <= 0) {
      this._assistRecalc = 0.05;
      const me = this.players[side];
      const pred = predictInterception(this.ball.pos, this.ball.vel, this.ball.spin, me.hitPlaneZ, side, this.rally.bounces[side] === 0);
      this.marker.visible = !!pred;
      if (pred) this.marker.position.copy(pred.point);
    }
  }

  _updateCamera(dt) {
    const px = this.players[this.localSide].paddle.position.x;
    this.camera.position.x += (px * 0.25 - this.camera.position.x) * Math.min(1, dt * 3);
    this.camera.lookAt(this._lookAt);
    if (this._shake > 0.001) {
      this._shake *= Math.exp(-dt * 7);
      const a = this._shake;
      this.camera.position.sub(this._shakeOffset);
      this._shakeOffset.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, 0);
      this.camera.position.add(this._shakeOffset);
    } else if (this._shakeOffset.lengthSq()) {
      this.camera.position.sub(this._shakeOffset);
      this._shakeOffset.set(0, 0, 0);
    }
  }

  _resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // Keep the whole table in view on narrow (portrait) screens.
    this.camera.fov = w / h < 1 ? 70 : 50;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------- settings

  setDifficulty(name) {
    this.difficulty = name;
    for (const c of this.controllers) if (!c.isHuman) c.setDifficulty(name);
    this._updateStatus();
  }

  /** Offline: play as the character on `side` (the AI takes the other one). */
  setLocalSide(side) {
    if (this.net || side === this.localSide) return;
    this.localSide = side;
    this.human.side = side;
    this.controllers[side] = this.demo ? new AIController(side, this.difficulty) : this.human;
    this.controllers[1 - side] = new AIController(1 - side, this.difficulty);
    this._applyViewpoint();
    this._updateStatus();
  }

  setDemo(on) {
    if (this.net) return;
    this.demo = on;
    const s = this.localSide;
    this.controllers[s] = on ? new AIController(s, this.difficulty) : this.human;
    this._updateStatus();
  }

  _updateStatus() {
    if (this.net) {
      const ms = this.net.rtt ? ` · ${Math.round(this.net.rtt * 1000)} ms` : '';
      this.hud.setStatus(`Online · you are ${this.players[this.localSide].def.name}${ms}${this.paused ? ' · paused' : ''}`);
      return;
    }
    const d = this.controllers[1 - this.localSide].cfg?.label ?? this.difficulty;
    this.hud.setStatus(`${this.paused ? 'Exploring · ' : ''}${d}${this.demo ? ' · AI vs AI' : ''}${this.assist ? '' : ' · assist off'}${this.sfx.muted ? ' · muted' : ''}`);
  }

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.key.toLowerCase();
      if (this.net && '123p'.includes(k)) return; // no AI settings online
      if (k === '1') this.setDifficulty('easy');
      else if (k === '2') this.setDifficulty('medium');
      else if (k === '3') this.setDifficulty('hard');
      else if (k === 'p') this.setDemo(!this.demo);
      else if (k === 'g') {
        this.assist = !this.assist;
        this._updateStatus();
      } else if (k === 'm') {
        this.sfx.muted = !this.sfx.muted;
        this._updateStatus();
      } else if (k === 'r') {
        this.net?.send({ t: 'restart' });
        this.resetMatch();
      }
    });
  }
}

