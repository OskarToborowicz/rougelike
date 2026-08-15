import { t } from "../ui/i18n";

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
  weapon: "sword" | "bow" | "book";
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
    // Text is read through getters so a language change lands the next time
    // anything renders, rather than at module load. See ui/i18n.ts.
    get name() {
      return t("class.warrior.name");
    },
    get title() {
      return t("class.warrior.title");
    },
    get blurb() {
      return t("class.warrior.blurb");
    },
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
    get name() {
      return t("class.archer.name");
    },
    get title() {
      return t("class.archer.title");
    },
    get blurb() {
      return t("class.archer.blurb");
    },
    attack: "bolt",
    maxHp: 82,
    speed: 9.1,
    // The shot leaves almost instantly and the long recover *is* the next arrow
    // being drawn. Damage per shot is up to pay for it, so the class still
    // trades evenly at range despite firing less often than the warrior swings.
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
    weapon: "bow",
  },

  mage: {
    id: "mage",
    get name() {
      return t("class.mage.name");
    },
    get title() {
      return t("class.mage.title");
    },
    get blurb() {
      return t("class.mage.blurb");
    },
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
    weapon: "book",
  },
};

export const CLASS_ORDER: ClassId[] = ["warrior", "archer", "mage"];
