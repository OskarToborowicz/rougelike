import * as THREE from "three";
import type { World } from "../game/world";
import { Player, PLAYER_TINTS, type PlayerState } from "../game/player";
import { Enemy, type EnemyKind, type EnemyState } from "../game/enemy";
import { BoonSet } from "../game/boons";
import { CLASS_ORDER } from "../game/classes";
import type { FxBus } from "../render/fxbus";
import { damp } from "../core/math";
import type {
  Snapshot,
  WireEnemy,
  WireOffer,
  WirePlayer,
  WireProjectile,
} from "./protocol";

// Fixed index tables. Order is part of the wire format — append only.
const PLAYER_STATES: PlayerState[] = [
  "idle",
  "run",
  "attack",
  "dash",
  "cast",
  "hurt",
  "down",
];
const ENEMY_STATES: EnemyState[] = [
  "spawn",
  "chase",
  "tell",
  "strike",
  "recover",
  "dead",
  "pattern",
];
const ENEMY_KINDS: EnemyKind[] = ["wretch", "lobber", "brute", "erinys"];

const r = (n: number) => Math.round(n * 100) / 100;

export function buildSnapshot(
  world: World,
  fx: FxBus,
  n: number,
  owners: [number, number][],
  depth: number,
  label: string,
  paused: boolean,
  offers: WireOffer[] = [],
): Snapshot {
  const players: WirePlayer[] = world.players.map((p) => [
    p.id,
    p.seat,
    r(p.pos.x),
    r(p.pos.z),
    r(p.facing),
    r(p.hp),
    p.maxHp,
    Math.max(0, PLAYER_STATES.indexOf(p.state)),
    p.dead ? 1 : 0,
    p.castAmmo,
    r(p.callGauge),
    r(p.reviveProgress),
    r(p.iframes),
    Math.max(0, CLASS_ORDER.indexOf(p.cls)),
    p.usingSpecial ? 1 : 0,
  ]);

  const enemies: WireEnemy[] = world.enemies.map((e) => [
    e.id,
    Math.max(0, ENEMY_KINDS.indexOf(e.kind)),
    r(e.pos.x),
    r(e.pos.z),
    r(e.facing),
    r(e.hp),
    e.maxHp,
    Math.max(0, ENEMY_STATES.indexOf(e.state)),
    e.dead ? 1 : 0,
    e.enraged ? 1 : 0,
    r(e.flash),
  ]);

  const projectiles: WireProjectile[] = world.projectiles.map((pr, i) => [
    i,
    r(pr.pos.x),
    r(pr.pos.z),
    pr.color,
    pr.team === "player" ? 1 : 0,
  ]);

  return {
    t: "sn",
    n,
    players,
    enemies,
    projectiles,
    fx: fx.drain(),
    owners,
    depth,
    label,
    paused,
    offers,
  };
}

/**
 * Guest-side view of the host's world.
 *
 * It never simulates. It keeps a real Player/Enemy per replicated id — so all
 * the existing rigs, wingbeats, tell glows and death animations run untouched —
 * and just writes authoritative transforms into them each snapshot, easing
 * between packets so 30Hz on the wire still renders smoothly.
 */
export class RemoteView {
  players = new Map<number, Player>();
  enemies = new Map<number, Enemy>();
  private bolts = new Map<number, THREE.Mesh>();
  private targets = new Map<number, { x: number; z: number }>();
  private lastTick = -1;
  depth = 1;
  label = "";
  paused = false;
  /** Player id this client controls, resolved from the snapshot's owner table. */
  myPlayerId = -1;
  /** Boon choices the host is waiting on. */
  offers: WireOffer[] = [];

  constructor(
    private scene: THREE.Object3D,
    private fx: FxBus,
  ) {}

  /** Ordered by seat, so the HUD can lay out player one through four. */
  get playerList() {
    return [...this.players.values()].sort((a, b) => a.seat - b.seat);
  }

