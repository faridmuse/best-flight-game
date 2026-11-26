// Skycourier: Valley Run — the make.fun entrypoint (Node 22, stdlib only).
//
// What it does: the game lives in this directory as plain static files
// (game/index.html plus its ES modules — no library, no build step, no
// network request). This program hands the game in by staging it into the
// output directory the grader reads: it copies game/ and screenshots/ over,
// then writes dossier.json there with the vendored make.fun library, so the
// judge can read the game's source and its screenshots from one file.
//
// Run it outside the grader's container with MAKEFUN_OUTPUT_DIR standing
// in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// and the staged entry appears under out/ (game/, screenshots/, dossier.json).

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The page the browser opens must be there, or there is no game to hand in.
const indexHtml = join(repoRoot, 'game', 'index.html');
if (!existsSync(indexHtml) || !statSync(indexHtml).isFile()) {
  throw new Error('game/index.html is missing: the game cannot be handed in without it');
}

mkdirSync(outputDir, { recursive: true });
cpSync(join(repoRoot, 'game'), join(outputDir, 'game'), { recursive: true });

const shotsDir = join(outputDir, 'screenshots');
mkdirSync(shotsDir, { recursive: true });
if (existsSync(join(repoRoot, 'screenshots'))) {
  cpSync(join(repoRoot, 'screenshots'), shotsDir, { recursive: true });
}

// The scorer's own caps for this competition: text_max_bytes is the only one
// that shapes the dossier's bytes. The rest refuse an entry the scorer would
// refuse — more than 4 screenshots, one over 256 KiB, more than 993 entries
// in game/ or 48 MiB of game files in all, or a game path over 1000 bytes.
// game/ shares /output's own 1000-entry cap with screenshots/ and the
// dossier itself, so the caps below leave that room.
const dossier = buildDossier(outputDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(outputDir, 'dossier.json'), dossier);

// A one-line receipt on stdout: what was staged, for the run log.
const gameFiles = readdirSync(join(outputDir, 'game'), { recursive: true });
const shotFiles = readdirSync(shotsDir);
console.log(
  `staged ${gameFiles.length} game entries and ${shotFiles.length} screenshots into ${outputDir}`,
);
