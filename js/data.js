'use strict';
/* ============================================================
   Game data: bikes, upgrades, themes, cups/tracks, rivals, prizes
   All brands and names are made up.
   ============================================================ */
(function (SR) {
  const M = SR.M;

  /* ---------- Bikes ----------
     top: km/h · acc: 0-100 km/h seconds · grip: lateral grip (m/s²) · off: off-road speed factor
     crash: speed (km/h) above which hitting a wall throws the rider · style: mesh style (see models.js) */
  SR.BIKES = [
    {
      id: 'vx400', brand: 'KAIZEN', name: 'VX-400', price: 0, starter: true,
      top: 236, acc: 4.2, grip: 21.5, gears: 6, off: 0.48, crash: 70, style: 'sport',
      paint: '#ff3c9e', paint2: '#1a1a24', eng: { base: 58, cyl: 4 },
      desc: 'A screaming little four-cylinder sport bike. Balanced in every way - the classic choice.',
    },
    {
      id: 'ironclad', brand: 'GARRISON', name: 'IRONCLAD', price: 0, starter: true,
      top: 252, acc: 4.8, grip: 19, gears: 5, off: 0.44, crash: 80, style: 'cruiser',
      paint: '#1f5fd6', paint2: '#e8e8e8', eng: { base: 30, cyl: 2 },
      desc: 'A big V-twin brute. Huge top speed and tough as nails, but lazy in the corners.',
    },
    {
      id: 'terra', brand: 'LUCENTI', name: 'TERRA 350', price: 0, starter: true,
      top: 218, acc: 3.8, grip: 23.5, gears: 6, off: 0.66, crash: 66, style: 'moto',
      paint: '#ffc700', paint2: '#1b3fa6', eng: { base: 46, cyl: 1 },
      desc: 'A supermoto thumper. Rockets off the line, sticks to anything, laughs at grass.',
    },
    {
      id: 'ronin', brand: 'WEXLEY', name: 'RONIN 600', price: 0, starter: true,
      top: 230, acc: 4.0, grip: 22.8, gears: 6, off: 0.5, crash: 70, style: 'naked',
      paint: '#5dbb1c', paint2: '#141414', eng: { base: 52, cyl: 3 },
      desc: 'A light naked streetbike. Flicks through chicanes like it weighs nothing.',
    },
    {
      id: 'furia', brand: 'VELLANTE', name: 'FURIA 999', price: 40000,
      top: 276, acc: 3.6, grip: 22.5, gears: 6, off: 0.46, crash: 72, style: 'sport',
      paint: '#d10a0a', paint2: '#f2f2f2', eng: { base: 38, cyl: 2 },
      desc: 'An Italian superbike with a thundering twin and a paint job to match.',
    },
    {
      id: 'blitz', brand: 'STAHLBERG', name: 'BLITZ 1000R', price: 85000,
      top: 298, acc: 3.2, grip: 23.8, gears: 6, off: 0.5, crash: 76, style: 'sport',
      paint: '#b9bfc8', paint2: '#1f5fd6', eng: { base: 54, cyl: 4 },
      desc: 'German precision at 14,000 rpm. Stable, fast and brutally efficient.',
    },
    {
      id: 'tengu', brand: 'HAYATO', name: 'TENGU GP', price: 160000,
      top: 322, acc: 2.9, grip: 25.8, gears: 6, off: 0.42, crash: 74, style: 'gp',
      paint: '#19c3b0', paint2: '#f4f4f4', eng: { base: 62, cyl: 4 },
      desc: 'A grand-prix racer with lights bolted on. Corners like it is on rails.',
    },
    {
      id: 'zenith', brand: 'AURELLE', name: 'ZENITH X', price: 290000,
      top: 352, acc: 2.6, grip: 25, gears: 6, off: 0.44, crash: 78, style: 'hyper',
      paint: '#ff7a1a', paint2: '#141414', eng: { base: 44, cyl: 4 },
      desc: 'Supercharged, winged and slightly insane. The fastest thing on two wheels.',
    },
  ];
  SR.bikeById = (id) => SR.BIKES.find((c) => c.id === id) || SR.BIKES[0];

  SR.PAINTS = [
    '#ff3c9e', '#d10a0a', '#ff7a1a', '#ffc700', '#5dbb1c', '#19c3b0', '#1f5fd6', '#6b2bd1',
    '#eef0f3', '#b9bfc8', '#3a3f4a', '#1a1a24',
  ];

  /* ---------- Upgrades (4 levels each) ---------- */
  SR.UPGRADES = [
    { id: 'engine', name: 'ENGINE', desc: '+4% TOP SPEED PER LEVEL', base: 3000 },
    { id: 'exhaust', name: 'EXHAUST', desc: '+8% ACCELERATION PER LEVEL', base: 2600 },
    { id: 'tires', name: 'TIRES', desc: '+7% GRIP IN CORNERS', base: 2200 },
    { id: 'gearbox', name: 'GEARBOX', desc: 'FASTER SHIFTS, +4% ACCEL', base: 2000 },
    { id: 'nitro', name: 'NITRO', desc: '+1 NITRO CHARGE PER LEVEL', base: 1800 },
    { id: 'suspension', name: 'SUSPENSION', desc: 'FASTER ON GRASS, CRASH LESS', base: 1500 },
  ];
  SR.UP_MAX = 4;
  SR.upCost = (u, lvl) => u.base * (lvl + 1) + (lvl >= 3 ? u.base : 0);

  /** Derive physics stats from a bike + upgrade levels */
  SR.bikeStats = function (bike, up) {
    up = up || {};
    const L = (k) => up[k] || 0;
    return {
      vmax: (bike.top / 3.6) * (1 + 0.04 * L('engine')),
      a0: ((100 / 3.6) / bike.acc) * 1.18 * (1 + 0.08 * L('exhaust') + 0.04 * L('gearbox')),
      lat: bike.grip * (1 + 0.07 * L('tires')),
      off: Math.min(0.85, bike.off + 0.05 * L('suspension')),
      crash: (bike.crash / 3.6) * (1 + 0.08 * L('suspension')),
      gears: bike.gears,
      shift: 0.16 - 0.03 * L('gearbox'),
      nitro: 2 + L('nitro'),
    };
  };

  /* ---------- Time-of-day palettes ---------- */
  const P = (o) => {
    const r = {};
    for (const k in o) r[k] = typeof o[k] === 'string' && o[k][0] === '#' ? M.rgb(o[k]) : o[k];
    return r;
  };
  SR.TIMES = {
    day: P({ skyTop: '#2f6fe0', skyHor: '#a9d4f5', sun: '#fff6d8', sunCol: '#fff1d0', sunI: 0.95, amb: '#8fa6c8', gnd: '#6a5f48', sunY: 0.62, fog: 0, stars: 0, name: 'DAY' }),
    sunset: P({ skyTop: '#3a2d7a', skyHor: '#ff9a55', sun: '#ffd27a', sunCol: '#ffb070', sunI: 0.85, amb: '#8a6a8e', gnd: '#5a3a3a', sunY: 0.08, fog: 0, stars: 0.2, name: 'SUNSET' }),
    dusk: P({ skyTop: '#1d1850', skyHor: '#b0507a', sun: '#ff9ac0', sunCol: '#d07aa0', sunI: 0.5, amb: '#5a4a7e', gnd: '#302838', sunY: -0.02, fog: 0, stars: 0.6, name: 'DUSK' }),
    night: P({ skyTop: '#05061a', skyHor: '#1c2250', sun: '#e8eeff', sunCol: '#7080b0', sunI: 0.28, amb: '#2a3050', gnd: '#101018', sunY: 0.5, fog: 0, stars: 1, name: 'NIGHT', night: true }),
  };
  SR.WEATHER = {
    clear: { name: 'CLEAR', grip: 1, fog: 1 },
    rain: { name: 'RAIN', grip: 0.84, fog: 0.62 },
    snow: { name: 'SNOW', grip: 0.74, fog: 0.55 },
    fog: { name: 'FOG', grip: 0.95, fog: 0.32 },
  };

  /* ---------- Scenery themes ----------
     grass: terrain band colors · ground: far ground plane · props: weighted scenery list
     hill: mountain backdrop color · walls: concrete walls along the track */
  SR.THEMES = {
    desert: { grass: ['#d8a560', '#c99550'], shoulder: '#b98848', ground: '#c98f52', hill: '#b0583a', hillH: 1.2, props: [['cactus', 5], ['rock', 4], ['mesa', 1], ['billboard', 1]], density: 0.5 },
    city: { grass: ['#6a6e78', '#5e626c'], shoulder: '#8a8e96', ground: '#3a3c44', hill: '#4a4f66', hillH: 0.5, city: true, walls: true, props: [['building', 8], ['lamp', 0], ['billboard', 2], ['tree', 1]], density: 1 },
    coast: { grass: ['#e8d49a', '#dcc78c'], shoulder: '#d8c28a', ground: '#1f7fb8', water: true, hill: '#3f8a6a', hillH: 0.8, props: [['palm', 7], ['bush', 2], ['billboard', 1], ['house', 1]], density: 0.7 },
    forest: { grass: ['#3f8f3a', '#378232'], shoulder: '#4c9a40', ground: '#2f6f2c', hill: '#2f5a4a', hillH: 1.0, props: [['pine', 9], ['tree', 3], ['rock', 1], ['billboard', 1]], density: 1 },
    snow: { grass: ['#eef3f8', '#e0e8f0'], shoulder: '#dfe6ee', ground: '#dfe8f2', hill: '#8a9ab8', hillH: 1.3, snowy: true, props: [['snowpine', 8], ['rock', 2], ['snowman', 1], ['billboard', 1]], density: 0.8 },
    country: { grass: ['#6ab04a', '#8cc050'], shoulder: '#6aa844', ground: '#5a9a3c', hill: '#4f7a4a', hillH: 0.7, props: [['tree', 6], ['house', 2], ['windmill', 1], ['bush', 3], ['hay', 2]], density: 0.6 },
    jungle: { grass: ['#2f7a2a', '#286e24'], shoulder: '#357f2e', ground: '#1f5a1c', hill: '#1f4a3a', hillH: 1.1, props: [['palm', 5], ['tree', 5], ['bush', 4], ['rock', 1]], density: 1.2 },
    japan: { grass: ['#5aa04a', '#4f9440'], shoulder: '#5a9a48', ground: '#4a8a3c', hill: '#5a6a9a', hillH: 0.9, fuji: true, props: [['sakura', 6], ['torii', 1], ['pagoda', 1], ['pine', 3], ['lamp', 1]], density: 0.8 },
    alpine: { grass: ['#5a9a4a', '#4f8e42'], shoulder: '#8a8a80', ground: '#4a7a3c', hill: '#6a7a9a', hillH: 1.8, alpine: true, props: [['pine', 7], ['rock', 4], ['chalet', 1], ['billboard', 1]], density: 0.8 },
    classic: { grass: ['#8a8a82', '#7e7e76'], shoulder: '#a09a8a', ground: '#6a6a62', hill: '#6a6a8a', hillH: 0.5, city: true, walls: true, props: [['townhouse', 7], ['cypress', 3], ['lamp', 0], ['billboard', 1]], density: 1 },
    moor: { grass: ['#6a8a4a', '#5e7e42'], shoulder: '#6a7a4a', ground: '#4a6a3a', hill: '#5a6a5a', hillH: 0.9, props: [['stone', 3], ['bush', 4], ['rock', 3], ['tree', 1]], density: 0.5 },
  };

  /* ---------- Cups (8 regions × 4 tracks) ----------
     aiTop: rivals' target top speed (km/h) · aiGrip: trim on rivals' tyre grip (tuned in dev/balance.html) · bikes: [lo, hi] range of rival bikes, as indices into
     SR.BIKES sorted by top speed (0 = TERRA 350 ... 7 = ZENITH X) · prize: 1st-place money per race */
  const T = (name, theme, time, weather, seed, len, curvy, hills) => ({ name, theme, time, weather, seed, len, curvy, hills });
  SR.CUPS = [
    { id: 'usa', name: 'UNITED STATES', short: 'USA', aiTop: 218, aiGrip: 1, bikes: [0, 3], prize: 4500, flag: ['#b22234', '#fff', '#3c3b6e'], tracks: [
      T('NEON STRIP', 'city', 'night', 'clear', 101, 2600, 0.3, 0.2),
      T('SUNSET PALMS', 'coast', 'sunset', 'clear', 102, 2800, 0.4, 0.3),
      T('RED ROCK RUN', 'desert', 'day', 'clear', 103, 3000, 0.35, 0.5),
      T('FOG CITY HILLS', 'city', 'day', 'fog', 104, 2700, 0.5, 0.9),
    ] },
    { id: 'sam', name: 'SOUTH AMERICA', short: 'S.AM', aiTop: 252, aiGrip: 1.08, bikes: [0, 3], prize: 6750, flag: ['#009c3b', '#ffdf00', '#002776'], tracks: [
      T('COPACABANA COAST', 'coast', 'day', 'clear', 201, 2900, 0.45, 0.3),
      T('TANGO DUSK', 'classic', 'dusk', 'clear', 202, 2700, 0.55, 0.3),
      T('INCA SUMMIT', 'alpine', 'day', 'clear', 203, 3100, 0.5, 1.0),
      T('JUNGLE DOWNPOUR', 'jungle', 'day', 'rain', 204, 2800, 0.55, 0.6),
    ] },
    { id: 'jpn', name: 'JAPAN', short: 'JPN', aiTop: 266, aiGrip: 0.976, bikes: [2, 4], prize: 9750, flag: ['#fff', '#bc002d', '#fff'], tracks: [
      T('SHIBUYA MIDNIGHT', 'city', 'night', 'clear', 301, 2800, 0.55, 0.3),
      T('TEMPLE GARDENS', 'japan', 'day', 'clear', 302, 2900, 0.6, 0.5),
      T('FUJI PASS', 'japan', 'sunset', 'clear', 303, 3200, 0.55, 0.9),
      T('HARBOR RAIN', 'city', 'dusk', 'rain', 304, 2700, 0.6, 0.3),
    ] },
    { id: 'ger', name: 'GERMANY', short: 'GER', aiTop: 282, aiGrip: 1.014, bikes: [3, 4], prize: 13500, flag: ['#000', '#dd0000', '#ffce00'], tracks: [
      T('BRANDENBURG RUN', 'country', 'day', 'clear', 401, 3200, 0.4, 0.3),
      T('MISTY PINES', 'forest', 'day', 'fog', 402, 3000, 0.6, 0.7),
      T('BAVARIAN RAIN', 'country', 'dusk', 'rain', 403, 3100, 0.55, 0.6),
      T('EIFEL RING', 'forest', 'day', 'clear', 404, 3500, 0.7, 1.0),
    ] },
    { id: 'sca', name: 'SCANDINAVIA', short: 'SCA', aiTop: 298, aiGrip: 0.982, bikes: [4, 5], prize: 18000, flag: ['#006aa7', '#fecc00', '#006aa7'], tracks: [
      T('FROZEN HARBOR', 'snow', 'day', 'clear', 501, 3000, 0.5, 0.4),
      T('AURORA NIGHTS', 'snow', 'night', 'clear', 502, 3100, 0.55, 0.5),
      T('FJORD DESCENT', 'alpine', 'dusk', 'clear', 503, 3300, 0.6, 1.2),
      T('ARCTIC CIRCLE', 'snow', 'day', 'snow', 504, 3000, 0.6, 0.5),
    ] },
    { id: 'fra', name: 'FRANCE', short: 'FRA', aiTop: 314, aiGrip: 1.1, bikes: [4, 5], prize: 24000, flag: ['#002395', '#fff', '#ed2939'], tracks: [
      T('CITY OF LIGHTS', 'classic', 'night', 'clear', 601, 2900, 0.6, 0.3),
      T('RIVIERA COAST', 'coast', 'day', 'clear', 602, 3200, 0.6, 0.7),
      T('SARTHE SPEEDWAY', 'country', 'sunset', 'clear', 603, 3800, 0.35, 0.3),
      T('ALPINE HAIRPINS', 'alpine', 'day', 'snow', 604, 3100, 0.75, 1.3),
    ] },
    { id: 'ita', name: 'ITALY', short: 'ITA', aiTop: 330, aiGrip: 0.93, bikes: [5, 6], prize: 31500, flag: ['#009246', '#fff', '#ce2b37'], tracks: [
      T('ETERNAL CITY', 'classic', 'day', 'clear', 701, 3000, 0.65, 0.4),
      T('VINEYARD HILLS', 'country', 'sunset', 'clear', 702, 3300, 0.6, 1.0),
      T('ROYAL PARK', 'forest', 'day', 'clear', 703, 3700, 0.45, 0.3),
      T('GRAND CANAL', 'classic', 'dusk', 'fog', 704, 3000, 0.7, 0.3),
    ] },
    { id: 'gbr', name: 'UNITED KINGDOM', short: 'UK', aiTop: 348, aiGrip: 1.008, bikes: [5, 7], prize: 42000, flag: ['#012169', '#fff', '#c8102e'], tracks: [
      T('MIDNIGHT THAMES', 'classic', 'night', 'rain', 801, 3000, 0.65, 0.3),
      T('HIGHLAND LOCH', 'moor', 'day', 'fog', 802, 3400, 0.65, 1.0),
      T('OLD AIRFIELD GP', 'country', 'day', 'clear', 803, 3600, 0.5, 0.2),
      T('ANCIENT STONES', 'moor', 'dusk', 'clear', 804, 3300, 0.7, 0.8),
    ] },
  ];
  // flat track list with ids
  SR.TRACKS = [];
  SR.CUPS.forEach((cup, ci) => cup.tracks.forEach((t, ti) => {
    t.id = cup.id + (ti + 1);
    t.cup = ci;
    t.idx = ti;
    SR.TRACKS.push(t);
  }));
  SR.trackById = (id) => SR.TRACKS.find((t) => t.id === id) || SR.TRACKS[0];

  /* ---------- Rival drivers ---------- */
  /* ---------- Rival riding styles ----------
     mistake: chance per corner of misjudging it · decel: braking the AI plans with (m/s²)
     lat: share of the tyre grip it trusts · gain: how sharply it holds its line
     block: covers the inside when a player closes in · draft: tucks into slipstreams */
  SR.TRAITS = {
    clean: { name: 'CLEAN', mistake: 0.006, decel: 13, lat: 0.93, gain: 3.2, draft: true },
    blocker: { name: 'BLOCKER', mistake: 0.007, decel: 13, lat: 0.93, gain: 3.2, draft: true, block: true },
    late: { name: 'LATE BRAKER', mistake: 0.018, decel: 15.5, lat: 0.97, gain: 3.4, draft: true },
    rookie: { name: 'ROOKIE', mistake: 0.022, decel: 12, lat: 0.9, gain: 2.4 },
  };
  SR.RIVALS = [
    { name: 'VIPER', color: '#d10a0a', trait: 'blocker' }, { name: 'BLAZE', color: '#ff7a1a', trait: 'late' }, { name: 'NOVA', color: '#ffc700', trait: 'clean' },
    { name: 'JOLT', color: '#5dbb1c', trait: 'rookie' }, { name: 'ORCA', color: '#1f5fd6', trait: 'clean' }, { name: 'RAVEN', color: '#1a1a24', trait: 'blocker' },
    { name: 'SABLE', color: '#6b2bd1', trait: 'late' }, { name: 'KITE', color: '#19c3b0', trait: 'clean' }, { name: 'DUKE', color: '#eef0f3', trait: 'clean' },
    { name: 'RUSTY', color: '#a0522d', trait: 'rookie' }, { name: 'ZIGGY', color: '#ff3c9e', trait: 'late' }, { name: 'CHROME', color: '#b9bfc8', trait: 'clean' },
    { name: 'TURBO TINA', color: '#e0e040', trait: 'late' }, { name: 'MAX POWER', color: '#304070', trait: 'blocker' }, { name: 'DASH', color: '#8a2be2', trait: 'rookie' },
  ];
  SR.traitOf = (name) => (SR.RIVALS.find((n) => n.name === name) || {}).trait || 'clean';

  SR.POINTS = [20, 15, 12, 10, 8, 6, 5, 4, 3, 2, 1, 0];
  SR.PRIZE_MULT = [1, 0.65, 0.45, 0.32, 0.22, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.02];
  // mistakes: multiplier on rival corner mistakes · lowside: players can slide off by braking hard in a lean
  SR.DIFF = {
    easy: { name: 'EASY', pace: 0.9, mistakes: 1.4, lowside: false },
    normal: { name: 'NORMAL', pace: 1, mistakes: 1, lowside: true },
    hard: { name: 'HARD', pace: 1.06, mistakes: 0.7, lowside: true },
  };
  SR.RACERS = 12; // riders per race
  SR.LAPS = 3;
  SR.SPONSORS = ['RUSH COLA', 'VOLT OIL', 'HYPER', 'NITRO-X', 'MEGA TYRES', 'TURBO', 'ACE GAS', 'PIXEL', 'ZOOM', 'KAIZEN', 'SPEED RUSH', '16-BIT'];
})(window.SR);
