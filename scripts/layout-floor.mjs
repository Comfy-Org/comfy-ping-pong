// Adds the rest of the office floor (desks, lounge, booth nook, meeting rooms, kitchen,
// game-room extras) to public/assets/office/office_layout.json. Re-running replaces
// the entries it added before (they carry "zone"), so hand edits to the game room stay.
// Positions are metres, bottom-centre origin, rotY in degrees (0 = front faces +Z).
import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../public/assets/office/office_layout.json', import.meta.url);
// The asset pipeline first put every wave-2 prop in the game room's side wings. The ones that
// belong to other parts of the office (per the photos) move out to their zones below.
const MOVED_OUT = /fridge_steel|kitchen_island|pendant_cylinder|dining_table_wood|dining_chair_black|cafe_chair_beige|standing_desk|monitor_|office_chair_mesh|kids_bookshelf|beanbag|sectional_sofa|marble_coffee_table|tv_rolling_stand|floor_lamp_paper|hashtag_neon|wall_planter/;
const layout = JSON.parse(await readFile(path, 'utf8')).filter((e) => !e.zone && !MOVED_OUT.test(e.file));
const out = [];
const add = (zone, file, x, y, z, rotY = 0, extra = {}) => out.push({ file, position: [x, y, z], rotY, zone, ...extra });

// Game room: the grey booth nook by the door gets its neon sign.
add('game', 'hashtag_neon.glb', -7.47, 1.45, -5.15, 90, { castShadow: false });
// The +X wing's back corner: a coffee bar, a high-top with stools, and the paddles on the wall.
add('game', 'coffee_bar.glb', 6.3, 0, -6.17);
add('game', 'paddle_rack.glb', 7.44, 1.2, -1.2, -90, { castShadow: false });
add('game', 'high_top_table.glb', 5.2, 0, -2.6);
add('game', 'shop_stool.glb', 5.2, 0, -3.2);
add('game', 'shop_stool.glb', 5.2, 0, -2.0, 180);
add('game', 'shop_stool.glb', 5.8, 0, -2.6, -90);

// Open desk area: three back-to-back rows of standing desks.
const DESK_X = [-3.6, -2, -0.4, 1.2, 2.8, 4.4];
for (const rz of [-10.6, -14.6, -18.6]) {
  for (const [i, x] of DESK_X.entries()) {
    for (const side of [1, -1]) {
      const z = rz + side * 0.4; // the desk's centre; it faces away from the spine
      const rot = side > 0 ? 0 : 180; // desk and screen face the person, who faces the spine
      add('desks', 'standing_desk.glb', x, 0, z, rot);
      add('desks', (i + (side > 0 ? 0 : 1)) % 3 ? 'monitor_black.glb' : 'monitor_white.glb', x, 0.74, rz + side * 0.12, rot, { castShadow: false });
      add('desks', 'office_chair_mesh.glb', x, 0, rz + side * 1.3, 180 - rot);
    }
  }
}
for (const [x, z, r] of [[-4.8, -12.6, 90], [-4.8, -16.6, 90], [6.5, -12.6, -90], [6.5, -16.6, -90]])
  add('desks', 'wall_planter.glb', x, 1.5, z, r, { castShadow: false });
add('desks', 'rolling_whiteboard.glb', -4.9, 0, -8.6, 60);
add('desks', 'exit_sign.glb', -2.9, 2.55, -6.72, 180, { castShadow: false });
add('desks', 'fire_extinguisher_sign.glb', 6.74, 1.3, -14.6, -90, { castShadow: false });

// Lora Lounge, the north-west corner (windows on two sides).
add('lounge', 'sectional_sofa.glb', -9.6, 0, -15.3, 180);
add('lounge', 'marble_coffee_table.glb', -10.4, 0, -17.2);
add('lounge', 'marble_coffee_table.glb', -8.8, 0, -17.2);
add('lounge', 'tv_rolling_stand.glb', -9.6, 0, -19.7);
add('lounge', 'potted_tree.glb', -12.3, 0, -19.8);
add('lounge', 'floor_lamp_paper.glb', -12.3, 0, -14.0);
add('lounge', 'kids_bookshelf.glb', -6.55, 0, -18.6, -90);
add('lounge', 'beanbag.glb', -7.3, 0, -16.6, -120);
add('lounge', 'printer_bench.glb', -12.6, 0, -16.8, 90); // the 3D printer, by the west windows
add('lounge', 'shop_stool.glb', -11.85, 0, -16.8, -90);

// Glass meeting rooms (you can see in; the doors are for later).
for (const cx of [-11.9, -9.6]) {
  add('meeting', 'cafe_table.glb', cx, 0, -9.0);
  add('meeting', 'cafe_chair.glb', cx - 0.65, 0, -9.0, 90);
  add('meeting', 'cafe_chair.glb', cx + 0.65, 0, -9.0, -90);
}
add('meeting', 'rolling_whiteboard.glb', -11.9, 0, -7.2, 180);

// Kitchen + dining, east of the desks.
add('kitchen', 'kitchen_island.glb', 12.25, 0, -9.4);
add('kitchen', 'fridge_steel.glb', 16.15, 0, -7.12, 180);
for (const x of [11.25, 12.25, 13.25]) add('kitchen', 'pendant_cylinder.glb', x, 2.6, -9.4, 0, { castShadow: false });
add('kitchen', 'green_booth.glb', 10.3, 0, -13.65, 0);
add('kitchen', 'green_booth.glb', 10.3, 0, -14.35, 180);
add('kitchen', 'booth_table.glb', 10.3, 0, -12.75);
add('kitchen', 'booth_table.glb', 10.3, 0, -15.25);
add('kitchen', 'dining_table_wood.glb', 14.0, 0, -14.0, 90);
for (const z of [-14.6, -14.0, -13.4]) {
  add('kitchen', 'dining_chair_black.glb', 13.2, 0, z, 90);
  add('kitchen', 'dining_chair_black.glb', 14.8, 0, z, -90);
}
for (const x of [11.0, 14.2]) {
  add('kitchen', 'cafe_table.glb', x, 0, -18.4);
  add('kitchen', 'cafe_chair_beige.glb', x - 0.65, 0, -18.4, 90);
  add('kitchen', 'cafe_chair_beige.glb', x + 0.65, 0, -18.4, -90);
}

const round = (v) => (Array.isArray(v) ? v.map((n) => Math.round(n * 1000) / 1000) : v);
await writeFile(path, JSON.stringify([...layout, ...out.map((e) => ({ ...e, position: round(e.position) }))], null, 1) + '\n');
console.log(`${out.length} floor entries written (${layout.length} kept)`);