  apply(snap: Snapshot, myNetId: number) {
    if (snap.n <= this.lastTick) return; // stale or duplicated packet
    this.lastTick = snap.n;
    this.myPlayerId =
      snap.owners.find(([netId]) => netId === myNetId)?.[1] ?? -1;
    this.depth = snap.depth;
    this.label = snap.label;
    this.paused = snap.paused;

    this.offers = snap.offers ?? [];

    const seenP = new Set<number>();
    for (const w of snap.players) {
      const [
        id,
        seat,
        x,
        z,
        facing,
        hp,
        maxHp,
        st,
        dead,
        ammo,
        call,
        revive,
        iframes,
        clsIdx,
        spec,
      ] = w;
      seenP.add(id);
      let p = this.players.get(id);
      if (!p) {
        p = new Player(
          id,
          seat,
          new BoonSet(),
          PLAYER_TINTS[seat % PLAYER_TINTS.length],
          CLASS_ORDER[clsIdx] ?? "warrior",
        );
        p.pos.set(x, 0, z);
        this.players.set(id, p);
        this.scene.add(p.mesh);
      }
      p.usingSpecial = !!spec;
      this.targets.set(id, { x, z });
      p.facing = facing;
      p.hp = hp;
      p.maxHp = maxHp;
      p.state = PLAYER_STATES[st] ?? "idle";
      p.dead = !!dead;
      p.castAmmo = ammo;
      p.callGauge = call;
      p.reviveProgress = revive;
      p.iframes = iframes;
    }
    for (const [id, p] of this.players) {
      if (seenP.has(id)) continue;
      this.scene.remove(p.mesh);
      this.players.delete(id);
      this.targets.delete(id);
    }

    const seenE = new Set<number>();
    for (const w of snap.enemies) {
      const [id, kindIdx, x, z, facing, hp, maxHp, st, dead, enraged, flash] =
        w;
      seenE.add(id);
      let e = this.enemies.get(id);
      if (!e) {
        e = new Enemy(id, ENEMY_KINDS[kindIdx] ?? "wretch");
        e.pos.set(x, 0, z);
        e.mesh.position.set(x, -1.2, z);
        this.enemies.set(id, e);
        this.scene.add(e.mesh);
      }
      this.targets.set(-id, { x, z });
      e.facing = facing;
      e.hp = hp;
      e.maxHp = maxHp;
      const next = ENEMY_STATES[st] ?? "chase";
      // stateT drives the tell ramp and the death sink, so restart it on change.
      if (next !== e.state) e.stateT = 0;
      e.state = next;
      e.dead = !!dead;
      e.enraged = !!enraged;
      e.flash = flash;
    }
    for (const [id, e] of this.enemies) {
      if (seenE.has(id)) continue;
      this.scene.remove(e.mesh);
      this.enemies.delete(id);
      this.targets.delete(-id);
    }

    this.syncBolts(snap.projectiles);
    this.fx.replay(snap.fx);
  }

  /** Positions for the renderer's fixed bolt-light pool. */
  boltPositions() {
    return [...this.bolts.entries()].map(([, m]) => ({
      pos: m.position,
      color: (m.userData.glowColor as number) ?? 0xffffff,
    }));
  }

  private syncBolts(list: WireProjectile[]) {
    const seen = new Set<number>();
    for (const [id, x, z, color] of list) {
      seen.add(id);
      let m = this.bolts.get(id);
      if (!m) {
        // No per-bolt light: the renderer pools a fixed set of them instead.
        const tint = new THREE.Color(color).lerp(
          new THREE.Color(0xffffff),
          0.55,
        );
        m = new THREE.Mesh(
          new THREE.SphereGeometry(0.26, 12, 10),
          new THREE.MeshBasicMaterial({ color: tint }),
        );
        m.userData.glowColor = color;
        this.bolts.set(id, m);
        this.scene.add(m);
      }
      m.position.set(x, 1.05, z);
    }
    for (const [id, m] of this.bolts) {
      if (seen.has(id)) continue;
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      this.bolts.delete(id);
    }
  }

  /**
   * Runs every render frame. Eases positions toward the last authoritative one
   * and ticks the rigs, so animation stays at display rate even though state
   * only arrives 30 times a second.
   */
  update(dt: number) {
    for (const [id, p] of this.players) {
      const t = this.targets.get(id);
      if (t) {
        p.pos.x = damp(p.pos.x, t.x, 30, dt);
        p.pos.z = damp(p.pos.z, t.z, 30, dt);
      }
      p.stateT += dt;
      p.tick(dt, null);
    }
    for (const [id, e] of this.enemies) {
      const t = this.targets.get(-id);
      if (t) {
        e.pos.x = damp(e.pos.x, t.x, 30, dt);
        e.pos.z = damp(e.pos.z, t.z, 30, dt);
      }
      e.stateT += dt;
      e.tick(dt);
    }
  }

  /** Same contract as World.focus so the camera code is shared. */
  focus(out: THREE.Vector3): number {
    const live = this.playerList.filter((p) => !p.dead);
    const list = live.length ? live : this.playerList;
    out.set(0, 0, 0);
    if (!list.length) return 0;
    for (const p of list) out.add(p.pos);
    out.divideScalar(list.length);

    let spread = 0;
    for (const p of list)
      spread = Math.max(spread, Math.hypot(p.pos.x - out.x, p.pos.z - out.z));

    const boss = [...this.enemies.values()].find((e) => e.a.boss && !e.dead);
    if (boss) {
      out.x += (boss.pos.x - out.x) * 0.42;
      out.z += (boss.pos.z - out.z) * 0.42;
      spread = Math.max(
        spread,
        Math.hypot(boss.pos.x - out.x, boss.pos.z - out.z),
      );
    }
    out.y = 0;
    return spread;
  }

  clear() {
    for (const p of this.players.values()) this.scene.remove(p.mesh);
    for (const e of this.enemies.values()) this.scene.remove(e.mesh);
    for (const m of this.bolts.values()) this.scene.remove(m);
    this.players.clear();
    this.enemies.clear();
    this.bolts.clear();
    this.targets.clear();
    this.lastTick = -1;
  }
}
