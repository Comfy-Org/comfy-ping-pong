import * as THREE from 'three';

/**
 * The office wall TV plays purz.tv — the same channel and clips the site plays,
 * shuffled, back to back. Clips come through the dev server's /purz proxy
 * (see vite.config.js) so WebGL is allowed to use them as a texture.
 *
 *   T → TV sound on/off (volume follows how close the camera is to the TV)
 *   Y → next clip
 */

const BASE = '/purz';
const CHANNEL = 'videos'; // purz.tv's default board ("Interdimensional Cable")

export class TV {
  constructor(game) {
    this.game = game;
    this.items = [];
    this.index = 0;
    this.soundOn = false;
    this.failures = 0;
    this.video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, preload: 'auto' });
    this.video.addEventListener('ended', () => this.next());
    this.video.addEventListener('error', () => this._onError());
    this.texture = new THREE.VideoTexture(this.video);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.ready = game.officeReady.then(() => this._mount()).then(() => this._load());
    this._bindKeys();
    setInterval(() => this.update(), 200);
  }

  /** Lay a 16:9 screen over the front of the wall_tv model. */
  _mount() {
    const prop = this.game.arena.props?.find((p) => p.file === 'wall_tv.glb');
    if (!prop) return console.warn('[tv] no wall_tv in the office layout');
    prop.obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(prop.obj);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    // Panel inside the bezel: as wide as fits, 16:9.
    let w = size.x * 0.9;
    let h = (w * 9) / 16;
    if (h > size.y * 0.86) {
      h = size.y * 0.86;
      w = (h * 16) / 9;
    }
    this.screen = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false })
    );
    // The TV hangs on the back wall facing +Z; sit the panel just proud of its front face.
    this.screen.position.set(center.x, center.y + size.y * 0.02, box.max.z + 0.004);
    this.screen.rotation.y = prop.obj.rotation.y;
    this.game.scene.add(this.screen);
    // A little light spill onto the room.
    this.glow = new THREE.PointLight(0x9fb7ff, 0, 3.5, 2);
    this.glow.position.set(center.x, center.y, box.max.z + 0.6);
    this.game.scene.add(this.glow);
  }

  async _load() {
    if (!this.screen) return;
    try {
      const res = await fetch(`${BASE}/manifest.json`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      const m = await res.json();
      this.base = `${BASE}${(m.base || '/cdn').replace(/\/$/, '')}`;
      // Same mapping purz.tv uses: board tags → posts whose first media is a video.
      const boardOfTag = new Map();
      (m.tags || []).forEach((t, i) => t.f === 'board' && boardOfTag.set(i, t.s));
      const boards = new Map((m.boards || []).map((b) => [b.s, []]));
      for (const p of m.posts || []) {
        const media = p.m?.[0];
        if (media?.k !== 'v') continue;
        for (const g of p.g || []) {
          const b = boardOfTag.get(g);
          if (boards.has(b)) boards.get(b).push({ hash: media.f, title: p.t || '' });
        }
      }
      this.items = shuffle(boards.get(CHANNEL)?.length ? boards.get(CHANNEL) : [...boards.values()].find((l) => l.length) ?? []);
      if (!this.items.length) throw new Error('channel is empty');
      this.index = 0;
      this._play();
    } catch (e) {
      console.warn('[tv] purz.tv unavailable', e);
    }
  }

  _play() {
    const item = this.items[this.index];
    this.video.src = `${this.base}/m/${item.hash}/display.mp4`;
    this.video.play().catch(() => {}); // muted autoplay is allowed; sound waits for a key press
    this.screen.material.map = this.texture;
    this.screen.material.color.set(0xffffff);
    this.screen.material.needsUpdate = true;
    this.glow.intensity = 0.6;
  }

  next() {
    if (!this.items.length) return;
    this.index = (this.index + 1) % this.items.length;
    this._play();
  }

  _onError() {
    // A clip that won't load gets skipped; give up after a run of failures.
    if (++this.failures > 5) return console.warn('[tv] too many clip errors, stopping');
    this.next();
  }

  _bindKeys() {
    this.video.addEventListener('playing', () => (this.failures = 0));
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || !this.items.length) return;
      if (e.code === 'KeyT') {
        this.soundOn = !this.soundOn;
        this.video.muted = !this.soundOn;
        if (this.soundOn) this.video.play().catch(() => {});
        this.game.hud.message(this.soundOn ? 'TV sound on' : 'TV sound off', 'purz.tv', 1.2);
      } else if (e.code === 'KeyY') this.next();
    });
  }

  /** Per-frame: volume falls off with distance from the camera. */
  update() {
    if (!this.screen || !this.soundOn) return;
    const d = this.game.camera.position.distanceTo(this.screen.position);
    const duck = this.game.narrator?.speaking ? 0.3 : 1; // hush while the narrator talks
    this.video.volume = THREE.MathUtils.clamp(1.15 - d / 7, 0.08, 1) * 0.8 * duck;
  }
}

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
