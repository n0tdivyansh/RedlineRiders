'''
Redline Riders - motorbike generator for Blender (4.2+ / 5.x)
=============================================================
Builds the six bike styles (sport, gp, hyper, naked, moto, cruiser) as three meshes each:
the body, and the front and rear wheels (which spin, so they are separate and centred on
their axle). export_bikes.py bakes ambient occlusion and packs them into js/bike-models.js.

Coordinates are the GAME's, so numbers can be read straight across from js/bikes.js:
metres, X right, Y up (ground at Y = 0), the bike faces -Z (front wheel at z = wf < 0).
Blender does not mind which way is up; only the preview camera has to know.

Key points shared with the game's rider poses (js/bikes.js POSES/STYLES) are kept: wheel
positions and sizes, seat height, handlebar grips and footpegs, so the JS rider sits on
these bikes exactly as on the old ones.
'''
import bpy, bmesh, math
from mathutils import Vector

# ------------------------------------------------------------------ materials
# name -> (game material, sRGB colour).  Game materials (js/gl.js SR.MAT):
# 0 LIT, 1 PAINT (colour x rider paint), 2 EMIT, 4 BRAKE (tail light), 6 HEAD (headlight), 7 PAINT2 (accent)
PAL = {
    'paint': (1, '#ffffff'), 'paint2': (7, '#ffffff'),
    'black': (0, '#0c0c10'), 'dark': (0, '#1d1e24'), 'plastic': (0, '#28292f'), 'engine': (0, '#34363c'),
    'fins': (0, '#5a5e66'), 'metal': (0, '#9ea3ad'), 'alu': (0, '#c3c7cf'), 'chrome': (0, '#e6eaf2'),
    'gold': (0, '#d9a52e'), 'glass': (0, '#34466a'), 'rubber': (0, '#18181b'), 'tread': (0, '#0f0f11'),
    'sidewall': (0, '#232327'), 'amber': (2, '#ff9a1c'), 'tail': (4, '#ff2020'), 'head': (6, '#fff3c8'),
    'white': (0, '#f0f0ea'), 'seat': (0, '#17171c'), 'trellis': (0, '#c8321e'), 'spring': (0, '#e8c21a'),
    'carbon': (0, '#1b1c21'), 'disc': (0, '#8e929a'), 'holes': (0, '#3a3c42'), 'titanium': (0, '#8f8a86'),
    'heat': (0, '#9a6a44'), 'chain': (0, '#4a4c52'), 'rim_gold': (0, '#d9a52e'), 'rim_white': (0, '#f0f0ea'),
    'rim_black': (0, '#2b2c31'), 'rim_alu': (0, '#c3c7cf'), 'leather': (0, '#3b2419'),
}


def hex_lin(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1.0]


def get_mat(name):
    m = bpy.data.materials.get('rr_' + name)
    if m is None:
        m = bpy.data.materials.new('rr_' + name)
        m.diffuse_color = hex_lin(PAL[name][1])
    return m


# ------------------------------------------------------------------ maths
def clamp(v, a, b):
    return a if v < a else b if v > b else v


def lerp(a, b, t):
    return a + (b - a) * t


class Curve:
    '''Monotone cubic (PCHIP) through (x, y) points; clamps outside the range. A number is a constant.'''

    def __init__(self, pts):
        if isinstance(pts, (int, float)):
            self.pts = None
            self.c = float(pts)
            return
        self.pts = sorted(pts)
        xs, ys = [p[0] for p in self.pts], [p[1] for p in self.pts]
        n = len(xs)
        h = [xs[i + 1] - xs[i] for i in range(n - 1)]
        d = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
        m = [0.0] * n
        if n > 1:
            m[0], m[-1] = d[0], d[-1]
        for i in range(1, n - 1):
            if d[i - 1] * d[i] <= 0:
                m[i] = 0.0
            else:
                w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
                m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
        self.xs, self.ys, self.m = xs, ys, m

    def __call__(self, x):
        if self.pts is None:
            return self.c
        xs, ys, m = self.xs, self.ys, self.m
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        i = 0
        while xs[i + 1] < x:
            i += 1
        h = xs[i + 1] - xs[i]
        t = (x - xs[i]) / h
        t2, t3 = t * t, t * t * t
        return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1]


def C(v):
    return v if isinstance(v, Curve) else Curve(v)


def se(t, n):
    '''Superellipse point on the unit "circle": n = 2 ellipse, n > 2 boxier, n < 2 creased/diamond.'''
    c, s = math.cos(t), math.sin(t)
    return math.copysign(abs(c) ** (2 / n), c), math.copysign(abs(s) ** (2 / n), s)


# ------------------------------------------------------------------ mesh builder
class MB:
    '''Collects vertices and faces (each with a material name), then makes a Blender object.'''

    def __init__(self):
        self.v, self.f, self.m = [], [], []

    def vert(self, p):
        self.v.append(Vector(p))
        return len(self.v) - 1

    def face(self, idx, mat):
        self.f.append(tuple(idx))
        self.m.append(mat)

    def grid(self, P, mat_of, closed=True, flip=False):
        '''P = rows of points (row = one cross-section). Quads between consecutive rows;
        closed joins the last point of a row to the first.'''
        ids = [[self.vert(p) for p in row] for row in P]
        nr = len(P[0])
        for j in range(len(P) - 1):
            for i in range(nr if closed else nr - 1):
                i2 = (i + 1) % nr
                q = [ids[j][i], ids[j][i2], ids[j + 1][i2], ids[j + 1][i]]
                if flip:
                    q.reverse()
                c = (P[j][i] + P[j][i2] + P[j + 1][i] + P[j + 1][i2]) / 4
                self.face(q, mat_of(c) if callable(mat_of) else mat_of)
        return ids

    def cap(self, ids, mat, flip=False):
        self.face(list(reversed(ids)) if flip else ids, mat)

    def build(self, name, coll):
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        vs = [bm.verts.new(p) for p in self.v]
        mats = []
        for idx, mat in zip(self.f, self.m):
            if len(set(idx)) < 3:
                continue
            try:
                fc = bm.faces.new([vs[i] for i in idx])
            except ValueError:  # duplicate face
                continue
            if mat not in mats:
                mats.append(mat)
            fc.material_index = mats.index(mat)
            fc.smooth = True
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        # hard edges where the surface folds (keeps panel lines and parts crisp)
        for e in bm.edges:
            if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(38):
                e.smooth = False
        bm.to_mesh(me)
        bm.free()
        for m in mats:
            me.materials.append(get_mat(m))
        ob = bpy.data.objects.new(name, me)
        coll.objects.link(ob)
        return ob


