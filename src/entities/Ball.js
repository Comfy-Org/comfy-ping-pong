import * as THREE from 'three';
import { BALL } from '../config.js';

const TRAIL = 18;
const MAX_VISUAL_SPIN = 22; // rad/s drawn; real spin is far faster and would strobe at 60 fps
const COLORS = {
  plain: new THREE.Color(0xffffff),
  top: new THREE.Color(0xff5a3c),
  back: new THREE.Color(0x4fa3ff),
  side: new THREE.Color(0xc77dff),
  super: new THREE.Color(0xffc63a),
};

/** Ball with a seam stripe so its rotation reads, a spin-colored trail and a smash glow. */
export class Ball {
  constructor(scene) {
    const r = BALL.radius * BALL.visualScale;
    this.material = new THREE.MeshStandardMaterial({ map: stripeTexture(), emissive: 0x3a2a10, roughness: 0.35 });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), this.material);
    this.mesh.castShadow = true;
    scene.add(this.mesh);
    /** Physics position IS the mesh position. */
    this.pos = this.mesh.position;
    this.vel = new THREE.Vector3();
    /** Angular velocity, rad/s, world space. */
    this.spin = new THREE.Vector3();
    /** While held, the ball sticks to the server's paddle and isn't simulated. */
    this.held = true;
    /** Current flight is a super smash. */
    this.superFlight = false;

    this.trail = new THREE.InstancedMesh(
      new THREE.SphereGeometry(r * 0.8, 8, 6),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false }),
      TRAIL
    );
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 2;
    scene.add(this.trail);
    this._hist = Array.from({ length: TRAIL }, () => new THREE.Vector3());
    this._histN = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._axis = new THREE.Vector3();
    this._dq = new THREE.Quaternion();

    this.glow = new THREE.PointLight(0xffb020, 0, 1.6, 2);
    scene.add(this.glow);
  }

  /** Classify current spin for UI/trail: 'top' | 'back' | 'side' | 'plain'. */
  spinKind() {
    const h = Math.hypot(this.vel.x, this.vel.z) || 1;
    const top = (this.spin.x * this.vel.z - this.spin.z * this.vel.x) / h; // spin · (up × dir)
    const side = this.spin.y;
    if (Math.abs(top) < 35 && Math.abs(side) < 35) return 'plain';
    if (Math.abs(side) > Math.abs(top)) return 'side';
    return top > 0 ? 'top' : 'back';
  }

  clearTrail() {
    this._histN = 0;
  }

  update(dt) {
    // Visual rotation (capped so it doesn't strobe).
    const w = this.spin.length();
    if (w > 1e-3 && !this.held) {
      this._axis.copy(this.spin).divideScalar(w);
      this._dq.setFromAxisAngle(this._axis, Math.min(w, MAX_VISUAL_SPIN + w * 0.05) * dt);
      this.mesh.quaternion.premultiply(this._dq);
    }

    // Trail history.
    if (this.held) this._histN = 0;
    else {
      this._hist.unshift(this._hist.pop().copy(this.pos));
      this._histN = Math.min(TRAIL, this._histN + 1);
    }
    const kind = this.superFlight ? 'super' : this.spinKind();
    const color = COLORS[kind];
    const n = this._histN;
    for (let i = 0; i < TRAIL; i++) {
      const s = i < n && i > 0 ? (1 - i / TRAIL) * (this.superFlight ? 1.25 : 0.9) : 0;
      this._m.compose(this._hist[i], this._q, this._s.setScalar(s));
      this.trail.setMatrixAt(i, this._m);
      this.trail.setColorAt(i, color);
    }
    this.trail.instanceMatrix.needsUpdate = true;
    if (this.trail.instanceColor) this.trail.instanceColor.needsUpdate = true;
    this.trail.material.opacity = this.superFlight ? 0.7 : kind === 'plain' ? 0.18 : 0.4;

    // Smash glow.
    const target = this.superFlight && !this.held ? 2.5 : 0;
    this.glow.intensity += (target - this.glow.intensity) * Math.min(1, dt * 12);
    this.glow.position.copy(this.pos);
    this.material.emissive.setHex(this.superFlight ? 0xb86a00 : 0x3a2a10);
  }
}

function stripeTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#fff2df';
  g.fillRect(0, 0, 128, 64);
  g.fillStyle = '#f97316';
  g.fillRect(0, 27, 128, 10); // equator band
  g.fillStyle = '#1e293b';
  g.beginPath();
  g.arc(32, 16, 6, 0, Math.PI * 2);
  g.arc(96, 48, 6, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
