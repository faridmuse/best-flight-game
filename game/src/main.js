// Skycourier: Valley Run — the game loop, the states between sorties, the
// scoring, the particles and the autopilot that flies the attract mode and
// the self-play tests. One rAF loop, one fixed physics step, no network.

import { FLIGHT, MISSIONS, VIEW_H, VIEW_W } from './config.js';
import { mulberry32 } from './random.js';
import { buildBalloons, buildClouds, buildCourse, courseX, runwayFlatten, terrainHeight } from './world.js';
import { createInput } from './input.js';
import { autopilotStick, autopilotTarget, createPlane, stepPlane } from './physics.js';
import { createAudio } from './audio.js';
import { createCamera, drawScene, project, updateCamera } from './render.js';
import { drawHUD, drawTitle, menuPanel } from './hud.js';

const DT = 1 / 60;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const params = new URLSearchParams(window.location.search);

const input = createInput(canvas);
const audio = createAudio();
const cam = createCamera();

/** Everything one sortie needs, rebuilt when a mission starts. */
function newSortie(mission) {
  const plane = createPlane(mission);
  return {
    state: 'briefing',
    mission,
    plane,
    rings: buildCourse(mission),
    clouds: buildClouds(mission),
    balloons: buildBalloons(mission),
    particles: [],
    score: 0,
    elapsed: 0,
    time: 0,
    bannerUntil: 0,
    nextRingIndex: 0,
    warnings: [],
    result: null, // { kind: 'complete' | 'crash', reason, breakdown }
    stallBeepAt: 0,
    auto: false,
  };
}

let game = newSortie(MISSIONS[0]);
let attract = newSortie(MISSIONS[0]);
attract.state = 'flying';
attract.auto = true;
attract.bannerUntil = 0;

function startMission(index) {
  game = newSortie(MISSIONS[index]);
  game.state = 'briefing';
  audio.unlock();
  audio.click();
}

function launchSortie() {
  game.state = 'flying';
  game.bannerUntil = game.time + 4;
  audio.unlock();
}

function spawnParticles(game, x, y, z, count, color, speed, size, life) {
  const rng = mulberry32(Math.floor(game.time * 1000) + count * 13);
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const b = rng() * Math.PI - Math.PI / 2;
    game.particles.push({
      x,
      y,
      z,
      vx: Math.cos(a) * Math.cos(b) * speed * (0.4 + rng() * 0.6),
      vy: Math.sin(b) * speed * (0.4 + rng() * 0.6),
      vz: Math.sin(a) * Math.cos(b) * speed * (0.4 + rng() * 0.6),
      life: life * (0.5 + rng() * 0.5),
      maxLife: life,
      color,
      size: size * (0.6 + rng() * 0.8),
    });
  }
}

function burstRing(game, ring, center) {
  spawnParticles(game, ring.x, ring.y, ring.z, 26, '#ffd76a', 14, 1.6, 0.9);
  spawnParticles(game, ring.x, ring.y, ring.z, 12, '#ffffff', 8, 1.1, 0.6);
  if (center) game.score += FLIGHT.ringCenterBonus;
}

function crashBurst(game) {
  const p = game.plane.pos;
  spawnParticles(game, p.x, p.y + 2, p.z, 40, '#ff7a3c', 22, 2.4, 1.4);
  spawnParticles(game, p.x, p.y + 2, p.z, 26, '#3a3a3a', 12, 3.2, 2.2);
  spawnParticles(game, p.x, p.y + 2, p.z, 14, '#ffd76a', 30, 1.6, 0.7);
}

function updateParticles(game, dt) {
  for (const p of game.particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    p.vy -= 2 * dt;
    p.life -= dt;
  }
  game.particles = game.particles.filter((p) => p.life > 0);
}

