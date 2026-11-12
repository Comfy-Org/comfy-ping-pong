import * as THREE from 'three';

/** Drives the opponent's paddle from network updates, smoothed between packets. */
export class RemoteController {
  constructor(side) {
    this.side = side;
    this.isHuman = false;
    this.isRemote = true;
    this.pressed = false;
    this._target = null;
    this._tmp = new THREE.Vector3();
  }

  receive(m) {
    (this._target ??= new THREE.Vector3()).set(m.x, m.y, m.z);
    this.pressed = !!m.p;
    this.armed = !!m.a;
  }

  update(dt, game) {
    if (!this._target) return;
    const paddle = game.players[this.side].paddle;
    paddle.moveTo(this._tmp.copy(paddle.position).lerp(this._target, Math.min(1, dt * 20)), dt);
  }
}
