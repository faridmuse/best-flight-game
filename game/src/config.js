// Game-wide constants and the three missions of Skycourier: Valley Run.
// One file holds every number a designer would tune: the flight model, the
// scoring, and each mission's sky, course and fuel. Nothing here reads the
// clock or the network, so a mission is the same every time it is flown.

export const VIEW_W = 1280;
export const VIEW_H = 720;

export const FLIGHT = {
  maxSpeed: 165, // units per second at full throttle
  cruiseSpeed: 118,
  stallSpeed: 52, // below this the wing stops flying
  maxRollDeg: 58, // bank angle at full stick
  maxPitchDeg: 26, // climb/dive angle at full stick
  rollRate: 150, // degrees per second towards the commanded bank
  pitchRate: 90, // degrees per second towards the commanded pitch
  throttleRate: 0.55, // throttle units per second
  turnRate: 0.85, // yaw degrees per second per degree of bank, scaled by speed
  gravitySink: 26, // sink rate when stalled, units per second
  fuelDrain: 0.5, // fuel units per second at full throttle
  fuelStart: 100,
  ringRadius: 26, // metres of a target ring
  ringScore: 100, // points for flying a ring
  ringCenterBonus: 50, // extra for threading the middle third
  fuelRingScore: 25,
  fuelRingRefill: 35,
  landingScore: 500,
  timeBonusPerSecond: 8, // mission-end bonus per second under par
};

export const CAMERA = {
  focal: 720, // projection focal length in pixels
  back: 20, // metres behind the aircraft
  up: 7, // metres above the aircraft
  rollFollow: 0.45, // how much of the bank the camera takes
  pitchFollow: 0.5,
  smoothing: 5.5, // per-second lerp of the camera towards its target
};

/**
 * A mission: its sky, its course and its rules.
 * timeOfDay: 'day' | 'golden' | 'night' — changes the palette, the sun and
 * whether the runway lights are on.
 */
export const MISSIONS = [
  {
    id: 1,
    name: 'Valley Run',
    subtitle: 'A morning delivery down Aurel Valley',
    timeOfDay: 'day',
    seed: 11,
    rings: 10,
    wind: 0,
    fuel: 100,
    parSeconds: 150,
    requireLanding: false,
    briefing:
      'Thread all ten rings down the valley. Green rings are fuel — take one when the gauge runs low. Mind the hills: the ground is not your friend.',
  },
  {
    id: 2,
    name: 'Kestrel Pass',
    subtitle: 'Over the ridge at golden hour',
    timeOfDay: 'golden',
    seed: 23,
    rings: 12,
    wind: 6,
    fuel: 100,
    parSeconds: 190,
    requireLanding: false,
    briefing:
      'The pass climbs high and the evening wind gusts across it. Rings six to nine thread the gap between the peaks — keep your speed up and your turns tidy.',
  },
  {
    id: 3,
    name: 'Night Courier',
    subtitle: 'Last mail to Tarn Field, after dark',
    timeOfDay: 'night',
    seed: 37,
    rings: 10,
    wind: 3,
    fuel: 90,
    parSeconds: 200,
    requireLanding: true,
    briefing:
      'Fly the lit rings to Tarn Field and put her down on the runway. Line up straight, throttle back, and flare — a hard touchdown bends the aeroplane.',
  },
];

export const SKY = {
  day: {
    top: '#2f6fd0',
    mid: '#7db3e8',
    horizon: '#cfe6f5',
    sun: '#fff3c4',
    sunX: 0.78,
    sunY: 0.2,
    ridgeFar: '#8fa8c8',
    ridgeNear: '#5d7a9e',
    groundBase: '#7da95c',
    fog: '#cfe6f5',
    cloud: '255,255,255',
    night: false,
  },
  golden: {
    top: '#3a4a8a',
    mid: '#e08a4e',
    horizon: '#f7c98a',
    sun: '#ffdf9e',
    sunX: 0.5,
    sunY: 0.42,
    ridgeFar: '#7a6a9e',
    ridgeNear: '#4c3f66',
    groundBase: '#8a7a4e',
    fog: '#f2c184',
    cloud: '255,214,170',
    night: false,
  },
  night: {
    top: '#060a1c',
    mid: '#101a3a',
    horizon: '#2c3a5e',
    sun: '#e8ecff',
    sunX: 0.22,
    sunY: 0.16,
    ridgeFar: '#1c2745',
    ridgeNear: '#121a30',
    groundBase: '#1d2f22',
    fog: '#232f4a',
    cloud: '160,170,210',
    night: true,
  },
};

/** Field patchwork colours, picked per ground cell by a hash. */
export const FIELD_COLORS = {
  day: ['#7da95c', '#8fb468', '#6b9e52', '#a8a35a', '#93b25e', '#5d9150', '#b5a75e'],
  golden: ['#8a7a4e', '#977f52', '#7d6f45', '#a88f56', '#8f7d4a', '#6f6240'],
  night: ['#1d2f22', '#223726', '#182a1e', '#263b2a', '#1a2d20'],
};

export const RIVER_COLOR = {
  day: '#5fa8d8',
  golden: '#c98a5a',
  night: '#2c4a6e',
};
