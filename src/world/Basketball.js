import * as THREE from 'three';

/**
 * The arcade basketball machine in the game room, playable.
 *
 *   F at the machine  → step up (first person, looking up the ramp at the two hoops)
 *   move the mouse    → aim (the ring shows where the shot is headed)
 *   hold the button   → the power meter swings; release in the green
 *   F                 → step away
 *
 * A round lasts 45 seconds and starts with your first shot. Baskets are worth 2,
 * or 3 in the last 10 seconds. Missed balls roll back down the ramp to you.
 *
 * Everything is simulated in the machine's own frame (front = +Z, bottom-centre
 * origin, metres), the same frame as arcade_basketball.glb. The rim positions
 * were measured from the model; the ramp, side walls and backboard are found by
 * raycasting the model when it loads (with the measured values as a fallback).
 */

const ROUND = 45;
const BONUS_AT = 10; // seconds left when baskets become 3 points
const BALLS = 5;
const BALL_R = 0.085;
const GRAVITY = 9.8;
const SUBSTEPS = 4;

// Measured from the model (machine frame).
const RIMS = [
  { x: -0.285, y: 1.57, z: -0.82 },
  { x: 0.27, y: 1.57, z: -0.82 },
];
const RIM_R = 0.14; // to the middle of the rim tube
const RIM_TUBE = 0.012;

const HAND = new THREE.Vector3(0, 1.24, 0.92);
const CAM = new THREE.Vector3(0, 1.5, 1.78);
const LOOK = new THREE.Vector3(0, 1.36, -0.75);
const STAND = 1.55; // where you stand, in front of the machine (z)
const ANGLE = THREE.MathUtils.degToRad(54); // launch angle above the horizontal
const SWING = 1.15; // seconds for the power meter to sweep up and back
const GREEN = 0.07; // half-width of the sweet spot

export class Basketball {
  constructor(game, explore, obj) {
    this.game = game;
    this.explore = explore;
    this.playing = false; // standing at the machine
    this.state = 'ready'; // ready | play | over
    this.score = 0;
    this.timeLeft = ROUND;
    this.best = loadBest();
    this.aim = new THREE.Vector2(0, 0);
    this.charging = false;
    this.charge = 0; // seconds held
    this.held = null; // ball in hand
    this._camPos = new THREE.Vector3();
    this._camLook = new THREE.Vector3();
    this._rimSfxT = 0;

    // Our own frame at the machine's position and heading (ignore any scale on the model).
    obj.updateMatrixWorld(true);
    this.frame = new THREE.Group();
    const s = new THREE.Vector3();
    obj.matrixWorld.decompose(this.frame.position, this.frame.quaternion, s);
    game.scene.add(this.frame);
    this.frame.updateMatrixWorld(true);

    this._measure(obj);
    this._buildBalls();
    this._buildRims();
    this._buildReticle();
    this._buildScoreboard();
    this._buildPanel();
    this._bindInput(game.renderer.domElement);
    this._drawScoreboard();
  }

  /** Where Explore puts the "Play basketball" prompt. */
  spot() {
    const p = this.toWorld(new THREE.Vector3(0, 0, STAND - 0.1));
    return { id: 'hoops', label: 'Play basketball', x: p.x, z: p.z, r: 1.0 };
  }

  toWorld(v) {
    return this.frame.localToWorld(v.clone());
  }

  // ---------------------------------------------------------------- geometry

