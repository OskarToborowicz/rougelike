import * as THREE from 'three';
import { fitToHeight, instance, loadModel } from '../render/models';
import { arenaRadius } from '../render/arena';
import { damp, TAU } from '../core/math';
import type { Player } from './player';
import type { Door, Reward, RoomKind } from './rewards';
import { ROOMS } from './rewards';
import { makeGlowTexture } from '../render/arena';
import { makeEmblem, type Emblem } from '../render/emblem';
import { PANTHEONS } from './pantheons';

/**
 * The exit.
 *
 * A cleared chamber does not advance on its own — the gate rises at the far side
 * of the room and the party walks through it. That single beat is most of what
 * makes a Hades run feel like a series of decisions rather than a queue of
 * waves: you see where you are going, and you choose when to leave.
 */
/** Centre of the doorway, and how wide the light in it reaches across. */
const PORTAL_Y = 2.15;
const PORTAL_SPAN = 3.4;

/**
 * Where the reward emblem hangs, and it is *in front of the arch*.
 *
 * gate.glb is 4.6 wide and 5.2 tall and a solid 1.34 deep — measured, its stone
 * runs `z -0.67..0.67` at every height that matters. Anything sitting on the
 * doorway's own plane is therefore inside a block of masonry, which is where
 * both the emblem and the sprite before it were: the sprite is additive with
 * `depthWrite` off, but it still depth-*tests*, so it was buried too and the
 * reward had never in fact been readable as anything but a hue.
 *
 * So: clear of the front face by a comfortable margin, and low enough to be
 * silhouetted against the lit portal rather than against the dark room. That
 * backdrop is the whole reason the emblem carries a dark stone — a bright sigil
 * on a bright doorway needs something behind it, and the arch cannot be it once
 * the emblem has stepped out in front.
 */
const EMBLEM_Y = 3.05;
/**
 * 1.45, not the 0.67 that would merely clear the stone. The emblem sways, and a
 * sway is a rotation about its own centre: at a half-width of 1.1 and an angle
 * of 0.16 the trailing corner travels 0.18 *backwards*, straight into the arch
 * it was just lifted out of. The gap has to pay for the animation as well as
 * for the geometry, and for the deepest emblem of the five — the pomegranate's
 * crown splays in z and eats the margin the flat ones never touch.
 *
 * It lands over the floor ring, which is where the party stands to leave, and
 * a shade is 2.1 tall against this hanging at 3.05 — so it is above their heads
 * at the exact spot they walk to.
 */
const EMBLEM_Z = 1.45;
/** How far the sway goes. Bounded by the clearance above — see EMBLEM_Z. */
const EMBLEM_SWAY = 0.16;

export class Gate {
  readonly group = new THREE.Group();
  open = false;
  /** What lies beyond, shown before the player commits. */
  reward: Reward | null = null;
  room: RoomKind = 'combat';
  private symbol!: THREE.Sprite;
  /** How much of the doorway is filled with light, 0..1. */
  private glow = 0;
  private portal!: THREE.Mesh;
  private frameRoot = new THREE.Group();
  private light = new THREE.PointLight(0xffd27f, 0, 14, 2);
  private t = 0;
  private ready = false;
  /** True once every live player has stepped through. */
  entered = new Set<number>();
  /**
   * Where on the far wall this door sits, kept as an angle rather than a point.
   * The arena is rebuilt whenever the party size changes — and in co-op that can
   * happen with the doors already open, when someone joins or drops — so a
   * position baked at `show` time ends up outside the new wall. The angle
   * survives the rebuild; the radius is read fresh every frame.
   */
  private angle = Math.PI;

  constructor(parent: THREE.Object3D) {
    this.group.visible = false;
    this.group.add(this.frameRoot, this.light);
    this.light.position.set(0, 2.4, 0);
    parent.add(this.group);
    this.buildPortal();
    this.loadFrame();
  }

  private buildPortal() {
    // A plane of light filling the doorway. Additive, so it reads as a way out
    // rather than a wall.
    const geo = new THREE.PlaneGeometry(3.0, 4.2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd9a0,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      /*
       * Front faces only, which matters far more here than it did for the flat
       * quad this replaces. Additive blending adds every fragment it draws, and
       * the portal disc is a closed solid — drawn double-sided with no depth
       * write, each of its eight thousand triangles laid its colour on again
       * until the whole doorway saturated to white and the reward hue, the one
       * thing a door has to communicate, was gone. Culling the back half leaves
       * a single layer, the same as a plane.
       */
      side: THREE.FrontSide,
    });
    this.portal = new THREE.Mesh(geo, mat);
    this.portal.position.set(0, PORTAL_Y, 0);
    this.group.add(this.portal);
    void this.loadPortalSurface();

