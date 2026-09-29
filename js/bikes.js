'use strict';
/* ============================================================
   Procedural motorbikes and riders.
   Same method as the Top Gear car generator (source/blender/carlib.py),
   ported to JS and run at load time: each body panel is a dense loft of
   superellipse cross-sections whose top, bottom, width and squareness
   follow smooth PCHIP curves; normals are smooth; lights, liveries,
   vents and race numbers are painted onto the panels by region functions.

   Local frame: forward = -Z, right = +X, up = +Y, ground at y = 0.
   Real-world proportions (600cc supersport: 1.40 m wheelbase, 0.62 m
   wheels, 24° rake, 0.82 m seat). Wheels are separate meshes (they spin).
   Materials: PAINT = livery (uPaint), PAINT2 = accent (uPaint2).
   ============================================================ */
(function (SR) {
  const M = SR.M, MAT = SR.MAT, MB = SR.GL.MB;
  const C = M.rgb;
  const W = [1, 1, 1];
  const K = {
    black: C('#0c0c10'), dark: C('#1d1e24'), plastic: C('#28292f'), engine: C('#2e3036'), metal: C('#9ea3ad'), alu: C('#c3c7cf'),
    chrome: C('#e6eaf2'), gold: C('#d9a52e'), glass: C('#34466a'), visor: C('#18223e'), visorHi: C('#5b6cb4'), rubber: C('#18181b'),
    tread: C('#0f0f11'), amber: C('#ff9a1c'), red: C('#ff2020'), redDark: C('#3a0c0e'), head: C('#fff3c8'), white: C('#f0f0ea'),
    seat: C('#17171c'), trellis: C('#c8321e'), spring: C('#e8c21a'),
  };
  const P1 = MAT.PAINT, P2 = MAT.PAINT2, LIT = MAT.LIT;

  /* ============================================================
     Curves + surface helpers
     ============================================================ */

  /** Monotone cubic (PCHIP) through [x, y] points; clamps outside the range. A number gives a constant. */
  function Curve(pts) {
    if (typeof pts === 'function') return pts;
    if (typeof pts === 'number') return () => pts;
    pts = pts.slice().sort((a, b) => a[0] - b[0]);
    const n = pts.length, x = pts.map((p) => p[0]), y = pts.map((p) => p[1]);
    if (n === 1) return () => y[0];
    const h = [], d = [];
    for (let i = 0; i < n - 1; i++) { h.push(Math.max(1e-9, x[i + 1] - x[i])); d.push((y[i + 1] - y[i]) / h[i]); }
    const m = new Array(n).fill(0);
    if (n === 2) { m[0] = m[1] = d[0]; } else {
      for (let i = 1; i < n - 1; i++) {
        if (d[i - 1] * d[i] <= 0) m[i] = 0;
        else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
      }
      const edge = (h0, h1, d0, d1) => {
        let mm = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
        if (mm * d0 <= 0) return 0;
        if (d0 * d1 < 0 && Math.abs(mm) > Math.abs(3 * d0)) mm = 3 * d0;
        return mm;
      };
      m[0] = edge(h[0], h[1], d[0], d[1]);
      m[n - 1] = edge(h[n - 2], h[n - 3], d[n - 2], d[n - 3]);
    }
    return (t) => {
      if (t <= x[0]) return y[0];
      if (t >= x[n - 1]) return y[n - 1];
      let i = 0;
      while (i < n - 2 && t > x[i + 1]) i++;
      const hh = h[i], s = (t - x[i]) / hh, s2 = s * s, s3 = s2 * s;
      return (2 * s3 - 3 * s2 + 1) * y[i] + (s3 - 2 * s2 + s) * hh * m[i] + (-2 * s3 + 3 * s2) * y[i + 1] + (s3 - s2) * hh * m[i + 1];
    };
  }

  /** Emit a grid of points P[row][col] with smooth normals. wrap: columns form a closed ring.
      colorOf(row, col, centroid) -> [color, material] per quad, or null to leave a hole. */
  function grid(mb, P, wrap, colorOf) {
    const S = P.length, R = P[0].length;
    const N = [];
    for (let s = 0; s < S; s++) {
      const row = [];
      for (let r = 0; r < R; r++) {
        const du = M.sub(P[Math.min(S - 1, s + 1)][r], P[Math.max(0, s - 1)][r]);
        const dv = wrap ? M.sub(P[s][(r + 1) % R], P[s][(r - 1 + R) % R]) : M.sub(P[s][Math.min(R - 1, r + 1)], P[s][Math.max(0, r - 1)]);
        const n = M.cross(dv, du), l = M.len(n);
        row.push(l > 1e-10 ? [n[0] / l, n[1] / l, n[2] / l] : null);
      }
      N.push(row);
    }
    // collapsed ends: borrow the neighbouring row's normals
    for (let pass = 0; pass < 2; pass++)
      for (let s = 0; s < S; s++)
        for (let r = 0; r < R; r++)
          if (!N[s][r]) N[s][r] = (N[s + 1] && N[s + 1][r]) || (N[s - 1] && N[s - 1][r]) || null;
    for (let s = 0; s < S; s++) for (let r = 0; r < R; r++) if (!N[s][r]) N[s][r] = [0, 1, 0];
    const RR = wrap ? R : R - 1;
    for (let s = 0; s < S - 1; s++)
      for (let r = 0; r < RR; r++) {
        const r2 = (r + 1) % R;
        const a = P[s][r], b = P[s][r2], c = P[s + 1][r2], d = P[s + 1][r];
        const cen = [(a[0] + b[0] + c[0] + d[0]) / 4, (a[1] + b[1] + c[1] + d[1]) / 4, (a[2] + b[2] + c[2] + d[2]) / 4];
        const cm = colorOf(s, r, cen);
        if (!cm) continue;
        mb.triN(a, b, c, N[s][r], N[s][r2], N[s + 1][r2], cm[0], cm[1]);
        mb.triN(a, c, d, N[s][r], N[s + 1][r2], N[s + 1][r], cm[0], cm[1]);
      }
  }

  /** Flat cap over a ring, subdivided so painted details resolve. fill = [col, mat] or fn(x,y,z) */
  function cap(mb, ring, fill, rings) {
    rings = rings || 3;
    const n = ring.length, c = [0, 0, 0];
    ring.forEach((p) => { c[0] += p[0] / n; c[1] += p[1] / n; c[2] += p[2] / n; });
    const L = (p, t) => [c[0] + (p[0] - c[0]) * t, c[1] + (p[1] - c[1]) * t, c[2] + (p[2] - c[2]) * t];
    for (let k = 0; k < rings; k++) {
      const t0 = k / rings, t1 = (k + 1) / rings;
      for (let i = 0; i < n; i++) {
        const a = ring[i], b = ring[(i + 1) % n];
        const q = [L(a, t0), L(b, t0), L(b, t1), L(a, t1)];
        const m = [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2, (q[0][2] + q[2][2]) / 2];
        const cm = typeof fill === 'function' ? fill(m[0], m[1], m[2]) : fill;
        if (k === 0) mb.tri(q[0], q[1], q[2], cm[0], cm[1]);
        else mb.quad(q[0], q[1], q[2], q[3], cm[0], cm[1]);
      }
    }
  }

  /** Superellipse loft along Z (front = z0).
      o: {z0, z1, S, R, top, bot, hw, n (squareness: 2 round … 5 boxy), taper (+ wider at bottom),
          warp(p, u), color(x, y, z, u) -> [col, mat], capA, capB} */
  function part(mb, o) {
    const top = Curve(o.top), bot = Curve(o.bot), hw = Curve(o.hw), nn = Curve(o.n || 2.4), tap = Curve(o.taper || 0);
    const S = o.S || 28, R = o.R || 24, xo = o.xo || 0;
    const P = [];
    for (let s = 0; s <= S; s++) {
      const u = s / S, z = o.z0 + (o.z1 - o.z0) * u;
      const yT = top(z), yB = bot(z), a = Math.max(0, hw(z)), e = 2 / nn(z), tp = tap(z);
      const yc = (yT + yB) / 2, b = (yT - yB) / 2;
      const row = [];
      for (let r = 0; r < R; r++) {
        const t = (r / R) * Math.PI * 2 - Math.PI / 2; // r = 0 at the bottom centre
        const ct = Math.cos(t), st = Math.sin(t);
        const sx = Math.sign(ct) * Math.pow(Math.abs(ct), e), sy = Math.sign(st) * Math.pow(Math.abs(st), e);
        let p = [xo + a * sx * (1 - tp * sy), yc + b * sy, z];
        if (o.warp) p = o.warp(p, u);
        row.push(p);
      }
      P.push(row);
    }
    const col = o.color || (() => [W, P1]);
    grid(mb, P, true, (s, r, c) => col(c[0], c[1], c[2], s / S));
    if (o.capA) cap(mb, P[0].slice().reverse(), o.capA);
    if (o.capB) cap(mb, P[S], o.capB);
    return P;
  }

  /** Tube along a polyline with radii per point (smooth sides, flat caps). col may be fn(x,y,z). */
  function tube(mb, pts, radii, col, mat, n, caps, flat) {
    n = n || 8;
    const rings = [];
    for (let k = 0; k < pts.length; k++) {
      const T = M.norm(M.sub(pts[Math.min(pts.length - 1, k + 1)], pts[Math.max(0, k - 1)]));
      const ref = Math.abs(T[1]) > 0.92 ? [1, 0, 0] : [0, 1, 0];
      const U = M.norm(M.cross(T, ref)), V = M.cross(U, T);
      const r = Array.isArray(radii) ? radii[k] : radii;
      const fx = flat ? flat[0] : 1, fy = flat ? flat[1] : 1;
      const ring = [];
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2 + Math.PI / n;
        const cx = Math.cos(t) * r * fx, cy = Math.sin(t) * r * fy;
        ring.push([pts[k][0] + U[0] * cx + V[0] * cy, pts[k][1] + U[1] * cx + V[1] * cy, pts[k][2] + U[2] * cx + V[2] * cy]);
      }
      rings.push(ring);
    }
    const f = typeof col === 'function' ? (s, r, c) => col(c[0], c[1], c[2]) : () => [col, mat];
    grid(mb, rings, true, f);
    if (caps !== false) {
      const cc = typeof col === 'function' ? col(pts[0][0], pts[0][1], pts[0][2]) : [col, mat];
      mb.poly(rings[0], cc[0], cc[1]);
      mb.poly(rings[rings.length - 1].slice().reverse(), cc[0], cc[1]);
    }
    return rings;
  }

  /** Smooth ellipsoid with per-quad paint function color(x, y, z, localDir) */
  function ball(mb, c, rx, ry, rz, sl, st, color) {
    const P = [];
    for (let j = 0; j <= st; j++) {
      const phi = (j / st) * Math.PI, row = [];
      for (let i = 0; i < sl; i++) {
        const th = (i / sl) * Math.PI * 2;
        row.push([c[0] + Math.sin(phi) * Math.cos(th) * rx, c[1] + Math.cos(phi) * ry, c[2] + Math.sin(phi) * Math.sin(th) * rz]);
      }
      P.push(row);
    }
    const f = typeof color === 'function' ? color : () => color;
    grid(mb, P, true, (s, r, q) => f(q[0], q[1], q[2], [(q[0] - c[0]) / rx, (q[1] - c[1]) / ry, (q[2] - c[2]) / rz]));
  }

  /** Surface of revolution about the X axis: prof = [[x, radius], ...]; color(k, i) per band/segment */
  function revolve(mb, prof, N, color, cz, cy) {
    cz = cz || 0; cy = cy || 0;
    const P = prof.map(([x, r]) => {
      const row = [];
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        row.push([x, cy + Math.cos(a) * r, cz + Math.sin(a) * r]);
      }
      return row;
    });
    grid(mb, P, true, (k, i) => color(k, i));
  }

  /** Sweep a flat (w × d) section along an arc path — fenders, mudguards */
  function sweep(mb, pts, w, d, col, mat, n) {
    tube(mb, pts, 1, col, mat, n || 8, true, [w, d]);
  }

  // 5x7 font bit lookup for painted race numbers: u, v in [0,1)
  function glyphBit(str, u, v) {
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return false;
    const n = str.length, F = SR.Font;
    const col = u * (n * F.ADV - 1), ci = Math.floor(col / F.ADV), cx = Math.floor(col - ci * F.ADV);
    if (cx >= F.CW) return false;
    const b = F.glyph(str[ci]);
    return b[Math.floor(v * F.CH)][cx];
  }
  /** painted race-number roundel on a side panel (zc, yc) of radius r; returns [col,mat] or null */
  function roundel(x, y, z, zc, yc, r, str) {
    const dz = z - zc, dy = y - yc, d = Math.hypot(dz, dy);
    if (d > r) return null;
    if (d > r * 0.9) return [K.black, LIT];
    const h = r * 1.1, w = h * ((str.length * 6 - 1) / 7);
    const lx = x < 0 ? dz : -dz; // read left-to-right from either side
    const u = (lx + w / 2) / w, v = (yc + h / 2 - y) / h;
    return glyphBit(str, u, v) ? [K.black, LIT] : [K.white, LIT];
  }

  const box = (mb, x0, y0, z0, x1, y1, z1, col, mat) => mb.box(x0, y0, z0, x1, y1, z1, col, mat || LIT);
  const sym = (f) => { f(-1); f(1); };

  /* ============================================================
     Styles
     ============================================================ */
  const STYLES = (SR.BIKE_STYLES = {
    sport: { wf: -0.7, wr: 0.7, rf: 0.305, rr: 0.315, tf: 0.06, tr: 0.09, headZ: -0.41, headY: 0.95, pose: 'tuck', num: '07', rim: 'gold', seatY: 0.87 },
    gp: { wf: -0.69, wr: 0.68, rf: 0.3, rr: 0.31, tf: 0.06, tr: 0.095, headZ: -0.41, headY: 0.93, pose: 'tuckLow', num: '21', rim: 'white', gp: true, seatY: 0.86 },
    hyper: { wf: -0.74, wr: 0.74, rf: 0.31, rr: 0.32, tf: 0.065, tr: 0.1, headZ: -0.44, headY: 0.96, pose: 'tuck', num: 'X', rim: 'black', hyper: true, seatY: 0.88 },
    naked: { wf: -0.7, wr: 0.68, rf: 0.305, rr: 0.315, tf: 0.06, tr: 0.09, headZ: -0.42, headY: 0.97, pose: 'mid', num: '', rim: 'white', seatY: 0.86 },
    moto: { wf: -0.74, wr: 0.7, rf: 0.33, rr: 0.33, tf: 0.05, tr: 0.07, headZ: -0.45, headY: 1.06, pose: 'moto', num: '3', rim: 'black', seatY: 0.99 },
    cruiser: { wf: -0.9, wr: 0.76, rf: 0.33, rr: 0.33, tf: 0.07, tr: 0.105, headZ: -0.48, headY: 1.02, pose: 'upright', num: '', rim: 'wire', seatY: 0.75 },
  });

  /* ============================================================
     Wheels: rounded tire with tread blocks, spoked rim, disc/sprocket
     ============================================================ */
  function buildWheel(r, halfW, rimKind, front) {
    const mb = new MB();
    const N = 30;
    const rim = { gold: K.gold, white: K.white, black: C('#2b2c31'), wire: K.chrome }[rimKind] || K.alu;
    // tire
    revolve(mb, [
      [-halfW * 0.62, r * 0.7], [-halfW * 0.95, r * 0.78], [-halfW, r * 0.86], [-halfW * 0.82, r * 0.95], [-halfW * 0.4, r * 0.995],
      [halfW * 0.4, r * 0.995], [halfW * 0.82, r * 0.95], [halfW, r * 0.86], [halfW * 0.95, r * 0.78], [halfW * 0.62, r * 0.7],
    ], N, (k, i) => {
      if (k >= 3 && k <= 5) return [(i + (k === 4 ? 0 : 1)) % 3 === 0 ? K.tread : K.rubber, LIT];
      return [k === 2 || k === 6 ? C('#222226') : K.rubber, LIT];
    });
    // rim lip + barrel
    for (const s of [-1, 1]) revolve(mb, [[s * halfW * 0.62, r * 0.7], [s * halfW * 0.5, r * 0.66]], N, () => [rim, LIT]);
    revolve(mb, [[-halfW * 0.5, r * 0.66], [halfW * 0.5, r * 0.66]], N, () => [K.dark, LIT]);
    // hub
    revolve(mb, [[-halfW * 0.7, 0.045], [-halfW * 0.7, 0.07], [halfW * 0.7, 0.07], [halfW * 0.7, 0.045]], 10, () => [K.alu, LIT]);
    const at = (x, rad, a) => [x, Math.cos(a) * rad, Math.sin(a) * rad];
    if (rimKind === 'wire') {
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2, side = i % 2 ? 1 : -1;
        tube(mb, [at(side * halfW * 0.55, 0.06, a), at(side * halfW * 0.2, r * 0.66, a + 0.25)], 0.005, K.chrome, LIT, 3, false);
      }
    } else {
      // five curved split spokes
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        for (const off of [-0.09, 0.09]) {
          tube(mb, [at(0, 0.06, a), at(0, r * 0.38, a + off * 0.6 + 0.06), at(0, r * 0.67, a + off + 0.1)], [0.022, 0.017, 0.014], rim, LIT, 4, false, [1.6, 0.7]);
        }
      }
    }
    // brake discs (front: both sides, rear: left) and sprocket (rear right)
    const discs = front ? [-1, 1] : [-1];
    for (const s of discs) {
      const x = s * (halfW * 0.55 + 0.012);
      for (let i = 0; i < 20; i++) {
        const a0 = (i / 20) * Math.PI * 2, a1 = ((i + 1) / 20) * Math.PI * 2;
        const hole = i % 2 === 0;
        mb.quad(at(x, r * 0.64, a0), at(x, r * 0.64, a1), at(x, r * 0.47, a1), at(x, r * 0.47, a0), hole ? C('#7a7e88') : K.metal, LIT);
        mb.quad(at(x, r * 0.47, a0), at(x, r * 0.47, a1), at(x, r * 0.3, a1), at(x, r * 0.3, a0), rim, LIT);
      }
    }
    if (!front) {
      const x = halfW * 0.55 + 0.02;
      for (let i = 0; i < 36; i++) {
        const a0 = (i / 36) * Math.PI * 2, a1 = ((i + 1) / 36) * Math.PI * 2, rr = i % 2 ? r * 0.52 : r * 0.56;
        mb.quad(at(x, rr, a0), at(x, rr, a1), at(x, r * 0.3, a1), at(x, r * 0.3, a0), C('#3a3c42'), LIT);
      }
    }
    return mb;
  }

  /* ============================================================
     Shared mechanicals: forks, frame, swingarm, chain, engine
     ============================================================ */
  function forks(mb, st, lowerCol, upperCol, rLow, rUp) {
    const { wf, rf, headZ, headY } = st;
    sym((s) => {
      const bot = [s * 0.1, rf - 0.03, wf + 0.012], top = [s * 0.1, headY + 0.04, headZ];
      const mid = M.add(bot, M.mul(M.sub(top, bot), 0.5));
      tube(mb, [bot, mid], rLow || 0.034, lowerCol, LIT, 10);
      tube(mb, [M.add(mid, M.mul(M.sub(top, bot), -0.02)), top], rUp || 0.027, upperCol, LIT, 10);
      // axle clamp + radial caliper
      box(mb, s * 0.1 - 0.035, rf - 0.06, wf - 0.02, s * 0.1 + 0.035, rf + 0.03, wf + 0.05, lowerCol);
      box(mb, s * (0.075) - 0.018, rf + 0.05, wf + 0.1, s * (0.075) + 0.018, rf + 0.19, wf + 0.19, st.rim === 'wire' ? K.chrome : K.gold);
    });
    // triple clamps
    box(mb, -0.14, headY - 0.03, headZ - 0.04, 0.14, headY + 0.02, headZ + 0.05, K.alu);
    box(mb, -0.13, headY - 0.2, headZ - 0.07, 0.13, headY - 0.15, headZ + 0.02, K.alu);
  }

  function frontFender(mb, st, col, mat, a0, a1, lift) {
    const pts = [];
    const R = st.rf + (lift || 0.035);
    for (let k = 0; k <= 8; k++) {
      const th = (a0 + (a1 - a0) * (k / 8)) * (Math.PI / 180);
      pts.push([0, st.rf + Math.sin(th) * R, st.wf - Math.cos(th) * R]);
    }
    sweep(mb, pts, 0.075, 0.012, col, mat, 10);
  }

  function rearGear(mb, st, pivot, armCol) {
    const { wr, rr } = st;
    sym((s) => tube(mb, [[s * 0.13, pivot[1], pivot[2]], [s * 0.12, (pivot[1] + rr) / 2 + 0.03, (pivot[2] + wr) / 2], [s * 0.1, rr, wr]], [0.042, 0.036, 0.026], armCol, LIT, 6, true, [0.8, 1.4]));
    // chain runs + rear axle
    for (const dy of [0.045, -0.045]) tube(mb, [[0.13, 0.4 + dy, 0.03], [0.135, rr + dy * 2.1, wr]], 0.009, K.dark, LIT, 4, false);
    tube(mb, [[-0.13, rr, wr], [0.13, rr, wr]], 0.018, K.alu, LIT, 6);
    // rear shock
    tube(mb, [[0, pivot[1] + 0.02, pivot[2] - 0.02], [0, pivot[1] + 0.3, pivot[2] - 0.12]], 0.038, K.spring, LIT, 8);
  }

  function inlineEngine(mb, cover) {
    box(mb, -0.15, 0.18, -0.34, 0.15, 0.52, 0.12, K.engine);
    box(mb, -0.14, 0.52, -0.36, 0.14, 0.7, -0.08, C('#3b3e46'));
    for (let k = 0; k < 4; k++) box(mb, -0.148, 0.535 + k * 0.04, -0.355, 0.148, 0.55 + k * 0.04, -0.085, K.metal);
    box(mb, -0.11, 0.14, -0.3, 0.11, 0.18, 0.06, K.black); // sump
    tube(mb, [[-0.15, 0.36, -0.02], [-0.185, 0.36, -0.02]], 0.1, cover || K.metal, LIT, 12); // clutch cover
    tube(mb, [[0.15, 0.3, -0.16], [0.18, 0.3, -0.16]], 0.075, cover || K.metal, LIT, 12); // alternator cover
  }

  function pegs(mb, z, y) {
    sym((s) => {
      tube(mb, [[s * 0.13, y, z], [s * 0.24, y, z]], 0.016, K.alu, LIT, 6);
      mb.quad([s * 0.16, y + 0.02, z - 0.08], [s * 0.16, y + 0.02, z + 0.1], [s * 0.16, y + 0.2, z + 0.12], [s * 0.16, y + 0.16, z - 0.04], K.alu, LIT);
    });
  }

  function mirrors(mb, pts, housingCol, housingMat) {
    sym((s) => {
      const [base, head] = pts(s);
      tube(mb, [base, head], 0.008, K.black, LIT, 4, false);
      ball(mb, head, 0.055, 0.03, 0.03, 8, 5, (x, y, z, d) => [d[2] > 0.35 ? K.glass : housingCol, d[2] > 0.35 ? LIT : housingMat]);
    });
  }

  function platehanger(mb, z, y) {
    tube(mb, [[0, y, z - 0.12], [0, y - 0.14, z + 0.05]], 0.014, K.black, LIT, 4);
    mb.quad([-0.085, y - 0.24, z + 0.075], [0.085, y - 0.24, z + 0.075], [0.085, y - 0.13, z + 0.055], [-0.085, y - 0.13, z + 0.055], K.white, LIT);
    sym((s) => ball(mb, [s * 0.11, y - 0.1, z + 0.02], 0.025, 0.016, 0.03, 6, 4, () => [K.amber, MAT.EMIT]));
    mb.quad([-0.03, y - 0.28, z + 0.08], [0.03, y - 0.28, z + 0.08], [0.03, y - 0.245, z + 0.078], [-0.03, y - 0.245, z + 0.078], K.red, MAT.BRAKE);
  }

  /* ============================================================
     Sport family (sport / gp / hyper): full fairing
     ============================================================ */
  function sportBike(mb, st) {
    const nz = st.wf - 0.28 - (st.hyper ? 0.03 : 0); // front face of the nose
    const dy = st.gp ? -0.03 : 0, kw = st.hyper ? 1.06 : 1;
    const faceB = 0.73 + dy, faceT = 0.87 + dy, slant = 0.5; // the face leans back
    const topU = Curve([[nz, faceT], [nz + 0.1, 0.93 + dy], [nz + 0.25, 0.98 + dy], [nz + 0.4, 1.0 + dy], [nz + 0.55, 0.99], [nz + 0.72, 0.95]]);
    const botU = Curve([[nz, faceB], [nz + 0.1, 0.69 + dy], [nz + 0.25, 0.65], [nz + 0.45, 0.62], [nz + 0.72, 0.6]]);
    const hwU = Curve([[nz, 0.1 * kw], [nz + 0.1, 0.15 * kw], [nz + 0.22, 0.182 * kw], [nz + 0.4, 0.2 * kw], [nz + 0.58, 0.212 * kw], [nz + 0.72, 0.215 * kw]]);
    const faceZ = (y) => nz + Math.max(0, y - faceB) * slant;

    /* upper fairing / nose */
    part(mb, {
      z0: nz, z1: nz + 0.72, S: 30, R: 44, top: topU, bot: botU, hw: hwU, n: 2.6, taper: 0.06,
      warp: (p, u) => { if (u < 0.2) p[2] += Math.max(0, p[1] - faceB) * slant * (1 - u / 0.2); return p; },
      color: (x, y, z) => {
        if (z > nz + 0.28 && y > topU(z) - 0.03 && Math.abs(x) < 0.16) return [K.dark, LIT]; // under the screen and tank
        return [W, P1];
      },
      capA: [W, P1],
    });
    // the face: black surround, twin headlights and a ram-air intake, laid on the slanted front
    const onFace = (x, y, off) => [x, y, faceZ(y) - off];
    const shape = (cx, cy, rx, ry, n, rot, off) => {
      const pts = [];
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        const ex = Math.cos(t) * rx, ey = Math.sin(t) * ry;
        pts.push(onFace(cx + ex * Math.cos(rot) - ey * Math.sin(rot), cy + ex * Math.sin(rot) + ey * Math.cos(rot), off));
      }
      return pts;
    };
    const fy = (faceB + faceT) / 2;
    sym((s) => {
      mb.poly(s < 0 ? shape(s * 0.052, fy + 0.008, 0.05, 0.034, 14, s * 0.25, 0.003) : shape(s * 0.052, fy + 0.008, 0.05, 0.034, 14, s * 0.25, 0.003).reverse(), K.black, LIT);
      mb.poly(shape(s * 0.052, fy + 0.008, 0.041, 0.026, 14, s * 0.25, 0.006), K.head, MAT.HEAD);
    });
    mb.quad(onFace(-0.026, faceB + 0.004, 0.004), onFace(0.026, faceB + 0.004, 0.004), onFace(0.018, fy - 0.012, 0.004), onFace(-0.018, fy - 0.012, 0.004), K.black, LIT);

    /* lower fairing + belly pan (front edge slants to follow the tire); two-tone livery */
    const z0 = nz + 0.58;
    const topL = Curve([[z0, 0.66], [z0 + 0.15, 0.8], [z0 + 0.35, 0.77], [0.1, 0.68], [0.2, 0.58]]);
    const botL = Curve([[z0, 0.34], [z0 + 0.1, 0.2], [z0 + 0.4, 0.155], [0.12, 0.2], [0.2, 0.34]]);
    const hwL = Curve([[z0, 0.19 * kw], [z0 + 0.1, 0.215 * kw], [z0 + 0.35, 0.21 * kw], [0.1, 0.18], [0.2, 0.1]]);
    const split = (z) => 0.36 + (z - z0) * 0.12;
    part(mb, {
      z0, z1: 0.2, S: 28, R: 44, top: topL, bot: botL, hw: hwL, n: 3.2,
      warp: (p, u) => { if (u < 0.35) p[2] += Math.max(0, 0.64 - p[1]) * 0.3 * (1 - u / 0.35); return p; },
      color: (x, y, z) => {
        const hx = Math.abs(x);
        if (y > topL(z) - 0.02 && hx < 0.15) return [K.dark, LIT];
        if (y < botL(z) + 0.025) return [K.black, LIT]; // belly pan underside
        // gills
        if (hx > 0.17 && z > z0 + 0.1 && z < z0 + 0.25 && y > 0.52 && y < 0.72) {
          const v = (z - z0) - (y - 0.52) * 0.35;
          if (M.wrap(v, 0.05) < 0.02) return [K.black, LIT];
        }
        return y < split(z) ? [W, P2] : [W, P1];
      },
    });
    // race-number roundel (real geometry so the digits read)
    if (st.num) {
      const zc = -0.1, yc = 0.5, rr = 0.1;
      sym((s) => {
        const x = s * (hwL(zc) + 0.006);
        const disc = [], ring = [];
        for (let i = 0; i < 20; i++) {
          const t = (i / 20) * Math.PI * 2;
          disc.push([x, yc + Math.sin(t) * rr, zc + Math.cos(t) * rr]);
          ring.push([x - s * 0.001, yc + Math.sin(t) * (rr + 0.012), zc + Math.cos(t) * (rr + 0.012)]);
        }
        mb.poly(ring, K.black, LIT);
        mb.poly(disc, K.white, LIT);
        mb.text(st.num, [x + s * 0.003, yc + 0.042, zc], [0, 0, s < 0 ? 1 : -1], [0, -1, 0], 0.012, K.black, LIT, 'center');
      });
    }

    /* windscreen bubble */
    const zs0 = nz + 0.2, zs1 = nz + 0.54;
    const sa = Curve([[zs0, 0.105], [zs1, 0.14]]), sb = Curve([[zs0, 0.0], [zs0 + 0.12, 0.055], [zs1, st.gp ? 0.09 : 0.12]]);
    const Ps = [];
    for (let s = 0; s <= 10; s++) {
      const z = zs0 + (zs1 - zs0) * (s / 10), row = [];
      for (let r = 0; r <= 12; r++) {
        const t = Math.PI * (0.08 + 0.84 * (r / 12));
        row.push([Math.cos(t) * sa(z), topU(z) - 0.012 + Math.sin(t) * sb(z), z]);
      }
      Ps.push(row);
    }
    grid(mb, Ps, false, () => [K.glass, LIT]);
    // dash behind the screen
    box(mb, -0.08, st.headY + 0.03, st.headZ - 0.12, 0.08, st.headY + 0.08, st.headZ - 0.03, K.dark);

    if (!st.gp) mirrors(mb, (s) => [[s * 0.19, 0.95, nz + 0.38], [s * 0.27, 1.0, nz + 0.36]], W, P1);
    if (st.hyper) {
      // carbon winglets
      sym((s) => {
        const a = [s * 0.19, 0.74, nz + 0.3], b = [s * 0.33, 0.77, nz + 0.33], c = [s * 0.33, 0.77, nz + 0.44], d = [s * 0.2, 0.73, nz + 0.47];
        mb.quad(a, b, c, d, W, P2);
        mb.quad(b, [s * 0.33, 0.7, nz + 0.35], [s * 0.33, 0.7, nz + 0.44], c, W, P2);
      });
    }

    /* tank, seat, tail */
    tank(mb, st, 'sport');
    part(mb, {
      z0: 0.06, z1: 0.46, S: 8, R: 16, top: [[0.06, st.seatY], [0.25, st.seatY + 0.003], [0.46, st.seatY + 0.015]], bot: 0.79,
      hw: [[0.06, 0.115], [0.25, 0.13], [0.46, 0.11]], n: 4, color: () => [K.seat, LIT], capA: [K.seat, LIT],
    });
    const tt = st.gp ? 0.03 : 0;
    const botT = Curve([[0.26, 0.7], [0.5, 0.74 + tt], [0.8, 0.83 + tt], [1.0, 0.9 + tt]]);
    part(mb, {
      z0: 0.26, z1: 1.0, S: 22, R: 24,
      top: [[0.26, 0.86], [0.4, 0.93 + tt], [0.6, 0.96 + tt], [0.85, 0.985 + tt], [1.0, 0.99 + tt]], bot: botT,
      hw: [[0.26, 0.14], [0.45, 0.13], [0.7, 0.1], [0.9, 0.078], [1.0, 0.068]], n: 2.8,
      color: (x, y, z) => {
        if (y < botT(z) + 0.012) return [K.dark, LIT];
        if (y < botT(z) + 0.05 && y > botT(z) + 0.028) return [W, P2];
        return [W, P1];
      },
      capB: (x, y) => {
        const e = ((Math.abs(x) - 0.032) / 0.03) ** 2 + ((y - 0.945 - tt) / 0.024) ** 2;
        return e < 1 ? [K.red, MAT.BRAKE] : [K.dark, LIT];
      },
    });
    if (!st.gp) platehanger(mb, 0.96, 0.88 + tt);
    // rear hugger
    frontFenderLike(mb, st.wr, st.rr, 60, 150, 0.04, K.dark, LIT);

    /* mechanicals */
    inlineEngine(mb);
    forks(mb, st, st.gp ? K.dark : K.gold, K.chrome);
    frontFender(mb, st, W, P1, 38, 142);
    sym((s) => tube(mb, [[s * 0.1, st.headY - 0.02, st.headZ + 0.03], [s * 0.18, 0.68, -0.05], [s * 0.16, 0.5, 0.15]], [0.035, 0.04, 0.035], K.alu, LIT, 6, true, [0.7, 1.5]));
    rearGear(mb, st, [0, 0.47, 0.15], st.gp ? K.dark : K.alu);
    pegs(mb, 0.22, 0.42);
    // clip-on bars with grips and levers
    sym((s) => {
      tube(mb, [[s * 0.1, st.headY - 0.04, st.headZ + 0.03], [s * 0.3, st.headY - 0.08, st.headZ + 0.09]], 0.017, K.black, LIT, 6);
      tube(mb, [[s * 0.23, st.headY - 0.066, st.headZ + 0.07], [s * 0.31, st.headY - 0.081, st.headZ + 0.092]], 0.022, K.rubber, LIT, 8);
      tube(mb, [[s * 0.15, st.headY - 0.05, st.headZ + 0.02], [s * 0.28, st.headY - 0.06, st.headZ - 0.02]], 0.006, K.alu, LIT, 4, false);
    });
    // exhaust: link pipe + canister
    tube(mb, [[0.08, 0.16, -0.1], [0.14, 0.2, 0.12], [0.18, 0.36, 0.3]], 0.034, C('#6a5a4e'), LIT, 8, false);
    const c0 = [0.185, 0.37, 0.3], c1 = [0.21, st.gp ? 0.64 : 0.57, 0.82];
    tube(mb, [c0, c1], [0.068, 0.062], st.gp ? K.dark : st.hyper ? C('#2a2b30') : K.alu, LIT, 12);
    tube(mb, [M.add(c1, [0, -0.005, -0.01]), M.add(c1, [0.004, 0.012, 0.035])], [0.066, 0.03], K.black, LIT, 12);
  }

  function frontFenderLike(mb, wz, r, a0, a1, lift, col, mat) {
    const pts = [];
    for (let k = 0; k <= 6; k++) {
      const th = (a0 + (a1 - a0) * (k / 6)) * (Math.PI / 180);
      pts.push([0, r + Math.sin(th) * (r + lift), wz - Math.cos(th) * (r + lift)]);
    }
    sweep(mb, pts, 0.085, 0.01, col, mat, 8);
  }

  function tank(mb, st, kind) {
    if (kind === 'sport') {
      part(mb, {
        z0: -0.46, z1: 0.12, S: 18, R: 24,
        top: [[-0.46, 0.93], [-0.36, 1.01], [-0.2, 1.035], [-0.04, 1.0], [0.06, 0.95], [0.12, 0.9]],
        bot: [[-0.46, 0.82], [-0.2, 0.79], [0.12, 0.8]],
        hw: [[-0.46, 0.1], [-0.36, 0.155], [-0.2, 0.18], [-0.02, 0.175], [0.12, 0.125]], n: 2.6, taper: -0.18,
        color: (x, y, z) => {
          const hx = Math.abs(x);
          if (hx < 0.05 && y > 0.97) return [W, P2];
          if (hx > 0.14 && y < 0.9 && z > -0.18) return [K.black, LIT]; // knee pads
          return [W, P1];
        },
        capA: [W, P1], capB: [W, P1],
      });
    } else if (kind === 'naked') {
      part(mb, {
        z0: -0.5, z1: 0.1, S: 18, R: 24,
        top: [[-0.5, 0.96], [-0.38, 1.05], [-0.18, 1.07], [0.0, 1.0], [0.1, 0.93]],
        bot: [[-0.5, 0.84], [-0.2, 0.8], [0.1, 0.82]],
        hw: [[-0.5, 0.12], [-0.36, 0.2], [-0.16, 0.2], [0.02, 0.17], [0.1, 0.12]], n: 2.4, taper: -0.12,
        color: (x, y, z) => (Math.abs(x) > 0.12 && y < 0.95 && y > 0.88 ? [W, P2] : [W, P1]),
        capA: [W, P1], capB: [W, P1],
      });
    } else if (kind === 'moto') {
      part(mb, {
        z0: -0.46, z1: 0.02, S: 14, R: 20,
        top: [[-0.46, 1.02], [-0.3, 1.07], [-0.1, 1.06], [0.02, 1.02]], bot: 0.86,
        hw: [[-0.46, 0.1], [-0.3, 0.14], [-0.1, 0.14], [0.02, 0.11]], n: 2.4,
        color: () => [W, P1], capA: [W, P1], capB: [W, P1],
      });
    } else {
      // cruiser teardrop
      part(mb, {
        z0: -0.56, z1: 0.08, S: 20, R: 26,
        top: [[-0.56, 0.98], [-0.42, 1.06], [-0.2, 1.08], [0.0, 1.03], [0.08, 0.96]],
        bot: [[-0.56, 0.92], [-0.3, 0.86], [0.08, 0.84]],
        hw: [[-0.56, 0.06], [-0.42, 0.17], [-0.2, 0.2], [0.0, 0.16], [0.08, 0.08]], n: 2.1,
        color: (x, y, z) => {
          const hx = Math.abs(x);
          if (hx > 0.15 && Math.hypot(z + 0.24, y - 0.97) < 0.045) return [K.chrome, LIT]; // tank badge
          if (hx > 0.1 && y > 0.99 && y < 1.02) return [W, P2];
          return [W, P1];
        },
      });
    }
  }

  /* ============================================================
     Naked streetbike
     ============================================================ */
  function nakedBike(mb, st) {
    const { headZ, headY } = st;
    // angular headlight + nacelle + small fly screen
    part(mb, {
      z0: headZ - 0.3, z1: headZ - 0.1, S: 8, R: 20,
      top: [[headZ - 0.3, 0.97], [headZ - 0.1, 1.0]], bot: [[headZ - 0.3, 0.8], [headZ - 0.1, 0.78]],
      hw: [[headZ - 0.3, 0.1], [headZ - 0.2, 0.12], [headZ - 0.1, 0.12]], n: 3,
      color: (x, y, z) => (z < headZ - 0.27 ? [K.dark, LIT] : [W, P1]),
      capA: (x, y) => {
        const e = (x / 0.075) ** 2 + ((y - 0.885) / 0.06) ** 2;
        return e < 1 ? [K.head, MAT.HEAD] : [K.black, LIT];
      },
    });
    grid(mb, [0, 1, 2, 3, 4].map((s) => {
      const z = headZ - 0.24 + s * 0.05, row = [];
      for (let r = 0; r <= 8; r++) { const t = Math.PI * (0.15 + 0.7 * (r / 8)); row.push([Math.cos(t) * 0.11, 0.98 + Math.sin(t) * 0.02 + s * 0.03, z]); }
      return row;
    }), false, () => [W, P1]);
    // radiator + shrouds
    box(mb, -0.17, 0.44, -0.5, 0.17, 0.78, -0.45, K.dark);
    sym((s) => mb.quad([s * 0.18, 0.5, -0.52], [s * 0.21, 0.56, -0.3], [s * 0.19, 0.86, -0.22], [s * 0.17, 0.84, -0.48], W, P2));
    tank(mb, st, 'naked');
    // seat + short tail
    part(mb, {
      z0: 0.06, z1: 0.46, S: 8, R: 16, top: [[0.06, st.seatY], [0.46, st.seatY + 0.03]], bot: 0.78,
      hw: [[0.06, 0.12], [0.3, 0.13], [0.46, 0.1]], n: 4, color: () => [K.seat, LIT], capA: [K.seat, LIT],
    });
    const botT = Curve([[0.3, 0.72], [0.6, 0.8], [0.88, 0.9]]);
    part(mb, {
      z0: 0.3, z1: 0.88, S: 14, R: 20, top: [[0.3, 0.86], [0.5, 0.92], [0.7, 0.95], [0.88, 0.96]], bot: botT,
      hw: [[0.3, 0.13], [0.6, 0.1], [0.88, 0.05]], n: 2.8,
      color: (x, y, z) => (y < botT(z) + 0.012 ? [K.dark, LIT] : [W, P1]),
      capB: (x, y) => [Math.abs(x) < 0.04 ? K.red : K.dark, Math.abs(x) < 0.04 ? MAT.BRAKE : LIT],
    });
    platehanger(mb, 0.82, 0.86);
    // steel trellis frame
    sym((s) => {
      const A = [s * 0.1, headY - 0.02, headZ + 0.03], B = [s * 0.18, 0.72, -0.1], Cc = [s * 0.16, 0.5, 0.15], D = [s * 0.14, 0.82, 0.28], E = [s * 0.18, 0.5, -0.3];
      [[A, B], [B, Cc], [A, E], [E, Cc], [B, D], [Cc, D], [E, B]].forEach(([p, q]) => tube(mb, [p, q], 0.016, K.trellis, LIT, 6));
    });
    inlineEngine(mb, C('#4a4d56'));
    // headers sweeping under the engine
    for (let k = 0; k < 4; k++) {
      const x = -0.09 + k * 0.06;
      tube(mb, [[x, 0.62, -0.38], [x, 0.4, -0.46], [x * 0.6, 0.18, -0.36], [0.06, 0.14, -0.05]], 0.02, K.chrome, LIT, 6, false);
    }
    box(mb, -0.12, 0.1, -0.3, 0.14, 0.2, 0.05, K.dark); // belly pan
    forks(mb, st, K.gold, K.chrome);
    frontFender(mb, st, W, P1, 40, 140);
    rearGear(mb, st, [0, 0.47, 0.15], K.alu);
    frontFenderLike(mb, st.wr, st.rr, 60, 150, 0.04, K.dark, LIT);
    pegs(mb, 0.22, 0.42);
    // wide bars on risers
    const by = headY + 0.07;
    sym((s) => {
      tube(mb, [[s * 0.04, headY + 0.01, headZ + 0.02], [s * 0.04, by, headZ + 0.03]], 0.016, K.black, LIT, 6);
      tube(mb, [[0, by, headZ + 0.03], [s * 0.2, by + 0.01, headZ + 0.06], [s * 0.38, by + 0.03, headZ + 0.1]], 0.015, K.black, LIT, 6);
      tube(mb, [[s * 0.3, by + 0.02, headZ + 0.085], [s * 0.4, by + 0.032, headZ + 0.105]], 0.022, K.rubber, LIT, 8);
    });
    mirrors(mb, (s) => [[s * 0.27, by + 0.02, headZ + 0.08], [s * 0.31, by + 0.15, headZ + 0.05]], K.black, LIT);
    // stubby side exhaust
    tube(mb, [[0.06, 0.14, -0.05], [0.16, 0.25, 0.22]], 0.034, K.chrome, LIT, 8, false);
    tube(mb, [[0.16, 0.26, 0.22], [0.2, 0.36, 0.52]], [0.07, 0.06], K.dark, LIT, 12);
  }

  /* ============================================================
     Supermoto
     ============================================================ */
  function motoBike(mb, st) {
    const { headZ, headY } = st;
    // front number plate with a small light
    mb.quad([-0.12, headY - 0.34, headZ - 0.16], [0.12, headY - 0.34, headZ - 0.16], [0.13, headY + 0.02, headZ - 0.08], [-0.13, headY + 0.02, headZ - 0.08], K.white, LIT);
    mb.text(st.num, [-0.035, headY - 0.03, headZ - 0.1], [1, 0, 0], [0, -0.97, -0.22], 0.03, K.black, LIT, 'left');
    ball(mb, [0, headY - 0.26, headZ - 0.17], 0.045, 0.035, 0.02, 8, 5, (x, y, z, d) => [d[2] < -0.3 ? K.head : K.black, d[2] < -0.3 ? MAT.HEAD : LIT]);
    // high "beak" fender under the bars
    const pts = [];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      pts.push([0, headY - 0.36 + Math.sin(t * Math.PI) * 0.05 - t * 0.02, headZ - 0.3 + t * 0.62]);
    }
    sweep(mb, pts, 0.08, 0.012, W, P1, 8);
    tank(mb, st, 'moto');
    // radiator shrouds
    sym((s) => {
      mb.quad([s * 0.15, 0.6, -0.5], [s * 0.21, 0.66, -0.26], [s * 0.18, 0.98, -0.16], [s * 0.14, 1.02, -0.44], W, P2);
      mb.quad([s * 0.15, 0.6, -0.5], [s * 0.14, 1.02, -0.44], [s * 0.1, 1.02, -0.44], [s * 0.1, 0.62, -0.5], W, P2);
    });
    // long flat seat
    part(mb, {
      z0: -0.24, z1: 0.56, S: 10, R: 16, top: [[-0.24, st.seatY - 0.02], [0.0, st.seatY], [0.56, st.seatY + 0.01]], bot: 0.9,
      hw: [[-0.24, 0.1], [0.1, 0.12], [0.56, 0.1]], n: 4, color: () => [K.seat, LIT], capA: [K.seat, LIT], capB: [K.seat, LIT],
    });
    // number side panels + rear fender
    sym((s) => {
      mb.quad([s * 0.125, 0.68, 0.16], [s * 0.125, 0.7, 0.52], [s * 0.12, 0.92, 0.58], [s * 0.12, 0.92, 0.12], K.white, LIT);
      mb.text(st.num, [s * 0.128, 0.88, s < 0 ? 0.29 : 0.4], [0, 0, s < 0 ? 1 : -1], [0, -1, 0], 0.028, K.black, LIT, 'left');
    });
    part(mb, {
      z0: 0.3, z1: 1.0, S: 14, R: 18, top: [[0.3, 0.95], [0.7, 1.0], [1.0, 1.04]], bot: [[0.3, 0.86], [0.7, 0.95], [1.0, 1.02]],
      hw: [[0.3, 0.11], [0.7, 0.1], [1.0, 0.07]], n: 3, color: () => [W, P1],
      capB: (x) => [Math.abs(x) < 0.03 ? K.red : K.dark, Math.abs(x) < 0.03 ? MAT.BRAKE : LIT],
    });
    // single-cylinder engine + skid plate + frame
    box(mb, -0.12, 0.2, -0.3, 0.12, 0.5, 0.08, K.engine);
    box(mb, -0.09, 0.5, -0.3, 0.09, 0.74, -0.08, C('#3b3e46'));
    for (let k = 0; k < 5; k++) box(mb, -0.1, 0.52 + k * 0.04, -0.3, 0.1, 0.535 + k * 0.04, -0.09, K.metal);
    mb.quad([-0.13, 0.16, -0.36], [0.13, 0.16, -0.36], [0.13, 0.13, 0.1], [-0.13, 0.13, 0.1], K.alu, LIT);
    sym((s) => {
      tube(mb, [[s * 0.06, headY - 0.02, headZ + 0.03], [s * 0.1, 0.78, -0.1], [s * 0.12, 0.44, 0.12]], 0.02, K.trellis, LIT, 6);
      tube(mb, [[s * 0.08, headY - 0.1, headZ + 0.04], [s * 0.09, 0.3, -0.36], [s * 0.1, 0.18, -0.1]], 0.018, K.trellis, LIT, 6);
    });
    forks(mb, st, K.dark, C('#d7c060'), 0.036, 0.03);
    rearGear(mb, st, [0, 0.46, 0.1], K.alu);
    pegs(mb, 0.18, 0.44);
    // wide bars with hand guards
    const by = headY + 0.08;
    sym((s) => {
      tube(mb, [[0, by, headZ + 0.02], [s * 0.2, by + 0.01, headZ + 0.05], [s * 0.4, by + 0.03, headZ + 0.08]], 0.015, K.alu, LIT, 6);
      tube(mb, [[s * 0.31, by + 0.02, headZ + 0.07], [s * 0.41, by + 0.032, headZ + 0.085]], 0.022, K.rubber, LIT, 8);
      mb.quad([s * 0.3, by - 0.03, headZ - 0.0], [s * 0.42, by - 0.02, headZ + 0.03], [s * 0.42, by + 0.08, headZ + 0.05], [s * 0.3, by + 0.07, headZ + 0.02], W, P2);
    });
    // upswept silencer
    tube(mb, [[0.06, 0.62, -0.32], [0.12, 0.34, -0.3], [0.14, 0.4, 0.1], [0.16, 0.66, 0.28]], 0.026, C('#8a7a6a'), LIT, 8, false);
    tube(mb, [[0.16, 0.66, 0.28], [0.17, 0.86, 0.7]], [0.058, 0.05], K.alu, LIT, 12);
    tube(mb, [[0.17, 0.86, 0.7], [0.172, 0.87, 0.73]], [0.05, 0.025], K.black, LIT, 12);
  }

  /* ============================================================
     V-twin cruiser
     ============================================================ */
  function cruiserBike(mb, st) {
    const { headZ, headY, wf, wr, rf, rr } = st;
    // big chrome headlight nacelle
    part(mb, {
      z0: headZ - 0.32, z1: headZ - 0.12, S: 8, R: 22, top: headY + 0.06, bot: headY - 0.18,
      hw: [[headZ - 0.32, 0.12], [headZ - 0.12, 0.09]], n: 2, color: () => [K.chrome, LIT],
      capA: (x, y) => (Math.hypot(x, y - (headY - 0.06)) < 0.1 ? [K.head, MAT.HEAD] : [K.chrome, LIT]),
    });
    sym((s) => ball(mb, [s * 0.2, headY - 0.14, headZ - 0.14], 0.035, 0.03, 0.04, 8, 5, () => [K.amber, MAT.EMIT]));
    tank(mb, st, 'cruiser');
    // deep valanced fenders
    frontFender(mb, st, W, P1, 20, 150, 0.03);
    frontFenderLike(mb, wr, rr, 0, 165, 0.035, W, P1);
    mb.quad([-0.05, rr + 0.33, wr + 0.18], [0.05, rr + 0.33, wr + 0.18], [0.05, rr + 0.37, wr + 0.14], [-0.05, rr + 0.37, wr + 0.14], K.red, MAT.BRAKE);
    // stepped seat with pillion
    part(mb, {
      z0: 0.0, z1: 0.62, S: 12, R: 18, top: [[0.0, 0.8], [0.2, st.seatY], [0.36, st.seatY + 0.01], [0.46, 0.86], [0.62, 0.88]], bot: 0.68,
      hw: [[0.0, 0.1], [0.22, 0.19], [0.4, 0.17], [0.62, 0.12]], n: 3.2, color: () => [C('#2a1a12'), LIT], capA: [C('#2a1a12'), LIT], capB: [C('#2a1a12'), LIT],
    });
    // V-twin with finned chrome cylinders and a crankcase
    box(mb, -0.13, 0.2, -0.3, 0.13, 0.46, 0.2, C('#44464e'));
    for (const [z0, z1] of [[-0.12, -0.36], [0.06, 0.28]]) {
      for (let k = 0; k < 7; k++) {
        const t = k / 7, p = [0, 0.44 + t * 0.34, M.lerp(z0, z1, t)];
        tube(mb, [M.add(p, [-0.1, 0, 0]), M.add(p, [0.1, 0, 0])], 0.1 - (k % 2) * 0.02, k % 2 ? C('#8e939c') : K.chrome, LIT, 10);
      }
    }
    tube(mb, [[0.13, 0.62, -0.02], [0.2, 0.62, -0.02]], 0.12, W, P2, 14); // air cleaner
    // chrome frame tubes
    tube(mb, [[0, headY - 0.02, headZ + 0.03], [0, 0.9, -0.1], [0, 0.84, 0.4]], 0.03, K.black, LIT, 6);
    tube(mb, [[0, headY - 0.1, headZ + 0.04], [0, 0.3, -0.34], [0, 0.18, 0.0], [0, 0.3, 0.4]], 0.03, K.black, LIT, 6);
    // forks with painted shrouds
    sym((s) => {
      const bot = [s * 0.11, rf, wf], top = [s * 0.11, headY + 0.04, headZ];
      tube(mb, [bot, top], 0.032, K.chrome, LIT, 10);
      tube(mb, [M.add(top, M.mul(M.sub(bot, top), 0.35)), top], 0.048, W, P1, 10);
    });
    box(mb, -0.15, headY - 0.03, headZ - 0.04, 0.15, headY + 0.03, headZ + 0.06, K.chrome);
    rearGear(mb, st, [0, 0.4, 0.28], K.chrome);
    // forward controls
    sym((s) => tube(mb, [[s * 0.12, 0.34, wf + 0.46], [s * 0.26, 0.34, wf + 0.46]], 0.018, K.chrome, LIT, 6));
    // pull-back bars
    sym((s) => {
      tube(mb, [[s * 0.06, headY + 0.03, headZ + 0.02], [s * 0.12, headY + 0.2, headZ + 0.05], [s * 0.3, headY + 0.2, headZ + 0.16], [s * 0.44, headY + 0.14, headZ + 0.28]], 0.017, K.chrome, LIT, 6);
      tube(mb, [[s * 0.36, headY + 0.16, headZ + 0.22], [s * 0.45, headY + 0.135, headZ + 0.29]], 0.024, K.rubber, LIT, 8);
    });
    mirrors(mb, (s) => [[s * 0.28, headY + 0.2, headZ + 0.14], [s * 0.34, headY + 0.34, headZ + 0.12]], K.chrome, LIT);
    // twin shotgun pipes
    for (const [y0, y1] of [[0.3, 0.34], [0.42, 0.46]]) {
      tube(mb, [[0.1, 0.56, -0.3], [0.16, y0 + 0.02, -0.2], [0.18, y0, 0.3], [0.19, y1, 1.0]], [0.035, 0.038, 0.045, 0.05], K.chrome, LIT, 10);
    }
  }

  /* ============================================================
     Rider in leathers: helmet + visor, humped back, gloves, boots
     ============================================================ */
  const POSES = {
    //        hip [y,z]    chest       neck          head          hand [x,y,z]         knee [x,y,z]          foot [x,y,z]
    tuck: { hip: [0.96, 0.3], chest: [1.12, 0.04], neck: [1.24, -0.14], head: [1.34, -0.23], hand: [0.28, 0.875, -0.335], knee: [0.23, 0.8, -0.1], foot: [0.2, 0.44, 0.22] },
    tuckLow: { hip: [0.95, 0.3], chest: [1.08, 0.04], neck: [1.19, -0.15], head: [1.29, -0.25], hand: [0.28, 0.855, -0.335], knee: [0.23, 0.78, -0.1], foot: [0.2, 0.44, 0.22] },
    mid: { hip: [0.94, 0.28], chest: [1.19, 0.13], neck: [1.37, 0.03], head: [1.5, -0.04], hand: [0.37, 1.055, -0.32], knee: [0.23, 0.84, -0.12], foot: [0.2, 0.44, 0.2] },
    moto: { hip: [1.07, 0.2], chest: [1.33, 0.06], neck: [1.51, -0.03], head: [1.64, -0.11], hand: [0.37, 1.165, -0.37], knee: [0.2, 0.93, -0.2], foot: [0.2, 0.46, 0.16] },
    upright: { hip: [0.82, 0.3], chest: [1.1, 0.28], neck: [1.32, 0.24], head: [1.46, 0.2], hand: [0.42, 1.15, -0.2], knee: [0.26, 0.88, -0.3], foot: [0.25, 0.36, -0.44] },
  };

  function buildRider(poseId) {
    const ps = POSES[poseId];
    const mb = new MB();
    const hip = [0, ps.hip[0], ps.hip[1]], chest = [0, ps.chest[0], ps.chest[1]], neck = [0, ps.neck[0], ps.neck[1]], head = [0, ps.head[0], ps.head[1]];
    // torso: spine loft pelvis → chest → hump → neck; livery-coloured leathers with white side panels
    const spine = [
      { c: M.add(hip, [0, -0.06, 0.05]), w: 0.15, d: 0.1 },
      { c: hip, w: 0.165, d: 0.12 },
      { c: M.add(M.mul(M.add(hip, chest), 0.5), [0, 0, 0]), w: 0.16, d: 0.12 },
      { c: chest, w: 0.185, d: 0.135 },
      { c: M.add(chest, M.mul(M.sub(neck, chest), 0.55)), w: 0.2, d: 0.125 },
      { c: neck, w: 0.15, d: 0.09 },
      { c: M.add(neck, [0, 0.05, -0.03]), w: 0.065, d: 0.065 },
    ];
    const rings = spine.map((p, k) => {
      const dir = M.norm(M.sub(spine[Math.min(spine.length - 1, k + 1)].c, spine[Math.max(0, k - 1)].c));
      const v = M.norm(M.cross(dir, [1, 0, 0])), ring = [];
      for (let i = 0; i < 16; i++) {
        const t = (i / 16) * Math.PI * 2;
        ring.push(M.add(p.c, M.add([Math.cos(t) * p.w, 0, 0], M.mul(v, Math.sin(t) * p.d))));
      }
      return ring;
    });
    grid(mb, rings, true, (s, r, c) => {
      if (Math.abs(c[0]) > 0.13 && s >= 1 && s <= 4) return [K.white, LIT];
      if (s === 0) return [K.dark, LIT];
      return [W, P1];
    });
    // back protector hump
    ball(mb, M.add(M.mul(M.add(chest, neck), 0.5), M.mul(M.norm(M.cross(M.sub(neck, chest), [1, 0, 0])), -0.1)), 0.11, 0.07, 0.14, 10, 6, () => [W, P2]);
    // helmet with visor and stripe
    const hr = 0.148;
    ball(mb, head, hr * 0.95, hr, hr * 1.1, 18, 12, (x, y, z, d) => {
      const front = -d[2];
      if (front > 0.45 && d[1] > -0.2 && d[1] < 0.42) return front > 0.8 && d[1] > 0.18 ? [K.visorHi, MAT.EMIT] : [K.visor, LIT];
      if (d[1] < -0.62) return [K.dark, LIT];
      if (Math.abs(d[0]) < 0.14 && d[1] > 0.3) return [W, P2];
      return [W, P1];
    });
    // arms and legs
    sym((s) => {
      const sh = M.add(neck, [s * 0.17, -0.07, 0.07]);
      const hand = [s * ps.hand[0], ps.hand[1], ps.hand[2]];
      const elbow = M.add(M.mul(M.add(sh, hand), 0.5), [s * 0.07, -0.05, 0.05]);
      ball(mb, sh, 0.075, 0.07, 0.075, 10, 6, () => [W, P2]);
      tube(mb, [sh, elbow], [0.064, 0.056], W, P1, 10);
      ball(mb, elbow, 0.056, 0.056, 0.056, 8, 5, () => [W, P2]);
      tube(mb, [elbow, hand], [0.055, 0.045], W, P2, 10);
      ball(mb, hand, 0.046, 0.042, 0.058, 8, 5, () => [K.black, LIT]);
      const hp = M.add(hip, [s * 0.1, -0.03, 0.0]);
      const knee = [s * ps.knee[0], ps.knee[1], ps.knee[2]];
      const foot = [s * ps.foot[0], ps.foot[1], ps.foot[2]];
      tube(mb, [hp, knee], [0.092, 0.068], W, P2, 10);
      ball(mb, knee, 0.07, 0.07, 0.07, 8, 5, () => [W, P1]);
      ball(mb, M.add(knee, [s * 0.05, -0.015, 0]), 0.03, 0.04, 0.045, 6, 4, () => [K.white, LIT]); // knee slider
      tube(mb, [knee, foot], [0.068, 0.052], W, P2, 10);
      // boot
      const toe = M.add(foot, [0, -0.02, -0.14]);
      tube(mb, [M.add(foot, [0, 0.1, 0.04]), M.add(foot, [0, -0.02, 0.02]), toe], [0.058, 0.05, 0.035], (x, y) => [y < foot[1] - 0.02 ? K.black : K.white, LIT], LIT, 8);
    });
    return mb;
  }

  /* ---------- small shared meshes ---------- */
  function buildShadow() {
    const mb = new MB();
    const pts = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      pts.push([Math.cos(a) * 0.4, 0.035, Math.sin(a) * 1.12]);
    }
    mb.poly(pts, [0, 0, 0], MAT.EMIT);
    return mb;
  }
  function buildPuff(mat) {
    const mb = new MB();
    mb.ball(0, 0, 0, 0.5, 0.5, 0.5, 6, 4, W, mat);
    return mb;
  }
  function buildFlame() {
    const mb = new MB();
    tube(mb, [[0, 0, 0], [0, 0, 0.25], [0, 0, 0.55]], [0.06, 0.045, 0.004], W, MAT.EPAINT, 6);
    return mb;
  }

  /* ---------- builders + cache ---------- */
  function buildBike(styleId) {
    const st = STYLES[styleId], mb = new MB();
    if (styleId === 'naked') nakedBike(mb, st);
    else if (styleId === 'moto') motoBike(mb, st);
    else if (styleId === 'cruiser') cruiserBike(mb, st);
    else sportBike(mb, st);
    return mb;
  }

  const cache = {};
  SR.Bikes = {
    STYLES,
    POSES,
    get(styleId) {
      if (cache[styleId]) return cache[styleId];
      const st = STYLES[styleId];
      const m = {
        style: st,
        body: buildBike(styleId).build(),
        rider: buildRider(st.pose).build(),
        wheelF: buildWheel(st.rf, st.tf, st.rim, true).build(),
        wheelR: buildWheel(st.rr, st.tr, st.rim, false).build(),
      };
      cache[styleId] = m;
      return m;
    },
    shared() {
      if (cache._shared) return cache._shared;
      cache._shared = {
        shadow: buildShadow().build(),
        puff: buildPuff(MAT.PAINT).build(),
        glow: buildPuff(MAT.EPAINT).build(),
        flame: buildFlame().build(),
      };
      return cache._shared;
    },
    helpers: { Curve, grid, part, tube, ball, revolve, sweep, cap },
  };
})(window.SR);
