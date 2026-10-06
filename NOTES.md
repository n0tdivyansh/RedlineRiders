# Redline Riders — developer notes

**Keep this file updated after every change** (change log + next steps). Other Claude sessions pick up from here. Player-facing docs are in `README.md`.

## What it is

A retro 3D arcade **motorbike** racer (Super Hang-On / Road Rash spirit, racing only — no combat), built from scratch in `redline/`. English only. Made-up brands and names everywhere (trademark check still to do before launch). It is the owner's own game, separate from the car game (Speed Rush, `source/`).

- **Solo now**: Championship (8 cups × 4 tracks), Quick Race, Time Trial with ghost.
- **Multiplayer later** (designed for, not built): see "Multiplayer plan". The menu has a "Multiplayer — coming soon" screen.

## How to run and test

- Open `redline/index.html` directly (works from `file://`), or use the dev server: `preview_start` name `redline` (`.claude/serve_redline.py`, port **8768**, no-cache headers). `.claude/` is gitignored; recreate it if missing.
- Don't use port 8767: the browser pane cached old files from the car game there.
- Node.js is not installed; there is no build step.
- Model viewer: `http://localhost:8768/dev/bikes.html?res=3` — keys 1-6 switch styles; `view(styleIndex, yaw, dist, pitch)` from the console. Screenshots can lag one frame behind a `view()` call, so wait ~0.5 s before capturing.
- Useful console hooks:
  - `SR.Screens.go('prerace', {quick:true, def: SR.trackById('usa3'), bike:'furia', laps:1, rivals:11})` then press Enter to start any track.
  - Fast-forward a race without rendering: `r = SR.Screens.cur.race; r.locals[0].ctrl = new SR.Race.AIController({pace:1, lane:0, rng:SR.M.rng(1)}); r.locals[0].ctrl.kind='local'; while (r.phase!=='finish') r.update(0.1);` (a 3-lap race takes about 0.3 s).
  - Hold the throttle from the console: `dispatchEvent(new KeyboardEvent('keydown',{code:'ArrowUp'}))`.
  - `SR.Save.reset()` wipes the save.
- Verified 2026-09-30: title/attract demo, quick race start to finish, results, starter pick, hub, time trial + ghost save, several themes (night city, desert, Japan, snow night, rain jungle). A steady 60 fps at the 432p default with 12 bikes on screen.

## Tech / architecture

Plain JS (classic scripts sharing the `window.SR` namespace, loaded in order by `index.html`) + a tiny custom WebGL 1 renderer.

| File | Purpose |
|---|---|
| `js/core.js` | `SR` namespace, math (`SR.M`: vectors, 4x4 matrices incl. `mulm`, seeded RNG), formatting (`SR.fmtTime`, `SR.money`, `SR.ord`), safe `SR.store` (localStorage) |
| `js/font.js` | 5x7 bitmap font (`SR.Font.draw/outline/gradient/glyph`) + pixel UI helpers (`SR.UI2.panel/bar/segs`) |
| `js/gl.js` | Renderer (`SR.GL.init/resize/clear/beginView/draw`) + mesh builder `SR.GL.MB` (tri, triN (smooth normals), quad, poly, box, cyl, cone, ball, text-as-geometry, `at()` placement with yaw/scale/mirror). Materials in `SR.MAT` |
| `js/data.js` | `SR.BIKES` (8 bikes), `SR.bikeStats()`, `SR.UPGRADES` (6 × 4 levels), `SR.TIMES` (day/sunset/dusk/night palettes), `SR.WEATHER`, `SR.THEMES` (11 scenery themes), `SR.CUPS` (8 × 4 tracks, each `{name, theme, time, weather, seed, len, curvy, hills}`), `SR.RIVALS`, points/prizes/difficulty, `SR.SPONSORS` |
| `js/bikes.js` | Procedural bikes (6 styles) + riders — see below. `SR.Bikes.get(style)` → `{body, rider, wheelF, wheelR, style}`; `SR.Bikes.shared()` → shadow/puff/glow/flame |
| `js/props.js` | Scenery props (`SR.Props.*`: cactus, rock, mesa, billboard, building, lamp, tree, sakura, palm, bush, house, chalet, townhouse, cypress, pine, snowpine, snowman, windmill, hay, torii, pagoda, stone) + furniture (gantry, chevron, grandstand) |
| `js/track.js` | `SR.Track.build(def)`: star-shaped Catmull-Rom loop with a straight through the start, sine hills, road/lines/rumble/terrain/rails or walls, scenery, gantry, grandstand, chunked meshes, ground plane, sky dome (sun/moon, stars, clouds, aurora, mountain rings, city skyline, Fuji). `SR.Track.env(def)` = lighting + fog. Queries: `pos(s,x)`, `yawAt`, `curvAt`, `slopeAt`, `heightAt`, `mapXY` |
| `js/audio.js` | Web Audio: `sfx(name)`, `engine()` (per local rider + a pass-by engine), `skid()`, `ambience()`, chiptune sequencer `music(name)` with songs `title`, `menu`, `race1-3` |
| `js/input.js` | Keyboard + gamepads. `Input.menu()` (edges), `Input.controls(slot)` (riding struct), `pausePressed`, `cameraPressed` |
| `js/save.js` | `SR.Save.load/save/reset`, key `redline_v1` (+ `_bak` backup). `SR.data` = the live save |
| `js/race.js` | `SR.Race.create(cfg)`: simulation, slipstream, grip budget/lowside, crashes, laps, ghost, cameras, rendering; `SR.Race.buildField(cup, n, diff, seed)` |
| `js/ai.js` | `SR.Race.AIController`: rival riding (target speed from the track ahead, traffic, slipstream seeking, blocking, per-corner mistakes). Traits in `SR.TRAITS` (data.js), one per rival name |
| `dev/balance.html` | Headless race checks (open with `?run`, or `runChecks()` / `sim({...})` from the console): determinism, slipstream, lowside, rival crash rate, difficulty per cup, economy ladder. Loads the game scripts with a cache-busting query |
| `js/hud.js` | `SR.HUD.draw(ctx, race, W, H, dt)`: position, lap, timers, speed/tach/gear, nitro, minimap, countdown lights, messages, rain/snow overlay |
| `js/screens.js` | State machine `SR.Screens.go(name, args)`: boot, title (attract demo), main, starter, hub, cups, prerace, race (+pause), results, standings, cupend, shop, dealer, garage, quick, tt, options, controls, mp, credits. Also the showroom studio and the demo race |
| `js/main.js` | Boot, window scaling (integer when possible), `SR.applyOptions()`, main loop with error overlay |

