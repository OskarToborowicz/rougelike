export type ClassId = "warrior" | "archer" | "mage";

export interface AttackShape {
  wind: number;
  active: number;
  recover: number;
  /** Melee sweep width in radians. Ignored by ranged attacks. */
  arc: number;
  reach: number;
  dmg: number;
  push: number;
}

export interface ClassDef {
  id: ClassId;
  name: string;
  title: string;
  blurb: string;
  /** How the basic attack resolves. */
  attack: "melee" | "bolt" | "orb";
  maxHp: number;
  speed: number;
  /** Combo chain for the basic attack; ranged classes use a single entry. */
  combo: AttackShape[];
  /** The heavy attack on RMB. */
  special: AttackShape & { kind: "melee" | "volley" | "nova" };
  /** Colour of this class's weapon trails and projectiles. */
  accent: number;
  castDamage: number;
  weapon: "sword" | "crossbow" | "staff";
}

/**
 * Three ways to fight the same rooms.
 *
 * Warrior wants to be inside the pack, marksman wants a lane, mage wants the pack
 * clustered. Health and speed are tuned so the safest range is also the lowest
 * damage — standing where it hurts should pay.
 */
export const CLASSES: Record<ClassId, ClassDef> = {
  warrior: {
    id: "warrior",
    name: "WARRIOR",
    title: "Ares-sworn",
    blurb:
      "Blade and dash. Toughest of the three, and the only one who heals by closing in.",
    attack: "melee",
    maxHp: 110,
    speed: 8.2,
    combo: [
      {
        wind: 0.07,
        active: 0.09,
        recover: 0.14,
        arc: 2.0,
        reach: 2.5,
        dmg: 12,
        push: 5,
      },
      {
        wind: 0.06,
        active: 0.09,
        recover: 0.14,
        arc: 2.2,
        reach: 2.6,
        dmg: 13,
        push: 6,
      },
      {
        wind: 0.11,
        active: 0.12,
        recover: 0.3,
        arc: 3.0,
        reach: 3.1,
        dmg: 22,
        push: 13,
      },
    ],
    special: {
      kind: "melee",
      wind: 0.14,
      active: 0.14,
      recover: 0.34,
      arc: 3.4,
      reach: 3.6,
      dmg: 30,
      push: 18,
    },
    accent: 0xffd08a,
    castDamage: 26,
    weapon: "sword",
  },

  archer: {
    id: "archer",
    name: "MARKSMAN",
    title: "Artemis-sworn",
    blurb:
      "Crossbow bolts that punch through a line. Fragile and fastest on foot, but every shot costs a reload.",
    attack: "bolt",
    maxHp: 82,
    speed: 9.1,
    // A crossbow trades the bow's rhythm for weight: the shot leaves almost
    // instantly, then the long recover *is* the reload. Damage per bolt is up so
    // the class still trades evenly at range despite firing less often.
    combo: [
      {
        wind: 0.04,
        active: 0.04,
        recover: 0.34,
        arc: 0.2,
        reach: 18,
        dmg: 21,
        push: 5,
      },
    ],
    special: {
      kind: "volley",
      wind: 0.2,
      active: 0.06,
      recover: 0.52,
      arc: 0.5,
      reach: 18,
      dmg: 15,
      push: 4,
    },
    accent: 0x9ee06a,
    castDamage: 22,
    weapon: "crossbow",
  },

  mage: {
    id: "mage",
    name: "MAGE",
    title: "Zeus-sworn",
    blurb: "Slow, heavy orbs that burst on impact. Weakest body, largest hits.",
    attack: "orb",
    maxHp: 76,
    speed: 7.4,
    combo: [
      {
        wind: 0.12,
        active: 0.05,
        recover: 0.24,
        arc: 0.2,
        reach: 15,
        dmg: 19,
        push: 6,
      },
    ],
    special: {
      kind: "nova",
      wind: 0.26,
      active: 0.1,
      recover: 0.44,
      arc: Math.PI * 2,
      reach: 5.0,
      dmg: 34,
      push: 15,
    },
    accent: 0xb07cff,
    castDamage: 34,
    weapon: "staff",
  },
};

export const CLASS_ORDER: ClassId[] = ["warrior", "archer", "mage"];
