"""Procedural office ping pong room shell + flat wall decor, as GLBs (meters, Y-up, origin = room floor center).

Layout (table at origin, long axis along Z, game camera at +Z looking toward -Z):
  room       x -5.0 .. 5.0, z -6.5 .. 6.5, ceiling 3.2 m
  -X wall    white (bookshelf, TV, sofa go here)
  -Z wall    left part white with double doors; right part grey textured feature wall (cafe area)
  ceiling    white, exposed round ducts + linear LED fixtures (all above y 2.7)

outputs: room_shell.glb, exit_sign.glb, wall_posters.glb, fire_extinguisher_sign.glb
"""
import os, sys
import numpy as np
import trimesh
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
X0, X1, Z0, Z1, H = -7.5, 7.5, -6.5, 6.5, 3.2   # widened 2026-11-19 (side wings for wave-2 props)
SPLIT_X = -1.4                      # where the -Z wall changes from white (doors) to grey feature wall
rng = np.random.default_rng(7)
PBR = trimesh.visual.material.PBRMaterial

# ---------------- procedural textures ----------------
def oak_planks(w=1024, h=2048, planks=5, seg_len=(700, 1400)):
    """Tileable light-oak planks: columns = planks (run along the texture's V / world Z), staggered end joints.
    Only brightness varies between boards, so the hue stays a consistent warm oak."""
    oak = np.array([201, 165, 122], float)
    img = np.zeros((h, w, 3), float)
    yy, xx = np.mgrid[0:h, 0:w]
    pw = w // planks
    for i in range(planks):
        col = (xx >= i * pw) & (xx < (i + 1) * pw)
        y = int(rng.integers(0, h))
        cuts = [y]
        while True:
            y += int(rng.integers(*seg_len))
            if y >= cuts[0] + h: break
            cuts.append(y)
        cuts.append(cuts[0] + h)
        for a, b in zip(cuts[:-1], cuts[1:]):
            seg = col & (((yy - a) % h) < (b - a))
            tone = rng.uniform(0.88, 1.06)
            phase = rng.uniform(0, 100)
            grain = 0.045 * np.sin(xx * 0.9 + 5 * np.sin((yy + phase) / rng.uniform(80, 200))) + 0.025 * np.sin(yy / 13.0 + phase)
            img[seg] = oak[None] * (tone * (1 + grain[seg]))[:, None]
            img[col & (((yy - a) % h) < 3)] *= 0.72                # end joint
        img[:, i * pw:i * pw + 3] *= 0.72                          # long seam
    noise = rng.normal(0, 3, (h, w, 1))
    return Image.fromarray(np.clip(img + noise, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7))

