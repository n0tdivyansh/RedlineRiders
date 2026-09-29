'use strict';
/* ============================================================
   Race: fixed-step simulation (120 Hz), controllers, AI, crashes,
   laps, ghost, cameras and 3D rendering.

   Multiplayer-ready design:
   · Riders are driven only through controllers → input structs
     (LocalController / AIController; add RemoteController later).
   · The simulation uses only the race's seeded RNG (race.rng), so
     identical inputs give identical results (lockstep / rollback).
   · race.snapshot() / race.applySnapshot() serialise rider state
     for a host-authoritative online mode.
   · Any number of viewports can be rendered (split-screen).
   ============================================================ */
(function (SR) {
  const M = SR.M, GL = SR.GL, A = SR.Audio;
  const STEP = 1 / 120;
  const Race = (SR.Race = {});

  /* ============================================================
     Controllers
     ============================================================ */
  class LocalController {
    constructor(slot) { this.slot = slot || 0; this.kind = 'local'; }
    get() { return SR.Input.controls(this.slot); }
  }
  class AIController {
    constructor(o) {
      this.kind = 'ai';
      this.pace = o.pace;            // fraction of the bike's top speed it dares to use
      this.lane = o.lane || 0;       // preferred lateral offset
      this.baseLane = this.lane;
      this.laneT = 0;
      this.rng = o.rng;
      this.nitroCool = 4 + this.rng() * 6;
    }
    get(r, race, dt) {
      const T = race.track, v = r.v, s = r.s;
      const lat = r.st.lat * race.grip * 0.93;
      let vt = r.st.vmax * this.pace;
      const k0 = T.curvAt(s);
      vt = Math.min(vt, Math.sqrt(lat / (Math.abs(k0) + 1e-5)));
      const reach = 40 + v * 2.4;
      for (let dd = 6; dd < reach; dd += 6) {
        const vc = Math.sqrt(lat / (Math.abs(T.curvAt(s + dd)) + 1e-5));
        const allowed = Math.sqrt(vc * vc + 2 * 13 * dd);
        if (allowed < vt) vt = allowed;
      }
      // rubber band around the leading local rider (keeps races close, never in time trial)
      if (race.rubber && race.lead) {
        const gap = r.d - race.lead.d;
        if (gap > 220) vt *= 0.965;
        else if (gap < -260) vt *= 1.035;
      }
      // traffic: pass slower riders, avoid crashed ones
      this.laneT -= dt;
      let block = null;
      for (const o of race.riders) {
        if (o === r || o.ghost) continue;
        const ds = race.gap(o, r);
        if (ds > 0 && ds < 32 && Math.abs(o.x - r.x) < 1.7 && (o.crashT > 0 || o.v < v + 1.5)) {
          if (!block || ds < race.gap(block, r)) block = o;
        }
      }
      if (block) {
        if (this.laneT <= 0) {
          let side = block.x > r.x ? -1 : 1;
          if (Math.abs(block.x + side * 2.6) > T.RW - 1.2) side = -side;
          this.lane = M.clamp(block.x + side * 2.6, -T.RW + 1.2, T.RW - 1.2);
          this.laneT = 2.2;
        }
        const ds = race.gap(block, r);
        if (ds < 7 && Math.abs(block.x - r.x) < 1.1) vt = Math.min(vt, block.crashT > 0 ? 8 : block.v - 1);
      } else if (this.laneT <= 0) {
        this.lane = M.lerp(this.lane, this.baseLane, 0.02);
      }
      const kA = T.curvAt(s + 20 + v * 0.5);
      const xt = M.clamp(this.lane + M.clamp(kA * 320, -2.4, 2.4), -T.RW + 1.1, T.RW - 1.1);
      const look = 10 + v * 0.35;
      const hrDes = Math.atan2(xt - r.x, look);
      const wSteer = 2.0 / (1 + Math.max(v, 2) / 24);
      const w = k0 * v + 3.2 * (hrDes - r.hr);
      const steer = M.clamp(w / wSteer, -1, 1);
      let throttle = 0, brake = 0;
      if (v < vt - 1) throttle = 1;
      else if (v > vt + 1.5) brake = M.clamp((v - vt) / 7, 0.2, 1);
      else throttle = 0.35;
      // nitro on long straights
      this.nitroCool -= dt;
      let nitro = false;
      if (this.nitroCool <= 0 && r.nitroN > 0 && Math.abs(k0) < 0.002 && Math.abs(T.curvAt(s + 120)) < 0.002 && v > r.st.vmax * 0.5) {
        if (this.rng() < 0.5) nitro = true;
        this.nitroCool = 8 + this.rng() * 10;
      }
      return { steer, throttle, brake, nitro, shiftUp: false, shiftDown: false, ai: true };
    }
  }
  Race.LocalController = LocalController;
  Race.AIController = AIController;

  /* ============================================================
     Create
     cfg: { trackDef, laps, mode: 'champ'|'quick'|'tt'|'demo', locals: [{bikeId, up, paints, name, slot}],
            rivals: [{name, bikeId, up, paint, pace}], diff, trans, fuel? , ghost }
     ============================================================ */
  Race.create = function (cfg) {
    const track = SR.Track.build(cfg.trackDef);
    const wx = SR.WEATHER[cfg.trackDef.weather];
    const race = {
      cfg, track, mode: cfg.mode, laps: cfg.laps || SR.LAPS, riders: [], locals: [], t: 0, clock: 0, phase: 'intro', phaseT: 0,
      grip: wx.grip, rng: M.rng(cfg.trackDef.seed * 97 + 5), rubber: cfg.mode === 'champ' || cfg.mode === 'quick',
      particles: [], finishOrder: [], acc: 0, messages: [], lead: null, flash: 0, lightning: 0,
      ghostData: cfg.ghost || null, ghostRec: null, newGhost: null,
    };
    race.gap = (a, b) => { // signed track distance from b to a, wrapped to ±L/2
      const L = track.L;
      let d = (a.s - b.s) % L;
      if (d > L / 2) d -= L;
      if (d < -L / 2) d += L;
      return d;
    };
    const mk = (o, ctrl, idx) => {
      const bike = SR.bikeById(o.bikeId);
      const st = SR.bikeStats(bike, o.up);
      const G = st.gears;
      const tops = [];
      for (let g = 0; g < G; g++) tops.push(st.vmax * Math.pow((g + 1) / G, 0.78));
      const row = Math.floor(idx / 3), col = idx % 3;
      const r = {
        id: idx, name: o.name, bike, st, tops, ctrl, local: ctrl.kind === 'local', meshes: SR.Bikes.get(bike.style),
        paint: o.paints[0], paint2: o.paints[1],
        d: -6 - row * 7 - col * 1.6, x: (col - 1) * 3.6, v: 0, hr: 0, s: 0, steer: 0, lean: 0, wheelie: 0, pitchV: 0,
        gear: 0, rpm: 0, shiftT: 0, nitroN: st.nitro, nitroT: 0, nitroLatch: false, inp: { steer: 0, throttle: 0, brake: 0 },
        lapsDone: 0, lapStart: 0, lastLap: null, bestLap: null, finished: false, finishT: 0, place: idx + 1,
        crashT: 0, ghostT: 0, crash: null, offroad: false, skid: 0, spin: 0, bumpT: 0, crashes: 0,
        manual: ctrl.kind === 'local' && cfg.trans === 'manual', smoke: 0,
      };
      r.s = M.wrap(r.d, track.L);
      return r;
    };
    // grid: rivals first, locals at the back (classic arcade start)
    let idx = 0;
    const rivals = cfg.rivals || [];
    rivals.forEach((o) => {
      race.riders.push(mk(o, new AIController({ pace: o.pace, lane: (race.rng() - 0.5) * 7, rng: M.rng(Math.floor(race.rng() * 1e9)) }), idx++));
    });
    (cfg.locals || []).forEach((o) => {
      const r = mk(o, cfg.mode === 'demo' ? new AIController({ pace: 0.95, lane: 0, rng: race.rng }) : new LocalController(o.slot), idx++);
      race.riders.push(r);
      if (r.local) race.locals.push(r);
    });
    race.lead = race.locals[0] || null;
    // sounds
    race.sounds = { engines: race.locals.map(() => A.engine()), skid: A.skid(), pass: A.engine(), amb: A.ambience(cfg.trackDef.weather === 'rain' ? 'rain' : 'wind') };
    if (race.locals[0]) race.ghostRec = [];
    race.cams = race.locals.map((r) => ({ r, mode: SR.data ? SR.data.opt.cam || 0 : 0, sx: r.x, shake: 0, yaw: track.yawAt(r.s), fovK: 0 }));
    if (!race.cams.length) race.cams.push({ r: race.riders[0], mode: 0, sx: 0, shake: 0, yaw: 0, fovK: 0, demo: true, demoT: 0, demoKind: 0 });
    if (cfg.mode === 'demo') { race.phase = 'race'; race.riders.forEach((r) => { r.v = r.st.vmax * 0.5; }); }
    Object.assign(race, api);
    return race;
  };

  /* ============================================================
     Simulation
     ============================================================ */
  const api = {
    update(dt) {
      this.phaseT += dt;
      if (this.phase === 'intro' && this.phaseT > 1.2) { this.phase = 'count'; this.phaseT = 0; this.countN = 3; A.sfx('beep'); }
      if (this.phase === 'count') {
        const n = 3 - Math.floor(this.phaseT);
        if (n < this.countN && n > 0) { this.countN = n; A.sfx('beep'); }
        if (this.phaseT >= 3) { this.phase = 'race'; this.phaseT = 0; A.sfx('go'); this.msg('GO!', 1.2, '#20ff60'); }
      }
      this.acc += Math.min(dt, 0.1);
      while (this.acc >= STEP) { this.step(STEP); this.acc -= STEP; }
      this.updateParticles(dt);
      this.updateAudio(dt);
      this.messages = this.messages.filter((m) => (m.t -= dt) > 0);
      if (this.lightning > 0) this.lightning -= dt;
      if (this.track.def.weather === 'rain' && this.track.env.night && Math.random() < dt * 0.08) { this.lightning = 0.25; }
      this.flash = this.lightning > 0 ? (Math.sin(this.lightning * 60) > 0 ? 0.35 : 0.1) : 0;
      if (this.phase === 'done') return;
      // end when every local rider has finished
      if (this.phase === 'race' && this.locals.length && this.locals.every((r) => r.finished)) {
        this.phase = 'finish'; this.phaseT = 0;
      }
      if (this.phase === 'finish' && this.phaseT > 4) { this.phase = 'done'; }
    },
    msg(text, t, color, big) { this.messages.push({ text, t: t || 1.5, max: t || 1.5, color: color || '#fff', big: big !== false }); },

    step(dt) {
      const racing = this.phase === 'race' || this.phase === 'finish';
      if (racing) this.clock += dt;
      this.t += dt;
      const T = this.track;
      for (const r of this.riders) {
        let inp;
        if (!racing) {
          const c = r.ctrl.kind === 'local' ? r.ctrl.get(r, this, dt) : { throttle: this.phase === 'count' && this.race_rev(r) ? 1 : 0 };
          inp = { steer: 0, throttle: c.throttle || 0, brake: 0, nitro: false };
          r.rev = M.approach(r.rev || 0, inp.throttle, dt * 3);
          r.rpm = 0.15 + r.rev * 0.75;
          r.inp = inp;
          continue;
        }
        if (r.finished && r.local) {
          // autopilot after the flag
          if (!r.auto) r.auto = new AIController({ pace: 0.75, lane: r.x, rng: M.rng(7) });
          inp = r.auto.get(r, this, dt);
        } else inp = r.ctrl.get(r, this, dt);
        r.inp = inp;
        this.physics(r, inp, dt);
      }
      if (racing) this.collide(dt);
      // standings
      const order = this.riders.slice().sort((a, b) => {
        if (a.finished && b.finished) return a.finishT - b.finishT;
        if (a.finished) return -1;
        if (b.finished) return 1;
        return b.d - a.d;
      });
      order.forEach((r, i) => { r.place = i + 1; });
      this.order = order;
    },
    race_rev(r) { return (r.id * 7 + Math.floor(this.phaseT * 3)) % 3 !== 0; },

    physics(r, inp, dt) {
      const T = this.track, st = r.st;
      r.s = M.wrap(r.d, T.L);
      if (r.ghostT > 0) r.ghostT -= dt;
      /* --- crashed: bike slides, rider tumbles, then respawn --- */
      if (r.crashT > 0) {
        r.crashT -= dt;
        const c = r.crash;
        c.v = Math.max(0, c.v - 11 * dt);
        r.d += c.v * dt;
        r.x = M.clamp(r.x + c.vx * dt, -T.LIMIT + 0.6, T.LIMIT - 0.6);
        c.vx *= 1 - dt * 2;
        c.spin += c.spinV * dt;
        c.spinV *= 1 - dt * 1.5;
        // rider body
        c.rv[1] -= 9.81 * dt;
        c.rp[0] += c.rv[0] * dt; c.rp[1] += c.rv[1] * dt; c.rp[2] += c.rv[2] * dt;
        if (c.rp[1] < 0.25) { c.rp[1] = 0.25; c.rv[1] = Math.abs(c.rv[1]) * 0.35; c.rv[0] *= 0.7; c.rv[2] *= 0.7; }
        c.rr += c.rrV * dt;
        c.rrV *= 1 - dt * 1.2;
        r.v = c.v;
        r.lean = M.approach(r.lean, c.side * 1.45, dt * 4);
        if (r.crashT <= 0) {
          // respawn on the road, standing start, briefly untouchable
          r.x = M.clamp(r.x, -T.RW + 1.5, T.RW - 1.5);
          r.v = 4; r.hr = 0; r.lean = 0; r.crash = null; r.ghostT = 2; r.gear = 0;
        }
        return;
      }
      const edge = T.RW + 1.1;
      r.offroad = Math.abs(r.x) > edge;
      /* --- nitro --- */
      if (inp.nitro && !r.nitroLatch && r.nitroN > 0 && r.nitroT <= 0 && r.v > 5) {
        r.nitroN--; r.nitroT = 3.2; r.wheelieKick = 0.22;
        if (r.local) { A.sfx('nitro'); this.msg('NITRO!', 1, '#3de0ff', false); }
      }
      r.nitroLatch = !!inp.nitro;
      let vcap = st.vmax, acc = st.a0;
      if (r.nitroT > 0) { r.nitroT -= dt; vcap *= 1.16; acc *= 1.75; }
      if (r.offroad) vcap *= st.off;
      /* --- gears / rpm --- */
      const G = st.gears, tops = r.tops;
      if (r.shiftT > 0) r.shiftT -= dt;
      if (r.manual) {
        if (inp.shiftUp && r.gear < G - 1) { r.gear++; r.shiftT = st.shift; if (r.local) A.sfx('shift'); }
        if (inp.shiftDown && r.gear > 0) { r.gear--; r.shiftT = st.shift * 0.6; }
      } else {
        if (r.gear < G - 1 && r.v > tops[r.gear] * 0.97) { r.gear++; r.shiftT = st.shift; if (r.local) A.sfx('shift'); }
        else if (r.gear > 0 && r.v < tops[r.gear - 1] * 0.72) r.gear--;
      }
      const lo = r.gear ? tops[r.gear - 1] * 0.55 : 0;
      r.rpm = M.clamp(0.14 + 0.86 * (r.v - lo) / (tops[r.gear] - lo), 0.12, 1.03);
      let gearF = 1;
      if (r.v > tops[r.gear] * 1.005) gearF = 0; // limiter
      else if (r.manual) gearF = M.clamp(0.4 + r.v / (tops[r.gear] * 0.55), 0.4, 1) * 1.06;
      /* --- longitudinal --- */
      let a = 0;
      const thr = inp.throttle || 0, brk = inp.brake || 0;
      if (thr > 0 && r.shiftT <= 0) a += acc * thr * Math.max(0, 1 - (r.v / vcap) ** 2) * gearF;
      if (r.v > vcap) a -= (r.offroad ? 9 : 2.5) * (1 + (r.v - vcap) / 12);
      if (brk > 0) a -= 17 * brk;
      a -= 0.35 + 0.00011 * r.v * r.v;
      a -= 9.81 * T.slopeAt(r.s) * 0.4;
      if (r.offroad) { a -= r.v * 0.08; }
      r.v = Math.max(0, r.v + a * dt);
      /* --- steering: track-relative heading, grip-limited turn rate --- */
      const target = M.clamp(inp.steer || 0, -1, 1);
      const rate = Math.abs(target) < Math.abs(r.steer) || Math.sign(target) !== Math.sign(r.steer) ? 9 : 5.5;
      r.steer = inp.ai ? target : M.approach(r.steer, target, rate * dt);
      const vs = Math.max(r.v, 2);
      const wSteer = 2.0 / (1 + vs / 24);
      let w = r.steer * wSteer;
      if (!inp.ai && Math.abs(target) < 0.05) w -= r.hr * 2.4; // steering assist: straighten up
      const grip = st.lat * this.grip * (r.offroad ? 0.72 : 1);
      const wGrip = grip / vs;
      r.skid = r.v > 14 ? M.clamp((Math.abs(w) - wGrip) / wGrip, 0, 1) : 0;
      w = M.clamp(w, -wGrip, wGrip);
      const k = T.curvAt(r.s);
      r.hr = M.clamp(r.hr + (w - k * r.v) * dt, -0.75, 0.75);
      r.x += r.v * Math.sin(r.hr) * dt;
      r.d += r.v * Math.cos(r.hr) * dt;
      // lean follows lateral acceleration; wheelie on launch and nitro
      const leanT = M.clamp(Math.atan((r.v * w) / 9.81), -0.95, 0.95);
      r.lean = M.lerp(r.lean, leanT, 1 - Math.exp(-dt * 7));
      const launch = r.gear === 0 && thr > 0.9 && r.v < 18 ? 0.12 : 0;
      r.wheelieKick = Math.max(0, (r.wheelieKick || 0) - dt * 0.5);
      r.wheelie = M.lerp(r.wheelie, Math.max(launch, r.wheelieKick) * (1 - Math.abs(r.lean)), 1 - Math.exp(-dt * 5));
      r.spin += (r.v / 0.31) * dt;
      if (r.bumpT > 0) r.bumpT -= dt;
      /* --- boundary: rail / wall --- */
      const lim = T.LIMIT - 0.45;
      if (Math.abs(r.x) > lim) {
        const side = Math.sign(r.x);
        r.x = side * lim;
        const impact = r.v * Math.abs(Math.sin(r.hr)) + r.v * 0.25;
        if (r.v > st.crash && impact > 14) this.crashRider(r, side);
        else {
          r.v *= 0.82; r.hr = -side * Math.abs(r.hr) * 0.4 - side * 0.05;
          if (r.local && r.bumpT <= 0) { A.sfx('scrape'); r.bumpT = 0.4; this.shake(r, 0.4); }
          this.sparks(r, side);
        }
      }
      /* --- laps --- */
      const lapsNow = Math.floor(r.d / T.L);
      if (lapsNow > r.lapsDone && r.d > 0) {
        r.lapsDone = lapsNow;
        const lt = this.clock - r.lapStart;
        r.lapStart = this.clock;
        r.lastLap = lt;
        const isBest = r.bestLap === null || lt < r.bestLap;
        if (isBest) r.bestLap = lt;
        if (r.local) this.onLocalLap(r, lt, isBest);
        if (r.lapsDone >= this.laps && !r.finished && this.mode !== 'demo' && this.mode !== 'tt') {
          r.finished = true; r.finishT = this.clock; this.finishOrder.push(r);
          if (r.local) { this.msg(r.place === 1 ? 'WINNER!' : 'FINISH', 3, '#ffd21a'); A.sfx(r.place <= 3 ? 'win' : 'lose'); }
        } else if (r.local && this.mode !== 'tt' && r.lapsDone === this.laps - 1) {
          this.msg('FINAL LAP', 2, '#ff3c9e'); A.sfx('final');
        } else if (r.local) A.sfx('lap');
        if (this.mode === 'tt' && r.local && r.lapsDone >= this.laps) {
          r.finished = true; r.finishT = this.clock; this.finishOrder.push(r);
        }
      }
      // ghost recording (local rider 0, 20 Hz)
      if (this.ghostRec && r === this.locals[0]) {
        const lt = this.clock - r.lapStart;
        if (r.d > 0 && (this.ghostRec.length === 0 || lt - this.ghostRec[this.ghostRec.length - 1][0] >= 0.05)) {
          this.ghostRec.push([Math.round(lt * 1000) / 1000, Math.round(M.wrap(r.d, T.L) * 10), Math.round(r.x * 100), Math.round(r.lean * 1000)]);
        }
      }
    },

    onLocalLap(r, lt, isBest) {
      const rec = SR.data && SR.data.records[this.track.def.id];
      if (!rec || !rec.lap || lt < rec.lap) {
        if (rec && rec.lap) this.msg('LAP RECORD!', 2, '#3de0ff', false);
        this.newRecord = true;
      }
      if (this.ghostRec && r === this.locals[0]) {
        if (isBest && this.ghostRec.length > 20) this.newGhost = { t: lt, d: this.ghostRec };
        this.ghostRec = [];
      }
    },

    crashRider(r, side) {
      if (r.crashT > 0 || r.ghostT > 0) return;
      r.crashes++;
      r.crashT = 3.2;
      r.nitroT = 0;
      const c = {
        v: r.v * 0.75, vx: -side * 2, spin: 0, spinV: (6 + this.rng() * 4) * (this.rng() < 0.5 ? -1 : 1), side: side || 1,
        rp: [0, 1.1, 0], rv: [-side * (1.5 + this.rng()), 3 + this.rng() * 2, -r.v * 0.2], rr: 0, rrV: 8 + this.rng() * 6,
      };
      r.crash = c;
      if (r.local) { A.sfx('crash'); this.shake(r, 1); this.msg('CRASH!', 1.8, '#ff4040'); if (SR.data) SR.data.stats.crashes++; }
      for (let i = 0; i < 14; i++) this.sparks(r, side);
    },

    collide() {
      const rs = this.riders, n = rs.length;
      for (let i = 0; i < n; i++) {
        const a = rs[i];
        if (a.crashT > 0 || a.ghostT > 0) continue;
        for (let j = i + 1; j < n; j++) {
          const b = rs[j];
          if (b.crashT > 0 || b.ghostT > 0) continue;
          const ds = this.gap(a, b);
          if (Math.abs(ds) > 2.1) continue;
          const dx = a.x - b.x;
          if (Math.abs(dx) > 0.9) continue;
          const front = ds > 0 ? a : b, rear = ds > 0 ? b : a;
          const rel = rear.v - front.v;
          if (rel > 13 && Math.abs(dx) < 0.55) { this.crashRider(rear, Math.sign(rear.x - front.x) || 1); continue; }
          const push = (0.9 - Math.abs(dx)) * 0.5, sd = Math.sign(dx) || 1;
          a.x += sd * push; b.x -= sd * push;
          if (rel > 0) { rear.v = Math.min(rear.v, front.v * 0.98); front.v += rel * 0.15; }
          if ((a.local || b.local) && (a.bumpT <= 0 && b.bumpT <= 0)) {
            A.sfx('bump'); a.bumpT = b.bumpT = 0.35;
            const me = a.local ? a : b;
            this.shake(me, 0.3);
          }
        }
      }
    },
    shake(r, k) { for (const c of this.cams) if (c.r === r) c.shake = Math.max(c.shake, k); },

    /* ---------- particles (visual only, not part of the deterministic sim) ---------- */
    sparks(r, side) {
      const p = this.track.pos(r.s, r.x);
      for (let i = 0; i < 3; i++) {
        this.particles.push({ kind: 'spark', p: [p[0], p[1] + 0.3, p[2]], v: [(Math.random() - 0.5) * 6, 2 + Math.random() * 3, (Math.random() - 0.5) * 6], life: 0.4 + Math.random() * 0.3, t: 0, size: 0.09 });
      }
    },
    updateParticles(dt) {
      const T = this.track, wet = T.def.weather === 'rain', snow = T.def.theme === 'snow' || T.def.weather === 'snow';
      for (const r of this.riders) {
        if (r.crashT > 0 || r.v < 8) continue;
        const kind = r.offroad ? (snow ? 'snow' : 'dust') : wet ? 'spray' : r.skid > 0.25 ? 'smoke' : null;
        if (!kind) continue;
        r.smoke += dt * (kind === 'spray' ? 14 : 10) * (kind === 'smoke' ? r.skid : 1);
        while (r.smoke > 1) {
          r.smoke -= 1;
          const yaw = T.yawAt(r.s) - r.hr, f = M.fwd(yaw);
          const p = T.pos(r.s, r.x);
          p[0] -= f[0] * 0.8; p[2] -= f[2] * 0.8;
          this.particles.push({ kind, p: [p[0], p[1] + 0.2, p[2]], v: [f[0] * r.v * 0.15 + (Math.random() - 0.5), 0.8 + Math.random(), f[2] * r.v * 0.15 + (Math.random() - 0.5)], life: 0.7 + Math.random() * 0.5, t: 0, size: 0.4 });
        }
      }
      for (const q of this.particles) {
        q.t += dt;
        q.p[0] += q.v[0] * dt; q.p[1] += q.v[1] * dt; q.p[2] += q.v[2] * dt;
        if (q.kind === 'spark') q.v[1] -= 12 * dt;
        else { q.v[0] *= 1 - dt * 2; q.v[2] *= 1 - dt * 2; }
      }
      this.particles = this.particles.filter((q) => q.t < q.life);
      if (this.particles.length > 260) this.particles.splice(0, this.particles.length - 260);
    },

    /* ---------- audio ---------- */
    updateAudio() {
      const S = this.sounds;
      if (!S) return;
      this.locals.forEach((r, i) => {
        const e = S.engines[i];
        if (!e) return;
        const base = r.bike.eng.base;
        const f = base * (1 + r.rpm * 4.4) * (r.nitroT > 0 ? 1.06 : 1);
        e.set(r.crashT > 0 ? base * 0.9 : f, r.crashT > 0 ? 0 : r.inp.throttle || 0, this.locals.length > 1 ? 0.5 : 0.8);
      });
      const me = this.locals[0];
      if (me) {
        if (S.skid) S.skid.set(me.crashT > 0 ? 0 : Math.max(me.skid, me.offroad && me.v > 10 ? 0.4 : 0));
        // closest rival pass-by
        let best = null, bd = 60;
        for (const o of this.riders) {
          if (o.local || o.crashT > 0) continue;
          const d = Math.abs(this.gap(o, me)) + Math.abs(o.x - me.x);
          if (d < bd) { bd = d; best = o; }
        }
        if (S.pass) {
          if (best) {
            const approach = this.gap(best, me) < 0 ? 1.04 : 0.96;
            S.pass.set(best.bike.eng.base * (1 + best.rpm * 4.4) * approach, 0.8, 0.5 * (1 - bd / 60));
          } else S.pass.set(60, 0, 0);
        }
        if (S.amb) S.amb.set(this.track.def.weather === 'rain' ? 0.12 : Math.min(0.1, me.v / 900));
      }
    },
    stopAudio() {
      const S = this.sounds;
      if (!S) return;
      S.engines.forEach((e) => e && e.stop());
      ['skid', 'pass', 'amb'].forEach((k) => S[k] && S[k].stop());
      this.sounds = null;
    },

    /* ---------- snapshots for future online play ---------- */
    snapshot() {
      return {
        t: this.t, clock: this.clock, phase: this.phase,
        r: this.riders.map((r) => [r.d, r.x, r.v, r.hr, r.lean, r.gear, r.nitroN, r.nitroT, r.crashT, r.lapsDone, r.finished ? r.finishT : -1]),
      };
    },
    applySnapshot(s) {
      this.t = s.t; this.clock = s.clock; this.phase = s.phase;
      s.r.forEach((a, i) => {
        const r = this.riders[i];
        if (!r) return;
        [r.d, r.x, r.v, r.hr, r.lean, r.gear, r.nitroN, r.nitroT, r.crashT, r.lapsDone] = a;
        r.finished = a[10] >= 0; r.finishT = Math.max(0, a[10]);
        r.s = M.wrap(r.d, this.track.L);
      });
    },

    /* ============================================================
       Rendering
       ============================================================ */
    viewports() {
      const n = this.cams.length;
      if (n === 1) return [{ x: 0, y: 0, w: 1, h: 1 }];
      return this.cams.map((c, i) => ({ x: 0, y: i / n, w: 1, h: 1 / n }));
    },
    camera(cam, dt) {
      const T = this.track;
      let r = cam.r;
      if (cam.demo) {
        cam.demoT -= dt;
        if (cam.demoT <= 0 || !r) {
          cam.demoT = 6;
          cam.demoKind = (cam.demoKind + 1) % 3;
          const pool = this.riders.filter((q) => q.crashT <= 0);
          cam.r = r = pool[Math.floor(Math.random() * pool.length)] || this.riders[0];
          cam.fixS = r.s + 60; cam.fixX = (Math.random() < 0.5 ? -1 : 1) * (T.RW + 4);
        }
      }
      cam.sx = M.lerp(cam.sx, r.x, 1 - Math.exp(-dt * 6));
      cam.shake = Math.max(0, cam.shake - dt * 2);
      const nitro = r.nitroT > 0 ? 1 : 0;
      cam.fovK = M.lerp(cam.fovK, nitro, 1 - Math.exp(-dt * 3));
      const up = [0, 1, 0];
      let eye, target, roll = 0;
      const sh = cam.shake * 0.25;
      const jitter = () => (Math.random() - 0.5) * sh;
      if (this.phase === 'intro' || this.phase === 'count') {
        // sweep from the front of the grid to behind the rider
        const t = this.phase === 'intro' ? this.phaseT / 4.2 : (1.2 + this.phaseT) / 4.2;
        const k = M.smooth(M.clamp(t, 0, 1));
        const a = M.lerp(Math.PI * 0.85, 0, k);
        const base = T.pos(r.s, r.x);
        const yaw = T.yawAt(r.s), f = M.fwd(yaw), rt = [Math.cos(yaw), 0, -Math.sin(yaw)];
        const dist = M.lerp(6, 4.6, k);
        eye = [base[0] - f[0] * Math.cos(a) * dist + rt[0] * Math.sin(a) * dist, base[1] + M.lerp(1.4, 1.85, k), base[2] - f[2] * Math.cos(a) * dist + rt[2] * Math.sin(a) * dist];
        target = [base[0] + f[0] * M.lerp(0, 8, k), base[1] + 0.9, base[2] + f[2] * M.lerp(0, 8, k)];
      } else if (cam.demo && cam.demoKind === 1) {
        // trackside camera watching riders go by
        eye = T.pos(cam.fixS, cam.fixX); eye[1] += 1.5;
        if (this.gap({ s: cam.fixS }, r) < -15) { cam.demoT = 0; }
        const p = T.pos(r.s, r.x); p[1] += 0.8;
        target = p;
      } else if (cam.demo && cam.demoKind === 2) {
        // low front camera looking back at the rider
        const p = T.pos(r.s + 7, r.x * 0.8 + 1.5); p[1] += 0.6;
        eye = p;
        target = T.pos(r.s, r.x); target[1] += 0.9;
      } else if (r.crashT > 0 && r.crash) {
        const p = T.pos(r.s - 7, cam.sx); p[1] += 3.2;
        eye = p;
        target = T.pos(r.s, r.x); target[1] += 0.5;
      } else if (cam.mode === 2) {
        // helmet cam
        const yaw = T.yawAt(r.s) - r.hr, f = M.fwd(yaw);
        const p = T.pos(r.s, r.x); p[1] += 1.38 + r.wheelie * 0.6;
        eye = [p[0] + f[0] * 0.1, p[1], p[2] + f[2] * 0.1];
        target = [p[0] + f[0] * 20, p[1] - 0.8 + T.slopeAt(r.s) * 20, p[2] + f[2] * 20];
        roll = r.lean * 0.7;
      } else {
        const far = cam.mode === 1;
        const back = far ? 7 : 4.6, hgt = far ? 2.6 : 1.85;
        const p = T.pos(r.s - back, cam.sx * 0.85);
        const hy = Math.max(p[1], T.heightAt(r.s) - 0.5);
        eye = [p[0] + jitter(), hy + hgt + jitter(), p[2] + jitter()];
        target = T.pos(r.s + 9, r.x + Math.sin(r.hr) * 5);
        target[1] += 1.0;
        roll = r.lean * 0.22;
      }
      const f = M.norm(M.sub(target, eye));
      const rt = M.norm(M.cross(f, up));
      const u = M.norm(M.add(M.mul(up, Math.cos(roll)), M.mul(rt, -Math.sin(roll))));
      const speedK = Math.min(1, r.v / 90);
      return { eye, target, up: u, fov: (58 + speedK * 8 + cam.fovK * 10) * (Math.PI / 180), near: 0.25, far: 1500, fwd: f, rider: r };
    },

    render(dt) {
      const vps = this.viewports();
      this.lastCams = [];
      this.cams.forEach((cam, i) => {
        const c = this.camera(cam, dt);
        this.lastCams.push(c);
        this.renderView(vps[i], c, cam);
      });
    },

    renderView(vp, cam, camState) {
      const T = this.track, env = T.env;
      const r = cam.rider;
      const e = Object.assign({}, env, { flash: this.flash });
      if (env.headOn && r && r.crashT <= 0) {
        const yaw = T.yawAt(r.s) - r.hr, f = M.fwd(yaw), p = T.pos(r.s, r.x);
        e.headPos = [p[0] + f[0] * 1.0, p[1] + 0.8, p[2] + f[2] * 1.0];
        e.headDir = M.norm([f[0], -0.06, f[2]]);
      } else e.headOn = false;
      GL.beginView(vp, cam, e);
      // sky
      GL.depthWrite(false);
      M.model(tmp, cam.eye[0], cam.eye[1], cam.eye[2], 0, 0, 0);
      GL.draw(T.sky, tmp);
      GL.depthWrite(true);
      GL.draw(T.ground, null);
      const far2 = (env.fogFar + 160) ** 2;
      for (const ch of T.chunks) {
        const dx = ch.cs[0] - cam.eye[0], dy = ch.cs[1] - cam.eye[1], dz = ch.cs[2] - cam.eye[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > far2) continue;
        if (dx * cam.fwd[0] + dy * cam.fwd[1] + dz * cam.fwd[2] < -170) continue;
        GL.draw(ch, null);
      }
      // riders
      const helmet = camState && camState.mode === 2 && !camState.demo;
      for (const q of this.riders) {
        if (helmet && q === r && q.crashT <= 0) continue;
        this.drawRider(q, cam);
      }
      // ghost
      if (this.ghostData && this.locals[0]) this.drawGhost(cam);
      // particles
      const sh = SR.Bikes.shared();
      for (const q of this.particles) {
        const k = q.t / q.life;
        let mesh = sh.puff, col, alpha = 1, size = q.size;
        if (q.kind === 'spark') { mesh = sh.glow; col = SPARK; size = q.size; }
        else if (q.kind === 'smoke') { col = SMOKE; alpha = 0.7 * (1 - k); size = q.size * (1 + k * 3); }
        else if (q.kind === 'dust') { col = DUST; alpha = 0.7 * (1 - k); size = q.size * (1 + k * 3); }
        else if (q.kind === 'snow') { col = SNOW; alpha = 0.8 * (1 - k); size = q.size * (1 + k * 2); }
        else { col = SPRAY; alpha = 0.5 * (1 - k); size = q.size * (1 + k * 2.5); }
        M.model(tmp, q.p[0], q.p[1], q.p[2], 0, 0, 0, size);
        GL.draw(mesh, tmp, { paint: col, alpha });
      }
    },

    drawRider(q, cam) {
      const T = this.track;
      const p = T.pos(q.s, q.x);
      const dx = p[0] - cam.eye[0], dz = p[2] - cam.eye[2];
      if (dx * dx + dz * dz > 420 * 420) return;
      const ms = q.meshes, st = ms.style, sh = SR.Bikes.shared();
      const yawT = T.yawAt(q.s);
      const pitch = Math.atan(T.slopeAt(q.s));
      const o = { paint: q.paint, paint2: q.paint2, brake: q.inp.brake || 0, alpha: q.ghostT > 0 ? (Math.floor(q.ghostT * 8) % 2 ? 0.35 : 0.8) : 1 };
      if (q.crashT > 0 && q.crash) {
        const c = q.crash;
        // sliding bike on its side
        M.model(mm, p[0], p[1] + 0.25, p[2], yawT - q.hr + c.spin, pitch, -c.side * 1.35);
        GL.draw(ms.body, mm, o);
        this.drawWheels(ms, st, mm, q, o, 0);
        // tumbling rider (position relative to the crash point along the track)
        const yaw = yawT, f = M.fwd(yaw), rt = [Math.cos(yaw), 0, -Math.sin(yaw)];
        const rp = [p[0] + rt[0] * c.rp[0] - f[0] * c.rp[2], p[1] + c.rp[1] - 1.0, p[2] + rt[2] * c.rp[0] - f[2] * c.rp[2]];
        M.model(mm, rp[0], rp[1], rp[2], yaw + c.rr * 0.3, c.rr, c.rr * 0.5);
        GL.draw(ms.rider, mm, o);
        return;
      }
      // blob shadow
      M.model(mm, p[0], p[1] + 0.01, p[2], yawT - q.hr, pitch, 0);
      GL.draw(sh.shadow, mm, { alpha: 0.45 });
      // bike: lean about the contact line, wheelie about the rear axle
      M.model(mm, p[0], p[1], p[2], yawT - q.hr, pitch + q.wheelie, -q.lean);
      if (q.wheelie > 0.005) {
        // keep the rear contact patch where it would be without the wheelie
        M.model(loc, p[0], p[1], p[2], yawT - q.hr, pitch, -q.lean);
        const c0 = M.xf(loc, 0, 0, st.wr), c1 = M.xf(mm, 0, 0, st.wr);
        mm[12] += c0[0] - c1[0]; mm[13] += c0[1] - c1[1]; mm[14] += c0[2] - c1[2];
      }
      GL.draw(ms.body, mm, o);
      GL.draw(ms.rider, mm, o);
      this.drawWheels(ms, st, mm, q, o, q.steer * 0.12);
      if (q.nitroT > 0) {
        const ex = M.xf(mm, 0.21, 0.6, 0.86);
        const fl = 0.8 + Math.random() * 0.5;
        M.model(tmp, ex[0], ex[1], ex[2], yawT - q.hr, pitch, 0, fl * 1.4);
        GL.draw(sh.flame, tmp, { paint: FLAME });
      }
    },
    drawWheels(ms, st, bm, q, o, steer) {
      M.model(loc, 0, st.rf, st.wf, steer, -q.spin, 0);
      M.mulm(wm, bm, loc);
      GL.draw(ms.wheelF, wm, o);
      M.model(loc, 0, st.rr, st.wr, 0, -q.spin, 0);
      M.mulm(wm, bm, loc);
      GL.draw(ms.wheelR, wm, o);
    },

    ghostPose() {
      const g = this.ghostData, me = this.locals[0];
      if (!g || !me || me.d < 0) return null;
      const t = this.clock - me.lapStart, d = g.d;
      if (t > g.t || d.length < 2) return null;
      let lo = 0, hi = d.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (d[m][0] <= t) lo = m; else hi = m; }
      const a = d[lo], b = d[hi], k = M.clamp((t - a[0]) / Math.max(1e-3, b[0] - a[0]), 0, 1);
      const L = this.track.L;
      let sa = a[1] / 10, sb = b[1] / 10;
      if (sb < sa - L / 2) sb += L;
      return { s: M.wrap(M.lerp(sa, sb, k), L), x: M.lerp(a[2], b[2], k) / 100, lean: M.lerp(a[3], b[3], k) / 1000 };
    },
    drawGhost(cam) {
      const g = this.ghostPose();
      if (!g) return;
      const me = this.locals[0];
      const fake = { s: g.s, x: g.x, hr: 0, lean: g.lean, wheelie: 0, steer: 0, spin: this.t * 60, meshes: me.meshes, paint: GHOST, paint2: GHOST2, inp: {}, ghostT: 0, crashT: 0, nitroT: 0 };
      const T = this.track, p = T.pos(g.s, g.x);
      M.model(mm, p[0], p[1], p[2], T.yawAt(g.s), Math.atan(T.slopeAt(g.s)), -g.lean);
      const o = { paint: GHOST, paint2: GHOST2, alpha: 0.4 };
      GL.draw(me.meshes.body, mm, o);
      GL.draw(me.meshes.rider, mm, o);
      this.drawWheels(me.meshes, me.meshes.style, mm, fake, o, 0);
    },
  };
  const tmp = M.m4(), mm = M.m4(), loc = M.m4(), wm = M.m4();
  const SPARK = M.rgb('#ffd060'), SMOKE = M.rgb('#d8d8dc'), DUST = M.rgb('#b89868'), SNOW = M.rgb('#f4f8ff'), SPRAY = M.rgb('#c8d4e0'), FLAME = M.rgb('#60c0ff');
  const GHOST = M.rgb('#9ad8ff'), GHOST2 = M.rgb('#4a88c8');

  /* ============================================================
     Field builder: rival line-up for a cup / quick race
     ============================================================ */
  Race.buildField = function (cupIndex, count, diff, seed) {
    const cup = SR.CUPS[cupIndex];
    const rng = M.rng(seed || cupIndex * 131 + 7);
    const names = SR.RIVALS.slice();
    const field = [];
    const tiers = SR.BIKES.slice().sort((a, b) => a.top - b.top);
    for (let i = 0; i < count; i++) {
      const nm = names.splice(Math.floor(rng() * names.length), 1)[0];
      // pick a bike that suits the cup: tier index grows with the cup
      const ti = M.clamp(Math.floor(cupIndex * 0.9 + rng() * 3) - 1, 0, tiers.length - 1);
      const bike = tiers[ti];
      const skill = 0.86 + rng() * 0.12 - (i % 4) * 0.01;
      // pace scales the rival's bike to the cup's target top speed
      const pace = M.clamp((cup.aiTop / bike.top) * skill * SR.DIFF[diff || 'normal'].pace, 0.6, 1.02);
      field.push({ name: nm.name, bikeId: bike.id, up: { engine: Math.min(4, Math.floor(cupIndex / 2)), tires: Math.min(4, Math.floor(cupIndex / 2)) }, paints: [M.rgb(nm.color), M.rgb(SR.PAINTS[(i * 5) % SR.PAINTS.length])], pace, skill });
    }
    return field;
  };
})(window.SR);
