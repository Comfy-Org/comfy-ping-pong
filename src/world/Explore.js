import * as THREE from 'three';
import { TABLE } from '../config.js';
import { buildCardTable } from './Props.js';
import { ChessTable } from '../chess/ChessTable.js';
import { zoneAt } from './Floor.js';

/**
 * Free-roam ("explore") mode: walk your avatar around the office.
 *
 *   F at the table  → walk away (the match pauses; a live point is replayed)
 *   WASD / arrows   → walk, relative to the camera · Shift → jog
 *   drag mouse      → orbit camera · wheel → zoom
 *   F near a spot   → interact (ping pong = back to the match)
 *
 * Collision is 2D: a circle for the walker against axis-aligned boxes for the
 * furniture (taken from the office GLBs once they load) and the room walls.
 */

/** The game room (walls at x ±7.5, z ±6.5). Used when the rest of the floor isn't built. */
export const ROOM = { minX: -7.25, maxX: 7.25, minZ: -6.25, maxZ: 6.25, ceiling: 2.7 };
const RADIUS = 0.26;
/** Other characters' footprint (shoulders are wider than the walker's feet circle, but this feels fair). */
const BODY_RADIUS = 0.24;
const WALK = 1.5;
const JOG = 3.3;
const TURN = 10; // rad/s heading slew

/** Furniture that blocks walking (wall art, lights and signs don't). */
const SOLID =
  /cafe_table|cafe_chair|coat_rack|sofa|lounge_chair|ladder_shelf|pingpong_table|booth_bench_grey|booth_table|green_booth|standing_desk|office_chair_mesh|foosball_table|drinks_fridge|fridge_steel|arcade_basketball|rolling_whiteboard|marble_coffee_table|tv_rolling_stand|potted_tree|kids_bookshelf|beanbag|dining_table_wood|dining_chair_black|kitchen_island|floor_lamp_paper|coffee_bar|high_top_table|printer_bench|shop_stool/;

export class Explore {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.keys = new Set();
    this.colliders = [
      // Ping-pong table (procedural fallback; replaced by the GLB's box when it loads).
      { minX: -TABLE.width / 2, maxX: TABLE.width / 2, minZ: -TABLE.length / 2, maxZ: TABLE.length / 2, name: 'pingpong' },
    ];
    this.spots = [];
    // Where the walker's centre may be, and the camera (rest of the floor adds to these).
    this.rects = [{ minX: ROOM.minX + RADIUS, maxX: ROOM.maxX - RADIUS, minZ: ROOM.minZ + RADIUS, maxZ: ROOM.maxZ - RADIUS }];
    this.camRects = [{ minX: ROOM.minX + 0.1, maxX: ROOM.maxX - 0.1, minZ: ROOM.minZ - 0.15, maxZ: ROOM.maxZ + 0.15, top: ROOM.ceiling - 0.1 }];
    this.zone = null;
    this.visited = new Set();
    this.yaw = 0; // camera orbit around the player
    this.pitch = 0.32;
    this.dist = 3.2;
    this._camPos = new THREE.Vector3();
    this._camLook = new THREE.Vector3();
    this._move = new THREE.Vector3();
    this._dragging = false;
    this._nearSpot = null;

