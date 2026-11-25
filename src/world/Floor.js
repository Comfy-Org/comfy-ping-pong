import * as THREE from 'three';

/**
 * The rest of the office floor, beyond the game room's door (mapped from photos of the
 * real office). Built procedurally: floors, walls, windows, ceilings, the glass meeting
 * rooms and the kitchen cabinets. The furniture comes from office_layout.json like the
 * game room's (see scripts/layout-floor.mjs).
 *
 *        x -13            -6                 8                17
 *   z -20.5 ┌──────────────┬──────────────────┬────────────────┐  windows (water)
 *           │  Lora Lounge │                  │                │
 *     -13   ├──────────────┤    Desk area     │ Kitchen+dining │  windows (brick)
 *           │   corridor   │   (drop ceiling) │ (exposed ceil.)│
 *    -11.5  ├──────┬───────┤                  │                │
 *           │ meet │ meet  │                  │                │
 *    -6.7   └──────┴───────┴──door──┬─────────┴────────────────┘
 *                         │      game room (x ±7.5, z ±6.5)     │
 *
 * Walking space is a set of rectangles for the walker's centre (rooms plus the doorway);
 * walls inside the floor are collider boxes like the furniture.
 */

/** The hall beyond the game room: inside faces of its outer walls. */
export const HALL = { minX: -13, maxX: 17, minZ: -20.5, maxZ: -6.7 };
const GAME = { minX: -7.5, maxX: 7.5, minZ: -6.5, maxZ: 6.5 };
const DOOR = { minX: -3.9, maxX: -1.9, h: 2.36 }; // the game room's double doors, in its -Z wall
const WALL_H = 3.6;
const DROP_CEIL = 2.9; // tiles over the desks, lounge and meeting rooms
const KITCHEN_X = 8; // the kitchen starts here (exposed ceiling at the game room's 3.2)
const KITCHEN_CEIL = 3.2;
const KITCHEN_GAP = [-17, -11]; // the wide opening between the desks and the kitchen
const MEET = { minX: -13, maxX: -8.5, minZ: -11.5, split: -10.75 };
const COLUMNS = [[-5.3, -12.6], [-5.3, -16.6], [7.0, -12.6], [7.0, -16.6]];
const M = 0.26; // the walker's radius, plus a hair

/** Named areas, for the HUD and the narrator. The first that contains a point wins. */
export const ZONES = [
  { id: 'game', name: 'Game room', minX: GAME.minX, maxX: GAME.maxX, minZ: GAME.minZ, maxZ: GAME.maxZ },
  { id: 'lounge', name: 'Lora Lounge', minX: -13, maxX: -6, minZ: -20.5, maxZ: -13 },
  { id: 'meeting', name: 'Meeting rooms', minX: -13, maxX: -6, minZ: -13, maxZ: -6.7 },
  { id: 'kitchen', name: 'Kitchen', minX: KITCHEN_X, maxX: 17, minZ: -20.5, maxZ: -6.7 },
  { id: 'desks', name: 'Desks', minX: -6, maxX: KITCHEN_X, minZ: -20.5, maxZ: -6.7 },
];

export function zoneAt(x, z) {
  return ZONES.find((r) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) ?? null;
}

