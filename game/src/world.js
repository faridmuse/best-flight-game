// The world of Aurel Valley: terrain height, the river, the runways, the
// ring course and the clouds. Everything is a pure function of (x, z, seed),
// so the same mission always builds the same valley and the autopilot can
// prove every ring is reachable.

import { clamp, hashNoise, lerp, mulberry32, smoothstep } from './random.js';
import { FLIGHT } from './config.js';

export const VALLEY_HALF = 520; // half-width of the flyable valley floor
export const WORLD_END_Z = 6400; // the course ends near here

/** Winding centre line of the river, in world x, at forward distance z. */
export function riverX(z, seed) {
  return (
    150 * Math.sin(z * 0.00045 + seed * 0.13) +
    70 * Math.sin(z * 0.0011 + seed * 0.71)
  );
}

/** Height of the ridge the pass climbs, in metres, at forward distance z. */
function ridgeHeight(z, mission) {
  const passZ = 3400 + mission.seed * 12;
  const d = (z - passZ) / 900;
  return 235 * Math.exp(-d * d) * (mission.id === 2 ? 1.25 : 0.8);
}

/** The pass gap: how much the ridge dips near the course line at z. */
function passGap(x, z, mission) {
  const passZ = 3400 + mission.seed * 12;
  const gapX = courseX(passZ, mission);
  const dz = (z - passZ) / 700;
  const dx = (x - gapX) / 170;
  return Math.exp(-(dz * dz + dx * dx));
}

/** The course line: where the rings wander, in world x, at forward distance z. */
export function courseX(z, mission) {
  const s = mission.seed;
  return (
    190 * Math.sin(z * 0.00042 + s * 0.31) +
    90 * Math.sin(z * 0.00105 + s * 0.97)
  );
}

/** The course line's height, in metres, at forward distance z. */
export function courseY(z, mission) {
  const s = mission.seed;
  let y = 105 + 55 * Math.sin(z * 0.0006 + s * 0.53) + 25 * Math.sin(z * 0.0016 + s * 1.7);
  // Missions 2 climbs over the pass; mission 3 descends to the runway.
  const passZ = 3400 + mission.seed * 12;
  const climb = smoothstep(passZ - 1200, passZ, z) * (1 - smoothstep(passZ, passZ + 1200, z));
  y += climb * 110;
  if (mission.id === 3) y -= smoothstep(4800, 6000, z) * 55;
  return clamp(y, 55, 260);
}

/**
 * Terrain height in metres at (x, z). Rolling valley floor, steep walls at
 * the valley sides, and one ridge with a flyable gap over the pass.
 */
export function terrainHeight(x, z, mission) {
  const s = mission.seed;
  // Rolling hills on the valley floor.
  let h =
    7 * Math.sin(x * 0.011 + s) * Math.sin(z * 0.009 + s * 2.1) +
    4 * Math.sin(x * 0.031 + z * 0.017 + s * 0.7) +
    3 * hashNoise(Math.floor(x / 55), Math.floor(z / 55), s);
  // Valley walls rise steeply past the flyable width.
  const side = Math.abs(x) - VALLEY_HALF;
  if (side > 0) h += side * side * 0.0009 + side * 0.22;
  // The ridge, with its gap over the course line.
  const ridge = ridgeHeight(z, mission);
  h += ridge * (1 - 0.92 * passGap(x, z, mission));
  // The river carves a shallow channel.
  const rd = Math.abs(x - riverX(z, s));
  if (rd < 26) h -= (1 - rd / 26) * 3.5;
  // Flatten the ground under both runways.
  h = lerp(h, 0, runwayFlatten(x, z, mission));
  return Math.max(h, -4);
}

/** 0..1: how flat the terrain is forced near a runway strip. */
export function runwayFlatten(x, z, mission) {
  let f = 0;
  for (const r of runways(mission)) {
    const dx = Math.abs(x - r.x) / 110;
    const dz = Math.abs(z - r.z) / 480;
    if (dx < 1 && dz < 1) f = Math.max(f, (1 - dx) * (1 - dz));
  }
  return smoothstep(0, 1, f);
}

