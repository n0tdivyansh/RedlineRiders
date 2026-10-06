'''
Builds every bike style in Blender and writes js/bike-models.js for the game.
=============================================================================
Run (Windows):
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background --factory-startup --python blender/export_bikes.py
  (append  -- sport naked  to export only some styles; the others keep their previous data)

Per style: body, wheelF, wheelR. Each mesh is stored as (little-endian, 4-byte aligned sections):
    pos  nv x 3 x uint16   position quantized to [qmin, qmax] (game coordinates, see bikelib.py)
    nrm  nv x 2 x int8     normal, octahedral encoding
    pal  nv x uint8        index into palette = [[game material, sRGB colour], ...]
    ao   nv x uint8        ambient occlusion baked against the whole bike and the ground (255 = open)
    idx  ni x uint16/32    triangle corners
All sections of all meshes are concatenated, zlib-compressed and base64-encoded. js/bikes.js decodes it.
'''
import bpy, math, os, sys, json, zlib, base64, struct, random
from mathutils import Vector
from mathutils.bvhtree import BVHTree

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
import bikelib  # noqa: E402
from bikelib import STYLES, PAL, build_style  # noqa: E402

OUT_JS = os.path.normpath(os.path.join(BASE, '..', 'js', 'bike-models.js'))
CACHE = os.path.join(BASE, 'out')


# ------------------------------------------------------------------ ambient occlusion
def hemisphere(k, seed):
    rnd = random.Random(seed)
    dirs = []
    for i in range(k):   # cosine-weighted, stratified in the angle
        u, v = (i + rnd.random()) / k, rnd.random()
        r, t = math.sqrt(u), v * math.tau
        dirs.append((r * math.cos(t), math.sqrt(max(0.0, 1 - u)), r * math.sin(t)))
    return dirs


DIRS = hemisphere(24, 7)


def basis(n):
    a = Vector((1, 0, 0)) if abs(n.x) < 0.9 else Vector((0, 0, 1))
    t = n.cross(a).normalized()
    return t, n.cross(t)


def ambient(p, n, bvh, dist=0.3):
    '''Share of the hemisphere above p that is open (ground plane at y = 0 blocks too).'''
    o = p + n * 0.002
    t, b = basis(n)
    hit = 0
    for dx, dn, dz in DIRS:
        d = (t * dx + n * dn + b * dz).normalized()
        if d.y < -1e-4 and 0 < -o.y / d.y < dist:
            hit += 1
            continue
        if bvh.ray_cast(o, d, dist)[0] is not None:
            hit += 1
    return 1.0 - hit / len(DIRS)


# ------------------------------------------------------------------ mesh -> packed bytes
def octa(n):
    x, y, z = n
    s = abs(x) + abs(y) + abs(z) or 1.0
    x, y, z = x / s, y / s, z / s
    if z < 0:
        x, y = (1 - abs(y)) * (1 if x >= 0 else -1), (1 - abs(x)) * (1 if y >= 0 else -1)
    return struct.pack('bb', max(-127, min(127, round(x * 127))), max(-127, min(127, round(y * 127))))


def mesh_data(ob, bvh, offset, palette):
    me = ob.data
    me.calc_loop_triangles()
    cn = me.corner_normals
    names = [s.material.name[3:] for s in ob.material_slots]
    key_of, V, T = {}, [], []
    for tri in me.loop_triangles:
        mat = names[tri.material_index]
        if mat not in palette:
            palette[mat] = len(palette)
        idx = []
        for li, vi in zip(tri.loops, tri.vertices):
            n = cn[li].vector
            key = (vi, round(n.x, 2), round(n.y, 2), round(n.z, 2), mat)
            if key not in key_of:
                p = me.vertices[vi].co
                key_of[key] = len(V)
                # both faces: thin shells and decals may face either way (the game lights both sides);
                # on a closed part the inward side is always blocked, so the max is the outer side
                ao = max(ambient(p + offset, n, bvh), ambient(p + offset, -n, bvh))
                V.append((p.copy(), n.copy(), palette[mat], ao))
            idx.append(key_of[key])
        T.append(idx)
    return V, T


