import * as THREE from 'three';
import { rand, TAU } from '../core/math';
import { fitToHeight, instance, loadModel } from './models';
import { arenaRadiusFor, BIOMES, type Biome } from './biome';
import { layMarble, marble, whenMarbleReady } from './marble';

/**
 * Current arena radius. Mutable because the room is rebuilt when the party size
 * or the region changes; read it through `arenaRadius()` so nothing caches a
 * stale value across a rebuild.
 */
let radius = arenaRadiusFor(1);
export const arenaRadius = () => radius;

/** A torch: point light + a billboarded flame quad, cheap enough to have eight of them. */
interface Torch {
  light: THREE.PointLight;
  flame: THREE.Sprite;
  phase: number;
  base: number;
  /** Resting sprite size, so the flicker scales the flame instead of setting it. */
  scale: number;
}

export class Arena {
  readonly group = new THREE.Group();
  private torches: Torch[] = [];
  /** Wall segments, with the point on each that decides whether it is in the way. */
  private occluders: { obj: THREE.Object3D; probe: THREE.Vector3 }[] = [];
  private t = 0;
  private biome: Biome = BIOMES[0];
  private built = '';

  constructor(private scene: THREE.Scene) {
    this.rebuild(BIOMES[0], 1);
  }

  /**
   * Tear the room down and lay it out again for a region and a party size.
   * Cheap enough to do between chambers (a fraction of a second) and far simpler
   * than trying to mutate every material and vertex in place.
   */
  rebuild(biome: Biome, playerCount: number) {
    const want = `${biome.id}:${playerCount}`;
    if (want === this.built) return;
    this.built = want;
    this.biome = biome;
    radius = arenaRadiusFor(playerCount);

    this.dispose();
    this.buildFloor();
    this.buildWalls();
    this.buildTorches();
    this.applySky();
  }

  private dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      // Cloned model instances share geometry with the cached source, so only
      // their material — which this class made — may be released.
      if (m.geometry && !m.userData?.sharedGeometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.group.clear();
    this.torches = [];
    this.occluders = [];
  }

  private applySky() {
    this.scene.fog = new THREE.FogExp2(this.biome.fog, 0.016);
    (this.scene.background as THREE.Color) = new THREE.Color(this.biome.background);
  }

  get name() {
    return this.biome.name;
  }

