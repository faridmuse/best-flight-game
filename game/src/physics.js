// The flight model: an arcade bush plane. Bank to turn, pitch to climb and
// dive, throttle to keep the wing flying. It is deliberately forgiving —
// stalls sink instead of spinning — but speed discipline still decides
// whether a ring is threaded or the hillside is met.
//
// All angles in radians internally; the model steps at a fixed dt so a
// replay of the same inputs always flies the same line.

import { clamp, lerp } from './random.js';
import { FLIGHT } from './config.js';
import { courseX, courseY, hitsTerrain, landingCheck, ringCrossing, terrainHeight } from './world.js';

const DEG = Math.PI / 180;

/** Fresh flight state at the start of a mission. */
export function createPlane(mission) {
  const startX = -60;
  return {
    pos: { x: startX, y: 46, z: 60 },
    heading: 0, // 0 = due north (+z)
    pitch: 0,
    roll: 0,
    speed: 110,
    throttle: 0.7,
    fuel: mission.fuel,
    verticalSpeed: 0,
    stalled: false,
    engineOut: false,
    crashed: false,
    crashReason: '',
    landed: false,
    distance: 0,
    time: 0,
  };
}

/**
 * Step the plane one tick. `stick` is { roll, pitch, throttleUp, throttleDown }
 * each in -1..1 (throttle flags boolean). Returns events: rings passed or
 * missed, terrain hits, landings.
 */
export function stepPlane(plane, stick, mission, rings, dt) {
  const events = [];
  if (plane.crashed || plane.landed) return events;
  plane.time += dt;

  // Throttle: Shift spools up, Ctrl spools down; the engine dies on empty fuel.
  if (stick.throttleUp) plane.throttle = clamp(plane.throttle + FLIGHT.throttleRate * dt, 0, 1);
  if (stick.throttleDown) plane.throttle = clamp(plane.throttle - FLIGHT.throttleRate * dt, 0, 1);
  if (plane.fuel <= 0) {
    plane.engineOut = true;
    plane.throttle = 0;
  }
  const drain = FLIGHT.fuelDrain * (0.25 + 0.75 * plane.throttle) * (mission.id === 3 ? 1.25 : 1);
  plane.fuel = Math.max(0, plane.fuel - drain * dt);

  // Speed chases the throttle setting; drag grows with the square of speed.
  const targetSpeed = plane.engineOut ? 0 : plane.throttle * FLIGHT.maxSpeed;
  const accel = plane.engineOut ? -14 : 26;
  plane.speed += clamp(targetSpeed - plane.speed, -accel * dt * 0.6, accel * dt);
  plane.speed = Math.max(0, plane.speed);

  // Stall: below stall speed the wing quits, the nose drops and she sinks.
  plane.stalled = plane.speed < FLIGHT.stallSpeed;
  const controlAuthority = plane.stalled
    ? clamp(plane.speed / FLIGHT.stallSpeed, 0.25, 1)
    : 1;

  // Bank and pitch chase the stick, slower when stalled.
  const targetRoll = stick.roll * FLIGHT.maxRollDeg * DEG * controlAuthority;
  const targetPitch = stick.pitch * FLIGHT.maxPitchDeg * DEG * controlAuthority;
  plane.roll += clamp(targetRoll - plane.roll, -FLIGHT.rollRate * DEG * dt, FLIGHT.rollRate * DEG * dt);
  plane.pitch += clamp(targetPitch - plane.pitch, -FLIGHT.pitchRate * DEG * dt, FLIGHT.pitchRate * DEG * dt);
  if (plane.stalled) plane.pitch = lerp(plane.pitch, -14 * DEG, dt * 0.8);

  // A banked wing turns: a right bank (positive roll) yaws the nose right,
  // towards +x; a left bank yaws it left. The turn tightens with speed.
  const turn = plane.roll * FLIGHT.turnRate * (plane.speed / FLIGHT.maxSpeed);
  plane.heading += turn * dt;
  // Wind gusts push the nose sideways on the pass and at night.
  if (mission.wind > 0) {
    const gust = Math.sin(plane.time * 0.7 + mission.seed) * mission.wind;
    plane.heading += gust * DEG * 0.12 * dt;
  }

  // Move: forward along the heading, up and down with the pitch.
  const prev = { ...plane.pos };
  const forward = plane.speed * Math.cos(plane.pitch) * dt;
  plane.pos.x += Math.sin(plane.heading) * forward;
  plane.pos.z += Math.cos(plane.heading) * forward;
  let vy = plane.speed * Math.sin(plane.pitch);
  if (plane.stalled) vy -= FLIGHT.gravitySink * (1 - plane.speed / FLIGHT.stallSpeed);
  plane.verticalSpeed = vy;
  plane.pos.y += vy * dt;
  plane.distance += forward;

  // Valley walls are a fence, not a crash: nudge the plane back inside.
  if (Math.abs(plane.pos.x) > 640) {
    plane.pos.x = Math.sign(plane.pos.x) * 640;
    plane.heading = lerp(plane.heading, plane.heading > 0 ? -0.3 : 0.3, dt * 2);
  }
  if (plane.pos.z < 0) plane.pos.z = 0;

  // Rings: crossing a ring's plane inside it scores; outside it is missed.
  for (const ring of rings) {
    if (ring.passed || ring.missed) continue;
    const cross = ringCrossing(ring, prev, plane.pos);
    if (cross) {
      if (cross.inside) {
        ring.passed = true;
        events.push({ type: 'ring', ring, center: cross.center });
        if (ring.fuel) {
          plane.fuel = Math.min(100, plane.fuel + FLIGHT.fuelRingRefill);
          events.push({ type: 'fuel', ring });
        }
      } else {
        ring.missed = true;
        events.push({ type: 'miss', ring });
      }
    }
  }

  // Landing: only on the destination runway, gentle and slow.
  if (mission.requireLanding) {
    const land = landingCheck(plane.pos, plane.verticalSpeed, plane.speed, mission);
    if (land === 'landed') {
      plane.landed = true;
      events.push({ type: 'landed' });
      return events;
    }
    if (land === 'hard') {
      plane.crashed = true;
      plane.crashReason = 'Hard landing — you came down too fast for the gear.';
      events.push({ type: 'crash', reason: plane.crashReason });
      return events;
    }
  }

  // Terrain: the ground, the hillsides and the ridge all end the flight.
  if (hitsTerrain(plane.pos, mission)) {
    plane.crashed = true;
    const h = terrainHeight(plane.pos.x, plane.pos.z, mission);
    plane.crashReason =
      h > 120
        ? 'You flew into the mountainside.'
        : 'You hit the ground. The valley floor is not a runway.';
    plane.pos.y = h + 1;
    events.push({ type: 'crash', reason: plane.crashReason });
    return events;
  }

  // Ceiling: the sky has a lid, gently.
  if (plane.pos.y > 420) {
    plane.pos.y = 420;
    plane.pitch = Math.min(plane.pitch, 0);
  }
  return events;
}

