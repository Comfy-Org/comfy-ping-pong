import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PLAY } from '../config.js';
import { Paddle } from '../entities/Paddle.js';

/** Bone names on the Meshy humanoid rig (shared by Matt & Deep). */
export const RIG = {
  rightArm: 'RightArm',
  rightForeArm: 'RightForeArm',
  rightHand: 'RightHand',
  leftArm: 'LeftArm',
  leftForeArm: 'LeftForeArm',
  leftHand: 'LeftHand',
  spine: 'Spine01',
};

/** Leg bones, used for the procedural walk cycle. */
const LEGS = { hips: 'Hips', lUp: 'LeftUpLeg', lLow: 'LeftLeg', rUp: 'RightUpLeg', rLow: 'RightLeg' };

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _bp = new THREE.Vector3();
const _ep = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _bq = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const UP_W = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _cur = new THREE.Vector3();

/** Turn `bone` (in world space) so the direction from it to `child` points along `dir`. */
function alignBone(bone, child, dir) {
  if (!bone || !child) return;
  bone.getWorldPosition(_bp);
  child.getWorldPosition(_ep);
  _cur.subVectors(_ep, _bp);
  if (_cur.lengthSq() < 1e-10) return;
  _q.setFromUnitVectors(_cur.normalize(), dir.normalize());
  bone.getWorldQuaternion(_bq).premultiply(_q);
  bone.parent.getWorldQuaternion(_pq).invert();
  bone.quaternion.copy(_pq.multiply(_bq));
  bone.updateMatrixWorld(true);
}
const _IDENT = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _rq = new THREE.Quaternion();

/** Rotate a bone by `angle` about a WORLD-space axis (works whatever the bone's local frame is). */
function rotateBoneWorld(bone, axis, angle) {
  _rq.setFromAxisAngle(axis, angle);
  bone.getWorldQuaternion(_bq).premultiply(_rq);
  bone.parent.getWorldQuaternion(_pq).invert();
  bone.quaternion.copy(_pq.multiply(_bq));
  bone.updateMatrixWorld(true);
}

/**
 * CCD IK over a bone chain (root → tip) so `effector` reaches `target` (world).
 * Works from any starting pose, which matters because the rig rests in a T-pose.
 */
function solveCCD(chain, effector, target, iterations = 8, weights = null) {
  for (let it = 0; it < iterations; it++) {
    for (let i = chain.length - 1; i >= 0; i--) {
      const bone = chain[i];
      bone.getWorldPosition(_bp);
      effector.getWorldPosition(_ep);
      _a.subVectors(_ep, _bp);
      _b.subVectors(target, _bp);
      if (_a.lengthSq() < 1e-8 || _b.lengthSq() < 1e-8) continue;
      _q.setFromUnitVectors(_a.normalize(), _b.normalize());
      if (weights && weights[i] < 1) _q.slerp(_IDENT, 1 - weights[i]);
      bone.getWorldQuaternion(_bq).premultiply(_q);
      bone.parent.getWorldQuaternion(_pq).invert();
      bone.quaternion.copy(_pq.multiply(_bq));
      bone.updateMatrixWorld(true);
    }
  }
}

/**
 * A player avatar. The paddle is the gameplay object (driven by a controller);
 * the body follows it. With a rigged model, the right hand is IK'd onto the
 * paddle grip every frame and emote clips take over during celebrations.
 */
export class Character {
  constructor(def, side) {
    this.def = def;
    this.side = side;
    this.facing = side === 0 ? -1 : 1; // direction toward the opponent along Z
    this.hitPlaneZ = side === 0 ? PLAY.hitPlaneZ : -PLAY.hitPlaneZ;
    this.hand = def.handedness === 'left' ? -1 : 1; // +1 right-handed, -1 left-handed

    this.root = new THREE.Group(); // world-space body anchor (feet)
    this.root.position.set(0, 0, this.hitPlaneZ - this.facing * 0.4);
    this.root.rotation.y = side === 0 ? Math.PI : 0; // models face +Z by convention

    this.paddle = new Paddle({ rubberColor: def.rubberColor, facing: this.facing });
    this.paddle.position.set(0, 1.0, this.hitPlaneZ);

    this.placeholder = this._buildPlaceholder(def.color);
    this.root.add(this.placeholder);
    this.arm = this._buildArm(def.color);
    this.label = this._buildLabel(def.name);
    this.root.add(this.label);

    this.model = null;
    this.mixer = null;
    this.clips = null;
    this.bones = null;
    this._rest = [];
    this._emote = null;
    this._bob = Math.random() * 10;
    this._mood = 0; // placeholder only: >0 celebrate, <0 sad (seconds remaining)
    this._ikTarget = new THREE.Vector3();
    this._reach = new THREE.Vector3(); // learned body offset so the hand can reach the paddle
    /** Free-roam state while walking around the office (null = at the table). */
    this.walk = null;

    this.ready = def.model
      ? this.loadModel(def.model).catch((e) => console.warn(`[${def.name}] model failed to load, keeping placeholder`, e))
      : Promise.resolve();
  }

