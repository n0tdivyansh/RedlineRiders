'use strict';
/* ============================================================
   Track generator: closed spline loop with hills, road markings,
   rumble strips, terrain, guard rails / walls, scenery, sky dome
   and the lighting environment for the chosen time and weather.
   Track coordinates: s = distance along the centre line (m),
   x = lateral offset (m, + = right).
   ============================================================ */
(function (SR) {
  const M = SR.M, MAT = SR.MAT, C = M.rgb, TAU = M.TAU;
  const L = MAT.LIT, G = MAT.GRAIN, E = MAT.EMIT, SKY = MAT.SKY;
  const Track = (SR.Track = {});
  const DS = (Track.DS = 4);      // sample spacing (m)
  const RW = (Track.RW = 7);      // road half width (m)
  const LIMIT = (Track.LIMIT = RW + 6.6); // rail / wall position (m)
  const CHUNK = 24;               // samples per render chunk

  /* ---------- centripetal Catmull-Rom ---------- */
  function catmull(p0, p1, p2, p3, n, out) {
    const d = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5) || 1e-4;
    const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
    for (let k = 0; k < n; k++) {
      const t = t1 + ((t2 - t1) * k) / n;
      const A = (pa, pb, ta, tb) => [((tb - t) * pa[0] + (t - ta) * pb[0]) / (tb - ta), ((tb - t) * pa[1] + (t - ta) * pb[1]) / (tb - ta)];
      const A1 = A(p0, p1, t0, t1), A2 = A(p1, p2, t1, t2), A3 = A(p2, p3, t2, t3);
      const B1 = A(A1, A2, t0, t2), B2 = A(A2, A3, t1, t3);
      out.push(A(B1, B2, t1, t2));
    }
  }

  /* ---------- environment (lighting, fog, sky colours) ---------- */
  Track.env = function (def) {
    const tm = SR.TIMES[def.time], wx = SR.WEATHER[def.weather];
    const wet = def.weather !== 'clear';
    const grey = (c) => { const g = (c[0] + c[1] + c[2]) / 3; return [g, g, g]; };
    let fog = tm.skyHor.slice();
    if (wet) fog = M.mix(fog, M.mul(grey(fog), def.weather === 'snow' ? 1.15 : 0.9), def.weather === 'fog' ? 0.75 : 0.55);
    const az = 0.9 + (def.seed % 7) * 0.7;
    const el = Math.max(0.16, tm.sunY);
    const sunDir = M.norm([Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)]);
    const dim = wet ? 0.72 : 1;
    const far = 640 * wx.fog * (tm.night ? 0.85 : 1);
    return {
      sunDir, az, sunEl: tm.sunY,
      sunCol: M.mul(tm.sunCol, tm.sunI * dim),
      skyAmb: M.mul(tm.amb, wet ? 0.95 : 0.85),
      gndAmb: M.mul(tm.gnd, 0.8),
      fogCol: fog, fogNear: far * 0.18, fogFar: far,
      skyTop: wet ? M.mix(tm.skyTop, grey(tm.skyTop), 0.6) : tm.skyTop,
      night: !!tm.night, headOn: !!tm.night || def.time === 'dusk' || def.weather === 'fog',
      stars: wet ? 0 : tm.stars, time: tm, weather: def.weather,
    };
  };

  /* ============================================================
     Build
     ============================================================ */
  Track.build = function (def, opts) {
    opts = opts || {};
    const rng = M.rng(def.seed * 7919 + 13);
    const theme = SR.THEMES[def.theme];
    const env = Track.env(def);

    /* --- centre line: star-shaped loop with a straight through the start --- */
    const K = Math.round(9 + def.curvy * 7);
    const R0 = (def.len / TAU) * 0.9;
    const amp = 0.16 + def.curvy * 0.24;
    const dir = rng() < 0.5 ? 1 : -1;
    const d = TAU / K;
    const ctrl = [];
    for (let i = 0; i < K; i++) {
      let a = i * d, r;
      if (i === 0) r = R0;
      else if (i === 1 || i === K - 1) r = R0 / Math.cos(d);
      else { a += rng.range(-0.28, 0.28) * d; r = R0 * (1 + rng.range(-amp, amp)); }
      ctrl.push([Math.cos(a) * r, Math.sin(a) * r * dir]);
    }
    let poly = [];
    for (let i = 0; i < K; i++) catmull(ctrl[(i - 1 + K) % K], ctrl[i], ctrl[(i + 1) % K], ctrl[(i + 2) % K], 60, poly);
    let raw = 0;
    const cum = [0];
    for (let i = 1; i <= poly.length; i++) {
      const a = poly[i - 1], b = poly[i % poly.length];
      raw += Math.hypot(b[0] - a[0], b[1] - a[1]);
      cum.push(raw);
    }
    const scale = def.len / raw;
    const N = Math.round(def.len / DS), Ltot = N * DS;
    const px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
    let j = 0;
    for (let i = 0; i < N; i++) {
      const target = (i / N) * raw;
      while (cum[j + 1] < target) j++;
      const t = (target - cum[j]) / (cum[j + 1] - cum[j] || 1);
      const a = poly[j], b = poly[(j + 1) % poly.length];
      px[i] = (a[0] + (b[0] - a[0]) * t) * scale;
      pz[i] = (a[1] + (b[1] - a[1]) * t) * scale;
    }
    // hills: periodic sum of sines, flattened around the start/finish
    const hs = def.hills;
    const A = [18 * hs, 8 * hs, 4 * hs], ph = [rng() * TAU, rng() * TAU, rng() * TAU];
    for (let i = 0; i < N; i++) {
      const u = i / N;
      let h = 0;
      for (let k = 0; k < 3; k++) h += A[k] * Math.sin(TAU * (k + 1) * u + ph[k]);
      const edge = Math.min(u, 1 - u);
      py[i] = h * M.smooth(M.clamp((edge - 0.02) / 0.08, 0, 1));
    }
    // subtract the start height so s = 0 is at y ≈ 0
    const y0 = py[0];
    for (let i = 0; i < N; i++) py[i] -= y0 * M.smooth(M.clamp(1 - Math.min(i, N - i) / (N * 0.1), 0, 1));

    const yaw = new Float32Array(N), rx = new Float32Array(N), rz = new Float32Array(N);
    const curv = new Float32Array(N), slope = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      const tx = px[b] - px[a], tz = pz[b] - pz[a];
      yaw[i] = Math.atan2(-tx, -tz);
      rx[i] = Math.cos(yaw[i]);
      rz[i] = -Math.sin(yaw[i]);
      slope[i] = (py[b] - py[a]) / (2 * DS);
    }
    const craw = new Float32Array(N);
    for (let i = 0; i < N; i++) craw[i] = -M.angDiff(yaw[(i - 1 + N) % N], yaw[(i + 1) % N]) / (2 * DS);
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let k = -3; k <= 3; k++) s += craw[(i + k + N) % N];
      curv[i] = s / 7;
    }
    let minY = Infinity, maxY = -Infinity, cx = 0, cz = 0;
    for (let i = 0; i < N; i++) { minY = Math.min(minY, py[i]); maxY = Math.max(maxY, py[i]); cx += px[i] / N; cz += pz[i] / N; }
    const base = minY - (theme.water ? 2.5 : 4);

    const T = {
      def, theme, env, N, L: Ltot, DS, RW, LIMIT, px, py, pz, yaw, rx, rz, curv, slope, base, walls: !!theme.walls,
      center: [cx, 0, cz],
    };

    /* --- queries (hot path) --- */
    const idx = { i: 0, j: 0, t: 0 };
    const locate = (s) => {
      s = ((s % Ltot) + Ltot) % Ltot;
      const f = s / DS, i = Math.floor(f) % N;
      idx.i = i; idx.j = (i + 1) % N; idx.t = f - Math.floor(f);
      return idx;
    };
    T.pos = (s, x, out) => {
      const { i, j, t } = locate(s);
      const X = px[i] + (px[j] - px[i]) * t, Y = py[i] + (py[j] - py[i]) * t, Z = pz[i] + (pz[j] - pz[i]) * t;
      const RX = rx[i] + (rx[j] - rx[i]) * t, RZ = rz[i] + (rz[j] - rz[i]) * t;
      out = out || [0, 0, 0];
      out[0] = X + RX * x; out[1] = Y; out[2] = Z + RZ * x;
      return out;
    };
    T.yawAt = (s) => { const { i, j, t } = locate(s); return yaw[i] + M.angDiff(yaw[i], yaw[j]) * t; };
    T.curvAt = (s) => { const { i, j, t } = locate(s); return curv[i] + (curv[j] - curv[i]) * t; };
    T.slopeAt = (s) => { const { i, j, t } = locate(s); return slope[i] + (slope[j] - slope[i]) * t; };
    T.heightAt = (s) => { const { i, j, t } = locate(s); return py[i] + (py[j] - py[i]) * t; };

    buildGeometry(T, rng, opts);
    T.sky = buildSky(T, M.rng(def.seed * 31 + 7));
    // minimap outline
    let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
    for (let i = 0; i < N; i++) { mnx = Math.min(mnx, px[i]); mxx = Math.max(mxx, px[i]); mnz = Math.min(mnz, pz[i]); mxz = Math.max(mxz, pz[i]); }
    const span = Math.max(mxx - mnx, mxz - mnz);
    T.map = { mnx, mnz, span, w: (mxx - mnx) / span, h: (mxz - mnz) / span, pts: [] };
    for (let i = 0; i < N; i += 3) T.map.pts.push([(px[i] - mnx) / span, (pz[i] - mnz) / span]);
    T.mapXY = (s) => { const p = T.pos(s, 0); return [(p[0] - mnx) / span, (p[2] - mnz) / span]; };
    return T;
  };

  /* ============================================================
     World geometry (chunked for culling)
     ============================================================ */
  function buildGeometry(T, rng, opts) {
    const { N, px, py, pz, rx, rz, yaw, curv, theme, env, base } = T;
    const P = (i, x, dy) => [px[i] + rx[i] * x, py[i] + (dy || 0), pz[i] + rz[i] * x];
    const wet = env.weather === 'rain';
    const asphalt = [C(wet ? '#3a3b42' : '#4b4c54'), C(wet ? '#36373e' : '#46474f')];
    const grass = theme.grass.map(C), shoulder = C(theme.shoulder);
    const white = C('#e6e6de'), red = C('#d8262a'), rail = C('#aab0ba'), post = C('#6a6e78'), concrete = C('#b4b2aa');
    const night = env.night;
    const propOpts = { rng, night, snowy: !!theme.snowy };
    const farOff = RW + 150;
    const terrainY = (i, off) => {
      const a = Math.abs(off);
      if (a <= RW + 9) return py[i] - 0.03;
      const t = M.clamp((a - (RW + 9)) / (farOff - RW - 9), 0, 1);
      return M.lerp(py[i] - 0.03, base - (theme.water ? 1.2 : 0), M.smooth(t));
    };

    // weighted prop picker
    const props = theme.props.filter((p) => p[1] > 0), wsum = props.reduce((a, p) => a + p[1], 0);
    const pick = () => { let r = rng() * wsum; for (const p of props) { if ((r -= p[1]) <= 0) return p[0]; } return props[0][0]; };
    const lamps = theme.city || night || theme.fuji;
    const chunks = [];
    const MB = SR.GL.MB;

    for (let c0 = 0; c0 < N; c0 += CHUNK) {
      const mb = new MB();
      const c1 = Math.min(N, c0 + CHUNK);
      for (let i = c0; i < c1; i++) {
        const b = (i + 1) % N;
        const band = Math.floor(i / 3) % 2;
        // road
        mb.quad(P(i, -RW), P(i, RW), P(b, RW), P(b, -RW), asphalt[band], G);
        // lane dashes and edge lines
        if (i % 6 < 3) for (const lx of [-RW / 3, RW / 3]) mb.quad(P(i, lx - 0.09, 0.02), P(i, lx + 0.09, 0.02), P(b, lx + 0.09, 0.02), P(b, lx - 0.09, 0.02), white, L);
        for (const s of [-1, 1]) {
          const e0 = s * (RW - 0.45), e1 = s * (RW - 0.25);
          mb.quad(P(i, e0, 0.02), P(i, e1, 0.02), P(b, e1, 0.02), P(b, e0, 0.02), white, L);
          // rumble strip
          const k = Math.floor(i / 2) % 2;
          mb.quad(P(i, s * RW, 0.03), P(i, s * (RW + 1.1), 0.03), P(b, s * (RW + 1.1), 0.03), P(b, s * RW, 0.03), k ? red : white, L);
          // shoulder + run-off, then terrain falling to the base level
          const g = grass[band];
          mb.quad(P(i, s * (RW + 1.1), -0.02), P(i, s * (RW + 9), -0.03), P(b, s * (RW + 9), -0.03), P(b, s * (RW + 1.1), -0.02), s * band > 0 ? shoulder : M.mul(shoulder, 0.94), G);
          const offs = [RW + 9, RW + 40, RW + 90, farOff];
          for (let q = 0; q < offs.length - 1; q++) {
            const o0 = offs[q], o1 = offs[q + 1];
            const ya0 = terrainY(i, o0), ya1 = terrainY(i, o1), yb0 = terrainY(b, o0), yb1 = terrainY(b, o1);
            const pa0 = P(i, s * o0), pa1 = P(i, s * o1), pb0 = P(b, s * o0), pb1 = P(b, s * o1);
            pa0[1] = ya0; pa1[1] = ya1; pb0[1] = yb0; pb1[1] = yb1;
            mb.quad(pa0, pa1, pb1, pb0, g, G);
          }
          // boundary: concrete wall (city themes) or steel guard rail
          if (T.walls) {
            const w0 = s * LIMIT, w1 = s * (LIMIT + 0.5);
            const cc = Math.floor(i / 4) % 2 ? concrete : M.mul(concrete, 0.9);
            mb.quad(P(i, w0, 0), P(b, w0, 0), P(b, w0, 1.1), P(i, w0, 1.1), cc, L);
            mb.quad(P(i, w0, 1.1), P(b, w0, 1.1), P(b, w1, 1.1), P(i, w1, 1.1), M.mul(cc, 1.08), L);
            mb.quad(P(i, w0, 0.9), P(b, w0, 0.9), P(b, w0, 1.1), P(i, w0, 1.1), Math.floor(i / 2) % 2 ? red : white, L);
          } else {
            const w0 = s * LIMIT;
            mb.quad(P(i, w0, 0.45), P(b, w0, 0.45), P(b, w0, 0.78), P(i, w0, 0.78), rail, L);
            if (i % 2 === 0) {
              const q = P(i, s * (LIMIT + 0.12));
              mb.box(q[0] - 0.07, q[1], q[2] - 0.07, q[0] + 0.07, q[1] + 0.75, q[2] + 0.07, post, L);
            }
          }
        }
        // start line + grid boxes
        if (i === 0) {
          const n = 16;
          for (let r = 0; r < 2; r++)
            for (let k = 0; k < n; k++) {
              const x0 = -RW + (2 * RW * k) / n, x1 = x0 + (2 * RW) / n, z0 = r * 0.8, z1 = z0 + 0.8;
              const q = (x, z) => { const p = P(0, x, 0.025); const fx = -Math.sin(yaw[0]), fz = -Math.cos(yaw[0]); return [p[0] + fx * z, p[1], p[2] + fz * z]; };
              mb.quad(q(x0, z0), q(x1, z0), q(x1, z1), q(x0, z1), (k + r) % 2 ? white : C('#141418'), L);
            }
        }
        // chevrons on the outside of tight turns
        if (Math.abs(curv[i]) > 1 / 160 && i % 5 === 0) {
          const side = curv[i] > 0 ? -1 : 1, p = P(i, side * (LIMIT + 0.9));
          mb.at(p[0], p[1], p[2], yaw[i], 1, side < 0);
          SR.Props.chevron(mb, propOpts, Math.sign(curv[i]) * side);
          mb.reset();
        }
        // street lamps
        if (lamps && i % 12 === 6) {
          for (const s of [-1, 1]) {
            const p = P(i, s * (LIMIT + 1.2));
            mb.at(p[0], p[1], p[2], yaw[i], 1, s < 0);
            SR.Props.lamp(mb, propOpts);
            mb.reset();
          }
        }
        // scenery
        const dens = theme.density * 0.32;
        for (const s of [-1, 1]) {
          if (i < 8 || i > N - 30) continue; // keep the start area clear for stands
          if (rng() > dens) continue;
          const kind = pick();
          let off = LIMIT + 3 + rng() * 26;
          if (kind === 'building' || kind === 'townhouse') off = LIMIT + 4 + rng() * 10;
          if (kind === 'mesa') off = LIMIT + 70 + rng() * 60;
          if (kind === 'windmill' || kind === 'pagoda' || kind === 'chalet') off = LIMIT + 14 + rng() * 20;
          // avoid putting big props on the inside of a tight turn (they would sit on the road)
          if (Math.abs(curv[i]) > 1 / (off + 40) && Math.sign(curv[i]) === s) continue;
          const p = P(i, s * off);
          p[1] = terrainY(i, off);
          mb.at(p[0], p[1], p[2], yaw[i], 1, s < 0);
          SR.Props[kind](mb, propOpts);
          mb.reset();
        }
      }
      // start gantry + grandstands
      if (c0 === 0) {
        const p = P(2, 0);
        mb.at(p[0], p[1], p[2], yaw[2], 1, false);
        SR.Props.gantry(mb, propOpts, RW);
        mb.reset();
      }
      if (c0 <= N - 22 && c1 > N - 22) {
        const i = N - 22, p = P(i, -(LIMIT + 3));
        mb.at(p[0], p[1], p[2], yaw[i], 1, true);
        SR.Props.grandstand(mb, propOpts, 70);
        mb.reset();
      }
      const mid = Math.min(N - 1, Math.floor((c0 + c1) / 2));
      const mesh = mb.build();
      mesh.cs = [px[mid], py[mid], pz[mid]];
      chunks.push(mesh);
    }
    T.chunks = chunks;

    // ground plane out to the horizon
    const gp = new MB();
    const S = 5000, gcol = C(theme.ground);
    gp.quad([T.center[0] - S, base, T.center[2] - S], [T.center[0] + S, base, T.center[2] - S], [T.center[0] + S, base, T.center[2] + S], [T.center[0] - S, base, T.center[2] + S], gcol, theme.water ? L : G);
    T.ground = gp.build();
  }

  /* ============================================================
     Sky dome (drawn around the camera, unlit, no fog)
     ============================================================ */
  function buildSky(T, rng) {
    const env = T.env, theme = T.theme, def = T.def;
    const mb = new SR.GL.MB();
    const R = 900, top = env.skyTop, hor = env.fogCol;
    const skyAt = (el) => (el <= 0 ? hor : M.mix(hor, top, Math.pow(Math.min(1, el / (Math.PI / 2)), 0.55)));
    const segs = 24, rings = [-0.3, 0, 0.06, 0.16, 0.32, 0.55, 0.9, 1.3, Math.PI / 2];
    for (let r = 0; r < rings.length - 1; r++)
      for (let k = 0; k < segs; k++) {
        const a0 = (k / segs) * TAU, a1 = ((k + 1) / segs) * TAU, e0 = rings[r], e1 = rings[r + 1];
        const p = (a, e) => [Math.cos(a) * Math.cos(e) * R, Math.sin(e) * R, Math.sin(a) * Math.cos(e) * R];
        const c = skyAt((e0 + e1) / 2);
        mb.quad(p(a0, e0), p(a1, e0), p(a1, e1), p(a0, e1), c, SKY);
      }
    const dirAt = (az, el, dist) => [Math.cos(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.sin(az) * Math.cos(el) * dist];
    const disc = (az, el, dist, rad, col, n) => {
      const c = dirAt(az, el, dist), f = M.norm(c);
      const u = M.norm(M.cross(f, [0, 1, 0])), v = M.cross(u, f);
      const pts = [];
      for (let i = 0; i < n; i++) { const t = (i / n) * TAU; pts.push(M.add(c, M.add(M.mul(u, Math.cos(t) * rad), M.mul(v, Math.sin(t) * rad)))); }
      mb.poly(pts, col, SKY);
    };
    // stars
    if (env.stars > 0) {
      for (let i = 0; i < 260 * env.stars; i++) {
        const az = rng() * TAU, el = 0.12 + Math.pow(rng(), 0.7) * 1.4, b = 0.5 + rng() * 0.5;
        disc(az, el, 860, 1.2 + rng() * 1.6, M.mix(top, [1, 1, 1], b), 4);
      }
    }
    // sun / moon with a stepped halo
    const tm = env.time;
    if (env.weather === 'clear' || env.weather === 'snow') {
      const el = Math.max(0.03, tm.sunY), az = env.az;
      if (env.night) {
        disc(az, 0.5, 840, 26, M.mix(tm.sun, top, 0.3), 16);
        disc(az, 0.5, 830, 18, tm.sun, 16);
      } else {
        const big = tm.sunY < 0.15 ? 1.8 : 1;
        disc(az, el, 850, 95 * big, M.mix(hor, tm.sun, 0.25), 20);
        disc(az, el, 845, 60 * big, M.mix(hor, tm.sun, 0.5), 20);
        disc(az, el, 840, 30 * big, tm.sun, 20);
      }
    }
    // clouds
    if (!env.night && env.weather === 'clear') {
      for (let i = 0; i < 14; i++) {
        const az = rng() * TAU, el = 0.1 + rng() * 0.35, c = dirAt(az, el, 820);
        const col = M.mix(top, [1, 1, 1], tm.sunY < 0.15 ? 0.5 : 0.75);
        const f = M.norm(c), u = M.norm(M.cross(f, [0, 1, 0]));
        for (let k = 0; k < 4; k++) {
          const o = M.add(c, M.mul(u, (k - 1.5) * 38 + rng() * 20));
          mb.ball(o[0], o[1] + rng() * 10, o[2], 40 + rng() * 25, 12 + rng() * 8, 40 + rng() * 25, 6, 3, M.mul(col, 0.94 + k * 0.02), SKY);
        }
      }
    }
    // aurora
    if (env.night && theme.snowy) {
      for (let band = 0; band < 3; band++) {
        const az0 = rng() * TAU, el = 0.35 + band * 0.12;
        for (let k = 0; k < 18; k++) {
          const a0 = az0 + k * 0.09, a1 = a0 + 0.09;
          const w0 = Math.sin(k * 0.8 + band) * 0.05, w1 = Math.sin((k + 1) * 0.8 + band) * 0.05;
          const col = M.mix(C('#30ff90'), C('#a040ff'), (k % 6) / 10 + band * 0.2);
          mb.quad(dirAt(a0, el + w0, 800), dirAt(a1, el + w1, 800), dirAt(a1, el + w1 + 0.12, 800), dirAt(a0, el + w0 + 0.12, 800), M.mix(top, col, 0.55), SKY);
        }
      }
    }
    // distant mountain rings (far haze + nearer darker ring)
    const hill = C(theme.hill);
    const ring = (rad, hmin, hmax, haze, n, snowCap) => {
      let prev = null;
      const hs = [];
      for (let k = 0; k <= n; k++) hs.push(k === n ? hs[0] : hmin + (hmax - hmin) * Math.pow(rng(), 1.3));
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * TAU, a1 = ((k + 1) / n) * TAU;
        const col = M.mix(hill, hor, haze);
        const b0 = [Math.cos(a0) * rad, -40, Math.sin(a0) * rad], b1 = [Math.cos(a1) * rad, -40, Math.sin(a1) * rad];
        const t0 = [b0[0], hs[k], b0[2]], t1 = [b1[0], hs[k + 1], b1[2]];
        mb.quad(b0, b1, t1, t0, M.mul(col, 0.95 + (k % 3) * 0.03), SKY);
        if (snowCap) {
          const cap = M.mix(C('#f2f6fa'), hor, haze * 0.8);
          const lim = hmax * 0.62;
          if (hs[k] > lim && hs[k + 1] > lim) {
            const s0 = [t0[0], lim + (hs[k] - lim) * 0.3, t0[2]], s1 = [t1[0], lim + (hs[k + 1] - lim) * 0.3, t1[2]];
            mb.quad(s0, s1, t1, t0, cap, SKY);
          }
        }
        prev = t1;
      }
      return prev;
    };
    const hh = theme.hillH;
    if (theme.city) {
      // skyline
      for (let k = 0; k < 90; k++) {
        const a = (k / 90) * TAU + rng() * 0.03, rad = 700 + rng() * 60, w = 14 + rng() * 22, h = 20 + rng() * 90;
        const c = [Math.cos(a) * rad, 0, Math.sin(a) * rad], t = [-Math.sin(a), 0, Math.cos(a)];
        const b0 = M.add(c, M.mul(t, -w / 2)), b1 = M.add(c, M.mul(t, w / 2));
        const col = M.mix(C('#3a3e52'), hor, 0.45);
        mb.quad([b0[0], -40, b0[2]], [b1[0], -40, b1[2]], [b1[0], h, b1[2]], [b0[0], h, b0[2]], col, SKY);
        if (env.night) {
          for (let wy = 5; wy < h - 4; wy += 7)
            for (let wx = 0.15; wx < 0.9; wx += 0.25) {
              if (rng() < 0.55) continue;
              const q = M.add(b0, M.mul(t, w * wx)), q2 = M.add(q, M.mul(t, w * 0.1));
              mb.quad([q[0] * 0.995, wy, q[2] * 0.995], [q2[0] * 0.995, wy, q2[2] * 0.995], [q2[0] * 0.995, wy + 2.5, q2[2] * 0.995], [q[0] * 0.995, wy + 2.5, q[2] * 0.995], M.mix(C('#ffd97a'), hor, 0.35), SKY);
            }
        }
      }
      ring(820, 10 * hh, 60 * hh, 0.7, 40, false);
    } else {
      ring(840, 20 * hh, 110 * hh, 0.62, 48, theme.alpine || theme.snowy);
      ring(700, 8 * hh, 55 * hh, 0.35, 40, theme.snowy);
    }
    if (theme.fuji) {
      const a = env.az + 2.2, c = [Math.cos(a) * 780, -40, Math.sin(a) * 780], t = [-Math.sin(a), 0, Math.cos(a)];
      const wv = 260, hv = 190, col = M.mix(C('#4a5a8a'), hor, 0.45), cap = M.mix(C('#ffffff'), hor, 0.25);
      const pk = [c[0], hv, c[2]];
      mb.tri(M.add(c, M.mul(t, -wv)), M.add(c, M.mul(t, wv)), pk, col, SKY);
      const s0 = M.add([c[0], hv * 0.7, c[2]], M.mul(t, -wv * 0.28)), s1 = M.add([c[0], hv * 0.7, c[2]], M.mul(t, wv * 0.28));
      mb.tri([s0[0] * 0.99, s0[1], s0[2] * 0.99], [s1[0] * 0.99, s1[1], s1[2] * 0.99], [pk[0] * 0.99, pk[1], pk[2] * 0.99], cap, SKY);
    }
    return mb.build();
  }
})(window.SR);
