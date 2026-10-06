'use strict';
/* ============================================================
   Screens (state machine): boot, title (attract demo), main menu,
   championship hub, cups, starter pick, pre-race, race + pause,
   results, standings, cup end, shop, dealer, garage, quick race,
   time trial, options, controls, multiplayer (coming soon), credits.
   ============================================================ */
(function (SR) {
  const M = SR.M, F = SR.Font, UI2 = SR.UI2, A = SR.Audio, GL = SR.GL;
  const W = 384, H = 216;
  const HOT = '#ff3c9e', NEON = '#3de0ff', GOLD = '#ffd21a', DIM = '#8a84a8';
  const S = (SR.Screens = { cur: null, name: '', list: {} });
  const D = () => SR.data;
  const save = () => SR.Save.save();

  S.go = function (name, args) {
    if (S.cur && S.cur.exit) S.cur.exit(name);
    S.name = name;
    S.cur = S.list[name];
    S.t = 0;
    if (S.cur.enter) S.cur.enter(args || {});
  };
  S.update = (dt) => { S.t += dt; S.cur.update && S.cur.update(dt); };
  S.render3d = (dt) => { S.cur.render3d && S.cur.render3d(dt); };
  S.draw2d = (ctx, dt) => { S.cur.draw && S.cur.draw(ctx, dt); };

  /* ============================================================
     Shared bits: menu widget, demo race, showroom
     ============================================================ */
  function Menu(items, o) {
    o = o || {};
    const m = { items, i: 0, o };
    const vis = () => m.items.filter((it) => !it.hidden || !it.hidden());
    m.update = () => {
      const k = SR.Input.menu(), list = vis();
      if (!list.length) return;
      if (m.i >= list.length) m.i = list.length - 1;
      const it = list[m.i];
      if (k.up) { m.i = (m.i - 1 + list.length) % list.length; A.sfx('move'); }
      if (k.down) { m.i = (m.i + 1) % list.length; A.sfx('move'); }
      if (k.left && it.left) { it.left(); A.sfx('move'); }
      if (k.right && it.right) { it.right(); A.sfx('move'); }
      if (k.ok) {
        if (it.disabled && it.disabled()) A.sfx('error');
        else if (it.ok) { A.sfx('select'); it.ok(); }
        else if (it.right) { it.right(); A.sfx('move'); }
      }
      if (k.back && o.back) { A.sfx('back'); o.back(); }
    };
    m.draw = (ctx, x, y, w, rowH) => {
      rowH = rowH || 12;
      const list = vis();
      list.forEach((it, idx) => {
        const yy = y + idx * rowH, sel = idx === m.i, dis = it.disabled && it.disabled();
        if (sel) {
          ctx.fillStyle = 'rgba(255,60,158,0.28)';
          ctx.fillRect(x - 4, yy - 2, w + 8, rowH - 1);
          if (Math.floor(S.t * 4) % 2 === 0) F.draw(ctx, '►', x - 2, yy, HOT);
        }
        const label = typeof it.label === 'function' ? it.label() : it.label;
        F.draw(ctx, label, x + 8, yy, dis ? '#5a5470' : sel ? '#fff' : '#cfc8ec', 1, 'left', '#000');
        if (it.value) {
          const v = it.value();
          const txt = it.left ? '◄ ' + v + ' ►' : v;
          F.draw(ctx, txt, x + w, yy, sel ? GOLD : '#e8d8a0', 1, 'right', '#000');
        }
      });
      const cur = list[m.i];
      if (cur && cur.hint) F.draw(ctx, typeof cur.hint === 'function' ? cur.hint() : cur.hint, W / 2, H - 12, DIM, 1, 'center', '#000');
    };
    return m;
  }

  let demo = null;
  function ensureDemo() {
    if (demo) return demo;
    const tr = SR.TRACKS[Math.floor(Math.random() * SR.TRACKS.length)];
    demo = SR.Race.create({ trackDef: tr, mode: 'demo', laps: 99, locals: [], rivals: SR.Race.buildField(tr.cup, 9, 'normal', Math.floor(Math.random() * 1e6)) });
    return demo;
  }
  function dropDemo() { if (demo) { disposeRace(demo); demo = null; } }
  function disposeRace(r) {
    r.stopAudio();
    r.track.chunks.forEach(GL.free); GL.free(r.track.sky); GL.free(r.track.ground);
  }
  function demoFrame(dt) { const d = ensureDemo(); d.update(dt); d.render(dt); }

  // showroom: turntable in a neon studio
  let studio = null;
  function buildStudio() {
    // backdrop first (drawn with GL.backdrop in this order: floor, then the grid on it), then the turntable
    const bk = new GL.MB();
    bk.quad([-200, -0.05, -200], [200, -0.05, -200], [200, -0.05, 200], [-200, -0.05, 200], M.rgb('#0c0618'), SR.MAT.EMIT);
    for (let k = -20; k <= 20; k++) {   // neon grid floor out to the horizon
      bk.quad([k * 4 - 0.04, -0.02, -80], [k * 4 + 0.04, -0.02, -80], [k * 4 + 0.04, -0.02, 80], [k * 4 - 0.04, -0.02, 80], M.rgb('#6a2aa0'), SR.MAT.EMIT);
      bk.quad([-80, -0.02, k * 4 - 0.04], [80, -0.02, k * 4 - 0.04], [80, -0.02, k * 4 + 0.04], [-80, -0.02, k * 4 + 0.04], M.rgb('#6a2aa0'), SR.MAT.EMIT);
    }
    const mb = new GL.MB();
    const R = 3.2, n = 32;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * M.TAU, a1 = ((i + 1) / n) * M.TAU;
      for (let k = 0; k < 4; k++) {
        const r0 = (k / 4) * R, r1 = ((k + 1) / 4) * R;
        const P = (a, r) => [Math.cos(a) * r, 0, Math.sin(a) * r];
        mb.quad(P(a0, r0), P(a1, r0), P(a1, r1), P(a0, r1), (i + k) % 2 ? M.rgb('#241a44') : M.rgb('#2e2254'), SR.MAT.LIT);
      }
      const P = (a, r, y) => [Math.cos(a) * r, y, Math.sin(a) * r];
      mb.quad(P(a0, R, 0.001), P(a1, R, 0.001), P(a1, R + 0.12, 0.001), P(a0, R + 0.12, 0.001), M.rgb('#ff3c9e'), SR.MAT.EMIT);
    }
    return { back: bk.build(), stage: mb.build() };
  }
  const studioEnv = { sunDir: M.norm([0.4, 0.85, -0.35]), sunCol: [0.95, 0.9, 0.95], skyAmb: [0.5, 0.45, 0.65], gndAmb: [0.3, 0.2, 0.35], fogCol: M.rgb('#140a28'), fogNear: 12, fogFar: 60 };
  const mm = M.m4(), loc = M.m4(), wm = M.m4();
  function showroom(bikeId, paints, dt, opt) {
    opt = opt || {};
    if (!studio) studio = buildStudio();
    S.spin = (S.spin || 0) + dt * 0.5;
    const a = S.spin, dist = opt.dist || 3.1;
    const cx = opt.cx || 0; // shift the bike left/right on screen
    const eye = [Math.sin(a) * dist, 1.15, Math.cos(a) * dist];
    const target = [0, 0.62, 0];
    const f = M.norm(M.sub(target, eye)), rt = M.norm(M.cross(f, [0, 1, 0]));
    const e2 = M.add(eye, M.mul(rt, -cx)), t2 = M.add(target, M.mul(rt, -cx));
    GL.beginView({ x: 0, y: 0, w: 1, h: 1 }, { eye: e2, target: t2, fov: 0.8, near: 0.1, far: 200 }, studioEnv);
    GL.backdrop(studio.back, null);
    GL.draw(studio.stage, null);
    const bike = SR.bikeById(bikeId), ms = SR.Bikes.get(bike.style), st = ms.style;
    const o = { paint: paints[0], paint2: paints[1], brake: 0 };
    M.model(mm, 0, 0, 0, 0, 0, 0);
    GL.draw(SR.Bikes.shared().shadow, mm, { alpha: 0.5 });
    GL.draw(ms.body, mm, o);
    GL.draw(ms.rider, mm, o);
    for (const [z, r, mesh] of [[st.wf, st.rf, ms.wheelF], [st.wr, st.rr, ms.wheelR]]) {
      M.model(loc, 0, r, z, 0, 0, 0);
      M.mulm(wm, mm, loc);
      GL.draw(mesh, wm, o);
    }
  }

  function title(ctx, y, small) {
    const sc = small ? 3 : 5;
    const sunset = ['#ffe45a', '#ffc040', '#ff9a3a', '#ff6a50', '#ff3c7e', '#e0309e', '#a030c0'];
    const chrome = ['#ffffff', '#dfe8ff', '#a8b8e8', '#5a6aa8', '#c8d8ff', '#ffffff', '#b8c8f0'];
    F.gradient(ctx, 'REDLINE', W / 2, y, sc, (r) => sunset[r], 'center', '#1a0830', small ? 1 : 2);
    F.gradient(ctx, 'RIDERS', W / 2, y + sc * 8 + 2, small ? 2 : 4, (r) => chrome[r], 'center', '#1a0830', 1);
  }
  function header(ctx, text, sub) {
    ctx.fillStyle = 'rgba(10,4,24,0.75)';
    ctx.fillRect(0, 0, W, 22);
    ctx.fillStyle = HOT; ctx.fillRect(0, 22, W, 1);
    F.draw(ctx, text, 8, 8, '#fff', 1, 'left', '#000');
    if (sub) F.draw(ctx, sub, W - 8, 8, GOLD, 1, 'right', '#000');
  }
  function statBars(ctx, bike, up, x, y) {
    const st = SR.bikeStats(bike, up), base = SR.bikeStats(bike, {});
    const rows = [
      ['TOP SPEED', st.vmax * 3.6, base.vmax * 3.6, 190, 390, Math.round(st.vmax * 3.6) + ' KM/H'],
      ['ACCEL', 1 / (bike.acc / (1 + (st.a0 / base.a0 - 1))), 1 / bike.acc, 1 / 5.2, 1 / 2.3, (bike.acc / (st.a0 / base.a0)).toFixed(1) + 'S'],
      ['GRIP', st.lat, base.lat, 17, 29, ''],
      ['OFF-ROAD', st.off, base.off, 0.35, 0.8, ''],
      ['TOUGHNESS', st.crash, base.crash, 16, 25, ''],
    ];
    rows.forEach(([name, v, b, lo, hi, txt], i) => {
      const yy = y + i * 11;
      F.draw(ctx, name, x, yy, '#cfc8ec', 1, 'left', '#000');
      const n = 10, f = Math.round(M.clamp((b - lo) / (hi - lo), 0.05, 1) * n), f2 = Math.round(M.clamp((v - lo) / (hi - lo), 0.05, 1) * n);
      UI2.segs(ctx, x + 62, yy, n, f, NEON, Math.max(0, f2 - f), GOLD);
      if (txt) F.draw(ctx, txt, x + 62 + n * 5 + 4, yy, '#fff', 1, 'left', '#000');
    });
  }
  function wrapText(ctx, text, x, y, w, color) {
    const words = text.toUpperCase().split(' ');
    let line = '', yy = y;
    const maxc = Math.floor(w / 6);
    for (const wd of words) {
      if ((line + ' ' + wd).trim().length > maxc) { F.draw(ctx, line, x, yy, color || '#cfc8ec', 1, 'left', '#000'); yy += 9; line = wd; }
      else line = (line + ' ' + wd).trim();
    }
    if (line) F.draw(ctx, line, x, yy, color || '#cfc8ec', 1, 'left', '#000');
  }
  const cycle = (arr, cur, d) => arr[(arr.indexOf(cur) + d + arr.length) % arr.length];
  const playerSpec = (bikeId, owned) => ({
    name: D().name, bikeId, up: owned ? SR.Save.upgrades(bikeId) : {}, paints: owned ? SR.Save.paints(bikeId) : [M.rgb(SR.bikeById(bikeId).paint), M.rgb(SR.bikeById(bikeId).paint2)], slot: 0,
  });

  /* ============================================================
     BOOT / TITLE / MAIN
     ============================================================ */
  S.list.boot = {
    update() {
      if (SR.Input.anyKey) { A.init(); S.go('title'); }
    },
    draw(ctx) {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      title(ctx, 60);
      if (Math.floor(S.t * 2) % 2 === 0) F.draw(ctx, 'PRESS ANY KEY', W / 2, 150, '#fff', 1, 'center');
      F.draw(ctx, 'HEADPHONES RECOMMENDED', W / 2, 196, DIM, 1, 'center');
    },
  };

  S.list.title = {
    enter() { A.music('title'); },
    update() {
      const k = SR.Input.menu();
      if (k.ok) { A.sfx('select'); S.go('main'); }
    },
    render3d(dt) { demoFrame(dt); },
    draw(ctx, dt) {
      if (demo) SR.HUD.draw(ctx, demo, W, H, dt);
      ctx.fillStyle = 'rgba(8,2,20,0.35)'; ctx.fillRect(0, 0, W, H);
      title(ctx, 36);
      if (Math.floor(S.t * 2) % 2 === 0) F.outline(ctx, 'PRESS START', W / 2, 150, GOLD, 2, 'center');
      F.outline(ctx, 'ENTER / SPACE / A BUTTON', W / 2, 172, '#cfc8ec', 1, 'center');
      F.draw(ctx, '(C) 2026 REDLINE RIDERS   V1.0', W / 2, 202, DIM, 1, 'center', '#000');
      if (demo) F.draw(ctx, demo.track.def.name, 6, 6, '#fff', 1, 'left', '#000');
    },
  };

  S.list.main = {
    enter() {
      A.music('title');
      this.menu = this.menu || Menu([
        { label: 'CHAMPIONSHIP', ok: () => S.go(D().bike ? 'hub' : 'starter'), hint: '8 CUPS · WIN MONEY · UPGRADE YOUR BIKE' },
        { label: 'QUICK RACE', ok: () => S.go('quick'), hint: 'ANY BIKE, ANY TRACK' },
        { label: 'TIME TRIAL', ok: () => S.go('tt'), hint: 'BEAT YOUR GHOST' },
        { label: 'MULTIPLAYER', ok: () => S.go('mp'), hint: 'COMING SOON' },
        { label: 'OPTIONS', ok: () => S.go('options'), hint: 'DIFFICULTY · GEARS · GRAPHICS · SOUND' },
        { label: 'CONTROLS', ok: () => S.go('controls') },
        { label: 'CREDITS', ok: () => S.go('credits') },
      ], { back: () => S.go('title') });
    },
    update() { this.menu.update(); },
    render3d(dt) { demoFrame(dt); },
    draw(ctx) {
      ctx.fillStyle = 'rgba(8,2,20,0.45)'; ctx.fillRect(0, 0, W, H);
      title(ctx, 18, true);
      UI2.panel(ctx, W / 2 - 80, 74, 160, 100);
      this.menu.draw(ctx, W / 2 - 64, 84, 128, 13);
      F.draw(ctx, SR.money(D().money), W - 8, 6, GOLD, 1, 'right', '#000');
    },
  };

  /* ============================================================
     CHAMPIONSHIP
     ============================================================ */
  S.list.starter = {
    enter() {
      this.list = SR.BIKES.filter((b) => b.starter);
      this.i = 0;
      A.music('menu');
    },
    update() {
      const k = SR.Input.menu();
      if (k.left) { this.i = (this.i + this.list.length - 1) % this.list.length; A.sfx('move'); }
      if (k.right) { this.i = (this.i + 1) % this.list.length; A.sfx('move'); }
      if (k.back) { A.sfx('back'); S.go('main'); }
      if (k.ok) {
        const b = this.list[this.i];
        D().owned = [b.id]; D().bike = b.id; save();
        A.sfx('buy');
        S.go('hub');
      }
    },
    render3d(dt) { const b = this.list[this.i]; showroom(b.id, [M.rgb(b.paint), M.rgb(b.paint2)], dt, { cx: 0.55 }); },
    draw(ctx) {
      const b = this.list[this.i];
      header(ctx, 'CHOOSE YOUR FIRST BIKE', (this.i + 1) + '/' + this.list.length);
      UI2.panel(ctx, 8, 30, 176, 160, { title: b.brand });
      F.draw(ctx, b.name, 16, 40, '#fff', 2, 'left', '#000');
      wrapText(ctx, b.desc, 16, 60, 160);
      statBars(ctx, b, {}, 16, 100);
      F.draw(ctx, '◄ ►  BROWSE    ENTER  PICK', 16, 172, GOLD, 1, 'left', '#000');
    },
  };

  S.list.hub = {
    enter() {
      A.music('menu');
      const d = D();
      this.menu = Menu([
        {
          label: () => (d.champ ? 'CONTINUE: ' + SR.CUPS[d.champ.cup].name : 'START A CUP'),
          ok: () => (d.champ ? S.go('prerace') : S.go('cups')),
          hint: () => (d.champ ? 'RACE ' + (d.champ.race + 1) + ' OF 4' : 'PICK A CUP TO ENTER'),
        },
        { label: 'ABANDON CUP', hidden: () => !d.champ, ok: () => { d.champ = null; save(); A.sfx('back'); }, hint: 'YOU KEEP YOUR MONEY' },
        { label: 'SHOP', ok: () => S.go('shop'), hint: 'UPGRADE YOUR BIKE' },
        { label: 'DEALER', ok: () => S.go('dealer'), hint: 'BUY NEW BIKES' },
        { label: 'GARAGE', ok: () => S.go('garage'), hint: 'SWITCH BIKE · CHANGE PAINT' },
        { label: 'BACK', ok: () => S.go('main') },
      ], { back: () => S.go('main') });
    },
    update() { this.menu.update(); },
    render3d(dt) { showroom(D().bike, SR.Save.paints(D().bike), dt, { cx: -0.7 }); },
    draw(ctx) {
      const d = D(), b = SR.bikeById(d.bike);
      header(ctx, 'CHAMPIONSHIP', SR.money(d.money));
      UI2.panel(ctx, W - 178, 32, 170, 96, { title: 'MENU' });
      this.menu.draw(ctx, W - 168, 42, 150, 13);
      UI2.panel(ctx, W - 178, 138, 170, 60, { title: 'RIDER' });
      F.draw(ctx, b.brand + ' ' + b.name, W - 170, 148, '#fff', 1, 'left', '#000');
      F.draw(ctx, 'CUPS OPEN: ' + d.cupUnlocked + '/8', W - 170, 160, '#cfc8ec', 1, 'left', '#000');
      F.draw(ctx, 'WINS ' + d.stats.wins + '  PODIUMS ' + d.stats.podiums, W - 170, 172, '#cfc8ec', 1, 'left', '#000');
      F.draw(ctx, 'BIKES OWNED ' + d.owned.length + '/' + SR.BIKES.length, W - 170, 184, '#cfc8ec', 1, 'left', '#000');
    },
  };

  S.list.cups = {
    enter() { this.i = Math.min(D().cupUnlocked - 1, 7); },
    update() {
      const k = SR.Input.menu();
      if (k.up) { this.i = (this.i + 7) % 8; A.sfx('move'); }
      if (k.down) { this.i = (this.i + 1) % 8; A.sfx('move'); }
      if (k.back) { A.sfx('back'); S.go('hub'); }
      if (k.ok) {
        if (this.i >= D().cupUnlocked) { A.sfx('error'); return; }
        A.sfx('select');
        const d = D();
        const field = SR.Race.buildField(this.i, SR.RACERS - 1, d.opt.diff, Math.floor(Math.random() * 1e6));
        const pts = {}; field.forEach((f) => { pts[f.name] = 0; }); pts[d.name] = 0;
        d.champ = { cup: this.i, race: 0, field, pts, history: [] };
        save();
        S.go('prerace');
      }
    },
    render3d(dt) { showroom(D().bike, SR.Save.paints(D().bike), dt, { cx: 0.9, dist: 3.8 }); },
    draw(ctx) {
      const d = D();
      header(ctx, 'SELECT A CUP', SR.money(d.money));
      UI2.panel(ctx, 8, 30, 214, 176);
      SR.CUPS.forEach((c, i) => {
        const y = 40 + i * 20, locked = i >= d.cupUnlocked, sel = i === this.i;
        if (sel) { ctx.fillStyle = 'rgba(255,60,158,0.28)'; ctx.fillRect(12, y - 3, 206, 18); }
        // flag
        c.flag.forEach((fc, k) => { ctx.fillStyle = locked ? '#333' : fc; ctx.fillRect(18 + k * 5, y, 5, 10); });
        F.draw(ctx, c.name, 38, y, locked ? '#5a5470' : sel ? '#fff' : '#cfc8ec', 1, 'left', '#000');
        F.draw(ctx, locked ? 'LOCKED' : 'PRIZE ' + SR.money(c.prize), 38, y + 8, locked ? '#5a5470' : DIM, 1, 'left', '#000');
        const best = d.cupBest[i];
        if (best) F.draw(ctx, best === 1 ? '★ GOLD' : best === 2 ? '★ SILVER' : best === 3 ? '★ BRONZE' : SR.ord(best), 212, y + 3, best === 1 ? GOLD : best === 2 ? '#d0d8e8' : best === 3 ? '#e09050' : DIM, 1, 'right', '#000');
      });
      const c = SR.CUPS[this.i];
      UI2.panel(ctx, 230, 120, 146, 86, { title: 'TRACKS' });
      c.tracks.forEach((t, k) => F.draw(ctx, (k + 1) + ' ' + t.name, 238, 132 + k * 11, this.i >= d.cupUnlocked ? '#5a5470' : '#fff', 1, 'left', '#000'));
      F.draw(ctx, 'FINISH TOP 3 TO UNLOCK THE NEXT CUP', W / 2 + 60, 30, DIM, 1, 'center', '#000');
    },
  };

  // builds the race for the current championship round / quick race / time trial
  S.list.prerace = {
    enter(args) {
      const d = D();
      this.args = args;
      if (args.quick) { this.kind = 'quick'; this.def = args.def; }
      else if (args.tt) { this.kind = 'tt'; this.def = args.def; }
      else { this.kind = 'champ'; this.def = SR.CUPS[d.champ.cup].tracks[d.champ.race]; }
      this.race = null;
      this.buildAt = S.t + 0.05; // let one frame show "loading"
      A.music('menu');
    },
    build() {
      const d = D(), def = this.def;
      dropDemo();
      let cfg;
      if (this.kind === 'champ') {
        cfg = { trackDef: def, laps: SR.LAPS, mode: 'champ', locals: [playerSpec(d.bike, true)], rivals: d.champ.field, diff: d.opt.diff, trans: d.opt.trans };
      } else if (this.kind === 'quick') {
        const a = this.args;
        cfg = { trackDef: def, laps: a.laps, mode: 'quick', locals: [playerSpec(a.bike, d.owned.includes(a.bike))], rivals: SR.Race.buildField(def.cup, a.rivals, d.opt.diff, def.seed), diff: d.opt.diff, trans: d.opt.trans };
      } else {
        const a = this.args;
        cfg = { trackDef: def, laps: 5, mode: 'tt', locals: [playerSpec(a.bike, d.owned.includes(a.bike))], rivals: [], trans: d.opt.trans, ghost: d.ghosts[def.id] || null };
      }
      this.race = SR.Race.create(cfg);
    },
    update() {
      if (!this.race && S.t >= this.buildAt) this.build();
      if (!this.race) return;
      const k = SR.Input.menu();
      if (k.ok) { A.sfx('select'); S.go('race', { race: this.race, kind: this.kind, args: this.args }); this.race = null; }
      if (k.back) {
        A.sfx('back');
        disposeRace(this.race); this.race = null;
        S.go(this.kind === 'champ' ? 'hub' : this.kind === 'quick' ? 'quick' : 'tt');
      }
    },
    render3d(dt) {
      if (!this.race) return;
      // slow flyover of the start
      const r = this.race, T = r.track, s = (S.t * 12) % T.L;
      const eye = T.pos(s, -T.RW - 14); eye[1] += 10;
      const tgt = T.pos(s + 40, 0); tgt[1] += 2;
      GL.beginView({ x: 0, y: 0, w: 1, h: 1 }, { eye, target: tgt, fov: 1.0, near: 0.3, far: 1500 }, T.env);
      M.model(mm, eye[0], eye[1], eye[2], 0, 0, 0);
      GL.backdrop(T.sky, mm);
      GL.backdrop(T.ground, null, null, !!T.theme.water);
      T.chunks.forEach((c) => GL.draw(c, null));
    },
    draw(ctx) {
      const d = D(), def = this.def, cup = SR.CUPS[def.cup];
      if (!this.race) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); F.draw(ctx, 'LOADING TRACK...', W / 2, H / 2, '#fff', 1, 'center'); return; }
      header(ctx, this.kind === 'champ' ? cup.name + ' CUP · RACE ' + (d.champ.race + 1) + '/4' : this.kind === 'quick' ? 'QUICK RACE' : 'TIME TRIAL', SR.money(d.money));
      UI2.panel(ctx, 8, 30, 190, 132, { title: 'TRACK' });
      F.draw(ctx, def.name, 16, 42, '#fff', 2, 'left', '#000');
      const T = this.race.track;
      const rows = [
        ['COUNTRY', cup.name], ['LENGTH', (T.L / 1000).toFixed(2) + ' KM'], ['LAPS', String(this.race.laps)],
        ['TIME', SR.TIMES[def.time].name], ['WEATHER', SR.WEATHER[def.weather].name],
        ['RECORD', d.records[def.id] && d.records[def.id].lap ? SR.fmtTime(d.records[def.id].lap) : '--'],
      ];
      rows.forEach(([a, b], i) => { F.draw(ctx, a, 16, 64 + i * 11, DIM, 1, 'left', '#000'); F.draw(ctx, b, 190, 64 + i * 11, '#fff', 1, 'right', '#000'); });
      // map
      UI2.panel(ctx, W - 108, 30, 100, 100, { title: 'MAP' });
      const m = T.map, sc = 80, ox = W - 98 + (sc - m.w * sc) / 2, oy = 40 + (sc - m.h * sc) / 2;
      ctx.fillStyle = '#fff';
      m.pts.forEach(([u, v]) => ctx.fillRect(Math.round(ox + u * sc), Math.round(oy + v * sc), 2, 2));
      const [su, sv] = T.mapXY(0);
      ctx.fillStyle = HOT; ctx.fillRect(Math.round(ox + su * sc) - 2, Math.round(oy + sv * sc) - 2, 5, 5);
      if (this.kind === 'tt') F.draw(ctx, d.ghosts[def.id] ? 'GHOST: ' + SR.fmtTime(d.ghosts[def.id].t) : 'NO GHOST YET', 16, 150, NEON, 1, 'left', '#000');
      if (Math.floor(S.t * 2) % 2 === 0) F.outline(ctx, 'PRESS START', W / 2, 176, GOLD, 2, 'center');
      F.draw(ctx, 'ESC  BACK', W / 2, 200, DIM, 1, 'center', '#000');
    },
  };

  /* ============================================================
     RACE + PAUSE
     ============================================================ */
  S.list.race = {
    enter(args) {
      this.race = args.race; this.kind = args.kind; this.args = args.args;
      this.paused = false;
      A.music(['race1', 'race2', 'race3'][this.race.track.def.seed % 3]);
      const self = this;
      this.pmenu = Menu([
        { label: 'RESUME', ok: () => { self.paused = false; } },
        { label: 'RESTART', ok: () => self.restart() },
        { label: () => 'CAMERA', value: () => ['CHASE', 'FAR', 'HELMET'][D().opt.cam], left: () => self.cam(-1), right: () => self.cam(1) },
        { label: 'QUIT RACE', ok: () => self.quit() },
      ], { back: () => { self.paused = false; } });
    },
    cam(dir) { const d = D(); d.opt.cam = (d.opt.cam + dir + 3) % 3; this.race.cams.forEach((c) => { c.mode = d.opt.cam; }); save(); },
    restart() {
      const cfg = this.race.cfg;
      disposeRace(this.race);
      if (cfg.mode === 'tt') cfg.ghost = D().ghosts[cfg.trackDef.id] || null;
      this.race = SR.Race.create(cfg);
      this.paused = false;
    },
    quit() {
      disposeRace(this.race);
      this.race = null;
      S.go(this.kind === 'champ' ? 'hub' : this.kind === 'quick' ? 'quick' : 'tt');
    },
    exit() { if (this.race && this.race.sounds) this.race.stopAudio(); },
    update(dt) {
      if (!this.race) return;
      if (this.paused) { this.pmenu.update(); return; }
      if (SR.Input.pausePressed()) { this.paused = true; this.pmenu.i = 0; A.sfx('back'); return; }
      if (SR.Input.cameraPressed()) this.cam(1);
      if (SR.Input.key('KeyM')) A.toggleMusic();
      this.race.update(dt);
      if (this.race.mode === 'tt' && this.race.newGhost) {
        const d = D(), g = this.race.newGhost, id = this.race.track.def.id;
        if (!d.ghosts[id] || g.t < d.ghosts[id].t) { d.ghosts[id] = g; this.race.ghostData = g; }
        this.race.newGhost = null;
        save();
      }
      if (this.race.phase === 'done') {
        const r = this.race;
        this.race = null;
        S.go('results', { race: r, kind: this.kind, args: this.args });
      }
    },
    render3d(dt) { if (this.race) this.race.render(this.paused ? 0 : dt); },
    draw(ctx, dt) {
      if (!this.race) return;
      SR.HUD.draw(ctx, this.race, W, H, this.paused ? 0 : dt);
      if (this.paused) {
        ctx.fillStyle = 'rgba(8,2,20,0.55)'; ctx.fillRect(0, 0, W, H);
        F.outline(ctx, 'PAUSED', W / 2, 50, GOLD, 3, 'center');
        UI2.panel(ctx, W / 2 - 80, 84, 160, 62);
        this.pmenu.draw(ctx, W / 2 - 64, 94, 128, 12);
      }
    },
  };

  /* ============================================================
     RESULTS / STANDINGS / CUP END
     ============================================================ */
  S.list.results = {
    enter(args) {
      const r = args.race, d = D();
      this.race = r; this.kind = args.kind; this.args = args.args;
      A.music('menu');
      const me = r.locals[0];
      // estimated times for riders still on track
      const rows = r.order.map((q) => {
        let t = q.finished ? q.finishT : null;
        if (t === null) { const rem = r.laps * r.track.L - q.d; t = r.clock + rem / Math.max(20, q.v || 20); }
        return { q, name: q.name, bike: q.bike, t, best: q.bestLap, local: q.local };
      });
      rows.sort((a, b) => a.t - b.t);
      this.rows = rows;
      this.place = rows.findIndex((x) => x.local) + 1;
      this.prize = 0; this.bonus = 0;
      const tid = r.track.def.id;
      const rec = d.records[tid] || {};
      this.newRecord = false;
      if (me.bestLap && (!rec.lap || me.bestLap < rec.lap)) { rec.lap = me.bestLap; this.newRecord = true; }
      if (me.finished && r.mode !== 'tt' && (!rec.race || me.finishT < rec.race)) rec.race = me.finishT;
      d.records[tid] = rec;
      if (r.mode !== 'tt') {
        d.stats.races++;
        if (this.place === 1) d.stats.wins++;
        if (this.place <= 3) d.stats.podiums++;
      }
      if (r.mode === 'champ') {
        const cup = SR.CUPS[d.champ.cup];
        this.prize = Math.round(cup.prize * (SR.PRIZE_MULT[this.place - 1] || 0));
        if (this.newRecord) this.bonus += 500 * (d.champ.cup + 1);
        if (me.crashes === 0) this.bonus += 250 * (d.champ.cup + 1);
        d.money += this.prize + this.bonus;
        rows.forEach((row, i) => { d.champ.pts[row.name] = (d.champ.pts[row.name] || 0) + (SR.POINTS[i] || 0); });
        d.champ.history.push(this.place);
      } else if (r.mode === 'quick') {
        this.prize = Math.round(SR.CUPS[r.track.def.cup].prize * 0.15 * (SR.PRIZE_MULT[this.place - 1] || 0));
        d.money += this.prize;
      }
      save();
      disposeRace(r);
    },
    update() {
      const k = SR.Input.menu();
      if (!k.ok && !k.back) return;
      A.sfx('select');
      const d = D();
      if (this.kind === 'champ') S.go('standings');
      else if (this.kind === 'quick') S.go('quick');
      else S.go('tt');
    },
    render3d(dt) { showroom(this.rows.find((x) => x.local).bike.id, this.race.locals[0] ? [this.race.locals[0].paint, this.race.locals[0].paint2] : [[1, 1, 1], [0, 0, 0]], dt, { cx: 1.1, dist: 4.2 }); },
    draw(ctx) {
      const r = this.race, tt = r.mode === 'tt';
      header(ctx, tt ? 'TIME TRIAL RESULTS' : 'RACE RESULTS', r.track.def.name);
      if (!tt) F.outline(ctx, this.place === 1 ? 'YOU WIN!' : SR.ord(this.place) + ' PLACE', 10, 30, this.place <= 3 ? GOLD : '#fff', 2);
      UI2.panel(ctx, 8, tt ? 30 : 50, 236, tt ? 90 : 158);
      if (tt) {
        const me = r.locals[0];
        F.draw(ctx, 'BEST LAP', 16, 42, DIM, 1, 'left', '#000'); F.draw(ctx, SR.fmtTime(me.bestLap), 236, 42, '#fff', 1, 'right', '#000');
        F.draw(ctx, 'LAPS', 16, 54, DIM, 1, 'left', '#000'); F.draw(ctx, String(me.lapsDone), 236, 54, '#fff', 1, 'right', '#000');
        const g = D().ghosts[r.track.def.id];
        F.draw(ctx, 'GHOST', 16, 66, DIM, 1, 'left', '#000'); F.draw(ctx, g ? SR.fmtTime(g.t) : '--', 236, 66, NEON, 1, 'right', '#000');
        if (this.newRecord) F.outline(ctx, 'NEW TRACK RECORD!', 126, 90, GOLD, 1, 'center');
      } else {
        this.rows.forEach((row, i) => {
          const y = 58 + i * 12;
          if (row.local) { ctx.fillStyle = 'rgba(255,60,158,0.3)'; ctx.fillRect(12, y - 2, 228, 11); }
          F.draw(ctx, String(i + 1).padStart(2, ' '), 16, y, i < 3 ? GOLD : DIM, 1, 'left', '#000');
          F.draw(ctx, row.name, 34, y, row.local ? '#fff' : '#cfc8ec', 1, 'left', '#000');
          F.draw(ctx, row.bike.name, 110, y, DIM, 1, 'left', '#000');
          F.draw(ctx, row.q.finished ? SR.fmtTime(row.t) : '+' + SR.fmtTime(row.t - this.rows[0].t), 236, y, '#fff', 1, 'right', '#000');
        });
      }
      if (!tt) {
        UI2.panel(ctx, 252, 150, 124, 58, { title: 'EARNINGS' });
        F.draw(ctx, 'PRIZE', 260, 162, DIM, 1, 'left', '#000'); F.draw(ctx, SR.money(this.prize), 368, 162, GOLD, 1, 'right', '#000');
        F.draw(ctx, 'BONUS', 260, 174, DIM, 1, 'left', '#000'); F.draw(ctx, SR.money(this.bonus), 368, 174, GOLD, 1, 'right', '#000');
        F.draw(ctx, 'BANK', 260, 190, DIM, 1, 'left', '#000'); F.draw(ctx, SR.money(D().money), 368, 190, '#fff', 1, 'right', '#000');
        if (this.newRecord) F.outline(ctx, 'LAP RECORD!', 314, 136, NEON, 1, 'center');
      }
      if (Math.floor(S.t * 2) % 2 === 0) F.draw(ctx, 'PRESS ENTER', tt ? 126 : 314, tt ? 130 : 30, '#fff', 1, 'center', '#000');
    },
  };

  S.list.standings = {
    enter() {
      const d = D(), c = d.champ;
      this.last = c.race >= 3;
      this.table = Object.keys(c.pts).map((n) => ({ name: n, pts: c.pts[n], me: n === d.name })).sort((a, b) => b.pts - a.pts);
      if (!this.last) { c.race++; save(); }
    },
    update() {
      const k = SR.Input.menu();
      if (!k.ok && !k.back) return;
      A.sfx('select');
      if (this.last) S.go('cupend', { table: this.table });
      else S.go('hub');
    },
    render3d(dt) { showroom(D().bike, SR.Save.paints(D().bike), dt, { cx: 1.1, dist: 4.2 }); },
    draw(ctx) {
      const d = D(), c = d.champ;
      header(ctx, SR.CUPS[c.cup].name + ' CUP STANDINGS', this.last ? 'FINAL' : 'AFTER RACE ' + c.race);
      UI2.panel(ctx, 8, 30, 200, 178);
      this.table.forEach((row, i) => {
        const y = 38 + i * 14;
        if (row.me) { ctx.fillStyle = 'rgba(255,60,158,0.3)'; ctx.fillRect(12, y - 2, 192, 12); }
        F.draw(ctx, String(i + 1).padStart(2, ' '), 16, y, i < 3 ? GOLD : DIM, 1, 'left', '#000');
        F.draw(ctx, row.name, 36, y, row.me ? '#fff' : '#cfc8ec', 1, 'left', '#000');
        F.draw(ctx, row.pts + ' PTS', 200, y, '#fff', 1, 'right', '#000');
      });
      F.draw(ctx, this.last ? 'PRESS ENTER FOR THE TROPHIES' : 'PRESS ENTER', 300, 196, '#fff', 1, 'center', '#000');
    },
  };

  S.list.cupend = {
    enter(args) {
      const d = D(), c = d.champ;
      this.cup = c.cup;
      this.place = args.table.findIndex((r) => r.me) + 1;
      this.bonus = this.place <= 3 ? SR.CUPS[c.cup].prize * [3, 2, 1][this.place - 1] : 0;
      d.money += this.bonus;
      if (!d.cupBest[c.cup] || this.place < d.cupBest[c.cup]) d.cupBest[c.cup] = this.place;
      this.unlocked = false;
      if (this.place <= 3 && d.cupUnlocked === c.cup + 1 && d.cupUnlocked < 8) { d.cupUnlocked++; this.unlocked = true; }
      d.champ = null;
      save();
      A.sfx(this.place <= 3 ? 'win' : 'lose');
      this.confetti = [];
      for (let i = 0; i < 80; i++) this.confetti.push({ x: Math.random() * W, y: -Math.random() * H, v: 20 + Math.random() * 40, c: ['#ff3c9e', '#3de0ff', '#ffd21a', '#fff', '#5dbb1c'][i % 5] });
    },
    update(dt) {
      this.confetti.forEach((p) => { p.y += p.v * dt; p.x += Math.sin(p.y * 0.05) * 0.4; if (p.y > H) p.y -= H + 10; });
      const k = SR.Input.menu();
      if (k.ok || k.back) { A.sfx('select'); S.go('hub'); }
    },
    render3d(dt) { showroom(D().bike, SR.Save.paints(D().bike), dt, { cx: -1.0, dist: 4 }); },
    draw(ctx) {
      header(ctx, SR.CUPS[this.cup].name + ' CUP', 'FINAL');
      const podium = this.place <= 3;
      if (podium) this.confetti.forEach((p) => { ctx.fillStyle = p.c; ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2); });
      const col = ['#ffd21a', '#d0d8e8', '#e09050'][this.place - 1] || '#5a5470';
      trophy(ctx, 290, 60, col, podium);
      F.outline(ctx, podium ? ['GOLD', 'SILVER', 'BRONZE'][this.place - 1] + ' TROPHY!' : 'NO TROPHY THIS TIME', 290, 150, podium ? col : '#fff', 2, 'center');
      F.outline(ctx, 'CUP FINISH: ' + SR.ord(this.place), 290, 170, '#fff', 1, 'center');
      if (this.bonus) F.outline(ctx, 'CUP BONUS ' + SR.money(this.bonus), 290, 182, GOLD, 1, 'center');
      if (this.unlocked) F.outline(ctx, 'NEW CUP UNLOCKED: ' + SR.CUPS[this.cup + 1].name, 290, 194, NEON, 1, 'center');
      if (!podium) F.outline(ctx, 'FINISH TOP 3 TO UNLOCK THE NEXT CUP', 290, 194, DIM, 1, 'center');
    },
  };
  function trophy(ctx, cx, y, col, shine) {
    const dark = '#000';
    const rect = (x, yy, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(cx + x), Math.round(y + yy), w, h); };
    rect(-22, 0, 44, 4, dark); rect(-21, 1, 42, 2, col);
    for (let i = 0; i < 26; i++) { const w = Math.round(40 - i * i * 0.04); rect(-w / 2 - 1, 3 + i, w + 2, 1, dark); rect(-w / 2, 3 + i, w, 1, col); }
    rect(-30, 6, 8, 3, col); rect(-32, 6, 3, 14, col); rect(-30, 18, 8, 3, col);
    rect(22, 6, 8, 3, col); rect(29, 6, 3, 14, col); rect(22, 18, 8, 3, col);
    rect(-4, 29, 8, 14, col); rect(-12, 43, 24, 4, col); rect(-18, 47, 36, 10, '#3a2a1a'); rect(-14, 50, 28, 4, col);
    if (shine) rect(-14, 6, 3, 12, '#fff');
  }

  /* ============================================================
     SHOP / DEALER / GARAGE
     ============================================================ */
  S.list.shop = {
    enter() {
      const d = D();
      this.menu = Menu(SR.UPGRADES.map((u) => ({
        label: u.name,
        value: () => { const l = SR.Save.upgrades(d.bike)[u.id] || 0; return l >= SR.UP_MAX ? 'MAX' : SR.money(SR.upCost(u, l)); },
        disabled: () => { const l = SR.Save.upgrades(d.bike)[u.id] || 0; return l >= SR.UP_MAX || d.money < SR.upCost(u, l); },
        ok: () => {
          const up = SR.Save.upgrades(d.bike), l = up[u.id] || 0, c = SR.upCost(u, l);
          if (l < SR.UP_MAX && d.money >= c) { d.money -= c; up[u.id] = l + 1; save(); A.sfx('buy'); }
        },
        hint: u.desc,
      })).concat([{ label: 'BACK', ok: () => S.go('hub') }]), { back: () => S.go('hub') });
    },
    update() { this.menu.update(); },
    render3d(dt) { showroom(D().bike, SR.Save.paints(D().bike), dt, { cx: -0.75 }); },
    draw(ctx) {
      const d = D(), b = SR.bikeById(d.bike), up = SR.Save.upgrades(d.bike);
      header(ctx, 'SHOP · ' + b.name, SR.money(d.money));
      UI2.panel(ctx, W - 200, 30, 192, 104, { title: 'UPGRADES' });
      this.menu.draw(ctx, W - 190, 40, 174, 13);
      SR.UPGRADES.forEach((u, i) => UI2.segs(ctx, W - 118, 42 + i * 13, SR.UP_MAX, up[u.id] || 0, GOLD));
      UI2.panel(ctx, W - 200, 142, 192, 64, { title: 'STATS' });
      statBars(ctx, b, up, W - 192, 150);
    },
  };

  S.list.dealer = {
    enter() {
      this.list = SR.BIKES.slice().sort((a, b) => a.price - b.price || a.top - b.top);
      this.i = Math.max(0, this.list.findIndex((b) => b.id === D().bike));
      A.music('menu');
    },
    update() {
      const k = SR.Input.menu(), d = D(), b = this.list[this.i];
      if (k.left) { this.i = (this.i + this.list.length - 1) % this.list.length; A.sfx('move'); }
      if (k.right) { this.i = (this.i + 1) % this.list.length; A.sfx('move'); }
      if (k.back) { A.sfx('back'); S.go('hub'); }
      if (k.ok) {
        if (d.owned.includes(b.id)) { d.bike = b.id; save(); A.sfx('select'); }
        else if (d.money >= b.price) { d.money -= b.price; d.owned.push(b.id); d.bike = b.id; save(); A.sfx('buy'); }
        else A.sfx('error');
      }
    },
    render3d(dt) { const b = this.list[this.i]; showroom(b.id, D().owned.includes(b.id) ? SR.Save.paints(b.id) : [M.rgb(b.paint), M.rgb(b.paint2)], dt, { cx: 0.55 }); },
    draw(ctx) {
      const d = D(), b = this.list[this.i], owned = d.owned.includes(b.id);
      header(ctx, 'DEALER  ' + (this.i + 1) + '/' + this.list.length, SR.money(d.money));
      UI2.panel(ctx, 8, 30, 176, 170, { title: b.brand });
      F.draw(ctx, b.name, 16, 40, '#fff', 2, 'left', '#000');
      wrapText(ctx, b.desc, 16, 60, 160);
      statBars(ctx, b, owned ? SR.Save.upgrades(b.id) : {}, 16, 100);
      const price = b.price ? SR.money(b.price) : 'STARTER';
      F.draw(ctx, owned ? (d.bike === b.id ? 'YOUR BIKE' : 'OWNED - ENTER TO RIDE') : 'PRICE ' + price, 16, 160, owned ? NEON : d.money >= b.price ? GOLD : '#ff6060', 1, 'left', '#000');
      F.draw(ctx, '◄ ►  BROWSE   ENTER  ' + (owned ? 'SELECT' : 'BUY'), 16, 184, DIM, 1, 'left', '#000');
    },
  };

  S.list.garage = {
    enter() {
      const d = D();
      this.i = Math.max(0, d.owned.indexOf(d.bike));
      const self = this;
      const cur = () => d.owned[self.i];
      const pnt = () => (d.paint[cur()] = d.paint[cur()] || [SR.PAINTS.indexOf(SR.bikeById(cur()).paint), SR.PAINTS.indexOf(SR.bikeById(cur()).paint2)].map((x) => Math.max(0, x)));
      this.menu = Menu([
        { label: 'BIKE', value: () => SR.bikeById(cur()).name, left: () => { self.i = (self.i + d.owned.length - 1) % d.owned.length; d.bike = cur(); save(); }, right: () => { self.i = (self.i + 1) % d.owned.length; d.bike = cur(); save(); } },
        { label: 'MAIN COLOUR', value: () => '■', left: () => { const p = pnt(); p[0] = (p[0] + SR.PAINTS.length - 1) % SR.PAINTS.length; save(); }, right: () => { const p = pnt(); p[0] = (p[0] + 1) % SR.PAINTS.length; save(); } },
        { label: 'ACCENT COLOUR', value: () => '■', left: () => { const p = pnt(); p[1] = (p[1] + SR.PAINTS.length - 1) % SR.PAINTS.length; save(); }, right: () => { const p = pnt(); p[1] = (p[1] + 1) % SR.PAINTS.length; save(); } },
        { label: 'FACTORY COLOURS', ok: () => { delete d.paint[cur()]; save(); } },
        { label: 'BACK', ok: () => S.go('hub') },
      ], { back: () => S.go('hub') });
    },
    update() { this.menu.update(); },
    render3d(dt) { showroom(D().bike, SR.Save.paints(D().bike), dt, { cx: -0.75 }); },
    draw(ctx) {
      const d = D();
      header(ctx, 'GARAGE', SR.money(d.money));
      UI2.panel(ctx, W - 200, 30, 192, 78, { title: 'YOUR BIKES ' + d.owned.length });
      this.menu.draw(ctx, W - 190, 40, 174, 13);
      const [p1, p2] = SR.Save.paints(d.bike);
      ctx.fillStyle = M.css(p1); ctx.fillRect(W - 32, 53, 12, 7);
      ctx.fillStyle = M.css(p2); ctx.fillRect(W - 32, 66, 12, 7);
    },
  };

  /* ============================================================
     QUICK RACE / TIME TRIAL setup
     ============================================================ */
  function setupScreen(kind) {
    return {
      enter() {
        const d = D();
        this.s = this.s || { bike: d.bike || SR.BIKES[0].id, track: 0, laps: 3, rivals: 11 };
        const s = this.s;
        const items = [
          { label: 'BIKE', value: () => SR.bikeById(s.bike).name + (D().owned.includes(s.bike) ? '' : ' (STOCK)'), left: () => { s.bike = cycle(SR.BIKES.map((b) => b.id), s.bike, -1); }, right: () => { s.bike = cycle(SR.BIKES.map((b) => b.id), s.bike, 1); }, hint: 'OWNED BIKES KEEP THEIR UPGRADES' },
          { label: 'TRACK', value: () => SR.TRACKS[s.track].name, left: () => { s.track = (s.track + SR.TRACKS.length - 1) % SR.TRACKS.length; }, right: () => { s.track = (s.track + 1) % SR.TRACKS.length; }, hint: () => { const t = SR.TRACKS[s.track]; return SR.CUPS[t.cup].name + ' · ' + SR.TIMES[t.time].name + ' · ' + SR.WEATHER[t.weather].name; } },
        ];
        if (kind === 'quick') {
          items.push({ label: 'LAPS', value: () => String(s.laps), left: () => { s.laps = Math.max(1, s.laps - 1); }, right: () => { s.laps = Math.min(9, s.laps + 1); } });
          items.push({ label: 'RIVALS', value: () => String(s.rivals), left: () => { s.rivals = cycle([0, 3, 7, 11], s.rivals, -1); }, right: () => { s.rivals = cycle([0, 3, 7, 11], s.rivals, 1); } });
          items.push({ label: 'DIFFICULTY', value: () => SR.DIFF[D().opt.diff].name, left: () => { D().opt.diff = cycle(['easy', 'normal', 'hard'], D().opt.diff, -1); save(); }, right: () => { D().opt.diff = cycle(['easy', 'normal', 'hard'], D().opt.diff, 1); save(); } });
        }
        items.push({ label: 'START', ok: () => S.go('prerace', kind === 'quick' ? { quick: true, def: SR.TRACKS[s.track], bike: s.bike, laps: s.laps, rivals: s.rivals } : { tt: true, def: SR.TRACKS[s.track], bike: s.bike }) });
        items.push({ label: 'BACK', ok: () => S.go('main') });
        this.menu = Menu(items, { back: () => S.go('main') });
        this.menu.i = items.length - 2;
        A.music('menu');
      },
      update() { this.menu.update(); },
      render3d(dt) { const id = this.s.bike, owned = D().owned.includes(id), b = SR.bikeById(id); showroom(id, owned ? SR.Save.paints(id) : [M.rgb(b.paint), M.rgb(b.paint2)], dt, { cx: -0.8 }); },
      draw(ctx) {
        header(ctx, kind === 'quick' ? 'QUICK RACE' : 'TIME TRIAL', SR.money(D().money));
        const n = this.menu.items.length;
        UI2.panel(ctx, W - 214, 30, 206, n * 13 + 16, { title: 'SETUP' });
        this.menu.draw(ctx, W - 204, 40, 188, 13);
        const t = SR.TRACKS[this.s.track], rec = D().records[t.id];
        UI2.panel(ctx, W - 214, 40 + n * 13 + 16, 206, 30, { title: 'RECORD' });
        F.draw(ctx, rec && rec.lap ? 'BEST LAP ' + SR.fmtTime(rec.lap) : 'NO RECORD YET', W - 204, 40 + n * 13 + 28, NEON, 1, 'left', '#000');
      },
    };
  }
  S.list.quick = setupScreen('quick');
  S.list.tt = setupScreen('tt');

  /* ============================================================
     OPTIONS / CONTROLS / MULTIPLAYER / CREDITS
     ============================================================ */
  S.list.options = {
    enter() {
      const o = D().opt;
      const tog = (k) => ({ left: () => { o[k] = !o[k]; SR.applyOptions(); save(); }, right: () => { o[k] = !o[k]; SR.applyOptions(); save(); }, value: () => (o[k] ? 'ON' : 'OFF') });
      const cyc = (k, list, names) => ({
        left: () => { o[k] = cycle(list, o[k], -1); SR.applyOptions(); save(); }, right: () => { o[k] = cycle(list, o[k], 1); SR.applyOptions(); save(); },
        value: () => names[list.indexOf(o[k])],
      });
      const vol = (k) => ({
        left: () => { o[k] = Math.max(0, Math.round((o[k] - 0.1) * 10) / 10); SR.applyOptions(); save(); },
        right: () => { o[k] = Math.min(1, Math.round((o[k] + 0.1) * 10) / 10); SR.applyOptions(); save(); A.sfx('coin'); },
        value: () => '■'.repeat(Math.round(o[k] * 10)) + '.'.repeat(10 - Math.round(o[k] * 10)),
      });
      this.confirm = false;
      const self = this;
      this.menu = Menu([
        Object.assign({ label: 'DIFFICULTY', hint: 'HOW FAST THE RIVALS RIDE' }, cyc('diff', ['easy', 'normal', 'hard'], ['EASY', 'NORMAL', 'HARD'])),
        Object.assign({ label: 'GEARS', hint: 'MANUAL: E / Q OR RB / LB TO SHIFT' }, cyc('trans', ['auto', 'manual'], ['AUTO', 'MANUAL'])),
        Object.assign({ label: 'SPEED UNITS' }, cyc('units', ['kmh', 'mph'], ['KM/H', 'MPH'])),
        Object.assign({ label: 'CAMERA', hint: 'C / Y BUTTON CHANGES IT IN A RACE' }, cyc('cam', [0, 1, 2], ['CHASE', 'FAR', 'HELMET'])),
        Object.assign({ label: '3D RESOLUTION', hint: 'LOWER = CHUNKIER PIXELS AND FASTER' }, cyc('res', [1, 2, 3], ['RETRO 216P', 'CLEAN 432P', 'SHARP 648P'])),
        Object.assign({ label: 'COLOUR DITHER', hint: '15-BIT COLOUR WITH ORDERED DITHERING' }, tog('dither')),
        Object.assign({ label: 'VERTEX WOBBLE', hint: 'CLASSIC 32-BIT CONSOLE JITTER' }, tog('snap')),
        Object.assign({ label: 'CRT SCANLINES' }, tog('crt')),
        Object.assign({ label: 'MUSIC' }, vol('music')),
        Object.assign({ label: 'EFFECTS' }, vol('sfx')),
        { label: () => (self.confirm ? 'SURE? PRESS AGAIN' : 'RESET SAVE DATA'), ok: () => { if (self.confirm) { SR.Save.reset(); SR.applyOptions(); self.confirm = false; A.sfx('back'); } else self.confirm = true; }, hint: 'ERASES MONEY, BIKES, CUPS AND RECORDS' },
        { label: 'BACK', ok: () => S.go('main') },
      ], { back: () => S.go('main') });
    },
    update() { this.menu.update(); },
    render3d(dt) { demoFrame(dt); },
    draw(ctx) {
      ctx.fillStyle = 'rgba(8,2,20,0.6)'; ctx.fillRect(0, 0, W, H);
      header(ctx, 'OPTIONS');
      UI2.panel(ctx, 60, 32, 264, 168);
      this.menu.draw(ctx, 76, 42, 232, 13);
    },
  };

  S.list.controls = {
    update() { const k = SR.Input.menu(); if (k.ok || k.back) { A.sfx('back'); S.go('main'); } },
    render3d(dt) { demoFrame(dt); },
    draw(ctx) {
      ctx.fillStyle = 'rgba(8,2,20,0.65)'; ctx.fillRect(0, 0, W, H);
      header(ctx, 'CONTROLS');
      UI2.panel(ctx, 20, 32, 344, 164);
      const rows = [
        ['ACTION', 'KEYBOARD', 'GAMEPAD'],
        ['THROTTLE', '↑ / W', 'A / RT'],
        ['BRAKE', '↓ / S', 'B / LT'],
        ['STEER / LEAN', '← → / A D', 'STICK / D-PAD'],
        ['NITRO', 'SPACE / SHIFT', 'X'],
        ['SHIFT UP / DOWN', 'E / Q', 'RB / LB'],
        ['CAMERA', 'C', 'Y'],
        ['PAUSE', 'ESC / P', 'START'],
        ['MUSIC ON/OFF', 'M', '-'],
      ];
      rows.forEach((r, i) => {
        const y = 44 + i * 14, c = i === 0 ? GOLD : '#fff';
        F.draw(ctx, r[0], 32, y, i === 0 ? GOLD : '#cfc8ec', 1, 'left', '#000');
        F.draw(ctx, r[1], 160, y, c, 1, 'left', '#000');
        F.draw(ctx, r[2], 266, y, c, 1, 'left', '#000');
      });
      F.draw(ctx, 'TIP: HITTING THE RAIL FAST THROWS YOU OFF. BRAKE BEFORE TURNS!', W / 2, 180, NEON, 1, 'center', '#000');
    },
  };

  S.list.mp = {
    update() { const k = SR.Input.menu(); if (k.ok || k.back) { A.sfx('back'); S.go('main'); } },
    render3d(dt) { demoFrame(dt); },
    draw(ctx) {
      ctx.fillStyle = 'rgba(8,2,20,0.65)'; ctx.fillRect(0, 0, W, H);
      header(ctx, 'MULTIPLAYER');
      UI2.panel(ctx, 30, 36, 324, 150, { title: 'COMING SOON' });
      const lines = [
        ['SPLIT-SCREEN', 'TWO RIDERS ON ONE SCREEN, KEYBOARD + GAMEPAD'],
        ['ONLINE RACES', 'RACE FRIENDS OVER THE INTERNET'],
        ['GHOST SHARING', 'SWAP TIME-TRIAL GHOSTS WITH FRIENDS'],
      ];
      lines.forEach(([a, b], i) => {
        F.draw(ctx, '★ ' + a, 44, 54 + i * 30, GOLD, 1, 'left', '#000');
        F.draw(ctx, b, 56, 66 + i * 30, '#cfc8ec', 1, 'left', '#000');
      });
      F.draw(ctx, 'THE RACE ENGINE IS ALREADY BUILT FOR IT.', W / 2, 150, NEON, 1, 'center', '#000');
      F.draw(ctx, 'PRESS ENTER', W / 2, 170, '#fff', 1, 'center', '#000');
    },
  };

  S.list.credits = {
    update() { const k = SR.Input.menu(); if (k.ok || k.back) { A.sfx('back'); S.go('main'); } },
    render3d(dt) { demoFrame(dt); },
    draw(ctx) {
      ctx.fillStyle = 'rgba(8,2,20,0.65)'; ctx.fillRect(0, 0, W, H);
      title(ctx, 24, true);
      const lines = ['A RETRO 3D MOTORBIKE RACER', '', 'EVERYTHING IS MADE IN CODE:', 'BIKES, TRACKS, MUSIC AND SOUND', '', 'NO LIBRARIES · WORKS OFFLINE', '', 'THANKS FOR PLAYING!'];
      lines.forEach((l, i) => F.draw(ctx, l, W / 2, 84 + i * 12, i === lines.length - 1 ? GOLD : '#cfc8ec', 1, 'center', '#000'));
    },
  };
})(window.SR);