export function buildFloor(scene, shell, arena) {
  const g = new THREE.Group();
  g.name = 'office_floor';
  scene.add(g);
  const colliders = [];
  const solid = (minX, maxX, minZ, maxZ, name = 'wall') => colliders.push({ minX, maxX, minZ, maxZ, name });

  const wallMat = findMaterial(shell, 'white_wall')?.clone() ?? new THREE.MeshStandardMaterial({ color: 0xf2f0ec, roughness: 0.9 });
  wallMat.side = THREE.FrontSide;
  const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...o });
  const box = (w, h, d, material, x, y, z, { cast = true, parent = g } = {}) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y + h / 2, z);
    m.castShadow = cast;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const plane = (w, d, material, x, y, z, down = false) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
    m.rotation.x = down ? Math.PI / 2 : -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    g.add(m);
    return m;
  };

  openDoorway(shell, g);

  // ---- floors
  const carpetTex = carpetTexture();
  const carpet = mat(0xffffff, { map: carpetTex, bumpMap: carpetTex, bumpScale: 0.6, roughness: 1 });
  carpet.map.repeat.set((KITCHEN_X - HALL.minX) / 1.2, (HALL.maxZ - HALL.minZ) / 1.2);
  plane(KITCHEN_X - HALL.minX, HALL.maxZ - HALL.minZ, carpet, (HALL.minX + KITCHEN_X) / 2, 0, (HALL.minZ + HALL.maxZ) / 2);
  const concrete = mat(0xffffff, { map: tileTexture('#c9c2b6', '#bdb5a8', 1, 0.6), roughness: 0.7 });
  concrete.map.repeat.set((HALL.maxX - KITCHEN_X) / 1.2, (HALL.maxZ - HALL.minZ) / 1.2);
  plane(HALL.maxX - KITCHEN_X, HALL.maxZ - HALL.minZ, concrete, (KITCHEN_X + HALL.maxX) / 2, 0.001, (HALL.minZ + HALL.maxZ) / 2);
  // Doorway threshold (the wall is 0.2 thick).
  plane(DOOR.maxX - DOOR.minX, 0.2, carpet, (DOOR.minX + DOOR.maxX) / 2, 0.001, GAME.minZ - 0.1);
  // The lounge rug.
  plane(4.8, 3.8, mat(0x2f3338, { roughness: 1 }), -9.6, 0.006, -17.3);

  // ---- the wall shared with the game room (z -6.7 … -6.5), with the doorway cut out
  const sz = GAME.minZ - 0.1;
  box(DOOR.minX - HALL.minX, WALL_H, 0.2, wallMat, (HALL.minX + DOOR.minX) / 2, 0, sz);
  box(HALL.maxX - DOOR.maxX, WALL_H, 0.2, wallMat, (DOOR.maxX + HALL.maxX) / 2, 0, sz);
  box(DOOR.maxX - DOOR.minX, WALL_H - DOOR.h, 0.2, wallMat, (DOOR.minX + DOOR.maxX) / 2, DOOR.h, sz);
  // Hall-side door frame.
  const frame = mat(0x3b3b3b, { roughness: 0.5, metalness: 0.4 });
  for (const x of [DOOR.minX - 0.03, DOOR.maxX + 0.03]) box(0.06, DOOR.h, 0.06, frame, x, 0, HALL.maxZ - 0.03, { cast: false });
  box(DOOR.maxX - DOOR.minX + 0.12, 0.06, 0.06, frame, (DOOR.minX + DOOR.maxX) / 2, DOOR.h - 0.03, HALL.maxZ - 0.03, { cast: false });

  // ---- outer walls: windows on the north, west and east
  const glass = new THREE.MeshStandardMaterial({ color: 0xcfe3ea, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.1, depthWrite: false });
  const mullion = mat(0x2a2d31, { roughness: 0.4, metalness: 0.6 });
  const windowWall = (ax, from, to, at, inward) => {
    // ax 'x': wall runs along x at z = at; 'z': runs along z at x = at. inward = +1/-1 normal.
    const len = to - from;
    const mid = (from + to) / 2;
    const t = 0.2;
    const place = (w, h, y, m, cast = true) =>
      ax === 'x' ? box(w, h, t, m, mid, y, at - (inward * t) / 2, { cast }) : box(t, h, w, m, at - (inward * t) / 2, y, mid, { cast });
    place(len, 0.45, 0, wallMat);
    place(len, WALL_H - 2.75, 2.75, wallMat);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(len, 2.3), glass);
    pane.position.set(ax === 'x' ? mid : at, 0.45 + 1.15, ax === 'x' ? at : mid);
    pane.rotation.y = ax === 'x' ? (inward > 0 ? 0 : Math.PI) : inward > 0 ? Math.PI / 2 : -Math.PI / 2;
    pane.renderOrder = 2;
    g.add(pane);
    for (let s = from; s <= to + 1e-3; s += len / Math.round(len / 1.5)) {
      const x = ax === 'x' ? s : at - inward * 0.05;
      const z = ax === 'x' ? at - inward * 0.05 : s;
      box(0.06, 2.3, 0.06, mullion, x, 0.45, z, { cast: false });
    }
  };
  windowWall('x', HALL.minX, HALL.maxX, HALL.minZ, 1);
  windowWall('z', HALL.minZ, HALL.maxZ, HALL.minX, 1);
  windowWall('z', HALL.minZ, HALL.maxZ, HALL.maxX, -1);
  addViews(g);

  // ---- ceilings (from the office photos)
  // Desks, lounge, meeting rooms: a drop ceiling of 2'x2' acoustic tiles (speckled and fissured)
  // in a white T-bar grid, 2'x4' troffer lights, sprinkler heads, smoke detectors and return-air
  // grilles. Lights point down, so the tiles get a little glow of their own (bounce light).
  const tileMap = acousticTileTexture();
  const tiles = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tileMap, bumpMap: tileMap, bumpScale: 1.2, emissive: 0x8a8781, emissiveMap: tileMap, roughness: 1, side: THREE.DoubleSide });
  tiles.map.repeat.set((KITCHEN_X - HALL.minX) / 0.6, (HALL.maxZ - HALL.minZ) / 0.6);
  plane(KITCHEN_X - HALL.minX, HALL.maxZ - HALL.minZ, tiles, (HALL.minX + KITCHEN_X) / 2, DROP_CEIL, (HALL.minZ + HALL.maxZ) / 2, true);
  const panel = new THREE.MeshBasicMaterial({ map: trofferTexture() });
  const troffer = (x, z, w, d) => {
    plane(w, d, panel, x, DROP_CEIL - 0.006, z, true);
  };
  for (let x = -4; x <= 6; x += 2.4) for (let z = -8.6; z >= -19.4; z -= 2.4) troffer(x, z, 0.6, 1.2);
  for (const [x, z] of [[-11, -15], [-8.2, -15], [-11, -18.4], [-8.2, -18.4], [-11.9, -9], [-9.6, -9], [-9.6, -12.2]]) troffer(x, z, 0.6, 0.6);
  // Return-air grilles: darker slotted 2'x2' panels between the lights.
  const grille = new THREE.MeshStandardMaterial({ map: grilleTexture(), roughness: 0.8, side: THREE.DoubleSide });
  for (const [x, z] of [[-2.8, -12.2], [3.2, -12.2], [-2.8, -16.8], [3.2, -16.8], [0.2, -19.6], [-10.4, -13.6], [-10.4, -7.6]])
    plane(0.6, 0.6, grille, x, DROP_CEIL - 0.004, z, true);
  // Sprinkler heads (chrome) on a ~3 m grid, and a few smoke detectors (white).
  const chrome = mat(0xd8dadc, { roughness: 0.25, metalness: 0.9 });
  const white = mat(0xf4f3f0, { roughness: 0.6 });
  const sprinklerGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.012, 14);
  const stemGeo = new THREE.CylinderGeometry(0.01, 0.012, 0.05, 8);
  for (let x = -12.1; x < KITCHEN_X - 0.5; x += 3) {
    for (let z = -7.9; z > HALL.minZ + 0.5; z -= 3) {
      const rose = new THREE.Mesh(sprinklerGeo, chrome);
      rose.position.set(x, DROP_CEIL - 0.008, z);
      const stem = new THREE.Mesh(stemGeo, chrome);
      stem.position.set(x, DROP_CEIL - 0.04, z);
      g.add(rose, stem);
    }
  }
  const detGeo = new THREE.CylinderGeometry(0.065, 0.07, 0.035, 20);
  for (const [x, z] of [[-1.6, -11.4], [4.0, -15.8], [-9.4, -16.0], [-10.6, -10.4]]) {
    const det = new THREE.Mesh(detGeo, white);
    det.position.set(x, DROP_CEIL - 0.02, z);
    g.add(det);
  }

  // Kitchen: exposed ceiling, the deck sprayed with grey-white fireproofing, white round ducts,
  // a run of pipes and a cable tray (the pendants come from the layout).
  // (Lit from below by bounce light the renderer doesn't model, so it glows a little itself.)
  const sprayTex = sprayTexture();
  const spray = new THREE.MeshStandardMaterial({ map: sprayTex, emissive: 0x8d8a84, emissiveMap: sprayTex, roughness: 1, side: THREE.DoubleSide });
  spray.map.repeat.set((HALL.maxX - KITCHEN_X) / 2, (HALL.maxZ - HALL.minZ) / 2);
  spray.bumpMap = spray.map;
  spray.bumpScale = 2;
  plane(HALL.maxX - KITCHEN_X, HALL.maxZ - HALL.minZ, spray, (KITCHEN_X + HALL.maxX) / 2, KITCHEN_CEIL, (HALL.minZ + HALL.maxZ) / 2, true);
  // Steel beams under the deck, sprayed like it.
  for (const z of [-8.6, -12.6, -16.6]) box(HALL.maxX - KITCHEN_X, 0.3, 0.18, spray, (KITCHEN_X + HALL.maxX) / 2, KITCHEN_CEIL - 0.3, z, { cast: false });
  const duct = mat(0xeeeeec, { roughness: 0.55, metalness: 0.15 });
  const len = HALL.maxX - KITCHEN_X;
  for (const z of [-10.5, -16.5]) {
    const d = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, len, 20), duct);
    d.rotation.z = Math.PI / 2;
    d.position.set((KITCHEN_X + HALL.maxX) / 2, KITCHEN_CEIL - 0.48, z);
    g.add(d);
    // Seams every 1.5 m.
    for (let x = KITCHEN_X + 0.75; x < HALL.maxX; x += 1.5) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.228, 0.228, 0.03, 20), duct);
      ring.rotation.z = Math.PI / 2;
      ring.position.set(x, KITCHEN_CEIL - 0.48, z);
      g.add(ring);
    }
  }
  const pipeMat = mat(0xc9ccd0, { roughness: 0.35, metalness: 0.6 });
  for (const [z, r] of [[-13.4, 0.04], [-13.6, 0.025], [-19.2, 0.05]]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), pipeMat);
    p.rotation.z = Math.PI / 2;
    p.position.set((KITCHEN_X + HALL.maxX) / 2, KITCHEN_CEIL - 0.2, z);
    g.add(p);
  }
  box(len, 0.04, 0.3, pipeMat, (KITCHEN_X + HALL.maxX) / 2, KITCHEN_CEIL - 0.62, -14.4, { cast: false }); // cable tray

  // The game room's own exposed ceiling gets the same sprayed look.
  const roomCeil = findMaterial(shell, 'ceiling');
  if (roomCeil) {
    const t = sprayTexture();
    t.repeat.set(7, 6);
    roomCeil.map = t;
    roomCeil.emissive?.set(0x6f6c67);
    roomCeil.emissiveMap = t;
    roomCeil.bumpMap = t;
    roomCeil.bumpScale = 2;
    roomCeil.color.set(0xffffff);
    roomCeil.needsUpdate = true;
  }

  // ---- the partition between desks and kitchen (open in the middle), and its bulkhead
  const [g0, g1] = KITCHEN_GAP;
  box(0.2, WALL_H, HALL.maxZ - g1, wallMat, KITCHEN_X, 0, (g1 + HALL.maxZ) / 2);
  box(0.2, WALL_H, g0 - HALL.minZ, wallMat, KITCHEN_X, 0, (HALL.minZ + g0) / 2);
  box(0.2, WALL_H - DROP_CEIL, g1 - g0, wallMat, KITCHEN_X, DROP_CEIL, (g0 + g1) / 2, { cast: false });
  solid(KITCHEN_X - 0.1, KITCHEN_X + 0.1, g1, HALL.maxZ);
  solid(KITCHEN_X - 0.1, KITCHEN_X + 0.1, HALL.minZ, g0);

  // ---- columns (wall planters hang on them)
  for (const [x, z] of COLUMNS) {
    box(0.5, DROP_CEIL, 0.5, wallMat, x, 0, z);
    solid(x - 0.25, x + 0.25, z - 0.25, z + 0.25, 'column');
  }

  // ---- glass meeting rooms
  const alu = mat(0xb7bcc2, { roughness: 0.35, metalness: 0.7 });
  const mGlass = new THREE.MeshStandardMaterial({ color: 0xd8e8ee, transparent: true, opacity: 0.22, roughness: 0.05, depthWrite: false });
  const glassWall = (w, d, x, z) => {
    const p = box(w, DROP_CEIL, d, mGlass, x, 0, z, { cast: false });
    p.renderOrder = 2;
    box(w + 0.02, 0.05, d + 0.02, alu, x, DROP_CEIL - 0.05, z, { cast: false });
    box(w + 0.02, 0.05, d + 0.02, alu, x, 0, z, { cast: false });
  };
  glassWall(MEET.maxX - MEET.minX, 0.04, (MEET.minX + MEET.maxX) / 2, MEET.minZ);
  glassWall(0.04, HALL.maxZ - MEET.minZ, MEET.maxX, (MEET.minZ + HALL.maxZ) / 2);
  glassWall(0.04, HALL.maxZ - MEET.minZ, MEET.split, (MEET.minZ + HALL.maxZ) / 2);
  for (const x of [MEET.minX + 1.1, MEET.split + 1.1]) box(0.05, DROP_CEIL, 0.06, alu, x, 0, MEET.minZ, { cast: false }); // door frames
  solid(MEET.minX, MEET.maxX + 0.05, MEET.minZ - 0.05, MEET.minZ + 0.05, 'glass');
  solid(MEET.maxX - 0.05, MEET.maxX + 0.05, MEET.minZ, HALL.maxZ, 'glass');

  // ---- kitchen cabinets along the south wall
  const wood = mat(0x9a6b43, { roughness: 0.6 });
  const stone = mat(0xf1efea, { roughness: 0.25 });
  box(6.4, 0.88, 0.62, wood, 12.25, 0, HALL.maxZ - 0.31);
  box(6.44, 0.04, 0.66, stone, 12.25, 0.88, HALL.maxZ - 0.33);
  box(6.4, 0.8, 0.36, wood, 12.25, 1.5, HALL.maxZ - 0.18);
  solid(9.05, 15.45, HALL.maxZ - 0.66, HALL.maxZ, 'cabinets');

  // ---- the game room's double doors: they rest closed, swing open when someone walks into
  // them (either way), and drift shut again. A door that can't swing any further blocks you.
  const doorMat = findMaterial(shell, 'door') ?? mat(0x6b5a48);
  const LEAF = 0.91;
  const doors = [];
  for (const [hx, dir] of [[-3.83, 1], [-1.97, -1]]) {
    const pivot = new THREE.Group();
    const hz = GAME.minZ - 0.1; // in the middle of the wall's thickness
    pivot.position.set(hx, 0, hz);
    box(LEAF, 2.3, 0.04, doorMat, (dir * LEAF) / 2, 0, -0.02, { parent: pivot });
    g.add(pivot);
    // angle: pivot.rotation.y; the leaf points along (cos, -sin) of (angle + off).
    doors.push({ pivot, hx, hz, off: dir > 0 ? 0 : Math.PI, angle: 0, vel: 0 });
  }
  const DOOR_LIMIT = Math.PI / 2 + 0.9; // nearly back against the wall either way
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  /** Swing the doors for these walkers ([{pos, push}]); `push` walkers can be shoved back. */
  function updateDoors(dt, walkers) {
    const R = 0.3;
    for (const d of doors) {
      let pushed = false;
      for (const { pos, push } of walkers) {
        const dx = pos.x - d.hx;
        const dz = pos.z - d.hz;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.05 || dist > LEAF + R) continue;
        const leaf = d.angle + d.off;
        const phi = Math.atan2(-dz, dx);
        const diff = wrap(phi - leaf);
        const need = Math.asin(Math.min(1, R / dist));
        if (Math.abs(diff) >= need || Math.abs(diff) > Math.PI / 2) continue;
        // Swing the leaf just clear of the walker, away from them.
        const want = wrap(phi - Math.sign(diff || 1) * need - d.off);
        const clamped = Math.max(-DOOR_LIMIT, Math.min(DOOR_LIMIT, want));
        d.vel = (clamped - d.angle) / Math.max(dt, 1e-3) * 0.3;
        d.angle = clamped;
        pushed = true;
        if (clamped !== want && push) {
          // Against its stop: the door holds, so the walker is pushed back off it.
          const lx = Math.cos(clamped + d.off);
          const lz = -Math.sin(clamped + d.off);
          const along = Math.max(0, Math.min(LEAF, dx * lx + dz * lz));
          const cx = d.hx + lx * along;
          const cz = d.hz + lz * along;
          const ox = pos.x - cx;
          const oz = pos.z - cz;
          const o = Math.hypot(ox, oz) || 1;
          if (o < R) {
            pos.x = cx + (ox / o) * R;
            pos.z = cz + (oz / o) * R;
          }
        }
      }
      if (!pushed) {
        // A gentle closer: springs back with a little overshoot.
        d.vel += (-d.angle * 3.5 - d.vel * 2.6) * dt;
        d.angle = Math.max(-DOOR_LIMIT, Math.min(DOOR_LIMIT, d.angle + d.vel * dt));
      }
      d.pivot.rotation.y = d.angle;
    }
  }

  // ---- lighting: a few broad fixtures per area, plus one shadow light that follows you
  const lights = [];
  const spot = (x, z, y, color, intensity, distance, angle) => {
    const l = new THREE.SpotLight(color, intensity, distance, angle, 1, 2);
    l.position.set(x, y, z);
    l.target.position.set(x, 0, z);
    g.add(l, l.target);
    lights.push(l);
    return l;
  };
  for (const x of [-1.2, 4.6]) for (const z of [-10.4, -17.2]) spot(x, z, DROP_CEIL - 0.05, 0xfff6ea, 14, 13, 1.3);
  spot(-9.6, -16.4, DROP_CEIL - 0.05, 0xffe2bd, 10, 9, 1.3); // lounge
  spot(-9.6, -9.4, DROP_CEIL - 0.05, 0xfff6ea, 7, 8, 1.3); // meeting rooms / corridor
  spot(12.5, -15.5, KITCHEN_CEIL - 0.1, 0xffe9cc, 14, 13, 1.3); // kitchen + dining
  const follow = spot(0, -12, DROP_CEIL - 0.1, 0xfff3e0, 0, 7, 1.0);
  follow.castShadow = true;
  follow.shadow.mapSize.set(1024, 1024);
  follow.shadow.camera.near = 0.2;
  follow.shadow.camera.far = 7;
  follow.shadow.bias = -0.0004;
  follow.shadow.normalBias = 0.03;

  // ---- where the walker's centre may go
  const rects = [
    { minX: GAME.minX + 0.25 + M, maxX: GAME.maxX - 0.25 - M, minZ: GAME.minZ + 0.25 + M, maxZ: GAME.maxZ - 0.25 - M },
    { minX: DOOR.minX + 0.2 + M, maxX: DOOR.maxX - 0.2 - M, minZ: HALL.maxZ - 0.8, maxZ: GAME.minZ + 1 },
    { minX: HALL.minX + 0.2 + M, maxX: HALL.maxX - 0.2 - M, minZ: HALL.minZ + 0.2 + M, maxZ: HALL.maxZ - M },
  ];
  // …and the camera (with the ceiling height of each part).
  const camRects = [
    { minX: GAME.minX + 0.1, maxX: GAME.maxX - 0.1, minZ: GAME.minZ + 0.1, maxZ: GAME.maxZ - 0.1, top: 2.7 },
    { minX: DOOR.minX + 0.05, maxX: DOOR.maxX - 0.05, minZ: HALL.maxZ - 0.2, maxZ: GAME.minZ + 0.3, top: DOOR.h - 0.1 },
    { minX: HALL.minX + 0.1, maxX: KITCHEN_X - 0.1, minZ: HALL.minZ + 0.1, maxZ: HALL.maxZ - 0.1, top: DROP_CEIL - 0.15 },
    { minX: KITCHEN_X - 0.1, maxX: HALL.maxX - 0.1, minZ: HALL.minZ + 0.1, maxZ: HALL.maxZ - 0.1, top: KITCHEN_CEIL - 0.4 },
  ];

  // Places the camera must not go even though they're inside (behind the meeting rooms' glass).
  const camBlocks = [{ minX: MEET.minX, maxX: MEET.maxX + 0.15, minZ: MEET.minZ - 0.15, maxZ: HALL.maxZ }];

  let wasInGame = true;
  return {
    group: g,
    colliders,
    rects,
    camRects,
    camBlocks,
    updateDoors,
    /** Per frame, with the local walker's position (or null when nobody is walking). */
    update(pos) {
      const inGame = !pos || pos.z > GAME.minZ - 0.4;
      // Out in the hall, one shadow light hangs over you; the game room's shadow maps stop updating.
      if (!inGame) {
        follow.position.set(pos.x + 0.4, (pos.x > KITCHEN_X ? KITCHEN_CEIL : DROP_CEIL) - 0.1, pos.z + 0.6);
        follow.target.position.set(pos.x, 0, pos.z);
        follow.target.updateMatrixWorld();
      }
      follow.intensity = THREE.MathUtils.lerp(follow.intensity, inGame ? 0 : 7, 0.1);
      if (inGame !== wasInGame) {
        for (const l of arena.roomShadowLights ?? []) {
          l.shadow.autoUpdate = inGame;
          l.shadow.needsUpdate = true;
        }
        follow.shadow.autoUpdate = !inGame;
        wasInGame = inGame;
      }
    },
  };
}