# ------------------------------------------------------------------ primitives
def loft(mb, z0, z1, S, R, top, bot, hw, n=2.6, mat='paint', x0=0.0, warp=None, caps=(True, True), cap_mat=None, arc=None):
    '''Lofted panel along z (the bike's length): each section is a superellipse between bot(z)
    and top(z), half-width hw(z). mat(x, y, z) or a name. arc=(a0, a1) keeps part of the ring (open shell).'''
    top, bot, hw, n = C(top), C(bot), C(hw), C(n)
    P = []
    for j in range(S + 1):
        z = lerp(z0, z1, j / S)
        yc, hh, w, nn = (top(z) + bot(z)) / 2, (top(z) - bot(z)) / 2, hw(z), n(z)
        row = []
        for i in range(R + (1 if arc else 0)):
            t = lerp(arc[0], arc[1], i / R) if arc else (i / R) * math.tau
            ex, ey = se(t, nn)
            p = Vector((x0 + ex * w, yc + ey * hh, z))
            if warp:
                p = warp(p, j / S)
            row.append(p)
        P.append(row)
    ids = mb.grid(P, (lambda c: mat(c.x, c.y, c.z)) if callable(mat) else mat, closed=not arc)
    cm = cap_mat or (mat if isinstance(mat, str) else 'dark')
    if not arc:
        if caps[0]:
            mb.cap(ids[0], cm, flip=True)
        if caps[1]:
            mb.cap(ids[-1], cm)
    return ids


def revolve(mb, prof, N, mat, c=(0, 0, 0), axis='x', close=False):
    '''Surface of revolution: prof = [(along-axis offset, radius), ...]; mat(k, i) or a name.'''
    c = Vector(c)
    P = []
    for a, r in prof:
        row = []
        for i in range(N):
            t = (i / N) * math.tau
            u, w = math.cos(t) * r, math.sin(t) * r
            if axis == 'x':
                row.append(c + Vector((a, u, w)))
            elif axis == 'y':
                row.append(c + Vector((u, a, w)))
            else:
                row.append(c + Vector((u, w, a)))
        P.append(row)
    ids = [[mb.vert(p) for p in row] for row in P]
    for k in range(len(P) - 1):
        for i in range(N):
            i2 = (i + 1) % N
            mb.face([ids[k][i], ids[k][i2], ids[k + 1][i2], ids[k + 1][i]], mat(k, i) if callable(mat) else mat)
    if close:
        mb.cap(ids[0], mat(0, 0) if callable(mat) else mat, flip=True)
        mb.cap(ids[-1], mat(len(P) - 1, 0) if callable(mat) else mat)
    return ids


def tube(mb, path, r, mat, sides=10, caps=True, cap_mat=None, squash=(1.0, 1.0)):
    '''Circle swept along a polyline (parallel-transport frames). r: radius or list per point.'''
    path = [Vector(p) for p in path]
    rs = r if isinstance(r, (list, tuple)) else [r] * len(path)
    rs = [rs[min(i, len(rs) - 1)] for i in range(len(path))]
    T = []
    for i in range(len(path)):
        a = path[max(0, i - 1)]
        b = path[min(len(path) - 1, i + 1)]
        T.append((b - a).normalized())
    up = Vector((0, 1, 0)) if abs(T[0].y) < 0.9 else Vector((1, 0, 0))
    nrm = T[0].cross(up).normalized()
    P = []
    for i, p in enumerate(path):
        if i:
            nrm = (nrm - T[i] * nrm.dot(T[i])).normalized()
        bi = T[i].cross(nrm)
        row = []
        for k in range(sides):
            t = (k / sides) * math.tau
            row.append(p + nrm * (math.cos(t) * rs[i] * squash[0]) + bi * (math.sin(t) * rs[i] * squash[1]))
        P.append(row)
    ids = mb.grid(P, mat)
    if caps:
        mb.cap(ids[0], cap_mat or mat, flip=True)
        mb.cap(ids[-1], cap_mat or mat)
    return ids


def spline(pts, n=8):
    '''Catmull-Rom through pts, n segments per span (for smooth pipes and frames).'''
    pts = [Vector(p) for p in pts]
    out = []
    for i in range(len(pts) - 1):
        p0, p1, p2, p3 = pts[max(0, i - 1)], pts[i], pts[i + 1], pts[min(len(pts) - 1, i + 2)]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(pts[-1])
    return out


def rbox(mb, c, size, mat, n=5, S=2, R=16):
    '''Rounded box centred at c, size (w, h, d), squareness n (along z it is straight).'''
    x, y, z = c
    w, h, d = size
    loft(mb, z - d / 2, z + d / 2, S, R, y + h / 2, y - h / 2, w / 2, n=n, mat=mat, x0=x)


def disc(mb, c, r0, r1, th, N, mat, axis='x'):
    '''Flat ring (brake disc, sprocket) about the axis.'''
    revolve(mb, [(-th / 2, r0), (-th / 2, r1), (th / 2, r1), (th / 2, r0), (-th / 2, r0)], N, mat, c=c, axis=axis)


def sym(f):
    for s in (-1, 1):
        f(s)