  private buildFloor() {
    const b = this.biome;
    const geo = new THREE.CircleGeometry(radius, 96);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      map: makeFloorTexture(b),
      color: 0xffffff,
      roughness: 0.86,
      metalness: 0.04,
    });
    const floor = new THREE.Mesh(geo, mat);
    floor.receiveShadow = true;
    this.group.add(floor);
    this.repaintWhenMarbleArrives(mat, () => makeFloorTexture(b));

    // Ground beyond the arena. With the near wall culled away the camera looks
    // straight past the edge, and pure black void there reads as a hole in the
    // render rather than as depth. Dark, matte, and the fog does the rest.
    const outer = new THREE.Mesh(
      new THREE.RingGeometry(radius - 0.1, radius + 26, 64, 1).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: b.fog, roughness: 1 })
    );
    outer.position.y = -0.6;
    outer.receiveShadow = true;
    this.group.add(outer);

    // A lip around the arena so the floor ends on an edge, not in mid-air.
    const lip = new THREE.Mesh(
      new THREE.CylinderGeometry(radius + 0.15, radius - 0.4, 0.75, 64, 1, true),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(b.wallBase),
        roughness: 0.95,
        side: THREE.DoubleSide,
      })
    );
    lip.position.y = -0.36;
    this.group.add(lip);
  }

  private buildWalls() {
    const b = this.biome;
    const wallMat = new THREE.MeshStandardMaterial({
      map: makeWallTexture(b),
      roughness: 0.95,
      side: THREE.DoubleSide,
    });
    this.repaintWhenMarbleArrives(wallMat, () => makeWallTexture(b));

    // The wall is built in segments rather than one cylinder so the near side can
    // be culled away like the columns. A solid ring wall reads as a black mass
    // across the bottom of the frame the moment the camera drops.
    const SEGMENTS = 16;
    for (let i = 0; i < SEGMENTS; i++) {
      const start = (i / SEGMENTS) * TAU;
      const seg = new THREE.Mesh(
        new THREE.CylinderGeometry(radius + 0.4, radius + 0.9, 6, 6, 1, true, start, TAU / SEGMENTS),
        wallMat
      );
      seg.castShadow = true;
      seg.receiveShadow = true;
      seg.position.set(0, 3, 0);
      this.group.add(seg);
      const mid = start + TAU / SEGMENTS / 2;
      this.occluders.push({
        obj: seg,
        probe: new THREE.Vector3(Math.cos(mid) * (radius + 0.65), 1.5, Math.sin(mid) * (radius + 0.65)),
      });
    }

    // More columns in a bigger room, so the spacing between them stays constant.
    const count = Math.max(8, Math.round(radius / 1.45));
    // The columns are the one thing in the room cut from white marble — the
    // biome colour stays as the tint the map is multiplied by, so a column still
    // belongs to its region instead of being a white post in a red hall.
    const pillarMat = new THREE.MeshStandardMaterial({
      color: b.pillar,
      roughness: 0.78,
      map: makeColumnTexture(),
    });
    this.repaintWhenMarbleArrives(pillarMat, () => makeColumnTexture());
    const placeholders: THREE.Mesh[] = [];
    const spots: [number, number][] = [];
    const pillarGeo = new THREE.CylinderGeometry(0.5, 0.62, 6.5, 14);

    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + 0.39;
      const x = Math.cos(a) * (radius - 0.5);
      const z = Math.sin(a) * (radius - 0.5);
      spots.push([x, z]);
      const p = new THREE.Mesh(pillarGeo, pillarMat);
      p.position.set(x, 3.25, z);
      p.castShadow = true;
      p.receiveShadow = true;
      placeholders.push(p);
      this.group.add(p);
    }

    const token = this.built;
    loadModel('/models/pillar.glb')
      .then((src) => {
        // A rebuild may have happened while the asset was in flight.
        if (token !== this.built) return;
        for (const p of placeholders) this.group.remove(p);
        for (const [x, z] of spots) {
          const col = instance(src, pillarMat);
          fitToHeight(col, 6.6);
          col.position.x = x;
          col.position.z = z;
          col.rotation.y = rand(0, TAU);
          this.group.add(col);
        }
      })
      .catch(() => {
        /* keep the placeholders if the asset is missing */
      });
  }

  private buildTorches() {
    const b = this.biome;
    // brazier.glb is a fire bowl on a tripod — a floor-standing prop, so it is
    // sized to one and left on the ground. It used to be stretched to 2.6 units,
    // which at its proportions is 2.48 across: a boulder floating half a metre
    // up, overlapping a column that stood 0.6 away. The flame follows the rim
    // rather than a hardcoded height, so the two can never drift apart again.
    const BRAZIER_H = 1.7;
    const RIM = BRAZIER_H;
    // Sized to the bowl it sits in, not to the old floating one.
    const FLAME_SCALE = 1.15;
    // Alternating fire: a majority flame and a cold accent. A room lit by a
    // single hue is the fastest way to look flat, however bright it gets.
    const warmTex = makeGlowTexture('#' + b.flameWarm.toString(16).padStart(6, '0'));
    const coldTex = makeGlowTexture('#' + b.flameCool.toString(16).padStart(6, '0'));
    const count = Math.max(8, Math.round(radius / 1.45));
    const ironMat = new THREE.MeshStandardMaterial({
      color: 0x3a2a1e,
      roughness: 0.65,
      metalness: 0.5,
    });
    const bowls: THREE.Mesh[] = [];
    const bowlSpots: [number, number][] = [];

    for (let i = 0; i < count; i++) {
      /*
       * One brazier per column, standing in front of it rather than beside it.
       *
       * The obvious fix for a brazier overlapping a column is to put it in the
       * gap between two — but the gaps are where the doors are. `Gate.show`
       * measures its angle as `x = sin(a), z = cos(a)`, a quarter turn from the
       * convention here, and half a step round from the columns lands exactly on
       * it: every one of the five door positions had a brazier 0.3 units from
       * its centre, standing in the opening.
       *
       * So the angle goes back to the column's and the clearance is taken
       * radially instead. 3.2 in from the rim puts 2.7 between the two axes,
       * against 2.26 of combined width.
       */
      const a = (i / count) * TAU + 0.39;
      const x = Math.cos(a) * (radius - 3.2);
      const z = Math.sin(a) * (radius - 3.2);
      const cold = i % 3 === 1;

      const light = new THREE.PointLight(cold ? b.flameCool : b.flameWarm, cold ? 7 : 11, 15, 2);
      light.position.set(x, RIM + 0.5, z);
      this.group.add(light);

      const flame = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: cold ? coldTex : warmTex,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
        })
      );
      flame.position.set(x, RIM + 0.3, z);
      flame.scale.setScalar(FLAME_SCALE);
      this.group.add(flame);

      // A placeholder bowl until the Blender brazier loads, so the flame is
      // always sitting on something. Parked at the same rim height the real one
      // will occupy, so nothing jumps when the asset lands.
      const bowl = new THREE.Mesh(
        new THREE.CylinderGeometry(0.34, 0.16, 0.36, 10),
        ironMat
      );
      bowl.position.set(x, RIM - 0.18, z);
      bowl.castShadow = true;
      this.group.add(bowl);
      bowls.push(bowl);
      bowlSpots.push([x, z]);

      this.torches.push({
        light,
        flame,
        phase: rand(0, TAU),
        base: cold ? 7 : 11,
        scale: FLAME_SCALE,
      });
    }

    // Swap the placeholder bowls for the Blender brazier once it arrives.
    const token = this.built;
    loadModel('/models/brazier.glb')
      .then((src) => {
        if (token !== this.built) return;
        for (const bowl of bowls) this.group.remove(bowl);
        for (const [x, z] of bowlSpots) {
          const br = instance(src, ironMat);
          fitToHeight(br, BRAZIER_H);
          // x and z only, exactly as the columns do it: fitToHeight has already
          // written the y that stands the model on the floor, and `position.set`
          // would throw that away — which is how this one ended up hovering.
          br.position.x = x;
          br.position.z = z;
          this.group.add(br);
        }
      })
      .catch(() => {
        /* placeholders stay if the asset is missing */
      });
  }

  /**
   * Re-paint a surface once the marble photographs land.
   *
   * The room is built on frame zero and rebuilt between chambers, so nothing
   * here may wait on a network round-trip: every surface is painted procedurally
   * first and swapped for the veined version the moment the slab is decoded. The
   * build token guards against a rebuild having happened in the meantime, and
   * the texture caches are keyed on whether marble was available, so this asks
   * for a genuinely different texture rather than the cached flat one.
   */
  private repaintWhenMarbleArrives(
    mat: THREE.MeshStandardMaterial,
    paint: () => THREE.Texture
  ) {
    if (marble('black')) return;
    const token = this.built;
    whenMarbleReady().then(() => {
      if (token !== this.built || !marble('black')) return;
      mat.map = paint();
      mat.needsUpdate = true;
    });
  }

  /**
   * Hide the near arc of the wall, and nothing else.
   *
   * The columns, braziers and flames used to be culled the same way, and the
   * result was that walking towards the rim made the near columns pop into
   * existence one at a time — the threshold moves with the camera, so a column
   * crossed it while the player was still several metres short of it. The room
   * is meant to read as one space, so the architecture now stays on screen and
   * a column standing briefly in front of a player at the rim is accepted.
   *
   * The wall is the one thing that cannot stay: it is a closed ring, so the near
   * segment is always between the camera and the fight, and at this camera pitch
   * it fills the bottom of the frame with a black mass. Segments swap out behind
   * the columns, where the eye is not looking.
   *
   * Measured against the camera, not the focus point: a threshold based on the
   * focus drifts with the players and lets the near wall creep back in.
   */
  cullOccluders(camera: THREE.Object3D, focus: THREE.Vector3) {
    const focusDist = camera.position.distanceTo(focus);
    for (const o of this.occluders) {
      o.obj.visible = camera.position.distanceTo(o.probe) > focusDist - 1.5;
    }
  }

  update(dt: number) {
    this.t += dt;
    for (const t of this.torches) {
      const f = 0.78 + Math.sin(this.t * 9 + t.phase) * 0.12 + Math.sin(this.t * 23 + t.phase) * 0.07;
      t.light.intensity = t.base * f;
      t.flame.scale.setScalar(t.scale * (0.9 + f * 0.24));
    }
  }
}