/** Take out the game room's back wall (a single quad in the shell) and the closed doors. */
function openDoorway(shell, g) {
  const walls = shell.getObjectByName('walls_white');
  if (walls?.geometry) {
    const geo = walls.geometry;
    const pos = geo.attributes.position;
    const idx = geo.index ? Array.from(geo.index.array) : [...Array(pos.count).keys()];
    const keep = [];
    for (let i = 0; i < idx.length; i += 3) {
      const back = [0, 1, 2].every((k) => pos.getZ(idx[i + k]) < GAME.minZ + 0.01);
      if (!back) keep.push(idx[i], idx[i + 1], idx[i + 2]);
    }
    const clone = geo.clone();
    clone.setIndex(keep);
    walls.geometry = clone;
  }
  for (const name of ['doors', 'door_handles']) {
    const o = shell.getObjectByName(name);
    if (o) o.visible = false;
  }
}

function findMaterial(root, name) {
  let found = null;
  root.traverse((o) => {
    if (found || !o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m.name === name) found = m;
  });
  return found;
}

/** A square tile with a grout line (carpet tiles, concrete, ceiling tiles). */
function tileTexture(fill, line, lineWidth, noise) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = fill;
  x.fillRect(0, 0, 128, 128);
  // A little grain so big floors don't look like flat paint.
  const img = x.getImageData(0, 0, 128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 18 * (1 - noise + 0.3);
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  x.putImageData(img, 0, 0);
  x.strokeStyle = line;
  x.lineWidth = lineWidth;
  x.strokeRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** One 2'x2' acoustic ceiling tile in its T-bar: off-white, pin-holed and fissured, edges shadowed. */
function acousticTileTexture() {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const x = c.getContext('2d');
  x.fillStyle = '#efede8';
  x.fillRect(0, 0, N, N);
  const img = x.getImageData(0, 0, N, N);
  for (let i = 0; i < img.data.length; i += 4) {
    let v = (Math.random() - 0.5) * 10;
    if (Math.random() < 0.02) v -= 35 + Math.random() * 30; // pinholes
    img.data[i] += v;
    img.data[i + 1] += v;
    img.data[i + 2] += v;
  }
  x.putImageData(img, 0, 0);
  // Fissures: short wandering grooves.
  x.strokeStyle = 'rgba(160,156,148,0.35)';
  x.lineCap = 'round';
  for (let k = 0; k < 70; k++) {
    let px = Math.random() * N;
    let py = Math.random() * N;
    let a = Math.random() * Math.PI * 2;
    x.lineWidth = 0.8 + Math.random() * 1.2;
    x.beginPath();
    x.moveTo(px, py);
    for (let j = 0; j < 5; j++) {
      a += (Math.random() - 0.5) * 1.4;
      px += Math.cos(a) * 4;
      py += Math.sin(a) * 4;
      x.lineTo(px, py);
    }
    x.stroke();
  }
  // The tile sits a touch above the grid: a soft shadow inside its edge, then the white T-bar.
  const sh = x.createLinearGradient(0, 0, 0, 12);
  for (const [w, h, rot] of [[N, 12, 0], [N, 12, 1], [N, 12, 2], [N, 12, 3]]) {
    x.save();
    x.translate(N / 2, N / 2);
    x.rotate((rot * Math.PI) / 2);
    x.translate(-N / 2, -N / 2);
    const gr = x.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, 'rgba(120,116,110,0.35)');
    gr.addColorStop(1, 'rgba(120,116,110,0)');
    x.fillStyle = gr;
    x.fillRect(0, 0, w, h);
    x.restore();
  }
  void sh;
  x.strokeStyle = '#f7f7f5';
  x.lineWidth = 6;
  x.strokeRect(0, 0, N, N);
  x.strokeStyle = 'rgba(150,150,146,0.7)';
  x.lineWidth = 1;
  x.strokeRect(3.5, 3.5, N - 7, N - 7);
  return canvasTex(c);
}