# ------------------------------------------------------------------ styles (numbers as in js/bikes.js STYLES + POSES)
STYLES = {
    'sport': dict(wf=-0.7, wr=0.7, rf=0.305, rr=0.315, tf=0.06, tr=0.09, headZ=-0.41, headY=0.95, seatY=0.87, rim='rim_gold', hand=(0.28, 0.875, -0.335), foot=(0.2, 0.44, 0.22)),
    'gp': dict(wf=-0.69, wr=0.68, rf=0.3, rr=0.31, tf=0.06, tr=0.095, headZ=-0.41, headY=0.93, seatY=0.86, rim='rim_white', hand=(0.28, 0.855, -0.335), foot=(0.2, 0.44, 0.22), gp=True),
    'hyper': dict(wf=-0.74, wr=0.74, rf=0.31, rr=0.32, tf=0.065, tr=0.1, headZ=-0.44, headY=0.96, seatY=0.88, rim='rim_black', hand=(0.28, 0.875, -0.335), foot=(0.2, 0.44, 0.22), hyper=True),
    'naked': dict(wf=-0.7, wr=0.68, rf=0.305, rr=0.315, tf=0.06, tr=0.09, headZ=-0.42, headY=0.97, seatY=0.86, rim='rim_white', hand=(0.37, 1.055, -0.32), foot=(0.2, 0.44, 0.2)),
    'moto': dict(wf=-0.74, wr=0.7, rf=0.33, rr=0.33, tf=0.05, tr=0.07, headZ=-0.45, headY=1.06, seatY=0.99, rim='rim_black', hand=(0.37, 1.165, -0.37), foot=(0.2, 0.46, 0.16), wire=True),
    'cruiser': dict(wf=-0.9, wr=0.76, rf=0.33, rr=0.33, tf=0.07, tr=0.105, headZ=-0.48, headY=1.02, seatY=0.75, rim='chrome', hand=(0.42, 1.15, -0.2), foot=(0.25, 0.36, -0.44), wire=True),
}
RAKE = math.radians(24)


def fork_axis(st):
    '''Front axle and the unit vector up the fork (raked back).'''
    return Vector((0, st['rf'], st['wf'])), Vector((0, math.cos(RAKE), math.sin(RAKE)))


# ------------------------------------------------------------------ wheels (built at the axle, spin about X)
def wheel(st, front):
    mb = MB()
    r = st['rf'] if front else st['rr']
    hw = st['tf'] if front else st['tr']
    N = 40
    # tyre: rounded race profile; tread blocks on the crown, darker sidewall band
    prof = [(-hw * 0.6, r * 0.7), (-hw * 0.93, r * 0.76), (-hw, r * 0.84), (-hw * 0.9, r * 0.92), (-hw * 0.62, r * 0.975), (-hw * 0.25, r),
            (hw * 0.25, r), (hw * 0.62, r * 0.975), (hw * 0.9, r * 0.92), (hw, r * 0.84), (hw * 0.93, r * 0.76), (hw * 0.6, r * 0.7)]

    def tyre(k, i):
        if 4 <= k <= 6:
            return 'tread' if (i + (k == 5)) % 4 == 0 else 'rubber'
        return 'sidewall' if k in (1, 9) else 'rubber'
    revolve(mb, prof, N, tyre)
    rim = st['rim']
    # rim: lips and barrel
    sym(lambda s: revolve(mb, [(s * hw * 0.6, r * 0.7), (s * hw * 0.62, r * 0.67), (s * hw * 0.5, r * 0.655)], N, rim))
    revolve(mb, [(-hw * 0.5, r * 0.655), (hw * 0.5, r * 0.655)], N, 'dark')
    # hub
    revolve(mb, [(-hw * 0.95, 0.03), (-hw * 0.95, 0.055), (-hw * 0.6, 0.075), (hw * 0.6, 0.075), (hw * 0.95, 0.055), (hw * 0.95, 0.03)], 16, 'alu', close=True)

    def at(x, rad, a):
        return Vector((x, math.cos(a) * rad, math.sin(a) * rad))
    if st.get('wire'):
        # laced wire wheel: 36 spokes crossing from the hub flanges to the rim
        for i in range(36):
            a = (i / 36) * math.tau
            s = 1 if i % 2 else -1
            tube(mb, [at(s * hw * 0.8, 0.065, a), at(s * hw * 0.25, r * 0.655, a + 0.32 * (1 if i % 4 < 2 else -1))], 0.0035, 'chrome' if rim == 'chrome' else 'metal', sides=4, caps=False)
    else:
        # six split spokes, curved, thinning towards the rim
        for i in range(6):
            a = (i / 6) * math.tau
            for off in (-0.1, 0.1):
                tube(mb, spline([at(0, 0.07, a), at(0, r * 0.36, a + off * 0.5 + 0.05), at(0, r * 0.64, a + off + 0.1)], 4),
                     [0.02, 0.019, 0.018, 0.017, 0.016, 0.015, 0.014, 0.013, 0.012], rim, sides=6, squash=(0.6, 1.0))

    # brakes: drilled discs on carriers (front: two, rear: one on the right); rear sprocket on the left
    def brake_disc(x, R0):
        disc(mb, (x, 0, 0), R0 * 0.62, R0, 0.005, 40, lambda k, i: 'holes' if (k == 0 and i % 3 == 0) else 'disc')
        for i in range(5):  # floating carrier arms
            a = (i / 5) * math.tau
            tube(mb, [at(x, 0.075, a), at(x, R0 * 0.64, a + 0.2)], 0.008, 'alu', sides=4)
    if front:
        rd = min(0.165, r * 0.54)
        sym(lambda s: brake_disc(s * (hw + 0.012), rd))
    else:
        brake_disc(hw + 0.012, 0.11)
        disc(mb, (-(hw + 0.015), 0, 0), 0.06, 0.1, 0.007, 42, lambda k, i: 'chain' if i % 2 else 'alu')
    return mb


