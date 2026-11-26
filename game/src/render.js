// The renderer: a hand-rolled pseudo-3D chase view in plain canvas 2D.
// No library, no images: sky, ridges, clouds, a perspective ground grid
// whose vertices follow the real terrain height, rings, balloons, the
// aeroplane and the particles are all drawn from numbers every frame.

import { clamp, hashNoise, lerp, mulberry32, smoothstep } from './random.js';
import {
  CAMERA,
  FIELD_COLORS,
  RIVER_COLOR,
  SKY,
  VIEW_H,
  VIEW_W,
} from './config.js';
import { courseX, riverX, runways, terrainHeight } from './world.js';

const DEG = Math.PI / 180;

/** A camera that trails the aeroplane, smoothing its motion. */
export function createCamera() {
  return { x: 0, y: 60, z: 0, heading: 0, pitch: 0, roll: 0 };
}

/** Ease the camera towards the plane's trail position. */
export function updateCamera(cam, plane, dt) {
  const tx = plane.pos.x - Math.sin(plane.heading) * CAMERA.back;
  const tz = plane.pos.z - Math.cos(plane.heading) * CAMERA.back;
  const ty = plane.pos.y + CAMERA.up;
  const k = 1 - Math.exp(-CAMERA.smoothing * dt);
  cam.x += (tx - cam.x) * k;
  cam.y += (ty - cam.y) * k;
  cam.z += (tz - cam.z) * k;
  let dh = plane.heading - cam.heading;
  while (dh > Math.PI) dh -= 2 * Math.PI;
  while (dh < -Math.PI) dh += 2 * Math.PI;
  cam.heading += dh * k;
  cam.pitch += (plane.pitch * CAMERA.pitchFollow - cam.pitch) * k;
  cam.roll += (plane.roll * CAMERA.rollFollow - cam.roll) * k;
}

/** Project a world point into screen space. Null when behind the camera. */
export function project(p, cam) {
  const dx = p.x - cam.x;
  const dy = p.y - cam.y;
  const dz = p.z - cam.z;
  const sinH = Math.sin(cam.heading);
  const cosH = Math.cos(cam.heading);
  // Camera space: forward = +z along the heading, right = +x.
  let xc = dx * cosH - dz * sinH;
  let zc = dx * sinH + dz * cosH;
  let yc = dy;
  // Pitch (look up/down) rotates around the right axis.
  const sinP = Math.sin(cam.pitch);
  const cosP = Math.cos(cam.pitch);
  const yc2 = yc * cosP - zc * sinP;
  const zc2 = yc * sinP + zc * cosP;
  // Roll rotates around the forward axis.
  const sinR = Math.sin(cam.roll);
  const cosR = Math.cos(cam.roll);
  const xc2 = xc * cosR - yc2 * sinR;
  const yc3 = xc * sinR + yc2 * cosR;
  if (zc2 < 2) return null;
  const f = CAMERA.focal;
  return {
    x: VIEW_W / 2 + (xc2 / zc2) * f,
    y: VIEW_H / 2 - (yc3 / zc2) * f,
    depth: zc2,
    scale: f / zc2,
  };
}

/** Fill a quad on screen (points in screen space, already projected). */
function quad(ctx, a, b, c, d, color) {
  if (!a || !b || !c || !d) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.lineTo(d.x, d.y);
  ctx.closePath();
  ctx.fill();
}

function groundColor(x, z, mission, sky) {
  const palette = FIELD_COLORS[mission.timeOfDay];
  const cell = Math.abs(Math.floor(hashNoise(Math.floor(x / 110), Math.floor(z / 110), mission.seed) * 997));
  let color = palette[cell % palette.length];
  // The river cuts a blue ribbon through the fields.
  if (Math.abs(x - riverX(z, mission.seed)) < 20) color = RIVER_COLOR[mission.timeOfDay];
  // Runway asphalt where the strips lie.
  for (const r of runways(mission)) {
    if (Math.abs(x - r.x) < 24 && Math.abs(z - r.z) < r.len / 2) {
      color = sky.night ? '#3a3f46' : '#565b63';
    }
  }
  return color;
}

