'use strict';
/* ============================================================
   Bitmap font (5x7) and 2D pixel-UI helpers for the HUD canvas
   ============================================================ */
(function (SR) {
  const G = {
    'A': '.###. #...# #...# ##### #...# #...# #...#',
    'B': '####. #...# #...# ####. #...# #...# ####.',
    'C': '.###. #...# #.... #.... #.... #...# .###.',
    'D': '####. #...# #...# #...# #...# #...# ####.',
    'E': '##### #.... #.... ####. #.... #.... #####',
    'F': '##### #.... #.... ####. #.... #.... #....',
    'G': '.###. #...# #.... #.### #...# #...# .####',
    'H': '#...# #...# #...# ##### #...# #...# #...#',
    'I': '.###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.',
    'J': '..### ...#. ...#. ...#. ...#. #..#. .##..',
    'K': '#...# #..#. #.#.. ##... #.#.. #..#. #...#',
    'L': '#.... #.... #.... #.... #.... #.... #####',
    'M': '#...# ##.## #.#.# #.#.# #...# #...# #...#',
    'N': '#...# #...# ##..# #.#.# #..## #...# #...#',
    'O': '.###. #...# #...# #...# #...# #...# .###.',
    'P': '####. #...# #...# ####. #.... #.... #....',
    'Q': '.###. #...# #...# #...# #.#.# #..#. .##.#',
    'R': '####. #...# #...# ####. #.#.. #..#. #...#',
    'S': '.#### #.... #.... .###. ....# ....# ####.',
    'T': '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
    'U': '#...# #...# #...# #...# #...# #...# .###.',
    'V': '#...# #...# #...# #...# #...# .#.#. ..#..',
    'W': '#...# #...# #...# #.#.# #.#.# #.#.# .#.#.',
    'X': '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
    'Y': '#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..',
    'Z': '##### ....# ...#. ..#.. .#... #.... #####',
    '0': '.###. #...# #..## #.#.# ##..# #...# .###.',
    '1': '..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.',
    '2': '.###. #...# ....# ...#. ..#.. .#... #####',
    '3': '####. ....# ....# .###. ....# ....# ####.',
    '4': '...#. ..##. .#.#. #..#. ##### ...#. ...#.',
    '5': '##### #.... ####. ....# ....# #...# .###.',
    '6': '.###. #.... #.... ####. #...# #...# .###.',
    '7': '##### ....# ...#. ..#.. .#... .#... .#...',
    '8': '.###. #...# #...# .###. #...# #...# .###.',
    '9': '.###. #...# #...# .#### ....# ....# .###.',
    ' ': '..... ..... ..... ..... ..... ..... .....',
    '.': '..... ..... ..... ..... ..... .##.. .##..',
    ',': '..... ..... ..... ..... .##.. ..#.. .#...',
    ':': '..... .##.. .##.. ..... .##.. .##.. .....',
    ';': '..... .##.. .##.. ..... .##.. ..#.. .#...',
    '!': '..#.. ..#.. ..#.. ..#.. ..#.. ..... ..#..',
    '?': '.###. #...# ....# ...#. ..#.. ..... ..#..',
    "'": '..#.. ..#.. .#... ..... ..... ..... .....',
    '"': '.#.#. .#.#. ..... ..... ..... ..... .....',
    '-': '..... ..... ..... .###. ..... ..... .....',
    '+': '..... ..#.. ..#.. ##### ..#.. ..#.. .....',
    '/': '....# ....# ...#. ..#.. .#... #.... #....',
    '(': '...#. ..#.. .#... .#... .#... ..#.. ...#.',
    ')': '.#... ..#.. ...#. ...#. ...#. ..#.. .#...',
    '$': '..#.. .#### #.#.. .###. ..#.# ####. ..#..',
    '%': '##..# ##..# ...#. ..#.. .#... #..## #..##',
    '#': '.#.#. .#.#. ##### .#.#. ##### .#.#. .#.#.',
    '*': '..... #.#.# .###. ##### .###. #.#.# .....',
    '<': '...#. ..#.. .#... #.... .#... ..#.. ...#.',
    '>': '.#... ..#.. ...#. ....# ...#. ..#.. .#...',
    '=': '..... ..... ##### ..... ##### ..... .....',
    '_': '..... ..... ..... ..... ..... ..... #####',
    '&': '.##.. #..#. #.#.. .#... #.#.# #..#. .##.#',
    '@': '.###. #...# #.### #.#.# #.### #.... .####',
    '[': '.###. .#... .#... .#... .#... .#... .###.',
    ']': '.###. ...#. ...#. ...#. ...#. ...#. .###.',
    '|': '..#.. ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
    '↑': '..#.. .###. #.#.# ..#.. ..#.. ..#.. ..#..',
    '↓': '..#.. ..#.. ..#.. ..#.. #.#.# .###. ..#..',
    '←': '..... ..#.. .#... ##### .#... ..#.. .....',
    '→': '..... ..#.. ...#. ##### ...#. ..#.. .....',
    '►': '#.... ##... ###.. ####. ###.. ##... #....',
    '◄': '....# ...## ..### .#### ..### ...## ....#',
    '★': '..#.. ..#.. ##### .###. .#.#. #...# .....',
    '°': '.##.. #..#. .##.. ..... ..... ..... .....',
    '×': '..... #...# .#.#. ..#.. .#.#. #...# .....',
    '■': '..... ##### ##### ##### ##### ##### .....',
    '♪': '..##. ..#.# ..#.. ..#.. ###.. ###.. .....',
  };
  const CW = 5, CH = 7, ADV = 6;
  const keys = Object.keys(G);
  const index = {};
  const bits = {};
  keys.forEach((k, i) => {
    index[k] = i;
    bits[k] = G[k].split(' ').map((row) => row.split('').map((c) => c === '#'));
  });

  const atlases = new Map();
  function atlas(color) {
    let a = atlases.get(color);
    if (a) return a;
    a = document.createElement('canvas');
    a.width = keys.length * CW;
    a.height = CH;
    const g = a.getContext('2d');
    g.fillStyle = color;
    keys.forEach((k, i) => {
      const b = bits[k];
      for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) if (b[y][x]) g.fillRect(i * CW + x, y, 1, 1);
    });
    atlases.set(color, a);
    return a;
  }

  const Font = (SR.Font = {
    CW, CH, ADV,
    glyph: (ch) => bits[ch] || bits[String(ch).toUpperCase()] || bits['?'],
    width: (str, scale) => Math.max(0, String(str).length * ADV * (scale || 1) - (scale || 1)),
    /** draw text; align: 'left' | 'center' | 'right'; shadow: css color or null */
    draw(ctx, str, x, y, color, scale, align, shadow) {
      str = String(str).toUpperCase();
      scale = scale || 1;
      color = color || '#fff';
      const w = Font.width(str, scale);
      if (align === 'center') x -= Math.floor(w / 2);
      else if (align === 'right') x -= w;
      x = Math.round(x);
      y = Math.round(y);
      if (shadow) drawRaw(ctx, str, x + scale, y + scale, shadow, scale);
      drawRaw(ctx, str, x, y, color, scale);
      return w;
    },
    /** outlined text (1px per scale outline) */
    outline(ctx, str, x, y, color, scale, align, oc) {
      str = String(str).toUpperCase();
      scale = scale || 1;
      const w = Font.width(str, scale);
      if (align === 'center') x -= Math.floor(w / 2);
      else if (align === 'right') x -= w;
      x = Math.round(x);
      y = Math.round(y);
      oc = oc || '#000';
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) if (dx || dy) drawRaw(ctx, str, x + dx * scale, y + dy * scale, oc, scale);
      drawRaw(ctx, str, x, y, color || '#fff', scale);
      return w;
    },
    /** big text with a per-row color function colorAt(row 0..6) — used for logos */
    gradient(ctx, str, x, y, scale, colorAt, align, oc, depth) {
      str = String(str).toUpperCase();
      const w = Font.width(str, scale);
      if (align === 'center') x -= Math.floor(w / 2);
      x = Math.round(x);
      y = Math.round(y);
      depth = depth || 0;
      const plot = (fill, ox, oy, grow) => {
        for (let i = 0; i < str.length; i++) {
          const b = Font.glyph(str[i]);
          for (let r = 0; r < CH; r++) {
            if (fill) ctx.fillStyle = typeof fill === 'function' ? fill(r) : fill;
            for (let c = 0; c < CW; c++)
              if (b[r][c]) ctx.fillRect(x + (i * ADV + c) * scale + ox - grow, y + r * scale + oy - grow, scale + grow * 2, scale + grow * 2);
          }
        }
      };
      for (let d = depth; d > 0; d--) plot(oc || '#000', d, d, 1);
      plot(oc || '#000', 0, 0, 1);
      plot(colorAt, 0, 0, 0);
      return w;
    },
  });

  function drawRaw(ctx, str, x, y, color, scale) {
    const a = atlas(color);
    for (let i = 0; i < str.length; i++) {
      const idx = index[str[i]];
      if (idx === undefined || str[i] === ' ') continue;
      ctx.drawImage(a, idx * CW, 0, CW, CH, x + i * ADV * scale, y, CW * scale, CH * scale);
    }
  }

  /* ---------- 2D pixel UI helpers ---------- */
  const UI2 = (SR.UI2 = {});
  // SNES-style window: gradient fill + double border
  UI2.panel = (ctx, x, y, w, h, style) => {
    style = style || {};
    const top = style.top || '#2a1a5e', bot = style.bot || '#0d0826', border = style.border || '#e8e0ff', accent = style.accent || '#ff3c9e';
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    ctx.fillStyle = '#000';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    // banded vertical gradient (retro: stepped, not smooth)
    const steps = 6;
    const ct = SR.M.rgb(top), cb = SR.M.rgb(bot);
    for (let i = 0; i < steps; i++) {
      ctx.fillStyle = SR.M.css(SR.M.mix(ct, cb, i / (steps - 1)));
      const y0 = y + Math.floor((h * i) / steps), y1 = y + Math.floor((h * (i + 1)) / steps);
      ctx.fillRect(x, y0, w, y1 - y0);
    }
    ctx.fillStyle = border;
    ctx.fillRect(x + 1, y + 1, w - 2, 1);
    ctx.fillRect(x + 1, y + h - 2, w - 2, 1);
    ctx.fillRect(x + 1, y + 1, 1, h - 2);
    ctx.fillRect(x + w - 2, y + 1, 1, h - 2);
    if (style.title) {
      const tw = Font.width(style.title) + 8;
      ctx.fillStyle = accent;
      ctx.fillRect(x + 6, y - 4, tw, 9);
      ctx.fillStyle = '#000';
      ctx.fillRect(x + 6, y + 5, tw, 1);
      Font.draw(ctx, style.title, x + 10, y - 3, '#fff');
    }
  };
  UI2.bar = (ctx, x, y, w, h, t, color, back) => {
    ctx.fillStyle = back || '#000';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x + 1, y + 1, Math.round((w - 2) * SR.M.clamp(t, 0, 1)), h - 2);
  };
  // segmented stat bar (like old spec sheets)
  UI2.segs = (ctx, x, y, n, filled, color, extra, extraColor) => {
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = '#000';
      ctx.fillRect(x + i * 5, y, 4, 6);
      ctx.fillStyle = i < filled ? color : i < filled + (extra || 0) ? extraColor || '#fff' : '#2c2446';
      ctx.fillRect(x + i * 5, y, 3, 5);
    }
  };
})(window.SR);
