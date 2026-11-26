// The HUD and the menus: instruments that look flown, and the screens
// between sorties. Everything is drawn on the same canvas as the world, so
// a screenshot always shows the game as the pilot sees it.

import { clamp, lerp } from './random.js';
import { FLIGHT, VIEW_H, VIEW_W } from './config.js';
import { project } from './render.js';

const DEG = Math.PI / 180;

function panel(ctx, x, y, w, h, alpha = 0.55) {
  ctx.fillStyle = `rgba(8,14,28,${alpha})`;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function label(ctx, text, x, y, size = 11, color = '#9fb4d0', align = 'left') {
  ctx.fillStyle = color;
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
}

function value(ctx, text, x, y, size = 26, color = '#ffffff', align = 'left') {
  ctx.fillStyle = color;
  ctx.font = `700 ${size}px system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function compassLabel(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return dirs[idx];
}

/** The compass strip: heading ticks across the top centre. */
function drawCompass(ctx, headingDeg) {
  const cx = VIEW_W / 2;
  const y = 14;
  panel(ctx, cx - 190, y, 380, 44);
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - 190, y, 380, 44);
  ctx.clip();
  const h = ((headingDeg % 360) + 360) % 360;
  for (let d = -60; d <= 60; d += 5) {
    const deg = h + d;
    const x = cx + d * 3;
    const major = Math.round(deg) % 15 === 0;
    ctx.strokeStyle = major ? '#ffffff' : 'rgba(255,255,255,0.4)';
    ctx.lineWidth = major ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(x, y + 30);
    ctx.lineTo(x, y + (major ? 18 : 24));
    ctx.stroke();
    if (Math.round(deg) % 45 === 0) {
      label(ctx, compassLabel(deg), x, y + 14, 11, '#ffffff', 'center');
    }
  }
  ctx.restore();
  // Centre caret and the numeric heading.
  ctx.fillStyle = '#ffb02e';
  ctx.beginPath();
  ctx.moveTo(cx - 7, y + 44);
  ctx.lineTo(cx + 7, y + 44);
  ctx.lineTo(cx, y + 52);
  ctx.closePath();
  ctx.fill();
  value(ctx, `${String(Math.round(h)).padStart(3, '0')}°`, cx, y + 40, 13, '#ffb02e', 'center');
}

/** Artificial horizon: a little attitude indicator, bottom right. */
function drawAttitude(ctx, plane) {
  const cx = VIEW_W - 86;
  const cy = VIEW_H - 86;
  const r = 58;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(-plane.roll);
  const pitchPx = clamp(plane.pitch / (30 * DEG), -1, 1) * r * 0.55;
  ctx.fillStyle = '#3f7fd0';
  ctx.fillRect(-r, -r + pitchPx - r, r * 2, r * 2);
  ctx.fillStyle = '#8a6a42';
  ctx.fillRect(-r, pitchPx, r * 2, r * 2);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-r, pitchPx);
  ctx.lineTo(r, pitchPx);
  ctx.stroke();
  ctx.restore();
  // Bezel and the fixed aeroplane symbol.
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = '#ffb02e';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - 26, cy);
  ctx.lineTo(cx - 8, cy);
  ctx.moveTo(cx + 8, cy);
  ctx.lineTo(cx + 26, cy);
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx, cy + 6);
  ctx.stroke();
  label(ctx, 'ATTITUDE', cx, cy + r + 16, 10, '#9fb4d0', 'center');
}

/** Course progress: the rings as dots along a line, bottom centre. */
function drawProgress(ctx, rings, nextIndex) {
  const w = 300;
  const x0 = VIEW_W / 2 - w / 2;
  const y = VIEW_H - 26;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x0 + w, y);
  ctx.stroke();
  rings.forEach((ring, i) => {
    const x = x0 + (i / Math.max(1, rings.length - 1)) * w;
    ctx.fillStyle = ring.passed
      ? '#3ddc78'
      : ring.missed
        ? '#ff5a3c'
        : i === nextIndex
          ? '#ffb02e'
          : 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.arc(x, y, i === nextIndex ? 6 : 4.5, 0, Math.PI * 2);
    ctx.fill();
  });
  label(ctx, 'COURSE', x0 + w + 10, y + 4, 10, '#9fb4d0', 'left');
}

/**
 * The full in-flight HUD. `game` carries plane, mission, rings, score,
 * time, warnings and the next-ring projection.
 */
export function drawHUD(ctx, game) {
  const { plane, mission, rings, score, elapsed, nextRingIndex, warnings, time } = game;
  const headingDeg = ((-plane.heading / DEG) % 360 + 360) % 360;

  drawCompass(ctx, headingDeg);

  // Airspeed, top left.
  panel(ctx, 16, 14, 168, 74);
  label(ctx, 'AIRSPEED', 28, 32);
  value(ctx, `${Math.round(plane.speed * 1.9)}`, 28, 64, 30);
  label(ctx, 'KT', 108, 64, 12, '#9fb4d0');
  // Throttle bar.
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(28, 72, 144, 6);
  ctx.fillStyle = plane.engineOut ? '#ff5a3c' : '#ffb02e';
  ctx.fillRect(28, 72, 144 * plane.throttle, 6);

  // Altitude, top right. One world unit is one metre: feet are metres × 3.28,
  // and vertical speed in feet per minute is metres per second × 196.8.
  panel(ctx, VIEW_W - 184, 14, 168, 74);
  label(ctx, 'ALTITUDE', VIEW_W - 172, 32);
  value(ctx, `${Math.round(plane.pos.y * 3.28).toLocaleString('en-US')}`, VIEW_W - 172, 64, 30);
  label(ctx, 'FT', VIEW_W - 52, 64, 12, '#9fb4d0');
  const vsi = plane.verticalSpeed;
  const arrow = vsi > 0.5 ? '▲' : vsi < -0.5 ? '▼' : '—';
  label(ctx, `${arrow} ${Math.abs(Math.round(vsi * 196.8))} FT/MIN`, VIEW_W - 172, 82, 11, vsi < -8 ? '#ff8a7a' : '#9fb4d0');

  // Score, rings and time, under the airspeed.
  panel(ctx, 16, 98, 168, 66);
  label(ctx, 'SCORE', 28, 116);
  value(ctx, `${score.toLocaleString('en-US')}`, 28, 142, 22);
  const done = rings.filter((r) => r.passed).length;
  label(ctx, `RINGS ${done}/${rings.length}`, 28, 158, 12, '#ffffff');
  label(ctx, formatTime(elapsed), 156, 158, 12, '#9fb4d0', 'right');

  // Fuel, bottom left.
  panel(ctx, 16, VIEW_H - 96, 168, 80);
  label(ctx, 'FUEL', 28, VIEW_H - 78);
  const fuelLow = plane.fuel < 25;
  const fuelColor = fuelLow && Math.sin(time * 8) > 0 ? '#ff5a3c' : '#3ddc78';
  value(ctx, `${Math.round(plane.fuel)}`, 28, VIEW_H - 46, 26, fuelColor);
  label(ctx, '%', 76, VIEW_H - 46, 12, '#9fb4d0');
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(28, VIEW_H - 36, 144, 8);
  ctx.fillStyle = fuelColor;
  ctx.fillRect(28, VIEW_H - 36, 144 * (plane.fuel / 100), 8);

  drawAttitude(ctx, plane);
  drawProgress(ctx, rings, nextRingIndex);

  // Centre reticle and next-ring range.
  const cx = VIEW_W / 2;
  const cy = VIEW_H * 0.52;
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, 10, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 16, cy);
  ctx.lineTo(cx - 6, cy);
  ctx.moveTo(cx + 6, cy);
  ctx.lineTo(cx + 16, cy);
  ctx.moveTo(cx, cy - 16);
  ctx.lineTo(cx, cy - 6);
  ctx.moveTo(cx, cy + 6);
  ctx.lineTo(cx, cy + 16);
  ctx.stroke();

  if (game.nextRingScreen) {
    const n = game.nextRingScreen;
    const dx = n.x - plane.pos.x;
    const dy = n.y - plane.pos.y;
    const dz = n.z - plane.pos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const text = n.runway ? `RUNWAY ${Math.round(dist)}m` : `${n.fuel ? 'FUEL ' : ''}RING ${Math.round(dist)}m`;
    label(ctx, text, cx, cy - 40, 13, n.runway ? '#ffffff' : n.fuel ? '#3ddc78' : '#ffb02e', 'center');
  }

  // Warnings, flashing under the compass.
  if (warnings.length > 0 && Math.sin(time * 9) > -0.2) {
    const text = warnings.join('  ·  ');
    ctx.font = '700 20px system-ui, sans-serif';
    const w = ctx.measureText(text).width + 32;
    panel(ctx, cx - w / 2, 66, w, 34, 0.65);
    label(ctx, text, cx, 89, 15, '#ff6a55', 'center');
  }

  // Mission banner, fading in the first seconds of a sortie.
  if (game.bannerUntil > time) {
    const alpha = clamp((game.bannerUntil - time) / 1.2, 0, 1);
    ctx.globalAlpha = alpha;
    panel(ctx, cx - 260, 116, 520, 54, 0.6);
    value(ctx, mission.name, cx, 140, 20, '#ffffff', 'center');
    label(ctx, mission.subtitle, cx, 160, 12, '#ffb02e', 'center');
    ctx.globalAlpha = 1;
  }
}

/** A centred dark panel with a title, used by every menu screen. Long lines wrap. */
export function menuPanel(ctx, title, lines, footer) {
  const wrapped = [];
  for (const line of lines) {
    const text = typeof line === 'string' ? line : String(line);
    const color = typeof line === 'object' && line.color ? line.color : '#d7e2f0';
    const words = text.split(' ');
    let cur = '';
    for (const w of words) {
      if ((cur + ' ' + w).trim().length > 72) {
        wrapped.push({ text: cur.trim(), color });
        cur = w;
      } else {
        cur = (cur + ' ' + w).trim();
      }
    }
    if (cur) wrapped.push({ text: cur, color });
  }
  const w = 640;
  const h = 150 + wrapped.length * 30 + (footer ? 40 : 0);
  const x = VIEW_W / 2 - w / 2;
  const y = VIEW_H / 2 - h / 2;
  ctx.fillStyle = 'rgba(6,10,22,0.78)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 14);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,176,46,0.55)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  value(ctx, title, VIEW_W / 2, y + 48, 30, '#ffffff', 'center');
  let ly = y + 88;
  for (const line of wrapped) {
    label(ctx, line.text, VIEW_W / 2, ly, 15, line.color, 'center');
    ly += 30;
  }
  if (footer) {
    label(ctx, footer, VIEW_W / 2, y + h - 18, 13, '#ffb02e', 'center');
  }
  return { x, y, w, h };
}

/** The title screen: name, aeroplane line, mission list and controls. */
export function drawTitle(ctx, time) {
  // Warm vignette so the text reads over the valley.
  const g = ctx.createRadialGradient(VIEW_W / 2, VIEW_H * 0.42, 60, VIEW_W / 2, VIEW_H * 0.42, 560);
  g.addColorStop(0, 'rgba(6,10,22,0.55)');
  g.addColorStop(1, 'rgba(6,10,22,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffb02e';
  ctx.font = '700 15px system-ui, sans-serif';
  ctx.fillText('A  B U S H - P L A N E  S T O R Y', VIEW_W / 2, 108);
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 84px system-ui, sans-serif';
  ctx.fillText('SKYCOURIER', VIEW_W / 2, 188);
  ctx.fillStyle = '#ffb02e';
  ctx.font = '600 24px system-ui, sans-serif';
  ctx.fillText('— Valley Run —', VIEW_W / 2, 226);

  const missions = [
    '1 · VALLEY RUN — ten rings down the morning valley',
    '2 · KESTREL PASS — twelve rings over the ridge at golden hour',
    '3 · NIGHT COURIER — ten lit rings, then land at Tarn Field',
  ];
  missions.forEach((m, i) => {
    const y = 292 + i * 30;
    ctx.fillStyle = 'rgba(6,10,22,0.6)';
    ctx.beginPath();
    ctx.roundRect(VIEW_W / 2 - 330, y - 20, 660, 26, 6);
    ctx.fill();
    ctx.fillStyle = '#e8eef7';
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.fillText(m, VIEW_W / 2, y - 2);
  });

  const blink = Math.sin(time * 3.4) > -0.3;
  ctx.fillStyle = blink ? '#ffffff' : 'rgba(255,255,255,0.35)';
  ctx.font = '700 19px system-ui, sans-serif';
  ctx.fillText('PRESS 1, 2 OR 3 TO FLY  ·  OR CLICK TO START', VIEW_W / 2, 442);
  ctx.fillStyle = '#c8d4e6';
  ctx.font = '500 14px system-ui, sans-serif';
  ctx.fillText('Arrows / WASD — fly ·  Shift / Ctrl — throttle ·  Mouse or touch — steer', VIEW_W / 2, 480);
  ctx.fillText('P — pause ·  M — sound ·  R — restart the sortie', VIEW_W / 2, 504);
  ctx.fillStyle = '#8fa2bd';
  ctx.font = '500 12px system-ui, sans-serif';
  ctx.fillText('An original game, built for make.fun — no borrowed planes, places or music.', VIEW_W / 2, 690);
}