  /** Find the ramp, side walls and backboard in the model; keep the measured values if a ray misses. */
  _measure(obj) {
    const ray = new THREE.Raycaster();
    const cast = (from, dir) => {
      const o = this.toWorld(from);
      const d = dir.clone().applyQuaternion(this.frame.quaternion);
      ray.set(o, d);
      const hit = ray.intersectObject(obj, true)[0];
      return hit ? this.frame.worldToLocal(hit.point.clone()) : null;
    };
    const down = new THREE.Vector3(0, -1, 0);
    // Ramp height along the middle (no rims there), back to front.
    this.ramp = [];
    for (let z = -1.0; z <= 1.0001; z += 0.25) {
      const h = cast(new THREE.Vector3(0, 1.35, z), down);
      const y = h && h.y > 0.4 && h.y < 1.2 ? h.y : 0.62 + (1.0 - z) * 0.08;
      this.ramp.push({ z, y });
    }
    // Keep it sloping toward the player, so balls always come back.
    for (let i = this.ramp.length - 2; i >= 0; i--) this.ramp[i].y = Math.max(this.ramp[i].y, this.ramp[i + 1].y + 0.01);

    const side = (sx) => {
      const h = cast(new THREE.Vector3(0, 1.2, 0.2), new THREE.Vector3(sx, 0, 0));
      return h && Math.abs(h.x) > 0.35 && Math.abs(h.x) < 0.62 ? Math.abs(h.x) : 0.55;
    };
    this.wallX = Math.min(side(1), side(-1)) - 0.005;
    const board = cast(new THREE.Vector3(0, 1.8, 0.2), new THREE.Vector3(0, 0, -1));
    this.boardZ = board && board.z < -0.9 && board.z > -1.2 ? board.z : -1.08;
    this.frontZ = 1.12;
    this.ceilY = 2.02;
  }

  _floorY(z) {
    const r = this.ramp;
    if (z <= r[0].z) return r[0].y;
    for (let i = 1; i < r.length; i++) {
      if (z <= r[i].z) {
        const t = (z - r[i - 1].z) / (r[i].z - r[i - 1].z);
        return r[i - 1].y + (r[i].y - r[i - 1].y) * t;
      }
    }
    return r[r.length - 1].y;
  }

  // ------------------------------------------------------------------ meshes