function missionComplete(game) {
  const timeBonus = Math.max(0, Math.round((game.mission.parSeconds - game.elapsed) * FLIGHT.timeBonusPerSecond));
  const ringsDone = game.rings.filter((r) => r.passed).length;
  game.score += timeBonus;
  game.state = 'complete';
  game.result = {
    kind: 'complete',
    breakdown: [
      `Rings threaded: ${ringsDone} of ${game.rings.length}`,
      `Time: ${Math.round(game.elapsed)}s (par ${game.mission.parSeconds}s) — bonus +${timeBonus}`,
      game.mission.requireLanding ? 'Touchdown at Tarn Field: +500' : 'Sortie flown clean',
    ],
  };
  audio.landed();
}

/** One physics tick while flying: input, autopilot, events, warnings. */
function tickFlying(game, dt) {
  const plane = game.plane;
  const prevPos = { ...plane.pos };
  let stick;
  if (game.auto) {
    const target = autopilotTarget(plane, game.rings, game.mission);
    stick = autopilotStick(plane, target, game.mission, dt);
  } else {
    input.update();
    stick = {
      roll: input.roll,
      pitch: input.pitch,
      throttleUp: input.throttleUp,
      throttleDown: input.throttleDown,
    };
  }
  const events = stepPlane(plane, stick, game.mission, game.rings, dt);
  game.elapsed += dt;

  for (const e of events) {
    if (e.type === 'ring') {
      game.score += FLIGHT.ringScore;
      burstRing(game, e.ring, e.center);
      audio.ring(e.center);
    } else if (e.type === 'fuel') {
      game.score += FLIGHT.fuelRingScore;
      audio.fuel();
    } else if (e.type === 'miss') {
      audio.miss();
    } else if (e.type === 'landed') {
      game.score += FLIGHT.landingScore;
      missionComplete(game);
    } else if (e.type === 'crash') {
      crashBurst(game);
      audio.crash();
      game.state = 'crash';
      game.result = { kind: 'crash', reason: e.reason, breakdown: [] };
    }
  }

  // A sortie ends when the last ring is flown and no landing is required.
  if (game.state === 'flying' && !game.mission.requireLanding) {
    const done = game.rings.every((r) => r.passed || r.missed);
    if (done) missionComplete(game);
  }
  if (game.state === 'flying' && game.mission.requireLanding) {
    const done = game.rings.every((r) => r.passed || r.missed);
    if (done && !plane.landed && plane.pos.z > 6300) {
      // Flew past the field without landing: the sortie is over, unlanded.
      game.state = 'complete';
      game.result = {
        kind: 'complete',
        breakdown: ['You flew past Tarn Field without landing — no landing bonus.'],
      };
    }
  }

  // Warnings: stall, fuel, terrain — but not on final, where the runway
  // ahead is flat ground the flattening has already levelled.
  const warnings = [];
  if (plane.stalled) warnings.push('STALL');
  if (plane.fuel < 25) warnings.push('LOW FUEL');
  if (plane.engineOut) warnings.push('ENGINE OUT');
  const ahead = terrainHeight(plane.pos.x, plane.pos.z + 160, game.mission);
  const onFinal = runwayFlatten(plane.pos.x, plane.pos.z + 160, game.mission) > 0.5;
  if (!onFinal && plane.pos.y < ahead + 26 && plane.verticalSpeed < -2) warnings.push('PULL UP');
  game.warnings = warnings;
  if (plane.stalled && game.time - game.stallBeepAt > 1.1) {
    audio.stall();
    game.stallBeepAt = game.time;
  }

  // Exhaust puffs when the throttle is high.
  if (plane.throttle > 0.75 && Math.random() < 0.35) {
    game.particles.push({
      x: plane.pos.x + (Math.random() - 0.5) * 2,
      y: plane.pos.y - 1,
      z: plane.pos.z - 14,
      vx: 0,
      vy: 0,
      vz: -8,
      life: 0.7,
      maxLife: 0.7,
      color: 'rgba(200,200,200,0.5)',
      size: 1.4,
    });
  }
  updateParticles(game, dt);

  // The next ring, for the HUD and the beacon — or the runway, once the
  // rings are done and the sortie is on final.
  const allDone = game.rings.every((r) => r.passed || r.missed);
  game.nextRingIndex = game.rings.findIndex((r) => !r.passed && !r.missed);
  if (game.nextRingIndex === -1) game.nextRingIndex = game.rings.length - 1;
  if (allDone && game.mission.requireLanding) {
    const rx = courseX(6000, game.mission);
    const screen = project({ x: rx, y: 4, z: 6130 }, cam);
    game.nextRingScreen = screen ? { ...screen, x: rx, y: 4, z: 6130, runway: true } : null;
  } else {
    const next = game.rings[game.nextRingIndex];
    if (next) {
      const screen = project({ x: next.x, y: next.y, z: next.z }, cam);
      game.nextRingScreen = screen
        ? { ...screen, x: next.x, y: next.y, z: next.z, fuel: next.fuel }
        : null;
    } else {
      game.nextRingScreen = null;
    }
  }

  audio.update(plane.throttle, plane.speed, game.state === 'flying');
}