def speckle(w=1024, h=1024, base=(158, 154, 150)):
    n = rng.normal(0, 1, (h, w))
    im = Image.fromarray(((n - n.min()) / (n.max() - n.min()) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
    a = np.asarray(im, float) / 255
    fine = rng.random((h, w)) < 0.08
    c = np.array(base, float)[None, None] * (0.82 + 0.36 * a[..., None])
    c[fine] *= 0.75
    return Image.fromarray(np.clip(c, 0, 255).astype(np.uint8))

def plain(color, size=4):
    return Image.new('RGB', (size, size), color)

# ---------------- helpers ----------------
def quad(p0, u, v, uv_scale=(1, 1), flip=False):
    p0, u, v = map(np.asarray, (p0, u, v))
    V = np.array([p0, p0 + u, p0 + u + v, p0 + v], float)
    F = np.array([[0, 1, 2], [0, 2, 3]]) if not flip else np.array([[0, 2, 1], [0, 3, 2]])
    UV = np.array([[0, 0], [uv_scale[0], 0], [uv_scale[0], uv_scale[1]], [0, uv_scale[1]]], float)
    return V, F, UV

def textured(parts, img, name, rough=0.85, metal=0.0, emissive=None):
    Vs, Fs, UVs, o = [], [], [], 0
    for V, F, UV in parts:
        Vs.append(V); Fs.append(F + o); UVs.append(UV); o += len(V)
    mat = PBR(name=name, baseColorTexture=img, roughnessFactor=rough, metallicFactor=metal,
              emissiveFactor=emissive)
    return trimesh.Trimesh(np.vstack(Vs), np.vstack(Fs), visual=trimesh.visual.TextureVisuals(uv=np.vstack(UVs), material=mat), process=False)

def solid(mesh, rgba, name, rough=0.6, metal=0.0, emissive=None):
    mesh.visual = trimesh.visual.TextureVisuals(material=PBR(name=name, baseColorFactor=rgba, roughnessFactor=rough, metallicFactor=metal, emissiveFactor=emissive))
    return mesh

def box(ext, center):
    b = trimesh.creation.box(extents=ext); b.apply_translation(center)
    b.unmerge_vertices()          # per-face vertices -> flat normals on export (no smeared corner shading)
    return b

scene = trimesh.Scene()
add = lambda m, n: scene.add_geometry(m, node_name=n, geom_name=n)

# ---------------- shell ----------------
floor_img = oak_planks()
# texture covers 5 planks x 0.19 m = 0.95 m across, 3.0 m along Z
add(textured([quad([X0, 0, Z1], [X1 - X0, 0, 0], [0, 0, Z0 - Z1], ((X1 - X0) / 0.95, (Z1 - Z0) / 3.0))], floor_img, 'oak_floor', rough=0.55), 'floor')

white = plain((236, 234, 229))
walls = [
    quad([X0, 0, Z1], [0, 0, Z0 - Z1], [0, H, 0], (1, 1)),                 # -X wall, faces +X
    quad([X1, 0, Z0], [0, 0, Z1 - Z0], [0, H, 0], (1, 1)),                 # +X wall
    quad([X1, 0, Z1], [X0 - X1, 0, 0], [0, H, 0], (1, 1)),                 # +Z wall (behind camera)
    quad([X0, 0, Z0], [SPLIT_X - X0, 0, 0], [0, H, 0], (1, 1)),            # -Z wall, white part
]
add(textured(walls, white, 'white_wall', rough=0.9), 'walls_white')
add(textured([quad([SPLIT_X, 0, Z0 + 0.02], [X1 - SPLIT_X, 0, 0], [0, H, 0], ((X1 - SPLIT_X) / 1.2, H / 1.2))], speckle(), 'feature_wall', rough=0.95), 'feature_wall')
add(textured([quad([X0, H, Z0], [X1 - X0, 0, 0], [0, 0, Z1 - Z0], (1, 1))], plain((244, 244, 242)), 'ceiling', rough=0.95), 'ceiling')

# baseboards
bb = [box([0.012, 0.09, Z1 - Z0], [X0 + 0.006, 0.045, 0]), box([0.012, 0.09, Z1 - Z0], [X1 - 0.006, 0.045, 0]),
      box([X1 - X0, 0.09, 0.012], [0, 0.045, Z1 - 0.006]), box([X1 - X0, 0.09, 0.012], [0, 0.045, Z0 + 0.03])]
add(solid(trimesh.util.concatenate(bb), [250, 250, 248, 255], 'baseboard'), 'baseboards')

# double doors in the white part of the -Z wall
dx = -2.9                            # door stays where it was before the room was widened
door = [box([0.92, 2.3, 0.04], [dx - 0.47, 1.15, Z0 + 0.02]), box([0.92, 2.3, 0.04], [dx + 0.47, 1.15, Z0 + 0.02])]
frame = [box([2.0, 0.06, 0.06], [dx, 2.33, Z0 + 0.03]), box([0.06, 2.36, 0.06], [dx - 0.97, 1.18, Z0 + 0.03]), box([0.06, 2.36, 0.06], [dx + 0.97, 1.18, Z0 + 0.03])]
add(solid(trimesh.util.concatenate(door), [238, 236, 230, 255], 'door', rough=0.5), 'doors')
add(solid(trimesh.util.concatenate(frame), [228, 226, 220, 255], 'door_frame'), 'door_frame')
handles = [box([0.02, 0.18, 0.03], [dx + s * 0.08, 1.05, Z0 + 0.06]) for s in (-1, 1)]
add(solid(trimesh.util.concatenate(handles), [190, 190, 192, 255], 'steel', rough=0.3, metal=1.0), 'door_handles')

# exposed ceiling ducts (round) + linear LED fixtures, all > 2.7 m
ducts = []
for x, r in [(-3.4, 0.15), (3.0, 0.13), (-6.0, 0.13), (6.0, 0.13)]:      # main runs pushed to the sides, out of the table view
    d = trimesh.creation.cylinder(radius=r, height=Z1 - Z0 - 0.2, sections=24)
    d.apply_translation([x, H - 0.2, 0])          # trimesh cylinders run along Z already
    ducts.append(d)
for z in (-4.0, 0.5, 4.5):
    d = trimesh.creation.cylinder(radius=0.08, height=X1 - X0 - 0.2, sections=20)
    d.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [0, 1, 0])); d.apply_translation([0, H - 0.1, z])
    ducts.append(d)