### Conventions
- Units: metres, seconds. Models face **-Z**, +X right, +Y up. `M.model(out, x,y,z, yaw, pitch, roll, scale)`: positive yaw turns left, positive pitch lifts the nose, positive roll raises the right side.
- Track coordinates: `s` (m along the centre line), `x` (m, + = right). `curv` is right-turn positive (1/m). Road half-width `RW = 7`, rail/wall at `LIMIT = 13.6`.
- Rider physics uses a **track-relative heading `hr`** (right positive): `hr' = w - curv·v`, `x' = v·sin(hr)`, `d' = v·cos(hr)`. The turn rate `w` is limited by grip (`lat / v`), so going too fast = running wide. The steering assist straightens you up when there's no input. `lean = atan(v·w / g)`.
- Crashing: hitting the rail with `v > bike.crash` and enough impact, or rear-ending a rider with >13 m/s closing speed → 3.2 s tumble, then respawn on the road with 2 s of no collisions.
- Steering is lean-driven (bike physics, not car physics): input sets a target lean, `steer × atan(grip/g)`, i.e. full lock = the tyre limit. `r.lean` rolls towards it at `1.6 + 3.2/(1 + v/16)` rad/s (flicks at low speed, heavier at speed), and the turn follows from the lean: `w = g·tan(lean)/v` (capped at `v/3` at walking pace). No input: target lean straightens the heading. `r.fork` = visual countersteer on the front wheel. The AI asks for the lean that gives its wanted turn rate, steering for the curvature ~0.3 s ahead to cover the roll-in lag. Lean is drawn at 0.8x (tyre-limit ~67° shows as ~55°); the rider mesh hangs off the inside (slid 7 cm, rolled 0.18 rad further) and the knee slider throws sparks above 82% of max lean.
- Grip budget (friction circle): braking uses part of the tyre grip, `brakeUse = 17·brake / (grip·1.3)`, leaving `grip·√(1−brakeUse²)` for cornering. Above 20 m/s, braking > 0.6, leaned > 0.5 rad and asking > 10% more than is left: `r.slideT` builds (tyre squeal + "FRONT SLIDING"); past 0.6 s → **lowside** (`crashRider(r, side, 'lowside')`: 2.2 s, low slide). Easy difficulty caps `slideT` instead (`SR.DIFF.*.lowside`).
- Who gets the grip budget: the player, and a rival only while it has misjudged a corner (`ctrl.err > 1`). Composed rivals keep the simple model: their lines rely on mid-corner braking, and giving them the friction circle sent them into the rails (tried: capping their braking, and braking only with spare grip; both failed). `r.bench` turns it off for the balance page's AI-driven stand-in player.
- Slipstream (`race.slipstream()`, before physics each step): 4–30 m behind a rider within 1.2 m of their line, both > 28 m/s → `r.draft` 0–1 (closer = stronger). Effect: top speed ×(1 + 0.07·draft), drag ×(1 − 0.35·draft). `r.draftT` counts time tucked in; 2 s refills a nitro charge.
- Rival mistakes: on corner entry (curvature > 1/140 m⁻¹ at `s + 25 + v`) each rival rolls `trait.mistake × diff.mistakes`; a hit sets `err` = 1.08–1.15 (overestimates the corner speed by that factor) until the corner is done, and it grabs full brake mid-corner. Tuned to ~1 rival crash per race.
- Balance: `SR.CUPS[*].bikes` (rival bike range), `aiTop` (rival top speed, only matters below each bike's rating: pace is capped at 1.02), `aiGrip` (rival grip trim; corners decide lap times, so this is the real difficulty knob). Target, checked by `dev/balance.html`: a rider on a late-braker line with no mistakes, on the bike an average (2nd-place) player can afford (`LADDER`), laps 1–4% quicker than the fastest rival in every cup.
- Two stacked canvases: `#gl` (3D, 384×216 × `opt.res`) and `#hud` (2D, always 384×216), CSS-scaled with `image-rendering: pixelated`; `#crt` = scanline overlay.
- Mesh vertex = pos3, normal3, color3, material1. The shader flips normals on back faces, so winding doesn't matter for flat faces; smooth normals must match the triangle winding (`grid()` in bikes.js handles this). Materials: LIT, PAINT (×uPaint), EMIT, GRAIN (world-space noise), BRAKE, SKY (no light/fog), HEAD, PAINT2 (×uPaint2), EPAINT.
- The retro look: 15-bit colour + 4x4 Bayer dither, vertex snapping to the render grid, smoothstep distance fog, screen-door transparency for shadows/ghosts, night headlight cone in the shader.

### Blender bikes (`blender/`, the models the game uses)
- `blender/bikelib.py` builds each style's body + front/rear wheel in Blender from lofted superellipse sections, surfaces of revolution and swept tubes (same approach as Speed Rush's `blender/carlib.py`, with bike parts: USD forks, clamps, clip-ons, twin-spar or trellis frame, inline-4 / single / V-twin engines, 4-into-1 exhausts, swingarm, chain, drilled discs, split-spoke or laced wheels, fairings, tanks, tails, lights).
- Coordinates are the game's (Y up, bike faces −Z), and the wheel, seat, grip and peg positions match `STYLES`/`POSES` in `js/bikes.js`, so the JS rider still fits.
- Export: `"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python blender/export_bikes.py` (≈17 s for all six; add `-- sport naked` for some). It bakes two-sided ambient occlusion per vertex against the assembled bike and the ground, packs positions (uint16), octahedral normals, palette index, AO and indices, zlib + base64 → `js/bike-models.js` (≈1.2 MB). `blender/out/` is a regenerable cache (gitignored).
- The game decodes it in `SR.Bikes.load()` (awaited in `main.js` boot; also in `dev/bikes.html`); `SR.Bikes.get()` uses the Blender body/wheels when present and falls back to the JS builders below.