/** A 2'x4' troffer: white frame, glowing diffuser with a fine prismatic grid and two brighter tubes. */
function trofferTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#e9e8e4';
  x.fillRect(0, 0, 128, 256);
  const gr = x.createLinearGradient(10, 0, 118, 0);
  gr.addColorStop(0, '#f2f1ec');
  gr.addColorStop(0.3, '#ffffff');
  gr.addColorStop(0.5, '#f6f5f0');
  gr.addColorStop(0.7, '#ffffff');
  gr.addColorStop(1, '#f2f1ec');
  x.fillStyle = gr;
  x.fillRect(9, 9, 110, 238);
  x.strokeStyle = 'rgba(200,198,190,0.35)';
  x.lineWidth = 1;
  for (let i = 9; i < 119; i += 4) {
    x.beginPath();
    x.moveTo(i, 9);
    x.lineTo(i, 247);
    x.stroke();
  }
  for (let j = 9; j < 247; j += 4) {
    x.beginPath();
    x.moveTo(9, j);
    x.lineTo(119, j);
    x.stroke();
  }
  x.strokeStyle = '#d4d3ce';
  x.lineWidth = 2;
  x.strokeRect(8, 8, 112, 240);
  return canvasTex(c);
}

/** A return-air grille: a frame around parallel dark slots. */
function grilleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#e6e5e1';
  x.fillRect(0, 0, 128, 128);
  x.fillStyle = '#5d5f62';
  for (let i = 14; i < 114; i += 7) x.fillRect(12, i, 104, 3.2);
  x.strokeStyle = '#cfceca';
  x.lineWidth = 3;
  x.strokeRect(8, 8, 112, 112);
  return canvasTex(c);
}

