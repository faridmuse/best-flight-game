// Input: keyboard, mouse and touch, all feeding one small state object.
// Arrow keys / WASD fly the plane, Shift/Ctrl work the throttle, P pauses,
// M mutes, R restarts. The mouse steers by position; touch drags do the same.

import { clamp } from './random.js';

export function createInput(canvas) {
  const input = {
    keys: new Set(),
    roll: 0, // -1..1, from keys or pointer
    pitch: 0, // -1..1
    throttleUp: false,
    throttleDown: false,
    pointerActive: false,
    pointerX: 0.5, // 0..1 across the screen
    pointerY: 0.5, // 0..1 down the screen
    pressed: new Set(), // keys pressed since last read (edge-triggered)
  };

  const KEYMAP = {
    ArrowLeft: 'left',
    KeyA: 'left',
    ArrowRight: 'right',
    KeyD: 'right',
    ArrowUp: 'up',
    KeyW: 'up',
    ArrowDown: 'down',
    KeyS: 'down',
    ShiftLeft: 'throttleUp',
    ShiftRight: 'throttleUp',
    ControlLeft: 'throttleDown',
    ControlRight: 'throttleDown',
    KeyP: 'pause',
    KeyM: 'mute',
    KeyR: 'restart',
    Enter: 'confirm',
    Space: 'confirm',
    Digit1: 'mission1',
    Digit2: 'mission2',
    Digit3: 'mission3',
  };

  function onKeyDown(e) {
    const name = KEYMAP[e.code];
    if (!name) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
    if (!e.repeat) input.pressed.add(name);
    input.keys.add(name);
  }
  function onKeyUp(e) {
    const name = KEYMAP[e.code];
    if (name) input.keys.delete(name);
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => input.keys.clear());

  function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: clamp((e.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((e.clientY - rect.top) / rect.height, 0, 1),
    };
  }
  canvas.addEventListener('pointerdown', (e) => {
    const p = pointerPos(e);
    input.pointerActive = true;
    input.pointerX = p.x;
    input.pointerY = p.y;
    input.pressed.add('confirm');
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!input.pointerActive) return;
    const p = pointerPos(e);
    input.pointerX = p.x;
    input.pointerY = p.y;
  });
  canvas.addEventListener('pointerup', () => {
    input.pointerActive = false;
  });
  canvas.addEventListener('pointercancel', () => {
    input.pointerActive = false;
  });

  /** Recompute the analogue stick values from keys and pointer. Call each frame. */
  input.update = function update() {
    let roll = 0;
    let pitch = 0;
    if (input.keys.has('left')) roll -= 1;
    if (input.keys.has('right')) roll += 1;
    if (input.keys.has('up')) pitch += 1;
    if (input.keys.has('down')) pitch -= 1;
    if (input.pointerActive) {
      // Pointer steers relative to screen centre: right banks right,
      // up pushes the nose down (like a stick).
      roll += clamp((input.pointerX - 0.5) * 2.4, -1, 1);
      pitch += clamp((0.5 - input.pointerY) * 2.4, -1, 1);
    }
    input.roll = clamp(roll, -1, 1);
    input.pitch = clamp(pitch, -1, 1);
    input.throttleUp = input.keys.has('throttleUp');
    input.throttleDown = input.keys.has('throttleDown');
  };

  /** True once for a key pressed since the last frame; consumes the press. */
  input.wasPressed = function wasPressed(name) {
    if (input.pressed.has(name)) {
      input.pressed.delete(name);
      return true;
    }
    return false;
  };

  /** Clear edge-triggered presses (call at the end of each frame). */
  input.endFrame = function endFrame() {
    input.pressed.clear();
  };

  return input;
}
