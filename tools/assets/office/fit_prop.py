"""Normalize a Meshy prop GLB to engine conventions: meters, Y-up, bottom-center origin on the floor.

usage: fit_prop.py <in.glb> <out.glb> --size X Y Z [--rotate-y DEG]
  --size     exact target extents in meters along world X, Y, Z (non-uniform scale; use 0 to keep proportional)
  --rotate-y rotate about Y before fitting (e.g. 90 to put a long X axis along Z)
"""
import argparse, math
import numpy as np
import trimesh

ap = argparse.ArgumentParser()
ap.add_argument('src'); ap.add_argument('dst')
ap.add_argument('--size', nargs=3, type=float, required=True)
ap.add_argument('--rotate-y', type=float, default=0.0)
a = ap.parse_args()

scene = trimesh.load(a.src, force='scene')
mesh_scene = scene.copy()
if a.rotate_y:
    mesh_scene.apply_transform(trimesh.transformations.rotation_matrix(math.radians(a.rotate_y), [0, 1, 0]))
ext = mesh_scene.extents
tgt = np.array(a.size, float)
known = tgt > 0
ratio = np.where(known, tgt / ext, 0)
uni = ratio[known].mean()
s = np.where(known, ratio, uni)
lo, hi = mesh_scene.bounds
M = np.diag([s[0], s[1], s[2], 1.0])
M[:3, 3] = -np.array([(lo[0] + hi[0]) / 2 * s[0], lo[1] * s[1], (lo[2] + hi[2]) / 2 * s[2]])
mesh_scene.apply_transform(M)
mesh_scene.export(a.dst, include_normals=True)
print('scale', s.round(4).tolist(), 'bounds', mesh_scene.bounds.round(4).tolist(),
      'tris', sum(len(g.faces) for g in mesh_scene.geometry.values()))
