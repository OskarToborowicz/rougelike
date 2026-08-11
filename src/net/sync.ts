import * as THREE from "three";
import type { World } from "../game/world";
import { Player, PLAYER_TINTS, type PlayerState } from "../game/player";
import { Enemy, STATUS_KINDS, type EnemyKind, type EnemyState } from "../game/enemy";
import { BoonSet } from "../game/boons";
import { CLASS_ORDER } from "../game/classes";
import type { FxBus } from "../render/fxbus";
import { clamp } from "../core/math";
import { stepMovement } from "../game/locomotion";
import type { Frame as FrameInput } from "../core/input";
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
  acks: [number, number][],
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
    r(p.speed * p.boons.moveMul),
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
    e.statusBits,
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
    acks,
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
/** One entity's authoritative transform at a point in time. */
interface Pose {
  x: number;
  z: number;
}

/** A received snapshot, stamped on arrival so no clock sync is needed. */
interface Keyframe {
  t: number;
  poses: Map<number, Pose>;
}

/**
 * How far behind the newest snapshot the guest renders other players.
 *
 * Rendering the instant a packet lands means every hitch in the network shows up
 * as a stutter in the world. Holding ~110ms of buffer means there is almost
 * always a *next* keyframe to interpolate toward, so motion stays smooth and
 * only latency — not jitter — is visible.
 */
const INTERP_MS = 110;

export class RemoteView {
  players = new Map<number, Player>();
  enemies = new Map<number, Enemy>();
  private bolts = new Map<number, THREE.Mesh>();
  private history: Keyframe[] = [];
  /** Inputs this client has predicted but the host has not confirmed. */
  private pending: { seq: number; frame: FrameInput; dt: number }[] = [];
  /** Authoritative pose of the local shade, from the newest snapshot. */
  private localAuth: Pose | null = null;
  private lastAck = 0;
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

