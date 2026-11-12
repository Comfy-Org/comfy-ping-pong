import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BASE = '/assets/office/';
const LAYOUT_URL = BASE + 'office_layout.json';

/**
 * Office set dressing — visual only; ball physics never reads these meshes.
 *
 * Layout comes from public/assets/office/office_layout.json (written by the asset pipeline):
 *   [{ file, position?: [x,y,z], rotY?: degrees, castShadow?: bool }, ...]
 * No position = placed at the origin. Props are bottom-center origin, front facing +Z.
 * Repeat an entry for multiple copies (each file downloads once and is cloned).
 */

/** Procedural stand-ins from buildArena that each GLB replaces. */
const REPLACES = {
  'room_shell.glb': ['floor'],
  'pingpong_table.glb': ['table'],
  'pingpong_net.glb': ['net'],
};

/** Warm practical lights added under these props (offset from the prop origin). */
const PRACTICAL_LIGHTS = {
  'pendant_light.glb': { offset: [0, -0.15, 0], color: 0xffd6a0, intensity: 3, distance: 5 },
  'table_lamp.glb': { offset: [0, 0.45, 0], color: 0xffcf8f, intensity: 1.5, distance: 3 },
};

/** Ceiling LED strips (room shell, y 2.82): soft fill over the play area. */
const LED_LIGHTS = [
  [-1.6, 2.75, -2.5],
  [1.6, 2.75, -2.5],
  [-1.6, 2.75, 2.5],
  [1.6, 2.75, 2.5],
];

/** Used only if office_layout.json is missing. */
const FALLBACK_LAYOUT = [{ file: 'room_shell.glb' }, { file: 'pingpong_table.glb' }, { file: 'pingpong_net.glb' }];

async function fetchLayout() {
  try {
    const res = await fetch(LAYOUT_URL);
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } catch (e) {
    console.warn('[office] layout JSON unavailable, using fallback', e);
    return FALLBACK_LAYOUT;
  }
}

export async function loadOffice(scene, arena, layout) {
  layout ??= await fetchLayout();
  const loader = new GLTFLoader();
  const cache = new Map();

  const results = await Promise.allSettled(
    layout.map(async (item) => {
      if (!cache.has(item.file)) cache.set(item.file, { promise: loader.loadAsync(BASE + item.file), used: false });
      const entry = cache.get(item.file);
      const gltf = await entry.promise;
      const obj = entry.used ? gltf.scene.clone(true) : gltf.scene;
      entry.used = true;

      if (item.position) obj.position.fromArray(item.position);
      if (item.rotY) obj.rotation.y = THREE.MathUtils.degToRad(item.rotY);
      const castShadow = item.castShadow ?? item.file !== 'room_shell.glb'; // the ceiling would shadow everything
      obj.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = castShadow;
        o.receiveShadow = true;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (/led_glow|exit_face/i.test(m.name)) m.emissiveIntensity = Math.max(m.emissiveIntensity ?? 1, 2);
        }
      });
      scene.add(obj);

      const light = PRACTICAL_LIGHTS[item.file];
      if (light) {
        const l = new THREE.PointLight(light.color, light.intensity, light.distance, 1.8);
        l.position.copy(obj.position).add(new THREE.Vector3(...light.offset));
        scene.add(l);
      }
      for (const key of REPLACES[item.file] ?? []) arena.parts[key]?.forEach((m) => (m.visible = false));
      return item.file;
    })
  );
  results.forEach((r, i) => r.status === 'rejected' && console.warn(`[office] ${layout[i].file} failed`, r.reason));

  if (results.some((r) => r.status === 'fulfilled')) {
    for (const p of LED_LIGHTS) {
      const l = new THREE.PointLight(0xfff3e0, 2.5, 9, 1.6);
      l.position.fromArray(p);
      scene.add(l);
    }
    arena.hemi.intensity = 0.45;
    arena.sun.intensity = 1.5;
    scene.fog = new THREE.Fog(0xe9e4dc, 10, 24);
    scene.background = new THREE.Color(0xe9e4dc);
  }
  return results;
}
