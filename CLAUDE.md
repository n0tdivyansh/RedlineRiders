# Redline Riders — working notes for Claude

Retro 3D arcade motorbike racer. Plain JS (classic scripts on `window.SR`, loaded in order by `index.html`) + a small custom WebGL 1 renderer. No build step, no Node. Full architecture, physics rules and tuning numbers: **NOTES.md** (read it before changing physics, AI or balance). Player docs: README.md.

## Run and verify
- Dev server: `preview_start` name `redline-riders` → `python redlineriders/dev/serve.py 5178` (sends `Cache-Control: no-store`; plain `python -m http.server` let browsers run stale JS and hid changes). If a tab still shows old code: `fetch` every script with `{cache:'reload'}`, then reload.
- The Browser pane pauses `requestAnimationFrame` when hidden; for headless checks use Playwright with the CDP cache disabled. Headless WebGL runs ~1.5 fps, so fast-forward races with `race.update(0.1)` instead of real time.
- **`dev/balance.html?run`** (or `runChecks()` in its console): 7 headless checks — determinism, slipstream, turning roll-in, lowside, rival crash rate (0.5–1.5/race), difficulty per cup (expected bike ridden well = 1–4% quicker than the fastest rival), economy ladder. Run after any physics/AI/data change; all 7 must pass. `sim({...})` runs one race.
- `dev/bikes.html?res=3` model viewer; `view(styleIndex, yaw, dist, pitch)` from the console.

## Bike models (Blender)
- `blender/bikelib.py` (generator, game coordinates: Y up, bike faces −Z) + `blender/export_bikes.py` → `js/bike-models.js` (packed, AO baked). Re-export after editing:
  `"/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup --python blender/export_bikes.py` (≈17 s; `-- sport naked` for some).
- Keep wheel/seat/grip/peg positions in `STYLES` equal to `js/bikes.js` STYLES/POSES (the JS rider sits on them). `js/bikes.js` builders are the fallback only.
- `blender/out/` is a regenerable cache (gitignored). The rider is still built in JS.

## Rules that bit before
- Rivals ride the simple grip model unless they have misjudged a corner (`ctrl.err > 1`); giving composed rivals the friction circle sent them into rails. Steering is lean-driven (`w = g·tan(lean)/v`); the AI asks for a lean and looks ~0.3 s ahead.
- Collisions resolve over ~35 ms (`collide(dt)`), never in one step (one-step fixes teleported bikes 0.45 m and cut 10 m/s instantly).
- Big background meshes (sky, horizon ground/sea, showroom floor) go through `GL.backdrop()`: no vertex snapping, no depth writes (sea keeps depth to hide terrain below it). Snapped huge triangles tilt and poke through nearby surfaces.
- Tuning changes shift rival crash rates; re-run the crash and difficulty checks and adjust `SR.TRAITS[*].mistake` / `SR.CUPS[*].aiGrip`.

## Working style with the owner
- Short plan in chat, then build and verify in the same turn; no spec/plan documents unless asked. Verify with the balance checks and screenshots; report numbers.
- Commit or push only when asked. Nothing from the 2026-09-30 sessions is committed yet (racing core, lean steering, Blender bikes, glitch fixes).

## Open items
1. Confirm the sea no longer rises through the shore on coast tracks (usa2, sam1, fra2) after the `GL.backdrop` change — the user reported "water overflowing the blue plane".
2. Tracks pass: named corner types + min radius per cup; fix Grand Canal (ita4) 21 m hairpin, then retune Italy's `aiGrip`.
3. Owner playtest of feel: lean roll rate, lowside threshold (`brk > 0.6`, `over > 0.1`, `slideT > 0.6`), slipstream strength.
4. Rename before launch ("Redline Riders" is taken on itch.io). Touch controls, bike LOD, favicon, split-screen.
