import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildFloor } from '../world/Floor.js';

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

/**
 * Warm practical lights added under these props (offset from the prop origin). `spot` lights
 * point straight down and cast shadows (the pendants over the café tables).
 */
const PRACTICAL_LIGHTS = {
  'pendant_light.glb': { offset: [0, -0.15, 0], color: 0xffd6a0, intensity: 5, distance: 6, spot: { angle: 1.05, shadow: true } },
  'table_lamp.glb': { offset: [0, 0.45, 0], color: 0xffcf8f, intensity: 1.5, distance: 3 },
  'pendant_cylinder.glb': { offset: [0, -0.05, 0], color: 0xffd6a0, intensity: 4, distance: 5, spot: { angle: 1.0, shadow: false } },
  'floor_lamp_paper.glb': { offset: [0, 1.2, 0], color: 0xffcf8f, intensity: 2, distance: 3.5 },
};

/**
 * The room shell's ceiling LED strips: three runs along Z (x = -3.2, 0, 3.2), each in three
 * segments, at y 2.82. Every segment gets a downward spotlight. Shadows come from these
 * fixtures (not one far-off sun), so each shadow points away from the nearest light and
 * softens and fades as you walk away from it. Only the middle run, over the ping-pong table
 * and the walkway, casts shadows, to keep the shadow passes cheap; the side runs are fill.
 */
const LED_X = [-3.2, 0, 3.2];
const LED_Z = [-3.2, -0.5, 2.2];
/** The side wings' strips (x ±6.2) get two fill lights each. */
const WING_LIGHTS = [[-6.2, -2.5], [-6.2, 2.5], [6.2, -2.5], [6.2, 2.5]];
const LED_Y = 2.78;
const SHADOW_MAP = 1024;

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
      (arena.props ??= []).push({ file: item.file, obj });

      const light = PRACTICAL_LIGHTS[item.file];
      if (light) {
        const pos = obj.position.clone().add(new THREE.Vector3(...light.offset));
        if (light.spot) {
          const l = addCeilingSpot(scene, pos, { ...light, ...light.spot });
          if (light.spot.shadow) (arena.roomShadowLights ??= []).push(l);
        }
        else {
          const l = new THREE.PointLight(light.color, light.intensity, light.distance, 1.8);
          l.position.copy(pos);
          scene.add(l);
        }
      }
      for (const key of REPLACES[item.file] ?? []) arena.parts[key]?.forEach((m) => (m.visible = false));
      return item.file;
    })
  );
  results.forEach((r, i) => r.status === 'rejected' && console.warn(`[office] ${layout[i].file} failed`, r.reason));

  if (results.some((r) => r.status === 'fulfilled')) {
    for (const x of LED_X)
      for (const z of LED_Z) {
        const l = addCeilingSpot(scene, new THREE.Vector3(x, LED_Y, z), {
          color: 0xfff3e0,
          intensity: x === 0 ? 12 : 3.5,
          distance: 11,
          angle: 1.25,
          shadow: x === 0,
        });
        if (x === 0) (arena.roomShadowLights ??= []).push(l);
      }
    for (const [x, z] of WING_LIGHTS)
      addCeilingSpot(scene, new THREE.Vector3(x, LED_Y, z), { color: 0xfff3e0, intensity: 4.5, distance: 9, angle: 1.25 });
    // The rest of the floor, through the game room's door.
    const shell = arena.props.find((p) => p.file === 'room_shell.glb')?.obj;
    if (shell) arena.floor = buildFloor(scene, shell, arena);
    // The ceiling fixtures do the shadows now; the "sun" stays as a faint, shadowless top fill.
    arena.hemi.intensity = 0.5;
    arena.hemi.groundColor.set(0x8a7863); // light bouncing off the wood floor keeps the ceiling from going black
    arena.sun.castShadow = false;
    arena.sun.intensity = 0.35;
    scene.fog = new THREE.Fog(0xe9e4dc, 16, 42);
    scene.background = new THREE.Color(0xe9e4dc);
  }
  return results;
}

/**
 * A fixture pointing straight down. Its shadow is soft, and because light falls off with
 * distance (decay 2) a shadow fades as you walk away from the light that casts it.
 */
function addCeilingSpot(scene, pos, { color, intensity, distance, angle, shadow = false }) {
  const l = new THREE.SpotLight(color, intensity, distance, angle, 1, 2);
  l.position.copy(pos);
  l.target.position.set(pos.x, 0, pos.z);
  scene.add(l, l.target);
  if (shadow) {
    l.castShadow = true;
    l.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    l.shadow.camera.near = 0.2;
    l.shadow.camera.far = distance;
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 0.03;
    l.shadow.radius = 4; // softer edges (used by PCF; PCFSoft blurs on its own)
  }
  return l;
}