# ------------------------------------------------------------------ shared chassis parts
def front_end(mb, st, usd=True, fork_len=None):
    '''Fork legs, axle clamps, triple clamps, brake calipers. Returns the top of the fork.'''
    ax, up = fork_axis(st)
    L = fork_len or (st['headY'] - 0.05 - st['rf']) / math.cos(RAKE)
    top = ax + up * L
    for s in (-1, 1):
        x = s * 0.1
        a, b = ax + Vector((x, 0, 0)), top + Vector((x, 0, 0))
        mid = a.lerp(b, 0.42)
        if usd:   # upside-down fork: thin gold stanchion at the bottom, fat outer tube above
            tube(mb, [a + up * -0.02, mid], 0.022, 'gold', sides=12)
            tube(mb, [mid - up * 0.02, b], 0.029, 'dark', sides=12)
        else:
            tube(mb, [a, mid], 0.03, 'alu', sides=12)
            tube(mb, [mid - up * 0.02, b], 0.022, 'chrome', sides=12)
        rbox(mb, (x, st['rf'], st['wf']), (0.05, 0.07, 0.07), 'dark', n=4)  # axle clamp
        # caliper behind the axle on the disc
        rbox(mb, (s * (st['tf'] + 0.03), st['rf'] + 0.1, st['wf'] + 0.1), (0.035, 0.1, 0.05), 'gold' if usd else 'dark', n=4)
    for t in (0.72, 1.0):   # triple clamps
        c = ax + up * (L * t)
        rbox(mb, (0, c.y, c.z + 0.015), (0.27, 0.035, 0.1), 'alu' if t < 1 else 'dark', n=6)
    return top


def bars(mb, st, top, kind):
    '''Handlebars ending at the rider's grips, with levers and switchgear.'''
    hx, hy, hz = st['hand']
    for s in (-1, 1):
        g = Vector((s * hx, hy, hz))
        if kind == 'clipon':
            start = top + Vector((s * 0.1, -0.03, 0.02))
            tube(mb, [start, g + Vector((-s * 0.1, 0, 0))], 0.013, 'dark', sides=8)
        else:
            tube(mb, spline([Vector((0, top.y + 0.04, top.z + 0.02)), Vector((s * hx * 0.45, hy - 0.02, hz + 0.03)), g + Vector((-s * 0.08, 0, 0))], 5), 0.012, 'chrome' if kind == 'chrome' else 'dark', sides=8)
        tube(mb, [g + Vector((-s * 0.08, 0, 0)), g + Vector((s * 0.05, 0, 0))], 0.017, 'rubber', sides=10)   # grip
        tube(mb, [g + Vector((-s * 0.05, 0.005, -0.025)), g + Vector((s * 0.08, -0.005, -0.06))], 0.006, 'alu', sides=5)  # lever
        rbox(mb, (g.x - s * 0.1, g.y + 0.01, g.z), (0.03, 0.03, 0.04), 'black', n=4)  # switch pod


def frame_spar(mb, st, pivot, color='alu'):
    '''Twin aluminium beams from the steering head round the engine to the swingarm pivot.'''
    ax, up = fork_axis(st)
    head = ax + up * ((st['headY'] - 0.05 - st['rf']) / math.cos(RAKE) * 0.86)
    for s in (-1, 1):
        pts = spline([head + Vector((s * 0.05, 0, 0.03)), Vector((s * 0.17, head.y - 0.06, head.z + 0.25)), Vector((s * 0.18, pivot.y + 0.16, pivot.z - 0.08)), Vector((s * 0.15, pivot.y, pivot.z))], 6)
        tube(mb, pts, 0.045, color, sides=8, squash=(0.55, 1.0))
    tube(mb, [Vector((-0.12, pivot.y, pivot.z)), Vector((0.12, pivot.y, pivot.z))], 0.025, 'dark', sides=10)   # pivot
    return head


def trellis(mb, st, pivot):
    '''Tubular steel trellis frame (naked bike): triangulated red tubes.'''
    ax, up = fork_axis(st)
    head = ax + up * ((st['headY'] - 0.05 - st['rf']) / math.cos(RAKE) * 0.86)
    for s in (-1, 1):
        upper = [head + Vector((s * 0.04, 0.02, 0.02)), Vector((s * 0.14, head.y - 0.02, head.z + 0.3)), Vector((s * 0.14, pivot.y + 0.3, pivot.z)), Vector((s * 0.12, 0.86, pivot.z + 0.3))]
        lower = [head + Vector((s * 0.04, -0.06, 0.0)), Vector((s * 0.16, head.y - 0.26, head.z + 0.22)), Vector((s * 0.16, pivot.y + 0.02, pivot.z - 0.02))]
        for path in (upper, lower):
            for a, b in zip(path, path[1:]):
                tube(mb, [a, b], 0.013, 'trellis', sides=6)
        for a, b in ((upper[1], lower[1]), (upper[1], lower[2]), (upper[2], lower[2]), (lower[1], upper[2])):
            tube(mb, [a, b], 0.011, 'trellis', sides=6)
    return head


def engine_inline4(mb, st, c, fins=False):
    '''Crankcase, forward-tilted cylinder block, head and cam cover; cooling fins on naked bikes.'''
    x, y, z = c
    rbox(mb, (0, y, z + 0.02), (0.36, 0.2, 0.34), 'engine', n=5)                         # crankcase
    sym(lambda s: revolve(mb, [(0, 0.0), (0, 0.075), (0.012 * s, 0.075), (0.012 * s, 0.0)], 18, 'alu', c=(s * 0.18, y - 0.02, z - 0.02)))  # side covers
    blk = lambda t: Vector((0, y + 0.1 + t * 0.18, z - 0.07 - t * 0.08))
    if fins:
        for k in range(6):
            p = blk(k / 6)
            rbox(mb, (0, p.y, p.z), (0.34, 0.02, 0.2), 'fins', n=5, S=1)
        rbox(mb, (0, blk(0.5).y, blk(0.5).z), (0.3, 0.2, 0.17), 'engine', n=5)
    else:
        rbox(mb, (0, blk(0.5).y, blk(0.5).z), (0.31, 0.2, 0.2), 'engine', n=5)
    hd = blk(1.08)
    rbox(mb, (0, hd.y, hd.z), (0.33, 0.07, 0.19), 'dark', n=6)     # head
    rbox(mb, (0, hd.y + 0.045, hd.z), (0.29, 0.03, 0.15), 'metal' if fins else 'black', n=8)  # cam cover
    return hd


