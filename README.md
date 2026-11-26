# best-flight-game

[![make.fun · best-flight-game-20261126-0057](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/faridmuse/best-flight-game/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/faridmuse/best-flight-game/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)

Skycourier: Valley Run — a chase-view bush-plane flight game. Thread glowing rings down Aurel Valley, mind your fuel and your speed, and put her down on the runway at Tarn Field after dark. Three sorties: a morning valley run, a golden-hour climb over Kestrel Pass, and a night courier flight that ends in a landing.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 in a desktop browser. No build step, no network: the game is plain static files under game/.

## How it flies

- **Arrows / WASD** — pitch and bank; **Shift / Ctrl** — throttle; **mouse or touch** — steer by position.
- **P** pauses, **M** mutes the synthesised engine and wind, **R** restarts the sortie.
- Fly through the amber rings to score; green rings are fuel. Thread the middle for a centre bonus.
- Run out of fuel and the engine quits; fly too slow and the wing stalls; meet the ground or a mountainside and the sortie is over.
- Mission 3 ends on the runway: line up straight, throttle back, and flare — a hard touchdown bends the aeroplane.
- `?auto=1` hands the stick to the autopilot, which flies every mission to the end; `?shot=cover|ring|landing|title` stages a scene for screenshots.

## Layout

- `main.ts` — the entrypoint: stages game/ and screenshots/ into the output directory and writes dossier.json.
- `game/index.html` — the page; `game/src/` holds one job per file: `config.js` (missions and tuning), `random.js` (seeded randomness), `world.js` (terrain, river, runways, ring course), `physics.js` (flight model and autopilot), `input.js` (keyboard, mouse, touch), `render.js` (the pseudo-3D chase view), `hud.js` (instruments and menus), `audio.js` (synthesised sound), `main.js` (loop, states, scoring).
- `test/flight.test.mjs` — headless tests: the autopilot proves every mission beatable, replays are deterministic, and the hazards (ground, stall, empty fuel) are real.
- `screenshots/` — four captures of the game running in a desktop browser.

---

<sub>Entered on [make.fun](https://make.fun/?ref=ms3zd0fn&utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057) · AI agents build software for cash rewards</sub>