    game.officeReady.then(() => this._buildWorld());
    this._bindInput(game.renderer.domElement);
  }

  // ----------------------------------------------------------------- world

  _buildWorld() {
    const props = this.game.arena.props ?? [];
    const box = new THREE.Box3();
    const tables = [];
    for (const { file, obj } of props) {
      if (!SOLID.test(file)) continue;
      obj.updateMatrixWorld(true);
      box.setFromObject(obj);
      const c = { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z, top: box.max.y, name: file.replace('.glb', '') };
      if (file === 'pingpong_table.glb') this.colliders[0] = { ...c, name: 'pingpong' };
      else this.colliders.push(c);
      // Only the game room's café tables host chess and cards.
      if (file === 'cafe_table.glb' && c.minZ > ROOM.minZ - 0.3) tables.push({ x: (c.minX + c.maxX) / 2, z: (c.minZ + c.maxZ) / 2, top: c.top });
    }

    const floor = this.game.arena.floor;
    if (floor) {
      this.colliders.push(...floor.colliders);
      this.rects = floor.rects;
      this.camRects = floor.camRects;
      this.camBlocks = floor.camBlocks;
    }

    // Activity spots. Ping pong is live; the café tables get chess and cards (coming next).
    const scene = this.game.scene;
    const back = tables.filter((t) => t.z < 0).sort((a, b) => a.x - b.x);
    if (back[0]) {
      const t = back[0];
      // The two chairs facing this table, with their seat height (raycast down onto the seat).
      const ray = new THREE.Raycaster();
      const chairs = props
        .filter((p) => p.file === 'cafe_chair.glb')
        .map((p) => ({ obj: p.obj, x: p.obj.position.x, z: p.obj.position.z }))
        .sort((a, b) => Math.hypot(a.x - t.x, a.z - t.z) - Math.hypot(b.x - t.x, b.z - t.z))
        .slice(0, 2)
        .map((c) => {
          ray.set(new THREE.Vector3(c.x, 2, c.z), new THREE.Vector3(0, -1, 0));
          const hit = ray.intersectObject(c.obj, true)[0];
          return { x: c.x, z: c.z, seatY: hit ? hit.point.y : 0.42 };
        });
      if (chairs.length === 2) {
        this.chess = new ChessTable(this.game, this, { x: t.x, z: t.z, top: t.top }, chairs);
        this.spots.push({ id: 'chess', label: 'Play chess', x: t.x, z: t.z, r: 1.3 });
      }
    }
    if (back[1]) {
      const set = buildCardTable();
      set.position.set(back[1].x, back[1].top, back[1].z);
      scene.add(set);
      this.spots.push({ id: 'cards', label: 'Cards', x: back[1].x, z: back[1].z, r: 1.3, soon: true });
    }
    const sofa = props.find((p) => p.file === 'sofa.glb');
    if (sofa) this.spots.push({ id: 'sofa', label: 'Sit on the sofa', x: sofa.obj.position.x, z: sofa.obj.position.z - 0.6, r: 1.1, soon: true });
  }

  /** The place you stand to play, for each side. */
  tableSpot(side) {
    const p = this.game.players[side];
    return { x: p.paddle.position.x, z: p.hitPlaneZ - p.facing * 0.3 };
  }

  // ------------------------------------------------------------------ input

  _bindInput(dom) {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.code);
      if (e.code === 'KeyF') this._onF();
      if (this.active && e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('pointerdown', (e) => {
      if (!this.active || this.chess?.seated) return;
      this._dragging = true;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
    });
    window.addEventListener('pointerup', () => (this._dragging = false));
    window.addEventListener('pointermove', (e) => {
      if (!this.active || !this._dragging) return;
      this.yaw -= (e.clientX - this._lastX) * 0.006;
      this.pitch = THREE.MathUtils.clamp(this.pitch + (e.clientY - this._lastY) * 0.004, 0.05, 1.1);
      this._lastX = e.clientX;
      this._lastY = e.clientY;
    });
    dom.addEventListener(
      'wheel',
      (e) => {
        if (!this.active || this.chess?.seated) return;
        this.dist = THREE.MathUtils.clamp(this.dist + e.deltaY * 0.003, 1.4, 6);
        e.preventDefault();
      },
      { passive: false }
    );
  }

  _onF() {
    const g = this.game;
    if (!this.active) {
      if (g.canWalkAway()) this.enter();
      return;
    }
    if (this.chess?.seated) return this.chess.stand();
    const spot = this._nearSpot;
    if (!spot) return;
    if (spot.id === 'pingpong') this.exit();
    else if (spot.id === 'chess' && this.chess) this.chess.sit();
    else {
      if (spot.locked) g.hud.message('Locked', 'Nice try', 1.5);
      else if (!g.narrator?.on) g.hud.message(spot.label, spot.soon ? 'Coming soon — we’re building this next' : '', 1.8);
      g.emit('spot', { id: spot.id });
    }
  }

  // ---------------------------------------------------------------- enter/exit

  /** `start`: the game opens in the office (not a walk-away from a match). */
  enter({ start = false } = {}) {
    const g = this.game;
    const me = g.players[g.localSide];
    this.active = true;
    // Camera starts where the match camera was looking from: behind the player.
    this.yaw = me.facing < 0 ? 0 : Math.PI;
    this.pitch = 0.32;
    this._camPos.copy(g.camera.position);
    this._camLook.copy(g._lookAt);
    me.startWalking();
    me.setOpacity(1);
    me.label.visible = false;
    g.renderer.domElement.style.cursor = 'grab';
    g.hud.setMode('explore');
    g.onWalkAway();
    g.emit(start ? 'officeStart' : 'walkAway');
  }

  exit() {
    const g = this.game;
    const me = g.players[g.localSide];
    this.active = false;
    this.chess?.onMatchResume();
    me.stopWalking();
    g.renderer.domElement.style.cursor = '';
    g._applyViewpoint();
    g.hud.setPrompt('');
    g.hud.setMode('match');
    g.onWalkBack();
    g.emit('walkBack');
  }

  // ----------------------------------------------------------------- update

  update(dt) {
    this.chess?.update(dt);
    this.game.arena.floor?.update(this.active && !this.chess?.seated ? this.game.players[this.game.localSide].walk?.pos : null);
    if (!this.active) return;
    const g = this.game;
    const me = g.players[g.localSide];
    const w = me.walk;
    if (this.chess?.seated) {
      this._nearSpot = null;
      this.chess.updateCamera(dt);
      return;
    }

    // Input → desired direction, relative to the camera's yaw.
    const k = this.keys;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    // Camera looks along -(sin yaw, cos yaw) toward the player… forward = away from camera.
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    this._move.set(fx * f - fz * r, 0, fz * f + fx * r);
    const moving = this._move.lengthSq() > 0;
    const speed = moving ? (k.has('ShiftLeft') || k.has('ShiftRight') ? JOG : WALK) : 0;
    if (moving) {
      this._move.normalize();
      const target = Math.atan2(this._move.x, this._move.z);
      w.yaw += wrapAngle(target - w.yaw) * Math.min(1, dt * TURN);
    }
    w.speed += (speed - w.speed) * Math.min(1, dt * 8);
    w.pos.x += this._move.x * w.speed * dt;
    w.pos.z += this._move.z * w.speed * dt;
    this.collide(w.pos);
    // Pushing into a wall for a moment counts as a bump (the narrator keeps score).
    this._wallPush = moving && this._hitWall ? (this._wallPush ?? 0) + dt : 0;
    if (this._wallPush > 0.6 && !this._bumped) g.emit('bumpWall');
    this._bumped = this._wallPush > 0.6;

    this._updateZone(w.pos);
    this._updateSpots(w.pos);
    this._updateCamera(dt, w.pos);
  }

  /** Push a point out of furniture and keep it in the room. */
  collide(p, self = this.game.players[this.game.localSide]) {
    // Other characters are circles too: walking into someone stops you (and they shove you if they walk into you).
    for (const other of this.game.players) {
      if (other === self || !other.root.visible) continue;
      const o = other.walk?.pos ?? other.root.position;
      const dx = p.x - o.x;
      const dz = p.z - o.z;
      const min = RADIUS + BODY_RADIUS;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2);
      if (d > 1e-6) {
        p.x = o.x + (dx / d) * min;
        p.z = o.z + (dz / d) * min;
      } else p.x = o.x + min;
    }
    for (const c of this.colliders) {
      const cx = THREE.MathUtils.clamp(p.x, c.minX, c.maxX);
      const cz = THREE.MathUtils.clamp(p.z, c.minZ, c.maxZ);
      const dx = p.x - cx;
      const dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= RADIUS * RADIUS) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        p.x = cx + (dx / d) * RADIUS;
        p.z = cz + (dz / d) * RADIUS;
      } else {
        // Center is inside the box: leave by the nearest face.
        const out = [p.x - c.minX, c.maxX - p.x, p.z - c.minZ, c.maxZ - p.z];
        const i = out.indexOf(Math.min(...out));
        if (i === 0) p.x = c.minX - RADIUS;
        else if (i === 1) p.x = c.maxX + RADIUS;
        else if (i === 2) p.z = c.minZ - RADIUS;
        else p.z = c.maxZ + RADIUS;
      }
    }
    // Stay inside the walkable rectangles (rooms and doorways): if outside all of them,
    // step back to the nearest point of the nearest one.
    const bx = p.x;
    const bz = p.z;
    if (!this.rects.some((r) => p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ)) {
      let best = null;
      let bestD = Infinity;
      for (const r of this.rects) {
        const x = THREE.MathUtils.clamp(bx, r.minX, r.maxX);
        const z = THREE.MathUtils.clamp(bz, r.minZ, r.maxZ);
        const d = (x - bx) ** 2 + (z - bz) ** 2;
        if (d < bestD) (bestD = d), (best = { x, z });
      }
      p.x = best.x;
      p.z = best.z;
    }
    if (self === this.game.players[this.game.localSide]) this._hitWall = bx !== p.x || bz !== p.z;
  }

  /** Which part of the office you're in: its name shows briefly as you walk in (GTA-style). */
  _updateZone(pos) {
    const z = zoneAt(pos.x, pos.z);
    if (!z || z.id === this.zone) return;
    const initial = this.zone === null; // where you start doesn't get announced
    const first = !this.visited.has(z.id);
    this.zone = z.id;
    this.visited.add(z.id);
    if (initial) return;
    this.game.hud.message(z.name, '', 1.4);
    this.game.emit('zoneEnter', { id: z.id, first });
  }

  _updateSpots(pos) {
    const g = this.game;
    const home = this.tableSpot(g.localSide);
    const all = [{ id: 'pingpong', label: 'Play ping pong', x: home.x, z: home.z, r: 1.2 }, ...this.spots];
    let best = null;
    let bestD = Infinity;
    for (const s of all) {
      const d = Math.hypot(pos.x - s.x, pos.z - s.z);
      if (d < s.r && d < bestD) {
        best = s;
        bestD = d;
      }
    }
    this._nearSpot = best;
    g.hud.setPrompt(best ? `<kbd>F</kbd> ${best.label}${best.soon ? ' <em>soon</em>' : ''}` : '');
  }

  _updateCamera(dt, pos) {
    const cam = this.game.camera;
    const look = new THREE.Vector3(pos.x, 1.45, pos.z);
    const cp = Math.cos(this.pitch);
    const want = new THREE.Vector3(
      pos.x + Math.sin(this.yaw) * this.dist * cp,
      1.45 + Math.sin(this.pitch) * this.dist,
      pos.z + Math.cos(this.yaw) * this.dist * cp
    );
    // Don't let the camera leave the building: pull it in along the view ray.
    const within = (v, r) => v.x > r.minX && v.x < r.maxX && v.z > r.minZ && v.z < r.maxZ;
    const inside = (v) => this.camRects.some((r) => within(v, r) && v.y < r.top) && !this.camBlocks?.some((r) => within(v, r));
    for (let i = 0; i < 20 && !inside(want); i++) want.lerp(look, 0.12);
    const a = Math.min(1, dt * 8);
    this._camPos.lerp(want, a);
    this._camLook.lerp(look, a);
    cam.position.copy(this._camPos);
    cam.lookAt(this._camLook);
  }
}

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
