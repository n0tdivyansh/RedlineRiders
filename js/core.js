'use strict';
/* ============================================================
   Core: namespace, math, matrices, colors, formatting, storage
   ============================================================ */
window.SR = {};
(function (SR) {
  const M = (SR.M = {});
  const TAU = (M.TAU = Math.PI * 2);

  M.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  M.lerp = (a, b, t) => a + (b - a) * t;
  M.smooth = (t) => t * t * (3 - 2 * t);
  M.wrap = (v, n) => ((v % n) + n) % n;
  M.approach = (v, t, d) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));
  M.angDiff = (a, b) => {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  };

  // xorshift32 seeded RNG with helpers
  M.rng = function (seed) {
    let s = (seed >>> 0) || 0x9e3779b9;
    const f = () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
    for (let i = 0; i < 6; i++) f();
    f.range = (a, b) => a + (b - a) * f();
    f.int = (a, b) => Math.floor(a + (b - a + 1) * f());
    f.pick = (arr) => arr[Math.floor(f() * arr.length)];
    f.sign = () => (f() < 0.5 ? -1 : 1);
    return f;
  };
  M.hash = (n) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };

  /* ---------- colors: [r,g,b] in 0..1 ---------- */
  M.rgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };
  M.mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  M.mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  M.css = (c, a) => {
    const r = Math.round(M.clamp(c[0], 0, 1) * 255), g = Math.round(M.clamp(c[1], 0, 1) * 255), b = Math.round(M.clamp(c[2], 0, 1) * 255);
    return a === undefined ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
  };

  /* ---------- vectors (plain arrays) ---------- */
  M.v3 = (x, y, z) => [x, y, z];
  M.sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  M.add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  M.cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  M.dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  M.len = (a) => Math.hypot(a[0], a[1], a[2]);
  M.norm = (a) => {
    const l = M.len(a) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };

  /* ---------- 4x4 matrices, column-major Float32Array ---------- */
  M.m4 = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  M.perspective = (out, fovy, aspect, near, far) => {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    out.fill(0);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) * nf;
    out[11] = -1;
    out[14] = 2 * far * near * nf;
    return out;
  };
  M.lookAt = (out, e, t, up) => {
    let z = M.norm(M.sub(e, t));
    let x = M.norm(M.cross(up, z));
    const y = M.cross(z, x);
    out[0] = x[0]; out[1] = y[0]; out[2] = z[0]; out[3] = 0;
    out[4] = x[1]; out[5] = y[1]; out[6] = z[1]; out[7] = 0;
    out[8] = x[2]; out[9] = y[2]; out[10] = z[2]; out[11] = 0;
    out[12] = -M.dot(x, e); out[13] = -M.dot(y, e); out[14] = -M.dot(z, e); out[15] = 1;
    return out;
  };
  // Model matrix = T * Ry(yaw) * Rx(pitch) * Rz(roll) * S
  // Convention: models face -Z, +X is right, +Y is up. Positive yaw turns left, positive pitch lifts the nose.
  M.model = (out, px, py, pz, yaw, pitch, roll, s) => {
    s = s === undefined ? 1 : s;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch || 0), sp = Math.sin(pitch || 0);
    const cr = Math.cos(roll || 0), sr = Math.sin(roll || 0);
    out[0] = (cy * cr + sy * sp * sr) * s; out[1] = cp * sr * s; out[2] = (-sy * cr + cy * sp * sr) * s; out[3] = 0;
    out[4] = (-cy * sr + sy * sp * cr) * s; out[5] = cp * cr * s; out[6] = (sy * sr + cy * sp * cr) * s; out[7] = 0;
    out[8] = sy * cp * s; out[9] = -sp * s; out[10] = cy * cp * s; out[11] = 0;
    out[12] = px; out[13] = py; out[14] = pz; out[15] = 1;
    return out;
  };
  // out = a * b (column-major 4x4)
  M.mulm = (out, a, b) => {
    const r = new Float32Array(16);
    for (let c = 0; c < 4; c++)
      for (let rI = 0; rI < 4; rI++)
        r[c * 4 + rI] = a[rI] * b[c * 4] + a[4 + rI] * b[c * 4 + 1] + a[8 + rI] * b[c * 4 + 2] + a[12 + rI] * b[c * 4 + 3];
    out.set(r);
    return out;
  };
  // transform a point by a model matrix
  M.xf = (m, x, y, z) => [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
  // world-space forward vector for a yaw angle
  M.fwd = (yaw) => [-Math.sin(yaw), 0, -Math.cos(yaw)];

  /* ---------- formatting ---------- */
  const pad2 = (n) => (n < 10 ? '0' : '') + n;
  SR.fmtTime = (t) => {
    if (t === null || t === undefined || !isFinite(t)) return "-'--\"--";
    const m = Math.floor(t / 60), s = Math.floor(t % 60), c = Math.floor((t * 100) % 100);
    return m + "'" + pad2(s) + '"' + pad2(c);
  };
  SR.money = (n) => '$' + Math.round(n).toLocaleString('en-US');
  SR.ord = (n) => {
    const v = n % 100;
    if (v >= 11 && v <= 13) return n + 'TH';
    return n + (['TH', 'ST', 'ND', 'RD'][n % 10] || 'TH');
  };

  /* ---------- storage (never throws) ---------- */
  SR.store = {
    get(key, def) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : def;
      } catch (e) {
        return def;
      }
    },
    set(key, val) {
      try {
        localStorage.setItem(key, JSON.stringify(val));
        return true;
      } catch (e) {
        return false;
      }
    },
    del(key) {
      try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
    },
  };
})(window.SR);
