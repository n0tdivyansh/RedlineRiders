'use strict';
/* ============================================================
   Rival AI. Produces the same input struct as a player
   ({steer, throttle, brake, nitro}) from the track ahead.

   Each rival has a trait (SR.TRAITS, set per name in SR.RIVALS):
   how late they brake, how tidy their line is, whether they cover
   the inside when you close in, and how often they misjudge a
   corner. Mistakes are rolled once per corner from the rival's own
   seeded RNG, so a race replays identically for the same inputs.
   ============================================================ */
(function (SR) {
  const M = SR.M;

  class AIController {
    constructor(o) {
      this.kind = 'ai';
      this.pace = o.pace;            // fraction of the bike's top speed it dares to use
      this.lane = o.lane || 0;       // preferred lateral offset
      this.baseLane = this.lane;
      this.laneT = 0;
      this.rng = o.rng;
      this.nitroCool = 4 + this.rng() * 6;
      this.trait = SR.TRAITS[o.trait] || SR.TRAITS.clean;
      const diff = SR.DIFF[o.diff] || SR.DIFF.normal;
      this.mistake = o.mistake !== undefined ? o.mistake : this.trait.mistake * diff.mistakes;
      this.corner = false;           // committed to the corner currently being approached
      this.err = 1;                  // >1 = overestimating how fast this corner can be taken
      this.blockT = 0;
    }

    get(r, race, dt) {
      const T = race.track, v = r.v, s = r.s, tr = this.trait;
      /* --- corner entry: roll for a misjudged braking point --- */
      const hot = Math.abs(T.curvAt(s + 25 + v)) > 1 / 140;
      if (hot && !this.corner) {
        this.corner = true;
        this.err = this.rng() < this.mistake ? 1.08 + this.rng() * 0.07 : 1;
      } else if (!hot && Math.abs(T.curvAt(s)) < 1 / 300) {
        this.corner = false;
        this.err = 1;
      }
      /* --- target speed: corner limit ahead, braking distance, slipstream --- */
      const lat = r.st.lat * race.grip * tr.lat * this.err * this.err;
      let vt = r.st.vmax * this.pace * (1 + 0.07 * r.draft);
      const k0 = T.curvAt(s);
      vt = Math.min(vt, Math.sqrt(lat / (Math.abs(k0) + 1e-5)));
      const reach = 40 + v * 2.4;
      for (let dd = 6; dd < reach; dd += 6) {
        const vc = Math.sqrt(lat / (Math.abs(T.curvAt(s + dd)) + 1e-5));
        const allowed = Math.sqrt(vc * vc + 2 * tr.decel * dd);
        if (allowed < vt) vt = allowed;
      }
      // rubber band around the leading local rider (keeps races close, never in time trial)
      if (race.rubber && race.lead) {
        const gap = r.d - race.lead.d;
        if (gap > 220) vt *= 0.965;
        else if (gap < -260) vt *= 1.035;
      }
      /* --- traffic: pass slower riders, avoid crashed ones, tuck into slipstreams --- */
      this.laneT -= dt;
      this.blockT -= dt;
      let block = null, tow = null;
      for (const o of race.riders) {
        if (o === r) continue;
        const ds = race.gap(o, r), dx = Math.abs(o.x - r.x);
        if (ds > 0 && ds < 32 && dx < 1.7 && (o.crashT > 0 || o.v < v + 1.5)) {
          if (!block || ds < race.gap(block, r)) block = o;
        }
        if (tr.draft && ds > 10 && ds < 40 && dx < 4 && o.crashT <= 0 && o.v > 28) {
          if (!tow || ds < race.gap(tow, r)) tow = o;
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
        if (tow) this.lane = M.lerp(this.lane, tow.x, 0.05);
        else this.lane = M.lerp(this.lane, this.baseLane, 0.02);
      }
      // blockers move across to cover a local rider closing from behind
      if (tr.block && !block && this.blockT <= 0) {
        for (const o of race.locals) {
          const ds = race.gap(r, o);
          if (ds > 3 && ds < 25 && o.v > v - 1 && Math.abs(o.x - r.x) < 4 && o.crashT <= 0) {
            this.lane = M.clamp(o.x, -T.RW + 1.2, T.RW - 1.2);
            this.laneT = 1.4;
            this.blockT = 3.5;
            break;
          }
        }
      }
      /* --- steering: aim at a point ahead, cutting towards the inside of corners --- */
      const kA = T.curvAt(s + 20 + v * 0.5);
      const xt = M.clamp(this.lane + M.clamp(kA * 320, -2.4, 2.4), -T.RW + 1.1, T.RW - 1.1);
      const look = 10 + v * 0.35;
      const hrDes = Math.atan2(xt - r.x, look);
      // wanted turn rate -> the lean that gives it (physics() turns a lean into w = g·tan(lean)/v),
      // plus a little lead so the roll-in lag doesn't leave the rival late on every corner
      const w = T.curvAt(s + v * 0.3) * v + tr.gain * (hrDes - r.hr);
      const lean = Math.atan((w * Math.max(v, 2)) / 9.81);
      const steer = M.clamp(lean / Math.atan((r.st.lat * race.grip) / 9.81), -1, 1);
      let throttle = 0, brake = 0;
      if (v < vt - 1) throttle = 1;
      else if (v > vt + 1.5) brake = M.clamp((v - vt) / 7, 0.2, 1);
      else throttle = 0.35;
      // overcooked it: grab a handful of brake mid-corner (this is what can lose the front)
      if (this.err > 1 && Math.abs(r.lean) > 0.4 && v > vt) brake = 1;
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

  SR.Race.AIController = AIController;
})(window.SR);