/** Sprayed-on fireproofing on an exposed deck: lumpy, grey-white, with darker pits. */
function sprayTexture() {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const x = c.getContext('2d');
  x.fillStyle = '#cfccc6';
  x.fillRect(0, 0, N, N);
  // Lumps at a few sizes (wrapped so the texture tiles).
  for (const [count, r0, r1, a] of [[260, 6, 14, 0.18], [900, 2, 5, 0.22], [2500, 0.6, 1.6, 0.3]]) {
    for (let k = 0; k < count; k++) {
      const px = Math.random() * N;
      const py = Math.random() * N;
      const r = r0 + Math.random() * (r1 - r0);
      const light = Math.random() < 0.55;
      x.fillStyle = light ? `rgba(245,243,238,${a})` : `rgba(120,116,110,${a})`;
      for (const [ox, oy] of [[0, 0], [N, 0], [-N, 0], [0, N], [0, -N]]) {
        x.beginPath();
        x.arc(px + ox, py + oy, r, 0, Math.PI * 2);
        x.fill();
      }
    }
  }
  return canvasTex(c);
}

function canvasTex(c) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Office carpet tiles: a dense, slightly flecked loop pile in slate blue-grey. One texture
 * holds a 2x2 block of 0.6 m tiles laid in alternating directions (the usual quarter-turn
 * install), which shows as a faint checker of grain at a distance.
 */
