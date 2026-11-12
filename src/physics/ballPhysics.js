import { Vector3 } from 'three';
import { TABLE, BALL, PHYSICS, SPIN } from '../config.js';

export const HALF_L = TABLE.length / 2;
export const HALF_W = TABLE.width / 2;
/** Ball center height when resting on the table surface. */
export const BALL_REST_Y = TABLE.height + BALL.radius;
export const NET_TOP = TABLE.height + TABLE.netHeight;

/** Which side's half a z coordinate is on: 0 = +Z half, 1 = -Z half. */
export const sideOfZ = (z) => (z >= 0 ? 0 : 1);

const _a = new Vector3();
const K_SPIN = 3 / (2 * BALL.radius); // hollow sphere: I = 2/3 m r^2 → Δω = 3 r Δv / (2 r^2)

/**
 * Advance ball state by dt. Pure function over (pos, vel, spin) so the same code
 * drives the live ball, look-ahead prediction and the shot solvers.
 * `spin` is angular velocity (rad/s, world); pass null for a spinless ball.
 * Pushes collision events ({type:'table'|'net'|'floor', ...}) into `events`.
 */
export function stepBall(pos, vel, spin, dt, events) {
  const pz = pos.z;
  const py = pos.y;
  const r = BALL.radius;

  vel.y -= PHYSICS.gravity * dt;
  if (spin) {
    // Magnus: a = k (ω × v). Topspin (ω along up × travel) dips, backspin floats, sidespin curves.
    vel.addScaledVector(_a.crossVectors(spin, vel), SPIN.magnus * dt);
    spin.multiplyScalar(1 - SPIN.decay * dt);
  }
  pos.addScaledVector(vel, dt);

  // Net: crossed the z=0 plane while low enough to touch it.
  if (
    pz !== 0 &&
    pz > 0 !== pos.z > 0 &&
    pos.y - r < NET_TOP &&
    pos.y > TABLE.height &&
    Math.abs(pos.x) < HALF_W + TABLE.netOverhang
  ) {
    pos.z = pz > 0 ? r : -r;
    vel.z *= -BALL.netRestitution;
    vel.x *= 0.5;
    vel.y *= 0.5;
    spin?.multiplyScalar(0.3);
    events?.push({ type: 'net' });
  }

  // Table surface (mirror the overshoot so bounces stay energy-exact for the solver).
  if (
    py >= BALL_REST_Y &&
    pos.y < BALL_REST_Y &&
    vel.y < 0 &&
    Math.abs(pos.x) <= HALF_W &&
    Math.abs(pos.z) <= HALF_L
  ) {
    const vyIn = -vel.y;
    pos.y = BALL_REST_Y + (BALL_REST_Y - pos.y) * BALL.restitution;
    vel.y = vyIn * BALL.restitution;
    if (spin) bounceFriction(vel, spin, vyIn);
    events?.push({ type: 'table', side: sideOfZ(pos.z), x: pos.x, z: pos.z, speed: vel.y });
  } else if (pos.y < r && vel.y < 0) {
    pos.y = r;
    vel.y = -vel.y * BALL.floorRestitution;
    vel.x *= 0.7;
    vel.z *= 0.7;
    spin?.multiplyScalar(0.5);
    events?.push({ type: 'floor', speed: vel.y });
  }
}

/**
 * Coulomb friction at the contact patch. Contact point velocity = v + ω × (−r ŷ):
 *   cx = vx − r ωz ... (ω × −rŷ) = (r ωz, 0, −r ωx)
 * Friction impulse opposes slip, capped so the ball never more than stops slipping (rolls).
 */
function bounceFriction(vel, spin, vyIn) {
  const r = BALL.radius;
  const cx = vel.x + r * spin.z;
  const cz = vel.z - r * spin.x;
  const slip = Math.hypot(cx, cz);
  if (slip < 1e-6) return;
  const jn = (1 + BALL.restitution) * vyIn;
  // 0.4 = full slip → rolling for a hollow sphere (1 / (1 + m r²/I) = 1 / 2.5).
  const alpha = Math.min(0.4, (SPIN.tableFriction * jn) / slip);
  const dvx = -alpha * cx;
  const dvz = -alpha * cz;
  vel.x += dvx;
  vel.z += dvz;
  // Torque from the same impulse applied at r = (0, −R, 0): r × J = (−R dvz, 0, R dvx); Δω = (r × J) · 3 / (2R²).
  spin.x -= K_SPIN * dvz;
  spin.z += K_SPIN * dvx;
}

/**
 * Simulate forward to find where the ball crosses the hit plane of `side`.
 * If `needBounce`, the crossing only counts after a table bounce on that side.
 * Returns { point, velocity, spin, time } or null if it never becomes hittable.
 */
export function predictInterception(pos, vel, spin, planeZ, side, needBounce, maxTime = 3) {
  const p = pos.clone();
  const v = vel.clone();
  const w = spin ? spin.clone() : null;
  const events = [];
  const dt = PHYSICS.step;
  let bounced = !needBounce;
  for (let t = 0; t < maxTime; t += dt) {
    const prevZ = p.z;
    events.length = 0;
    stepBall(p, v, w, dt, events);
    for (const e of events) {
      if (e.type === 'table') {
        if (e.side === side) {
          if (bounced && needBounce) return null; // double bounce before reaching us
          bounced = true;
        }
      } else if (e.type === 'floor') return null;
    }
    const crossed = side === 0 ? prevZ < planeZ && p.z >= planeZ : prevZ > planeZ && p.z <= planeZ;
    if (crossed) return bounced ? { point: p, velocity: v, spin: w, time: t + dt } : null;
  }
  return null;
}

/**
 * Spin vector for a shot travelling along `vel` (horizontal direction used):
 * `top` > 0 is topspin, < 0 backspin; `side` is spin about the vertical axis (curves the ball sideways in flight).
 */
export function spinFor(vel, top, side, out = new Vector3()) {
  const h = Math.hypot(vel.x, vel.z) || 1;
  const dx = vel.x / h;
  const dz = vel.z / h;
  // up × d = (dz, 0, −dx)
  return out.set(top * dz, side, -top * dx);
}
