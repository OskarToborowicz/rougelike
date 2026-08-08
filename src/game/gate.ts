import * as THREE from 'three';
import { fitToHeight, instance, loadModel } from '../render/models';
import { arenaRadius } from '../render/arena';
import { damp, TAU } from '../core/math';
import type { Player } from './player';
import type { Door, Reward, RoomKind } from './rewards';
import { ROOMS } from './rewards';
import { makeGlowTexture } from '../render/arena';

/**
 * The exit.
 *
 * A cleared chamber does not advance on its own — the gate rises at the far side
 * of the room and the party walks through it. That single beat is most of what
 * makes a Hades run feel like a series of decisions rather than a queue of
 * waves: you see where you are going, and you choose when to leave.
 */
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
      side: THREE.DoubleSide,
    });
    this.portal = new THREE.Mesh(geo, mat);
    this.portal.position.set(0, 2.15, 0);
    this.group.add(this.portal);

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

    // The reward's sigil, floating in the arch. Colour alone carries most of the
    // meaning at a glance; the HUD spells it out when you get close.
    this.symbol = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeGlowTexture('#ffffff', 0.28),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      })
    );
    this.symbol.position.set(0, 4.4, 0);
    this.symbol.scale.setScalar(1.9);
    this.group.add(this.symbol);
  }

  private marker!: THREE.Mesh;

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
    const r = arenaRadius() - 1.2;
    // Doors are spread evenly across the far wall so they are seen side by side
    // and read as alternatives, not as one exit that happens to have moved.
    const span = slots === 1 ? 0 : Math.PI * 0.5;
    const a = Math.PI + (slots === 1 ? 0 : (slot / (slots - 1) - 0.5) * span);

    this.reward = reward;
    this.room = door.room;
    this.group.position.set(Math.sin(a) * r, 0, Math.cos(a) * r);
    // Face the middle of the room.
    this.group.rotation.y = a + Math.PI;
    this.group.visible = true;
    this.open = true;
    this.entered.clear();

    const c = new THREE.Color(reward.color);
    (this.portal.material as THREE.MeshBasicMaterial).color.copy(c);
    (this.marker.material as THREE.MeshBasicMaterial).color.copy(c);
    (this.symbol.material as THREE.SpriteMaterial).color.copy(c);
    this.light.color.copy(c);
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

    this.glow = damp(this.glow, this.open ? 1 : 0, 4, dt);
    // Additive light blows out to white as it brightens, which erases the very
    // hue that tells the player what the door is worth. Kept dim enough that the
    // colour survives; the floor ring carries the rest of the read.
    (this.portal.material as THREE.MeshBasicMaterial).opacity =
      this.glow * (0.34 + Math.sin(this.t * 2.4) * 0.06);
    (this.marker.material as THREE.MeshBasicMaterial).opacity =
      this.glow * (0.7 + Math.sin(this.t * 3.1) * 0.22);
    // Pulse the marker so it reads as an invitation, not a hazard ring.
    const s = 1 + Math.sin(this.t * 2.2) * 0.07;
    this.marker.scale.set(s, 1, s);
    this.light.intensity = this.glow * 14;
    this.frameRoot.position.y = (1 - this.glow) * -5.2;
    this.symbol.scale.setScalar(this.glow * (1.8 + Math.sin(this.t * 2.6) * 0.18));
    this.symbol.position.y = 4.4 + Math.sin(this.t * 1.5) * 0.12;

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