add(solid(trimesh.util.concatenate(ducts), [240, 240, 238, 255], 'duct', rough=0.7), 'ceiling_ducts')

leds_housing, leds_glow = [], []
for x in (-6.2, -3.2, 0.0, 3.2, 6.2):
    for z in (-3.2, 2.2):
        leds_housing.append(box([0.08, 0.05, 2.4], [x, 2.85, z]))
        leds_glow.append(box([0.06, 0.01, 2.36], [x, 2.82, z]))
add(solid(trimesh.util.concatenate(leds_housing), [235, 235, 235, 255], 'led_housing'), 'led_housings')
add(solid(trimesh.util.concatenate(leds_glow), [255, 255, 255, 255], 'led_glow', emissive=[1.0, 0.98, 0.94]), 'led_strips')

os.makedirs(OUT, exist_ok=True)
scene.export(include_normals=True, file_obj=os.path.join(OUT, 'room_shell.glb'))
print('room_shell.glb', scene.bounds.round(2).tolist(), 'tris', sum(len(g.faces) for g in scene.geometry.values()))

# ---------------- wall decor, each its own GLB (origin = back-center touching the wall) ----------------
def font(sz):
    for f in ('/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/System/Library/Fonts/Helvetica.ttc'):
        if os.path.exists(f): return ImageFont.truetype(f, sz)
    return ImageFont.load_default()

# exit sign: green emissive face
im = Image.new('RGB', (512, 192), (20, 30, 24)); d = ImageDraw.Draw(im)
d.text((256, 96), 'EXIT', fill=(90, 255, 140), font=font(120), anchor='mm')
d.polygon([(40, 96), (80, 66), (80, 126)], fill=(90, 255, 140))
s = trimesh.Scene()
body = box([0.36, 0.14, 0.05], [0, 0, 0.025]); s.add_geometry(solid(body, [235, 235, 235, 255], 'exit_body'), node_name='exit_body')
face = textured([quad([-0.17, -0.065, 0.051], [0.34, 0, 0], [0, 0.13, 0])], im, 'exit_face', emissive=[1, 1, 1])
s.add_geometry(face, node_name='exit_face'); s.export(include_normals=True, file_obj=os.path.join(OUT, 'exit_sign.glb'))

# three framed posters (original abstract art, not copies of the real posters)
s = trimesh.Scene()
for i, (c1, c2) in enumerate([((30, 34, 48), (214, 162, 72)), ((24, 30, 40), (120, 150, 190)), ((40, 28, 30), (230, 200, 90))]):
    art = Image.new('RGB', (360, 540), c1); d = ImageDraw.Draw(art)
    for k in range(14):
        r = rng.integers(20, 120); cx, cy = rng.integers(0, 360), rng.integers(60, 480)
        col = tuple(int(c2[j] * rng.uniform(0.5, 1.0)) for j in range(3))
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=col, width=int(rng.integers(3, 10)))
    x = (i - 1) * 0.42
    s.add_geometry(solid(box([0.36, 0.52, 0.025], [x, 0, 0.0125]), [20, 20, 22, 255], 'frame'), node_name=f'poster_frame_{i}')
    s.add_geometry(textured([quad([x - 0.165, -0.245, 0.026], [0.33, 0, 0], [0, 0.49, 0])], art, f'poster_art_{i}', rough=0.4), node_name=f'poster_art_{i}')
s.export(include_normals=True, file_obj=os.path.join(OUT, 'wall_posters.glb'))

# fire extinguisher cabinet sign
im = Image.new('RGB', (200, 640), (250, 250, 250)); d = ImageDraw.Draw(im)
d.rectangle([6, 6, 193, 633], outline=(210, 210, 210), width=6)
for k, ch in enumerate('FIRE'): d.text((70, 60 + k * 44), ch, fill=(20, 20, 20), font=font(36), anchor='mm')
for k, ch in enumerate('EXTINGUISHER'): d.text((130, 60 + k * 44), ch, fill=(20, 20, 20), font=font(36), anchor='mm')
s = trimesh.Scene()
s.add_geometry(solid(box([0.30, 0.92, 0.04], [0, 0, 0.02]), [245, 245, 245, 255], 'cabinet'), node_name='cabinet')
s.add_geometry(textured([quad([-0.14, -0.44, 0.041], [0.28, 0, 0], [0, 0.88, 0])], im, 'fire_label'), node_name='label')
s.export(include_normals=True, file_obj=os.path.join(OUT, 'fire_extinguisher_sign.glb'))
print('decor: exit_sign.glb wall_posters.glb fire_extinguisher_sign.glb')
