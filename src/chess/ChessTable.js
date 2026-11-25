import * as THREE from 'three';
import { Chess, colorOf, typeOf, fileOf, rankOf } from './ChessEngine.js';
import { chooseMove } from './ChessAI.js';
import { buildPiece } from './pieces.js';

const S = 0.05; // square size (m) → 0.4 m board
const BOARD_T = 0.018;
const ANIM = 0.32; // seconds per piece move
const WALK_SPEED = 1.4;

/**
 * Board views, cycled with V. Positions are relative to your seat: `back` is how far behind the
 * board center (toward you) the camera sits, `up` its height above the board.
 */
const VIEWS = [
  { name: 'Seated', back: 0.68, up: 0.53 },
  { name: 'High angle', back: 0.42, up: 0.72 },
  { name: 'Top down', back: 0.035, up: 0.78 },
];

/**
 * A playable chess table in the office.
 *
 * Seats: side 0 (Matt) plays white from the west chair, side 1 (Deep) black from the east.
 * Offline, Deep walks over and plays you (strength follows the ping-pong difficulty).
 * Online, you play each other once you're both seated; moves are synced over the relay.
 */
export class ChessTable {
  constructor(game, explore, table, chairs) {
    this.game = game;
    this.explore = explore;
    this.table = table; // { x, z, top }
    this.top = table.top + BOARD_T;
    this.chess = new Chess();
    this.seated = false;
    this.remoteSeated = false;
    this.anims = [];
    this.meshes = new Array(64).fill(null);
    this.graveyard = { w: [], b: [] };
    this.selected = -1;
    this.hover = -1;
    this.lastMove = null;
    this._aiToken = 0;
    this._autopilot = null;

    // Seats from the two chairs that face this table: west = white, east = black.
    const [west, east] = [...chairs].sort((a, b) => a.x - b.x);
    const seat = (c) => {
      const dx = table.x - c.x;
      const dz = table.z - c.z;
      const d = Math.hypot(dx, dz) || 1;
      // Hips sit a touch behind the chair's center, facing the table.
      return { x: c.x - (dx / d) * 0.05, z: c.z - (dz / d) * 0.05, yaw: Math.atan2(dx, dz), seatY: c.seatY, fx: dx / d, fz: dz / d };
    };
    this.seats = [seat(west), seat(east)];

    this.group = new THREE.Group();
    this.group.position.set(table.x, table.top, table.z);
    game.scene.add(this.group);
    this._buildBoard();
    this._buildMarkers();
    this.rebuildPieces();
    this._buildPanel();
    this._bindInput(game.renderer.domElement);
    this._ray = new THREE.Raycaster();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.top);
    this._camPos = new THREE.Vector3();
    this._camLook = new THREE.Vector3();
    this.view = 0;
    this.zoom = 1;
  }

  // ------------------------------------------------------------ geometry

  /** Board square → world position on the board surface. Ranks run west→east, files a→h run -z→+z. */
  squarePos(s, out = new THREE.Vector3()) {
    return out.set(this.table.x + (rankOf(s) - 3.5) * S, this.top, this.table.z + (fileOf(s) - 3.5) * S);
  }

  worldToSquare(p) {
    const r = Math.floor((p.x - this.table.x) / S + 4);
    const f = Math.floor((p.z - this.table.z) / S + 4);
    return r >= 0 && r < 8 && f >= 0 && f < 8 ? r * 8 + f : -1;
  }

  _buildBoard() {
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(S * 8 + 0.03, BOARD_T - 0.004, S * 8 + 0.03),
      new THREE.MeshStandardMaterial({ color: 0x3b2414, roughness: 0.5 })
    );
    frame.position.y = (BOARD_T - 0.004) / 2;
    frame.castShadow = frame.receiveShadow = true;
    this.group.add(frame);
    const light = new THREE.MeshStandardMaterial({ color: 0xead9b8, roughness: 0.55 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x7a4e2d, roughness: 0.55 });
    const tile = new THREE.BoxGeometry(S, 0.004, S);
    for (let s = 0; s < 64; s++) {
      const m = new THREE.Mesh(tile, (fileOf(s) + rankOf(s)) % 2 ? light : dark);
      this.squarePos(s, m.position).sub(this.group.position);
      m.position.y = BOARD_T - 0.002;
      m.receiveShadow = true;
      this.group.add(m);
    }
  }

  _buildMarkers() {
    const mk = (color, opacity, geo) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.renderOrder = 3;
      this.game.scene.add(m);
      return m;
    };
    const square = new THREE.PlaneGeometry(S * 0.98, S * 0.98);
    this.mSelected = mk(0x5ee0a0, 0.55, square);
    this.mHover = mk(0xffffff, 0.22, square);
    this.mCheck = mk(0xff3b30, 0.55, square);
    this.mLast = [mk(0xffd54a, 0.35, square), mk(0xffd54a, 0.35, square)];
    this.mDots = Array.from({ length: 28 }, () => mk(0x1b5e20, 0.6, new THREE.CircleGeometry(S * 0.16, 20)));
    this.mRings = Array.from({ length: 16 }, () => mk(0xc62828, 0.65, new THREE.RingGeometry(S * 0.36, S * 0.47, 28)));
  }

  _place(marker, s, lift = 0.0015) {
    this.squarePos(s, marker.position);
    marker.position.y += lift;
    marker.visible = true;
  }

  _updateMarkers() {
    for (const m of [this.mSelected, this.mHover, this.mCheck, ...this.mLast, ...this.mDots, ...this.mRings]) m.visible = false;
    if (this.lastMove) {
      this._place(this.mLast[0], this.lastMove.from, 0.001);
      this._place(this.mLast[1], this.lastMove.to, 0.001);
    }
    if (this.chess.inCheck()) this._place(this.mCheck, this.chess.kingSquare(this.chess.turn), 0.0012);
    if (!this.seated) return;
    if (this.hover >= 0 && this.hover !== this.selected) this._place(this.mHover, this.hover);
    if (this.selected >= 0) {
      this._place(this.mSelected, this.selected);
      let d = 0;
      let r = 0;
      const seen = new Set();
      for (const m of this.chess.moves(this.selected)) {
        if (seen.has(m.to)) continue; // promotions list one move per piece type
        seen.add(m.to);
        if (m.captured && r < this.mRings.length) this._place(this.mRings[r++], m.to, 0.002);
        else if (d < this.mDots.length) this._place(this.mDots[d++], m.to, 0.002);
      }
    }
  }

  // --------------------------------------------------------------- pieces

  rebuildPieces() {
    for (const m of [...this.meshes, ...this.graveyard.w, ...this.graveyard.b]) if (m) this.game.scene.remove(m);
    this.meshes.fill(null);
    this.graveyard = { w: [], b: [] };
    this.anims.length = 0;
    this.chess.board.forEach((p, s) => {
      if (p) this.meshes[s] = this._spawn(p, s);
    });
    // Rebuild captured pieces from what's missing (keeps the graveyard right after a sync).
    const start = { p: 8, n: 2, b: 2, r: 2, q: 1 };
    for (const color of ['w', 'b']) {
      for (const [t, n] of Object.entries(start)) {
        const have = this.chess.board.filter((p) => p && colorOf(p) === color && typeOf(p) === t).length;
        for (let i = have; i < n; i++) this._toGraveyard(this._spawn(color === 'w' ? t.toUpperCase() : t, 0), color, false);
      }
    }
    this.lastMove = this.chess.history.at(-1)?.move ?? null;
    this._updateMarkers();
  }

  _spawn(p, s) {
    const mesh = buildPiece(typeOf(p), colorOf(p));
    this.squarePos(s, mesh.position);
    // Knights look at the opponent: white faces +x (east), black faces -x.
    mesh.rotation.y = colorOf(p) === 'w' ? Math.PI / 2 : -Math.PI / 2;
    this.game.scene.add(mesh);
    return mesh;
  }

  _toGraveyard(mesh, color, animate = true) {
    const list = this.graveyard[color];
    const i = list.length;
    list.push(mesh);
    // Captured pieces line up beside the board on their owner's half.
    const side = color === 'w' ? -1 : 1;
    const to = new THREE.Vector3(
      this.table.x + side * (0.04 + (i % 8) * 0.024),
      this.table.top,
      this.table.z + (color === 'w' ? -1 : 1) * (S * 4 + 0.035 + Math.floor(i / 8) * 0.03)
    );
    if (animate) this._animate(mesh, to, 0.06);
    else mesh.position.copy(to);
  }

  _animate(mesh, to, lift = 0.03, delay = 0, onDone = null) {
    this.anims.push({ mesh, from: mesh.position.clone(), to: to.clone(), t: -delay, lift, onDone });
  }

  _tickAnims(dt) {
    for (const a of [...this.anims]) {
      a.t += dt;
      if (a.t < 0) continue;
      const k = Math.min(1, a.t / ANIM);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      a.mesh.position.lerpVectors(a.from, a.to, e);
      a.mesh.position.y += Math.sin(Math.PI * k) * a.lift;
      if (k >= 1) {
        this.anims.splice(this.anims.indexOf(a), 1);
        a.onDone?.();
      }
    }
  }

  /** Show a move that the engine has already applied. */
  _showMove(m) {
    const mover = colorOf(m.piece);
    const mesh = this.meshes[m.from];
    const capSq = m.enPassant ? m.to + (mover === 'w' ? -8 : 8) : m.to;
    const captured = m.captured ? this.meshes[capSq] : null;
    this.meshes[m.from] = null;
    if (captured) {
      this.meshes[capSq] = null;
      this._toGraveyard(captured, colorOf(m.captured));
    }
    this.meshes[m.to] = mesh;
    const knightHop = typeOf(m.piece) === 'n' ? 0.05 : 0.02;
    this._animate(mesh, this.squarePos(m.to), knightHop, 0, () => {
      if (m.promo) {
        this.game.scene.remove(mesh);
        this.meshes[m.to] = this._spawn(mover === 'w' ? m.promo.toUpperCase() : m.promo, m.to);
      }
    });
    if (m.castle) {
      const [rf, rt] = m.castle === 'k' ? [m.from + 3, m.from + 1] : [m.from - 4, m.from - 1];
      const rook = this.meshes[rf];
      this.meshes[rf] = null;
      this.meshes[rt] = rook;
      this._animate(rook, this.squarePos(rt), 0.03, 0.12);
    }
    this.lastMove = m;
    this.game.sfx.chessMove?.(!!m.captured);
    if (this.seated) this.game.emit('chessMove', { m, check: this.chess.inCheck(this.chess.turn) });
    // The player who moved reaches for the piece.
    const side = mover === 'w' ? 0 : 1;
    const ch = this.game.players[side];
    if (ch.walk?.sit) ch.walk.reach = { point: this.squarePos(m.to), t: 0.7 };
  }

  // ------------------------------------------------------------- playing

  get myColor() {
    return this.game.localSide === 0 ? 'w' : 'b';
  }

  /** Who sits across from you: 'ai' offline, 'remote' online once they've sat down. */
  get opponent() {
    if (!this.game.net) return 'ai';
    return this.remoteSeated ? 'remote' : null;
  }

  canMove() {
    const st = this.chess.status();
    return this.seated && st === 'play' && this.chess.turn === this.myColor && this.opponent && !this.anims.length && this._opponentReady();
  }

  _opponentReady() {
    if (this.opponent !== 'ai') return true;
    return !!this.game.players[1 - this.game.localSide].walk?.sit;
  }

  tryMove(from, to) {
    const m = this.chess.move({ from, to, promo: 'q' });
    if (!m) return false;
    this.selected = -1;
    this._showMove(m);
    this.game.net?.send({ t: 'chess', a: 'move', from, to, promo: m.promo });
    this._afterMove();
    return true;
  }

  _afterMove() {
    this._updateMarkers();
    this._updatePanel();
    const st = this.chess.status();
    if (st !== 'play') return this._gameOver(st);
    if (this.opponent === 'ai' && this.chess.turn !== this.myColor) this._scheduleAI();
  }

  _scheduleAI() {
    const token = ++this._aiToken;
    const think = 600 + Math.random() * 900;
    setTimeout(() => {
      if (token !== this._aiToken || this.opponent !== 'ai' || this.chess.turn === this.myColor) return;
      if (!this._opponentReady() || this.anims.length) return this._scheduleAI(); // still walking over
      if (this.chess.status() !== 'play') return;
      const choice = chooseMove(this.chess, this.game.difficulty);
      if (!choice) return;
      const m = this.chess.move(choice);
      this._showMove(m);
      this._afterMove();
    }, think);
  }

  _gameOver(st) {
    const names = this.game.players.map((p) => p.def.name);
    const loserColor = this.chess.turn;
    const winner = loserColor === 'w' ? names[1] : names[0];
    const text = {
      checkmate: [`Checkmate — ${winner} wins`, 'Press N for a new game'],
      stalemate: ['Stalemate — draw', 'Press N for a new game'],
      fifty: ['Draw by the fifty-move rule', 'Press N for a new game'],
      repetition: ['Draw by repetition', 'Press N for a new game'],
      material: ['Draw — not enough material', 'Press N for a new game'],
    }[st];
    if (this.seated) {
      this.game.hud.message(text[0], text[1], 4);
      this.game.emit('chessOver', { status: st, winnerSide: loserColor === 'w' ? 1 : 0 });
    }
    if (st === 'checkmate') {
      const side = loserColor === 'w' ? 1 : 0;
      const ch = this.game.players[side];
      if (!ch.walk) return;
      ch._mood = 2;
      this.game.sfx.point(side === this.game.localSide);
    }
    this._updatePanel();
  }

  newGame(remote = false) {
    this._aiToken++;
    this.chess.reset();
    this.selected = -1;
    this.rebuildPieces();
    if (!remote) this.game.net?.send({ t: 'chess', a: 'new' });
    this._updatePanel();
    if (this.seated) this.game.emit('chessStart');
    if (this.opponent === 'ai' && this.chess.turn !== this.myColor) this._scheduleAI();
  }

  // ------------------------------------------------------------ sit/stand

  sitInfo(side) {
    const s = this.seats[side];
    return { y: s.seatY, x: s.x, z: s.z, yaw: s.yaw, table: this.table };
  }

  sit() {
    const g = this.game;
    const side = g.localSide;
    const me = g.players[side];
    const s = this.seats[side];
    this.seated = true;
    Object.assign(me.walk, { speed: 0, target: null });
    me.walk.pos.set(s.x, 0, s.z);
    me.walk.yaw = s.yaw;
    me.walk.sit = this.sitInfo(side);
    me.root.visible = false; // first person over the board
    this._camPos.copy(g.camera.position);
    this._camLook.set(this.table.x, this.top, this.table.z);
    this.panel.hidden = false;
    g.hud.el.classList.add('seated');
    g.hud.setPrompt('');
    g.net?.send({ t: 'chess', a: 'sit', on: true, moves: this._moveList() });
    if (!g.net) this._summonDeep();
    this._updateMarkers();
    this._updatePanel();
    if (!this._moveList().length) g.emit('chessStart');
    if (this.opponent === 'ai' && this.chess.turn !== this.myColor && this.chess.status() === 'play') this._scheduleAI();
  }

  stand() {
    const g = this.game;
    const side = g.localSide;
    const me = g.players[side];
    const s = this.seats[side];
    this.seated = false;
    this.selected = -1;
    this.hover = -1;
    me.walk.sit = null;
    me.walk.reach = null;
    me.root.visible = true;
    me.paddle.group.visible = true;
    // Step back from the chair.
    me.walk.pos.set(s.x - s.fx * 0.55, 0, s.z - s.fz * 0.55);
    me.walk.yaw = s.yaw + Math.PI;
    this.explore.yaw = Math.atan2(s.fx, s.fz); // camera behind you, looking away from the table
    this.panel.hidden = true;
    g.hud.el.classList.remove('seated');
    g.net?.send({ t: 'chess', a: 'sit', on: false });
    if (!g.net) this._dismissDeep();
    this._updateMarkers();
    if (this._moveList().length && this.chess.status() === 'play') g.emit('chessQuit');
  }

  /** Offline: Deep walks from the ping-pong table to his chair. */
  _summonDeep() {
    const deep = this.game.players[1 - this.game.localSide];
    if (deep.walk?.sit) return;
    if (!deep.walk) deep.startWalking();
    const s = this.seats[1 - this.game.localSide];
    const approach = { x: s.x - s.fx * 0.7, z: s.z - s.fz * 0.7 + 0.6 };
    this._autopilot = { ch: deep, path: [approach, { x: s.x, z: s.z }], onArrive: () => this._seat(deep, 1 - this.game.localSide) };
  }

  /** Offline: Deep heads back to the ping-pong table. */
  _dismissDeep() {
    const deep = this.game.players[1 - this.game.localSide];
    if (!deep.walk) return;
    deep.walk.sit = null;
    deep.walk.reach = null;
    deep.paddle.group.visible = true;
    const s = this.seats[1 - this.game.localSide];
    const home = this.explore.tableSpot(1 - this.game.localSide);
    const back = { x: s.x - s.fx * 0.7, z: s.z - s.fz * 0.7 + 0.6 };
    deep.walk.pos.set(s.x - s.fx * 0.4, 0, s.z - s.fz * 0.4);
    this._autopilot = { ch: deep, path: [back, home], onArrive: () => deep.stopWalking() };
  }

  _seat(ch, side) {
    const s = this.seats[side];
    ch.walk.pos.set(s.x, 0, s.z);
    ch.walk.yaw = s.yaw;
    ch.walk.speed = 0;
    ch.walk.sit = this.sitInfo(side);
  }

  /** Called when the local player goes back to ping pong. */
  onMatchResume() {
    if (this.game.net) return;
    const deep = this.game.players[1 - this.game.localSide];
    this._autopilot = null;
    if (deep.walk) deep.stopWalking();
  }

  _tickAutopilot(dt) {
    const ap = this._autopilot;
    if (!ap) return;
    const w = ap.ch.walk;
    if (!w) return (this._autopilot = null);
    const wp = ap.path[0];
    const dx = wp.x - w.pos.x;
    const dz = wp.z - w.pos.z;
    const d = Math.hypot(dx, dz);
    const step = WALK_SPEED * dt;
    if (d <= step) {
      w.pos.x = wp.x;
      w.pos.z = wp.z;
      ap.path.shift();
      if (!ap.path.length) {
        this._autopilot = null;
        w.speed = 0;
        ap.onArrive?.();
      }
      return;
    }
    w.pos.x += (dx / d) * step;
    w.pos.z += (dz / d) * step;
    const yaw = Math.atan2(dx, dz);
    w.yaw += Math.atan2(Math.sin(yaw - w.yaw), Math.cos(yaw - w.yaw)) * Math.min(1, dt * 10);
    w.speed = WALK_SPEED;
  }

  // ----------------------------------------------------------------- input

  _bindInput(dom) {
    dom.addEventListener('pointermove', (e) => {
      if (!this.seated) return;
      const s = this._pick(e);
      if (s !== this.hover) {
        this.hover = s;
        this._updateMarkers();
      }
    });
    dom.addEventListener('pointerdown', (e) => {
      if (!this.seated || e.button !== 0) return;
      const s = this._pick(e);
      if (s < 0 || !this.canMove()) return;
      const p = this.chess.board[s];
      if (this.selected >= 0 && this.selected !== s && this.tryMove(this.selected, s)) return;
      this.selected = p && colorOf(p) === this.myColor && this.selected !== s ? s : -1;
      this._updateMarkers();
    });
    window.addEventListener('keydown', (e) => {
      if (!this.seated || e.target instanceof HTMLInputElement) return;
      if (e.code === 'KeyN') this.newGame();
      if (e.code === 'KeyV') {
        this.view = (this.view + 1) % VIEWS.length;
        this.zoom = 1;
        this.game.hud.message(VIEWS[this.view].name, 'V to change view · scroll to zoom', 1);
      }
    });
    dom.addEventListener(
      'wheel',
      (e) => {
        if (!this.seated) return;
        this.zoom = THREE.MathUtils.clamp(this.zoom * Math.exp(e.deltaY * 0.0015), 0.55, 1.6);
        e.preventDefault();
      },
      { passive: false }
    );
  }

  _pick(e) {
    const r = this.game.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this._ray.setFromCamera(ndc, this.game.camera);
    const hit = new THREE.Vector3();
    if (!this._ray.ray.intersectPlane(this._plane, hit)) return -1;
    return this.worldToSquare(hit);
  }

  // --------------------------------------------------------------- network

  _moveList() {
    return this.chess.history.map(({ move: m }) => [m.from, m.to, m.promo ?? '']);
  }

  _loadMoves(list) {
    this.chess.reset();
    for (const [from, to, promo] of list) if (!this.chess.move({ from, to, promo: promo || 'q' })) break;
    this.rebuildPieces();
  }

  receive(m) {
    if (m.a === 'sit') {
      this.remoteSeated = m.on;
      if (m.on) {
        // Whoever has played further into the game wins the sync.
        if (m.moves && m.moves.length > this.chess.history.length) this._loadMoves(m.moves);
        else if (this.seated) this.game.net?.send({ t: 'chess', a: 'sync', moves: this._moveList() });
        if (this.seated) this.game.hud.message(`${this.game.players[1 - this.game.localSide].def.name} sat down`, 'Your game is on', 2);
      }
      this._updatePanel();
    } else if (m.a === 'sync') {
      if (m.moves.length >= this.chess.history.length) this._loadMoves(m.moves);
      this._updatePanel();
    } else if (m.a === 'move') {
      const mv = this.chess.move({ from: m.from, to: m.to, promo: m.promo || 'q' });
      if (mv) {
        this._showMove(mv);
        this._afterMove();
      }
    } else if (m.a === 'new') {
      this.newGame(true);
    }
  }

  /** Remote player's walk packets say whether they're sitting. */
  /** Online opponent disconnected: the computer finishes the game for them. */
  onOpponentLeft() {
    this.remoteSeated = false;
    if (this.seated && this.opponent === 'ai' && this.chess.turn !== this.myColor) this._scheduleAI();
  }

  applyRemoteSit(side, sitting) {
    const ch = this.game.players[side];
    if (!ch.walk) return;
    if (sitting && !ch.walk.sit) ch.walk.sit = this.sitInfo(side);
    else if (!sitting && ch.walk.sit) {
      ch.walk.sit = null;
      ch.paddle.group.visible = true;
    }
  }

  // ------------------------------------------------------------------- HUD

  _buildPanel() {
    this.panel = document.createElement('div');
    this.panel.className = 'chesspanel';
    this.panel.hidden = true;
    this.panel.innerHTML = `<div class="ct"></div><div class="cs"></div><div class="cm"></div>
      <div class="ck"><span>Click a piece, then a square</span><span><kbd>V</kbd> view</span><span><kbd>C</kbd> narrator</span><span><kbd>N</kbd> new game</span><span><kbd>F</kbd> stand up</span></div>`;
    this.game.hud.el.appendChild(this.panel);
  }

  _updatePanel() {
    if (!this.panel) return;
    const g = this.game;
    const opp = g.players[1 - g.localSide].def.name;
    const $ = (c) => this.panel.querySelector(c);
    $('.ct').textContent = `Chess vs ${opp} · you are ${this.myColor === 'w' ? 'White' : 'Black'}`;
    const st = this.chess.status();
    let line;
    if (st !== 'play') {
      line = st === 'checkmate' ? `Checkmate — ${this.chess.turn === this.myColor ? opp + ' wins' : 'you win!'}` : 'Draw';
    } else if (!this.opponent) line = `Waiting for ${opp} to sit down…`;
    else if (this.opponent === 'ai' && !this._opponentReady()) line = `${opp} is walking over…`;
    else if (this.chess.turn === this.myColor) line = this.chess.inCheck() ? 'Check! Your move' : 'Your move';
    else line = this.opponent === 'ai' ? `${opp} is thinking…` : `${opp}'s move`;
    $('.cs').textContent = line;
    const sans = this.chess.history.map((h) => h.move.san);
    const pairs = [];
    for (let i = 0; i < sans.length; i += 2) pairs.push(`${i / 2 + 1}. ${sans[i]} ${sans[i + 1] ?? ''}`);
    $('.cm').textContent = pairs.slice(-4).join('   ');
  }

  // ---------------------------------------------------------------- update

  update(dt) {
    this._tickAnims(dt);
    this._tickAutopilot(dt);
    if (this._panelT === undefined || (this._panelT -= dt) <= 0) {
      this._panelT = 0.25;
      if (this.seated) this._updatePanel();
    }
  }

  updateCamera(dt) {
    const s = this.seats[this.game.localSide];
    const v = VIEWS[this.view];
    const cx = this.table.x;
    const cz = this.table.z;
    // Seated keeps the old "eyes over your own edge" look; the others hover over the board center.
    const look = new THREE.Vector3(cx + (this.view === 0 ? s.fx * 0.1 : 0), this.top + (this.view === 0 ? 0.12 : 0), cz);
    const want = new THREE.Vector3(cx - s.fx * v.back, this.top + v.up, cz - s.fz * v.back);
    want.sub(look).multiplyScalar(this.zoom).add(look);
    const a = Math.min(1, dt * 6);
    this._camPos.lerp(want, a);
    this._camLook.lerp(look, a);
    this.game.camera.position.copy(this._camPos);
    this.game.camera.lookAt(this._camLook);
  }

}
