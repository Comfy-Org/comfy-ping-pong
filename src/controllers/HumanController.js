import * as THREE from 'three';
import { PLAY, SHOTS, SPIN } from '../config.js';
import { BALL_REST_Y } from '../physics/ballPhysics.js';

const clamp = THREE.MathUtils.clamp;

/**
 * Mouse/touch control: the paddle sits exactly under the cursor on the hit
 * plane. Contact is automatic; aim comes from how you're moving the paddle
 * (swipe left/right to angle), holding the button at contact = power shot.
 * Click / Space tosses the serve.
 * Spin comes from the paddle's motion at contact: brush up = topspin, chop down = backspin,
 * sideways = sidespin. E / Shift / right-click arms the super smash when the meter is full.
 */
export class HumanController {
  constructor(side, camera, dom) {
    this.side = side;
    this.camera = camera;
    this.dom = dom;
    this.isHuman = true;
    this.pointer = new THREE.Vector2(0, -0.3);
    this.pressed = false;
    this.wantsServe = false;
    this.wantsSuper = false;
    this._ray = new THREE.Raycaster();
    this._plane = new THREE.Plane();
    this._target = new THREE.Vector3(0, 1, 0);

    dom.addEventListener('pointermove', (e) => this._onMove(e));
    dom.addEventListener('pointerdown', (e) => {
      this._onMove(e);
      if (e.button !== 0) return;
      this.pressed = true;
      this.wantsServe = true;
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.pressed = false;
    });
    dom.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.wantsSuper = true;
    });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space') {
        this.wantsServe = true;
        e.preventDefault();
      } else if (e.code === 'KeyE' || e.key === 'Shift') {
        this.wantsSuper = true;
      }
    });
  }

  _onMove(e) {
    const r = this.dom.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  update(dt, game) {
    const me = game.players[this.side];
    this._plane.set(new THREE.Vector3(0, 0, 1), -me.hitPlaneZ);
    this._ray.setFromCamera(this.pointer, this.camera);
    if (this._ray.ray.intersectPlane(this._plane, this._target)) {
      this._target.x = clamp(this._target.x, -PLAY.paddleMaxX, PLAY.paddleMaxX);
      this._target.y = clamp(this._target.y, PLAY.paddleMinY, PLAY.paddleMaxY);
      this._target.z = me.hitPlaneZ;
    }
    me.paddle.moveTo(this._target, dt);

    if (this.wantsSuper) {
      this.wantsSuper = false;
      game.armSuper(this.side);
    }
    if (this.wantsServe) {
      this.wantsServe = false;
      if (game.phase === 'serveReady' && game.match.server === this.side) game.toss(this.side);
    }
  }

  _aim(game) {
    const v = game.players[this.side].paddle.velocity;
    const opp = this.side === 0 ? -1 : 1;
    const x = clamp(v.x * SHOTS.humanAimGain, -0.64, 0.64);
    return { x, opp, v };
  }

  /** Topspin/backspin from vertical paddle speed, sidespin from horizontal. */
  _spin(v, gainScale = 1) {
    return {
      top: clamp(v.y * SPIN.humanTopGain * gainScale, -SPIN.max, SPIN.max),
      side: clamp(-v.x * SPIN.humanSideGain * gainScale * (this.side === 0 ? 1 : -1), -SPIN.max * 0.6, SPIN.max * 0.6),
    };
  }

  chooseShot(game) {
    const { x, opp, v } = this._aim(game);
    const spin = this._spin(v);
    // Brushing hard with the ball (either way) is what controls incoming spin.
    const control = clamp(SPIN.passiveControl + Math.hypot(v.x, v.y) * 0.12, 0, 0.9);
    const power = this.pressed;
    // Pushing the paddle up through contact sends it deeper.
    const depth = clamp((power ? 1.1 : 0.85) + v.y * 0.04, 0.45, 1.25);
    return {
      target: new THREE.Vector3(x, BALL_REST_Y, opp * depth),
      speed: power ? SHOTS.humanPowerSpeed : SHOTS.humanSpeed,
      ...spin,
      control,
    };
  }

  chooseServe(game) {
    const { x, opp, v } = this._aim(game);
    return { target: new THREE.Vector3(x * 0.8, BALL_REST_Y, opp * 0.95), ...this._spin(v, 0.8) };
  }
}
