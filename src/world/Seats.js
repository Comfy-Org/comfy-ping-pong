import * as THREE from 'three';
import { Terminal } from '../computer/Terminal.js';

/**
 * Sitting down anywhere: every chair, stool, sofa, booth and beanbag in the office.
 * Walk up, press F, and your character sits (the same seated pose as chess). Sofas,
 * benches and booths have a seat per person. Any movement key, F or Esc stands you up.
 *
 * Desk chairs with a monitor in front are computers: sitting there flies the camera
 * into the screen and starts the work program (src/computer/Terminal.js).
 */

/** Seatable props (their seats face +Z; `flip` is for a model whose seat faces -Z). */
const SEATABLE = [
  { re: /office_chair_mesh|cafe_chair|dining_chair_black|shop_stool/ },
  { re: /^sofa\.glb|sectional_sofa|green_booth|booth_bench_grey/, bench: true },
  { re: /lounge_chair|beanbag/ },
];

export class Seats {
  /**
   * @param skip seats already used by something else (the chess chairs): [{x, z}]
   */
  constructor(game, explore, props, skip = []) {
    this.game = game;
    this.explore = explore;
    this.list = [];
    this.current = null;
    this._camPos = new THREE.Vector3();
    this._camLook = new THREE.Vector3();
    this.terminal = new Terminal(game, () => this.stand());
    const monitors = props.filter((p) => /monitor_/.test(p.file)).map((p) => p.obj);
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);

