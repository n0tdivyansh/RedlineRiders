'use strict';
/* ============================================================
   Input: keyboard + gamepads.
   Riders never read devices directly: a controller turns a device
   into the input struct the simulation consumes each tick:
     { steer -1..1, throttle 0..1, brake 0..1, nitro, shiftUp, shiftDown }
   (see race.js: LocalController / AIController; a RemoteController
   for online play would produce the same struct from the network).
   ============================================================ */
(function (SR) {
  const I = (SR.Input = { down: {}, pressed: {}, anyKey: false, lastDevice: 'keys' });
  const queue = [];
  let padPrev = [];

  const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab', 'Backspace']);
  I.init = function () {
    addEventListener('keydown', (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      I.down[e.code] = true;
      queue.push(e.code);
      I.anyKey = true;
      I.lastDevice = 'keys';
    });
    addEventListener('keyup', (e) => { I.down[e.code] = false; });
    addEventListener('blur', () => { I.down = {}; });
    addEventListener('mousedown', () => { I.anyKey = true; queue.push('Mouse'); });
    addEventListener('touchstart', () => { I.anyKey = true; queue.push('Mouse'); }, { passive: true });
  };

  function pads() {
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    const out = [];
    for (const p of list) if (p && p.connected) out.push(p);
    return out;
  }
  const btn = (p, i) => !!(p && p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.5));
  const val = (p, i) => (p && p.buttons[i] ? p.buttons[i].value : 0);

  /** once per frame: move queued key presses into `pressed`, detect gamepad edges */
  I.update = function () {
    I.pressed = {};
    while (queue.length) I.pressed[queue.shift()] = true;
    const ps = pads();
    ps.forEach((p, k) => {
      const prev = padPrev[k] || [];
      const now = p.buttons.map((b, i) => btn(p, i));
      // stick as d-pad for menus
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      now[100] = ay < -0.6; now[101] = ay > 0.6; now[102] = ax < -0.6; now[103] = ax > 0.6;
      now.forEach((v, i) => { if (v && !prev[i]) { I.pressed['Pad' + k + '_' + i] = true; I.anyKey = true; I.lastDevice = 'pad'; } });
      padPrev[k] = now;
    });
  };
  const P = (codes) => codes.some((c) => I.pressed[c]);
  const anyPad = (b) => Object.keys(I.pressed).some((k) => k.startsWith('Pad') && k.endsWith('_' + b));

  /** menu navigation edges (keyboard + any gamepad) */
  I.menu = function () {
    return {
      up: P(['ArrowUp', 'KeyW']) || anyPad(12) || anyPad(100),
      down: P(['ArrowDown', 'KeyS']) || anyPad(13) || anyPad(101),
      left: P(['ArrowLeft', 'KeyA']) || anyPad(14) || anyPad(102),
      right: P(['ArrowRight', 'KeyD']) || anyPad(15) || anyPad(103),
      ok: P(['Enter', 'Space', 'KeyZ', 'NumpadEnter', 'Mouse']) || anyPad(0) || anyPad(9),
      back: P(['Escape', 'Backspace', 'KeyX']) || anyPad(1),
    };
  };
  I.pausePressed = () => P(['Escape', 'KeyP']) || anyPad(9);
  I.key = (code) => !!I.pressed[code];

  /** continuous riding controls for local player `slot` (0 = keyboard + pad 0) */
  I.controls = function (slot) {
    const d = I.down, p = pads()[slot || 0];
    let steer = 0, thr = 0, brk = 0;
    if (d.ArrowLeft || d.KeyA) steer -= 1;
    if (d.ArrowRight || d.KeyD) steer += 1;
    if (d.ArrowUp || d.KeyW) thr = 1;
    if (d.ArrowDown || d.KeyS) brk = 1;
    let nitro = !!(d.Space || d.ShiftLeft || d.ShiftRight);
    let up = P(['KeyE']), dn = P(['KeyQ']);
    if (p) {
      const ax = p.axes[0] || 0;
      if (Math.abs(ax) > 0.15) steer = Math.sign(ax) * Math.min(1, (Math.abs(ax) - 0.15) / 0.75);
      if (btn(p, 14)) steer = -1;
      if (btn(p, 15)) steer = 1;
      thr = Math.max(thr, btn(p, 0) ? 1 : 0, val(p, 7));
      brk = Math.max(brk, btn(p, 1) ? 1 : 0, val(p, 6));
      nitro = nitro || btn(p, 2);
      up = up || !!I.pressed['Pad' + (slot || 0) + '_5'];
      dn = dn || !!I.pressed['Pad' + (slot || 0) + '_4'];
    }
    return { steer, throttle: thr, brake: brk, nitro, shiftUp: up, shiftDown: dn };
  };
  I.cameraPressed = () => P(['KeyC']) || anyPad(3);
})(window.SR);
