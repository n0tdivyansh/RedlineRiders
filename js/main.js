'use strict';
/* ============================================================
   Boot, window scaling, options and the main loop.
   ============================================================ */
(function (SR) {
  const W = 384, H = 216;
  const screen = document.getElementById('screen');
  const glc = document.getElementById('gl');
  const hud = document.getElementById('hud');
  const crt = document.getElementById('crt');
  const ctx = hud.getContext('2d');
  hud.width = W; hud.height = H;
  ctx.imageSmoothingEnabled = false;

  function fit() {
    const vw = window.innerWidth, vh = window.innerHeight;
    let s = Math.min(vw / W, vh / H);
    if (s >= 2 && Math.floor(s) >= s * 0.9) s = Math.floor(s); // integer scale when it wastes little space
    screen.style.width = Math.round(W * s) + 'px';
    screen.style.height = Math.round(H * s) + 'px';
    screen.style.setProperty('--px', s + 'px');
  }

  SR.applyOptions = function () {
    const o = SR.data.opt;
    SR.GL.resize(W * o.res, H * o.res);
    SR.GL.dither = !!o.dither;
    SR.GL.snap = !!o.snap;
    crt.classList.toggle('off', !o.crt);
    SR.Audio.setVolumes(o.music, o.sfx);
  };

  async function boot() {
    SR.Save.load();
    if (!SR.GL.init(glc)) {
      document.body.innerHTML = '<p style="color:#fff;font:16px monospace;padding:2em">Redline Riders needs WebGL. Please use a recent Chrome, Edge, Firefox or Safari.</p>';
      return;
    }
    SR.Input.init();
    SR.applyOptions();
    fit();
    addEventListener('resize', fit);
    addEventListener('beforeunload', () => SR.Save.save());
    document.addEventListener('visibilitychange', () => { if (document.hidden) SR.Save.save(); });
    await SR.Bikes.load();
    SR.Screens.go('boot');
    let last = performance.now();
    function frame(now) {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      SR.Input.update();
      try {
        SR.Screens.update(dt);
        SR.GL.clear([0, 0, 0]);
        SR.Screens.render3d(dt);
        ctx.clearRect(0, 0, W, H);
        SR.Screens.draw2d(ctx, dt);
      } catch (e) {
        console.error(e);
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, 30);
        SR.Font.draw(ctx, 'ERROR: ' + String(e.message).slice(0, 58), 4, 4, '#ff6060');
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  boot();
})(window.SR);