    for (const { file, obj } of props) {
      const kind = SEATABLE.find((k) => k.re.test(file));
      if (!kind) continue;
      if (skip.some((s) => Math.hypot(s.x - obj.position.x, s.z - obj.position.z) < 0.3)) continue;
      // The prop's footprint in its own frame.
      // (Read the heading from the matrix: the Euler angles can come back as an equivalent
      // x/z-flipped triplet, where .rotation.y alone is wrong.)
      obj.updateMatrixWorld(true);
      const m = obj.matrixWorld.elements;
      const rot = Math.atan2(m[8], m[10]);
      const q = obj.quaternion.clone();
      obj.rotation.set(0, 0, 0);
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj);
      obj.quaternion.copy(q);
      obj.updateMatrixWorld(true);
      const width = box.max.x - box.min.x;
      const depth = box.max.z - box.min.z;
      // In the prop's own frame: the backrest is at the back (min z, or max z for flipped models).
      const midX = (box.min.x + box.max.x) / 2 - obj.position.x;
      const back = (kind.flip ? -box.max.z : box.min.z) + (kind.flip ? obj.position.z : -obj.position.z);
      const cushion = kind.bench ? back + Math.min(0.5, depth * 0.45) : (box.min.z + box.max.z) / 2 - obj.position.z;
      const yaw = rot + (kind.flip ? Math.PI : 0); // the way a seated person faces
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const rx = Math.cos(yaw); // to the seated person's left
      const rz = -Math.sin(yaw);
      // Benches: one seat per ~0.7 m of the backrest's length (an L-sofa's chaise is left alone).
      const n = kind.bench ? Math.max(1, Math.floor((width - 0.3) / 0.7)) : 1;
      const lx = kind.flip ? -midX : midX;
      for (let i = 0; i < n; i++) {
        const along = lx + (n === 1 ? 0 : (i - (n - 1) / 2) * 0.7);
        const x = obj.position.x + fx * cushion + rx * along;
        const z = obj.position.z + fz * cushion + rz * along;
        ray.set(new THREE.Vector3(x, 2.5, z), down);
        // The first hit from above should be the seat cushion; skip spots that miss or hit the backrest.
        const hit = ray.intersectObject(obj, true)[0];
        if (!hit || hit.point.y < 0.2 || hit.point.y > 0.75) continue;
        const seat = { x, z, yaw, fx, fz, seatY: hit.point.y, file, depth };
        if (/office_chair_mesh/.test(file)) seat.monitor = facingMonitor(seat, monitors);
        this.list.push(seat);
      }
    }
  }

  /** Spots for Explore's F prompt. */
  spots() {
    return this.list.map((seat) => ({
      id: 'seat',
      label: seat.monitor ? 'Use the computer' : 'Sit down',
      x: seat.x + seat.fx * 0.45,
      z: seat.z + seat.fz * 0.45,
      r: 0.6,
      seat,
    }));
  }

  sit(seat) {
    const g = this.game;
    const me = g.players[g.localSide];
    // Someone else already there?
    const taken = g.players.some((p) => p !== me && p.walk?.pos && Math.hypot(p.walk.pos.x - seat.x, p.walk.pos.z - seat.z) < 0.35);
    if (taken) return g.hud.message('Taken', '', 1);
    this.current = seat;
    Object.assign(me.walk, { speed: 0, target: null });
    me.walk.pos.set(seat.x, 0, seat.z);
    me.walk.yaw = seat.yaw;
    // No table in front: hands rest on the lap.
    const table = seat.monitor ? { top: 0.74 } : { top: seat.seatY + 0.1 };
    me.walk.sit = { y: seat.seatY, x: seat.x, z: seat.z, yaw: seat.yaw, table };
    this._camPos.copy(g.camera.position);
    this._camLook.copy(g._lookAt ?? new THREE.Vector3(seat.x, 1, seat.z));
    g.hud.setPrompt(seat.monitor ? '' : '<kbd>F</kbd> Stand up');
    g.emit('sit', { file: seat.file, computer: !!seat.monitor });
    if (seat.monitor) {
      g.hud.el.classList.add('seated');
      this._zoomT = 0;
    }
  }

  stand() {
    const seat = this.current;
    if (!seat) return;
    const g = this.game;
    const me = g.players[g.localSide];
    this.terminal.close();
    this.current = null;
    me.walk.sit = null;
    me.walk.reach = null;
    me.walk.pos.set(seat.x + seat.fx * 0.55, 0, seat.z + seat.fz * 0.55);
    me.walk.yaw = seat.yaw;
    this.explore.yaw = seat.yaw + Math.PI; // camera behind you
    g.hud.el.classList.remove('seated');
    g.hud.setPrompt('');
  }

  /** Per frame while seated. */
  update(dt) {
    const seat = this.current;
    const k = this.explore.keys;
    if (!this.terminal.open && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].some((c) => k.has(c))) {
      return this.stand();
    }
    if (!seat.monitor) {
      this.explore._updateCamera(dt, seat, seat.seatY + 0.75);
      return;
    }
    // Fly into the screen, then hand over to the program.
    const m = seat.monitor;
    this._zoomT = Math.min(1, this._zoomT + dt / 1.1);
    const e = this._zoomT * this._zoomT * (3 - 2 * this._zoomT);
    const want = new THREE.Vector3(m.x + m.fx * (0.95 - 0.62 * e), m.y + 0.12 * (1 - e), m.z + m.fz * (0.95 - 0.62 * e));
    const look = new THREE.Vector3(m.x, m.y, m.z);
    const a = Math.min(1, dt * 7);
    this._camPos.lerp(want, a);
    this._camLook.lerp(look, a);
    const cam = this.game.camera;
    cam.position.copy(this._camPos);
    cam.lookAt(this._camLook);
    if (this._zoomT >= 0.85 && !this.terminal.open) this.terminal.show();
  }
}

/** The monitor on the desk in front of a chair, as the point at the middle of its screen. */
function facingMonitor(seat, monitors) {
  let best = null;
  let bestD = 1.6;
  for (const obj of monitors) {
    const dx = obj.position.x - seat.x;
    const dz = obj.position.z - seat.z;
    const d = Math.hypot(dx, dz);
    if (d > bestD || (dx * seat.fx + dz * seat.fz) / d < 0.8) continue;
    best = obj;
    bestD = d;
  }
  if (!best) return null;
  best.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(best);
  // The screen faces the person: back toward the chair.
  return { x: (box.min.x + box.max.x) / 2, y: box.min.y + (box.max.y - box.min.y) * 0.6, z: (box.min.z + box.max.z) / 2, fx: -seat.fx, fz: -seat.fz };
}
