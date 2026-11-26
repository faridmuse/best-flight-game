// Seeded randomness for Skycourier: every mission's terrain, clouds and ring
// course come from one fixed seed, so the same mission always flies the same
// sky. mulberry32 is small, fast and deterministic across engines.

/** A deterministic PRNG: returns a function yielding [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic 2D value noise in [-1, 1]: same (x, y, seed) always same value. */
export function hashNoise(x, y, seed) {
  let h = (Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453) % 1;
  if (h < 0) h += 1;
  return h * 2 - 1;
}

/** Smooth interpolation helper. */
export function smoothstep(a, b, t) {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
}

/** Clamp a number into [lo, hi]. */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Linear interpolation. */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}
