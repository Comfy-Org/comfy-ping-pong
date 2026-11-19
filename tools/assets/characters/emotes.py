"""Keyframe celebration emotes onto a Meshy-rigged GLB and bake them in as glTF animation clips.

usage:
  emotes.py bake   <rigged.glb> <out.glb>             # writes all clips into a new GLB
  emotes.py render <rigged.glb> <out_dir> [clip ...]   # renders preview PNG frames per clip

Clips (30 fps):
  point_fist_pump   1.6 s  one-shot   - won a point
  point_flex        1.6 s  one-shot   - won a point
  win_victory_jump  2.4 s  loop       - won the game
  win_floss         2.4 s  loop       - won the game (Matt's signature)
"""
import json, math, os, runpy, struct, sys
import numpy as np
from scipy.spatial.transform import Rotation as R

HERE = os.path.dirname(os.path.abspath(__file__))
FPS = 30
mode, glb_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
only = sys.argv[4:]

# reuse the GLB parser / skinning / renderer from animate_preview.py
sys.argv = ['animate_preview.py', glb_path, os.path.join(HERE, '.tmp_frames'), '0']
g = runpy.run_path(os.path.join(HERE, 'animate_preview.py'), run_name='lib')
nodes, joints, parent, name_to_node = g['nodes'], g['joints'], g['parent'], g['name_to_node']
bind_world, IBM, P, J, W = g['bind_world'], g['IBM'], g['P'], g['J'], g['W']
UP, FWD, LEFT = g['up'], g['fwd'], g['side']

def jpos(n): return bind_world[joints.index(name_to_node[n])][:3, 3]
THIGH = np.linalg.norm(jpos('LeftUpLeg') - jpos('LeftLeg'))
SHIN = np.linalg.norm(jpos('LeftLeg') - jpos('LeftFoot'))
HEIGHT = g['height']

# ---------------- pose parameters ----------------
REST = dict(la_down=72, la_flex=6, le_bend=12, le_up=0, ra_down=72, ra_flex=6, re_bend=12, re_up=0,
            spine_twist=0, spine_lean=4, spine_side=0, hips_roll=0, hips_twist=0,
            head_nod=0, head_turn=0, head_tilt=0, knee=8, hop=0.0)

def lerp(a, b, k): return {key: a[key] + (b.get(key, a[key]) - a[key]) * k for key in a}
def ss(x): x = min(max(x, 0.0), 1.0); return x * x * (3 - 2 * x)
def env(t, dur, ein=0.18, eout=0.22): return ss(t / ein) * ss((dur - t) / eout)
def wave(t, period, phase=0.0): return math.sin(2 * math.pi * (t / period + phase))

def fist_pump(t, dur=1.6):
    # arm shoots up, then three hard pull-downs with a crouch on each "YES"
    k = ss(t / 0.25)
    pump = max(0.0, wave(t - 0.25, 0.4)) if t > 0.25 else 0.0
    p = dict(REST, ra_down=-75 + 105 * pump, ra_flex=10 + 25 * pump, re_bend=8 + 95 * pump,
             la_down=70, la_flex=18, le_bend=35, spine_lean=6 + 14 * pump, spine_twist=-10 * pump,
             head_nod=-8 + 14 * pump, knee=10 + 22 * pump)
    return lerp(REST, p, k * ss((dur - t) / 0.25))

def flex(t, dur=1.6):
    # double-bicep pose with a pulsing squeeze, leaning back
    pulse = 0.5 + 0.5 * wave(t, 0.4)
    p = dict(REST, la_down=-8 - 6 * pulse, ra_down=-8 - 6 * pulse, la_flex=8, ra_flex=8,
             le_bend=10, re_bend=10, le_up=95 + 10 * pulse, re_up=95 + 10 * pulse,
             spine_lean=-8, head_nod=-10, head_tilt=6 * wave(t, 0.8), knee=14 + 6 * pulse)
    return lerp(REST, p, env(t, dur))

