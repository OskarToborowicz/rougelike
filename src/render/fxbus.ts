import type { Vfx } from './vfx';
import type { Stage } from './scene';
import type { WireFx } from '../net/protocol';

/**
 * Every visual flourish goes through here instead of straight to Vfx.
 *
 * Locally it just plays. On a host it also records the call, so guests can
 * replay the exact same sparks, arcs and shakes without simulating anything.
 * Snapshots carry positions; this carries the *moments*, which is what actually
 * makes a hit feel like a hit.
 */
export class FxBus {
  /** Set on the host once a guest is present. */
  record = false;
  private log: WireFx[] = [];

  constructor(private vfx: Vfx, private stage: Stage) {}

  slash(
    x: number,
    z: number,
    facing: number,
    arc: number,
    reach: number,
    color: number,
    life = 0.2
  ) {
    this.vfx.slash(x, z, facing, arc, reach, color, life);
    if (this.record) this.log.push(['slash', r(x), r(z), r(facing), r(arc), r(reach), color, r(life)]);
  }

  hitSpark(x: number, z: number, dirX: number, dirZ: number, color = '#ffd98a', power = 1) {
    this.vfx.hitSpark(x, z, dirX, dirZ, color, power);
    if (this.record) this.log.push(['spark', r(x), r(z), r(dirX), r(dirZ), color, r(power)]);
  }

  bloodBurst(x: number, z: number, color = '#c0304a', power = 1) {
    this.vfx.bloodBurst(x, z, color, power);
    if (this.record) this.log.push(['burst', r(x), r(z), color, r(power)]);
  }

  dashTrail(x: number, z: number, color = '#7fd6ff') {
    this.vfx.dashTrail(x, z, color);
    if (this.record) this.log.push(['trail', r(x), r(z), color]);
  }

  ring(x: number, z: number, color: number, radius: number, life = 0.35) {
    this.vfx.ring(x, z, color, radius, life);
    if (this.record) this.log.push(['ring', r(x), r(z), color, r(radius), r(life)]);
  }

  shake(amp: number) {
    this.stage.shake(amp);
    if (this.record) this.log.push(['shake', r(amp)]);
  }

  /** Hand the tick's events to the snapshot and start a fresh log. */
  drain(): WireFx[] {
    if (!this.log.length) return [];
    const out = this.log;
    this.log = [];
    return out;
  }

  /** Guest side: play back what the host recorded. */
  replay(events: WireFx[]) {
    for (const e of events) {
      switch (e[0]) {
        case 'slash':
          this.vfx.slash(e[1], e[2], e[3], e[4], e[5], e[6], e[7]);
          break;
        case 'spark':
          this.vfx.hitSpark(e[1], e[2], e[3], e[4], e[5], e[6]);
          break;
        case 'burst':
          this.vfx.bloodBurst(e[1], e[2], e[3], e[4]);
          break;
        case 'ring':
          this.vfx.ring(e[1], e[2], e[3], e[4], e[5]);
          break;
        case 'trail':
          this.vfx.dashTrail(e[1], e[2], e[3]);
          break;
        case 'shake':
          this.stage.shake(e[1]);
          break;
      }
    }
  }
}

/** Two decimals — plenty for a position that will be interpolated anyway. */
const r = (n: number) => Math.round(n * 100) / 100;