/** The two runway strips: home field at the start, Tarn Field at the end. */
export function runways(mission) {
  return [
    { x: -60, z: 130, len: 260, heading: 0, name: 'Aurel Field' },
    { x: courseX(6000, mission), z: 6130, len: 300, heading: 0, name: 'Tarn Field' },
  ];
}

/**
 * Build the ring course for a mission: rings follow the course line, every
 * fourth ring is a green fuel ring, and the last ring sits on final for the
 * runway when the mission asks for a landing.
 */
export function buildCourse(mission) {
  const rng = mulberry32(mission.seed * 1000 + 7);
  const rings = [];
  const n = mission.rings;
  for (let i = 0; i < n; i++) {
    // The first ring sits further out so the takeoff has room to line up,
    // and the early rings fly low, rising to the course height as the sortie
    // settles in — a pilot should learn the sky before it climbs.
    const z = 650 + i * ((5800 - 650) / Math.max(1, n - 1));
    const x = courseX(z, mission) + (rng() - 0.5) * 70;
    const ease = smoothstep(0, 0.45, i / Math.max(1, n - 1));
    const y = lerp(82, courseY(z, mission), ease) + (rng() - 0.5) * 30;
    rings.push({
      index: i,
      x,
      y: clamp(y, 50, 265),
      z,
      r: FLIGHT.ringRadius,
      fuel: i > 0 && i % 4 === 3,
      passed: false,
      missed: false,
    });
  }
  return rings;
}

/** A ring counts as passed when the aircraft crosses its plane inside it. */
export function ringCrossing(ring, prev, next) {
  if (prev.z >= ring.z || next.z < ring.z) return null;
  const t = (ring.z - prev.z) / Math.max(0.0001, next.z - prev.z);
  const x = lerp(prev.x, next.x, t);
  const y = lerp(prev.y, next.y, t);
  const dx = x - ring.x;
  const dy = y - ring.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  return { dist, inside: dist <= ring.r * 0.98, center: dist <= ring.r / 3 };
}

/** True when the aircraft is below the terrain (plus a small margin). */
export function hitsTerrain(pos, mission, margin = 1.5) {
  return pos.y <= terrainHeight(pos.x, pos.z, mission) + margin;
}

/**
 * Landing check: over the destination runway, low, slow and descending
 * gently. Returns 'landed' | 'hard' | null.
 */
export function landingCheck(pos, velY, speed, mission) {
  const r = runways(mission)[1];
  if (Math.abs(pos.x - r.x) > 20) return null;
  if (Math.abs(pos.z - r.z) > r.len / 2) return null;
  if (pos.y > 4) return null;
  if (speed > 105) return null;
  return velY < -9 ? 'hard' : 'landed';
}

/** Cloud puffs: fixed positions per mission, drifting slowly with the wind. */
export function buildClouds(mission) {
  const rng = mulberry32(mission.seed * 77 + 3);
  const clouds = [];
  for (let i = 0; i < 26; i++) {
    clouds.push({
      x: (rng() - 0.5) * 2600,
      y: 260 + rng() * 260,
      z: 300 + rng() * 6200,
      s: 60 + rng() * 130,
      puffs: 3 + Math.floor(rng() * 3),
      seed: rng() * 100,
    });
  }
  return clouds;
}

/** A few hot-air balloons drifting over the valley, for depth and scale. */
export function buildBalloons(mission) {
  const rng = mulberry32(mission.seed * 31 + 5);
  const balloons = [];
  const hues = ['#d85a4a', '#e8a13c', '#4a7fd8', '#7fb069'];
  for (let i = 0; i < 5; i++) {
    balloons.push({
      x: (rng() - 0.5) * 900,
      y: 130 + rng() * 90,
      z: 900 + i * 1100 + rng() * 300,
      color: hues[i % hues.length],
    });
  }
  return balloons;
}