    /** Authoritative poses carried by this snapshot, keyed by entity id. */
    const poses = new Map<number, Pose>();

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
        moveSpeed,
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
        // Replicated shades still walk on this client's rig, so they get their
        // footsteps from it rather than from the host's packets.
        p.onStep = (sx, sz, speed) => this.fx.sfx('step', sx, sz, clamp(speed / 8, 0.4, 1.2));
        this.players.set(id, p);
        this.scene.add(p.mesh);
      }
      p.usingSpecial = !!spec;
      poses.set(id, { x, z });
      // The local shade's facing is predicted, not replicated — it follows the
      // mouse with zero latency and the host agrees a moment later anyway.
      if (id !== this.myPlayerId) p.facing = facing;
      p.hp = hp;
      p.maxHp = maxHp;
      p.state = PLAYER_STATES[st] ?? "idle";
      p.dead = !!dead;
      p.castAmmo = ammo;
      p.callGauge = call;
      p.reviveProgress = revive;
      p.iframes = iframes;
      // Folded into `speed` with moveMul left at 1, so the predictor uses the
      // host's effective figure without needing to know the boons behind it.
      if (moveSpeed) p.speed = moveSpeed;
    }
    for (const [id, p] of this.players) {
      if (seenP.has(id)) continue;
      this.scene.remove(p.mesh);
      this.players.delete(id);
    }

    const seenE = new Set<number>();
    for (const w of snap.enemies) {
      const [id, kindIdx, x, z, facing, hp, maxHp, st, dead, enraged, flash, statusBits] =
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
      poses.set(-id, { x, z });
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
      // Statuses are host-authoritative, so the guest holds no timers of its
      // own — it just re-stamps a lifetime slightly longer than the packet
      // interval. The next snapshot either renews it or lets it lapse.
      STATUS_KINDS.forEach((k, i) => {
        e!.status[k] = (statusBits ?? 0) & (1 << i) ? 0.2 : 0;
      });
    }
    for (const [id, e] of this.enemies) {
      if (seenE.has(id)) continue;
      this.scene.remove(e.mesh);
      this.enemies.delete(id);
    }

    // Buffer the authoritative poses; `update` renders slightly in the past and
    // interpolates between the two keyframes straddling that moment.
    this.history.push({ t: performance.now(), poses });
    while (this.history.length > 24) this.history.shift();

    this.localAuth = poses.get(this.myPlayerId) ?? null;
    this.lastAck = snap.acks?.find(([netId]) => netId === myNetId)?.[1] ?? this.lastAck;
    this.reconcile();

    this.syncBolts(snap.projectiles);
    this.fx.replay(snap.fx);
  }

  /**
   * Rewind the local shade to the last position the host confirmed, then replay
   * every input the host has not seen yet.
   *
   * This is what makes prediction honest: the client is always exactly the
   * authoritative state plus its own unacknowledged moves, so a disagreement
   * resolves in one frame instead of rubber-banding.
   */
  private reconcile() {
    const p = this.players.get(this.myPlayerId);
    if (!p || !this.localAuth) return;

    // Drop everything the host has already folded into the snapshot.
    while (this.pending.length && this.pending[0].seq <= this.lastAck) this.pending.shift();

    const replayed = {
      pos: { x: this.localAuth.x, y: 0, z: this.localAuth.z },
      vel: { x: p.vel.x, y: 0, z: p.vel.z },
      facing: p.facing,
      radius: p.radius,
      speed: p.speed,
      state: p.state as string,
      stateT: p.stateT,
      stagger: p.stagger,
    };
    for (const step of this.pending) {
      stepMovement(replayed, step.frame, step.dt, p.boons.moveMul);
    }

    // A small disagreement is smoothed away over the next few frames; a large
    // one means we were wrong about something real, so take the host's word.
    const err = Math.hypot(replayed.pos.x - p.pos.x, replayed.pos.z - p.pos.z);
    if (err > 2.5) {
      p.pos.set(replayed.pos.x, 0, replayed.pos.z);
      p.vel.set(replayed.vel.x, 0, replayed.vel.z);
    } else {
      this.correction.x = replayed.pos.x - p.pos.x;
      this.correction.z = replayed.pos.z - p.pos.z;
    }
  }

  private correction = { x: 0, z: 0 };

  /**
   * Predict one frame of the local shade from local input, before the host has
   * seen it. Called every render frame; `seq` is the packet the input went out
   * on, or null when the frame was not sent.
   */
  predictLocal(dt: number, frame: FrameInput | null, seq: number | null) {
    const p = this.players.get(this.myPlayerId);
    if (!p) return;

    // Only a living shade with input drives itself forward.
    if (!p.dead && frame) {
      stepMovement(p, frame, dt, p.boons.moveMul);
      p.facing = Math.atan2(frame.aimX, frame.aimY);
      if (seq !== null) this.pending.push({ seq, frame, dt });
      // Roughly two seconds of unacked input; past that the link is gone.
      while (this.pending.length > 120) this.pending.shift();
    }

    // The correction is bled off unconditionally. Gating it on having input
    // meant a standing or downed player kept a stale offset forever, and the
    // one place it matters most — a corpse waiting to be revived — never
    // converged on where the host actually put it.
    const k = Math.min(1, dt * 9);
    p.pos.x += this.correction.x * k;
    p.pos.z += this.correction.z * k;
    this.correction.x -= this.correction.x * k;
    this.correction.z -= this.correction.z * k;
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
   * Runs every render frame. Other entities are interpolated from the keyframe
   * buffer; the local shade keeps whatever prediction already put there.
   */
  update(dt: number) {
    const sample = this.sampleAt(performance.now() - INTERP_MS);

    for (const [id, p] of this.players) {
      // The local shade is predicted, never interpolated — replaying its own
      // input is what removes the round-trip from its movement.
      if (id !== this.myPlayerId) {
        const pose = sample.get(id);
        if (pose) {
          p.pos.x = pose.x;
          p.pos.z = pose.z;
        }
      }
      p.stateT += dt;
      p.tick(dt, null);
    }
    for (const [id, e] of this.enemies) {
      const pose = sample.get(-id);
      if (pose) {
        e.pos.x = pose.x;
        e.pos.z = pose.z;
      }
      e.stateT += dt;
      e.tick(dt);
    }
  }

  /**
   * Positions at an arbitrary moment, interpolated between the two keyframes
   * that straddle it. Falls back to the newest keyframe when the buffer has run
   * dry — a stalled connection then looks like motion stopping, rather than
   * entities teleporting when it resumes.
   */
  private sampleAt(when: number): Map<number, Pose> {
    if (!this.history.length) return new Map();
    const newest = this.history[this.history.length - 1];
    if (when >= newest.t || this.history.length === 1) return newest.poses;

    let a = this.history[0];
    let b = newest;
    for (let i = 0; i < this.history.length - 1; i++) {
      if (this.history[i].t <= when && this.history[i + 1].t >= when) {
        a = this.history[i];
        b = this.history[i + 1];
        break;
      }
    }
    const span = b.t - a.t;
    const alpha = span > 0 ? clamp((when - a.t) / span, 0, 1) : 1;

    const out = new Map<number, Pose>();
    for (const [id, pa] of a.poses) {
      const pb = b.poses.get(id);
      // An id in only one keyframe just spawned or died; hold it still rather
      // than sliding it in from wherever it happens to be missing.
      if (!pb) {
        out.set(id, pa);
        continue;
      }
      out.set(id, {
        x: pa.x + (pb.x - pa.x) * alpha,
        z: pa.z + (pb.z - pa.z) * alpha,
      });
    }
    for (const [id, pb] of b.poses) if (!out.has(id)) out.set(id, pb);
    return out;
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
    this.history.length = 0;
    this.pending.length = 0;
    this.localAuth = null;
    this.lastAck = 0;
    this.correction.x = 0;
    this.correction.z = 0;
    this.lastTick = -1;
  }
}
