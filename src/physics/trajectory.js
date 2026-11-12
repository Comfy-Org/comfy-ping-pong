import { Vector3 } from 'three';
import { BALL, PHYSICS } from '../config.js';
import { BALL_REST_Y, NET_TOP, HALF_L, HALF_W, stepBall } from './ballPhysics.js';

const g = PHYSICS.gravity;
const NET_CLEAR = NET_TOP + BALL.radius + 0.03;

/** Gravity-only first guess (exact when there's no spin). */
function ballisticShot(from, target, hSpeed, clearance = NET_CLEAR) {
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  const d = Math.hypot(dx, dz);
  let T = Math.max(d / hSpeed, 0.08);
  let vy = 0;
  for (let i = 0; i < 40; i++) {
    vy = (BALL_REST_Y - from.y + 0.5 * g * T * T) / T;
    const vz = dz / T;
    if (Math.sign(from.z) === Math.sign(target.z) || vz === 0) break;
    const tn = -from.z / vz;
    const yn = from.y + vy * tn - 0.5 * g * tn * tn;
    if (yn >= clearance) break;
    T *= 1.05;
  }
  return new Vector3(dx / T, vy, dz / T);
}

const _p = new Vector3();
const _v = new Vector3();
const _w = new Vector3();
const _ev = [];

/**
 * Fly the ball with the real integrator until its first table bounce.
 * Returns { x, z, side, net, minNetMargin } (x/z = first bounce, or null if it never bounced).
 */
export function simulateToBounce(from, vel, spin, maxTime = 2.5) {
  _p.copy(from);
  _v.copy(vel);
  spin ? _w.copy(spin) : _w.set(0, 0, 0);
  const dt = PHYSICS.step;
  let net = false;
  for (let t = 0; t < maxTime; t += dt) {
    _ev.length = 0;
    stepBall(_p, _v, _w, dt, _ev);
    for (const e of _ev) {
      if (e.type === 'net') net = true;
      if (e.type === 'table') return { x: e.x, z: e.z, side: e.side, net, after: { pos: _p.clone(), vel: _v.clone(), spin: _w.clone() } };
      if (e.type === 'floor') return { x: _p.x, z: _p.z, side: -1, net, floor: true };
    }
  }
  return { x: _p.x, z: _p.z, side: -1, net, floor: true };
}

/**
 * Velocity that sends a ball with `spin` from `from` to land on the table at `target` (xz)
 * at roughly `hSpeed` horizontally. Starts from the ballistic solution, then shoots with the
 * real integrator and corrects the aim point by the landing error. Clears the net by lofting.
 * `spin` is evaluated relative to the final direction via `spinFn(vel)` if given as a function.
 */
function solveShotWithSpin(from, target, hSpeed, getSpin) {
  const aim = new Vector3(target.x, 0, target.z);
  const dir = Math.sign(target.z - from.z);
  let speed = hSpeed;
  let clearance = NET_CLEAR;
  let best = null;
  for (let i = 0; i < 16; i++) {
    const v = ballisticShot(from, aim, speed, clearance);
    const res = simulateToBounce(from, v, getSpin(v));
    if (res.net || (res.side !== -1 && res.side === (from.z >= 0 ? 0 : 1))) {
      clearance += 0.04; // topspin dips it into the net: lift the arc
      if (clearance > NET_CLEAR + 0.2) speed *= 0.9;
      continue;
    }
    if (res.floor) {
      aim.z -= dir * 0.12; // sailed long
      continue;
    }
    const ex = target.x - res.x;
    const ez = target.z - res.z;
    const err = Math.hypot(ex, ez);
    if (!best || err < best.err) best = { v, err };
    if (err < 0.01) break;
    aim.x += ex * 0.9;
    aim.z += ez * 0.9;
  }
  return best;
}

