'use strict';
/* ============================================================
   Scenery props (low-poly, flat shaded) and track furniture.
   Each prop is built at the origin into a mesh builder whose
   placement transform is already set (mb.at). Local frame for
   roadside props: -X faces the road, +Z points back toward the
   approaching riders, +Y up. Left-side props are mirrored.
   o = { rng, night, snowy }
   ============================================================ */
(function (SR) {
  const M = SR.M, MAT = SR.MAT, C = M.rgb;
  const L = MAT.LIT, E = MAT.EMIT;
  const WIN_DAY = C('#2a3a5a'), WIN_LIT = C('#ffd97a'), WIN_OFF = C('#1a1e2e');

  const vary = (c, r, k) => M.mul(c, 1 - k / 2 + r() * k);
  function windowCol(o) {
    if (!o.night) return [WIN_DAY, L];
    return o.rng() < 0.55 ? [M.mul(WIN_LIT, 0.75 + o.rng() * 0.35), E] : [WIN_OFF, L];
  }
  /** grid of windows on a face: plane x = fx facing -X (dir -1) or plane z = fz facing +Z */
  function windows(mb, o, face, a0, a1, y0, y1, fixed, cw, ch, gw, gh) {
    for (let y = y0; y + ch <= y1; y += gh)
      for (let a = a0; a + cw <= a1; a += gw) {
        const [col, mat] = windowCol(o);
        if (face === 'x') mb.quad([fixed, y, a], [fixed, y, a + cw], [fixed, y + ch, a + cw], [fixed, y + ch, a], col, mat);
        else mb.quad([a, y, fixed], [a + cw, y, fixed], [a + cw, y + ch, fixed], [a, y + ch, fixed], col, mat);
      }
  }

  const P = (SR.Props = {});

  P.cactus = (mb, o) => {
    const r = o.rng, g = vary(C('#3f7f3a'), r, 0.25), h = r.range(3, 5.5);
    mb.cyl(0, 0, 0, 0.32, h, 6, g, L, g, 0.28);
    const arms = r.int(1, 2);
    for (let i = 0; i < arms; i++) {
      const s = i ? -1 : 1, y = r.range(1.2, h - 1.4), len = r.range(0.7, 1.1);
      mb.box(0, y - 0.18, -0.18, s * len, y + 0.18, 0.18, g, L);
      mb.cyl(s * len, y - 0.1, 0, 0.2, y + r.range(0.9, 1.6), 6, g, L, g, 0.17);
    }
  };
  P.rock = (mb, o) => {
    const r = o.rng, s = r.range(0.8, 2.6);
    mb.ball(0, s * 0.35, 0, s, s * 0.7, s * r.range(0.7, 1.2), 6, 4, vary(o.snowy ? C('#aeb6c4') : C('#8a7f72'), r, 0.3), L, r, 0.45);
    if (o.snowy) mb.ball(0, s * 0.85, 0, s * 0.7, s * 0.2, s * 0.7, 6, 2, C('#f2f6fa'), L);
  };
  P.mesa = (mb, o) => {
    const r = o.rng, w = r.range(25, 55), h = r.range(18, 40);
    mb.cyl(w * 0.6, -2, 0, w, h, 7, vary(C('#b8603a'), r, 0.2), L, C('#c87850'), w * 0.72);
    mb.cyl(w * 0.6, h - 0.5, 0, w * 0.72, h + 1.5, 7, C('#a85432'), L, C('#d08a5a'), w * 0.68);
  };
  P.billboard = (mb, o) => {
    const r = o.rng;
    const palette = ['#ff3c9e', '#19c3b0', '#ffc700', '#1f5fd6', '#ff7a1a', '#6b2bd1', '#d10a0a', '#eef0f3'];
    const bg = C(r.pick(palette)), fg = M.mix(bg, [0, 0, 0], 0.85);
    const text = r.pick(SR.SPONSORS);
    const w = 9, h = 3.2, y0 = 3.2;
    // panel faces the road, turned 40° toward the approaching riders
    const a = 0.7, ca = Math.cos(a), sa = Math.sin(a);
    const P2 = (u, v, d) => [u * sa - d * ca + 2, v, u * ca + d * sa];
    for (const u of [-w * 0.35, w * 0.35]) mb.box(P2(u, 0, 0.3)[0] - 0.15, 0, P2(u, 0, 0.3)[2] - 0.15, P2(u, 0, 0.3)[0] + 0.15, y0, P2(u, 0, 0.3)[2] + 0.15, C('#5a5a60'), L);
    const mat = o.night ? E : L, bgc = o.night ? M.mul(bg, 0.8) : bg;
    mb.quad(P2(-w / 2, y0, 0), P2(w / 2, y0, 0), P2(w / 2, y0 + h, 0), P2(-w / 2, y0 + h, 0), bgc, mat);
    mb.quad(P2(-w / 2, y0, 0.2), P2(-w / 2, y0 + h, 0.2), P2(w / 2, y0 + h, 0.2), P2(w / 2, y0, 0.2), C('#3a3a40'), L);
    // frame
    mb.quad(P2(-w / 2 - 0.2, y0 - 0.2, 0.05), P2(w / 2 + 0.2, y0 - 0.2, 0.05), P2(w / 2 + 0.2, y0, 0.05), P2(-w / 2 - 0.2, y0, 0.05), C('#222228'), L);
    // text (read from the road side)
    const px = Math.min(0.32, (w * 0.86) / (text.length * 6));
    const org = P2(0, y0 + h / 2 + px * 3.5, -0.03);
    const right = [-sa, 0, -ca], down = [0, -1, 0];
    const tw = SR.Font.width(text) * px;
    const start = [org[0] - right[0] * tw / 2, org[1], org[2] - right[2] * tw / 2];
    mb.text(text, start, right, down, px, o.night ? M.mix(fg, [1, 1, 1], 0.9) : fg, mat);
  };
  P.building = (mb, o) => {
    const r = o.rng;
    const w = r.range(10, 20), d = r.range(10, 18), h = r.range(14, 60);
    const base = vary(C(r.pick(['#8a8e9a', '#6a7088', '#a89a88', '#5a6070', '#7a6a78', '#9aa4b0'])), r, 0.15);
    mb.box(0, 0, -d / 2, w, h, d / 2, base, L, M.mul(base, 0.8));
    windows(mb, o, 'x', -d / 2 + 1, d / 2 - 1, 2, h - 1.5, -0.03, 1.5, 1.7, 2.8, 3.2);
    windows(mb, o, 'z', 1, w - 1, 2, h - 1.5, d / 2 + 0.03, 1.5, 1.7, 2.8, 3.2);
    // roof clutter
    mb.box(w * 0.3, h, -2, w * 0.6, h + 2, 2, M.mul(base, 0.7), L);
    if (r() < 0.4) {
      mb.box(w * 0.45 - 0.1, h + 2, -0.1, w * 0.45 + 0.1, h + 8, 0.1, C('#aaaaaa'), L);
      mb.box(w * 0.45 - 0.2, h + 8, -0.2, w * 0.45 + 0.2, h + 8.4, 0.2, C('#ff2020'), E);
    }
  };
  P.lamp = (mb, o) => {
    mb.box(-0.12, 0, -0.12, 0.12, 8, 0.12, C('#6a6e78'), L);
    mb.box(-2.4, 7.8, -0.08, 0.1, 8.0, 0.08, C('#6a6e78'), L);
    mb.box(-2.6, 7.6, -0.25, -1.8, 7.85, 0.25, o.night ? C('#fff2c0') : C('#c8ccd4'), o.night ? E : L);
  };
  P.tree = (mb, o) => {
    const r = o.rng, h = r.range(2.2, 3.5), s = r.range(2.2, 3.6);
    mb.cyl(0, 0, 0, 0.3, h + 0.5, 5, C('#5a3e28'), L);
    const g = vary(o.snowy ? C('#6a8a6a') : C(r.pick(['#3f8f3a', '#4a9a3a', '#2f7a2f', '#5aa040'])), r, 0.2);
    mb.ball(0, h + s * 0.7, 0, s, s * 0.85, s, 7, 4, g, L, r, 0.35);
  };
  P.sakura = (mb, o) => {
    const r = o.rng, h = r.range(2, 3), s = r.range(2.4, 3.4);
    mb.cyl(0, 0, 0, 0.28, h + 0.6, 5, C('#4a3028'), L);
    mb.ball(0, h + s * 0.6, 0, s * 1.1, s * 0.7, s * 1.1, 7, 4, vary(C('#ffb0cc'), r, 0.15), L, r, 0.3);
  };
  P.palm = (mb, o) => {
    const r = o.rng, h = r.range(6, 10), lean = r.range(-0.12, 0.12);
    let x = 0, y = 0;
    const segs = 6;
    for (let i = 0; i < segs; i++) {
      const nx = x + lean * (h / segs) * (1 + i * 0.3), ny = y + h / segs;
      mb.cyl(x, y, 0, 0.26 - i * 0.02, ny, 5, i % 2 ? C('#8a6a48') : C('#7a5a3a'), L, null, 0.24 - i * 0.02);
      x = nx; y = ny;
    }
    // shift is approximated by stacking; fronds at the top
    const g = vary(C('#2f8a3a'), r, 0.25);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + r() * 0.3, c = Math.cos(a), s = Math.sin(a), len = r.range(3, 4.2);
      const tip = [x + c * len, y - r.range(1, 1.8), s * len];
      const mid = [x + c * len * 0.5, y + 0.5, s * len * 0.5];
      const side = [-s * 0.55, 0, c * 0.55];
      mb.tri([x, y, 0], M.add(mid, side), mid, g, L);
      mb.tri([x, y, 0], mid, M.sub(mid, side), M.mul(g, 0.85), L);
      mb.tri(M.add(mid, side), tip, mid, M.mul(g, 0.9), L);
      mb.tri(mid, tip, M.sub(mid, side), M.mul(g, 0.8), L);
    }
    mb.ball(x, y, 0, 0.4, 0.35, 0.4, 5, 3, C('#6a4a2a'), L);
  };
  P.bush = (mb, o) => {
    const r = o.rng, s = r.range(0.7, 1.6);
    mb.ball(0, s * 0.6, 0, s * 1.2, s * 0.8, s, 6, 3, vary(o.snowy ? C('#dde6ee') : C('#3a7a32'), r, 0.25), L, r, 0.4);
  };
  P.house = (mb, o) => {
    const r = o.rng, w = r.range(7, 10), d = r.range(6, 9), h = r.range(3, 5.5);
    const wall = C(r.pick(['#f0e6d2', '#e8d8c0', '#dcd4c8', '#f4f0e8', '#e0c8a8'])), roof = C(r.pick(['#a83a2a', '#7a3a2a', '#5a4a4a', '#8a4a30']));
    mb.box(0, 0, -d / 2, w, h, d / 2, wall, L);
    const rh = h + r.range(2, 3.2);
    mb.quad([0, h, -d / 2 - 0.4], [0, h, d / 2 + 0.4], [w / 2, rh, d / 2 + 0.4], [w / 2, rh, -d / 2 - 0.4], roof, L);
    mb.quad([w, h, -d / 2 - 0.4], [w / 2, rh, -d / 2 - 0.4], [w / 2, rh, d / 2 + 0.4], [w, h, d / 2 + 0.4], M.mul(roof, 0.85), L);
    mb.tri([0, h, d / 2], [w, h, d / 2], [w / 2, rh, d / 2], wall, L);
    mb.tri([0, h, -d / 2], [w / 2, rh, -d / 2], [w, h, -d / 2], wall, L);
    windows(mb, o, 'x', -d / 2 + 1, d / 2 - 1, 1, h - 0.6, -0.03, 1.1, 1.2, 2.4, 2.5);
    mb.quad([-0.03, 0, -0.5], [-0.03, 0, 0.5], [-0.03, 2.1, 0.5], [-0.03, 2.1, -0.5], C('#5a3a28'), L);
    if (o.snowy || r() < 0.2) mb.quad([0, h + 0.05, -d / 2 - 0.4], [0, h + 0.05, d / 2 + 0.4], [w / 4, (h + rh) / 2 + 0.05, d / 2 + 0.4], [w / 4, (h + rh) / 2 + 0.05, -d / 2 - 0.4], o.snowy ? C('#f2f6fa') : roof, L);
  };
  P.chalet = (mb, o) => {
    const r = o.rng, w = 9, d = 8, h = 5;
    const wood = C('#8a5a34');
    mb.box(0, 0, -d / 2, w, 1.2, d / 2, C('#9a9a94'), L);
    mb.box(0, 1.2, -d / 2, w, h, d / 2, wood, L);
    const rh = h + 3.4;
    mb.quad([-1, h - 0.5, -d / 2 - 1], [-1, h - 0.5, d / 2 + 1], [w / 2, rh, d / 2 + 1], [w / 2, rh, -d / 2 - 1], o.snowy ? C('#f2f6fa') : C('#4a3a30'), L);
    mb.quad([w + 1, h - 0.5, -d / 2 - 1], [w / 2, rh, -d / 2 - 1], [w / 2, rh, d / 2 + 1], [w + 1, h - 0.5, d / 2 + 1], o.snowy ? C('#e6ecf2') : C('#3e3028'), L);
    mb.tri([0, h, d / 2], [w, h, d / 2], [w / 2, rh - 0.3, d / 2], wood, L);
    windows(mb, o, 'x', -d / 2 + 1, d / 2 - 1, 2, h - 0.5, -0.03, 1.2, 1.2, 2.2, 2);
    mb.box(-1.2, 2.6, -d / 2, 0, 2.8, d / 2, M.mul(wood, 0.8), L);
  };
  P.townhouse = (mb, o) => {
    const r = o.rng, w = r.range(8, 11), d = r.range(10, 16), floors = r.int(3, 5), h = floors * 3.2 + 1;
    const wall = C(r.pick(['#e8c8a0', '#d8a888', '#c8d0b0', '#e0d0b8', '#c89a7a', '#d8c0c8', '#b8c8d0']));
    mb.box(0, 0, -d / 2, w, h, d / 2, wall, L, wall);
    mb.box(-0.3, h, -d / 2 - 0.3, w * 0.6, h + 0.4, d / 2 + 0.3, M.mul(wall, 0.8), L);
    // mansard roof
    mb.quad([-0.3, h + 0.4, -d / 2 - 0.3], [-0.3, h + 0.4, d / 2 + 0.3], [1.5, h + 3, d / 2], [1.5, h + 3, -d / 2], C('#5a6070'), L);
    mb.box(1.5, h + 0.4, -d / 2, w, h + 3, d / 2, C('#4e5462'), L);
    for (let f = 0; f < floors; f++) {
      const y = 1.4 + f * 3.2;
      for (let z = -d / 2 + 1.2; z + 1.2 <= d / 2 - 0.8; z += 2.4) {
        const [col, mat] = windowCol(o);
        mb.quad([-0.03, y, z], [-0.03, y, z + 1.1], [-0.03, y + 1.8, z + 1.1], [-0.03, y + 1.8, z], col, mat);
        mb.quad([-0.04, y, z - 0.35], [-0.04, y, z], [-0.04, y + 1.8, z], [-0.04, y + 1.8, z - 0.35], C('#3a6a4a'), L); // shutter
      }
    }
  };
  P.cypress = (mb, o) => {
    const r = o.rng, h = r.range(7, 11);
    mb.cyl(0, 0, 0, 0.2, 1, 4, C('#4a3428'), L);
    mb.ball(0, h / 2 + 0.6, 0, 0.9, h / 2, 0.9, 6, 5, vary(C('#2a5a2a'), r, 0.2), L, r, 0.15);
  };
  P.pine = (mb, o) => {
    const r = o.rng, h = r.range(7, 12), g = vary(C(r.pick(['#1f5a2a', '#2a6a32', '#1a4a28'])), r, 0.2);
    mb.cyl(0, 0, 0, 0.3, h * 0.3, 5, C('#4a3020'), L);
    for (let i = 0; i < 3; i++) {
      const y0 = h * (0.2 + i * 0.24), rad = h * (0.3 - i * 0.07);
      mb.cone(0, y0, 0, rad, y0 + h * 0.42, 7, M.mul(g, 1 - i * 0.06), L);
    }
  };
  P.snowpine = (mb, o) => {
    const r = o.rng, h = r.range(7, 12), g = vary(C('#2a5a3a'), r, 0.2);
    mb.cyl(0, 0, 0, 0.3, h * 0.3, 5, C('#4a3020'), L);
    for (let i = 0; i < 3; i++) {
      const y0 = h * (0.2 + i * 0.24), rad = h * (0.3 - i * 0.07);
      mb.cone(0, y0, 0, rad, y0 + h * 0.42, 7, M.mul(g, 1 - i * 0.06), L);
      mb.cone(0, y0 + h * 0.2, 0, rad * 0.55, y0 + h * 0.43, 7, C('#eef3f8'), L);
    }
  };
  P.snowman = (mb) => {
    const s = C('#f4f7fa');
    mb.ball(0, 0.6, 0, 0.65, 0.6, 0.65, 8, 5, s, L);
    mb.ball(0, 1.55, 0, 0.45, 0.42, 0.45, 8, 5, s, L);
    mb.ball(0, 2.2, 0, 0.32, 0.3, 0.32, 8, 5, s, L);
    mb.tri([-0.3, 2.22, -0.05], [-0.3, 2.18, 0.05], [-0.62, 2.2, 0], C('#ff7a1a'), L);
    mb.box(-0.3, 2.45, -0.3, 0.3, 2.5, 0.3, C('#1a1a1a'), L);
    mb.box(-0.2, 2.5, -0.2, 0.2, 2.85, 0.2, C('#1a1a1a'), L);
  };
  P.windmill = (mb, o) => {
    mb.cyl(0, 0, 0, 2.6, 14, 8, C('#eeeae0'), L, null, 1.6);
    mb.cone(0, 14, 0, 2.0, 16.5, 8, C('#6a3a2a'), L);
    const hub = [-2.1, 13, 0];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4, c = Math.cos(a), s = Math.sin(a);
      const tip = [hub[0], hub[1] + s * 9, hub[2] + c * 9], side = [0, c * 0.9, -s * 0.9];
      mb.quad(hub, M.add(hub, side), M.add(tip, side), tip, C('#d8d0c0'), L);
    }
  };
  P.hay = (mb, o) => {
    const r = o.rng, n = r.int(1, 3);
    for (let i = 0; i < n; i++) mb.cyl(i * 1.9, 0, r.range(-1, 1), 0.85, 1.5, 8, C('#d8b858'), L, C('#e8c868'));
  };
  P.torii = (mb) => {
    const red = C('#d02818');
    mb.box(-0.3, 0, -3, 0.3, 6.5, -2.4, red, L);
    mb.box(-0.3, 0, 2.4, 0.3, 6.5, 3, red, L);
    mb.box(-0.4, 5.2, -3.6, 0.4, 5.6, 3.6, red, L);
    mb.box(-0.5, 6.5, -4.3, 0.5, 7.1, 4.3, C('#1a1a1a'), L);
  };
  P.pagoda = (mb, o) => {
    let y = 0, w = 7;
    for (let i = 0; i < 4; i++) {
      const h = 2.8 - i * 0.2;
      mb.box(0, y, -w / 2, w, y + h, w / 2, C('#b8402a'), L);
      windows(mb, o, 'x', -w / 2 + 1, w / 2 - 1, y + 0.8, y + h - 0.3, -0.03, 0.9, 1.1, 1.6, 3);
      const rw = w * 0.75 + 1.2;
      mb.quad([w / 2 - rw, y + h, -rw], [w / 2 + rw, y + h, -rw], [w / 2 + rw * 0.5, y + h + 1.1, -rw * 0.5], [w / 2 - rw * 0.5, y + h + 1.1, -rw * 0.5], C('#3a4048'), L);
      mb.quad([w / 2 - rw, y + h, rw], [w / 2 - rw * 0.5, y + h + 1.1, rw * 0.5], [w / 2 + rw * 0.5, y + h + 1.1, rw * 0.5], [w / 2 + rw, y + h, rw], C('#3a4048'), L);
      mb.quad([w / 2 - rw, y + h, -rw], [w / 2 - rw * 0.5, y + h + 1.1, -rw * 0.5], [w / 2 - rw * 0.5, y + h + 1.1, rw * 0.5], [w / 2 - rw, y + h, rw], C('#454c55'), L);
      y += h + 1.1;
      w *= 0.8;
    }
    mb.box(3.2, y, -0.1, 3.4, y + 3, 0.1, C('#c8a040'), L);
  };
  P.stone = (mb, o) => {
    const r = o.rng, n = r.int(2, 4);
    for (let i = 0; i < n; i++) {
      const z = i * 3.2 - n * 1.6, h = r.range(3, 5);
      mb.box(0, 0, z - 0.7, 1.1, h, z + 0.7, vary(C('#8a8c86'), r, 0.2), L);
      if (i < n - 1 && r() < 0.5) mb.box(-0.1, h, z - 0.7, 1.2, h + 0.9, z + 3.9, C('#7e807a'), L);
    }
  };

  /* ---------- track furniture ---------- */
  // start/finish gantry spanning the road (local x across the road, centred)
  P.gantry = (mb, o, RW) => {
    const post = C('#3a3a44'), beam = C('#1a1a24');
    for (const s of [-1, 1]) mb.box(s * (RW + 1.2) - 0.4, 0, -0.4, s * (RW + 1.2) + 0.4, 7.8, 0.4, post, L);
    mb.box(-RW - 1.6, 6.2, -0.5, RW + 1.6, 7.8, 0.5, beam, L);
    const t = 'REDLINE RIDERS', px = 0.13, tw = SR.Font.width(t) * px;
    mb.text(t, [-tw / 2, 7.45, 0.52], [1, 0, 0], [0, -1, 0], px, C('#ff3c9e'), E);
    mb.text(t, [tw / 2, 7.45, -0.52], [-1, 0, 0], [0, -1, 0], px, C('#ff3c9e'), E);
    // start lights
    for (let i = 0; i < 5; i++) {
      const x = -2 + i;
      mb.box(x - 0.3, 5.3, -0.2, x + 0.3, 6.2, 0.3, C('#111118'), L);
      mb.box(x - 0.2, 5.45, 0.3, x + 0.2, 5.75, 0.33, C('#ff2020'), E);
      mb.box(x - 0.2, 5.8, 0.3, x + 0.2, 6.1, 0.33, C('#20ff40'), E);
    }
    // checker band
    for (let i = 0; i < 24; i++) {
      const x0 = -RW - 1.6 + i * ((RW + 1.6) * 2) / 24, x1 = x0 + ((RW + 1.6) * 2) / 24;
      mb.quad([x0, 6.2, 0.51], [x1, 6.2, 0.51], [x1, 6.5, 0.51], [x0, 6.5, 0.51], i % 2 ? C('#f0f0f0') : C('#101010'), L);
    }
  };
  // chevron board pointing toward dir (+1 right, -1 left), facing the approaching riders (+Z)
  P.chevron = (mb, o, dir) => {
    mb.box(-0.06, 0, -0.06, 0.06, 1.0, 0.06, C('#5a5a60'), L);
    const Y = C('#ffd21a'), B = C('#141414');
    mb.quad([-0.8, 1.0, 0.07], [0.8, 1.0, 0.07], [0.8, 2.0, 0.07], [-0.8, 2.0, 0.07], B, L);
    for (let k = -1; k <= 1; k++) {
      const x = k * 0.45 * dir;
      mb.quad([x - 0.18 * dir, 1.15, 0.09], [x + 0.08 * dir, 1.5, 0.09], [x + 0.28 * dir, 1.5, 0.09], [x + 0.02 * dir, 1.15, 0.09], Y, L);
      mb.quad([x + 0.08 * dir, 1.5, 0.09], [x - 0.18 * dir, 1.85, 0.09], [x + 0.02 * dir, 1.85, 0.09], [x + 0.28 * dir, 1.5, 0.09], Y, L);
    }
    mb.quad([-0.8, 1.0, -0.02], [-0.8, 2.0, -0.02], [0.8, 2.0, -0.02], [0.8, 1.0, -0.02], C('#3a3a40'), L);
  };
  // grandstand along the track (local z along the road, -X faces the road)
  P.grandstand = (mb, o, len) => {
    const r = o.rng, rows = 7;
    const shirts = ['#ff3c9e', '#19c3b0', '#ffc700', '#1f5fd6', '#ff7a1a', '#eef0f3', '#d10a0a', '#5dbb1c', '#6b2bd1'];
    for (let i = 0; i < rows; i++) {
      const x = i * 1.2, y = 0.6 + i * 0.8;
      mb.box(x, 0, -len / 2, x + 1.2, y, len / 2, C('#8a8e98'), L, C('#a8acb4'));
      for (let z = -len / 2 + 0.3; z < len / 2 - 0.4; z += 0.55) {
        if (r() < 0.2) continue;
        const c = C(r.pick(shirts));
        mb.box(x + 0.35, y, z, x + 0.7, y + 0.55, z + 0.35, c, L);
        mb.box(x + 0.42, y + 0.55, z + 0.05, x + 0.62, y + 0.78, z + 0.3, C(r.pick(['#f0c8a0', '#c89a70', '#8a5a3a', '#f4d8b8'])), L);
      }
    }
    mb.box(rows * 1.2, 0, -len / 2, rows * 1.2 + 0.4, 0.6 + rows * 0.8 + 4, len / 2, C('#5a5e68'), L);
    mb.quad([-1, 9.8, -len / 2], [-1, 9.8, len / 2], [rows * 1.2 + 0.4, 6.6 + rows * 0.8 - 1.5, len / 2], [rows * 1.2 + 0.4, 6.6 + rows * 0.8 - 1.5, -len / 2], C('#e8e8f0'), L);
    for (const z of [-len / 2, 0, len / 2]) mb.box(-0.9, 0, z - 0.1, -0.7, 9.8, z + 0.1, C('#5a5e68'), L);
  };
})(window.SR);
