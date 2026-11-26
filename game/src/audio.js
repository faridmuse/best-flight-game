// Sound, synthesised live with WebAudio — no audio files, no network. An
// engine drone that follows the throttle, wind that follows the speed, a
// chime for a ring, a low warning for a stall, and a thud for the ground.
// Everything is created on the first user gesture, so the page stays silent
// until the pilot touches a control.

export function createAudio() {
  const audio = {
    ctx: null,
    muted: false,
    engine: null,
    engineGain: null,
    wind: null,
    windGain: null,
    started: false,
  };

  function ensure() {
    if (audio.ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      const ctx = new AC();
      audio.ctx = ctx;
      // Engine: two detuned saws through a low-pass, pitched by throttle.
      const osc1 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc1.frequency.value = 62;
      const osc2 = ctx.createOscillator();
      osc2.type = 'sawtooth';
      osc2.frequency.value = 93;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc1.start();
      osc2.start();
      // Wind: looped noise through a band-pass, loud with speed.
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      noise.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 700;
      bp.Q.value = 0.6;
      const wgain = ctx.createGain();
      wgain.gain.value = 0;
      noise.connect(bp);
      bp.connect(wgain);
      wgain.connect(ctx.destination);
      noise.start();
      audio.engine = { osc1, osc2, filter };
      audio.engineGain = gain;
      audio.windGain = wgain;
      audio.started = true;
      return true;
    } catch {
      return false;
    }
  }

  /** Start the audio graph (call from a gesture) and resume if suspended. */
  audio.unlock = function unlock() {
    if (!ensure()) return;
    if (audio.ctx.state === 'suspended') audio.ctx.resume();
  };

  /** Per-frame: engine pitch from throttle, wind from speed. */
  audio.update = function update(throttle, speed, flying) {
    if (!audio.ctx || audio.muted) return;
    const t = audio.ctx.currentTime;
    const target = flying ? 0.05 + throttle * 0.06 : 0;
    audio.engineGain.gain.setTargetAtTime(target, t, 0.15);
    audio.engine.osc1.frequency.setTargetAtTime(58 + throttle * 55, t, 0.1);
    audio.engine.osc2.frequency.setTargetAtTime(87 + throttle * 82, t, 0.1);
    audio.engine.filter.frequency.setTargetAtTime(320 + throttle * 700, t, 0.2);
    const wind = flying ? Math.min(0.12, (speed / 165) * 0.12) : 0;
    audio.windGain.gain.setTargetAtTime(wind, t, 0.2);
  };

  function blip(freq, dur, type, vol, when = 0) {
    if (!audio.ctx || audio.muted) return;
    const t = audio.ctx.currentTime + when;
    const o = audio.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = audio.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(audio.ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Two-note chime when a ring is threaded. */
  audio.ring = function ring(center) {
    blip(880, 0.35, 'sine', 0.16);
    blip(1318, 0.5, 'sine', 0.14, 0.09);
    if (center) blip(1760, 0.4, 'sine', 0.1, 0.18);
  };

  /** Soft thunk for a fuel ring. */
  audio.fuel = function fuel() {
    blip(523, 0.2, 'triangle', 0.14);
    blip(784, 0.3, 'triangle', 0.12, 0.08);
  };

  /** Dull buzz when a ring is missed. */
  audio.miss = function miss() {
    blip(220, 0.4, 'square', 0.05);
  };

  /** Low warning beep for a stall. */
  audio.stall = function stall() {
    blip(196, 0.25, 'square', 0.07);
  };

  /** Noise burst and low thud for a crash. */
  audio.crash = function crash() {
    if (!audio.ctx || audio.muted) return;
    const ctx = audio.ctx;
    const len = ctx.sampleRate * 0.7;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    src.connect(g);
    g.connect(ctx.destination);
    src.start();
    blip(55, 0.6, 'sine', 0.3);
  };

  /** Little landing jingle. */
  audio.landed = function landed() {
    blip(523, 0.25, 'sine', 0.15);
    blip(659, 0.25, 'sine', 0.15, 0.12);
    blip(784, 0.5, 'sine', 0.15, 0.24);
  };

  /** UI click. */
  audio.click = function click() {
    blip(660, 0.08, 'sine', 0.08);
  };

  audio.toggleMute = function toggleMute() {
    audio.muted = !audio.muted;
    if (audio.ctx) {
      const t = audio.ctx.currentTime;
      audio.engineGain.gain.setTargetAtTime(audio.muted ? 0 : 0.05, t, 0.05);
      audio.windGain.gain.setTargetAtTime(0, t, 0.05);
    }
    return audio.muted;
  };

  return audio;
}