### Bike generator (`js/bikes.js`, fallback)
- Same approach as `source/blender/carlib.py` (the Top Gear cars), ported to JS: `part()` = loft of superellipse sections along Z, driven by PCHIP `Curve`s (top, bottom, half-width, squareness, taper) + optional `warp`; `grid()` gives smooth normals; `color(x,y,z)` paints liveries and details per quad.
- Real proportions: wheelbase ~1.40 m, wheels ~0.62 m, 24° rake, seat ~0.86 m. The front wheel sits ahead of the lower fairing; the nose sits above the wheel with a slanted "face" carrying twin headlights and a ram-air intake.
- Details too small for the mesh (race numbers, headlights) are separate geometry laid on the surface. Thin painted pinstripes break up at this density — avoid them.
- Styles: `sport`, `gp`, `hyper`, `naked`, `moto`, `cruiser`. Rider poses: `tuck`, `tuckLow`, `mid`, `moto`, `upright`. Leathers use PAINT + PAINT2; the helmet is PAINT with a PAINT2 stripe and a tinted visor.
- About 7k–14k triangles per bike+rider.

## Multiplayer plan (future scope)

Built so multiplayer can be added without a rewrite:
- The race simulation is **fixed-step (120 Hz)** and uses only seeded RNG (`race.rng`, per-AI RNGs), so it is deterministic for the same inputs. Particles and camera shake use `Math.random` but are visual only.
- Every rider is driven by a **controller** producing `{steer, throttle, brake, nitro, shiftUp, shiftDown}` each tick: `LocalController(slot)`, `AIController`, later `RemoteController`.
- `race.snapshot()` / `race.applySnapshot()` serialise rider state (host-authoritative sync).
- The renderer draws any number of **viewports** (`race.viewports()`, one camera per local rider), and the HUD already handles split screens. Local split-screen = add a second `locals` entry with `slot: 1` + a menu.
- Online plan: host-authoritative; clients send inputs with tick numbers; the host broadcasts snapshots; clients interpolate other riders and predict their own. WebRTC data channels (P2P) or a small WebSocket relay.