def exhaust_4into1(mb, st, hd, muffler, can='titanium'):
    '''Four headers out of the front of the head, collector under the engine, muffler.'''
    col = Vector((0.06, 0.12, 0.08))
    for i, xh in enumerate((-0.11, -0.04, 0.04, 0.11)):
        tube(mb, spline([Vector((xh, hd.y - 0.05, hd.z - 0.12)), Vector((xh * 1.1, hd.y - 0.2, hd.z - 0.2)), Vector((xh * 0.6, 0.18, -0.12)), col + Vector((xh * 0.2, 0, -0.05))], 5),
             0.017, 'heat' if i % 2 else 'metal', sides=8, caps=False)
    a, b = muffler
    tube(mb, spline([col, col.lerp(a, 0.5) + Vector((0, -0.02, 0)), a], 4), 0.03, 'metal', sides=10, caps=False)
    tube(mb, [a, a.lerp(b, 0.15), a.lerp(b, 0.85), b], [0.042, 0.055, 0.055, 0.045], can, sides=12, cap_mat='black')
    tube(mb, [b, b + (b - a).normalized() * 0.02], 0.02, 'black', sides=10)      # outlet


def swingarm(mb, st, pivot, color='alu', single=False):
    ax = Vector((0, st['rr'], st['wr']))
    for s in ((1,) if single else (-1, 1)):
        a = Vector((s * 0.1, pivot.y, pivot.z + 0.02))
        b = Vector((s * (st['tr'] + 0.03), ax.y, ax.z))
        pts = spline([a, a.lerp(b, 0.5) + Vector((0, 0.03, 0)), b], 6)
        tube(mb, pts, [lerp(0.045, 0.025, i / (len(pts) - 1)) for i in range(len(pts))], color, sides=8, squash=(0.45, 1.0))
        rbox(mb, (b.x, b.y, b.z), (0.02, 0.05, 0.06), 'dark', n=4)        # axle block
    # chain run from the front sprocket to the rear sprocket (left side)
    fs = Vector((-(st['tr'] + 0.015), pivot.y - 0.03, pivot.z - 0.12))
    for dy in (0.1, -0.1):
        tube(mb, [fs + Vector((0, dy * 0.4, 0)), Vector((fs.x, ax.y + dy, ax.z))], 0.008, 'chain', sides=4, squash=(1.0, 0.6))
    # rear shock (spring over damper) from the swingarm up into the frame
    tube(mb, [Vector((0, pivot.y + 0.05, pivot.z + 0.12)), Vector((0, pivot.y + 0.28, pivot.z + 0.02))], 0.03, 'spring', sides=10)


def pegs(mb, st, heel=True):
    fx, fy, fz = st['foot']
    for s in (-1, 1):
        p = Vector((s * fx, fy, fz))
        tube(mb, [p + Vector((-s * 0.05, 0, 0)), p + Vector((s * 0.04, 0, 0))], 0.011, 'alu', sides=8)
        if heel:
            rbox(mb, (s * (fx - 0.03), fy + 0.07, fz + 0.03), (0.01, 0.13, 0.08), 'alu', n=4)   # heel guard / rearset plate
            tube(mb, [p + Vector((-s * 0.02, 0.0, -0.02)), p + Vector((-s * 0.02, 0.02, -0.14))], 0.006, 'dark', sides=4)  # lever


def mirrors(mb, base, mat='paint'):
    for s in (-1, 1):
        b = Vector((s * base[0], base[1], base[2]))
        tip = b + Vector((s * 0.08, 0.05, -0.02))
        tube(mb, [b, tip], 0.008, 'black', sides=5)
        rbox(mb, (tip.x + s * 0.02, tip.y + 0.02, tip.z), (0.11, 0.055, 0.04), mat, n=3)
        rbox(mb, (tip.x + s * 0.02, tip.y + 0.02, tip.z + 0.021), (0.095, 0.045, 0.004), 'glass', n=4, S=1)


def tail_light(mb, z, y, w=0.075):
    rbox(mb, (0, y, z), (w * 2, 0.035, 0.02), 'tail', n=6, S=1)
    sym(lambda s: rbox(mb, (s * (w + 0.05), y - 0.05, z - 0.02), (0.035, 0.018, 0.03), 'amber', n=4, S=1))
    tube(mb, [Vector((0, y - 0.03, z - 0.02)), Vector((0, y - 0.2, z + 0.12))], 0.012, 'black', sides=6)   # plate hanger
    rbox(mb, (0, y - 0.25, z + 0.13), (0.17, 0.1, 0.006), 'white', n=6, S=1)


def fender(mb, st, kind):
    ax = Vector((0, st['rf'], st['wf']))
    r = st['rf'] + 0.03
    a0, a1 = (0.35, 1.8) if kind != 'moto' else (0.9, 1.6)
    P = []
    for j in range(13):
        a = lerp(a0, a1, j / 12)
        cz, cy = ax.z - math.cos(a) * r, ax.y + math.sin(a) * r
        P.append([Vector((x, cy + abs(x) * 0.3, cz)) for x in (-0.075, -0.05, 0.0, 0.05, 0.075)])
    mb.grid(P, 'paint', closed=False)
    mb.grid([[p + Vector((0, -0.004, 0)) for p in row] for row in P], 'black', closed=False, flip=True)


def tank_seat_tail(mb, st, gp=False):
    sy = st['seatY']
    loft(mb, -0.34, 0.1, 20, 32, [(-0.34, 0.9), (-0.2, 1.0), (-0.05, 1.01), (0.1, sy + 0.02)], [(-0.34, 0.78), (0.1, 0.76)],
         [(-0.34, 0.12), (-0.15, 0.18), (0.05, 0.16), (0.1, 0.12)], n=2.8, mat=lambda x, y, z: 'paint2' if abs(x) < 0.03 and y > 0.95 else 'paint')
    loft(mb, 0.06, 0.48, 10, 20, [(0.06, sy), (0.3, sy + 0.005), (0.48, sy + 0.02)], 0.79, [(0.06, 0.115), (0.3, 0.13), (0.48, 0.1)], n=4, mat='seat')
    tt = 0.03 if gp else 0.0
    loft(mb, 0.26, 1.0, 24, 28, [(0.26, 0.86), (0.4, 0.93 + tt), (0.6, 0.96 + tt), (0.85, 0.985 + tt), (1.0, 0.99 + tt)],
         [(0.26, 0.7), (0.5, 0.74 + tt), (0.8, 0.83 + tt), (1.0, 0.9 + tt)], [(0.26, 0.14), (0.5, 0.13), (0.8, 0.08), (1.0, 0.045)], n=2.4,
         mat=lambda x, y, z: 'paint2' if y < 0.8 + (z - 0.26) * 0.15 else 'paint', cap_mat='black')
    tail_light(mb, 1.005, 0.93 + tt, w=0.05)