def victory_jump(t, dur=2.4):
    # two jumps with arms thrown up in a V, loopable (starts/ends crouched-to-rest)
    ph = (t / 1.2) % 1.0                    # 1.2 s per jump
    if ph < 0.25:   crouch, air = ss(ph / 0.25), 0.0
    elif ph < 0.6:  crouch, air = 0.0, math.sin(math.pi * (ph - 0.25) / 0.35)
    elif ph < 0.8:  crouch, air = math.sin(math.pi * (ph - 0.6) / 0.2) * 0.8, 0.0
    else:           crouch, air = 0.0, 0.0
    arms = ss((ph - 0.15) / 0.2) * (1 - ss((ph - 0.8) / 0.2))
    return dict(REST, la_down=72 - 125 * arms, ra_down=72 - 125 * arms, la_flex=6 + 14 * arms, ra_flex=6 + 14 * arms,
                le_bend=12 - 6 * arms, re_bend=12 - 6 * arms, knee=8 + 45 * crouch + 10 * air,
                spine_lean=4 + 16 * crouch - 12 * air, head_nod=10 * crouch - 18 * air, hop=0.2 * air * HEIGHT / 1.7)

def floss(t, dur=2.4):
    # the Floss: straight arms swing side to side together, swapping front/back as they pass the body,
    # hips swinging the opposite way. 0.6 s per full left-right cycle, loopable.
    x = wave(t, 0.6)                       # +1 = arms out to the character's left
    c = wave(t, 0.6, 0.25)                 # front/back swap
    return dict(REST, la_down=74 - 34 * x, ra_down=74 + 34 * x,
                ra_flex=26 * c, la_flex=-26 * c, le_bend=6, re_bend=6,
                hips_roll=-9 * x, spine_side=4 * x, hips_twist=6 * c, spine_lean=6,
                head_tilt=-5 * x, head_nod=4, knee=14 + 4 * abs(x))

CLIPS = {'point_fist_pump': (fist_pump, 1.6), 'point_flex': (flex, 1.6),
         'win_victory_jump': (victory_jump, 2.4), 'win_floss': (floss, 2.4)}

# ---------------- params -> joint rotations ----------------
def wrot(jname, steps):
    k = joints.index(name_to_node[jname]); Rw = bind_world[k][:3, :3]; Rw = Rw / np.linalg.norm(Rw, axis=0)
    rw = R.identity()
    for axis, deg in steps: rw = R.from_rotvec(np.radians(deg) * np.asarray(axis, float)) * rw
    return R.from_matrix(Rw.T @ rw.as_matrix() @ Rw)

def extras(p):
    a = 0.6 * p['knee']
    e = {
        'Hips': [(FWD, p['hips_roll']), (UP, p['hips_twist'])],
        'Spine02': [(FWD, -0.7 * p['hips_roll']), (UP, -0.5 * p['hips_twist'])],
        'Spine01': [(UP, p['spine_twist']), (LEFT, p['spine_lean']), (FWD, p['spine_side'])],
        'Head': [(LEFT, p['head_nod']), (UP, p['head_turn']), (FWD, p['head_tilt'])],
        'LeftArm': [(FWD, -p['la_down']), (LEFT, -p['la_flex'])],
        'RightArm': [(FWD, p['ra_down']), (LEFT, -p['ra_flex'])],
        'LeftForeArm': [(UP, -p['le_bend']), (FWD, p['le_up'])],
        'RightForeArm': [(UP, p['re_bend']), (FWD, -p['re_up'])],
    }
    for sd in ('Left', 'Right'):
        e[sd + 'UpLeg'] = [(FWD, -p['hips_roll']), (LEFT, -a)]
        e[sd + 'Leg'] = [(LEFT, 2 * a)]
        e[sd + 'Foot'] = [(LEFT, -a)]
    return {name_to_node[n]: wrot(n, s) for n, s in e.items()}

def hips_offset(p):
    drop = (THIGH + SHIN) * (1 - math.cos(math.radians(0.6 * p['knee'])))
    return UP * (p['hop'] - drop)

def trs(i):
    n = nodes[i]
    return np.array(n.get('translation', [0, 0, 0]), float), R.from_quat(n.get('rotation', [0, 0, 0, 1])), np.array(n.get('scale', [1, 1, 1]), float)

HIPS = name_to_node['Hips']
def parent_world(i):
    M = np.eye(4); chain = []
    while i in parent: i = parent[i]; chain.append(i)
    for c in reversed(chain):
        t, r, s = trs(c); L = np.eye(4); L[:3, :3] = r.as_matrix() * s; L[:3, 3] = t; M = M @ L
    return M
HIPS_PW_INV = np.linalg.inv(parent_world(HIPS)[:3, :3])

