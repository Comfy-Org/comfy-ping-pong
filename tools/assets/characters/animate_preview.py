"""Procedurally animate a Meshy-rigged GLB with linear blend skinning and render frames with trimesh.

usage: animate.py <rigged.glb> <out_dir> [n_frames]
"""
import io, json, math, struct, sys, os
import numpy as np
import trimesh
from PIL import Image
from scipy.spatial.transform import Rotation as R

glb_path, out_dir = sys.argv[1], sys.argv[2]
N = int(sys.argv[3]) if len(sys.argv) > 3 else 120
os.makedirs(out_dir, exist_ok=True)

# ---------- parse GLB ----------
raw = open(glb_path, 'rb').read()
jlen = struct.unpack('<I', raw[12:16])[0]
G = json.loads(raw[20:20 + jlen])
boff = 20 + jlen
blen = struct.unpack('<I', raw[boff:boff + 4])[0]
BIN = raw[boff + 8: boff + 8 + blen]
CT = {5126: np.float32, 5123: np.uint16, 5121: np.uint8, 5125: np.uint32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

def acc(i):
    a = G['accessors'][i]; bv = G['bufferViews'][a['bufferView']]
    dt = np.dtype(CT[a['componentType']]); n = NC[a['type']]
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', dt.itemsize * n)
    if stride == dt.itemsize * n:
        arr = np.frombuffer(BIN, dt, a['count'] * n, start).reshape(a['count'], n)
    else:
        arr = np.stack([np.frombuffer(BIN, dt, n, start + k * stride) for k in range(a['count'])])
    return arr.astype(np.float64) if dt == np.float32 else arr

nodes = G['nodes']
parent = {c: i for i, n in enumerate(nodes) for c in n.get('children', [])}
mesh_node = next(i for i, n in enumerate(nodes) if 'skin' in n)
skin = G['skins'][nodes[mesh_node]['skin']]
joints = skin['joints']
IBM = acc(skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)  # column-major -> row
prim = G['meshes'][nodes[mesh_node]['mesh']]['primitives'][0]
P = acc(prim['attributes']['POSITION'])
UV = acc(prim['attributes']['TEXCOORD_0'])
J = acc(prim['attributes']['JOINTS_0']).astype(int)
W = acc(prim['attributes']['WEIGHTS_0']); W /= W.sum(1, keepdims=True)
F = acc(prim['indices']).reshape(-1, 3).astype(int)
img_i = G['textures'][G['materials'][prim['material']]['pbrMetallicRoughness']['baseColorTexture']['index']]['source']
bv = G['bufferViews'][G['images'][img_i]['bufferView']]
tex = Image.open(io.BytesIO(BIN[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']])).convert('RGB')

def local_base(i):
    n = nodes[i]
    if 'matrix' in n:
        return np.array(n['matrix']).reshape(4, 4).T
    t = np.array(n.get('translation', [0, 0, 0])); q = n.get('rotation', [0, 0, 0, 1]); s = np.array(n.get('scale', [1, 1, 1]))
    return t, R.from_quat(q), s

def compose(t, r, s):
    M = np.eye(4); M[:3, :3] = r.as_matrix() * s; M[:3, 3] = t; return M

name_to_node = {nodes[j].get('name'): j for j in joints}

def world_mats(extra):
    """extra: node -> Rotation applied in the joint's local frame (after bind rotation)."""
    cache = {}
    def wm(i):
        if i in cache: return cache[i]
        b = local_base(i)
        if isinstance(b, np.ndarray):
            L = b
        else:
            t, r, s = b
            if i in extra: r = r * extra[i]
            L = compose(t, r, s)
        M = wm(parent[i]) @ L if i in parent else L
        cache[i] = M; return M
    return np.stack([wm(j) for j in joints])

# bind-pose world matrices, used to express rotations in WORLD axes regardless of bone roll
bind_world = world_mats({})

def world_rot(jname, axis, deg):
    """Rotation of a joint about a world-space axis, converted to the joint's local frame."""
    k = joints.index(name_to_node[jname])
    Rw = bind_world[k][:3, :3]; Rw = Rw / np.linalg.norm(Rw, axis=0)
    rw = R.from_rotvec(np.radians(deg) * np.asarray(axis, float))
    return R.from_matrix(Rw.T @ rw.as_matrix() @ Rw)

def skin_verts(extra):
    M = world_mats(extra) @ IBM  # (nj,4,4)
    Ph = np.c_[P, np.ones(len(P))]
    out = np.zeros_like(P)
    for k in range(4):
        out += W[:, k:k+1] * np.einsum('nij,nj->ni', M[J[:, k]], Ph)[:, :3]
    return out

# figure out which world axis is "up" and which way the character faces, from the bind pose
up = np.array([0, 1, 0.])
head = bind_world[joints.index(name_to_node['Head'])][:3, 3]
hips = bind_world[joints.index(name_to_node['Hips'])][:3, 3]
lh = bind_world[joints.index(name_to_node['LeftHand'])][:3, 3]
rh = bind_world[joints.index(name_to_node['RightHand'])][:3, 3]
side = (lh - rh); side[1] = 0; side /= np.linalg.norm(side)       # character's left
fwd = np.cross(side, up); fwd /= np.linalg.norm(fwd)              # character's forward (+z typically)
height = head[1] - P[:, 1].min()

def pose(t):
    """t in [0,1). Returns dict of joint-local rotations: arms down to ready stance + forehand swing."""
    e = {}
    s = math.sin(2 * math.pi * t * 2)            # two swings per loop
    swing = max(0.0, math.sin(2 * math.pi * t * 2))
    bob = math.sin(2 * math.pi * t * 4)
    # bring arms down from T-pose (rotate about forward axis), elbows bent forward
    e[name_to_node['LeftArm']] = world_rot('LeftArm', fwd, -62)
    e[name_to_node['LeftForeArm']] = world_rot('LeftForeArm', up, -55)
    # right (paddle) arm: ready position + forehand swing across the body
    e[name_to_node['RightArm']] = world_rot('RightArm', fwd, 55 - 10 * swing) * world_rot('RightArm', up, -35 + 70 * s)
    e[name_to_node['RightForeArm']] = world_rot('RightForeArm', up, 60 - 25 * swing)
    # torso twist with the swing, slight forward lean
    e[name_to_node['Spine01']] = world_rot('Spine01', up, 14 * s) * world_rot('Spine01', side, 18)
    e[name_to_node['Head']] = world_rot('Head', up, -10 * s)
    # athletic knee bend
    for sd in ('Left', 'Right'):
        e[name_to_node[sd + 'UpLeg']] = world_rot(sd + 'UpLeg', side, -22 - 4 * bob)
        e[name_to_node[sd + 'Leg']] = world_rot(sd + 'Leg', side, 38 + 6 * bob)
        e[name_to_node[sd + 'Foot']] = world_rot(sd + 'Foot', side, -14)
    return e


import moderngl
CTX = moderngl.create_standalone_context(require=410)
PROG = CTX.program(vertex_shader="""
#version 410
uniform mat4 mvp; uniform mat4 model;
in vec3 in_pos; in vec3 in_nrm; in vec2 in_uv;
out vec3 v_n; out vec2 v_uv;
void main(){ gl_Position = mvp*vec4(in_pos,1.0); v_n = mat3(model)*in_nrm; v_uv = in_uv; }""",
fragment_shader="""
#version 410
uniform sampler2D tex; in vec3 v_n; in vec2 v_uv; out vec4 f;
void main(){ vec3 n=normalize(v_n); vec3 L=normalize(vec3(0.4,0.8,0.9));
 float d=max(dot(n,L),0.0); float rim=pow(1.0-max(n.z,0.0),3.0)*0.15;
 vec3 c=texture(tex,v_uv).rgb; f=vec4(c*(0.55+0.55*d)+rim,1.0);}""")
TEX = CTX.texture(tex.size, 3, tex.transpose(Image.FLIP_TOP_BOTTOM).tobytes()); TEX.build_mipmaps()
TEX.filter = (moderngl.LINEAR_MIPMAP_LINEAR, moderngl.LINEAR)
RES = (720, 900)
FBO = CTX.framebuffer(CTX.renderbuffer(RES, samples=4), CTX.depth_renderbuffer(RES, samples=4))
OUT = CTX.framebuffer(CTX.renderbuffer(RES))
UVf = UV.copy(); UVf[:,1] = 1.0 - UVf[:,1]
IBO = CTX.buffer(F.astype('i4').tobytes())

def persp(fovy, asp, n, f):
    t = 1/math.tan(math.radians(fovy)/2)
    return np.array([[t/asp,0,0,0],[0,t,0,0],[0,0,(f+n)/(n-f),2*f*n/(n-f)],[0,0,-1,0]])

def look(eye, tgt, upv):
    z = eye-tgt; z/=np.linalg.norm(z); x=np.cross(upv,z); x/=np.linalg.norm(x); y=np.cross(z,x)
    M=np.eye(4); M[0,:3]=x; M[1,:3]=y; M[2,:3]=z; M[:3,3]=-M[:3,:3]@eye; return M

def render(verts, yaw_deg, path):
    m = trimesh.Trimesh(verts, F, process=False)          # trimesh: recentre + rotate + vertex normals
    m.apply_translation([-hips[0], -P[:, 1].min(), -hips[2]])
    # face the camera (+z) then spin
    face = math.atan2(fwd[0], fwd[2])
    m.apply_transform(trimesh.transformations.rotation_matrix(math.radians(yaw_deg) - face, up))
    V = np.asarray(m.vertices, 'f4'); N = np.asarray(m.vertex_normals, 'f4')
    vbo = CTX.buffer(np.hstack([V, N, UVf.astype('f4')]).tobytes())
    vao = CTX.vertex_array(PROG, [(vbo, '3f 3f 2f', 'in_pos', 'in_nrm', 'in_uv')], IBO)
    eye = np.array([0, height*0.62, height*2.25]); tgt = np.array([0, height*0.5, 0])
    mvp = persp(38, RES[0]/RES[1], 0.05, 50) @ look(eye, tgt, up)
    PROG['mvp'].write(mvp.T.astype('f4').tobytes()); PROG['model'].write(np.eye(4,dtype='f4').tobytes())
    TEX.use(0); PROG['tex'] = 0
    FBO.use(); CTX.enable(moderngl.DEPTH_TEST); CTX.clear(0.93, 0.94, 0.96, 1.0)
    vao.render(); CTX.copy_framebuffer(OUT, FBO)
    Image.frombytes('RGB', RES, OUT.read(components=3)).transpose(Image.FLIP_TOP_BOTTOM).save(path)
    vao.release(); vbo.release()

if __name__ == '__main__':
    print('verts', len(P), 'faces', len(F), 'height', round(height, 3), 'fwd', fwd.round(2), 'left', side.round(2))
    for f in range(N):
        t = f / N
        render(skin_verts(pose(t)), yaw_deg=360 * t, path=f'{out_dir}/f{f:04d}.png')
        if f % 20 == 0: print('frame', f, flush=True)