/**
 * Painted underworld stone, drawn once to a canvas: a warm base, cool mottling,
 * cracks, and a mosaic ring. Procedural, but it gives the floor the hand-painted
 * density that a flat MeshStandardMaterial can never have.
 */
const floorCache = new Map<string, THREE.Texture>();
const wallCache = new Map<string, THREE.Texture>();

/**
 * Cached per region. Painting the floor is ~900 radial gradients on a 1024²
 * canvas — a one-off 150ms hitch the first time, and there are only three
 * regions, so every later visit is free.
 */
export function makeFloorTexture(b: Biome, size = 1024): THREE.Texture {
  // Keyed on the slab too: the pre-marble painting and the veined one are two
  // different textures for the same region, and the first must not shadow the
  // second in the cache.
  const key = `${b.id}|${marble('black') ? 'm' : 'flat'}`;
  const hit = floorCache.get(key);
  if (hit) return hit;
  const tex = buildFloorTexture(b, size);
  floorCache.set(key, tex);
  return tex;
}

function buildFloorTexture(b: Biome, size: number): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;

  ctx.fillStyle = b.floorBase;
  ctx.fillRect(0, 0, size, size);

  /*
   * Broad mottling: overlapping soft blobs in two families, warm and cool.
   *
   * Lifted eight points since the mosaic rings came out. Those rings were the
   * only large, bright thing on the floor, and with them gone the stone
   * underneath had to carry the whole surface on its own — at a mean luminance
   * of 37/255 it read as flat black from the gameplay camera however good it
   * looked up close.
   */
  for (let i = 0; i < 900; i++) {
    const x = rand(0, size);
    const y = rand(0, size);
    const r = rand(size * 0.01, size * 0.09);
    const warm = Math.random() < 0.55;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const range = warm ? b.warmHue : b.coolHue;
    const h = rand(range[0], range[1]);
    const l = warm ? rand(32, 50) : rand(24, 38);
    g.addColorStop(0, `hsla(${h}, ${warm ? 34 : 26}%, ${l}%, 0.5)`);
    g.addColorStop(1, `hsla(${h}, 30%, ${l}%, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  /*
   * The black slab, laid over the painted ground. Two passes: `overlay` sinks
   * the stone's own depth into the biome colour without repainting the floor
   * black, then a `screen` pass brings the gold veining back — overlay alone
   * flattens the brightest part of a vein into the base and the gold vanishes.
   *
   * The slab is now the floor's only large-scale feature, so it is tiled 1.3
   * times across rather than 2 — bigger veins, which is what survives the
   * distance to the gameplay camera — and the two weights are rebalanced
   * towards the screen pass so the gold actually shows.
   */
  layMarble(ctx, 'black', size, size, { tile: 1.3, alpha: 0.4, mode: 'overlay' });
  layMarble(ctx, 'black', size, size, { tile: 1.3, alpha: 0.32, mode: 'screen' });

  // Cracks: short branching dark strokes, the thing that sells "ancient".
  ctx.strokeStyle = 'rgba(10,5,14,0.6)';
  for (let i = 0; i < 70; i++) {
    let x = rand(0, size);
    let y = rand(0, size);
    let a = rand(0, TAU);
    ctx.lineWidth = rand(1, 3);
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 7; s++) {
      a += rand(-0.7, 0.7);
      x += Math.cos(a) * rand(6, 26);
      y += Math.sin(a) * rand(6, 26);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * The surrounding wall. Dark at the top so the room fades into the underworld
 * void, warmer and busier at floor level where the light actually reaches.
 */
export function makeWallTexture(b: Biome, w = 1024, h = 256): THREE.Texture {
  const key = `${b.id}|${marble('black') ? 'm' : 'flat'}`;
  const hit = wallCache.get(key);
  if (hit) return hit;
  const tex = buildWallTexture(b, w, h);
  wallCache.set(key, tex);
  return tex;
}

function buildWallTexture(b: Biome, w: number, h: number): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;

  // Cylinder UVs run top-to-bottom, so y=0 is the top of the wall.
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, b.wallTop);
  g.addColorStop(0.45, b.wallMid);
  g.addColorStop(1, b.wallBase);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  /*
   * The same black slab as the floor, but weaker and stretched wider: the wall
   * is 1024×256 repeated three times around the room, so a square tile would
   * read as an obvious grid. Kept faint because the top of the wall is supposed
   * to fade into the void, and veining up there fights the fog.
   */
  layMarble(ctx, 'black', w, h, { tile: 3, alpha: 0.32, mode: 'overlay' });
  layMarble(ctx, 'black', w, h, { tile: 3, alpha: 0.2, mode: 'screen' });

  ctx.strokeStyle = 'rgba(8,4,12,0.55)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 64; i++) {
    const x = (i / 64) * w + rand(-3, 3);
    ctx.beginPath();
    ctx.moveTo(x, h * rand(0.3, 0.5));
    ctx.lineTo(x + rand(-6, 6), h);
    ctx.stroke();
  }
  for (let row = 0; row < 4; row++) {
    const y = h * (0.45 + row * 0.14);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Blind arches along the base — the silhouette that says "architecture".
  ctx.fillStyle = 'rgba(10,5,14,0.6)';
  for (let i = 0; i < 16; i++) {
    const cx = ((i + 0.5) / 16) * w;
    ctx.beginPath();
    ctx.moveTo(cx - 20, h);
    ctx.lineTo(cx - 20, h * 0.72);
    ctx.arc(cx, h * 0.72, 20, Math.PI, 0);
    ctx.lineTo(cx + 20, h);
    ctx.fill();
  }

  ctx.fillStyle = b.gild + '88';
  ctx.fillRect(0, h * 0.6, w, 5);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(3, 1);
  return tex;
}

/**
 * White marble for the columns, shared by every region — the biome tints it
 * through the material's own colour, so one texture serves all three.
 *
 * Flutes are drawn in rather than modelled: the column is a 14-sided cylinder
 * (or the Blender mesh, which is not fluted either), and a few vertical shadows
 * in the map cost nothing and read from across the room.
 */
let columnTex: THREE.Texture | null = null;
let columnHadMarble = false;

export function makeColumnTexture(size = 512): THREE.Texture {
  const has = !!marble('white');
  if (columnTex && columnHadMarble === has) return columnTex;

  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;

  ctx.fillStyle = '#ded6c6';
  ctx.fillRect(0, 0, size, size);
  layMarble(ctx, 'white', size, size, { tile: 1, alpha: 0.95 });

  // Flutes. The map wraps once around the shaft, so the spacing here is the
  // spacing on the stone.
  ctx.strokeStyle = 'rgba(58,50,42,0.24)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 12; i++) {
    const x = ((i + 0.5) / 12) * size;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }

  // Soot climbing the base — nothing in the underworld stays clean.
  const grime = ctx.createLinearGradient(0, size, 0, size * 0.55);
  grime.addColorStop(0, 'rgba(18,13,10,0.5)');
  grime.addColorStop(1, 'rgba(18,13,10,0)');
  ctx.fillStyle = grime;
  ctx.fillRect(0, 0, size, size);

  columnTex?.dispose();
  columnTex = new THREE.CanvasTexture(c);
  columnTex.colorSpace = THREE.SRGBColorSpace;
  columnTex.wrapS = THREE.RepeatWrapping;
  columnTex.anisotropy = 8;
  columnHadMarble = has;
  return columnTex;
}

/**
 * Radial-gradient sprite texture — used for flames, glows and impact flashes.
 *
 * Cached by colour. These used to be built per projectile, which meant a boss
 * volley allocated a canvas and a GPU texture per bolt and never freed them —
 * texture count climbed for as long as the fight lasted.
 */
const glowCache = new Map<string, THREE.Texture>();

export function makeGlowTexture(color: string, softness = 0.5): THREE.Texture {
  const key = `${color}|${softness}`;
  const hit = glowCache.get(key);
  if (hit) return hit;
  const tex = buildGlowTexture(color, softness);
  glowCache.set(key, tex);
  return tex;
}

function buildGlowTexture(color: string, softness: number): THREE.Texture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, color);
  g.addColorStop(softness, hexWithAlpha(color, 0.55));
  g.addColorStop(1, hexWithAlpha(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function hexWithAlpha(hex: string, a: number) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
