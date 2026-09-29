'use strict';
/* ============================================================
   In-race HUD on the 2D pixel canvas (384×216), per viewport.
   ============================================================ */
(function (SR) {
  const M = SR.M, F = SR.Font, UI2 = SR.UI2;
  const HOT = '#ff3c9e', NEON = '#3de0ff', GOLD = '#ffd21a', SH = '#000';
  const HUD = (SR.HUD = {});
  const drops = [];
  for (let i = 0; i < 90; i++) drops.push({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 0.8 });

  HUD.draw = function (ctx, race, W, H, dt) {
    const vps = race.viewports();
    race.cams.forEach((cam, i) => {
      const vp = vps[i];
      const x = Math.round(vp.x * W), y = Math.round(vp.y * H), w = Math.round(vp.w * W), h = Math.round(vp.h * H);
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      weather(ctx, race, x, y, w, h, dt, cam);
      if (cam.demo) { ctx.restore(); return; }
      rider(ctx, race, cam.r, x, y, w, h, vps.length > 1);
      ctx.restore();
    });
    if (vps.length > 1) { ctx.fillStyle = '#000'; ctx.fillRect(0, Math.round(H / 2) - 1, W, 2); }
    // centre messages and countdown (full screen)
    countdown(ctx, race, W, H);
    let my = H * 0.3;
    for (const m of race.messages) {
      const k = m.t / m.max, pop = k > 0.85 ? 1 + (k - 0.85) * 3 : 1;
      const sc = m.big ? Math.round(3 * pop) : 2;
      if (k < 0.2 && Math.floor(m.t * 20) % 2) continue;
      F.outline(ctx, m.text, W / 2, my, m.color, sc, 'center');
      my += sc * 9 + 4;
    }
  };

  function weather(ctx, race, x, y, w, h, dt, cam) {
    const wx = race.track.def.weather;
    if (race.flash > 0) { ctx.fillStyle = `rgba(230,235,255,${race.flash * 0.5})`; ctx.fillRect(x, y, w, h); }
    if (wx !== 'rain' && wx !== 'snow') return;
    const v = cam.r ? cam.r.v : 20;
    for (const d of drops) {
      if (wx === 'rain') {
        d.y += dt * (1.6 + v / 60) * d.s; d.x -= dt * 0.15;
        if (d.y > 1) { d.y -= 1; d.x = Math.random(); }
        if (d.x < 0) d.x += 1;
        const px = x + d.x * w, py = y + d.y * h, len = 6 + v / 12;
        ctx.strokeStyle = 'rgba(190,210,240,0.45)';
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - len * 0.2, py + len); ctx.stroke();
      } else {
        d.y += dt * (0.12 + v / 400) * d.s; d.x += Math.sin(race.t * 2 + d.s * 9) * dt * 0.05 + (d.x - 0.5) * dt * v / 300;
        if (d.y > 1 || d.x < 0 || d.x > 1) { d.y = Math.random() * 0.3; d.x = Math.random(); }
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        const s = d.s > 1.1 ? 2 : 1;
        ctx.fillRect(Math.round(x + d.x * w), Math.round(y + d.y * h), s, s);
      }
    }
  }

  function countdown(ctx, race, W, H) {
    if (race.phase !== 'count' && !(race.phase === 'race' && race.phaseT < 1)) return;
    const n = race.phase === 'count' ? Math.floor(race.phaseT) : 3; // lights lit
    const cx = W / 2, cy = 46;
    UI2.panel(ctx, cx - 44, cy - 14, 88, 28, { top: '#141420', bot: '#050508', border: '#555' });
    for (let i = 0; i < 3; i++) {
      const lx = cx - 26 + i * 26;
      const on = race.phase === 'race' ? 'go' : i < n + 1 ? 'red' : 'off';
      ctx.fillStyle = on === 'go' ? '#20ff60' : on === 'red' ? '#ff2828' : '#3a1010';
      ctx.beginPath(); ctx.arc(lx, cy, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      if (on !== 'off') ctx.fillRect(lx - 4, cy - 5, 3, 2);
    }
  }

  function rider(ctx, race, r, x, y, w, h, small) {
    if (!r) return;
    const data = SR.data, mph = data && data.opt.units === 'mph';
    const N = race.riders.length;
    const s = small ? 1 : 1;
    // position
    if (race.mode !== 'tt') {
      F.outline(ctx, 'POS', x + 6, y + 5, NEON, 1);
      F.outline(ctx, String(r.place), x + 6, y + 14, '#fff', small ? 2 : 3);
      F.outline(ctx, SR.ord(r.place).replace(/\d+/, '') + ' /' + N, x + 6 + (String(r.place).length * 6 * (small ? 2 : 3)) + 2, y + (small ? 21 : 28), '#fff', 1);
    }
    // lap
    const lap = Math.min(race.laps, Math.max(1, r.lapsDone + 1));
    F.outline(ctx, race.mode === 'tt' ? 'LAP ' + lap : 'LAP ' + lap + '/' + race.laps, x + 6, y + (small ? 32 : 40), GOLD, 1);
    // timers
    const cur = race.phase === 'race' || race.phase === 'finish' ? race.clock - r.lapStart : 0;
    F.outline(ctx, 'TIME ' + SR.fmtTime(r.finished ? r.finishT : race.clock), x + w / 2, y + 5, '#fff', 1, 'center');
    F.outline(ctx, 'LAP  ' + SR.fmtTime(r.finished ? r.lastLap : cur), x + w / 2, y + 14, '#c8c8d8', 1, 'center');
    const best = r.bestLap;
    if (best) F.outline(ctx, 'BEST ' + SR.fmtTime(best), x + w / 2, y + 23, NEON, 1, 'center');
    // time trial: gap to ghost
    if (race.mode === 'tt' && race.ghostData) {
      F.outline(ctx, 'GHOST ' + SR.fmtTime(race.ghostData.t), x + w / 2, y + 32, '#9ad8ff', 1, 'center');
    }
    // minimap
    if (!small) minimap(ctx, race, r, x + w - 66, y + 4, 62);
    // speed + tach + gear
    const kmh = r.v * 3.6, spd = Math.round(mph ? kmh * 0.621 : kmh);
    const by = y + h - (small ? 24 : 34);
    const big = small ? 2 : 3;
    F.outline(ctx, String(spd).padStart(3, ' '), x + 8, by, '#fff', big);
    F.outline(ctx, mph ? 'MPH' : 'KM/H', x + 8 + 18 * big + 3, by + 7 * big - 7, NEON, 1);
    // tach: segmented bar
    const segs = 20, tx = x + 8, ty = by + 7 * big + 3;
    for (let i = 0; i < segs; i++) {
      const on = i / segs < r.rpm;
      const col = i >= 17 ? '#ff2838' : i >= 13 ? '#ffd21a' : '#30e070';
      ctx.fillStyle = '#000';
      ctx.fillRect(tx + i * 4, ty, 3, 5);
      ctx.fillStyle = on ? col : '#2a2438';
      ctx.fillRect(tx + i * 4, ty, 2, 4);
    }
    // gear
    const gx = tx + segs * 4 + 4;
    UI2.panel(ctx, gx, ty - 12, 16, 18, { top: '#2a1a5e', bot: '#0d0826', border: r.manual ? HOT : '#e8e0ff' });
    F.draw(ctx, String(r.gear + 1), gx + 8, ty - 7, r.rpm > 0.97 ? '#ff4040' : '#fff', 1, 'center');
    if (r.manual) F.draw(ctx, 'M', gx + 8, ty + 8, HOT, 1, 'center');
    // nitro
    const nx = x + w - 8, ny = y + h - (small ? 16 : 20);
    F.outline(ctx, 'NITRO', nx, ny - 10, NEON, 1, 'right');
    for (let i = 0; i < r.st.nitro; i++) {
      const bx = nx - (i + 1) * 9;
      ctx.fillStyle = '#000'; ctx.fillRect(bx, ny, 8, 8);
      ctx.fillStyle = i < r.nitroN ? (r.nitroT > 0 && i === r.nitroN - 1 ? '#fff' : NEON) : '#1a2a3a';
      ctx.fillRect(bx + 1, ny + 1, 6, 6);
    }
    if (r.nitroT > 0) UI2.bar(ctx, nx - 60, ny + 10, 60, 4, r.nitroT / 3.2, '#9af0ff');
    // wrong-way style warnings
    if (r.offroad && r.v > 10 && race.phase === 'race' && Math.floor(race.t * 3) % 2) F.outline(ctx, 'OFF ROAD', x + w / 2, y + h - 40, '#ffb020', 1, 'center');
    if (r.ghostT > 0 && r.crashT <= 0) F.outline(ctx, 'GET BACK IN IT!', x + w / 2, y + h * 0.62, GOLD, 1, 'center');
  }

  function minimap(ctx, race, r, x, y, size) {
    const m = race.track.map;
    ctx.fillStyle = 'rgba(8,4,20,0.55)';
    ctx.fillRect(x, y, size, size);
    const pad = 5, sc = size - pad * 2;
    const ox = x + pad + (sc - m.w * sc) / 2, oy = y + pad + (sc - m.h * sc) / 2;
    const P = (u, v) => [Math.round(ox + u * sc), Math.round(oy + v * sc)];
    ctx.fillStyle = '#fff';
    for (const [u, v] of m.pts) { const [a, b] = P(u, v); ctx.fillRect(a, b, 1, 1); }
    // start line
    const [su, sv] = race.track.mapXY(0), [sx, sy] = P(su, sv);
    ctx.fillStyle = GOLD; ctx.fillRect(sx - 1, sy - 1, 3, 3);
    for (const q of race.riders) {
      if (q === r) continue;
      const [u, v] = race.track.mapXY(q.s), [a, b] = P(u, v);
      ctx.fillStyle = q.local ? NEON : M.css(q.paint);
      ctx.fillRect(a - 1, b - 1, 2, 2);
    }
    const [u, v] = race.track.mapXY(r.s), [a, b] = P(u, v);
    ctx.fillStyle = '#000'; ctx.fillRect(a - 2, b - 2, 5, 5);
    ctx.fillStyle = Math.floor(race.t * 4) % 2 ? HOT : '#fff'; ctx.fillRect(a - 1, b - 1, 3, 3);
  }
})(window.SR);
