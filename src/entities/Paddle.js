import * as THREE from 'three';

const _tmp = new THREE.Vector3();

/**
 * A paddle whose world position is driven directly by a controller.
 * `position` is the center of the blade (the contact point).
 */
export class Paddle {
  constructor({ rubberColor = 0xd32f2f, facing = -1 } = {}) {
    this.facing = facing; // -1 hits toward -Z, +1 toward +Z
    this.group = new THREE.Group();
    this.pivot = new THREE.Group(); // swing rotation happens here
    this.group.add(this.pivot);

    const front = new THREE.Mesh(
      new THREE.CylinderGeometry(0.076, 0.076, 0.005, 32),
      new THREE.MeshStandardMaterial({ color: rubberColor, roughness: 0.7 })
    );
    front.rotation.x = Math.PI / 2;
    front.position.z = 0.004 * facing;
    const back = new THREE.Mesh(
      new THREE.CylinderGeometry(0.076, 0.076, 0.005, 32),
      new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.7 })
    );
    back.rotation.x = Math.PI / 2;
    back.position.z = -0.004 * facing;
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.026, 0.1, 0.022),
      new THREE.MeshStandardMaterial({ color: 0xc89b6a, roughness: 0.6 })
    );
    handle.position.y = -0.12;
    for (const m of [front, back, handle]) {
      m.castShadow = true;
      this.pivot.add(m);
    }

    this.position = this.group.position;
    this.velocity = new THREE.Vector3();
    this._prev = new THREE.Vector3();
    this._swing = 0;
  }

  /** Where the arm should attach (bottom of the handle) in world space. */
  getGripWorld(out, y = -0.16) {
    return out.set(0, y, 0).applyMatrix4(this.pivot.matrixWorld);
  }

  /** Move toward target, optionally speed-limited (AI). Tracks smoothed velocity. */
  moveTo(target, dt, maxSpeed = Infinity) {
    this._prev.copy(this.position);
    _tmp.subVectors(target, this.position);
    const maxStep = maxSpeed * dt;
    if (_tmp.length() > maxStep) _tmp.setLength(maxStep);
    this.position.add(_tmp);
    if (dt > 0) {
      _tmp.subVectors(this.position, this._prev).divideScalar(dt);
      this.velocity.lerp(_tmp, 0.35);
    }
  }

  swing() {
    this._swing = 1;
  }

  update(dt) {
    this._swing = Math.max(0, this._swing - dt * 5);
    const s = Math.sin(this._swing * Math.PI);
    this.pivot.rotation.x = this.facing * s * 0.9;
    this.pivot.rotation.z = THREE.MathUtils.clamp(-this.velocity.x * 0.08, -0.5, 0.5);
  }
}
