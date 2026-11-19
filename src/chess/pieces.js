import * as THREE from 'three';

/**
 * Staunton-ish chess pieces from lathe profiles. Origin = center of the base.
 * Knights' heads face local +Z (ChessTable turns them toward the opponent).
 */

const MATS = {
  w: new THREE.MeshStandardMaterial({ color: 0xf3ead8, roughness: 0.35 }),
  b: new THREE.MeshStandardMaterial({ color: 0x24201e, roughness: 0.3, metalness: 0.05 }),
};

const HEIGHT = { p: 0.03, r: 0.036, n: 0.04, b: 0.047, q: 0.05, k: 0.056 };
const BASE_R = 0.0155;

/** Profiles as [radius, height] in units of the piece height (radius scaled separately). */
const PROFILES = {
  p: [[1, 0], [1, 0.1], [0.75, 0.16], [0.42, 0.3], [0.3, 0.62], [0.62, 0.66], [0.3, 0.7], [0, 0.7]],
  r: [[1, 0], [1, 0.1], [0.78, 0.17], [0.6, 0.3], [0.58, 0.78], [0.78, 0.82], [0.78, 1], [0, 1]],
  n: [[1, 0], [1, 0.1], [0.75, 0.16], [0.55, 0.3], [0.62, 0.42], [0, 0.42]],
  // Slim stem and a double collar; the pointed mitre on top is its own lathe (MITRE).
  b: [[1, 0], [1, 0.08], [0.72, 0.14], [0.34, 0.28], [0.22, 0.52], [0.52, 0.55], [0.24, 0.58], [0.46, 0.61], [0.2, 0.63], [0, 0.63]],
  q: [[1, 0], [1, 0.08], [0.72, 0.14], [0.36, 0.3], [0.27, 0.66], [0.6, 0.7], [0.32, 0.74], [0.5, 0.88], [0, 0.88]],
  k: [[1, 0], [1, 0.08], [0.72, 0.14], [0.36, 0.3], [0.28, 0.64], [0.62, 0.68], [0.34, 0.72], [0.52, 0.84], [0, 0.84]],
};

/** Bishop's mitre: an onion that swells and then narrows to a point (vs the pawn's round ball). */
const MITRE = [[0, 0], [0.32, 0.02], [0.5, 0.1], [0.54, 0.18], [0.46, 0.28], [0.28, 0.37], [0.1, 0.43], [0, 0.45]];

const cache = new Map();

function lathe(type) {
  if (cache.has(type)) return cache.get(type);
  const h = HEIGHT[type];
  const pts = PROFILES[type].map(([r, y]) => new THREE.Vector2(Math.max(r * BASE_R, 0.0001), y * h));
  const geo = new THREE.LatheGeometry(pts, 24);
  geo.computeVertexNormals();
  cache.set(type, geo);
  return geo;
}

const NOTCH = {
  w: new THREE.MeshStandardMaterial({ color: 0x5a4a35, roughness: 0.6 }),
  b: new THREE.MeshStandardMaterial({ color: 0x8a7f74, roughness: 0.6 }),
};

function mitreGeometry() {
  if (cache.has('mitre')) return cache.get('mitre');
  const h = HEIGHT.b;
  const geo = new THREE.LatheGeometry(MITRE.map(([r, y]) => new THREE.Vector2(Math.max(r * BASE_R, 0.0001), y * h)), 24);
  geo.computeVertexNormals();
  cache.set('mitre', geo);
  return geo;
}

export function buildPiece(type, color) {
  const mat = MATS[color];
  const h = HEIGHT[type];
  const g = new THREE.Group();
  const add = (geo, x = 0, y = 0, z = 0, rot = null) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rot) m.rotation.set(...rot);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  add(lathe(type));

  if (type === 'p') {
    add(new THREE.SphereGeometry(BASE_R * 0.52, 16, 12), 0, h * 0.84);
  } else if (type === 'r') {
    // Crenellations on the rim.
    const merlon = new THREE.BoxGeometry(BASE_R * 0.42, h * 0.16, BASE_R * 0.42);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      add(merlon, Math.cos(a) * BASE_R * 0.58, h * 1.06, Math.sin(a) * BASE_R * 0.58, [0, -a, 0]);
    }
  } else if (type === 'n') {
    // Neck leaning forward, then a head pointing along +Z.
    add(new THREE.BoxGeometry(BASE_R * 0.9, h * 0.5, BASE_R * 1.1), 0, h * 0.62, -BASE_R * 0.1, [0.25, 0, 0]);
    add(new THREE.BoxGeometry(BASE_R * 0.8, h * 0.26, BASE_R * 1.7), 0, h * 0.86, BASE_R * 0.35, [-0.35, 0, 0]);
    // Ears and mane.
    add(new THREE.ConeGeometry(BASE_R * 0.22, h * 0.16, 6), 0, h * 1.02, -BASE_R * 0.1);
    add(new THREE.BoxGeometry(BASE_R * 0.3, h * 0.55, BASE_R * 0.35), 0, h * 0.66, -BASE_R * 0.62, [0.2, 0, 0]);
  } else if (type === 'b') {
    add(mitreGeometry(), 0, h * 0.6);
    add(new THREE.SphereGeometry(BASE_R * 0.17, 10, 8), 0, h * 1.07); // finial
    // The mitre's diagonal notch, in a contrasting shade of the piece's own color.
    const notch = add(new THREE.BoxGeometry(BASE_R * 1.3, h * 0.06, BASE_R * 0.22), 0, h * 0.84, 0, [0, 0, 0.75]);
    notch.material = NOTCH[color];
    notch.castShadow = false;
  } else if (type === 'q') {
    add(new THREE.TorusGeometry(BASE_R * 0.48, BASE_R * 0.1, 8, 20), 0, h * 0.9, 0, [Math.PI / 2, 0, 0]);
    const spike = new THREE.ConeGeometry(BASE_R * 0.12, h * 0.1, 6);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      add(spike, Math.cos(a) * BASE_R * 0.48, h * 0.96, Math.sin(a) * BASE_R * 0.48);
    }
    add(new THREE.SphereGeometry(BASE_R * 0.2, 10, 8), 0, h * 1.0);
  } else if (type === 'k') {
    add(new THREE.CylinderGeometry(BASE_R * 0.48, BASE_R * 0.3, h * 0.08, 16), 0, h * 0.88);
    add(new THREE.BoxGeometry(BASE_R * 0.18, h * 0.2, BASE_R * 0.18), 0, h * 1.0);
    add(new THREE.BoxGeometry(BASE_R * 0.5, h * 0.06, BASE_R * 0.18), 0, h * 1.03);
  }
  return g;
}