/**
 * Autopilot: a simple pilot that flies at a target point. Returns a stick
 * { roll, pitch, throttleUp, throttleDown } for this tick. Used by the
 * attract mode, the ?auto=1 self-play test and the screenshot staging.
 */
export function autopilotStick(plane, target, mission, dt) {
  const dx = target.x - plane.pos.x;
  const dz = target.z - plane.pos.z;
  const dy = target.y - plane.pos.y;
  // Desired heading to the target, wrapped to [-PI, PI].
  let wantHeading = Math.atan2(dx, dz);
  let dh = wantHeading - plane.heading;
  while (dh > Math.PI) dh -= 2 * Math.PI;
  while (dh < -Math.PI) dh += 2 * Math.PI;
  // Bank into the turn; the tighter the turn, the steeper the bank.
  const roll = clamp(dh * 2.4, -1, 1);
  // Pitch to meet the target altitude, eased by distance.
  const dist = Math.sqrt(dx * dx + dz * dz);
  const wantPitch = clamp(Math.atan2(dy, Math.max(60, dist)) * 1.8, -0.42, 0.42);
  const pitchErr = wantPitch - plane.pitch;
  const pitch = clamp(pitchErr * 3.0, -1, 1);
  // Throttle: fast on the straights, gentle near a ring or on final.
  const nearTarget = dist < 400;
  const wantSpeed = target.final
    ? 62
    : nearTarget
      ? 95
      : FLIGHT.cruiseSpeed + 12;
  const throttleUp = plane.speed < wantSpeed - 4;
  const throttleDown = plane.speed > wantSpeed + 8;
  return { roll, pitch, throttleUp, throttleDown };
}

/** The autopilot's current target: next unflown ring, or the runway on final. */
export function autopilotTarget(plane, rings, mission) {
  const next = rings.find((r) => !r.passed && !r.missed);
  if (next) return { x: next.x, y: next.y, z: next.z, final: false };
  // On final: hold 26 m over the threshold until the strip is under the
  // nose, then flare down to the touchdown point. A straight dive at the
  // runway centre would meet the rough ground short of the strip, and a
  // steep sink rate bends the gear — the descent stays gentle.
  const rx = courseX(6000, mission);
  if (plane.pos.z < 5920) return { x: rx, y: 26, z: 5920, final: false };
  return { x: rx, y: 3, z: 6180, final: true };
}
