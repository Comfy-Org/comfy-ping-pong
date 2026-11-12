import * as THREE from 'three';
import { TABLE } from '../config.js';

/** Floor, table, net, lights. Purely visual — collisions live in ballPhysics. */
export function buildArena(scene) {
  scene.background = new THREE.Color(0x10131a);
  scene.fog = new THREE.Fog(0x10131a, 8, 22);

  const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x2a2420, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(1.5, 6, 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 15 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  // Floor
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.MeshStandardMaterial({ color: 0x7a3b2e, roughness: 0.9 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const parts = { floor: [floor], table: [], net: [] };

  // Court surround
  const court = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 12),
    new THREE.MeshStandardMaterial({ color: 0x8c4636, roughness: 0.85 })
  );
  court.rotation.x = -Math.PI / 2;
  court.position.y = 0.001;
  court.receiveShadow = true;
  scene.add(court);
  parts.floor.push(court);

  // Table top
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(TABLE.width, TABLE.thickness, TABLE.length),
    new THREE.MeshStandardMaterial({ color: 0x1d4f91, roughness: 0.45 })
  );
  top.position.y = TABLE.height - TABLE.thickness / 2;
  top.castShadow = top.receiveShadow = true;
  scene.add(top);
  parts.table.push(top);

  // White lines (edges + center line)
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const y = TABLE.height + 0.0006;
  const lw = 0.02;
  const addLine = (w, l, x, z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), lineMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    scene.add(m);
    parts.table.push(m);
  };
  addLine(lw, TABLE.length, TABLE.width / 2 - lw / 2, 0);
  addLine(lw, TABLE.length, -TABLE.width / 2 + lw / 2, 0);
  addLine(TABLE.width, lw, 0, TABLE.length / 2 - lw / 2);
  addLine(TABLE.width, lw, 0, -TABLE.length / 2 + lw / 2);
  addLine(0.003, TABLE.length, 0, 0);

  // Legs
  const legMat = new THREE.MeshStandardMaterial({ color: 0x222831, metalness: 0.6, roughness: 0.4 });
  const legGeo = new THREE.BoxGeometry(0.05, TABLE.height - TABLE.thickness, 0.05);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(sx * (TABLE.width / 2 - 0.12), (TABLE.height - TABLE.thickness) / 2, sz * (TABLE.length / 2 - 0.25));
      leg.castShadow = true;
      scene.add(leg);
      parts.table.push(leg);
    }
  }

  // Net
  const netWidth = TABLE.width + TABLE.netOverhang * 2;
  const net = new THREE.Mesh(
    new THREE.PlaneGeometry(netWidth, TABLE.netHeight),
    new THREE.MeshStandardMaterial({ color: 0xf2f2f2, transparent: true, opacity: 0.45, side: THREE.DoubleSide })
  );
  net.position.set(0, TABLE.height + TABLE.netHeight / 2, 0);
  scene.add(net);
  parts.net.push(net);
  const tape = new THREE.Mesh(new THREE.BoxGeometry(netWidth, 0.012, 0.006), new THREE.MeshStandardMaterial({ color: 0xffffff }));
  tape.position.set(0, TABLE.height + TABLE.netHeight, 0);
  scene.add(tape);
  parts.net.push(tape);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, TABLE.netHeight + 0.02, 8), legMat);
    post.position.set(sx * netWidth / 2, TABLE.height + TABLE.netHeight / 2, 0);
    scene.add(post);
    parts.net.push(post);
  }

  /** Procedural stand-ins, hidden when the office GLBs that replace them load. */
  return { sun, hemi, parts };
}