/** Handle keys and clicks per state. */
function handleInput() {
  if (input.wasPressed('mute')) {
    const muted = audio.toggleMute();
    document.getElementById('mute-note').textContent = muted ? 'sound off (M)' : 'sound on (M)';
  }
  if (game.state === 'title') {
    if (input.wasPressed('mission1')) startMission(0);
    else if (input.wasPressed('mission2')) startMission(1);
    else if (input.wasPressed('mission3')) startMission(2);
    else if (input.wasPressed('confirm')) startMission(0);
    return;
  }
  if (game.state === 'briefing') {
    if (input.wasPressed('confirm') || input.wasPressed('mission1')) launchSortie();
    return;
  }
  if (game.state === 'flying') {
    if (input.wasPressed('pause')) {
      game.state = 'paused';
      audio.update(0, 0, false);
    }
    if (input.wasPressed('restart')) startMission(game.mission.id - 1);
    return;
  }
  if (game.state === 'paused') {
    if (input.wasPressed('pause') || input.wasPressed('confirm')) game.state = 'flying';
    if (input.wasPressed('restart')) startMission(game.mission.id - 1);
    return;
  }
  if (game.state === 'complete' || game.state === 'crash') {
    if (input.wasPressed('confirm') || input.wasPressed('restart')) startMission(game.mission.id - 1);
    if (input.wasPressed('mission1')) startMission(0);
    if (input.wasPressed('mission2')) startMission(1);
    if (input.wasPressed('mission3')) startMission(2);
    return;
  }
}

/** Draw one frame for the current state. */
function draw() {
  const active = game.state === 'title' ? attract : game;
  drawScene(ctx, active, cam);
  if (game.state === 'title') {
    drawTitle(ctx, game.time);
  } else if (game.state === 'briefing') {
    drawHUD(ctx, game);
    menuPanel(
      ctx,
      game.mission.name,
      [
        game.mission.subtitle,
        game.mission.briefing,
        `Rings: ${game.mission.rings} · Fuel: ${game.mission.fuel} · Par: ${game.mission.parSeconds}s`,
      ],
      'PRESS ENTER OR CLICK TO TAKE OFF',
    );
  } else if (game.state === 'flying') {
    drawHUD(ctx, game);
  } else if (game.state === 'paused') {
    drawHUD(ctx, game);
    menuPanel(ctx, 'Paused', ['Take a breath. The valley will wait.'], 'P — RESUME · R — RESTART THE SORTIE');
  } else if (game.state === 'complete') {
    drawHUD(ctx, game);
    const lines = [
      `Score: ${game.score.toLocaleString('en-US')} points`,
      ...(game.result?.breakdown ?? []),
    ];
    menuPanel(ctx, 'Sortie complete', lines, 'ENTER — FLY IT AGAIN · 1 / 2 / 3 — ANOTHER MISSION');
  } else if (game.state === 'crash') {
    menuPanel(
      ctx,
      'Down in the valley',
      [game.result?.reason ?? 'The flight is over.', `Score: ${game.score.toLocaleString('en-US')} points`],
      'ENTER — TRY AGAIN · 1 / 2 / 3 — ANOTHER MISSION',
    );
  }
}

