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

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _bp = new THREE.Vector3();
const _ep = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _bq = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const _IDENT = new THREE.Quaternion();

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

  // ---------------------------------------------------------------- update

  update(dt) {
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
