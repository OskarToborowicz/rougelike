import * as THREE from 'three';
import { Player, DASH } from './player';
import type { AttackShape } from './classes';
import { BOSS_PATTERNS, Enemy, type BossPattern, type EnemyKind } from './enemy';
import { separate, type Actor } from './actor';
import { arenaRadius, makeGlowTexture } from '../render/arena';
import type { FxBus } from '../render/fxbus';
import type { Frame } from '../core/input';
import { angleDelta, clamp, damp, rand, TAU } from '../core/math';
import { GODS } from './boons';

/**
 * A bolt: solid core, additive glow shell, and its own light. A bare sphere at
 * this camera angle reads as a UI dot sitting on the image rather than an object
 * flying through the room.
 */
function makeBolt(core: number, radius: number, glow: string, coreTint = 0xffffff): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 12, 10),
    new THREE.MeshBasicMaterial({ color: coreTint })
  );
  const shell = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeGlowTexture(glow, 0.3),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    })
  );
  shell.scale.setScalar(radius * 7);
  // No PointLight here on purpose — see Stage.lightBolts. A light per bolt makes
  // the renderer recompile every material each time one spawns or dies.
  mesh.add(shell);
  mesh.userData.glowColor = core;
  return mesh;
}

/** Blend a colour toward white, for hot cores that keep their hue. */
function lighten(hex: number, t: number) {
  const c = new THREE.Color(hex);
  c.lerp(new THREE.Color(0xffffff), t);
  return c.getHex();
}

export interface Projectile {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  radius: number;
  damage: number;
  team: 'player' | 'enemy';
  life: number;
  pierce: number;
  hit: Set<number>;
  color: number;
  /** CSS colour for the particle trail this bolt leaves behind, if any. */
  trail?: string;
  /** Who fired it — boons, lifesteal and crits are credited back to them. */
  owner?: Player;
  /** Splash radius on impact. Absent means a single-target hit. */
  burst?: number;
  /** Arrows point where they fly; orbs and shots tumble. */
  spin?: boolean;
  /** Seconds until this bolt is allowed to drop another trail particle. */
  trailT?: number;
}

export interface DamageEvent {
  x: number;
  z: number;
  amount: number;
  crit: boolean;
  color: string;
}

/**
 * The whole simulation: movement, the attack/dash state machines, projectiles,
 * damage, hitstop. Deterministic given the same input frames, so the co-op host
 * can run it authoritatively and ship snapshots.
 */
