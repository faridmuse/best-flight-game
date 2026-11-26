// Headless play-test for Skycourier: imports the game's own world and flight
// logic (no DOM) and proves each mission is laid out sanely and beatable:
// the terrain is finite everywhere, the autopilot threads every ring, and a
// fixed-step replay of the same inputs flies the same line twice.
// Run: node test/flight.test.mjs
import { MISSIONS } from '../game/src/config.js';
import { buildCourse, hitsTerrain, terrainHeight } from '../game/src/world.js';
import { autopilotStick, autopilotTarget, createPlane, stepPlane } from '../game/src/physics.js';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

/** Fly one mission on autopilot at a fixed step; return the outcome. */
function flyMission(mission, maxSeconds = 420) {
  const plane = createPlane(mission);
  const rings = buildCourse(mission);
  const dt = 1 / 60;
  let steps = 0;
  let ringsPassed = 0;
  let ringsMissed = 0;
  let landed = false;
  while (steps < maxSeconds * 60 && !plane.crashed && !landed) {
    const target = autopilotTarget(plane, rings, mission);
    const stick = autopilotStick(plane, target, mission, dt);
    const events = stepPlane(plane, stick, mission, rings, dt);
    for (const e of events) {
      if (e.type === 'ring') ringsPassed += 1;
      if (e.type === 'miss') ringsMissed += 1;
      if (e.type === 'landed') landed = true;
    }
    // Mission 1/2 end when every ring is flown; mission 3 ends on landing.
    if (!mission.requireLanding && rings.every((r) => r.passed || r.missed)) break;
    if (mission.requireLanding && (landed || plane.pos.z > 6300)) break;
    steps += 1;
  }
  return { plane, rings, ringsPassed, ringsMissed, landed, seconds: steps * dt };
}

// 1. The terrain is finite and sane across the whole valley.
for (const mission of MISSIONS) {
  let bad = 0;
  for (let z = 0; z <= 6400; z += 100) {
    for (let x = -700; x <= 700; x += 100) {
      const h = terrainHeight(x, z, mission);
      if (!Number.isFinite(h) || h < -5 || h > 600) bad += 1;
    }
  }
  check(`terrain finite for mission ${mission.id}`, bad === 0, bad ? `${bad} bad samples` : '');
}

// 2. Every ring sits above the terrain with room to fly through it.
for (const mission of MISSIONS) {
  const rings = buildCourse(mission);
  const low = rings.filter((r) => r.y - r.r < terrainHeight(r.x, r.z, mission) + 6);
  check(`rings clear of terrain, mission ${mission.id}`, low.length === 0, low.length ? `${low.length} rings too low` : `${rings.length} rings`);
  const start = createPlane(mission);
  const first = rings[0];
  check(`first ring ahead of the start, mission ${mission.id}`, first.z > start.pos.z + 100, `z=${first.z}`);
}

// 3. The autopilot beats every mission: all rings, and a landing on mission 3.
for (const mission of MISSIONS) {
  const run = flyMission(mission);
  const okRings = run.ringsPassed === mission.rings && run.ringsMissed === 0;
  check(
    `autopilot threads all ${mission.rings} rings, mission ${mission.id}`,
    okRings && !run.plane.crashed,
    `passed ${run.ringsPassed}, missed ${run.ringsMissed}, crashed=${run.plane.crashed} ${run.plane.crashReason ?? ''} in ${run.seconds.toFixed(0)}s`,
  );
  if (mission.requireLanding) {
    check('autopilot lands mission 3 at Tarn Field', run.landed, run.landed ? '' : `ended z=${run.plane.pos.z.toFixed(0)} y=${run.plane.pos.y.toFixed(1)}`);
  }
}

// 4. Determinism: the same autopilot run twice flies the same line.
function runHash(mission) {
  const run = flyMission(mission, 120);
  return [
    run.plane.pos.x.toFixed(4),
    run.plane.pos.y.toFixed(4),
    run.plane.pos.z.toFixed(4),
    run.plane.speed.toFixed(4),
    run.ringsPassed,
  ].join(',');
}
for (const mission of MISSIONS) {
  check(`deterministic replay, mission ${mission.id}`, runHash(mission) === runHash(mission));
}

// 5. A reckless dive into the ground really does crash (the hazard is real).
{
  const mission = MISSIONS[0];
  const plane = createPlane(mission);
  const rings = buildCourse(mission);
  let crashed = false;
  for (let i = 0; i < 60 * 30 && !crashed; i++) {
    const events = stepPlane(plane, { roll: 0, pitch: -1, throttleUp: false, throttleDown: false }, mission, rings, 1 / 60);
    crashed = events.some((e) => e.type === 'crash');
  }
  check('diving at the ground crashes the plane', crashed);
}

// 6. Fuel runs out and the engine quits (the fuel decision is real).
{
  const mission = MISSIONS[0];
  const plane = createPlane(mission);
  plane.fuel = 0.4;
  const rings = buildCourse(mission);
  for (let i = 0; i < 60 * 5; i++) {
    stepPlane(plane, { roll: 0, pitch: 0, throttleUp: true, throttleDown: false }, mission, rings, 1 / 60);
  }
  check('empty fuel means engine out', plane.engineOut && plane.throttle === 0, `fuel=${plane.fuel.toFixed(2)}`);
}

console.log(failures === 0 ? '\nAll flight tests passed.' : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
