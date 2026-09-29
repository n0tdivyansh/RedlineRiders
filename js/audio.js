'use strict';
/* ============================================================
   Audio: synthesized bike engines, sound effects and a small
   chiptune sequencer (square lead, pulse arps, triangle bass,
   noise drums). Everything is generated with Web Audio.
   ============================================================ */
(function (SR) {
  const A = (SR.Audio = { ready: false, musicVol: 0.55, sfxVol: 0.8 });
  let ctx = null, master, musicBus, sfxBus, noiseBuf, pulse25, pulse12;

  A.init = function () {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    master.connect(comp); comp.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.connect(master);
    A.setVolumes(A.musicVol, A.sfxVol);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const pw = (duty) => {
      const n = 32, re = new Float32Array(n), im = new Float32Array(n);
      for (let k = 1; k < n; k++) im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
      return ctx.createPeriodicWave(re, im);
    };
    pulse25 = pw(0.25); pulse12 = pw(0.125);
    A.ready = true;
    setInterval(tick, 25);
  };
  A.setVolumes = function (m, s) {
    A.musicVol = m; A.sfxVol = s;
    if (!ctx) return;
    musicBus.gain.value = m * 0.5;
    sfxBus.gain.value = s;
  };
  A.now = () => (ctx ? ctx.currentTime : 0);

  /* ---------- one-shot effects ---------- */
  function env(g, t, a, peak, dec, sus) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sus || 0.0001), t + a + dec);
  }
  function tone(type, f0, f1, dur, vol, when, bus) {
    if (!ctx) return;
    const t = (when || ctx.currentTime) + 0.005;
    const o = ctx.createOscillator(), g = ctx.createGain();
    if (type === 'p25') o.setPeriodicWave(pulse25); else if (type === 'p12') o.setPeriodicWave(pulse12); else o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    env(g, t, 0.005, vol, dur);
    o.connect(g); g.connect(bus || sfxBus);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, vol, fType, f0, f1, when, q, bus) {
    if (!ctx) return;
    const t = (when || ctx.currentTime) + 0.005;
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf;
    f.type = fType; f.Q.value = q || 1;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    env(g, t, 0.004, vol, dur);
    s.connect(f); f.connect(g); g.connect(bus || sfxBus);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  A.sfx = function (name) {
    if (!ctx) return;
    const t = ctx.currentTime;
    switch (name) {
      case 'move': tone('p25', 880, 880, 0.05, 0.12); break;
      case 'select': tone('p25', 660, 660, 0.06, 0.14); tone('p25', 1320, 1320, 0.09, 0.12, t + 0.06); break;
      case 'back': tone('p25', 520, 330, 0.1, 0.12); break;
      case 'error': tone('square', 140, 110, 0.2, 0.14); break;
      case 'buy': [784, 988, 1175, 1568].forEach((f, i) => tone('p25', f, f, 0.08, 0.12, t + i * 0.06)); break;
      case 'beep': tone('square', 440, 440, 0.25, 0.18); break;
      case 'go': tone('square', 880, 880, 0.55, 0.2); tone('p25', 1760, 1760, 0.4, 0.08); break;
      case 'lap': [523, 659, 784, 1047].forEach((f, i) => tone('p25', f, f, 0.1, 0.13, t + i * 0.07)); break;
      case 'final': [784, 784, 1047, 1319].forEach((f, i) => tone('p25', f, f, 0.12, 0.14, t + i * 0.1)); break;
      case 'nitro': noise(0.9, 0.35, 'bandpass', 600, 3000, t, 2); tone('sawtooth', 120, 420, 0.8, 0.08); break;
      case 'crash': noise(0.7, 0.6, 'lowpass', 2400, 200, t, 1); tone('square', 90, 40, 0.4, 0.2); noise(0.25, 0.3, 'highpass', 4000, 6000, t + 0.05, 1); break;
      case 'bump': noise(0.15, 0.35, 'lowpass', 900, 200, t, 1); break;
      case 'scrape': noise(0.4, 0.25, 'bandpass', 2600, 1800, t, 3); break;
      case 'shift': noise(0.04, 0.12, 'highpass', 3000, 3000, t, 1); break;
      case 'win': [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone('p25', f, f, i === 6 ? 0.5 : 0.12, 0.14, t + i * 0.11)); break;
      case 'lose': [392, 370, 349, 262].forEach((f, i) => tone('triangle', f, f, 0.22, 0.18, t + i * 0.2)); break;
      case 'coin': tone('p25', 988, 988, 0.06, 0.12); tone('p25', 1319, 1319, 0.18, 0.12, t + 0.06); break;
    }
  };

  /* ---------- engines ----------
     A bike engine = pulse at the firing frequency + saw an octave down + noise rasp,
     through a lowpass that opens with throttle. One per local rider, plus one "pass-by"
     engine for the closest rival. */
  A.engine = function () {
    if (!ctx) return null;
    const out = ctx.createGain();
    out.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 2;
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), g1 = ctx.createGain(), g2 = ctx.createGain();
    o1.setPeriodicWave(pulse25); o2.type = 'sawtooth';
    g1.gain.value = 0.35; g2.gain.value = 0.3;
    const ns = ctx.createBufferSource(), nf = ctx.createBiquadFilter(), ng = ctx.createGain();
    ns.buffer = noiseBuf; ns.loop = true; nf.type = 'bandpass'; nf.Q.value = 3; ng.gain.value = 0.08;
    o1.connect(g1); o2.connect(g2); g1.connect(lp); g2.connect(lp);
    ns.connect(nf); nf.connect(ng); ng.connect(lp);
    lp.connect(out); out.connect(sfxBus);
    o1.start(); o2.start(); ns.start();
    const e = {
      set(freq, throttle, vol) {
        const t = ctx.currentTime;
        o1.frequency.setTargetAtTime(freq, t, 0.03);
        o2.frequency.setTargetAtTime(freq * 0.5, t, 0.03);
        nf.frequency.setTargetAtTime(freq * 3, t, 0.05);
        lp.frequency.setTargetAtTime(500 + freq * (2 + throttle * 5), t, 0.05);
        out.gain.setTargetAtTime(vol * (0.35 + throttle * 0.4), t, 0.05);
      },
      stop() {
        const t = ctx.currentTime;
        out.gain.setTargetAtTime(0, t, 0.05);
        setTimeout(() => { try { o1.stop(); o2.stop(); ns.stop(); out.disconnect(); } catch (err) { /* ignore */ } }, 400);
      },
    };
    return e;
  };
  // looping tyre skid
  A.skid = function () {
    if (!ctx) return null;
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; s.loop = true; f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 6; g.gain.value = 0;
    s.connect(f); f.connect(g); g.connect(sfxBus); s.start();
    return {
      set(v) { g.gain.setTargetAtTime(v * 0.25, ctx.currentTime, 0.05); },
      stop() { g.gain.setTargetAtTime(0, ctx.currentTime, 0.05); setTimeout(() => { try { s.stop(); g.disconnect(); } catch (e) { /* ignore */ } }, 300); },
    };
  };
  // wind / rain ambience
  A.ambience = function (kind) {
    if (!ctx) return null;
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; s.loop = true;
    f.type = kind === 'rain' ? 'highpass' : 'lowpass';
    f.frequency.value = kind === 'rain' ? 2500 : 500;
    g.gain.value = 0;
    s.connect(f); f.connect(g); g.connect(sfxBus); s.start();
    return {
      set(v) { g.gain.setTargetAtTime(v, ctx.currentTime, 0.2); },
      stop() { g.gain.setTargetAtTime(0, ctx.currentTime, 0.1); setTimeout(() => { try { s.stop(); g.disconnect(); } catch (e) { /* ignore */ } }, 400); },
    };
  };

  /* ============================================================
     Music sequencer
     Song: bpm, chords (one per bar), lead (16 tokens per bar: note, '-' hold, '.' rest),
     bass pattern tokens (R root low, r root high, 5 fifth, . rest), drums (k s h .)
     ============================================================ */
  const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const midi = (n) => {
    const m = /^([A-G])([#b]?)(\d)$/.exec(n);
    if (!m) return null;
    return 12 * (+m[3] + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  };
  const freq = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const chordNotes = (name) => {
    const m = /^([A-G][#b]?)(m?)$/.exec(name);
    const root = midi(m[1] + '2');
    return [root, root + (m[2] ? 3 : 4), root + 7];
  };

  const SONGS = {
    title: {
      bpm: 128, chords: ['C', 'G', 'Am', 'F', 'C', 'G', 'Am', 'G'],
      lead: [
        'E5 - - . D5 . C5 . G5 - - - E5 . . .',
        'D5 - - . C5 . B4 . D5 - - - G4 . . .',
        'C5 - - . B4 . A4 . E5 - - - C5 . . .',
        'A4 - - . C5 . F5 . E5 - D5 - C5 - . .',
        'E5 - - . D5 . C5 . G5 - - - A5 . G5 .',
        'F5 - E5 . D5 . B4 . D5 - - - G5 . . .',
        'E5 - - . C5 . A4 . C5 . E5 . A5 - - .',
        'G5 - - - F5 - - - E5 - - - D5 - - -',
      ],
      bass: 'R . . R . . R . R . . R . . R .', drums: 'k . h . s . h . k . h k s . h .', arp: true,
    },
    race1: {
      bpm: 158, chords: ['Am', 'F', 'G', 'Em', 'Am', 'F', 'G', 'E'],
      lead: [
        'A4 . C5 . E5 . A5 . G5 . E5 . C5 . D5 .',
        'C5 . A4 . F4 . A4 . C5 . F5 . E5 . C5 .',
        'B4 . D5 . G5 . B5 . A5 . G5 . D5 . B4 .',
        'E5 - - - G5 - - - B5 - A5 - G5 - E5 -',
        'A5 - - . G5 . E5 . A5 - - . G5 . E5 .',
        'F5 . E5 . C5 . A4 . C5 . E5 . F5 . A5 .',
        'G5 - - . F5 . D5 . G5 - - . B5 . A5 .',
        'G#5 - - - E5 - - - B4 - - - G#4 - B4 -',
      ],
      bass: 'R . r . R . r . R . r . R . r .', drums: 'k . h . s . h . k . h . s . h h', arp: true,
    },
    race2: {
      bpm: 150, chords: ['Em', 'D', 'C', 'D', 'Em', 'D', 'C', 'B'],
      lead: [
        'E5 . . E5 . . G5 . . E5 . D5 . B4 . .',
        'D5 . . D5 . . F#5 . . D5 . A4 . F#4 . .',
        'C5 . . C5 . . E5 . . G5 . E5 . C5 . .',
        'D5 - - - F#5 - - - A5 - G5 - F#5 - D5 -',
        'B5 - - . A5 . G5 . E5 - - . G5 . A5 .',
        'F#5 - - . E5 . D5 . A4 - - . D5 . F#5 .',
        'G5 - - . E5 . C5 . E5 . G5 . C6 - - .',
        'B5 - - - F#5 - - - D#5 - - - B4 - - -',
      ],
      bass: 'R . R r . R . r R . R r . R r .', drums: 'k . h k s . h . k k h . s . h s', arp: false,
    },
    race3: {
      bpm: 168, chords: ['D', 'Bm', 'G', 'A', 'D', 'Bm', 'G', 'A'],
      lead: [
        'F#5 . A5 . D6 . A5 . F#5 . D5 . F#5 . A5 .',
        'F#5 . D5 . B4 . D5 . F#5 . B5 . A5 . F#5 .',
        'G5 . B5 . D6 . B5 . G5 - - . B5 . D6 .',
        'C#6 - - - A5 - - - E5 - F#5 - G5 - A5 -',
        'D6 - - . C#6 . A5 . F#5 - - . A5 . D6 .',
        'B5 - - . A5 . F#5 . D5 - - . F#5 . B5 .',
        'G5 . A5 . B5 . D6 . B5 . A5 . G5 . E5 .',
        'E5 - - - A5 - - - C#6 - - - E6 - - -',
      ],
      bass: 'R . r . R . r . R . r . R R r .', drums: 'k . h . s . h k k . h . s . h .', arp: true,
    },
    menu: {
      bpm: 108, chords: ['F', 'Dm', 'Bb', 'C'],
      lead: [
        'A4 - - - C5 - - - F5 - - - E5 - C5 -',
        'D5 - - - F5 - - - A5 - - - G5 - F5 -',
        'D5 - - - F5 - - - Bb5 - - - A5 - F5 -',
        'G5 - - - E5 - - - C5 - - - E5 - G5 -',
      ],
      bass: 'R . . . r . . . R . . . r . 5 .', drums: 'k . . . s . . . k . k . s . . h', arp: true,
    },
  };
  A.SONGS = Object.keys(SONGS);

  const seq = { song: null, step: 0, next: 0, on: true, name: null };
  A.music = function (name) {
    if (seq.name === name) return;
    seq.name = name;
    seq.song = name ? SONGS[name] : null;
    seq.step = 0;
    seq.next = ctx ? ctx.currentTime + 0.1 : 0;
    if (seq.song) {
      const s = seq.song;
      s._lead = s.lead.map((bar) => bar.split(/\s+/));
      s._bass = s.bass.split(/\s+/);
      s._drums = s.drums.split(/\s+/);
    }
  };
  A.toggleMusic = function () { seq.on = !seq.on; return seq.on; };

  function voice(type, f, t, dur, vol) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    if (type === 'p25') o.setPeriodicWave(pulse25); else if (type === 'p12') o.setPeriodicWave(pulse12); else o.type = type;
    o.frequency.value = f;
    g.gain.setValueAtTime(vol, t);
    g.gain.setValueAtTime(vol, t + Math.max(0.01, dur - 0.03));
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(musicBus);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function tick() {
    if (!ctx || !seq.song) return;
    const s = seq.song, spb = 60 / s.bpm / 4;
    while (seq.next < ctx.currentTime + 0.12) {
      const t = seq.next, bars = s._lead.length, st = seq.step % (bars * 16);
      const bar = Math.floor(st / 16), k = st % 16;
      if (seq.on) {
        const tok = s._lead[bar][k];
        const m = midi(tok);
        if (m !== null) {
          let len = 1;
          while (k + len < 16 && s._lead[bar][k + len] === '-') len++;
          voice('p25', freq(m), t, len * spb * 0.95, 0.16);
        }
        const ch = chordNotes(s.chords[bar % s.chords.length]);
        const bt = s._bass[k];
        if (bt && bt !== '.') {
          const bm = bt === 'R' ? ch[0] : bt === 'r' ? ch[0] + 12 : ch[0] + 7;
          voice('triangle', freq(bm), t, spb * 0.9, 0.32);
        }
        if (s.arp) voice('p12', freq(ch[k % 3] + 24), t, spb * 0.5, 0.045);
        const dt = s._drums[k];
        if (dt === 'k') { tone('sine', 150, 45, 0.12, 0.5, t, musicBus); }
        else if (dt === 's') { noise(0.12, 0.28, 'bandpass', 1800, 1200, t, 0.8, musicBus); }
        else if (dt === 'h') { noise(0.03, 0.12, 'highpass', 7000, 7000, t, 1, musicBus); }
      }
      seq.step++;
      seq.next += spb;
    }
  }
})(window.SR);