  _buildBalls() {
    const geo = new THREE.SphereGeometry(BALL_R, 24, 16);
    const mat = new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.65 });
    this.balls = [];
    for (let i = 0; i < BALLS; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      this.frame.add(mesh);
      const b = { mesh, p: mesh.position, v: new THREE.Vector3(), state: 'roll', shot: null };
      b.p.set((i - (BALLS - 1) / 2) * BALL_R * 2.1, this._floorY(0.6) + BALL_R, 0.6 - i * 0.05);
      this.balls.push(b);
    }
  }

  /** Thin rims and nets exactly where the physics thinks they are. */
  _buildRims() {
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xe0561b, roughness: 0.4, metalness: 0.5 });
    const netMat = new THREE.LineBasicMaterial({ color: 0xf4f4f4, transparent: true, opacity: 0.75 });
    this.nets = [];
    for (const r of RIMS) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(RIM_R, RIM_TUBE, 8, 32), rimMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(r.x, r.y, r.z);
      this.frame.add(rim);
      // A short cone of net strands.
      const pts = [];
      const N = 12;
      const depth = 0.17;
      const bottom = RIM_R * 0.6;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const b = ((i + 0.5) / N) * Math.PI * 2;
        pts.push(Math.cos(a) * RIM_R, 0, Math.sin(a) * RIM_R, Math.cos(b) * bottom, -depth, Math.sin(b) * bottom);
        pts.push(Math.cos(a + Math.PI / N * 2) * RIM_R, 0, Math.sin(a + Math.PI / N * 2) * RIM_R, Math.cos(b) * bottom, -depth, Math.sin(b) * bottom);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const net = new THREE.LineSegments(g, netMat);
      net.position.set(r.x, r.y, r.z);
      this.frame.add(net);
      this.nets.push({ net, swish: 0 });
    }
  }

  _buildReticle() {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.03, 0.04, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthTest: false })
    );
    m.renderOrder = 10;
    m.visible = false;
    this.frame.add(m);
    this.reticle = m;
  }

  _buildScoreboard() {
    this.board = document.createElement('canvas');
    this.board.width = 256;
    this.board.height = 128;
    const tex = new THREE.CanvasTexture(this.board);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.boardTex = tex;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.17), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    m.position.set(0, 1.86, this.boardZ + 0.006);
    this.frame.add(m);
  }

  _drawScoreboard() {
    const c = this.board.getContext('2d');
    c.fillStyle = '#0b0d12';
    c.fillRect(0, 0, 256, 128);
    c.strokeStyle = '#e0561b';
    c.lineWidth = 6;
    c.strokeRect(3, 3, 250, 122);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#ff9c3a';
    c.font = 'bold 64px ui-monospace, Menlo, monospace';
    c.fillText(String(this.score).padStart(2, '0'), 72, 62);
    c.fillStyle = this.state === 'play' && this.timeLeft <= BONUS_AT ? '#ff4d4d' : '#7cf5c4';
    c.fillText(String(Math.ceil(this.timeLeft)).padStart(2, '0'), 184, 62);
    c.fillStyle = '#9aa3b2';
    c.font = 'bold 16px ui-monospace, Menlo, monospace';
    c.fillText('SCORE', 72, 108);
    c.fillText('TIME', 184, 108);
    this.boardTex.needsUpdate = true;
  }

  // -------------------------------------------------------------------- HUD

  _buildPanel() {
    this.panel = document.createElement('div');
    this.panel.className = 'chesspanel hoopspanel';
    this.panel.hidden = true;
    this.panel.innerHTML = `<div class="ct"></div><div class="cs"></div>
      <div class="hm"><i></i><span></span></div>
      <div class="ck"><span>Move the mouse to aim</span><span>Hold the button, release in the green</span><span><kbd>F</kbd> step away</span></div>`;
    const style = document.createElement('style');
    style.textContent = `.hoopspanel .hm { position: relative; height: 10px; margin: 8px auto 2px; width: 220px; border-radius: 5px;
        background: rgba(255,255,255,0.15); overflow: hidden; }
      .hoopspanel .hm i { position: absolute; top: 0; bottom: 0; left: ${(0.5 - GREEN) * 100}%; width: ${GREEN * 200}%; background: #3ddc84; opacity: 0.8; }
      .hoopspanel .hm span { position: absolute; top: -2px; bottom: -2px; width: 4px; margin-left: -2px; left: 0; background: #fff; border-radius: 2px; }`;
    document.head.appendChild(style);
    this.game.hud.el.appendChild(this.panel);
  }

  _updatePanel() {
    const $ = (c) => this.panel.querySelector(c);
    $('.ct').textContent = `Hoops · best ${this.best}`;
    let line;
    if (this.state === 'ready') line = 'Shoot to start the clock';
    else if (this.state === 'over') line = `Time! ${this.score} points${this.score > 0 && this.score >= this.best ? ' · new best' : ''}`;
    else line = `${this.score} points · ${Math.ceil(this.timeLeft)}s${this.timeLeft <= BONUS_AT ? ' · 3-pointers!' : ''}`;
    $('.cs').textContent = line;
    $('.hm span').style.left = `${this._meter() * 100}%`;
    $('.hm').style.opacity = this.charging ? 1 : 0.45;
  }

  /** Power meter position 0…1 (it swings up and back while you hold). */
  _meter() {
    if (!this.charging) return 0;
    const t = (this.charge / SWING) % 1;
    return t < 0.5 ? t * 2 : 2 - t * 2;
  }

  // ------------------------------------------------------------------ input

  _bindInput(dom) {
    this.dom = dom;
    dom.addEventListener('pointerdown', (e) => {
      if (!this.playing || e.button !== 0) return;
      if (this.state === 'over') {
        if (performance.now() - this._overAt < 1200) return;
        this._newRound();
      }
      if (!this._takeBall()) {
        this.game.hud.message('Wait for a ball', '', 0.8);
        return;
      }
      this.charging = true;
      this.charge = 0;
    });
    window.addEventListener('pointerup', (e) => {
      if (!this.playing || e.button !== 0 || !this.charging) return;
      this._shoot();
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.playing) return;
      const r = dom.getBoundingClientRect();
      this.aim.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    });
  }

  // ------------------------------------------------------------- sit / stand

  sit() {
    const g = this.game;
    const me = g.players[g.localSide];
    this.playing = true;
    Object.assign(me.walk, { speed: 0, target: null });
    me.walk.pos.copy(this.toWorld(new THREE.Vector3(0, 0, STAND)));
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.frame.quaternion);
    me.walk.yaw = Math.atan2(f.x, f.z);
    me.root.visible = false; // first person
    this._camPos.copy(g.camera.position);
    this._camLook.copy(this.toWorld(LOOK));
    this.aim.set(0, 0);
    this.reticle.visible = true;
    this.panel.hidden = false;
    g.hud.el.classList.add('seated');
    g.hud.setPrompt('');
    this.dom.style.cursor = 'crosshair';
    if (this.state === 'over') this._newRound();
    this._updatePanel();
    g.emit('hoopsStart');
  }

  stand() {
    const g = this.game;
    const me = g.players[g.localSide];
    this.playing = false;
    this.charging = false;
    if (this.held) this._drop(this.held);
    if (this.state === 'play') this._endRound(true);
    me.root.visible = true;
    me.walk.pos.copy(this.toWorld(new THREE.Vector3(0, 0, STAND + 0.2)));
    // Camera behind you, looking at the machine.
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(this.frame.quaternion);
    this.explore.yaw = Math.atan2(back.x, back.z);
    this.reticle.visible = false;
    this.panel.hidden = true;
    g.hud.el.classList.remove('seated');
    this.dom.style.cursor = 'grab';
  }

  // ------------------------------------------------------------------ rules

  _newRound() {
    this.state = 'ready';
    this.score = 0;
    this.timeLeft = ROUND;
    this._drawScoreboard();
  }

  _startRound() {
    this.state = 'play';
    this.score = 0;
    this.timeLeft = ROUND;
    this._bonusSaid = false;
  }

  _endRound(quit = false) {
    this.state = quit ? 'ready' : 'over';
    this._overAt = performance.now();
    if (!quit) {
      this.game.sfx.buzzer?.();
      const best = this.score > this.best;
      if (best) {
        this.best = this.score;
        saveBest(this.best);
      }
      this.game.hud.message(`${this.score} points`, best ? 'New best!' : 'Click to play again', 2.5);
      this.game.emit('hoopsEnd', { score: this.score, best });
    } else {
      this.score = 0;
      this.timeLeft = ROUND;
    }
    this._drawScoreboard();
  }

  _scored(b, rim, clean) {
    if (this.state !== 'play') return;
    const pts = this.timeLeft <= BONUS_AT ? 3 : 2;
    this.score += pts;
    this.nets[rim].swish = 1;
    if (clean) this.game.sfx.swish?.();
    else this.game.sfx.point?.(true);
    this._drawScoreboard();
    this.game.emit('hoopsScore', { points: pts, score: this.score, clean });
  }

  // ------------------------------------------------------------------ balls

  _takeBall() {
    if (this.held) return true;
    const ready = this.balls.filter((b) => b.state === 'rack').sort((a, b) => Math.abs(a.p.x) - Math.abs(b.p.x));
    const b = ready[0];
    if (!b) return false;
    b.state = 'held';
    b.v.set(0, 0, 0);
    this.held = b;
    return true;
  }

  _drop(b) {
    b.state = 'roll';
    b.v.set(0, 0, 0);
    this.held = null;
  }

  /** The point on the hoops' plane that the mouse is aiming at. */
  _target() {
    return new THREE.Vector3(this.aim.x * 0.5, RIMS[0].y + 0.02 + this.aim.y * 0.32, RIMS[0].z);
  }

  _shoot() {
    const b = this.held;
    const m = this._meter();
    this.charging = false;
    if (!b) return;
    if (this.state === 'ready') this._startRound();
    if (this.state !== 'play') return this._drop(b);
    this.held = null;
    const from = b.p.clone();
    const to = this._target();
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const D = Math.hypot(dx, dz);
    const h = to.y - from.y;
    const c = Math.cos(ANGLE);
    const ideal = Math.sqrt((GRAVITY * D * D) / (2 * c * c * Math.max(0.05, D * Math.tan(ANGLE) - h)));
    // Middle of the meter is the right power; ±0.5 on the meter is ±18% speed.
    const speed = ideal * (1 + (m - 0.5) * 0.36) * (1 + (Math.random() - 0.5) * 0.012);
    const horiz = speed * c;
    b.v.set((dx / D) * horiz, speed * Math.sin(ANGLE), (dz / D) * horiz);
    b.state = 'fly';
    b.shot = { touched: false, scored: false };
    this.game.sfx.hit?.(0.3);
  }

  _step(b, dt) {
    const p = b.p;
    const v = b.v;
    const prevY = p.y;
    v.y -= GRAVITY * dt;
    p.addScaledVector(v, dt);

    // Rims: push out of the torus tube.
    for (let i = 0; i < RIMS.length; i++) {
      const r = RIMS[i];
      const hx = p.x - r.x;
      const hz = p.z - r.z;
      const hl = Math.hypot(hx, hz) || 1e-6;
      const q = new THREE.Vector3(r.x + (hx / hl) * RIM_R, r.y, r.z + (hz / hl) * RIM_R);
      const n = p.clone().sub(q);
      const d = n.length();
      const min = BALL_R + RIM_TUBE;
      if (d < min && d > 1e-6) {
        n.divideScalar(d);
        p.copy(q).addScaledVector(n, min);
        const vn = v.dot(n);
        if (vn < 0) {
          v.addScaledVector(n, -1.55 * vn);
          v.multiplyScalar(0.92);
          if (b.shot) b.shot.touched = true;
          if (Math.abs(vn) > 0.4 && this._rimSfxT <= 0) {
            this.game.sfx.rim?.(Math.min(1, Math.abs(vn) / 3));
            this._rimSfxT = 0.08;
          }
        }
      }
      // Through the hoop: crossing the rim plane going down, inside the ring.
      if (b.shot && !b.shot.scored && prevY >= r.y && p.y < r.y && v.y < 0 && hl < RIM_R - RIM_TUBE) {
        b.shot.scored = true;
        this._scored(b, i, !b.shot.touched);
      }
    }

    // Backboard and back wall.
    if (p.z - BALL_R < this.boardZ) {
      p.z = this.boardZ + BALL_R;
      if (v.z < 0) {
        if (v.z < -0.8) this.game.sfx.board?.();
        v.z = -v.z * 0.55;
      }
    }
    // Sides, ceiling, front glass (only above the ramp lip).
    if (Math.abs(p.x) + BALL_R > this.wallX) {
      p.x = Math.sign(p.x) * (this.wallX - BALL_R);
      v.x = -v.x * 0.5;
    }
    if (p.y + BALL_R > this.ceilY) {
      p.y = this.ceilY - BALL_R;
      v.y = -Math.abs(v.y) * 0.4;
    }
    if (p.z + BALL_R > this.frontZ) {
      p.z = this.frontZ - BALL_R;
      if (v.z > 0) v.z = -v.z * 0.3;
    }
    // Ramp: bounce, then roll down toward the player.
    const fy = this._floorY(p.z) + BALL_R;
    if (p.y < fy) {
      p.y = fy;
      if (v.y < -0.35) {
        // A real bounce.
        if (v.y < -1.2) this.game.sfx.floor?.();
        v.y = -v.y * 0.38;
        v.x *= 0.85;
        v.z *= 0.85;
        if (b.shot) b.shot.touched = true;
      } else if (v.y < 0) v.y = 0; // rolling
      v.z += 2.4 * dt; // down the slope, toward the player
      v.x *= 1 - 1.2 * dt;
    }
    // Spin the ball the way it travels.
    const sp = Math.hypot(v.x, v.z);
    if (sp > 1e-3) b.mesh.rotateOnWorldAxis(new THREE.Vector3(v.z, 0, -v.x).normalize(), (sp * dt) / BALL_R);
  }

  _collideBalls() {
    const bs = this.balls;
    for (let i = 0; i < bs.length; i++) {
      for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i];
        const b = bs[j];
        if (a.state === 'held' || b.state === 'held') continue;
        const n = b.p.clone().sub(a.p);
        const d = n.length();
        if (d >= BALL_R * 2 || d < 1e-6) continue;
        n.divideScalar(d);
        const push = (BALL_R * 2 - d) / 2;
        a.p.addScaledVector(n, -push);
        b.p.addScaledVector(n, push);
        const rel = b.v.clone().sub(a.v).dot(n);
        if (rel < 0) {
          a.v.addScaledVector(n, rel * 0.9);
          b.v.addScaledVector(n, -rel * 0.9);
        }
      }
    }
  }

  // ---------------------------------------------------------------- update

  update(dt) {
    dt = Math.min(dt, 1 / 30);
    this._rimSfxT -= dt;
    const h = dt / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) {
      for (const b of this.balls) if (b.state !== 'held') this._step(b, h);
      this._collideBalls();
    }
    // Balls that have come to rest at the front are ready to pick up.
    for (const b of this.balls) {
      if (b.state === 'held') continue;
      const atFront = b.p.z > this.frontZ - BALL_R * 3.2;
      const slow = b.v.lengthSq() < 0.09;
      const low = b.p.y < this._floorY(b.p.z) + BALL_R + 0.02;
      if (atFront && slow && low) {
        b.state = 'rack';
        b.shot = null;
      } else if (b.state === 'rack' && !atFront) b.state = 'roll';
    }
    // Ball in hand follows the aim a little.
    if (this.held) {
      const want = HAND.clone().add(new THREE.Vector3(this.aim.x * 0.12, this._meter() * -0.04, 0));
      this.held.p.lerp(want, Math.min(1, dt * 14));
    }
    for (const n of this.nets) {
      if (n.swish <= 0) continue;
      n.swish = Math.max(0, n.swish - dt * 2.5);
      n.net.scale.set(1 - n.swish * 0.15, 1 + n.swish * 0.35, 1 - n.swish * 0.15);
    }

    if (this.charging) this.charge += dt;
    if (this.state === 'play') {
      const before = Math.ceil(this.timeLeft);
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      if (!this._bonusSaid && this.timeLeft <= BONUS_AT) {
        this._bonusSaid = true;
        if (this.playing) this.game.hud.message('3-pointers!', 'Every basket is worth 3 now', 1.4);
      }
      if (Math.ceil(this.timeLeft) !== before) this._drawScoreboard();
      if (this.timeLeft <= 0) this._endRound();
    }
    if (this.playing) {
      this.reticle.position.copy(this._target());
      this._updatePanel();
    }
  }

  updateCamera(dt) {
    const want = this.toWorld(CAM.clone().add(new THREE.Vector3(this.aim.x * 0.08, 0, 0)));
    const look = this.toWorld(LOOK.clone().add(new THREE.Vector3(this.aim.x * 0.2, this.aim.y * 0.1, 0)));
    const a = Math.min(1, dt * 6);
    this._camPos.lerp(want, a);
    this._camLook.lerp(look, a);
    this.game.camera.position.copy(this._camPos);
    this.game.camera.lookAt(this._camLook);
  }
}

/** Orange ball with black seams. */
function ballTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#e46a1f';
  x.fillRect(0, 0, 256, 128);
  x.strokeStyle = '#1a1210';
  x.lineWidth = 4;
  x.beginPath();
  x.moveTo(0, 64);
  x.lineTo(256, 64);
  for (const cx of [64, 192]) {
    x.moveTo(cx, 0);
    x.lineTo(cx, 128);
  }
  x.moveTo(0, 0);
  x.bezierCurveTo(60, 50, 60, 78, 0, 128);
  x.moveTo(256, 0);
  x.bezierCurveTo(196, 50, 196, 78, 256, 128);
  x.moveTo(128, 0);
  x.bezierCurveTo(68, 50, 68, 78, 128, 128);
  x.moveTo(128, 0);
  x.bezierCurveTo(188, 50, 188, 78, 128, 128);
  x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function loadBest() {
  try {
    return Number(localStorage.getItem('hoops.best')) || 0;
  } catch {
    return 0;
  }
}

function saveBest(n) {
  try {
    localStorage.setItem('hoops.best', String(n));
  } catch {
    /* private mode: best score just isn't kept */
  }
}
