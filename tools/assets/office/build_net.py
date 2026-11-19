"""Regulation table tennis net + post assembly as a standalone GLB (meters, Y-up, origin on the floor under the net).

Net: 1.83 m long (extends 15.25 cm past each side of a 1.525 m table), 15.25 cm tall, bottom at the playing
surface (y = 0.76), lying in the z = 0 plane. Alpha-masked grid texture + white top tape, black clamp posts.
"""
import sys
import numpy as np
import trimesh
from PIL import Image, ImageDraw

TOP = 0.76
H = 0.1525
L = 1.83
out = sys.argv[1]

# --- net texture: dark mesh grid with alpha holes, white top band ---
cells_x, cells_y, px = 120, 10, 16            # ~1.5 cm squares
w, h = cells_x * px, cells_y * px + 24
img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
for i in range(cells_x + 1):
    d.line([(i * px, 24), (i * px, h)], fill=(25, 28, 38, 255), width=3)
for j in range(cells_y + 1):
    d.line([(0, 24 + j * px), (w, 24 + j * px)], fill=(25, 28, 38, 255), width=3)
d.rectangle([0, 0, w, 24], fill=(245, 245, 245, 255))   # top tape (~1.5 cm)

v = np.array([[-L / 2, TOP, 0], [L / 2, TOP, 0], [L / 2, TOP + H, 0], [-L / 2, TOP + H, 0]], float)
f = np.array([[0, 1, 2], [0, 2, 3]])
uv = np.array([[0, 0], [1, 0], [1, 1], [0, 1]], float)
mat = trimesh.visual.material.PBRMaterial(name='net', baseColorTexture=img, alphaMode='MASK', alphaCutoff=0.5,
                                          doubleSided=True, metallicFactor=0.0, roughnessFactor=0.9)
net = trimesh.Trimesh(v, f, visual=trimesh.visual.TextureVisuals(uv=uv, material=mat), process=False)

# --- posts + clamps (black) ---
black = trimesh.visual.material.PBRMaterial(name='post', baseColorFactor=[18, 18, 20, 255], metallicFactor=0.2, roughnessFactor=0.6)
parts = []
for sx in (-1, 1):
    x = sx * (L / 2 + 0.008)
    post = trimesh.creation.box(extents=[0.022, H + 0.01, 0.03])
    post.apply_translation([x, TOP + (H + 0.01) / 2, 0])
    arm = trimesh.creation.box(extents=[0.16, 0.025, 0.045])           # clamp arm reaching back to table edge
    arm.apply_translation([x - sx * 0.07, TOP + 0.0125, 0])
    jaw = trimesh.creation.box(extents=[0.04, 0.06, 0.05])              # clamp jaw under the tabletop edge
    jaw.apply_translation([sx * 0.7625 + sx * 0.005, TOP - 0.02, 0])
    for p in (post, arm, jaw):
        p.visual = trimesh.visual.TextureVisuals(material=black)
        parts.append(p)

scene = trimesh.Scene()
scene.add_geometry(net, node_name='net_mesh')
for i, p in enumerate(parts):
    scene.add_geometry(p, node_name=f'net_post_{i}')
scene.export(out, include_normals=True)
b = scene.bounds
print('wrote', out, 'bounds', b.round(4).tolist(), 'tris', sum(len(g.faces) for g in scene.geometry.values()))