# ------------------------------------------------------------------ sport family: sport / gp / hyper
def sport(st):
    mb = MB()
    gp, hyper = st.get('gp'), st.get('hyper')
    pivot = Vector((0, 0.45, 0.14))
    top = front_end(mb, st, usd=True)
    bars(mb, st, top, 'clipon')
    frame_spar(mb, st, pivot)
    hd = engine_inline4(mb, st, (0, 0.33, -0.08))
    swingarm(mb, st, pivot, single=bool(hyper))
    pegs(mb, st)
    exhaust_4into1(mb, st, hd, (Vector((0.2, 0.36, 0.42)), Vector((0.22, 0.52, 0.78))) if not gp else (Vector((0.13, 0.62, 0.62)), Vector((0.13, 0.78, 0.98))),
                   can='carbon' if hyper else 'titanium')
    rbox(mb, (0, 0.55, -0.3), (0.34, 0.26, 0.04), 'black', n=6, S=1)   # radiator behind the front wheel

    # --- upper fairing: pointed beak, raked face, slit headlights along the sides, ram-air mouth
    nz = st['wf'] - 0.28 - (0.03 if hyper else 0)
    dy = -0.03 if gp else 0.0
    kw = 1.06 if hyper else 1.0
    faceB, slant = 0.74 + dy, 0.7
    topU = Curve([(nz, 0.84 + dy), (nz + 0.1, 0.885 + dy), (nz + 0.25, 0.94 + dy), (nz + 0.4, 0.975 + dy), (nz + 0.55, 0.98), (nz + 0.72, 0.95)])
    botU = Curve([(nz, faceB), (nz + 0.1, 0.69 + dy), (nz + 0.25, 0.65), (nz + 0.45, 0.62), (nz + 0.72, 0.6)])
    hwU = Curve([(nz, 0.05 * kw), (nz + 0.08, 0.115 * kw), (nz + 0.2, 0.168 * kw), (nz + 0.4, 0.2 * kw), (nz + 0.58, 0.212 * kw), (nz + 0.72, 0.215 * kw)])
    lampY = lambda z: faceB + 0.035 + (z - nz) * 0.45

    def upper_mat(x, y, z):
        u = z - nz
        if 0.02 < u < 0.2 and abs(x) > hwU(z) * 0.35:
            d, h = abs(y - lampY(z)), 0.016 * (1 - ((u - 0.02) / 0.18) * 0.5)
            if d < h:
                return 'head'
            if d < h + 0.012:
                return 'black'
        if z > nz + 0.28 and y > topU(z) - 0.03 and abs(x) < 0.16:
            return 'dark'
        return 'paint'

    def warp(p, u):
        if u < 0.2:
            p.z += max(0.0, p.y - faceB) * slant * (1 - u / 0.2)
        return p
    loft(mb, nz, nz + 0.72, 44, 48, topU, botU, hwU, n=1.9, mat=upper_mat, warp=warp, caps=(True, False), cap_mat='black')
    # windscreen: a curved bubble on the fairing top
    zs0, zs1 = nz + 0.2, nz + 0.54
    sa, sb = Curve([(zs0, 0.105), (zs1, 0.14)]), Curve([(zs0, 0.0), (zs0 + 0.12, 0.055), (zs1, 0.09 if gp else 0.12)])
    P = []
    for j in range(13):
        z = lerp(zs0, zs1, j / 12)
        P.append([Vector((math.cos(t) * sa(z), topU(z) - 0.012 + math.sin(t) * sb(z), z)) for t in [math.pi * (0.06 + 0.88 * i / 16) for i in range(17)]])
    mb.grid(P, 'glass', closed=False)
    # --- lower fairing and belly pan, two-tone livery split, vent gills, number roundel
    z0 = nz + 0.58
    topL = Curve([(z0, 0.66), (z0 + 0.15, 0.8), (z0 + 0.35, 0.77), (0.1, 0.68), (0.2, 0.58)])
    botL = Curve([(z0, 0.34), (z0 + 0.1, 0.2), (z0 + 0.4, 0.155), (0.12, 0.2), (0.2, 0.34)])
    hwL = Curve([(z0, 0.19 * kw), (z0 + 0.1, 0.215 * kw), (z0 + 0.35, 0.21 * kw), (0.1, 0.18), (0.2, 0.1)])

    def lower_mat(x, y, z):
        hx = abs(x)
        if y > topL(z) - 0.02 and hx < 0.15:
            return 'dark'
        if y < botL(z) + 0.025:
            return 'black'
        if hx > 0.17 and z0 + 0.1 < z < z0 + 0.3 and 0.5 < y < 0.74:
            v = (z - z0) - (y - 0.5) * 0.35
            if (v % 0.07) < 0.028:
                return 'black'
        return 'paint2' if y < 0.36 + (z - z0) * 0.12 else 'paint'

    def lwarp(p, u):
        if u < 0.35:
            p.z += max(0.0, 0.64 - p.y) * 0.3 * (1 - u / 0.35)
        return p
    loft(mb, z0, 0.2, 36, 48, topL, botL, hwL, n=3.0, mat=lower_mat, warp=lwarp, caps=(False, False))
    # race-number roundel: a real white disc with a black ring, standing just off each side panel
    sym(lambda s: revolve(mb, [(0.0, 0.0), (0.0, 0.1), (0.0, 0.112)], 32, lambda k, i: 'white' if k == 0 else 'black', c=(s * (hwL(-0.1) + 0.006), 0.5, -0.1), axis='x'))
    if not gp:
        mirrors(mb, (0.19, 0.95 + dy, nz + 0.38))
    if hyper:   # winglets on the fairing sides
        for s in (-1, 1):
            rbox(mb, (s * 0.27, 0.745, nz + 0.39), (0.14, 0.012, 0.15), 'carbon', n=6, S=1)
            rbox(mb, (s * 0.335, 0.72, nz + 0.39), (0.01, 0.06, 0.15), 'paint2', n=6, S=1)
    tank_seat_tail(mb, st, gp=gp)
    fender(mb, st, 'sport')
    return mb


