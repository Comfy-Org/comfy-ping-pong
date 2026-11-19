"""Headless preview render of one or more static GLBs placed together (moderngl).

usage: render_props.py <out.png> <a.glb> [b.glb ...] [--eye x y z] [--target x y z] [--fov deg]
"""
import argparse, math
import numpy as np
import trimesh, moderngl
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('out'); ap.add_argument('glbs', nargs='+')
ap.add_argument('--eye', nargs=3, type=float, default=[2.6, 2.0, 3.6])
ap.add_argument('--target', nargs=3, type=float, default=[0, 0.5, 0])
ap.add_argument('--fov', type=float, default=40)
ap.add_argument('--res', nargs=2, type=int, default=[1280, 800])
a = ap.parse_args()
RES = tuple(a.res)

ctx = moderngl.create_standalone_context(require=410)
prog = ctx.program(vertex_shader="""
#version 410
uniform mat4 vp; in vec3 p; in vec3 n; in vec2 t; out vec3 vn; out vec2 vt; out vec3 vp_;
void main(){ gl_Position = vp*vec4(p,1); vn=n; vt=t; vp_=p; }""", fragment_shader="""
#version 410
uniform sampler2D tex; uniform vec4 base; uniform int has_tex; uniform float cutoff;
in vec3 vn; in vec2 vt; in vec3 vp_; out vec4 f;
void main(){ vec4 c = base; if (has_tex==1) c *= texture(tex, vt);
 if (c.a < cutoff) discard;
 vec3 N = normalize(vn); if (!gl_FrontFacing) N = -N;
 float d = max(dot(N, normalize(vec3(0.35,0.9,0.5))),0.0) + 0.35*max(dot(N, normalize(vec3(-0.6,0.4,-0.7))),0.0);
 f = vec4(c.rgb*(0.38+0.75*d), 1); }""")

def persp(fovy, asp, n, fa):
    t = 1 / math.tan(math.radians(fovy) / 2)
    return np.array([[t/asp,0,0,0],[0,t,0,0],[0,0,(fa+n)/(n-fa),2*fa*n/(n-fa)],[0,0,-1,0]])
def look(eye, tgt):
    eye, tgt = np.array(eye), np.array(tgt); z = eye - tgt; z /= np.linalg.norm(z)
    x = np.cross([0, 1, 0], z); x /= np.linalg.norm(x); y = np.cross(z, x)
    M = np.eye(4); M[0,:3]=x; M[1,:3]=y; M[2,:3]=z; M[:3,3] = -M[:3,:3] @ eye; return M

vp = persp(a.fov, RES[0]/RES[1], 0.05, 100) @ look(a.eye, a.target)
prog['vp'].write(vp.T.astype('f4').tobytes())
fbo = ctx.framebuffer(ctx.renderbuffer(RES, samples=4), ctx.depth_renderbuffer(RES, samples=4))
outb = ctx.framebuffer(ctx.renderbuffer(RES))
fbo.use(); ctx.enable(moderngl.DEPTH_TEST); ctx.clear(0.90, 0.91, 0.93, 1)

# floor grid for scale (1 m squares)
for gx in range(-4, 5):
    for gz in range(-4, 5):
        pass

for path in a.glbs:
    sc = trimesh.load(path, force='scene')
    for name, (geom, T) in [(n, (sc.geometry[g], sc.graph[n][0])) for n in sc.graph.nodes_geometry for g in [sc.graph[n][1]]]:
        m = geom.copy(); m.apply_transform(T)
        V = np.asarray(m.vertices, 'f4'); N = np.asarray(m.vertex_normals, 'f4')
        vis = m.visual; uv = np.zeros((len(V), 2), 'f4'); has = 0; base = [1, 1, 1, 1]; cutoff = 0.0
        mat = getattr(vis, 'material', None)
        if mat is not None:
            img = getattr(mat, 'baseColorTexture', None) or getattr(mat, 'image', None)
            bcf = getattr(mat, 'baseColorFactor', None)
            if bcf is not None: base = (np.array(bcf, float) / (255.0 if np.max(bcf) > 1 else 1.0)).tolist()
            if getattr(mat, 'alphaMode', None) == 'MASK': cutoff = getattr(mat, 'alphaCutoff', 0.5) or 0.5
            if img is not None and getattr(vis, 'uv', None) is not None:
                im = img.convert('RGBA'); has = 1
                uv = np.asarray(vis.uv, "f4").copy()
                tex = ctx.texture(im.size, 4, im.transpose(Image.FLIP_TOP_BOTTOM).tobytes()); tex.build_mipmaps()
                tex.filter = (moderngl.LINEAR_MIPMAP_LINEAR, moderngl.LINEAR); tex.use(0); prog['tex'] = 0
        elif hasattr(vis, 'face_colors'):
            base = (np.asarray(vis.main_color, float) / 255).tolist()
        prog['has_tex'] = has; prog['base'].value = tuple(base); prog['cutoff'] = cutoff
        vbo = ctx.buffer(np.hstack([V, N, uv]).tobytes()); ibo = ctx.buffer(np.asarray(m.faces, 'i4').tobytes())
        ctx.vertex_array(prog, [(vbo, '3f 3f 2f', 'p', 'n', 't')], ibo).render()

ctx.copy_framebuffer(outb, fbo)
Image.frombytes('RGB', RES, outb.read(components=3)).transpose(Image.FLIP_TOP_BOTTOM).save(a.out)
print('rendered', a.out)