def pack(V, T):
    nv, ni = len(V), len(T) * 3
    qmin = [min(v[0][i] for v in V) for i in range(3)]
    qmax = [max(v[0][i] for v in V) for i in range(3)]
    qmax = [max(qmax[i], qmin[i] + 1e-3) for i in range(3)]
    b = bytearray()
    for p, _, _, _ in V:
        b += struct.pack('<3H', *[round((p[i] - qmin[i]) / (qmax[i] - qmin[i]) * 65535) for i in range(3)])
    for _, n, _, _ in V:
        b += octa(n)
    b += bytes(v[2] for v in V)
    b += bytes(max(0, min(255, round(v[3] * 255))) for v in V)
    while len(b) % 4:
        b.append(0)
    wide = nv > 65535
    for t in T:
        b += struct.pack('<3I' if wide else '<3H', *t)
    while len(b) % 4:
        b.append(0)
    return bytes(b), dict(nv=nv, ni=ni, wide=wide, qmin=[round(x, 5) for x in qmin], qmax=[round(x, 5) for x in qmax])


# ------------------------------------------------------------------ main
def export_style(sid, palette):
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    coll = bpy.context.scene.collection
    st = STYLES[sid]
    parts = build_style(sid)
    obs = {k: mb.build(sid + '_' + k, coll) for k, mb in parts.items()}
    # AO against the assembled bike: wheels placed at their axles
    place = {'body': Vector((0, 0, 0)), 'wheelF': Vector((0, st['rf'], st['wf'])), 'wheelR': Vector((0, st['rr'], st['wr']))}
    verts, polys = [], []
    for k, ob in obs.items():
        base = len(verts)
        verts += [v.co + place[k] for v in ob.data.vertices]
        polys += [[base + i for i in p.vertices] for p in ob.data.polygons]
    bvh = BVHTree.FromPolygons(verts, polys)
    out = {}
    for k, ob in obs.items():
        V, T = mesh_data(ob, bvh, place[k], palette)
        out[k] = (V, T)
        print('  %s %s: %d verts, %d tris' % (sid, k, len(V), len(T)))
    return out


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ids = args or list(STYLES)
    os.makedirs(CACHE, exist_ok=True)
    palette = {}
    pal_path = os.path.join(CACHE, 'palette.json')
    if args and os.path.exists(pal_path):   # partial export: keep palette indices stable
        palette = {k: i for i, k in enumerate(json.load(open(pal_path)))}
    for sid in ids:
        data = export_style(sid, palette)
        rec = {}
        for k, (V, T) in data.items():
            blob, meta = pack(V, T)
            rec[k] = meta
            open(os.path.join(CACHE, '%s_%s.bin' % (sid, k)), 'wb').write(blob)
        json.dump(rec, open(os.path.join(CACHE, sid + '.json'), 'w'))
    names = sorted(palette, key=palette.get)
    json.dump(names, open(pal_path, 'w'))
    # merge every exported style into the game file
    bikes, blob = {}, bytearray()
    for sid in STYLES:
        mp = os.path.join(CACHE, sid + '.json')
        if not os.path.exists(mp):
            continue
        rec = json.load(open(mp))
        for k in ('body', 'wheelF', 'wheelR'):
            rec[k]['off'] = len(blob)
            blob += open(os.path.join(CACHE, '%s_%s.bin' % (sid, k)), 'rb').read()
        bikes[sid] = rec
    pal = [[PAL[n][0], PAL[n][1]] for n in names]
    b64 = base64.b64encode(zlib.compress(bytes(blob), 9)).decode()
    with open(OUT_JS, 'w', newline='\n') as f:
        f.write('// Generated by blender/export_bikes.py from blender/bikelib.py - do not edit by hand.\n')
        f.write('SR.BIKE_MODELS = ' + json.dumps({'palette': pal, 'bikes': bikes, 'bytes': len(blob)}, separators=(',', ':')))
        f.write(';\nSR.BIKE_MODELS.data = \'' + b64 + '\';\n')
    print('wrote %s: %d styles, %d KB raw, %d KB in the file' % (OUT_JS, len(bikes), len(blob) // 1024, len(b64) // 1024))


main()