# ------------------------------------------------------------------ naked
def naked(st):
    mb = MB()
    pivot = Vector((0, 0.45, 0.14))
    top = front_end(mb, st, usd=True)
    bars(mb, st, top, 'flat')
    trellis(mb, st, pivot)
    hd = engine_inline4(mb, st, (0, 0.33, -0.08), fins=True)
    swingarm(mb, st, pivot, single=True)
    pegs(mb, st)
    exhaust_4into1(mb, st, hd, (Vector((0.18, 0.3, 0.3)), Vector((0.2, 0.36, 0.52))), can='carbon')
    rbox(mb, (0, 0.6, -0.3), (0.3, 0.24, 0.04), 'black', n=6, S=1)
    # angular headlight nacelle and a short fly screen
    ax, up = fork_axis(st)
    hc = ax + up * 0.52 + Vector((0, 0.0, -0.1))
    loft(mb, hc.z - 0.09, hc.z + 0.06, 10, 24, [(hc.z - 0.09, hc.y + 0.07), (hc.z + 0.06, hc.y + 0.11)], [(hc.z - 0.09, hc.y - 0.08), (hc.z + 0.06, hc.y - 0.1)],
         [(hc.z - 0.09, 0.1), (hc.z + 0.06, 0.12)], n=1.8, mat='paint', caps=(False, True), cap_mat='black')
    loft(mb, hc.z - 0.1, hc.z - 0.085, 1, 24, hc.y + 0.05, hc.y - 0.06, 0.085, n=1.8, mat='head', caps=(True, False))
    rbox(mb, (0, hc.y + 0.13, hc.z + 0.02), (0.2, 0.1, 0.008), 'glass', n=5, S=1)
    tank_seat_tail(mb, st)
    fender(mb, st, 'naked')
    sym(lambda s: rbox(mb, (s * 0.2, 0.7, -0.26), (0.03, 0.2, 0.2), 'paint2', n=3))   # tank shrouds
    return mb


# ------------------------------------------------------------------ supermoto
def moto(st):
    mb = MB()
    pivot = Vector((0, 0.5, 0.14))
    top = front_end(mb, st, usd=True, fork_len=(st['headY'] - st['rf']) / math.cos(RAKE))
    bars(mb, st, top, 'wide')
    ax, up = fork_axis(st)
    head = ax + up * ((st['headY'] - st['rf']) / math.cos(RAKE) * 0.85)
    # single cradle frame + single cylinder
    tube(mb, spline([head, Vector((0, head.y - 0.1, head.z + 0.35)), Vector((0, 0.9, 0.2)), Vector((0, 0.95, 0.75))], 6), 0.02, 'dark', sides=8)
    tube(mb, spline([head + Vector((0, -0.05, 0)), Vector((0, 0.35, -0.2)), Vector((0, 0.22, 0.05)), pivot], 6), 0.018, 'dark', sides=8)
    rbox(mb, (0, 0.36, -0.02), (0.22, 0.24, 0.3), 'engine', n=5)
    for k in range(5):
        rbox(mb, (0, 0.5 + k * 0.035, -0.12 - k * 0.012), (0.2, 0.014, 0.16), 'fins', n=5, S=1)
    rbox(mb, (0, 0.7, -0.18), (0.16, 0.06, 0.14), 'dark', n=6)
    swingarm(mb, st, pivot)
    pegs(mb, st, heel=False)
    # high pipe snaking to a tall silencer under the seat
    tube(mb, spline([Vector((0.03, 0.62, -0.26)), Vector((0.1, 0.45, -0.3)), Vector((0.18, 0.3, -0.05)), Vector((0.2, 0.5, 0.3)), Vector((0.19, 0.72, 0.52))], 6), 0.02, 'heat', sides=8, caps=False)
    tube(mb, [Vector((0.19, 0.72, 0.52)), Vector((0.2, 0.8, 0.72)), Vector((0.2, 0.84, 0.82))], [0.035, 0.045, 0.04], 'alu', sides=10, cap_mat='black')
    # slim tank/shrouds, long flat seat, high tail, number board and beak fender
    loft(mb, -0.3, 0.05, 12, 24, [(-0.3, 1.0), (-0.1, 1.04), (0.05, 1.0)], [(-0.3, 0.78), (0.05, 0.86)], [(-0.3, 0.2), (-0.1, 0.19), (0.05, 0.13)], n=3.2,
         mat=lambda x, y, z: 'paint2' if y < 0.86 else 'paint')
    loft(mb, -0.02, 0.62, 14, 16, [(-0.02, 1.04), (0.3, st['seatY'] + 0.01), (0.62, st['seatY'] + 0.02)], [(0, 0.95), (0.62, 0.94)], [(-0.02, 0.07), (0.3, 0.1), (0.62, 0.06)], n=4, mat='seat')
    loft(mb, 0.45, 1.0, 12, 20, [(0.45, 0.99), (1.0, 1.02)], [(0.45, 0.9), (1.0, 0.97)], [(0.45, 0.11), (1.0, 0.05)], n=2.2, mat='white', cap_mat='black')
    tail_light(mb, 1.0, 0.98, w=0.03)
    nb = ax + up * 0.66
    rbox(mb, (0, nb.y, nb.z - 0.06), (0.24, 0.22, 0.02), 'white', n=5, S=1)
    rbox(mb, (0, nb.y + 0.02, nb.z - 0.075), (0.09, 0.05, 0.01), 'head', n=5, S=1)
    zb = st['wf'] - 0.17   # beak tip
    loft(mb, zb, st['wf'] + 0.05, 10, 16, [(zb, nb.y - 0.13), (st['wf'] + 0.05, nb.y - 0.05)], [(zb, nb.y - 0.16), (st['wf'] + 0.05, nb.y - 0.12)],
         [(zb, 0.04), (st['wf'] + 0.05, 0.11)], n=2.0, mat='paint', cap_mat='black')
    return mb


