'use strict';
/* ============================================================
   Save data (localStorage, key "redline_v1") with a backup copy.
   ============================================================ */
(function (SR) {
  const KEY = 'redline_v1';
  const S = (SR.Save = {});

  S.fresh = () => ({
    v: 1,
    name: 'YOU',
    money: 2000,
    owned: [],            // bike ids
    bike: null,           // current bike id (null until a starter is chosen)
    up: {},               // bikeId -> { engine: 0..4, ... }
    paint: {},            // bikeId -> [paintIdx, paint2Idx] or null for factory colours
    cupUnlocked: 1,       // number of cups available
    cupBest: {},          // cupIndex -> best final place
    champ: null,          // cup in progress: { cup, race, pts:[...], field:[...] }
    records: {},          // trackId -> { lap, race }
    ghosts: {},           // trackId -> { t, d: [...] } best lap replay
    opt: { diff: 'normal', trans: 'auto', units: 'kmh', crt: true, dither: true, snap: true, res: 2, music: 0.55, sfx: 0.8, cam: 0 },
    stats: { races: 0, wins: 0, podiums: 0, crashes: 0 },
  });

  S.load = function () {
    let d = SR.store.get(KEY, null) || SR.store.get(KEY + '_bak', null);
    const f = S.fresh();
    if (!d || d.v !== 1) d = f;
    // fill in any fields added later
    for (const k in f) if (d[k] === undefined) d[k] = f[k];
    for (const k in f.opt) if (d.opt[k] === undefined) d.opt[k] = f.opt[k];
    SR.data = d;
    return d;
  };
  S.save = function () {
    if (!SR.data) return;
    const prev = SR.store.get(KEY, null);
    if (prev) SR.store.set(KEY + '_bak', prev);
    if (!SR.store.set(KEY, SR.data)) {
      // quota: drop ghosts and retry
      SR.data.ghosts = {};
      SR.store.set(KEY, SR.data);
    }
  };
  S.reset = function () {
    SR.store.del(KEY);
    SR.store.del(KEY + '_bak');
    SR.data = S.fresh();
    S.save();
  };
  S.upgrades = (id) => (SR.data.up[id] = SR.data.up[id] || {});
  S.paints = (id) => {
    const b = SR.bikeById(id), p = SR.data.paint[id];
    if (!p) return [SR.M.rgb(b.paint), SR.M.rgb(b.paint2)];
    return [SR.M.rgb(SR.PAINTS[p[0]]), SR.M.rgb(SR.PAINTS[p[1]])];
  };
})(window.SR);
