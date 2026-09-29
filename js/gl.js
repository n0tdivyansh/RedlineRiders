'use strict';
/* ============================================================
   Tiny WebGL renderer with a retro (PS1 / arcade) look:
   flat-shaded vertex-colored polygons, vertex snapping,
   15-bit color with ordered dithering, distance fog,
   screen-door transparency and night headlights.
   ============================================================ */
(function (SR) {
  const M = SR.M;

  /* Material ids (per vertex, constant per triangle) */
  const MAT = (SR.MAT = {
    LIT: 0,        // lit vertex color
    PAINT: 1,      // lit, color * uPaint (car body)
    EMIT: 2,       // unlit (lights, windows, signs)
    GRAIN: 3,      // lit + world-space noise (asphalt, grass)
    BRAKE: 4,      // tail lights: brighten when braking
    SKY: 5,        // unlit, no fog
    HEAD: 6,       // headlight lens: brighter at night
    PAINT2: 7,     // lit, color * uPaint2 (accent)
    EPAINT: 8,     // unlit, color * uPaint (particles, sparks)
  });

  const VS = `
attribute vec3 aPos;
attribute vec3 aNor;
attribute vec3 aCol;
attribute float aMat;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
uniform vec2 uRes;
uniform float uSnap;
varying vec3 vCol;
varying vec3 vNor;
varying vec3 vWorld;
varying float vMat;
varying float vDist;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vec4 v = uView * w;
  vec4 p = uProj * v;
  if (uSnap > 0.5 && p.w > 0.2) {
    vec2 g = uRes * 0.5;
    p.xy = floor(p.xy / p.w * g + 0.5) / g * p.w;
  }
  gl_Position = p;
  vCol = aCol;
  vNor = (uModel * vec4(aNor, 0.0)).xyz;
  vWorld = w.xyz;
  vMat = aMat;
  vDist = -v.z;
}`;

  const FS = `
precision mediump float;
varying vec3 vCol;
varying vec3 vNor;
varying vec3 vWorld;
varying float vMat;
varying float vDist;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uSkyAmb;
uniform vec3 uGndAmb;
uniform vec3 uFogCol;
uniform vec2 uFog;
uniform vec3 uPaint;
uniform vec3 uPaint2;
uniform float uAlpha;
uniform float uDither;
uniform float uBrake;
uniform float uNight;
uniform float uFlash;
uniform vec3 uHeadPos;
uniform vec3 uHeadDir;
uniform float uHeadOn;
float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 quant(vec3 c, float b) {
  if (uDither < 0.5) return c;
  return floor(clamp(c, 0.0, 1.0) * 31.0 + b) / 31.0;
}
void main() {
  float bz = bayer4(gl_FragCoord.xy);
  if (uAlpha < 0.99 && bz >= uAlpha) discard;
  vec3 col = vCol;
  float m = vMat;
  if (m > 4.5 && m < 5.5) {
    gl_FragColor = vec4(quant(col + uFlash, bz), 1.0);
    return;
  }
  bool emissive = false;
  if (m > 0.5 && m < 1.5) col *= uPaint;
  else if (m > 6.5 && m < 7.5) col *= uPaint2;
  else if (m > 1.5 && m < 2.5) emissive = true;
  else if (m > 3.5 && m < 4.5) { col *= 0.45 + uBrake * 0.8; emissive = true; }
  else if (m > 5.5 && m < 6.5) { col *= 0.75 + uNight * 0.5; emissive = true; }
  else if (m > 7.5) { col *= uPaint; emissive = true; }
  else if (m > 2.5 && m < 3.5) { float n = hash(floor(vWorld.xz * 1.25)); col *= 0.86 + 0.22 * n; }
  if (!emissive) {
    vec3 n = normalize(vNor);
    if (!gl_FrontFacing) n = -n;
    float d = max(dot(n, uSunDir), 0.0);
    vec3 amb = mix(uGndAmb, uSkyAmb, n.y * 0.5 + 0.5);
    vec3 light = amb + uSunCol * d;
    if (uHeadOn > 0.5) {
      vec3 L = vWorld - uHeadPos;
      float dist = max(length(L), 0.01);
      float cone = dot(L / dist, uHeadDir);
      light += vec3(1.0, 0.94, 0.78) * smoothstep(0.86, 0.975, cone) * clamp(1.0 - dist / 75.0, 0.0, 1.0) * 1.5;
      light += vec3(0.5, 0.45, 0.4) * clamp(1.0 - dist / 9.0, 0.0, 1.0);
    }
    col *= light + uFlash;
  }
  float f = clamp((vDist - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
  col = mix(col, uFogCol, f * f * (3.0 - 2.0 * f));
  gl_FragColor = vec4(quant(col, bz), 1.0);
}`;

  const GL = (SR.GL = {});
  let gl, prog, U = {}, A = {};
  const STRIDE = 10; // floats per vertex: pos3 nor3 col3 mat1

  GL.init = function (canvas) {
    gl = canvas.getContext('webgl', { antialias: false, depth: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) return false;
    GL.gl = gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    ['aPos', 'aNor', 'aCol', 'aMat'].forEach((n) => { A[n] = gl.getAttribLocation(prog, n); gl.enableVertexAttribArray(A[n]); });
    ['uProj', 'uView', 'uModel', 'uRes', 'uSnap', 'uSunDir', 'uSunCol', 'uSkyAmb', 'uGndAmb', 'uFogCol', 'uFog', 'uPaint', 'uPaint2',
      'uAlpha', 'uDither', 'uBrake', 'uNight', 'uFlash', 'uHeadPos', 'uHeadDir', 'uHeadOn'].forEach((n) => { U[n] = gl.getUniformLocation(prog, n); });
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    GL.snap = true;
    GL.dither = true;
    return true;
  };

  GL.resize = function (w, h) {
    const c = gl.canvas;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  };

  GL.clear = function (col) {
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(col[0], col[1], col[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  };

  const proj = M.m4(), view = M.m4(), ident = M.m4();
  /** Start drawing a view. vp = {x,y,w,h} in 0..1 of the canvas (y from top). */
  GL.beginView = function (vp, cam, env) {
    const cw = gl.canvas.width, ch = gl.canvas.height;
    const x = Math.round(vp.x * cw), w = Math.round(vp.w * cw);
    const h = Math.round(vp.h * ch), y = ch - Math.round(vp.y * ch) - h;
    gl.viewport(x, y, w, h);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x, y, w, h);
    const fc = env.fogCol;
    gl.clearColor(fc[0], fc[1], fc[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    M.perspective(proj, cam.fov, w / h, cam.near || 0.3, cam.far || 1600);
    M.lookAt(view, cam.eye, cam.target, cam.up || [0, 1, 0]);
    gl.uniformMatrix4fv(U.uProj, false, proj);
    gl.uniformMatrix4fv(U.uView, false, view);
    gl.uniform2f(U.uRes, w, h);
    gl.uniform1f(U.uSnap, GL.snap ? 1 : 0);
    gl.uniform1f(U.uDither, GL.dither ? 1 : 0);
    gl.uniform3fv(U.uSunDir, env.sunDir);
    gl.uniform3fv(U.uSunCol, env.sunCol);
    gl.uniform3fv(U.uSkyAmb, env.skyAmb);
    gl.uniform3fv(U.uGndAmb, env.gndAmb);
    gl.uniform3fv(U.uFogCol, env.fogCol);
    gl.uniform2f(U.uFog, env.fogNear, env.fogFar);
    gl.uniform1f(U.uNight, env.night ? 1 : 0);
    gl.uniform1f(U.uFlash, env.flash || 0);
    const head = !!(env.headOn && env.headPos);
    gl.uniform1f(U.uHeadOn, head ? 1 : 0);
    if (head) {
      gl.uniform3fv(U.uHeadPos, env.headPos);
      gl.uniform3fv(U.uHeadDir, env.headDir);
    }
    cur.paint = cur.paint2 = null;
    cur.alpha = cur.brake = -1;
    GL.cam = cam;
  };

  const cur = { paint: null, paint2: null, alpha: -1, brake: -1 };
  const WHITE = [1, 1, 1];
  /** draw a mesh with a model matrix; o = {paint, paint2, alpha, brake} */
  GL.draw = function (mesh, model, o) {
    if (!mesh || !mesh.count) return;
    o = o || {};
    const paint = o.paint || WHITE, paint2 = o.paint2 || WHITE;
    const alpha = o.alpha === undefined ? 1 : o.alpha, brake = o.brake || 0;
    if (cur.paint !== paint) { gl.uniform3fv(U.uPaint, paint); cur.paint = paint; }
    if (cur.paint2 !== paint2) { gl.uniform3fv(U.uPaint2, paint2); cur.paint2 = paint2; }
    if (cur.alpha !== alpha) { gl.uniform1f(U.uAlpha, alpha); cur.alpha = alpha; }
    if (cur.brake !== brake) { gl.uniform1f(U.uBrake, brake); cur.brake = brake; }
    gl.uniformMatrix4fv(U.uModel, false, model || ident);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buf);
    gl.vertexAttribPointer(A.aPos, 3, gl.FLOAT, false, STRIDE * 4, 0);
    gl.vertexAttribPointer(A.aNor, 3, gl.FLOAT, false, STRIDE * 4, 12);
    gl.vertexAttribPointer(A.aCol, 3, gl.FLOAT, false, STRIDE * 4, 24);
    gl.vertexAttribPointer(A.aMat, 1, gl.FLOAT, false, STRIDE * 4, 36);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  };
  GL.depthWrite = (on) => gl.depthMask(on);
  GL.depthTest = (on) => (on ? gl.enable(gl.DEPTH_TEST) : gl.disable(gl.DEPTH_TEST));
  GL.free = (mesh) => { if (mesh && mesh.buf) gl.deleteBuffer(mesh.buf); };

  /* ============================================================
     Mesh builder
     ============================================================ */
  class MB {
    constructor() {
      this.v = [];
      this.t = null; // transform: {x,y,z,c,s,k}
    }
    /** set a placement transform (yaw about Y, uniform scale) for following primitives */
    at(x, y, z, yaw, scale, mirror) {
      this.t = { x, y, z, c: Math.cos(yaw || 0), s: Math.sin(yaw || 0), k: scale || 1, m: mirror ? -1 : 1 };
      return this;
    }
    reset() { this.t = null; return this; }
    _p(p) {
      const t = this.t;
      if (!t) return p;
      const x = p[0] * t.k * t.m, y = p[1] * t.k, z = p[2] * t.k;
      // same rotation as M.model yaw: x' = c*x + s*z ; z' = -s*x + c*z
      return [t.c * x + t.s * z + t.x, y + t.y, -t.s * x + t.c * z + t.z];
    }
    tri(a, b, c, col, mat) {
      a = this._p(a); b = this._p(b); c = this._p(c);
      const n = M.norm(M.cross(M.sub(b, a), M.sub(c, a)));
      const v = this.v, m = mat || 0;
      v.push(a[0], a[1], a[2], n[0], n[1], n[2], col[0], col[1], col[2], m);
      v.push(b[0], b[1], b[2], n[0], n[1], n[2], col[0], col[1], col[2], m);
      v.push(c[0], c[1], c[2], n[0], n[1], n[2], col[0], col[1], col[2], m);
    }
    /** triangle with explicit (smooth) vertex normals */
    triN(a, b, c, na, nb, nc, col, mat) {
      const t = this.t;
      a = this._p(a); b = this._p(b); c = this._p(c);
      if (t) {
        const r = (n) => [t.c * n[0] * t.m + t.s * n[2], n[1], -t.s * n[0] * t.m + t.c * n[2]];
        na = r(na); nb = r(nb); nc = r(nc);
      }
      const v = this.v, m = mat || 0;
      v.push(a[0], a[1], a[2], na[0], na[1], na[2], col[0], col[1], col[2], m);
      v.push(b[0], b[1], b[2], nb[0], nb[1], nb[2], col[0], col[1], col[2], m);
      v.push(c[0], c[1], c[2], nc[0], nc[1], nc[2], col[0], col[1], col[2], m);
    }
    quad(a, b, c, d, col, mat) {
      this.tri(a, b, c, col, mat);
      this.tri(a, c, d, col, mat);
    }
    poly(pts, col, mat) {
      for (let i = 1; i < pts.length - 1; i++) this.tri(pts[0], pts[i], pts[i + 1], col, mat);
    }
    /** axis-aligned box from min to max corner; cols = color or {top, side, bottom, front, back} */
    box(x0, y0, z0, x1, y1, z1, col, mat, colTop) {
      const top = colTop || col;
      const side = col, f = M.mul(col, 0.92);
      this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], top, mat);
      this.quad([x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0], M.mul(col, 0.5), mat);
      this.quad([x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [x1, y0, z1], side, mat);
      this.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], side, mat);
      this.quad([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], f, mat);
      this.quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], f, mat);
    }
    /** vertical cylinder (n sides) from y0 to y1 */
    cyl(cx, y0, cz, r, y1, n, col, mat, capCol, r1) {
      r1 = r1 === undefined ? r : r1;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
        const p0 = [cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r], p1 = [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r];
        const q0 = [cx + Math.cos(a0) * r1, y1, cz + Math.sin(a0) * r1], q1 = [cx + Math.cos(a1) * r1, y1, cz + Math.sin(a1) * r1];
        this.quad(p0, p1, q1, q0, col, mat);
        if (capCol && r1 > 0) this.tri([cx, y1, cz], q0, q1, capCol, mat);
      }
    }
    cone(cx, y0, cz, r, y1, n, col, mat) {
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
        this.tri([cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r], [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r], [cx, y1, cz], col, mat);
      }
    }
    /** low-poly ellipsoid; rng jitters vertices for organic shapes */
    ball(cx, cy, cz, rx, ry, rz, slices, stacks, col, mat, rng, jit) {
      const P = [];
      for (let j = 0; j <= stacks; j++) {
        const row = [], phi = (j / stacks) * Math.PI;
        for (let i = 0; i < slices; i++) {
          const th = (i / slices) * Math.PI * 2;
          let k = 1;
          if (rng && j > 0 && j < stacks) k = 1 + (rng() - 0.5) * (jit || 0.3);
          row.push([cx + Math.sin(phi) * Math.cos(th) * rx * k, cy + Math.cos(phi) * ry * k, cz + Math.sin(phi) * Math.sin(th) * rz * k]);
        }
        P.push(row);
      }
      for (let j = 0; j < stacks; j++)
        for (let i = 0; i < slices; i++) {
          const i2 = (i + 1) % slices;
          const shade = 0.9 + 0.1 * Math.cos(i * 1.7 + j);
          const c = M.mul(col, shade);
          if (j === 0) this.tri(P[0][i], P[1][i2], P[1][i], c, mat);
          else if (j === stacks - 1) this.tri(P[j][i], P[j][i2], P[j + 1][i], c, mat);
          else this.quad(P[j][i], P[j][i2], P[j + 1][i2], P[j + 1][i], c, mat);
        }
    }
    /** flat text made of pixel quads on the plane: origin (x,y,z), right axis r, down axis d, pixel size px */
    text(str, o, r, d, px, col, mat, align) {
      str = String(str).toUpperCase();
      const F = SR.Font, w = F.width(str) * px;
      let ox = align === 'center' ? -w / 2 : 0;
      for (let i = 0; i < str.length; i++) {
        const b = F.glyph(str[i]);
        for (let y = 0; y < F.CH; y++)
          for (let x = 0; x < F.CW; x++) {
            if (!b[y][x]) continue;
            const u = ox + (i * F.ADV + x) * px, v = y * px;
            const P = (du, dv) => [o[0] + r[0] * (u + du) + d[0] * (v + dv), o[1] + r[1] * (u + du) + d[1] * (v + dv), o[2] + r[2] * (u + du) + d[2] * (v + dv)];
            this.quad(P(0, 0), P(px, 0), P(px, px), P(0, px), col, mat);
          }
      }
    }
    get count() { return this.v.length / STRIDE; }
    build() {
      const data = new Float32Array(this.v);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      // bounding sphere (approx: box center)
      let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
      for (let i = 0; i < data.length; i += STRIDE) {
        const x = data[i], y = data[i + 1], z = data[i + 2];
        if (x < mnx) mnx = x; if (x > mxx) mxx = x;
        if (y < mny) mny = y; if (y > mxy) mxy = y;
        if (z < mnz) mnz = z; if (z > mxz) mxz = z;
      }
      const c = [(mnx + mxx) / 2, (mny + mxy) / 2, (mnz + mxz) / 2];
      const r = Math.hypot(mxx - mnx, mxy - mny, mxz - mnz) / 2;
      return { buf, count: data.length / STRIDE, center: c, radius: r };
    }
  }
  GL.MB = MB;
})(window.SR);