def local_trs(p):
    ex = extras(p); out = {}
    for j in joints:
        t, r, s = trs(j)
        if j in ex: r = r * ex[j]
        if j == HIPS: t = t + HIPS_PW_INV @ hips_offset(p)
        out[j] = (t, r)
    return out

def skin(p):
    lt = local_trs(p); cache = {}
    def wm(i):
        if i in cache: return cache[i]
        if i in lt: t, r = lt[i]; s = trs(i)[2]
        else: t, r, s = trs(i)
        L = np.eye(4); L[:3, :3] = r.as_matrix() * s; L[:3, 3] = t
        cache[i] = (wm(parent[i]) @ L) if i in parent else L
        return cache[i]
    M = np.stack([wm(j) for j in joints]) @ IBM
    Ph = np.c_[P, np.ones(len(P))]; o = np.zeros_like(P)
    for k in range(4): o += W[:, k:k+1] * np.einsum('nij,nj->ni', M[J[:, k]], Ph)[:, :3]
    return o

# ---------------- bake into GLB ----------------
def bake(dst):
    raw = open(glb_path, 'rb').read()
    jl = struct.unpack('<I', raw[12:16])[0]; G = json.loads(raw[20:20 + jl])
    bo = 20 + jl; bl = struct.unpack('<I', raw[bo:bo + 4])[0]; BIN = bytearray(raw[bo + 8:bo + 8 + bl])
    G['animations'] = [a for a in G.get('animations', []) if a.get('name') not in CLIPS]

    def add(arr, typ, minmax=False):
        while len(BIN) % 4: BIN.append(0)
        data = np.ascontiguousarray(arr, dtype='<f4')
        G['bufferViews'].append({'buffer': 0, 'byteOffset': len(BIN), 'byteLength': data.nbytes}); BIN.extend(data.tobytes())
        a = {'bufferView': len(G['bufferViews']) - 1, 'componentType': 5126, 'count': len(data), 'type': typ}
        if minmax: a['min'] = [float(data.min())]; a['max'] = [float(data.max())]
        G['accessors'].append(a); return len(G['accessors']) - 1

    for name, (fn, dur) in CLIPS.items():
        n = int(round(dur * FPS)) + 1
        times = np.linspace(0, dur, n)
        frames = [local_trs(fn(min(t, dur - 1e-6) if name.startswith('win') else t)) for t in times]
        if name.startswith('win'): frames[-1] = frames[0]          # exact loop
        ti = add(times.reshape(-1, 1), 'SCALAR', True)
        samplers, channels = [], []
        for j in joints:
            q = np.array([f[j][1].as_quat() for f in frames])
            for k in range(1, len(q)):                               # keep quaternions on one hemisphere
                if np.dot(q[k], q[k - 1]) < 0: q[k] = -q[k]
            samplers.append({'input': ti, 'output': add(q, 'VEC4'), 'interpolation': 'LINEAR'})
            channels.append({'sampler': len(samplers) - 1, 'target': {'node': j, 'path': 'rotation'}})
        tr = np.array([f[HIPS][0] for f in frames])
        samplers.append({'input': ti, 'output': add(tr, 'VEC3'), 'interpolation': 'LINEAR'})
        channels.append({'sampler': len(samplers) - 1, 'target': {'node': HIPS, 'path': 'translation'}})
        G['animations'].append({'name': name, 'samplers': samplers, 'channels': channels})

    while len(BIN) % 4: BIN.append(0)
    G['buffers'][0]['byteLength'] = len(BIN)
    js = json.dumps(G, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    body = struct.pack('<I', len(js)) + b'JSON' + js + struct.pack('<I', len(BIN)) + b'BIN\0' + bytes(BIN)
    open(dst, 'wb').write(b'glTF' + struct.pack('<II', 2, 12 + len(body)) + body)
    print('wrote', dst, [a['name'] for a in G['animations']])

if mode == 'bake':
    bake(out)
elif mode == 'render':
    for name in (only or CLIPS):
        fn, dur = CLIPS[name]; d = os.path.join(out, name); os.makedirs(d, exist_ok=True)
        for f in range(int(dur * FPS)):
            g['render'](skin(fn(f / FPS)), yaw_deg=18, path=os.path.join(d, f'f{f:04d}.png'))
        print('rendered', name, flush=True)
