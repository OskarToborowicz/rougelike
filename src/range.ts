/**
 * Model range — a dev-only viewer for the authored enemy meshes.
 *
 * Not part of the game boot: it reuses the real render stack (Stage, Arena) and
 * the real `Enemy`, so a model is shown here with exactly the material, skin,
 * outline and telegraph it wears in a fight — but with no World, Director or Net
 * around it. Served at /range.html in `npm run dev`; the production build only
 * takes index.html, so this ships nowhere.
 *
 *   /range.html            → Belial
 *   /range.html?model=erinys
 *   ← / →  cycle models   ·  T  telegraph  ·  Space  toggle spin
 */
import * as THREE from 'three';
import { Stage } from './render/scene';
import { Arena } from './render/arena';
import { Enemy, type EnemyKind, BOSS_PATTERNS } from './game/enemy';
import { BIOMES } from './render/biome';

/** Every kind that swaps in an authored mesh — the ones worth looking at here. */
const KINDS: EnemyKind[] = ['belial', 'erinys', 'brute', 'wretch'];

const host = document.getElementById('app')!;
const stage = new Stage(host);
const arena = new Arena(stage.scene);
stage.root.add(arena.group);

// The biome whose boss this is, so the room's light matches the fight. Falls
// back to the first region for the non-boss kinds.
const biomeFor = (k: EnemyKind) => BIOMES.find((b) => b.boss === k) ?? BIOMES[0];

let current: Enemy | null = null;
let spin = true;
let index = Math.max(0, KINDS.indexOf(pickInitial()));

function pickInitial(): EnemyKind {
  const want = new URLSearchParams(location.search).get('model') as EnemyKind | null;
  return want && KINDS.includes(want) ? want : 'belial';
}

const label = document.createElement('div');
label.style.cssText =
  'position:fixed;left:20px;bottom:18px;font:16px/1.5 Cinzel,Georgia,serif;' +
  'color:#e6dfd0;letter-spacing:.14em;text-shadow:0 2px 6px #000;pointer-events:none;z-index:10';
document.body.appendChild(label);

function show(kind: EnemyKind) {
  if (current) {
    stage.root.remove(current.mesh);
    current = null;
  }
  arena.rebuild(biomeFor(kind), 1);
  const e = new Enemy(0, kind);
  // Grounded and idle rather than mid-spawn: no world drives it out of the
  // 'spawn' rise, so start it standing.
  e.state = 'chase';
  e.pos.set(0, 0, 0);
  stage.root.add(e.mesh);
  current = e;
  const patterns = BOSS_PATTERNS[kind];
  label.innerHTML =
    `<div style="font-size:24px;font-weight:600">${kind.toUpperCase()}</div>` +
    `<div style="opacity:.7;font-size:13px;margin-top:4px">` +
    `← / →  model &nbsp;·&nbsp; ${patterns ? 'T  telegraph &nbsp;·&nbsp; ' : ''}Space  spin</div>`;
}

function cycle(step: number) {
  index = (index + step + KINDS.length) % KINDS.length;
  show(KINDS[index]);
}

addEventListener('keydown', (ev) => {
  if (ev.key === 'ArrowRight') cycle(1);
  else if (ev.key === 'ArrowLeft') cycle(-1);
  else if (ev.key === ' ') {
    spin = !spin;
    ev.preventDefault();
  } else if ((ev.key === 't' || ev.key === 'T') && current) {
    // Fire the boss telegraph so the emissive wind-up can be inspected. A
    // non-boss just glows its plain 'tell'.
    const c = current;
    c.pattern = BOSS_PATTERNS[c.kind]?.[0] ?? c.pattern;
    c.state = 'pattern';
    c.strikeDone = false;
    c.stateT = 0;
    setTimeout(() => {
      if (current === c) c.state = 'chase';
    }, 2000);
  }
});

// Frame whatever the current mesh actually measures — the authored body pops in
// async and is taller than the primitive rig it replaces, so this re-fits every
// frame rather than guessing a height up front. Direction mirrors the game's
// own down-and-back camera.
const box = new THREE.Box3();
const centre = new THREE.Vector3();
const size = new THREE.Vector3();
const dir = new THREE.Vector3(0, 0.82, 0.92).normalize();

function frame() {
  if (!current) return;
  box.setFromObject(current.mesh);
  if (!isFinite(box.min.y)) return;
  box.getCenter(centre);
  box.getSize(size);
  const reach = Math.max(size.x, size.y, size.z);
  const dist = reach / (2 * Math.tan((stage.camera.fov * Math.PI) / 360)) + reach * 0.9;
  stage.camera.position.copy(centre).addScaledVector(dir, dist);
  stage.camera.lookAt(centre);
}

let last = performance.now();
function loop(now: number) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (current) {
    if (spin) current.facing += dt * 0.6;
    current.tick(dt);
  }
  frame();
  stage.render();
}

show(KINDS[index]);
requestAnimationFrame(loop);
