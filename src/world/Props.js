import * as THREE from 'three';

/** Small procedural set dressing for the activity tables. Origin = table top center. */

export function buildCardTable() {
  const g = new THREE.Group();
  const felt = new THREE.Mesh(new THREE.CircleGeometry(0.3, 32), new THREE.MeshStandardMaterial({ color: 0x1f6b45, roughness: 0.9 }));
  felt.rotation.x = -Math.PI / 2;
  felt.position.y = 0.003;
  felt.receiveShadow = true;
  g.add(felt);

  const back = new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.5 });
  const face = new THREE.MeshStandardMaterial({ color: 0xfbfaf5, roughness: 0.5 });
  const cardGeo = new THREE.BoxGeometry(0.063, 0.0012, 0.088);
  // Deck
  for (let i = 0; i < 14; i++) {
    const c = new THREE.Mesh(cardGeo, back);
    c.position.set(-0.12, 0.004 + i * 0.0013, 0);
    c.rotation.y = (Math.random() - 0.5) * 0.06;
    c.castShadow = i === 13;
    g.add(c);
  }
  // A dealt hand, fanned, face up
  for (let i = 0; i < 5; i++) {
    const c = new THREE.Mesh(cardGeo, face);
    c.position.set(0.06 + i * 0.028, 0.004 + i * 0.0013, 0.06);
    c.rotation.y = -0.35 + i * 0.17;
    g.add(c);
  }
  // Chips
  const chipGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.005, 16);
  const chipCols = [0xe53935, 0x1e88e5, 0x212121];
  chipCols.forEach((col, k) => {
    const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.5 });
    for (let i = 0; i < 4 + k * 2; i++) {
      const chip = new THREE.Mesh(chipGeo, mat);
      chip.position.set(0.02 + k * 0.045, 0.0055 + i * 0.0052, -0.11);
      chip.castShadow = true;
      g.add(chip);
    }
  });
  return g;
}
