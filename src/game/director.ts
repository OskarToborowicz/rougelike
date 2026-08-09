import type { World } from './world';
import type { EnemyKind } from './enemy';
import { randInt } from '../core/math';
import { biomeForDepth } from '../render/biome';
import { ROOMS, type RoomKind } from './rewards';

interface Wave {
  kind: EnemyKind;
  count: number;
}

/**
 * Chamber pacing: a few short waves, each one arriving as the last thins out,
 * so there is never a dead pause but never a wall either.
 */
export class Director {
  depth = 1;
  waveIndex = 0;
  waves: Wave[][] = [];
  private spawnTimer = 0;
  private queue: EnemyKind[] = [];
  chamberDone = false;

  constructor(private world: World, private playerCount: () => number) {
    this.buildChamber();
  }

  /** Every fifth chamber is a boss. Nothing else spawns; she is the encounter. */
  get isBossChamber() {
    return this.depth % 5 === 0;
  }

  /** Set by the door the party chose; shapes the fight they walk into. */
  room: RoomKind = 'combat';

  buildChamber() {
    const d = this.depth;
    const style = ROOMS[this.isBossChamber ? 'boss' : this.room];
    const scale = (1 + (this.playerCount() - 1) * 0.7) * style.density;
    const waves: Wave[][] = [];

    if (this.isBossChamber) {
      // Each region has its own guardian. The champions arrive as a pair —
      // that is the whole point of the fight.
      const boss = biomeForDepth(d).boss;
      this.waves = [[{ kind: boss, count: boss === 'champion' ? 2 : 1 }]];
      this.waveIndex = 0;
      this.chamberDone = false;
      this.queue = [];
      this.loadWave(0);
      return;
    }

    const n = Math.min(3, 1 + Math.floor(d / 2));
    for (let w = 0; w < n; w++) {
      const wave: Wave[] = [];
      wave.push({ kind: 'wretch', count: Math.round((2 + d * 0.6 + w) * scale) });
      if (d >= 2 && w >= 1) wave.push({ kind: 'lobber', count: Math.round((1 + d * 0.25) * scale) });
      if (d >= 3 && w === n - 1) wave.push({ kind: 'brute', count: Math.max(1, Math.round((d / 4) * scale)) });
      waves.push(wave);
    }
    this.waves = waves;
    this.waveIndex = 0;
    this.chamberDone = false;
    this.queue = [];
    this.championsPlaced = 0;
    this.loadWave(0);
  }

  /**
   * Bosses are placed, not scattered. The hydra is rooted so it owns the centre;
   * the champions arrive on opposite sides so the party cannot fight both at once.
   */
  private bossSpot(kind: EnemyKind): { x: number; z: number } | null {
    if (kind === 'hydra') return { x: 0, z: -2 };
    if (kind === 'champion') {
      this.championsPlaced++;
      return this.championsPlaced === 1 ? { x: -5.5, z: -3 } : { x: 5.5, z: -3 };
    }
    return null;
  }

  private championsPlaced = 0;

  private loadWave(i: number) {
    const wave = this.waves[i];
    if (!wave) return;
    this.queue = [];
    for (const w of wave) for (let k = 0; k < w.count; k++) this.queue.push(w.kind);
    this.spawnTimer = 0.25;
  }

  get biome() {
    return biomeForDepth(this.depth);
  }

  /**
   * A token, not a sentence: it travels to guests in every snapshot, and a guest
   * playing in another language must render it in *theirs*. Formatted for the
   * screen by `waveLabel()` in ui/i18n.ts.
   *
   *   `cleared` · `boss` · `wave:<room>:<index>:<count>`
   */
  get label() {
    if (this.chamberDone) return 'cleared';
    if (this.isBossChamber) return 'boss';
    const i = Math.min(this.waveIndex + 1, this.waves.length);
    return `wave:${this.room}:${i}:${this.waves.length}`;
  }

  /** Enemy strength multiplier for the current room type. */
  get strength() {
    return ROOMS[this.isBossChamber ? 'boss' : this.room].strength;
  }

  update(dt: number) {
    if (this.chamberDone) return;

    if (this.queue.length) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        // Trickle spawns in pairs — a wall of simultaneous pop-ins reads as cheap.
        const burst = randInt(1, 2);
        for (let i = 0; i < burst && this.queue.length; i++) {
          const kind = this.queue.shift()!;
          const p = this.bossSpot(kind) ?? this.world.randomSpawnPoint(kind === 'lobber' ? 8 : 5.5);
          this.world.spawnEnemy(kind, p.x, p.z).empower(this.strength);
        }
        this.spawnTimer = 0.32;
      }
      return;
    }

    if (this.world.enemies.length === 0) {
      if (this.waveIndex + 1 < this.waves.length) {
        this.waveIndex++;
        this.loadWave(this.waveIndex);
        this.spawnTimer = 1.1;
      } else {
        this.chamberDone = true;
      }
    }
  }

  nextChamber() {
    this.depth++;
    this.buildChamber();
  }
}