export class World {
  players: Player[] = [];
  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];
  damageEvents: DamageEvent[] = [];
  roomCleared = false;
  private nextId = 1;
  /** Frozen frames on a heavy connect — the single biggest source of "weight". */
  private hitstop = 0;
  private timeScale = 1;

  constructor(private scene: THREE.Object3D, private fx: FxBus) {}

  addPlayer(p: Player) {
    p.id = this.nextId++;
    this.players.push(p);
    this.scene.add(p.mesh);
    return p;
  }

  spawnEnemy(kind: EnemyKind, x: number, z: number) {
    const e = new Enemy(this.nextId++, kind);
    e.pos.set(x, 0, z);
    e.mesh.position.set(x, -1.2, z);
    this.enemies.push(e);
    this.scene.add(e.mesh);
    // Erupting out of the floor: a violet ring and rising embers. Deliberately
    // *not* red — red belongs exclusively to "an attack is about to land".
    this.fx.ring(x, z, 0x9a5cff, 1.6, 0.55);
    this.fx.bloodBurst(x, z, '#a86cff', 0.6);
    return e;
  }

  clearEnemies() {
    for (const e of this.enemies) this.scene.remove(e.mesh);
    this.enemies.length = 0;
  }

  get livePlayers() {
    return this.players.filter((p) => !p.dead);
  }

  private freeze(seconds: number) {
    this.hitstop = Math.max(this.hitstop, seconds);
  }

  update(dtRaw: number, frames: Map<number, Frame | null>) {
    // Hitstop eats real time before anything simulates.
    if (this.hitstop > 0) {
      this.hitstop -= dtRaw;
      this.timeScale = damp(this.timeScale, 0.03, 30, dtRaw);
    } else {
      this.timeScale = damp(this.timeScale, 1, 14, dtRaw);
    }
    const dt = dtRaw * this.timeScale;

    for (const p of this.players) this.updatePlayer(p, dt, frames.get(p.id) ?? null);
    for (const e of this.enemies) this.updateEnemy(e, dt);
    this.updateProjectiles(dt);
    this.resolveCollisions();

    for (const p of this.players) p.tick(dt, frames.get(p.id) ?? null);
    for (const e of this.enemies) e.tick(dt);

    // Retire corpses once their sink animation finishes.
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead && e.stateT > 0.9) {
        this.scene.remove(e.mesh);
        this.enemies.splice(i, 1);
      }
    }
    this.roomCleared = this.enemies.length === 0;
  }

  // ---------------------------------------------------------------- players

  private updatePlayer(p: Player, dt: number, f: Frame | null) {
    if (p.dead) {
      // Co-op revive: a living partner standing close brings you back at 40% HP.
      const helper = this.livePlayers.find(
        (o) => Math.hypot(o.pos.x - p.pos.x, o.pos.z - p.pos.z) < 2.0
      );
      p.reviveProgress = clamp(p.reviveProgress + (helper ? dt / 2.5 : -dt / 2), 0, 1);
      if (p.reviveProgress >= 1) {
        p.dead = false;
        p.hp = p.maxHp * 0.4;
        p.state = 'idle';
        p.iframes = 1.2;
        p.reviveProgress = 0;
        this.fx.ring(p.pos.x, p.pos.z, 0xffd27f, 2.2, 0.6);
        this.fx.shake(0.2);
      }
      return;
    }

    const b = p.boons;

    // --- state machine -------------------------------------------------
    if (p.state === 'dash') {
      const t = p.stateT / DASH.time;
      if (t >= 1) {
        p.state = 'idle';
        p.stateT = 0;
      } else {
        // Ease-out so the dash pops on frame one and glides to a stop.
        const speed = (DASH.dist / DASH.time) * (1 - t * t) * 1.5;
        p.vel.set(Math.sin(p.facing) * speed, 0, Math.cos(p.facing) * speed);
        this.fx.dashTrail(p.pos.x, p.pos.z, '#8fd8ff');
        if (b.dashDamage > 0) this.dashSweep(p);
      }
    } else if (p.state === 'attack') {
      const a = p.currentAttack;
      const total = a.wind + a.active + a.recover;
      if (!p.attackHitDone && p.stateT >= a.wind) {
        this.resolveAttack(p, a);
        p.attackHitDone = true;
      }
      if (p.stateT >= total) {
        p.state = 'idle';
        p.stateT = 0;
        p.comboWindow = 0.34;
        // A special never advances the chain; the next basic starts it over.
        p.comboIndex = p.usingSpecial ? 0 : (p.comboIndex + 1) % p.comboLength;
        p.usingSpecial = false;
      }
      p.vel.multiplyScalar(Math.exp(-14 * dt));
    } else if (p.state === 'cast') {
      if (p.stateT > 0.18) {
        p.state = 'idle';
        p.stateT = 0;
      }
      p.vel.multiplyScalar(Math.exp(-12 * dt));
    }

    if (p.comboWindow <= 0 && p.state !== 'attack') p.comboIndex = 0;

    // --- intent --------------------------------------------------------
    if (f && !p.isBusy) {
      if (f.pressed.has('dash') && p.dashCd <= 0) {
        // Dash goes where you're moving if you're moving, else where you aim.
        if (f.moveX || f.moveY) p.facing = Math.atan2(f.moveX, f.moveY);
        p.state = 'dash';
        p.stateT = 0;
        p.dashCd = DASH.cooldown;
        p.iframes = Math.max(p.iframes, DASH.iframes);
        this.fx.ring(p.pos.x, p.pos.z, 0x6fd0ff, 1.1, 0.22);
      } else if (f.pressed.has('attack')) {
        p.state = 'attack';
        p.stateT = 0;
        p.attackHitDone = false;
        p.usingSpecial = false;
      } else if (f.pressed.has('special')) {
        p.state = 'attack';
        p.stateT = 0;
        p.attackHitDone = false;
        p.usingSpecial = true;
      } else if (f.pressed.has('cast') && p.castAmmo > 0) {
        p.state = 'cast';
        p.stateT = 0;
        p.castAmmo--;
        if (p.castReload <= 0) p.castReload = 1.1;
        this.fireCast(p);
      }
    }

    // --- locomotion ------------------------------------------------------
    if (f && p.state !== 'dash' && p.stagger <= 0) {
      const accel = p.isBusy ? 18 : 60;
      const max = p.speed * b.moveMul * (p.state === 'attack' ? 0.25 : 1);
      const wantX = f.moveX * max;
      const wantZ = f.moveY * max;
      p.vel.x = damp(p.vel.x, wantX, accel * 0.35, dt);
      p.vel.z = damp(p.vel.z, wantZ, accel * 0.35, dt);
      p.state =
        p.state === 'idle' || p.state === 'run'
          ? Math.hypot(p.vel.x, p.vel.z) > 0.6
            ? 'run'
            : 'idle'
          : p.state;
    } else if (!f) {
      p.vel.multiplyScalar(Math.exp(-8 * dt));
    }

    p.pos.x += p.vel.x * dt;
    p.pos.z += p.vel.z * dt;
    this.confine(p);
  }

  private confine(a: Actor) {
    const r = Math.hypot(a.pos.x, a.pos.z);
    const lim = arenaRadius() - a.radius - 0.6;
    if (r > lim) {
      a.pos.x = (a.pos.x / r) * lim;
      a.pos.z = (a.pos.z / r) * lim;
      a.vel.x *= 0.2;
      a.vel.z *= 0.2;
    }
  }

  /** Route the attack to whichever shape this class throws. */
  private resolveAttack(p: Player, a: AttackShape) {
    const heavy = p.usingSpecial;

    // Twin Strike: the special lands a second time a beat later, so the follow-up
    // catches anything that stepped in after the first hit.
    if (heavy && p.boons.doubleSpecial) {
      setTimeout(() => {
        if (!p.dead) this.throwAttack(p, a, true);
      }, 180);
    }
    return this.throwAttack(p, a, heavy);
  }

  private throwAttack(p: Player, a: AttackShape, heavy: boolean) {
    if (heavy && p.def.special.kind === 'volley') return this.fireVolley(p, a);
    if (heavy && p.def.special.kind === 'nova') return this.fireNova(p, a);
    if (!heavy && p.def.attack === 'arrow') return this.fireArrow(p, a, 0);
    if (!heavy && p.def.attack === 'orb') return this.fireOrb(p, a);
    return this.resolveSwing(p, a, heavy);
  }

  /**
   * The archer's arrow: fast, thin, and it pierces. Reach is long enough to cross
   * the arena, so the class's whole game is holding a clean line.
   */
  private fireArrow(p: Player, a: AttackShape, spread: number) {
    const angle = p.facing + spread;
    const speed = 34;
    // Stretched along its flight path so it reads as an arrow, not a pellet.
    const mesh = makeBolt(p.def.accent, 0.14, '#c8ff9a', 0xdcffc0);
    mesh.scale.set(0.7, 0.7, 3.4);
    mesh.rotation.y = angle;
    mesh.position.set(p.pos.x, 1.05, p.pos.z);
    this.scene.add(mesh);
    this.projectiles.push({
      mesh,
      pos: mesh.position.clone(),
      vel: new THREE.Vector3(Math.sin(angle) * speed, 0, Math.cos(angle) * speed),
      radius: 0.3,
      damage: a.dmg * p.boons.attackMul,
      team: 'player',
      life: 0.85,
      pierce: 1,
      hit: new Set(),
      color: p.def.accent,
      trail: '#9ee06a',
      owner: p,
      spin: false,
    });
    this.fx.hitSpark(
      p.pos.x + Math.sin(angle) * 1.1,
      p.pos.z + Math.cos(angle) * 1.1,
      Math.sin(angle),
      Math.cos(angle),
      '#d8ffb0',
      0.35
    );
    this.fx.shake(0.06);
  }

  /** Special: five arrows in a fan. Rewards a clustered pack, wastes shots on one target. */
  private fireVolley(p: Player, a: AttackShape) {
    for (let i = -2; i <= 2; i++) this.fireArrow(p, a, i * (a.arc / 4));
    this.fx.shake(0.16);
  }

  /** The mage's orb: slow, heavy, and it bursts in a small radius on contact. */
  private fireOrb(p: Player, a: AttackShape) {
    const speed = 15;
    const mesh = makeBolt(p.def.accent, 0.3, '#c9a0ff', 0xe0c8ff);
    mesh.position.set(p.pos.x, 1.1, p.pos.z);
    this.scene.add(mesh);
    this.projectiles.push({
      mesh,
      pos: mesh.position.clone(),
      vel: new THREE.Vector3(Math.sin(p.facing) * speed, 0, Math.cos(p.facing) * speed),
      radius: 0.5,
      damage: a.dmg * p.boons.attackMul,
      team: 'player',
      life: 1.3,
      pierce: 0,
      hit: new Set(),
      color: p.def.accent,
      trail: '#a06cff',
      owner: p,
      /** Splash on impact — the mage's damage comes from grouping, not accuracy. */
      burst: 2.4,
    });
    this.fx.shake(0.08);
  }

  /** Special: a ring of force centred on the mage. The panic button, on a long recover. */
  private fireNova(p: Player, a: AttackShape) {
    let connected = 0;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.pos.x - p.pos.x;
      const dz = e.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > a.reach + e.radius) continue;
      this.damage(e, a.dmg * p.boons.specialMul, p, dx / (d || 1), dz / (d || 1), a.push);
      connected++;
    }
    this.fx.ring(p.pos.x, p.pos.z, p.def.accent, a.reach, 0.45);
    this.fx.slash(p.pos.x, p.pos.z, p.facing, Math.PI * 2, a.reach, p.def.accent, 0.3);
    this.fx.bloodBurst(p.pos.x, p.pos.z, '#b07cff', 1.4);
    this.fx.shake(connected ? 0.75 : 0.4);
    if (connected) this.freeze(0.09);
  }

  /** Melee: an arc test in front of the attacker. Generous, because whiffing feels bad. */
  private resolveSwing(p: Player, a: AttackShape, heavy: boolean) {
    const mul = heavy ? p.boons.specialMul : p.boons.attackMul;
    let connected = 0;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.pos.x - p.pos.x;
      const dz = e.pos.z - p.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > a.reach + e.radius) continue;
      const to = Math.atan2(dx, dz);
      if (Math.abs(angleDelta(p.facing, to)) > a.arc / 2) continue;
      this.damage(e, a.dmg * mul, p, dx / (dist || 1), dz / (dist || 1), a.push);
      connected++;
    }

    const fx = p.pos.x + Math.sin(p.facing) * 1.6;
    const fz = p.pos.z + Math.cos(p.facing) * 1.6;

    // The arc fires on every swing, hit or miss — the attack has to exist in the
    // world before it has consequences.
    this.fx.slash(
      p.pos.x,
      p.pos.z,
      p.facing,
      a.arc,
      a.reach,
      heavy ? 0xffb04a : 0xbfd4ff,
      heavy ? 0.32 : 0.24
    );

    if (connected > 0) {
      this.freeze(heavy ? 0.085 : 0.045);
      this.fx.shake(heavy ? 0.55 : 0.22);
      this.fx.hitSpark(fx, fz, Math.sin(p.facing), Math.cos(p.facing), '#ffe6a8', heavy ? 1.6 : 1);
    } else {
      // A whoosh even on a whiff — the swing must exist in the world.
      this.fx.hitSpark(fx, fz, Math.sin(p.facing), Math.cos(p.facing), '#8fa8ff', 0.35);
    }
    if (heavy) this.fx.ring(p.pos.x, p.pos.z, 0xffc07a, a.reach, 0.3);
  }

  private dashSweep(p: Player) {
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.pos.x - p.pos.x;
      const dz = e.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > e.radius + p.radius + 0.3) continue;
      if (e.iframes > 0) continue;
      e.iframes = 0.4;
      this.damage(e, p.boons.dashDamage, p, dx / (d || 1), dz / (d || 1), p.boons.dashKnockback);
      this.fx.shake(0.18);
    }
  }

  private fireCast(p: Player) {
    const color = GODS.Aphrodite.color;
    const speed = 20;
    const mesh = makeBolt(color, 0.26, '#ff9fd0', 0xffc8e4);
    mesh.position.set(p.pos.x, 1.0, p.pos.z);
    this.scene.add(mesh);
    this.projectiles.push({
      mesh,
      pos: mesh.position.clone(),
      vel: new THREE.Vector3(Math.sin(p.facing) * speed, 0, Math.cos(p.facing) * speed),
      radius: 0.45,
      damage: p.def.castDamage * p.boons.castMul,
      owner: p,
      burst: p.boons.castBurst || undefined,
      team: 'player',
      life: 1.4,
      pierce: 1 + p.boons.castPierce,
      hit: new Set(),
      color,
      trail: '#ff8fc8',
    });
    this.fx.shake(0.1);
  }

  // ---------------------------------------------------------------- enemies

  /**
   * Erinys. Three telegraphed patterns on a rotation, each with a distinct shape
   * the player learns: a radial lash to punish standing close, a bullet ring to
   * punish standing still, and a charge to punish standing anywhere. Below half
   * health she enrages — same patterns, tighter timings.
   */
  private updateBoss(e: Enemy, dt: number, target: Player, dx: number, dz: number, dist: number) {
    if (!e.enraged && e.hp < e.maxHp * 0.5) {
      e.enraged = true;
      this.fx.ring(e.pos.x, e.pos.z, 0xff2a55, 5, 0.8);
      this.fx.shake(1.0);
      this.freeze(0.14);
    }
    const haste = e.enraged ? 0.68 : 1;
    e.facing = Math.atan2(dx, dz);
    e.patternTimer -= dt;

    if (e.state === 'spawn') {
      if (e.stateT > 1.2) {
        e.state = 'chase';
        e.stateT = 0;
        e.cooldown = 1.0;
      }
      return;
    }

    if (e.state === 'chase') {
      // Closes in, but keeps circling rather than bulldozing into the player.
      const want = 4.2;
      const drive = dist > want ? 1 : -0.6;
      const tangent = 0.75;
      e.vel.x = damp(e.vel.x, ((dx / dist) * drive - (dz / dist) * tangent) * e.moveSpeed, 6, dt);
      e.vel.z = damp(e.vel.z, ((dz / dist) * drive + (dx / dist) * tangent) * e.moveSpeed, 6, dt);
      if (e.cooldown <= 0) {
        const order: BossPattern[] = BOSS_PATTERNS[e.kind] ?? ['lash'];
        e.pattern = order[e.patternStep % order.length];
        e.patternStep++;
        e.state = 'pattern';
        e.stateT = 0;
        e.patternTimer = 0;
        e.strikeDone = false;
        this.telegraphPattern(e);
      }
      return;
    }

    if (e.state !== 'pattern') return;

    const windup = (e.pattern === 'charge' ? 0.75 : 0.62) * haste;

    // --- Bone Hydra ----------------------------------------------------
    if (e.pattern === 'spit') {
      // Three heads, three arcs of spit, each led slightly ahead of a player.
      if (e.stateT >= windup && e.patternTimer <= 0) {
        for (let head = -1; head <= 1; head++) {
          const spread = head * 0.26;
          const lead = 0.35;
          const aimX = target.pos.x + target.vel.x * lead - e.pos.x;
          const aimZ = target.pos.z + target.vel.z * lead - e.pos.z;
          const a = Math.atan2(aimX, aimZ) + spread;
          this.spawnBossShot(e, Math.sin(a), Math.cos(a), 0x9cff5a, 11);
        }
        e.patternTimer = 0.3 * haste;
        e.strikeDone = true;
      }
      if (e.stateT > windup + 1.2) this.endPattern(e, haste);
      return;
    }

    if (e.pattern === 'sweep') {
      // A rotating wall of spit that forces movement around the arena rim.
      if (e.stateT >= windup && e.patternTimer <= 0) {
        const spin = e.stateT * 3.2 * (e.enraged ? 1.5 : 1);
        for (let i = 0; i < 3; i++) {
          const a = spin + (i / 3) * TAU;
          this.spawnBossShot(e, Math.sin(a), Math.cos(a), 0xd8e04a, 8.5);
        }
        e.patternTimer = 0.1;
        e.strikeDone = true;
      }
      if (e.stateT > windup + 2.0) this.endPattern(e, haste);
      return;
    }

    if (e.pattern === 'summon') {
      // The hydra cannot reach you, so it sends something that can.
      if (!e.strikeDone && e.stateT >= windup) {
        e.strikeDone = true;
        const count = e.enraged ? 4 : 2;
        for (let i = 0; i < count; i++) {
          const s = this.randomSpawnPoint(6);
          this.spawnEnemy(i % 2 === 0 ? 'wretch' : 'lobber', s.x, s.z);
        }
        this.fx.ring(e.pos.x, e.pos.z, 0x9cff5a, 4, 0.5);
        this.fx.shake(0.5);
      }
      if (e.stateT > windup + 0.8) this.endPattern(e, haste);
      return;
    }

    // --- Champions of Elysium ------------------------------------------
    if (e.pattern === 'lunge') {
      // A short, sharp spear thrust — much tighter than Erinys's charge.
      if (e.stateT < windup) {
        e.vel.multiplyScalar(Math.exp(-10 * dt));
        e.chargeX = dx / dist;
        e.chargeZ = dz / dist;
      } else {
        e.vel.set(e.chargeX * 17, 0, e.chargeZ * 17);
        this.fx.dashTrail(e.pos.x, e.pos.z, '#ffd166');
        for (const p of this.livePlayers) {
          if (Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z) > e.radius + p.radius + 0.5) continue;
          if (this.hitPlayer(p, e.a.contact, e.chargeX, e.chargeZ, 13)) this.fx.shake(0.6);
        }
        if (e.stateT > windup + 0.42) this.endPattern(e, haste);
      }
      return;
    }

    if (e.pattern === 'spin') {
      // Spear held out, spinning on the spot. Safe to stand just outside.
      e.vel.multiplyScalar(Math.exp(-6 * dt));
      const reach = 4.4;
      if (e.stateT >= windup) {
        e.facing += dt * 9;
        if (e.patternTimer <= 0) {
          this.fx.slash(e.pos.x, e.pos.z, e.facing, 1.6, reach, 0xffd166, 0.22);
          for (const p of this.livePlayers) {
            const d = Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
            if (d > reach + p.radius) continue;
            const to = Math.atan2(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
            if (Math.abs(angleDelta(e.facing, to)) > 0.9) continue;
            this.hitPlayer(p, e.a.contact * 0.6, (p.pos.x - e.pos.x) / d, (p.pos.z - e.pos.z) / d, 9);
          }
          e.patternTimer = 0.16;
          this.fx.shake(0.18);
        }
        e.strikeDone = true;
      }
      if (e.stateT > windup + 1.7) this.endPattern(e, haste);
      return;
    }

    if (e.pattern === 'throw') {
      // Hurls the spear on a flat line — the only ranged option the pair has.
      if (!e.strikeDone && e.stateT >= windup) {
        e.strikeDone = true;
        const a = Math.atan2(dx, dz);
        this.spawnBossShot(e, Math.sin(a), Math.cos(a), 0xffd166, 20, 0.42, 18);
        this.fx.shake(0.3);
      }
      e.vel.multiplyScalar(Math.exp(-8 * dt));
      if (e.stateT > windup + 0.6) this.endPattern(e, haste);
      return;
    }

    if (e.pattern === 'lash') {
      e.vel.multiplyScalar(Math.exp(-9 * dt));
      if (!e.strikeDone && e.stateT >= windup) {
        e.strikeDone = true;
        this.fx.slash(e.pos.x, e.pos.z, e.facing, Math.PI * 2, 5.2, 0xff2a55, 0.36);
        this.fx.ring(e.pos.x, e.pos.z, 0xff2a55, 5.2, 0.3);
        this.fx.shake(0.7);
        for (const p of this.livePlayers) {
          if (Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z) > 5.2 + p.radius) continue;
          this.hitPlayer(p, e.a.contact, (p.pos.x - e.pos.x) / dist, (p.pos.z - e.pos.z) / dist, 11);
        }
      }
      if (e.stateT > windup + 0.7) this.endPattern(e, haste);
      return;
    }

    if (e.pattern === 'volley') {
      e.vel.multiplyScalar(Math.exp(-7 * dt));
      if (e.stateT >= windup && e.patternTimer <= 0 && e.patternStep >= 0) {
        // Three expanding rings of shots, offset so the gaps never line up.
        const shots = e.enraged ? 14 : 11;
        const spin = e.stateT * 1.9;
        for (let i = 0; i < shots; i++) {
          const a = (i / shots) * TAU + spin;
          this.spawnBossShot(e, Math.sin(a), Math.cos(a));
        }
        e.patternTimer = 0.42 * haste;
        e.strikeDone = true;
      }
      if (e.stateT > windup + 1.35) this.endPattern(e, haste);
      return;
    }

    // charge
    if (e.stateT < windup) {
      e.vel.multiplyScalar(Math.exp(-10 * dt));
      e.chargeX = dx / dist;
      e.chargeZ = dz / dist;
    } else {
      const speed = 22;
      e.vel.set(e.chargeX * speed, 0, e.chargeZ * speed);
      this.fx.dashTrail(e.pos.x, e.pos.z, '#ff2a55');
      for (const p of this.livePlayers) {
        if (Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z) > e.radius + p.radius + 0.35) continue;
        if (this.hitPlayer(p, e.a.contact, e.chargeX, e.chargeZ, 16)) this.fx.shake(0.8);
      }
      const atWall = Math.hypot(e.pos.x, e.pos.z) > arenaRadius() - e.radius - 1.0;
      if (atWall || e.stateT > windup + 0.75) {
        if (atWall) {
          this.fx.ring(e.pos.x, e.pos.z, 0xffb03a, 3, 0.4);
          this.fx.shake(0.9);
          this.freeze(0.1);
        }
        this.endPattern(e, haste);
      }
    }
  }

  /**
   * Every pattern announces itself with a ring before it happens. Radius hints
   * at the danger zone; colour stays red for "this will hit you" and gold for
   * "something is coming from elsewhere".
   */
  private telegraphPattern(e: Enemy) {
    const gold = 0xffb03a;
    const red = 0xff2a55;
    const table: Partial<Record<BossPattern, [number, number]>> = {
      lash: [red, 5.2],
      volley: [gold, 2.4],
      charge: [red, 1.8],
      spit: [gold, 2.6],
      sweep: [gold, 3.4],
      summon: [0x9cff5a, 4.0],
      lunge: [red, 2.0],
      spin: [red, 4.4],
      throw: [gold, 2.2],
    };
    const [color, radius] = table[e.pattern] ?? [red, 2.4];
    this.fx.ring(e.pos.x, e.pos.z, color, radius, 0.62);
  }

  private endPattern(e: Enemy, haste: number) {
    e.state = 'chase';
    e.stateT = 0;
    e.cooldown = e.a.cooldown * haste * rand(0.9, 1.15);
  }

  private spawnBossShot(
    e: Enemy,
    nx: number,
    nz: number,
    color = 0xff5a7a,
    speed = 9.5,
    radius = 0.36,
    damage = 12
  ) {
    const css = '#' + color.toString(16).padStart(6, '0');
    // Tint the core as well as the glow. The bolts used to take their colour
    // from a per-bolt PointLight; without one, a white core reads as a grey pip.
    const mesh = makeBolt(color, radius * 0.66, css, lighten(color, 0.55));
    mesh.position.set(e.pos.x, 1.1 + (e.kind === 'hydra' ? 0.7 : 0), e.pos.z);
    this.scene.add(mesh);
    this.projectiles.push({
      mesh,
      pos: mesh.position.clone(),
      vel: new THREE.Vector3(nx * speed, 0, nz * speed),
      radius,
      damage,
      team: 'enemy',
      life: 3.0,
      pierce: 0,
      hit: new Set(),
      color,
      trail: css,
    });
  }

  /** Splash from a bursting bolt. The direct target is already resolved. */
  private splash(pr: Projectile, directId: number) {
    const radius = pr.burst ?? 0;
    for (const e of this.enemies) {
      if (e.dead || e.id === directId) continue;
      const dx = e.pos.x - pr.pos.x;
      const dz = e.pos.z - pr.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > radius + e.radius) continue;
      // Falls off toward the edge so a clipped enemy is not a full hit.
      const falloff = 1 - Math.min(1, d / (radius + e.radius)) * 0.5;
      this.damage(e, pr.damage * 0.6 * falloff, pr.owner, dx / (d || 1), dz / (d || 1), 9);
    }
    this.fx.ring(pr.pos.x, pr.pos.z, pr.color, radius, 0.34);
    this.fx.bloodBurst(pr.pos.x, pr.pos.z, '#b07cff', 1.0);
    this.fx.shake(0.3);
  }

  /** Shared player-damage path, so knockback and feedback are identical everywhere. */
  private hitPlayer(p: Player, amount: number, nx: number, nz: number, push: number) {
    if (!p.hurt(amount)) return false;
    this.fx.bloodBurst(p.pos.x, p.pos.z, '#ff4d5e', 0.8);
    this.damageEvents.push({
      x: p.pos.x,
      z: p.pos.z,
      amount,
      crit: false,
      color: '#ff6a6a',
    });
    p.vel.x += nx * push;
    p.vel.z += nz * push;
    this.freeze(0.06);
    return true;
  }

  private updateEnemy(e: Enemy, dt: number) {
    if (e.dead) return;
    const targets = this.livePlayers;
    if (targets.length === 0) {
      e.vel.multiplyScalar(Math.exp(-6 * dt));
      e.pos.x += e.vel.x * dt;
      e.pos.z += e.vel.z * dt;
      return;
    }

    // Retarget lazily and prefer the closest — packs naturally split in co-op.
    let target = targets[0];
    let best = Infinity;
    for (const t of targets) {
      const d = (t.pos.x - e.pos.x) ** 2 + (t.pos.z - e.pos.z) ** 2;
      if (d < best) {
        best = d;
        target = t;
      }
    }
    e.targetId = target.id;
    const dx = target.pos.x - e.pos.x;
    const dz = target.pos.z - e.pos.z;
    const dist = Math.sqrt(best) || 1;
    e.facing = Math.atan2(dx, dz);

    if (e.a.boss) {
      this.updateBoss(e, dt, target, dx, dz, dist);
      e.pos.x += e.vel.x * dt;
      e.pos.z += e.vel.z * dt;
      this.confine(e);
      return;
    }

    if (e.state === 'spawn') {
      if (e.stateT > 0.45) {
        e.state = 'chase';
        e.stateT = 0;
      }
    } else if (e.state === 'chase') {
      const want = e.kind === 'lobber' ? 8.0 : e.a.attackRange - 0.4;
      const dir = dist > want ? 1 : dist < want * 0.7 ? -0.7 : 0;
      const sp = e.moveSpeed * dir;
      // Slight tangential drift so they arc in instead of marching down the same line.
      const tang = e.kind === 'wretch' ? Math.sin(e.id * 1.7) * 0.35 : 0;
      e.vel.x = damp(e.vel.x, (dx / dist) * sp - (dz / dist) * sp * tang, 8, dt);
      e.vel.z = damp(e.vel.z, (dz / dist) * sp + (dx / dist) * sp * tang, 8, dt);
      if (dist <= e.a.attackRange && e.cooldown <= 0) {
        e.state = 'tell';
        e.stateT = 0;
        e.strikeDone = false;
        if (e.kind !== 'lobber') {
          this.fx.ring(e.pos.x, e.pos.z, 0xff5a4a, e.a.attackRange * 0.9, e.a.tell);
        }
      }
    } else if (e.state === 'tell') {
      e.vel.multiplyScalar(Math.exp(-9 * dt));
      if (e.stateT >= e.a.tell) {
        e.state = 'strike';
        e.stateT = 0;
      }
    } else if (e.state === 'strike') {
      if (!e.strikeDone) {
        e.strikeDone = true;
        this.enemyStrike(e, target, dx / dist, dz / dist);
      }
      if (e.stateT > 0.16) {
        e.state = 'recover';
        e.stateT = 0;
      }
    } else if (e.state === 'recover') {
      e.vel.multiplyScalar(Math.exp(-7 * dt));
      if (e.stateT > 0.35) {
        e.state = 'chase';
        e.stateT = 0;
        e.cooldown = e.a.cooldown * rand(0.85, 1.2);
      }
    }

    e.pos.x += e.vel.x * dt;
    e.pos.z += e.vel.z * dt;
    this.confine(e);
  }

  private enemyStrike(e: Enemy, target: Player, nx: number, nz: number) {
    if (e.kind === 'lobber') {
      const speed = 13;
      const mesh = makeBolt(0x9cff8a, 0.26, '#9cff8a', 0xd4ffc8);
      mesh.position.set(e.pos.x, 1.1, e.pos.z);
      this.scene.add(mesh);
      this.projectiles.push({
        mesh,
        pos: mesh.position.clone(),
        vel: new THREE.Vector3(nx * speed, 0, nz * speed),
        radius: 0.4,
        damage: e.a.contact,
        team: 'enemy',
        life: 2.2,
        pierce: 0,
        hit: new Set(),
        color: 0x9cff8a,
        trail: '#7fe06a',
      });
      return;
    }

    const reach = e.a.attackRange + 0.5;
    this.fx.hitSpark(e.pos.x + nx * 1.2, e.pos.z + nz * 1.2, nx, nz, '#ff7a5a', 0.8);
    for (const p of this.livePlayers) {
      const d = Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
      if (d > reach + p.radius) continue;
      const to = Math.atan2(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
      if (Math.abs(angleDelta(e.facing, to)) > 1.3) continue;
      if (p.hurt(e.a.contact)) {
        this.fx.shake(0.4);
        this.freeze(0.06);
        this.fx.bloodBurst(p.pos.x, p.pos.z, '#ff4d5e', 0.8);
        this.damageEvents.push({
          x: p.pos.x,
          z: p.pos.z,
          amount: e.a.contact,
          crit: false,
          color: '#ff6a6a',
        });
        p.vel.x += nx * 7;
        p.vel.z += nz * 7;
      }
    }
  }

  // ------------------------------------------------------------ projectiles

  private updateProjectiles(dt: number) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.life -= dt;
      pr.pos.addScaledVector(pr.vel, dt);
      pr.mesh.position.copy(pr.pos);
      if (pr.spin !== false) pr.mesh.rotation.y += dt * 8;
      // Trails are time-based, not per-frame: sixty bolts each emitting every
      // frame saturates the particle pool and starves everything else of it.
      if (pr.trail) {
        pr.trailT = (pr.trailT ?? 0) - dt;
        if (pr.trailT <= 0) {
          this.fx.dashTrail(pr.pos.x, pr.pos.z, pr.trail);
          pr.trailT = 0.055;
        }
      }

      let done = pr.life <= 0 || Math.hypot(pr.pos.x, pr.pos.z) > arenaRadius() - 0.4;

      if (!done) {
        const targets: Actor[] = pr.team === 'player' ? this.enemies : this.livePlayers;
        for (const t of targets) {
          if (t.dead || pr.hit.has(t.id)) continue;
          const d = Math.hypot(t.pos.x - pr.pos.x, t.pos.z - pr.pos.z);
          if (d > t.radius + pr.radius) continue;
          pr.hit.add(t.id);
          if (pr.team === 'player') {
            const dx = (t.pos.x - pr.pos.x) / (d || 1);
            const dz = (t.pos.z - pr.pos.z) / (d || 1);
            this.damage(t as Enemy, pr.damage, pr.owner ?? this.players[0], dx, dz, 8);
            if (pr.burst) this.splash(pr, t.id);
          } else if ((t as Player).hurt(pr.damage)) {
            this.fx.shake(0.32);
            this.fx.bloodBurst(t.pos.x, t.pos.z, '#ff4d5e', 0.7);
            this.damageEvents.push({
              x: t.pos.x,
              z: t.pos.z,
              amount: pr.damage,
              crit: false,
              color: '#ff6a6a',
            });
          }
          this.fx.hitSpark(pr.pos.x, pr.pos.z, pr.vel.x, pr.vel.z, '#ffffff', 0.9);
          if (pr.pierce-- <= 0) done = true;
          break;
        }
      }

      if (done) {
        this.fx.ring(pr.pos.x, pr.pos.z, pr.color, 1.0, 0.22);
        this.scene.remove(pr.mesh);
        pr.mesh.geometry.dispose();
        (pr.mesh.material as THREE.Material).dispose();
        this.projectiles.splice(i, 1);
      }
    }
  }

  // ---------------------------------------------------------------- damage

  damage(e: Enemy, amount: number, source: Player | undefined, nx: number, nz: number, push: number) {
    if (e.dead) return;
    const b = source?.boons;
    const crit = !!b && Math.random() < b.critChance;
    const final = Math.round(amount * (crit ? b!.critMul : 1));
    e.hurt(final);
    e.vel.x += nx * push;
    e.vel.z += nz * push;
    e.stagger = 0.15;

    this.damageEvents.push({
      x: e.pos.x,
      z: e.pos.z,
      amount: final,
      crit,
      color: crit ? '#ffe066' : '#ffffff',
    });

    if (b && b.lifesteal > 0 && source && !source.dead) {
      source.hp = Math.min(source.maxHp, source.hp + final * b.lifesteal);
    }
    if (source) source.callGauge = Math.min(1, source.callGauge + final / 900);

    if (e.dead) {
      this.fx.bloodBurst(e.pos.x, e.pos.z, '#b3264a', e.a.scale);
      this.fx.ring(e.pos.x, e.pos.z, 0xff5a7a, 1.6 * e.a.scale, 0.35);
      this.freeze(0.07);
      this.fx.shake(0.45 * e.a.scale);
    }
  }

  private resolveCollisions() {
    const all: Actor[] = [...this.players.filter((p) => !p.dead), ...this.enemies.filter((e) => !e.dead)];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) separate(all[i], all[j]);
    }
    for (const a of all) this.confine(a);
  }

  /**
   * Camera focus, plus how far apart the things that must stay on screen are.
   * A boss is pulled into the frame at partial weight — the players stay the
   * subject, but you can never be fighting something you cannot see.
   */
  focus(out: THREE.Vector3): number {
    const live = this.livePlayers.length ? this.livePlayers : this.players;
    out.set(0, 0, 0);
    for (const p of live) out.add(p.pos);
    out.divideScalar(live.length || 1);

    let spread = 0;
    for (const p of live) spread = Math.max(spread, Math.hypot(p.pos.x - out.x, p.pos.z - out.z));

    const boss = this.enemies.find((e) => e.a.boss && !e.dead);
    if (boss) {
      out.x += (boss.pos.x - out.x) * 0.42;
      out.z += (boss.pos.z - out.z) * 0.42;
      spread = Math.max(spread, Math.hypot(boss.pos.x - out.x, boss.pos.z - out.z));
    }

    out.y = 0;
    return spread;
  }

  randomSpawnPoint(minDistFromPlayers = 5) {
    for (let i = 0; i < 40; i++) {
      const a = rand(0, TAU);
      const r = rand(4, arenaRadius() - 2.5);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (this.livePlayers.every((p) => Math.hypot(p.pos.x - x, p.pos.z - z) > minDistFromPlayers)) {
        return { x, z };
      }
    }
    return { x: rand(-6, 6), z: rand(-6, 6) };
  }
}
