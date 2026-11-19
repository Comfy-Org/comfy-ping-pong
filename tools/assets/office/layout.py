"""Office prop placements -> office_layout.json (engine format) + a combined preview GLB.

Engine format: [{ "file", "position"?: [x,y,z], "rotY"?: deg, "castShadow"?: bool }]
rotY follows three.js (positive = counter-clockwise seen from above; +90 turns a +Z-facing prop to face +X).
Floor props stay outside the clear zone (|x| <= 3.5 and |z| <= 5 around the table).

usage: layout.py [preview.glb]

NOTE: this is the ORIGINAL game-room layout (waves 1-2). The live layout is
public/assets/office/office_layout.json, which scripts/layout-floor.mjs owns and merges
(game room + office floor, entries tagged "zone"). This script therefore writes to
tools/assets/office/out/office_layout.json, never to public/. Port any change you want
to keep into scripts/layout-floor.mjs.
"""
import json, math, os, sys
import numpy as np
import trimesh

Z0, Z1, X0, X1 = -6.5, 6.5, -7.5, 7.5   # room widened to 15 m on 2026-11-19
DOOR_X = -2.9                           # door centre, matches build_room.py dx

L = [
    {"file": "room_shell.glb"},
    {"file": "pingpong_table.glb"},
    {"file": "pingpong_net.glb"},
    # wall decor (local space: back at z=0, facing +Z, origin at its center)
    {"file": "exit_sign.glb", "position": [DOOR_X, 2.55, Z0], "rotY": 0, "castShadow": False},
    {"file": "wall_posters.glb", "position": [-0.3, 1.6, Z0], "rotY": 0, "castShadow": False},
    {"file": "fire_extinguisher_sign.glb", "position": [X0, 1.3, -5.3], "rotY": 90, "castShadow": False},
    # -Z end (seen from Matt's camera): cafe area in front of the grey wall, TV between the tables
    {"file": "wall_tv.glb", "position": [2.3, 1.25, Z0], "rotY": 0, "castShadow": False},
    {"file": "cafe_table.glb", "position": [1.2, 0, -5.6], "rotY": 0},
    {"file": "cafe_table.glb", "position": [3.4, 0, -5.6], "rotY": 0},
    {"file": "cafe_chair.glb", "position": [0.55, 0, -5.6], "rotY": 90},
    {"file": "cafe_chair.glb", "position": [1.85, 0, -5.6], "rotY": -90},
    {"file": "cafe_chair.glb", "position": [2.75, 0, -5.6], "rotY": 90},
    {"file": "cafe_chair.glb", "position": [4.05, 0, -5.6], "rotY": -90},
    {"file": "pendant_light.glb", "position": [1.2, 2.6, -5.6], "rotY": 0, "castShadow": False},
    {"file": "pendant_light.glb", "position": [3.4, 2.6, -5.6], "rotY": 0, "castShadow": False},
    {"file": "coat_rack.glb", "position": [-4.55, 0, -6.05], "rotY": 0},
    # +Z end (seen from Deep's camera): lounge against the +Z wall, facing the table
    {"file": "sofa.glb", "position": [-1.7, 0, Z1 - 0.52], "rotY": 180},
    {"file": "cafe_table.glb", "position": [0.05, 0, Z1 - 0.5], "rotY": 0},
    {"file": "table_lamp.glb", "position": [0.05, 0.75, Z1 - 0.5], "rotY": 180},
    {"file": "lounge_chair.glb", "position": [1.75, 0, Z1 - 0.65], "rotY": 195},
    {"file": "ladder_shelf.glb", "position": [3.9, 0, Z1 - 0.25], "rotY": 180},
    # ---- wave 2 (2026-11-19): side wings ----
    # +X wing: kitchen (-Z), dining (middle), games (+Z)
    {"file": "fridge_steel.glb", "position": [7.1, 0, -5.6], "rotY": -90},
    {"file": "drinks_fridge.glb", "position": [7.17, 0, -4.7], "rotY": -90},
    {"file": "kitchen_island.glb", "position": [5.6, 0, -4.2], "rotY": 90},
    {"file": "pendant_cylinder.glb", "position": [5.6, 2.6, -5.0], "castShadow": False},
    {"file": "pendant_cylinder.glb", "position": [5.6, 2.6, -4.2], "castShadow": False},
    {"file": "pendant_cylinder.glb", "position": [5.6, 2.6, -3.4], "castShadow": False},
    {"file": "potted_tree.glb", "position": [7.0, 0, -2.6], "rotY": 0},
    {"file": "dining_table_wood.glb", "position": [5.4, 0, -0.6], "rotY": 90},
    {"file": "dining_chair_black.glb", "position": [4.45, 0, -1.1], "rotY": 90},
    {"file": "dining_chair_black.glb", "position": [4.45, 0, -0.1], "rotY": 90},
    {"file": "dining_chair_black.glb", "position": [6.35, 0, -1.1], "rotY": -90},
    {"file": "dining_chair_black.glb", "position": [6.35, 0, -0.1], "rotY": -90},
    {"file": "cafe_chair_beige.glb", "position": [5.4, 0, -1.95], "rotY": 0},
    {"file": "cafe_chair_beige.glb", "position": [5.4, 0, 0.75], "rotY": 180},
    {"file": "hashtag_neon.glb", "position": [7.45, 1.5, -0.6], "rotY": -90, "castShadow": False},
    {"file": "arcade_basketball.glb", "position": [6.25, 0, 2.6], "rotY": -90},
    {"file": "foosball_table.glb", "position": [4.4, 0, 4.6], "rotY": 90},
    {"file": "duck_portrait.glb", "position": [7.47, 1.2, 4.7], "rotY": -90, "castShadow": False},
    {"file": "rolling_whiteboard.glb", "position": [6.3, 0, 5.9], "rotY": 180},
    # -X wing: booth nook (-Z), desks, green booth + bookshelf, lounge (+Z)
    {"file": "booth_bench_grey.glb", "position": [-5.6, 0, -5.9], "rotY": 0},
    {"file": "booth_table.glb", "position": [-5.6, 0, -5.15], "rotY": 0},
    {"file": "booth_bench_grey.glb", "position": [-5.6, 0, -4.4], "rotY": 180},
    {"file": "duck_plush.glb", "position": [-5.75, 0.75, -5.15], "rotY": 90},
    {"file": "wall_planter.glb", "position": [-7.25, 1.7, -5.15], "rotY": 90, "castShadow": False},
    {"file": "potted_tree.glb", "position": [-7.0, 0, -3.95], "rotY": 40},
    {"file": "standing_desk.glb", "position": [-7.1, 0, -2.8], "rotY": 90},
    {"file": "monitor_black.glb", "position": [-7.25, 0.74, -2.8], "rotY": 90},
    {"file": "office_chair_mesh.glb", "position": [-6.3, 0, -2.8], "rotY": -90},
    {"file": "standing_desk.glb", "position": [-7.1, 0, -1.0], "rotY": 90},
    {"file": "monitor_white.glb", "position": [-7.25, 0.74, -1.0], "rotY": 90},
    {"file": "office_chair_mesh.glb", "position": [-6.3, 0, -1.0], "rotY": -75},
    {"file": "green_booth.glb", "position": [-7.15, 0, 1.3], "rotY": 90},
    {"file": "kids_bookshelf.glb", "position": [-7.33, 0, 2.9], "rotY": 90},
    {"file": "beanbag.glb", "position": [-4.8, 0, 2.9], "rotY": 120},
    {"file": "sectional_sofa.glb", "position": [-6.4, 0, 4.9], "rotY": 90},
    {"file": "marble_coffee_table.glb", "position": [-4.9, 0, 5.0], "rotY": 0},
    {"file": "tv_rolling_stand.glb", "position": [-3.95, 0, 4.9], "rotY": -90},
    {"file": "floor_lamp_paper.glb", "position": [-5.0, 0, 6.15], "rotY": 0},
]

here = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.normpath(os.path.join(here, '..', '..', '..', 'public', 'assets', 'office'))  # GLBs read from here
out_dir = os.path.join(here, 'out'); os.makedirs(out_dir, exist_ok=True)
json.dump(L, open(os.path.join(out_dir, 'office_layout.json'), 'w'), indent=1)
print('wrote out/office_layout.json', len(L), 'entries (not the live layout, see the docstring)')

# clear-zone check for floor props
for e in L:
    p = e.get('position')
    if p and p[1] == 0 and abs(p[0]) < 3.5 and abs(p[2]) < 5:
        print('WARNING in clear zone:', e)

if len(sys.argv) > 1:
    scene = trimesh.Scene()
    for i, e in enumerate(L):
        f = os.path.join(ASSETS, e['file'])
        if not os.path.exists(f):
            print('skip (missing)', e['file']); continue
        s = trimesh.load(f, force='scene')
        T = trimesh.transformations.rotation_matrix(math.radians(e.get('rotY', 0)), [0, 1, 0])
        T[:3, 3] = e.get('position', [0, 0, 0])
        s.apply_transform(T)
        for n in s.graph.nodes_geometry:
            M, gname = s.graph[n]
            g = s.geometry[gname].copy(); g.apply_transform(M)
            scene.add_geometry(g, node_name=f'{i}_{n}')
    scene.export(sys.argv[1])
    print('preview', sys.argv[1])