let last = performance.now();
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const elapsedMs = Math.min(100, now - last);
  last = now;
  acc += elapsedMs / 1000;
  // Fixed-step physics so a replay flies the same line every time.
  let steps = 0;
  while (acc >= DT && steps < 5) {
    game.time += DT;
    if (game.state === 'title') {
      attract.time += DT;
      const target = autopilotTarget(attract.plane, attract.rings, attract.mission);
      const stick = autopilotStick(attract.plane, target, attract.mission, DT);
      stepPlane(attract.plane, stick, attract.mission, attract.rings, DT);
      updateCamera(cam, attract.plane, DT);
      updateParticles(attract, DT);
      if (attract.plane.crashed || attract.plane.pos.z > 6200) {
        attract = newSortie(attract.mission);
        attract.state = 'flying';
        attract.auto = true;
      }
    } else if (game.state === 'flying') {
      tickFlying(game, DT);
      updateCamera(cam, game.plane, DT);
    } else if (game.state === 'briefing' || game.state === 'paused') {
      updateCamera(cam, game.plane, DT);
    }
    acc -= DT;
    steps += 1;
  }
  handleInput();
  draw();
  input.endFrame();
}

/** Screenshot staging: ?shot=title|cover|ring|landing&seed=N stages a scene. */
function stageShot() {
  const shot = params.get('shot');
  if (!shot) return;
  const missionIndex = Number(params.get('mission') ?? 0);
  if (shot === 'title') {
    game.state = 'title';
    return;
  }
  startMission(Number.isInteger(missionIndex) ? missionIndex : 0);
  game.state = 'flying';
  game.auto = params.get('auto') !== '0';
  game.bannerUntil = 0;
  if (shot === 'ring') {
    // Jump the plane to just before the third ring so the shot catches a pass.
    // The two rings behind the staging point count as already flown.
    game.rings[0].passed = true;
    game.rings[1].passed = true;
    game.score = 2 * FLIGHT.ringScore;
    const ring = game.rings[2];
    game.plane.pos = { x: ring.x - 40, y: ring.y + 6, z: ring.z - 260 };
    game.plane.heading = 0;
    game.plane.speed = 130;
    game.plane.throttle = 0.8;
    cam.x = game.plane.pos.x;
    cam.y = game.plane.pos.y + 7;
    cam.z = game.plane.pos.z - 20;
    cam.heading = 0;
  } else if (shot === 'landing') {
    const ring = game.rings[game.rings.length - 1];
    game.rings.forEach((r) => {
      r.passed = true;
    });
    game.score = game.rings.length * FLIGHT.ringScore;
    game.plane.pos = { x: courseX(6000, game.mission) + 30, y: 55, z: 5660 };
    game.plane.heading = 0;
    game.plane.speed = 78;
    game.plane.throttle = 0.42;
    game.plane.pitch = -0.06;
    cam.x = game.plane.pos.x;
    cam.y = game.plane.pos.y + 7;
    cam.z = game.plane.pos.z - 20;
    cam.heading = 0;
  }
  // Deterministic attract seed for the staged scene.
  game.time = 0;
}

// The page opens on the title screen, the valley flying itself behind it.
game.state = 'title';
stageShot();
requestAnimationFrame(frame);

// Test and screenshot hooks: the page's own state, readable from outside.
window.__game = {
  get state() {
    return game.state;
  },
  get score() {
    return game.score;
  },
  get ringsPassed() {
    return game.rings.filter((r) => r.passed).length;
  },
  get plane() {
    return game.plane;
  },
  get mission() {
    return game.mission;
  },
  get nextRingDist() {
    const next = game.rings.find((r) => !r.passed && !r.missed);
    if (!next) return null;
    const dx = next.x - game.plane.pos.x;
    const dy = next.y - game.plane.pos.y;
    const dz = next.z - game.plane.pos.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  },
  start: startMission,
  launch: launchSortie,
};
