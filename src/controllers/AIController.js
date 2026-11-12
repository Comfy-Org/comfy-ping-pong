import * as THREE from 'three';
import { DIFFICULTY, PLAY, SUPER } from '../config.js';
import { BALL_REST_Y, predictInterception } from '../physics/ballPhysics.js';

const clamp = THREE.MathUtils.clamp;
const rand = (a, b) => a + Math.random() * (b - a);
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 0.75; // ~N(0,1)

/**
 * Predicts where the incoming ball will cross its hit plane, moves there at a
 * capped speed with a per-shot positioning error (so it can whiff), and aims
 * away from the opponent with some aim error (so it can miss the table).
 */
export class AIController {
  constructor(side, difficulty = 'medium') {
    this.side = side;
    this.isHuman = false;
    this.setDifficulty(difficulty);
    this._home = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._offset = new THREE.Vector3();
    this._seenHit = -1;
    this._recalc = 0;
    this._prediction = null;
    this._serveTimer = 0;
  }

  setDifficulty(name) {
    this.difficultyName = name;
    this.cfg = DIFFICULTY[name];
  }

  update(dt, game) {
    const me = game.players[this.side];
    const ball = game.ball;
    this._home.set(clamp(ball.pos.x * 0.4, -0.5, 0.5), 1.05, me.hitPlaneZ);
    let target = this._home;

    if (game.isIncoming(this.side)) {
      if (game.rally.hitCount !== this._seenHit) {
        this._seenHit = game.rally.hitCount;
        this._prediction = null;
        this._recalc = 0;
        const e = this.cfg.positionError * (ball.superFlight ? SUPER.aiErrorMult : 1);
        this._offset.set(gauss() * e, gauss() * e * 0.7, 0);
        // Unforced errors: either whiff entirely or hit it out.
        this._mistake = Math.random() < this.cfg.mistakeRate ? (Math.random() < 0.5 ? 'whiff' : 'out') : null;
        if (this._mistake === 'whiff') this._offset.set(rand(-1, 1), rand(-1, 1), 0).setLength(rand(0.22, 0.32));
        // Full meter: decide now whether this return is a smash.
        if (game.meters[this.side] >= 1 && !this._mistake && Math.random() < this.cfg.superUse) game.armSuper(this.side);
      }
      this._recalc -= dt;
      if (this._recalc <= 0) {
        this._recalc = 0.05;
        this._prediction = predictInterception(ball.pos, ball.vel, ball.spin, me.hitPlaneZ, this.side, game.rally.bounces[this.side] === 0);
      }
      if (this._prediction) target = this._target.copy(this._prediction.point).add(this._offset);
    } else {
      this._prediction = null;
    }

    target.x = clamp(target.x, -PLAY.paddleMaxX, PLAY.paddleMaxX);
    target.y = clamp(target.y, PLAY.paddleMinY, PLAY.paddleMaxY);
    target.z = me.hitPlaneZ;
    me.paddle.moveTo(target, dt, this.cfg.paddleSpeed);

    if (game.phase === 'serveReady' && game.match.server === this.side) {
      this._serveTimer += dt;
      if (this._serveTimer > 1.0) {
        this._serveTimer = 0;
        game.toss(this.side);
      }
    } else {
      this._serveTimer = 0;
    }
  }

  _pickX(game) {
    const oppX = game.players[1 - this.side].paddle.position.x;
    // Usually aim away from where the opponent is standing.
    const away = Math.random() < 0.65 ? -Math.sign(oppX || rand(-1, 1)) : Math.sign(rand(-1, 1));
    return away * rand(0.1, 0.6);
  }

  chooseShot(game) {
    const opp = this.side === 0 ? -1 : 1;
    const e = this.cfg.aimError;
    let x = this._pickX(game) + gauss() * e;
    let depth = rand(0.55, 1.15) + gauss() * e;
    if (this._mistake === 'out') {
      if (Math.random() < 0.5) x = Math.sign(x || 1) * rand(0.82, 1.0);
      else depth = rand(1.42, 1.6);
    }
    return {
      target: new THREE.Vector3(x, BALL_REST_Y, opp * depth),
      speed: this.cfg.shotSpeed * rand(0.85, 1.15),
      // Mostly topspin loops, some backspin pushes, a little sidespin.
      top: rand(-0.4, 1) * this.cfg.spinUse,
      side: gauss() * this.cfg.spinUse * 0.3,
      control: this.cfg.spinControl,
    };
  }

  chooseServe(game) {
    const opp = this.side === 0 ? -1 : 1;
    return {
      target: new THREE.Vector3(this._pickX(game) * 0.8, BALL_REST_Y, opp * rand(0.75, 1.1)),
      // Serves: mostly backspin or sidespin, the way real servers do.
      top: rand(-1, 0.4) * this.cfg.spinUse * 0.8,
      side: gauss() * this.cfg.spinUse * 0.5,
    };
  }
}