/**
 * Legal serve: bounce once on the server's half (point A), then land at `land` on the
 * receiver's half. Numeric: for a few A depths, scan the speed into A, fly the real
 * integrator (spin, friction, net) and keep the arc landing closest to `land`, preferring
 * flatter (faster) serves on ties. A.x is nudged to correct sideways drift from spin.
 */
function solveServeWithSpin(from, land, getSpin) {
  if (from.y - BALL_REST_Y <= 0.02) return null;
  const serverSign = Math.sign(from.z) || 1;
  const serverSide = serverSign > 0 ? 0 : 1;
  const a = new Vector3();
  let best = null;
  for (const depth of [0.95, 0.8, 0.65, 0.5, 0.35]) {
    const az = serverSign * Math.min(depth, Math.abs(from.z) - 0.1);
    // A lies roughly on the straight line from the server to the target.
    const f = (from.z - az) / (from.z - land.z);
    let ax = from.x + (land.x - from.x) * f;
    for (let hs = 1.8; hs <= 9; hs += 0.3) {
      a.set(ax, BALL_REST_Y, az);
      const v = ballisticShot(from, a, hs);
      const r = evalServe(from, v, getSpin(v), serverSide);
      if (!r) continue;
      const err = Math.hypot(land.x - r.x, land.z - r.z);
      if (!best || err < best.err - 0.01 || (err < best.err + 0.01 && hs > best.hs)) best = { v, err, hs, ax, az };
    }
  }
  if (!best) return null;
  // Refine: fine speed steps + lateral correction around the best candidate.
  for (let i = 0; i < 8 && best.err > 0.01; i++) {
    let improved = false;
    for (const dh of [-0.1, -0.03, 0.03, 0.1]) {
      const hs = best.hs + dh;
      for (const dx of [0, (land.x - (best.lx ?? land.x)) * 0.8]) {
        const ax = best.ax + dx;
        a.set(ax, BALL_REST_Y, best.az);
        const v = ballisticShot(from, a, hs);
        const r = evalServe(from, v, getSpin(v), serverSide);
        if (!r) continue;
        const err = Math.hypot(land.x - r.x, land.z - r.z);
        if (err < best.err) {
          best = { v, err, hs, ax, az: best.az, lx: r.x };
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return best;
}

/** Fly a serve; returns its landing on the receiver's half, or null if it's not legal. */
function evalServe(from, v, spin, serverSide) {
  const first = simulateToBounce(from, v, spin);
  if (first.floor || first.net || first.side !== serverSide || !first.after) return null;
  const second = simulateToBounce(first.after.pos, first.after.vel, first.after.spin);
  if (second.floor || second.net || second.side === serverSide) return null;
  return second;
}

/**
 * Spin is best-effort: if the integrator can't land the ball where asked with the full spin
 * (heavy topspin into the net, heavy backspin floating long), retry with less of it.
 * Returns { vel, spinScale } — the caller applies spin × spinScale.
 */
const SPIN_SCALES = [1, 0.6, 0.3, 0];
const ZERO = new Vector3();
const TOLERANCE = 0.05;

export function solveShot(from, target, hSpeed, spin = null) {
  spin ??= ZERO;
  const getSpin = typeof spin === 'function' ? spin : () => spin;
  for (const k of SPIN_SCALES) {
    const r = solveShotWithSpin(from, target, hSpeed, (v) => getSpin(v).clone().multiplyScalar(k));
    if (r && r.err < TOLERANCE) return { vel: r.v, spinScale: k };
  }
  return { vel: ballisticShot(from, target, hSpeed), spinScale: 0 };
}

export function solveServe(from, land, spin = null) {
  spin ??= ZERO;
  const getSpin = typeof spin === 'function' ? spin : () => spin;
  for (const k of SPIN_SCALES) {
    const r = solveServeWithSpin(from, land, (v) => getSpin(v).clone().multiplyScalar(k));
    if (r && (r.err < TOLERANCE || k === 0)) return { vel: r.v, spinScale: k };
  }
  return null;
}