    // Floor marker. The arch itself sits on the rim and can be half out of
    // frame; the ring on the ground is what actually says "walk here".
    const ring = new THREE.Mesh(
      Gate.ringGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0xffd9a0,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    ring.position.y = 0.05;
    this.marker = ring;
    this.group.add(ring);

    // The halo the emblem is read against — what used to be the entire sigil,
    // now demoted to the light behind one. On its own it was a round blob that
    // said only "a door", in a hue that has to separate seven thrones *and*
    // three other rewards from each other. See render/emblem.ts.
    this.symbol = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeGlowTexture('#ffffff', 0.28),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      })
    );
    // Just behind the emblem, so what used to be the whole sigil is now the
    // rim of light bleeding around one.
    this.symbol.position.set(0, EMBLEM_Y, EMBLEM_Z - 0.2);
    this.symbol.scale.setScalar(1.9);
    this.group.add(this.symbol);
  }

  private marker!: THREE.Mesh;
  /** The shape over the door, and the reward it was built for. */
  private emblem: Emblem | null = null;
  private emblemKey = '';

  /**
   * Rebuild the emblem, but only when the door is actually offering something
   * else. `show` runs on every chamber and the geometry is merged on the way
   * out, so re-cutting an identical numeral each time would be pure churn on a
   * frame that is already loading a room.
   */
  private setEmblem(reward: Reward) {
    const numeral = reward.pantheon ? PANTHEONS[reward.pantheon].numeral : '';
    const key = `${reward.kind}:${numeral}`;
    if (key !== this.emblemKey) {
      if (this.emblem) {
        this.group.remove(this.emblem.group);
        this.emblem.dispose();
      }
      this.emblem = makeEmblem(reward.kind, numeral || 'I');
      this.emblem.group.position.set(0, EMBLEM_Y, EMBLEM_Z);
      this.group.add(this.emblem.group);
      this.emblemKey = key;
    }
    this.emblem!.tint(new THREE.Color(reward.light));
  }

  /**
   * Swap the flat sheet of light for the sculpted portal disc.
   *
   * portal.glb is a solid round slab — no opening — so it cannot be the arch the
   * party walks through; gate.glb still does that. It is the *surface* inside the
   * arch instead, which is what it is shaped like. The material is untouched, so
   * the reward colour, the additive blend and the breathing opacity all keep
   * driving it exactly as they drove the plane.
   *
   * The geometry is never modified — every gate shares the one cached copy, and
   * the disc is centred on the doorway by moving the mesh rather than the mesh
   * data. Mutating it here would scale it again for each gate that loaded.
   */
  private async loadPortalSurface() {
    const src = await loadModel('/models/portal.glb').catch(() => null);
    // No asset, no swap: the plane of light is a complete portal on its own.
    if (!src) return;

    let found: THREE.BufferGeometry | null = null;
    src.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !found) found = m.geometry;
    });
    const geo = found as THREE.BufferGeometry | null;
    if (!geo) return;

    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    const size = new THREE.Vector3();
    box.getSize(size);
    const span = Math.max(size.x, size.y) || 1;

    const old = this.portal.geometry;
    this.portal.geometry = geo;
    old.dispose();

    const s = PORTAL_SPAN / span;
    this.portal.scale.setScalar(s);
    // The pipeline stands every model on y=0; the doorway wants it centred.
    this.portal.position.y = PORTAL_Y - ((box.min.y + box.max.y) / 2) * s;
  }

  private async loadFrame() {
    try {
      const src = await loadModel('/models/gate.glb');
      const mat = new THREE.MeshStandardMaterial({ color: 0x9b7a4e, roughness: 0.72 });
      const frame = instance(src, mat);
      fitToHeight(frame, 5.2);
      this.frameRoot.add(frame);
      this.ready = true;
    } catch {
      // Without the mesh the portal light alone still marks the exit.
      this.ready = true;
    }
  }

  /**
   * Raise the gate on the far wall.
   *
   * The camera looks from +Z, so the exit must live on the -Z half or it ends up
   * behind the lens and gets culled with the near wall — the player would be
   * told to step through a door they cannot see. Within that half it takes the
   * spot furthest from the party, so it is a walk, not a step.
   */
  show(door: Door, slot: number, slots: number) {
    const reward = door.reward;
    // Doors are spread evenly across the far wall so they are seen side by side
    // and read as alternatives, not as one exit that happens to have moved.
    const span = slots === 1 ? 0 : Math.PI * 0.5;
    const a = Math.PI + (slots === 1 ? 0 : (slot / (slots - 1) - 0.5) * span);

    this.reward = reward;
    this.room = door.room;
    this.angle = a;
    this.seat();
    // Face the middle of the room.
    this.group.rotation.y = a + Math.PI;
    this.group.visible = true;
    this.open = true;
    this.entered.clear();

    // The fire, not the stone: a throne's marble tone turns to off-white the
    // moment it becomes light, and then every door looks the same.
    const c = new THREE.Color(reward.light);
    (this.portal.material as THREE.MeshBasicMaterial).color.copy(c);
    (this.marker.material as THREE.MeshBasicMaterial).color.copy(c);
    (this.symbol.material as THREE.SpriteMaterial).color.copy(c);
    this.light.color.copy(c);
    this.setEmblem(reward);
  }

  /** Put the door back on the wall at whatever the arena measures right now. */
  private seat() {
    const r = arenaRadius() - 1.2;
    this.group.position.set(Math.sin(this.angle) * r, 0, Math.cos(this.angle) * r);
  }

  hide() {
    this.open = false;
    this.group.visible = false;
    this.glow = 0;
    this.entered.clear();
  }

  /**
   * Advance the gate and report which players are standing in the doorway.
   * The caller decides what that means — usually "everyone alive is through".
   */
  update(dt: number, players: Player[]) {
    if (!this.group.visible) return;
    this.t += dt;
    // The room may have been rebuilt under us since `show` — cheap to re-seat.
    this.seat();

    this.glow = damp(this.glow, this.open ? 1 : 0, 4, dt);
    // Additive light blows out to white as it brightens, which erases the very
    // hue that tells the player what the door is worth. Backface culling is what
    // buys the headroom to sit a little brighter than the flat plane did and
    // still keep the colour; the floor ring carries the rest of the read.
    (this.portal.material as THREE.MeshBasicMaterial).opacity =
      this.glow * (0.46 + Math.sin(this.t * 2.4) * 0.07);
    (this.marker.material as THREE.MeshBasicMaterial).opacity =
      this.glow * (0.7 + Math.sin(this.t * 3.1) * 0.22);
    // Pulse the marker so it reads as an invitation, not a hazard ring.
    const s = 1 + Math.sin(this.t * 2.2) * 0.07;
    this.marker.scale.set(s, 1, s);
    this.light.intensity = this.glow * 14;
    this.frameRoot.position.y = (1 - this.glow) * -5.2;
    const bob = EMBLEM_Y + Math.sin(this.t * 1.5) * 0.12;
    this.symbol.scale.setScalar(this.glow * (2.1 + Math.sin(this.t * 2.6) * 0.18));
    this.symbol.position.y = bob;

    if (this.emblem) {
      const e = this.emblem.group;
      e.position.y = bob;
      // A shade is 2.1 tall and this hangs at three, so it has to carry from
      // seventeen units out on its own — the arch is not framing it any more.
      e.scale.setScalar(this.glow * 1.3);
      // A sway, not a spin. Turning it through a full circle would put a roman
      // numeral edge-on for half of every rotation, and the numeral is the
      // entire message on five doors out of seven — so it rocks far enough to
      // read as an object hanging in the air and never far enough to hide.
      e.rotation.y = Math.sin(this.t * 0.9) * EMBLEM_SWAY;
      e.rotation.z = Math.sin(this.t * 1.3) * 0.05;
    }

    if (!this.ready || this.glow < 0.6) return;

    for (const p of players) {
      if (p.dead) continue;
      const dx = p.pos.x - this.group.position.x;
      const dz = p.pos.z - this.group.position.z;
      if (Math.hypot(dx, dz) < 1.9) this.entered.add(p.id);
      else this.entered.delete(p.id);
    }
  }

  /** Everyone still standing is in the doorway. */
  allThrough(players: Player[]) {
    const live = players.filter((p) => !p.dead);
    return live.length > 0 && live.every((p) => this.entered.has(p.id));
  }

  /** How many are waiting, for the prompt. */
  progress(players: Player[]) {
    const live = players.filter((p) => !p.dead);
    return { in: live.filter((p) => this.entered.has(p.id)).length, of: live.length };
  }

  /** "ELITE · BOON OF ARES" — the room you are walking into and what it pays. */
  get caption() {
    const room = ROOMS[this.room].label;
    return this.reward ? `${room} · ${this.reward.label}` : room;
  }

  get position() {
    return this.group.position;
  }

  get isVisible() {
    return this.group.visible;
  }

  /** Marker ring on the floor so the exit reads from across the arena. */
  static ringGeometry() {
    return new THREE.RingGeometry(1.5, 1.9, 32).rotateX(-Math.PI / 2);
  }

  static readonly TAU = TAU;
}