# ------------------------------------------------------------------ cruiser
def cruiser(st):
    mb = MB()
    pivot = Vector((0, 0.38, 0.22))
    top = front_end(mb, st, usd=False)
    bars(mb, st, top, 'chrome')
    ax, up = fork_axis(st)
    head = ax + up * ((st['headY'] - 0.05 - st['rf']) / math.cos(RAKE) * 0.9)
    # steel cradle frame
    for s in (-1, 1):
        tube(mb, spline([head, Vector((s * 0.1, 0.35, head.z + 0.1)), Vector((s * 0.12, 0.18, 0.0)), Vector((s * 0.12, 0.2, pivot.z)), Vector((s * 0.1, st['seatY'] - 0.03, 0.45)), Vector((s * 0.1, 0.62, st['wr']))], 6), 0.018, 'black', sides=8)
    tube(mb, spline([head + Vector((0, 0.02, 0)), Vector((0, head.y - 0.02, head.z + 0.4)), Vector((0, st['seatY'] - 0.02, 0.2))], 6), 0.022, 'black', sides=8)
    # 45-degree V-twin: two finned cylinders in a V over a round crankcase with a chrome timing cover
    cc = Vector((0, 0.3, -0.05))
    revolve(mb, [(-0.14, 0.0), (-0.14, 0.13), (0.14, 0.13), (0.14, 0.0)], 24, 'engine', c=cc, close=True)
    revolve(mb, [(0.14, 0.0), (0.14, 0.1), (0.16, 0.09), (0.16, 0.0)], 24, 'chrome', c=cc, close=True)
    for ang in (-0.4, 0.4):
        d = Vector((0, math.cos(ang), math.sin(ang)))
        for k in range(7):
            p = cc + d * (0.12 + k * 0.03)
            revolve(mb, [(-0.012, 0.0), (-0.012, 0.075 if k < 6 else 0.06), (0.012, 0.075 if k < 6 else 0.06), (0.012, 0.0)], 18, 'fins' if k < 6 else 'chrome',
                    c=(p.x, p.y, p.z), axis='y', close=True)
    # twin staggered chrome pipes along the right side
    for ang, yy in ((-0.4, 0.26), (0.4, 0.18)):
        st0 = cc + Vector((0, math.cos(ang), math.sin(ang))) * 0.2
        tube(mb, spline([st0 + Vector((0.05, 0, 0)), Vector((0.18, yy + 0.05, st0.z + 0.05)), Vector((0.2, yy, 0.3)), Vector((0.21, yy + 0.04, 0.95))], 6), 0.028, 'chrome', sides=10, cap_mat='black')
    swingarm(mb, st, pivot, color='black')
    fx, fy, fz = st['foot']
    sym(lambda s: tube(mb, [Vector((s * (fx - 0.06), fy, fz)), Vector((s * (fx + 0.05), fy, fz))], 0.014, 'rubber', sides=8))  # forward controls
    # teardrop tank with a chrome console, low scooped seat, deep valanced fenders
    loft(mb, -0.42, 0.12, 20, 32, [(-0.42, 0.93), (-0.25, 1.0), (0.0, 0.98), (0.12, 0.86)], [(-0.42, 0.8), (0.12, 0.74)],
         [(-0.42, 0.1), (-0.2, 0.17), (0.05, 0.15), (0.12, 0.1)], n=2.3, mat=lambda x, y, z: 'chrome' if abs(x) < 0.025 and y > 0.95 else 'paint')
    loft(mb, 0.08, 0.6, 12, 20, [(0.08, st['seatY'] + 0.06), (0.25, st['seatY']), (0.45, st['seatY'] + 0.05), (0.6, st['seatY'] + 0.1)], st['seatY'] - 0.07,
         [(0.08, 0.1), (0.3, 0.17), (0.6, 0.14)], n=3.5, mat='leather')
    for (cz, cy, r, a0, a1, w) in ((st['wf'], st['rf'], st['rf'] + 0.05, 0.15, 2.1, 0.1), (st['wr'], st['rr'], st['rr'] + 0.05, 1.3, 3.2, 0.13)):
        P = []
        for j in range(15):
            a = lerp(a0, a1, j / 14)
            zz, yy = cz - math.cos(a) * r, cy + math.sin(a) * r
            P.append([Vector((w * math.sin(t), yy + (1 - math.cos(t)) * -0.06, zz)) for t in [lerp(-1.4, 1.4, i / 8) for i in range(9)]])
        mb.grid(P, 'paint', closed=False)
        mb.grid([[p + Vector((0, -0.004, 0)) for p in row] for row in P], 'black', closed=False, flip=True)
    tail_light(mb, st['wr'] + 0.33, 0.62, w=0.04)
    # big chrome headlight bucket
    hc = ax + up * 0.62 + Vector((0, 0, -0.12))
    revolve(mb, [(-0.08, 0.0), (-0.08, 0.1), (0.0, 0.11), (0.06, 0.08), (0.08, 0.0)], 24, 'chrome', c=(hc.x, hc.y, hc.z), axis='z')
    revolve(mb, [(-0.082, 0.0), (-0.082, 0.095)], 24, 'head', c=(hc.x, hc.y, hc.z), axis='z', close=True)
    sym(lambda s: rbox(mb, (s * 0.2, hc.y - 0.04, hc.z + 0.05), (0.05, 0.04, 0.05), 'amber', n=3))
    return mb


BUILDERS = {'sport': sport, 'gp': sport, 'hyper': sport, 'naked': naked, 'moto': moto, 'cruiser': cruiser}


def build_style(sid):
    '''-> {'body': MB, 'wheelF': MB, 'wheelR': MB} (wheels centred on their axle).'''
    st = STYLES[sid]
    return {'body': BUILDERS[sid](st), 'wheelF': wheel(st, True), 'wheelR': wheel(st, False)}