  addTo(scene) {
    scene.add(this.root, this.paddle.group, this.arm);
  }

  // ---------------------------------------------------------------- models

  /** Swap the placeholder for a rigged glTF/GLB. Resolves when it's in the scene. */
  async loadModel(url) {
    const gltf = await new GLTFLoader().loadAsync(url);
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const s = this.def.height / (box.max.y - box.min.y || 1);
    model.scale.setScalar(s);
    model.position.y = -box.min.y * s;
    model.rotation.y = this.def.modelYaw ?? 0;
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = o.receiveShadow = true;
        if (o.isSkinnedMesh) o.frustumCulled = false; // bounds don't follow bones
      }
    });

    if (this.model) this.root.remove(this.model);
    this.model = model;
    this.root.add(model);
    this.placeholder.visible = false;
    this.arm.visible = false;

    // Rig: bones for IK + a snapshot of the rest pose to reset to every frame.
    const find = (n) => model.getObjectByName(n);
    const b = Object.fromEntries(Object.entries(RIG).map(([k, n]) => [k, find(n)]));
    this.bones = Object.values(b).every(Boolean) ? b : null;
    if (!this.bones) console.warn(`[${this.def.name}] arm bones not found; IK disabled`);
    const l = Object.fromEntries(Object.entries(LEGS).map(([k, n]) => [k, find(n)]));
    this.legs = Object.values(l).every(Boolean) ? l : null;
    // Optional extras for a more natural walk (feet stay level, shoulders counter the hips).
    this.feet = { l: find('LeftFoot'), r: find('RightFoot') };
    this.toes = { l: find('LeftToeBase'), r: find('RightToeBase') };
    this.chest = find('Spine02');
    // Standing measurements the walk cycle keeps to: ankle height and the foot's angle (body frame).
    if (this.feet.l && this.toes.l) {
      this.root.updateMatrixWorld(true);
      const ank = this.root.worldToLocal(this.feet.l.getWorldPosition(new THREE.Vector3()));
      const toe = this.root.worldToLocal(this.toes.l.getWorldPosition(new THREE.Vector3()));
      this._ankleRestY = ank.y;
      this._footDir = toe.sub(ank).normalize();
    }
    // Hip height in the body's own frame (rest pose) — used to seat the character on a chair.
    if (this.legs) {
      this.root.updateMatrixWorld(true);
      this._hipsRestY = this.root.worldToLocal(this.legs.hips.getWorldPosition(new THREE.Vector3())).y;
    }
    this._rest = [];
    model.traverse((o) => {
      if (o.isBone) this._rest.push([o, o.position.clone(), o.quaternion.clone()]);
    });

    // Emote clips, keyed by their exported names.
    this.clips = Object.fromEntries(gltf.animations.map((c) => [c.name, c]));
    this.mixer = null;

    if (this._opacity !== undefined) this.setOpacity(this._opacity);
    return model;
  }

  // ------------------------------------------------------------- reactions

  swing() {
    this.paddle.swing();
  }

  /** Play a named clip; `loop` repeats until stopEmote(). Returns false if missing. */
  emote(name, { loop = false, fade = 0.2 } = {}) {
    const clip = this.clips?.[name];
    if (!clip) return false;
    this._emote?.stop();
    // Fresh mixer per emote: three's PropertyMixer skips writes when a value is
    // unchanged since its last apply, which fights our per-frame IK pose reset.
    this.mixer = new THREE.AnimationMixer(this.model);
    this.mixer.addEventListener('finished', (e) => {
      if (e.action === this._emote) this.stopEmote();
    });
    const action = this.mixer.clipAction(clip);
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = false;
    action.fadeIn(fade).play();
    this._emote = action;
    return true;
  }

  stopEmote() {
    this._emote?.stop();
    this._emote = null;
    this.mixer = null;
  }

  /** Won a point. */
  celebrate() {
    this._mood = 1.2;
    const options = this.def.emotes?.point ?? [];
    if (options.length) this.emote(options[Math.floor(Math.random() * options.length)]);
  }

  /** Won the game. */
  celebrateWin() {
    this._mood = 3;
    if (this.def.emotes?.win) this.emote(this.def.emotes.win, { loop: true });
  }

  sulk() {
    this._mood = -1.2;
  }

  /** Fade the body (used for the near-camera player so they don't block the view). */
  setOpacity(opacity) {
    this._opacity = opacity;
    const apply = (o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        m.transparent = opacity < 1;
        m.opacity = opacity;
        m.depthWrite = opacity >= 1;
      }
    };
    this.root.traverse(apply);
    this.arm.traverse(apply);
    this.label.material.opacity = 1;
  }

  // ---------------------------------------------------------------- walking

  /** Leave the table: the body is now driven by `walk` (position, heading, speed). */
  startWalking() {
    this.stopEmote();
    this._mood = 0;
    this.walk = {
      pos: new THREE.Vector3(this.root.position.x, 0, this.root.position.z),
      yaw: this.root.rotation.y,
      speed: 0,
      phase: 0,
      target: null, // remote players: latest network state to ease toward
    };
  }

  stopWalking() {
    this.walk = null;
    this.root.visible = true;
    this.paddle.group.visible = true;
    this.root.rotation.y = this.side === 0 ? Math.PI : 0;
    this.root.position.y = 0;
    this.paddle.pivot.position.set(0, 0, 0);
    this._reach.set(0, 0, 0);
  }

  /** Network update for a remote walker. */
  setWalkTarget(x, z, yaw, speed) {
    if (!this.walk) this.startWalking();
    this.walk.target = { x, z, yaw, speed };
  }

  _updateWalk(dt) {
    const w = this.walk;
    if (w.sit && !w.target) return this._updateSit(dt);
    if (w.target) {
      const a = Math.min(1, dt * 12);
      w.pos.x += (w.target.x - w.pos.x) * a;
      w.pos.z += (w.target.z - w.pos.z) * a;
      w.yaw += Math.atan2(Math.sin(w.target.yaw - w.yaw), Math.cos(w.target.yaw - w.yaw)) * a;
      w.speed += (w.target.speed - w.speed) * a;
    }
    if (w.sit) return this._updateSit(dt);
    // Out of the match the paddle is put away.
    this.paddle.group.visible = false;
    // Longer strides at higher speed: ~1.5 m per cycle (two steps) walking, ~2.1 m jogging.
    const stride = 1.2 + 0.27 * w.speed;
    w.phase += (w.speed * Math.PI * 2 * dt) / stride;
    // A heel lands each time a leg reaches the front of its swing (phase π/2, 3π/2, ...).
    const stepK = Math.floor((w.phase - Math.PI / 2) / Math.PI);
    if (w._stepK !== undefined && stepK !== w._stepK && w.speed > 0.5) this.onStep?.(w.pos, w.speed);
    w._stepK = stepK;
    w.t = (w.t ?? 0) + dt;
    const moving = THREE.MathUtils.clamp(w.speed / 1.5, 0, 1); // 0 standing → 1 walking
    const jog = THREE.MathUtils.clamp((w.speed - 1.6) / 1.7, 0, 1); // 0 walking → 1 jogging
    const amp = moving * (0.36 + 0.22 * jog); // hip swing (radians)
    const ph = w.phase;
    // The body shifts a touch toward the planted leg (its height comes from planting the feet below).
    const side = Math.sin(ph) * 0.022 * moving * (1 - jog * 0.5);
    this.root.position.set(w.pos.x + Math.cos(w.yaw) * side, 0, w.pos.z - Math.sin(w.yaw) * side);
    this.root.rotation.y = w.yaw;
    this.root.updateMatrixWorld(true);

    if (!this.model) return;
    for (const [bone, pos, quat] of this._rest) {
      bone.position.copy(pos);
      bone.quaternion.copy(quat);
    }
    this.model.updateMatrixWorld(true);
    const s = this.def.height / 1.78;
    _axis.set(1, 0, 0).transformDirection(this.model.matrixWorld); // the character's left
    UP_W.set(0, 1, 0);

    if (this.legs) {
      const L = this.legs;
      const D = Math.PI / 180;
      // Pelvis turns with the forward leg; the chest turns back the other way.
      rotateBoneWorld(L.hips, UP_W, -Math.sin(ph) * 0.09 * moving);
      // Legs are posed with absolute angles from a normal gait (the rig's rest pose has bent
      // knees, so adding to it looked stiff and crouched). Angles are in the body's forward plane.
      _fwd.set(Math.sin(w.yaw), 0, Math.cos(w.yaw));
      const legAngles = (sgn) => {
        const sw = Math.sin(ph) * sgn; // +1 = this leg forward
        const vel = Math.cos(ph) * sgn; // > 0 while this leg swings forward (foot in the air)
        const reach = 22 + 10 * jog; // degrees of hip swing either side
        const thigh = (4 + reach * sw) * moving;
        // Knee: nearly straight while planted, a small give as the heel lands,
        // and a big bend early in the swing so the foot clears the floor.
        const swingK = (58 + 32 * jog) * Math.max(0, vel) ** 1.2 * (0.7 + 0.3 * Math.max(0, -sw));
        const loadK = 12 * Math.max(0, sw) * Math.max(0, -vel) * 1.6;
        const knee = 4 + (swingK + loadK + 6 * jog) * moving;
        // Push off: the heel lifts as the leg trails behind.
        const toe = Math.max(0, -sw) * Math.max(0, -vel) * 30 * moving;
        return { thigh: thigh * D, shin: (thigh - knee) * D, toe: toe * D };
      };
      const poseLeg = (up, low, foot, toeBone, sgn) => {
        const a = legAngles(sgn);
        alignBone(up, low, _dir.copy(_fwd).multiplyScalar(Math.sin(a.thigh)).setY(-Math.cos(a.thigh)));
        alignBone(low, foot, _dir.copy(_fwd).multiplyScalar(Math.sin(a.shin)).setY(-Math.cos(a.shin)));
        // Foot: back to its standing angle, tipped onto the toes at push-off.
        if (foot && toeBone && this._footDir) {
          _dir.copy(this._footDir).applyAxisAngle(UP_W, w.yaw);
          _dir.applyAxisAngle(_axis, a.toe);
          alignBone(foot, toeBone, _dir);
        }
      };
      poseLeg(L.lUp, L.lLow, this.feet?.l, this.toes?.l, 1);
      poseLeg(L.rUp, L.rLow, this.feet?.r, this.toes?.r, -1);
      // Plant the lower foot on the floor: this is what makes the body rise and fall naturally.
      if (this.feet?.l && this.feet?.r && this._ankleRestY !== undefined) {
        const low = Math.min(this.feet.l.getWorldPosition(_a).y, this.feet.r.getWorldPosition(_b).y);
        this.root.position.y += this._ankleRestY - low;
        this.root.updateMatrixWorld(true);
      }
      if (this.bones) rotateBoneWorld(this.bones.spine, _axis, -0.05 * moving - 0.12 * jog); // lean into a jog
      if (this.chest) rotateBoneWorld(this.chest, UP_W, Math.sin(ph) * 0.12 * moving);
      // Standing still: breathe.
      if (this.chest && moving < 0.2) rotateBoneWorld(this.chest, _axis, Math.sin(w.t * 1.7) * 0.015);
    }

    if (this.bones) {
      const b = this.bones;
      // Arms swing opposite the legs, elbows a little bent (more when jogging); the forward hand rises.
      const swing = Math.sin(ph) * (0.17 + 0.1 * jog) * moving;
      const hand = (sideX, sgn) => {
        const f = swing * sgn;
        this._ikTarget.set(sideX * s, (0.86 + Math.max(0, f) * 0.35 + 0.1 * jog) * s, (f + 0.04 + 0.06 * jog) * s).applyMatrix4(this.root.matrixWorld);
      };
      hand(0.21, -1); // left hand forward with the right leg (sin < 0)
      solveCCD([b.leftArm, b.leftForeArm], b.leftHand, this._ikTarget);
      hand(-0.21, 1);
      solveCCD([b.rightArm, b.rightForeArm], b.rightHand, this._ikTarget);
    }
  }

  /**
   * Seated at a table: walk.sit = { y: seat height, table: { x, z, top } }.
   * Thighs forward, shins down, hands resting on the table; walk.reach = { point, t }
   * sends the racket hand to a point for t seconds (e.g. moving a chess piece).
   */
  _updateSit(dt) {
    const w = this.walk;
    const st = w.sit;
    const hipsY = this._hipsRestY ?? 0.95 * (this.def.height / 1.78);
    this.root.position.set(w.pos.x, st.y + 0.08 - hipsY, w.pos.z);
    this.root.rotation.y = w.yaw;
    this.root.updateMatrixWorld(true);
    this.paddle.group.visible = false;
    w.speed = 0;
    if (!this.model) return;
    for (const [bone, pos, quat] of this._rest) {
      bone.position.copy(pos);
      bone.quaternion.copy(quat);
    }
    this.model.updateMatrixWorld(true);
    _axis.set(1, 0, 0).transformDirection(this.model.matrixWorld);
    if (this.legs) {
      const L = this.legs;
      rotateBoneWorld(L.lUp, _axis, -1.45);
      rotateBoneWorld(L.rUp, _axis, -1.45);
      rotateBoneWorld(L.lLow, _axis, 1.45);
      rotateBoneWorld(L.rLow, _axis, 1.45);
    }
    if (!this.bones) return;
    const b = this.bones;
    // Lean in over the table; a little more while reaching.
    const reaching = w.reach && w.reach.t > 0;
    rotateBoneWorld(b.spine, _axis, reaching ? -0.3 : -0.12);
    const fx = Math.sin(w.yaw);
    const fz = Math.cos(w.yaw);
    const cx = w.pos.x + fx * 0.3;
    const cz = w.pos.z + fz * 0.3;
    const y = (st.table?.top ?? 0.75) + 0.035;
    // _axis is the character's left.
    const place = (side) => this._ikTarget.set(cx + _axis.x * 0.17 * side, y, cz + _axis.z * 0.17 * side);
    const racketIsRight = this.hand > 0;
    const [racket, off] = racketIsRight
      ? [[b.rightArm, b.rightForeArm, b.rightHand], [b.leftArm, b.leftForeArm, b.leftHand]]
      : [[b.leftArm, b.leftForeArm, b.leftHand], [b.rightArm, b.rightForeArm, b.rightHand]];
    place(racketIsRight ? 1 : -1);
    solveCCD([off[0], off[1]], off[2], this._ikTarget);
    if (reaching) {
      w.reach.t -= dt;
      this._ikTarget.copy(w.reach.point);
      this._ikTarget.y += 0.03;
      solveCCD([b.spine, racket[0], racket[1]], racket[2], this._ikTarget, 8, [0.3, 1, 1]);
    } else {
      place(racketIsRight ? -1 : 1);
      solveCCD([racket[0], racket[1]], racket[2], this._ikTarget);
    }
  }

  // ---------------------------------------------------------------- update

  update(dt) {
    if (this.walk) return this._updateWalk(dt);
    const p = this.paddle.position;
    // Body stands beside the paddle on the side opposite the racket hand.
    const targetX = p.x + this.facing * this.hand * 0.24 + this._reach.x;
    this.root.position.x += (targetX - this.root.position.x) * Math.min(1, dt * 8);
    this.root.position.z = this.hitPlaneZ - this.facing * 0.3 + this._reach.z;

    this._bob += dt;
    this._mood = Math.sign(this._mood) * Math.max(0, Math.abs(this._mood) - dt);
    if (this.placeholder.visible) {
      const hop = this._mood > 0 ? Math.abs(Math.sin(this._bob * 12)) * 0.15 : 0;
      const slump = this._mood < 0 ? 0.08 : 0;
      this.placeholder.position.y = Math.sin(this._bob * 3) * 0.01 + hop - slump;
      this.placeholder.rotation.x = this._mood < 0 ? 0.25 : 0;
    }

    this.paddle.update(dt);
    this.paddle.pivot.position.set(0, 0, 0);
    this.root.updateMatrixWorld(true);
    this.paddle.group.updateMatrixWorld(true);

    if (this.model) this._poseModel(dt);
    else if (this.arm.visible) this._updateArm();
  }

  _poseModel(dt) {
    if (this._emote) this.mixer.update(dt);
    else {
      for (const [bone, pos, quat] of this._rest) {
        bone.position.copy(pos);
        bone.quaternion.copy(quat);
      }
    }
    this.model.updateMatrixWorld(true);
    if (!this.bones) return;
    const b = this.bones;

    if (this._emote) {
      // Paddle rides in the hand during emotes (visual only — gameplay position is untouched).
      (this.hand > 0 ? b.rightHand : b.leftHand).getWorldPosition(_a);
      this.paddle.pivot.position.copy(_a.sub(this.paddle.position));
      this.paddle.group.updateMatrixWorld(true);
      return;
    }

    const s = this.def.height / 1.78;
    // Racket hand on the paddle grip (swing rotation included via the pivot).
    // The spine joins the chain at low weight, so low balls make them lean in.
    const [racket, off] = this.hand > 0
      ? [[b.rightArm, b.rightForeArm, b.rightHand], [b.leftArm, b.leftForeArm, b.leftHand]]
      : [[b.leftArm, b.leftForeArm, b.leftHand], [b.rightArm, b.rightForeArm, b.rightHand]];
    this.paddle.getGripWorld(this._ikTarget, -0.12);
    solveCCD([b.spine, racket[0], racket[1]], racket[2], this._ikTarget, 8, [0.35, 1, 1]);
    // Still short? Step the body toward the paddle over the next frames (xz only).
    racket[2].getWorldPosition(_a);
    _b.subVectors(this._ikTarget, _a);
    this._reach.x += _b.x * Math.min(1, dt * 6);
    this._reach.z += _b.z * Math.min(1, dt * 6);
    this._reach.multiplyScalar(1 - Math.min(1, dt * 0.5)).clampLength(0, 0.45);
    // Off hand hangs relaxed by the hip (local +X is the character's left).
    this._ikTarget.set(0.24 * s * this.hand, 0.86 * s, 0.08 * s).applyMatrix4(this.root.matrixWorld);
    solveCCD([off[0], off[1]], off[2], this._ikTarget);
  }

  // ----------------------------------------------------------- placeholder

  _buildPlaceholder(color) {
    const g = new THREE.Group();
    const shirt = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xe0b48c, roughness: 0.7 });

    for (const lx of [-0.1, 0.1]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.7, 4, 8), pants);
      leg.position.set(lx, 0.42, 0);
      g.add(leg);
    }
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.42, 6, 12), shirt);
    torso.position.y = 1.1;
    g.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 16), skin);
    head.position.y = 1.56;
    g.add(head);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), skin);
    nose.position.set(0, 1.56, 0.12);
    g.add(nose);
    const off = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.45, 4, 8), shirt);
    off.position.set(0.25 * this.hand, 1.05, 0.05);
    off.rotation.z = 0.25 * this.hand;
    g.add(off);

    g.scale.setScalar(this.def.height / 1.78);
    g.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    return g;
  }

  _buildArm(color) {
    const geo = new THREE.CylinderGeometry(0.035, 0.03, 1, 10);
    geo.translate(0, 0.5, 0);
    const arm = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
    arm.castShadow = true;
    return arm;
  }

  _updateArm() {
    const shoulder = _a.set(-0.24 * this.hand, 1.36 * (this.def.height / 1.78), 0).applyMatrix4(this.root.matrixWorld);
    const grip = this.paddle.getGripWorld(_b);
    const dir = grip.sub(shoulder);
    const len = dir.length();
    this.arm.position.copy(shoulder);
    this.arm.quaternion.setFromUnitVectors(UP, dir.normalize());
    this.arm.scale.set(1, len, 1);
  }

  _buildLabel(name) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const ctx = c.getContext('2d');
    ctx.font = '700 40px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.roundRect(28, 6, 200, 52, 26);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(name, 128, 33);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false })
    );
    sprite.scale.set(0.5, 0.125, 1);
    sprite.position.y = this.def.height + 0.2;
    return sprite;
  }
}