function carpetTexture() {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const x = c.getContext('2d');
  const img = x.createImageData(N, N);
  const base = [86, 93, 104];
  for (let y = 0; y < N; y++) {
    for (let px = 0; px < N; px++) {
      const i = (y * N + px) * 4;
      // Rows of loops, running across or along depending on the tile.
      const across = ((px < N / 2) !== (y < N / 2));
      const row = across ? y : px;
      const loop = Math.sin(row * 1.9) * 7 + Math.sin((across ? px : y) * 0.7 + row) * 3;
      const grain = (Math.random() - 0.5) * 34;
      // The odd bright or dark fleck, as in real tufted yarn.
      const fleck = Math.random() < 0.015 ? (Math.random() < 0.5 ? -40 : 30) : 0;
      const v = loop + grain + fleck;
      img.data[i] = base[0] + v;
      img.data[i + 1] = base[1] + v * 1.02;
      img.data[i + 2] = base[2] + v * 1.08;
      img.data[i + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  // Faint seams between tiles.
  x.strokeStyle = 'rgba(40,44,52,0.35)';
  x.lineWidth = 1.5;
  x.strokeRect(0, 0, N, N);
  x.beginPath();
  x.moveTo(N / 2, 0);
  x.lineTo(N / 2, N);
  x.moveTo(0, N / 2);
  x.lineTo(N, N / 2);
  x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** What you see out of the windows: the bay to the north and west, a brick building to the east. */
function addViews(g) {
  const view = (draw, w, h, x, y, z, rotY) => {
    const c = document.createElement('canvas');
    c.width = 2048;
    c.height = 1024;
    draw(c.getContext('2d'), c.width, c.height);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, fog: false }));
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    g.add(m);
  };
  // The backdrops sit ~14 m out; the horizon is drawn at canvas 52%, near eye height.
  const bay = (seed) => (x, w, h) => {
    const horizon = h * 0.52;
    const sky = x.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#8fb6d9');
    sky.addColorStop(1, '#e6eef2');
    x.fillStyle = sky;
    x.fillRect(0, 0, w, horizon);
    // Far hills.
    x.fillStyle = '#9aa9b4';
    x.beginPath();
    x.moveTo(0, horizon);
    for (let i = 0; i <= 40; i++) x.lineTo((i / 40) * w, horizon - 30 - 40 * Math.abs(Math.sin(i * 0.55 + seed)) - 20 * Math.sin(i * 1.7 + seed * 2));
    x.lineTo(w, horizon);
    x.fill();
    // A low skyline on the far shore.
    let r = seed * 99;
    const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
    for (let px = 0; px < w; px += 18 + rnd() * 30) {
      const bh = 10 + rnd() * 60;
      x.fillStyle = `rgb(${120 + rnd() * 30},${132 + rnd() * 30},${145 + rnd() * 25})`;
      x.fillRect(px, horizon - bh, 14 + rnd() * 20, bh);
    }
    // The bay.
    const sea = x.createLinearGradient(0, horizon, 0, h);
    sea.addColorStop(0, '#7f9fb3');
    sea.addColorStop(1, '#3d6177');
    x.fillStyle = sea;
    x.fillRect(0, horizon, w, h - horizon);
    x.strokeStyle = 'rgba(255,255,255,0.18)';
    for (let i = 0; i < 160; i++) {
      const yy = horizon + Math.pow(rnd(), 1.6) * (h - horizon);
      const len = 10 + ((yy - horizon) / (h - horizon)) * 60;
      x.lineWidth = 1 + ((yy - horizon) / (h - horizon)) * 2;
      const xx = rnd() * w;
      x.beginPath();
      x.moveTo(xx, yy);
      x.lineTo(xx + len, yy);
      x.stroke();
    }
  };
  const H = 24;
  const Y = 1.6 - H * 0.02; // canvas 52% from the top lands at ~eye height
  view(bay(1), 64, H, 2, Y, HALL.minZ - 14, 0);
  view(bay(4), 40, H, HALL.minX - 14, Y, -13.5, Math.PI / 2);
  // East: the old brick building across the street, close.
  view(
    (x, w, h) => {
      x.fillStyle = '#9a5a43';
      x.fillRect(0, 0, w, h);
      for (let yy = 0; yy < h; yy += 10)
        for (let xx = (yy / 10) % 2 ? -14 : 0; xx < w; xx += 28) {
          x.fillStyle = `rgb(${140 + Math.random() * 30},${74 + Math.random() * 20},${56 + Math.random() * 16})`;
          x.fillRect(xx + 1, yy + 1, 26, 8);
        }
      for (let row = 0; row < 4; row++)
        for (let col = 0; col < 9; col++) {
          x.fillStyle = '#2b3138';
          x.fillRect(80 + col * 220, 90 + row * 240, 110, 150);
          x.fillStyle = '#d9d2c4';
          x.fillRect(74 + col * 220, 240 + row * 240, 122, 10);
        }
    },
    40,
    24,
    HALL.maxX + 9,
    Y - 4,
    -13.5,
    -Math.PI / 2
  );
}