## Change log

### 2026-09-29 / 30 — Game built
- Direction changes during the first session: retro English remake → must be 3D → **bikes instead of cars** → solo now, multiplayer later → realistic Road Rash-style bikes → use the Top Gear car-generator method.
- Bike models went through three passes: (1) boxy slabs — rejected ("not really a good bike model"); (2) proportions fixed from real 600cc specs; (3) the Top Gear PCHIP/superellipse loft method, a slanted headlight face and a geometric race-number roundel.
- All game files written: renderer, bikes, props, tracks, audio, input, save, race sim/AI, HUD, all menus, README.
- Added `Play Redline Riders.bat` (Windows launcher: opens `index.html` in the default browser).
- Fixed the time-of-day name showing as numbers on the pre-race screen.
- Fixes found in testing: headlight uniform set without a position (pre-race flyover crash), `©` missing from the font, stat-bar text overflowing its panel, a stale browser cache on port 8767.

### 2026-09-30 — Racing core
- Slipstream with nitro refill; HUD slipstream meter; wind streaks on slipstream/nitro; `draft` sfx.
- Grip budget + lowside crash for the player (and for rivals that misjudge a corner); "FRONT SLIDING" warning; off on Easy.
- Rival AI moved to `js/ai.js`; four traits (clean, blocker, late braker, rookie) assigned per rival name; seeded per-corner mistakes; blockers cover the inside; rivals seek slipstreams.
- Balance: rival bike range, upgrade levels (`engine: cup/3`, `tires: cup/4`) and grip trim per cup; prizes ×1.5; Furia $40k, Blitz $85k, Tengu $160k. Before: a strong rider on an affordable bike lost USA, won S.AM–GER by up to 11 s, then couldn't win SCA–UK. After: 1.7–3.1% quicker than the fastest rival in every cup.
- `dev/balance.html` added (6 checks, all passing).
- Known: Grand Canal (ita4) has a 21 m hairpin between walls where even clean riders hit the wall; Italy's `aiGrip` is lowered to compensate until the track pass fixes it.

### 2026-09-30 — Turning and bike models
- Lean-driven steering with roll-rate lag and countersteer; AI adapted; lowside threshold `over > 0.1` (with lean capped at the tyre limit, 25% overload was unreachable). Rival mistake rates re-tuned (clean 0.008, blocker 0.01, late 0.026, rookie 0.032).
- Rider hang-off, knee-slider sparks, 0.8x drawn lean.
- Sport/GP/hyper nose: pointed beak (half-width 5 cm at the tip), creased section (`n: 1.9`), lower top line so the screen leads, slit headlights painted along the nose sides, black ram-air mouth. Replaces the round nose with round headlights.
- `dev/balance.html`: new turning check (roll-in 0.30 s at 54 km/h, 0.43 s at 252 km/h); all 7 checks pass.

### 2026-09-30 — Glitch fixes
- `GL.backdrop()` (gl.js): sky, horizon ground/sea and the showroom floor + neon grid draw with no vertex snapping and no depth writes (the sea keeps depth). Fixes the showroom turntable vanishing / background flicker while the camera circles (the snapped 400 m floor quad tilted through it) and land-track terrain z-fighting the ground plane it meets at `base`.
- Race camera near plane 0.6 m (0.2 m for the helmet cam) for depth precision on far road lines.
- `collide(dt)` resolves overlap and closing speed over ~35 ms instead of in one step (removed 0.45 m sideways teleports and 10 m/s instant speed cuts). Rival mistake rates re-tuned: clean 0.006, blocker 0.007, late 0.018, rookie 0.022. All 7 `dev/balance.html` checks pass.
- Dev server `dev/serve.py` (no-store); `.claude/launch.json` `redline-riders` uses it.

## Next steps

1. Get the owner's feedback on feel, especially the lowside threshold (race.js `physics()`: `brk > 0.6`, `over > 0.25`, `slideT > 0.6`) and slipstream strength (`slipstream()`), then steering/grip (`wSteer`, assist).
2. Tracks pass: named corner types (hairpin, chicane, esses, kink, crest) and a minimum radius per cup; fix the Grand Canal hairpin, then retune Italy's `aiGrip` with `dev/balance.html`.
3. Feel/visual polish: closer roadside objects for speed sense, camera, rider body language; spray/shadow discs; lightning flash strength.
4. Touch controls for phones/tablets (none yet), LOD for distant bikes, favicon, single-file build.
5. Local split-screen (engine ready; needs a menu + second input slot), then online.
6. Rename before launch: "Redline Riders" is taken (a paid itch.io street-racing game). Trademark check the bike/brand names too.