function drawSky(ctx, mission, cam, time) {
  const sky = SKY[mission.timeOfDay];
  const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  g.addColorStop(0, sky.top);
  g.addColorStop(0.55, sky.mid);
  g.addColorStop(0.75, sky.horizon);
  g.addColorStop(1, sky.groundBase);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // Stars at night, fixed to the sky (they drift with heading, not position).
  if (sky.night) {
    const rng = mulberry32(99);
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 90; i++) {
      const sx = ((rng() * 1600 - cam.heading * 300) % VIEW_W + VIEW_W) % VIEW_W;
      const sy = rng() * VIEW_H * 0.45;
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(time * 2 + i));
      ctx.globalAlpha = tw * 0.9;
      ctx.fillRect(sx, sy, 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  // Sun or moon, low in the sky, sliding with the heading.
  const sunScreenX = VIEW_W * sky.sunX - cam.heading * 160;
  const sunScreenY = VIEW_H * sky.sunY + cam.pitch * 300;
  const glow = ctx.createRadialGradient(sunScreenX, sunScreenY, 4, sunScreenX, sunScreenY, 130);
  glow.addColorStop(0, sky.sun);
  glow.addColorStop(0.25, sky.sun + 'cc');
  glow.addColorStop(1, sky.sun + '00');
  ctx.fillStyle = glow;
  ctx.fillRect(sunScreenX - 140, sunScreenY - 140, 280, 280);
  ctx.fillStyle = sky.sun;
  ctx.beginPath();
  ctx.arc(sunScreenX, sunScreenY, sky.night ? 22 : 30, 0, Math.PI * 2);
  ctx.fill();
}

/** Two layered ridge silhouettes on the horizon, parallaxed by heading. */
function drawRidges(ctx, mission, cam) {
  const sky = SKY[mission.timeOfDay];
  const horizonY = VIEW_H / 2 - Math.tan(cam.pitch) * CAMERA.focal;
  const layers = [
    { color: sky.ridgeFar, amp: 34, par: 90, base: 0 },
    { color: sky.ridgeNear, amp: 52, par: 190, base: 20 },
  ];
  for (const layer of layers) {
    ctx.fillStyle = layer.color;
    ctx.beginPath();
    ctx.moveTo(-4, VIEW_H);
    for (let sx = -4; sx <= VIEW_W + 4; sx += 16) {
      const w = sx / VIEW_W;
      const ridge =
        layer.amp * Math.sin(w * 9 + cam.heading * layer.par * 0.01 + mission.seed) +
        layer.amp * 0.5 * Math.sin(w * 23 + mission.seed * 2.3) +
        layer.amp * 0.25 * Math.sin(w * 47 + mission.seed * 4.1);
      ctx.lineTo(sx, horizonY - layer.base - Math.max(0, ridge));
    }
    ctx.lineTo(VIEW_W + 4, VIEW_H);
    ctx.closePath();
    ctx.fill();
  }
}

/** Soft cloud puffs, billboarded in world space. */
function drawClouds(ctx, clouds, cam, mission) {
  const sky = SKY[mission.timeOfDay];
  for (const c of clouds) {
    const p = project({ x: c.x, y: c.y, z: c.z }, cam);
    if (!p || p.depth > 2400) continue;
    const s = p.scale * c.s;
    const alpha = clamp(1.4 - p.depth / 1600, 0.12, 0.85);
    ctx.fillStyle = `rgba(${sky.cloud},${alpha})`;
    for (let i = 0; i < c.puffs; i++) {
      const px = p.x + (hashNoise(i, c.seed, 3) * 0.9 * s) / 2;
      const py = p.y + hashNoise(i, c.seed, 9) * s * 0.14;
      const r = s * (0.32 + 0.14 * Math.abs(hashNoise(i, c.seed, 5)));
      ctx.beginPath();
      ctx.ellipse(px, py, r, r * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** The ground: perspective rows of quads following the real terrain height. */
function drawGround(ctx, mission, cam) {
  const sky = SKY[mission.timeOfDay];
  const horizonY = VIEW_H / 2 - Math.tan(cam.pitch) * CAMERA.focal;
  // Base fill under the horizon so no gap ever shows.
  ctx.fillStyle = sky.groundBase;
  ctx.fillRect(0, horizonY, VIEW_W, VIEW_H - horizonY);

  const rows = [];
  let d = 28;
  while (d < 1500) {
    rows.push(cam.z + d);
    d *= 1.14;
  }
  const cols = [];
  for (let x = -950; x <= 950; x += 95) cols.push(x);

  for (let ri = rows.length - 1; ri >= 0; ri--) {
    const zNear = rows[ri];
    const zFar = rows[ri + 1] ?? rows[ri] + (rows[ri] - rows[ri - 1]) * 1.14;
    const fade = clamp(1 - (zNear - cam.z) / 2400, 0.3, 1);
    for (let ci = 0; ci < cols.length - 1; ci++) {
      const x0 = cols[ci];
      const x1 = cols[ci + 1];
      const a = project({ x: x0, y: terrainHeight(x0, zNear, mission), z: zNear }, cam);
      const b = project({ x: x1, y: terrainHeight(x1, zNear, mission), z: zNear }, cam);
      const c = project({ x: x1, y: terrainHeight(x1, zFar, mission), z: zFar }, cam);
      const dd = project({ x: x0, y: terrainHeight(x0, zFar, mission), z: zFar }, cam);
      if (!a || !b || !c || !dd) continue;
      const cx = (x0 + x1) / 2;
      const cz = (zNear + zFar) / 2;
      let color = groundColor(cx, cz, mission, sky);
      // Distance fog: blend towards the horizon colour, never all the way.
      if (fade < 1) color = mixColor(color, sky.fog, (1 - fade) * 0.6);
      // Slope shading: steep ground reads darker, and bare rock on the walls.
      const slope = Math.abs(terrainHeight(x1, zNear, mission) - terrainHeight(x0, zNear, mission));
      if (slope > 14) color = mixColor(color, sky.night ? '#3a4152' : '#8a7f74', 0.35);
      else if (slope > 6) color = shadeColor(color, 0.72);
      quad(ctx, a, b, c, dd, color);
    }
  }
}

/** Runway centreline dashes and edge lights, drawn as projected markers. */
function drawRunway(ctx, mission, cam) {
  const sky = SKY[mission.timeOfDay];
  for (const r of runways(mission)) {
    const half = r.len / 2;
    for (let dz = -half + 12; dz < half; dz += 24) {
      const p = project({ x: r.x, y: 1.2, z: r.z + dz }, cam);
      if (!p || p.depth > 1200) continue;
      const s = Math.max(1, p.scale * 1.6);
      ctx.fillStyle = dz % 48 < 24 ? '#f2f2e8' : 'rgba(242,242,232,0.25)';
      ctx.fillRect(p.x - s * 0.4, p.y - s * 0.2, s * 0.8, s * 0.4);
    }
    // Edge lights: amber at day, bright at night.
    for (const side of [-1, 1]) {
      for (let dz = -half; dz <= half; dz += 30) {
        const p = project({ x: r.x + side * 22, y: 1.5, z: r.z + dz }, cam);
        if (!p || p.depth > 1200) continue;
        const s = Math.max(1.5, p.scale * 1.2);
        ctx.fillStyle = sky.night ? '#ffb84d' : '#d8a04a';
        ctx.beginPath();
        ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Threshold bars at each end.
    for (const end of [-1, 1]) {
      const p = project({ x: r.x, y: 1.2, z: r.z + end * (half - 4) }, cam);
      if (!p || p.depth > 1200) continue;
      const w = p.scale * 34;
      ctx.fillStyle = '#f2f2e8';
      ctx.fillRect(p.x - w / 2, p.y - 1, w, 2.5);
    }
  }
}

/** Target rings: glowing hoops standing on the course line. */
function drawRings(ctx, rings, cam, nextIndex, time) {
  for (const ring of rings) {
    if (ring.passed) continue;
    const p = project({ x: ring.x, y: ring.y, z: ring.z }, cam);
    if (!p || p.depth < 4 || p.depth > 1600) continue;
    const isNext = ring.index === nextIndex;
    const rx = ring.r * p.scale;
    if (rx < 2) continue;
    // The ring flattens as the plane draws level with it.
    const view = Math.atan2(p.x - VIEW_W / 2, CAMERA.focal);
    const ry = Math.max(rx * 0.18, rx * Math.abs(Math.cos(view)) * 0.92);
    const pulse = isNext ? 1 + 0.08 * Math.sin(time * 5) : 1;
    const base = ring.fuel ? '#3ddc78' : isNext ? '#ffb02e' : '#ff5a3c';
    const glow = ring.fuel ? 'rgba(61,220,120,0.35)' : isNext ? 'rgba(255,176,46,0.4)' : 'rgba(255,90,60,0.3)';
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(1, ry / rx);
    ctx.lineWidth = Math.max(2, rx * 0.1 * pulse);
    ctx.strokeStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, rx * 1.12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = Math.max(2, rx * 0.055 * pulse);
    ctx.strokeStyle = base;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, rx * 0.02);
    ctx.beginPath();
    ctx.arc(0, 0, rx * 0.86, 0, Math.PI * 2);
    ctx.stroke();
    // Chevrons pointing through the ring.
    ctx.fillStyle = base;
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i - 1) * 0.5;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * rx * 0.62, Math.sin(a) * rx * 0.62);
      ctx.lineTo(Math.cos(a - 0.16) * rx * 0.8, Math.sin(a - 0.16) * rx * 0.8);
      ctx.lineTo(Math.cos(a + 0.16) * rx * 0.8, Math.sin(a + 0.16) * rx * 0.8);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    // The next ring gets a light pillar so it can be found from far away.
    if (isNext && p.depth > 200) {
      const top = project({ x: ring.x, y: ring.y + 260, z: ring.z }, cam);
      if (top) {
        const g = ctx.createLinearGradient(p.x, p.y, top.x, top.y);
        g.addColorStop(0, 'rgba(255,176,46,0.28)');
        g.addColorStop(1, 'rgba(255,176,46,0)');
        ctx.fillStyle = g;
        ctx.fillRect(p.x - 3, top.y, 6, p.y - top.y);
      }
    }
  }
}

/** Hot-air balloons drifting over the valley. */
function drawBalloons(ctx, balloons, cam, time) {
  for (const b of balloons) {
    const bobY = b.y + Math.sin(time * 0.4 + b.z) * 4;
    const p = project({ x: b.x, y: bobY, z: b.z }, cam);
    if (!p || p.depth < 10 || p.depth > 1500) continue;
    const s = p.scale * 26;
    if (s < 3) continue;
    // Envelope.
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y - s * 0.7, s * 0.62, s * 0.78, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.ellipse(p.x - s * 0.2, p.y - s * 0.95, s * 0.2, s * 0.34, -0.3, 0, Math.PI * 2);
    ctx.fill();
    // Basket.
    ctx.fillStyle = '#6b4a2f';
    ctx.fillRect(p.x - s * 0.16, p.y + s * 0.12, s * 0.32, s * 0.26);
    ctx.strokeStyle = '#4a3420';
    ctx.lineWidth = Math.max(1, s * 0.03);
    ctx.beginPath();
    ctx.moveTo(p.x - s * 0.4, p.y - s * 0.1);
    ctx.lineTo(p.x - s * 0.14, p.y + s * 0.12);
    ctx.moveTo(p.x + s * 0.4, p.y - s * 0.1);
    ctx.lineTo(p.x + s * 0.14, p.y + s * 0.12);
    ctx.stroke();
  }
}

/** The Skycourier herself, drawn in screen space from behind and below. */
export function drawPlane(ctx, plane, time, speedNorm) {
  const cx = VIEW_W / 2;
  const cy = VIEW_H * 0.66 + Math.sin(time * 2.2) * 2 - plane.pitch * 120;
  const roll = plane.roll;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(roll * 0.85);
  const scale = 1.28 + speedNorm * 0.06;
  ctx.scale(scale, scale);

  // Soft shadow blob under the aircraft.
  ctx.fillStyle = 'rgba(10,16,30,0.18)';
  ctx.beginPath();
  ctx.ellipse(0, 108, 165, 15, 0, 0, Math.PI * 2);
  ctx.fill();

  // Wing struts: thin braces from the belly to each wing, the bush-plane look.
  ctx.strokeStyle = 'rgba(90,70,50,0.85)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-14, 42);
  ctx.lineTo(-118, 34);
  ctx.moveTo(14, 42);
  ctx.lineTo(118, 34);
  ctx.stroke();

  // Main wings: broad, slightly swept, cream with red tips.
  ctx.fillStyle = '#f2e6c8';
  ctx.beginPath();
  ctx.moveTo(-20, -10);
  ctx.lineTo(-268, 22);
  ctx.lineTo(-262, 48);
  ctx.lineTo(-18, 26);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(20, -10);
  ctx.lineTo(268, 22);
  ctx.lineTo(262, 48);
  ctx.lineTo(18, 26);
  ctx.closePath();
  ctx.fill();
  // Wing shading: a darker trailing edge for depth.
  ctx.fillStyle = 'rgba(120,95,60,0.35)';
  ctx.beginPath();
  ctx.moveTo(-262, 40);
  ctx.lineTo(-18, 20);
  ctx.lineTo(-18, 26);
  ctx.lineTo(-262, 48);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(262, 40);
  ctx.lineTo(18, 20);
  ctx.lineTo(18, 26);
  ctx.lineTo(262, 48);
  ctx.closePath();
  ctx.fill();
  // Red wingtips and nav lights.
  ctx.fillStyle = '#c8442e';
  ctx.beginPath();
  ctx.moveTo(-268, 22);
  ctx.lineTo(-246, 20);
  ctx.lineTo(-242, 42);
  ctx.lineTo(-262, 48);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(268, 22);
  ctx.lineTo(246, 20);
  ctx.lineTo(242, 42);
  ctx.lineTo(262, 48);
  ctx.closePath();
  ctx.fill();
  const blink = Math.sin(time * 6) > 0;
  ctx.fillStyle = blink ? '#ff4444' : '#882222';
  ctx.beginPath();
  ctx.arc(-264, 34, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = blink ? '#44ff88' : '#228844';
  ctx.beginPath();
  ctx.arc(264, 34, 4.5, 0, Math.PI * 2);
  ctx.fill();

  // Fuselage: a solid tapered body, cream with a red cheatline and dark belly.
  const body = ctx.createLinearGradient(-36, 0, 36, 0);
  body.addColorStop(0, '#d9c9a4');
  body.addColorStop(0.5, '#fbf3dd');
  body.addColorStop(1, '#d9c9a4');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-30, -62);
  ctx.quadraticCurveTo(-40, 8, -26, 72);
  ctx.quadraticCurveTo(0, 86, 26, 72);
  ctx.quadraticCurveTo(40, 8, 30, -62);
  ctx.quadraticCurveTo(0, -78, -30, -62);
  ctx.closePath();
  ctx.fill();
  // Belly shading.
  ctx.fillStyle = 'rgba(90,70,45,0.28)';
  ctx.beginPath();
  ctx.moveTo(-26, 72);
  ctx.quadraticCurveTo(0, 86, 26, 72);
  ctx.quadraticCurveTo(0, 78, -26, 72);
  ctx.closePath();
  ctx.fill();
  // Cheatline.
  ctx.fillStyle = '#c8442e';
  ctx.beginPath();
  ctx.moveTo(-33, -6);
  ctx.lineTo(33, -6);
  ctx.lineTo(31, 4);
  ctx.lineTo(-31, 4);
  ctx.closePath();
  ctx.fill();
  // Registration on the rear fuselage, between the cockpit and the cheatline.
  ctx.fillStyle = '#3a2c1e';
  ctx.font = 'bold 14px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SK-01', 0, -28);

  // Cockpit windows (the roofline hump, seen from behind).
  ctx.fillStyle = '#22364e';
  ctx.beginPath();
  ctx.ellipse(0, -50, 19, 13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(180,220,255,0.5)';
  ctx.beginPath();
  ctx.ellipse(-5, -52, 7, 5, -0.3, 0, Math.PI * 2);
  ctx.fill();

  // Tailplane and fin.
  ctx.fillStyle = '#f2e6c8';
  ctx.beginPath();
  ctx.moveTo(-16, 56);
  ctx.lineTo(-96, 72);
  ctx.lineTo(-92, 84);
  ctx.lineTo(-14, 72);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(16, 56);
  ctx.lineTo(96, 72);
  ctx.lineTo(92, 84);
  ctx.lineTo(14, 72);
  ctx.closePath();
  ctx.fill();
  // Fin: red, with a white star.
  ctx.fillStyle = '#c8442e';
  ctx.beginPath();
  ctx.moveTo(-10, 62);
  ctx.lineTo(-5, 2);
  ctx.lineTo(11, 2);
  ctx.lineTo(16, 62);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fbf3dd';
  ctx.beginPath();
  ctx.arc(3, 34, 6, 0, Math.PI * 2);
  ctx.fill();

  // Propeller blur at the nose (the far end, peeking over the cowling).
  const propA = time * 28;
  ctx.strokeStyle = 'rgba(60,60,70,0.35)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(0, -70, 36 * Math.abs(Math.cos(propA)) + 6, 8, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();

  // Speed streaks at the screen edges when fast.
  if (speedNorm > 0.72) {
    const alpha = (speedNorm - 0.72) * 1.6;
    ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.5})`;
    ctx.lineWidth = 1.5;
    const rng = mulberry32(5);
    for (let i = 0; i < 10; i++) {
      const edge = rng();
      const y = rng() * VIEW_H;
      const len = 30 + rng() * 60;
      ctx.beginPath();
      if (edge < 0.5) {
        ctx.moveTo(0, y);
        ctx.lineTo(len, y + 8);
      } else {
        ctx.moveTo(VIEW_W, y);
        ctx.lineTo(VIEW_W - len, y + 8);
      }
      ctx.stroke();
    }
  }
}

/** World-space particles: ring bursts, exhaust, crash fire and smoke. */
export function drawParticles(ctx, particles, cam) {
  for (const p of particles) {
    const s = project({ x: p.x, y: p.y, z: p.z }, cam);
    if (!s) continue;
    const life = p.life / p.maxLife;
    ctx.globalAlpha = clamp(life, 0, 1);
    ctx.fillStyle = p.color;
    const r = Math.max(1, p.size * s.scale * life);
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Draw the whole scene for one frame. */
export function drawScene(ctx, game, cam) {
  const { mission, plane, clouds, balloons, rings, particles, time, nextRingIndex } = game;
  drawSky(ctx, mission, cam, time);
  drawRidges(ctx, mission, cam);
  drawClouds(ctx, clouds, cam, mission);
  drawGround(ctx, mission, cam);
  drawRunway(ctx, mission, cam);
  drawBalloons(ctx, balloons, cam, time);
  drawRings(ctx, rings, cam, nextRingIndex, time);
  drawParticles(ctx, particles, cam);
  const speedNorm = plane.speed / 165;
  drawPlane(ctx, plane, time, speedNorm);
}

/** Parse a '#rrggbb' or 'rgb(r,g,b)' colour into [r, g, b]. */
function parseColor(c) {
  if (c.startsWith('rgb')) {
    return c
      .slice(c.indexOf('(') + 1, c.indexOf(')'))
      .split(',')
      .map((n) => Number(n.trim()));
  }
  const p = parseInt(c.slice(1), 16);
  return [(p >> 16) & 255, (p >> 8) & 255, p & 255];
}

/** Mix a colour towards another by t (0..1). */
export function mixColor(a, b, t) {
  const [ar, ag, ab] = parseColor(a);
  const [br, bg, bb] = parseColor(b);
  const r = Math.round(lerp(ar, br, t));
  const g = Math.round(lerp(ag, bg, t));
  const bl = Math.round(lerp(ab, bb, t));
  return `rgb(${r},${g},${bl})`;
}

/** Darken a colour by a factor. */
export function shadeColor(c, f) {
  const [r, g, b] = parseColor(c);
  return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
}
