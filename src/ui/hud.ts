import * as THREE from 'three';
import type { Player } from '../game/player';
import type { Enemy } from '../game/enemy';
import type { DamageEvent } from '../game/world';
import { clamp } from '../core/math';
import { ROOMS, type RoomKind } from '../game/rewards';
import { PANTHEONS, pantheonName, roundel } from '../game/pantheons';
import { BoonSet, boonById } from '../game/boons';
import { hammerById, hammerColor, hammerSlotLabel } from '../game/hammers';
import { ascendancyById } from '../game/ascendancy';
import type { StatusKind } from '../game/enemy';
import type { ClassId } from '../game/classes';
import { onLanguageChange, roman, t, type Key } from './i18n';
import { ascArt, godArt, shadeArt } from './art';

const el = (tag: string, cls?: string, text?: string) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/**
 * Turn the director's wave token into a line of text. The token travels to
 * guests in every snapshot precisely so each client can render it in its own
 * language — see Director.label.
 */
export function waveLabel(token: string) {
  if (token === 'cleared') return t('wave.cleared');
  if (token === 'boss') return t('wave.boss');
  const [, room, i, n] = token.split(':');
  if (!i) return token;
  const wave = t('wave.n', { i, n });
  return room && room !== 'combat' ? `${ROOMS[room as RoomKind].label} · ${wave}` : wave;
}

/** How many wave diamonds to draw, and how many are behind you. */
function waveCount(token: string): [number, number] {
  if (token === 'cleared' || token === 'boss') return [1, 1];
  const [, , i, n] = token.split(':');
  const of = Number(n);
  return Number.isFinite(of) && of > 0 ? [Number(i) || 0, of] : [0, 0];
}

/** Anything the card chooser can display. */
export interface Card {
  id: string;
  name: string;
  desc: string;
  /** Small label above the name — a throne, a slot, a rival's interruption. */
  kicker: string;
  accent: string;
  /** Drawn in the rival's own colour rather than the screen's amber. */
  rival?: boolean;
  /**
   * A fork in the class rather than another card on the pile. Drawn heavier,
   * because it is the one pick in a run that cannot be added to later.
   */
  branch?: boolean;
  /** Levels held, and levels on the track, for a boon being stacked. */
  pips?: number;
  pipsOf?: number;
}

/** Everything the offer screen shows besides the cards themselves. */
export interface OfferView {
  /** The god's name, or HAMMER / EMPOWER for the rounds without one. */
  title: string;
  accent: string;
  subtitle: string;
  epithet?: string;
  quote?: string;
  /** The throne behind the god: its numeral, its metal, and the line under it. */
  numeral?: string;
  roundel?: string;
  ink?: string;
  throne?: string;
  /** God id, or ascendancy id, for the plate art. */
  art?: string;
  /** Which roster `art` names. Gods are the default because they came first. */
  artKind?: 'god' | 'asc';
}

interface SeatUi {
  seat: number;
  cls: ClassId;
  /** The cell that owns the downed class — the ally box, or the plate itself. */
  root: HTMLElement;
  plate: HTMLElement;
  hp: HTMLElement;
  revive: HTMLElement;
  name: HTMLElement;
  /** Only the local shade has these. */
  sworn?: HTMLElement;
  pips?: HTMLElement;
  boons?: HTMLElement;
  lore?: HTMLElement;
  fallen?: HTMLElement;
  lastBoonCount: number;
}

// --------------------------------------------------------------- the build

/** The three slots a status can ride on. */
const SLOTS = ['attack', 'special', 'cast'] as const;
type Slot = (typeof SLOTS)[number];

/**
 * Which statuses a single card grants, found by running its own `apply` on a
 * throwaway BoonSet.
 *
 * Read rather than declared: a boon's promise lives in its `apply` and nowhere
 * else, and a second table saying what each one does is a table that goes stale
 * the first time somebody retunes a card without updating it.
 */
function statusesOf(apply: (b: BoonSet) => void): Partial<Record<Slot, StatusKind>> {
  const probe = new BoonSet();
  apply(probe);
  const out: Partial<Record<Slot, StatusKind>> = {};
  if (probe.statusOnAttack) out.attack = probe.statusOnAttack;
  if (probe.statusOnSpecial) out.special = probe.statusOnSpecial;
  if (probe.statusOnCast) out.cast = probe.statusOnCast;
  return out;
}

/** One card the shade is actually holding. */
interface Held {
  kind: 'boon' | 'hammer' | 'asc' | 'capstone';
  key: string;
  name: string;
  desc: string;
  /** Small line above the name: the throne, the slot, the branch. */
  kicker: string;
  accent: string;
  numeral?: string;
  roundel?: string;
  ink?: string;
  /** How many times taken. Only a boon is ever above one. */
  level: number;
  /** What this card puts on each slot, if anything. */
  sets: Partial<Record<Slot, StatusKind>>;
  /** Slots whose status this card set but no longer owns. */
  overruled: Slot[];
}

/**
 * The build, read back out of the order it was assembled in.
 *
 * The picks are walked rather than the BoonSet, because the BoonSet is a sum and
 * a sum cannot say what it replaced. A status is last-write-wins: take shock on
 * your Attack and then burn on your Attack and the shock is simply gone, with
 * nothing on screen ever having said so. Walking the order is what recovers
 * which card currently owns each slot — and therefore which cards are holding a
 * promise the build no longer keeps.
 */
function readBuild(p: Player) {
  const held: Held[] = [];
  const byKey = new Map<string, Held>();
  /** Slot -> key of the card that set it most recently. */
  const owner: Partial<Record<Slot, string>> = {};
  /** Every slot each card ever set, so supersession can be worked out at the end. */
  const claimed = new Map<string, Set<Slot>>();

  const note = (h: Held, sets: Partial<Record<Slot, StatusKind>>) => {
    const mine = claimed.get(h.key) ?? new Set<Slot>();
    for (const s of SLOTS) {
      if (!sets[s]) continue;
      owner[s] = h.key;
      mine.add(s);
    }
    claimed.set(h.key, mine);
  };

  const add = (h: Held, sets: Partial<Record<Slot, StatusKind>>) => {
    h.sets = sets;
    const seen = byKey.get(h.key);
    if (seen) {
      seen.level++;
    } else {
      byKey.set(h.key, h);
      held.push(h);
    }
    note(byKey.get(h.key)!, sets);
  };

  for (const pick of p.picks) {
    if (pick[0] === 'b') {
      const b = boonById(pick[1]);
      if (!b) continue;
      const th = PANTHEONS[b.pantheon];
      add(
        {
          kind: 'boon',
          key: 'b:' + b.id,
          name: b.name,
          desc: b.desc,
          kicker: pantheonName(b.pantheon),
          accent: th.css,
          numeral: th.numeral,
          roundel: roundel(b.pantheon),
          ink: th.ink,
          level: 1,
          sets: {},
          overruled: [],
        },
        statusesOf(b.apply)
      );
    } else if (pick[0] === 'h') {
      const h = hammerById(pick[1]);
      if (!h) continue;
      add(
        {
          kind: 'hammer',
          key: 'h:' + h.id,
          name: h.name,
          desc: h.desc,
          kicker: hammerSlotLabel(h),
          accent: hammerColor(h),
          level: 1,
          sets: {},
          overruled: [],
        },
        statusesOf(h.apply)
      );
    } else if (pick[0] === 'a') {
      const a = ascendancyById(pick[1]);
      if (!a) continue;
      add(
        {
          kind: 'asc',
          key: 'a:' + a.id,
          name: a.name,
          desc: a.desc,
          kicker: a.title,
          accent: a.css,
          level: 1,
          sets: {},
          overruled: [],
        },
        statusesOf(a.apply)
      );
    } else if (p.asc) {
      const c = p.asc.capstone;
      add(
        {
          kind: 'capstone',
          key: 'c:' + c.id,
          name: c.name,
          desc: c.desc,
          kicker: p.asc.name,
          accent: p.asc.css,
          level: 1,
          sets: {},
          overruled: [],
        },
        statusesOf(c.apply)
      );
    }
  }

  for (const h of held) {
    h.overruled = [...(claimed.get(h.key) ?? [])].filter((s) => owner[s] !== h.key);
  }

  return { held, owner };
}

/**
 * What every card adds up to.
 *
 * Only the figures that accumulate from more than one place — those are the ones
 * no single card can tell you, and the reason this section exists at all. A flag
 * granted once, like a second Special or the plague, is already spelled out by
 * the card that granted it and is not repeated here.
 *
 * Anything still sitting at its starting value is left out entirely: a list of
 * things you did not take is a list nobody reads.
 */
function totals(p: Player): [string, string][] {
  const b = p.boons;
  const rows: [string, string][] = [];
  const pct = (n: number) => `${n >= 0 ? '+' : ''}${Math.round(n * 100)}%`;
  const put = (key: string, on: boolean, value: string) => {
    if (on) rows.push([t(key as Key), value]);
  };

  rows.push([t('sheet.hp'), String(p.maxHp)]);
  put('sheet.attack', b.attackMul !== 1, pct(b.attackMul - 1));
  put('sheet.special', b.specialMul !== 1, pct(b.specialMul - 1));
  put('sheet.cast', b.castMul !== 1, pct(b.castMul - 1));
  // Lower is faster, which is the opposite of how it should read on a sheet.
  put('sheet.attackSpeed', b.attackSpeedMul !== 1, pct(1 - b.attackSpeedMul));
  put('sheet.reach', b.attackReachMul !== 1, pct(b.attackReachMul - 1));
  put('sheet.move', b.moveMul !== 1, pct(b.moveMul - 1));
  put('sheet.crit', b.critChance !== 0.05, `${Math.round(b.critChance * 100)}%`);
  put('sheet.critMul', b.critMul !== 2, `×${b.critMul.toFixed(1)}`);
  put('sheet.lifesteal', b.lifesteal > 0, `${Math.round(b.lifesteal * 100)}%`);
  put('sheet.ammo', b.extraCastAmmo > 0, `+${b.extraCastAmmo}`);
  put('sheet.attackPierce', b.attackPierce > 0, `+${b.attackPierce}`);
  put('sheet.castPierce', b.castPierce > 0, `+${b.castPierce}`);
  return rows;
}

/** Seat colours, as CSS. Matches PLAYER_TINTS in game/player.ts. */
const PLATE_TINTS = ['#ff6a3d', '#4fc3ff', '#9d6bff', '#5fe08a'];

const ROMAN_SMALL = ['I', 'II', 'III'];

/**
 * What a plate shows while its portrait is missing. The seat number, not the
 * name's first letter — every seat is labelled "P1 · WARRIOR" and so every
 * plate came out reading "P".
 */
const seatSigil = (index: number) => String(index + 1);

export class Hud {
  private root = document.getElementById('ui')!;
  private seats: SeatUi[] = [];

  private camera = el('div', 'e-camera');
  private waves = el('div');
  private purse = el('div');
  private purseCount = el('span');

  private shades = el('div', 'e-shades');
  private allies = el('div', 'e-allies');
  private concord = el('div');
  private concordCall = el('div', 'e-call-to', t('hud.concord'));

  private choice = el('div');
  private banner = el('div');
  private hurt = el('div');
  private boss = el('div');
  private bossFill = el('i');
  private bossLag = el('i');
  private bossTitle = el('div');
  private gatePrompt = el('div');
  private sheet = el('div');
  private v3 = new THREE.Vector3();

  /**
   * Which seat gets the big plate and the build panel. Seat 0 for a host or a
   * solo run; a guest is told its own once the first snapshot lands.
   */
  private localSeat = 0;

  constructor() {
    const vignette = el('div');
    vignette.id = 'vignette';
    this.root.appendChild(vignette);

    this.hurt.id = 'hurtflash';
    this.root.appendChild(this.hurt);

    // --- top centre: the chamber, and how far through it you are ---------
    const top = el('div');
    top.id = 'e-top';
    const line = el('div', 'e-top-line');
    line.append(el('div', 'e-hair left'), this.camera, el('div', 'e-hair right'));
    this.waves.id = 'e-waves';
    top.append(line, this.waves);
    this.root.appendChild(top);

    // --- top right: obols banked this climb ---------------------------
    this.purse.id = 'e-purse';
    this.purse.append(el('span', 'e-obol'), this.purseCount);
    this.root.appendChild(this.purse);

    this.boss.id = 'boss';
    const bar = el('div', 'bbar');
    this.bossLag.className = 'lag';
    bar.append(this.bossLag, this.bossFill);
    this.bossTitle.className = 'btitle';
    this.boss.append(this.bossTitle, bar);
    this.root.appendChild(this.boss);

    this.root.append(this.shades, this.allies);

    // --- bottom centre: the shared hold ---------------------------------
    this.concord.id = 'e-concord';
    const link = el('div', 'e-link');
    link.append(el('i'), el('i', 'e-thread'), el('i'));
    (link.firstChild as HTMLElement).style.background =
      'linear-gradient(160deg,#f4e3ae,#c9a227 50%,#6d5214)';
    (link.lastChild as HTMLElement).style.background =
      'linear-gradient(160deg,#f6b98a,#c06a2e 50%,#653a18)';
    this.concord.append(link, this.concordCall);
    this.root.appendChild(this.concord);

    this.choice.id = 'choice';
    this.root.appendChild(this.choice);

    this.banner.id = 'banner';
    this.root.appendChild(this.banner);

    this.sheet.id = 'e-sheet';
    this.root.appendChild(this.sheet);

    this.gatePrompt.id = 'gateprompt';
    this.root.appendChild(this.gatePrompt);

    const hint = el('div', '', t('hud.hint'));
    hint.id = 'hint';
    this.root.appendChild(hint);

    onLanguageChange(() => {
      hint.textContent = t('hud.hint');
      this.concordCall.textContent = t('hud.concord');
      for (const s of this.seats) {
        // Boon roundels and the sworn line are rebuilt when the boon count
        // changes, and the cast pips when the ammo count does — neither of which
        // a translation touches. Reset both guards so the next frame redraws.
        s.lastBoonCount = -1;
        if (s.pips) s.pips.innerHTML = '';
      }
    });
  }

  /** Told by the run once it knows which body belongs to this machine. */
  setLocalSeat(seat: number) {
    if (this.localSeat === seat) return;
    this.localSeat = seat;
    // Seats already laid out are now on the wrong side of the screen.
    const existing = this.seats.map((s) => ({
      seat: s.seat,
      cls: s.cls,
      name: s.name.textContent ?? '',
    }));
    this.reset();
    for (const e of existing) this.addSeat(e.seat, e.name, e.cls);
  }

  /**
   * Build one shade's plate. The local seat gets the large plate and the whole
   * build beside it; everyone else gets the compact version on the right.
   */
  addSeat(index: number, name: string, cls: ClassId = 'warrior') {
    const local = index === this.localSeat;
    const tint = PLATE_TINTS[index % PLATE_TINTS.length];

    const plate = el('div', 'e-plate');
    plate.style.setProperty('--hp', '1');
    plate.style.setProperty('--tint', tint);
    plate.appendChild(shadeArt(cls, seatSigil(index), tint));

    const hp = el('div', 'e-hp');
    const revive = el('div', 'e-revive');
    plate.append(
      el('div', 'e-shadow'),
      el('div', 'e-out'),
      hp,
      revive,
      el('div', 'e-call-track'),
      el('div', 'e-call')
    );

    if (local) {
      const meta = el('div', 'e-shade-meta');
      const nameEl = el('div', 'e-shade-name', name);
      const sworn = el('div', 'e-shade-sworn');
      const pips = el('div', 'e-pips');
      const boons = el('div', 'e-boons');
      const lore = el('div', 'e-lore');
      meta.append(nameEl, sworn, pips, boons, lore);

      this.shades.append(plate, meta);
      this.seats.push({
        seat: index,
        cls,
        root: plate,
        plate,
        hp,
        revive,
        name: nameEl,
        sworn,
        pips,
        boons,
        lore,
        lastBoonCount: -1,
      });
      return;
    }

    const cell = el('div', 'e-ally');
    cell.style.setProperty('--tint', tint);
    // Two labels, one shown at a time. "P3 · MARKSMAN" does not fit a 44px
    // column on a phone, and truncating it to "P3 · M…" is worse than dropping
    // the class, which the plate's tint and portrait already carry.
    const nameEl = el('div', 'e-ally-name');
    const full = el('span', 'e-ally-full', name);
    nameEl.append(full, el('span', 'e-ally-short', `P${index + 1}`));
    const boons = el('div', 'e-boons');
    const fallen = el('div', 'e-fallen');
    cell.append(plate, nameEl, boons, fallen);
    this.allies.appendChild(cell);
    this.seats.push({
      seat: index,
      cls,
      root: cell,
      plate,
      hp,
      revive,
      name: full,
      boons,
      fallen,
      lastBoonCount: -1,
    });
  }

  /** Re-title a seat — the class name changes with the language. */
  setSeatName(seat: number, name: string) {
    const s = this.seats.find((x) => x.seat === seat);
    if (s) s.name.textContent = name;
  }

  /** Tear the per-run HUD down, for returning to the title screen. */
  reset() {
    this.shades.innerHTML = '';
    this.allies.innerHTML = '';
    this.seats.length = 0;
    this.setGatePrompt(null);
    this.updateBoss(null);
    this.concord.classList.remove('show');
  }

  /** Seats already laid out, by seat index. Guests learn theirs from snapshots. */
  hasSeat(seat: number) {
    return this.seats.some((s) => s.seat === seat);
  }

  update(
    players: Player[],
    rung: number,
    waveToken: string,
    region: string,
    runObols = 0
  ) {
    this.camera.textContent = t('hud.room', { region, n: roman(rung) });

    const [done, of] = waveCount(waveToken);
    if (this.waves.children.length !== of) {
      this.waves.innerHTML = '';
      for (let i = 0; i < of; i++) this.waves.appendChild(el('i'));
    }
    Array.from(this.waves.children).forEach((c, i) => c.classList.toggle('on', i < done));

    // Stays hidden until the first obol drops, so a brand new player is never
    // shown a counter for a system they have not met yet.
    this.purse.classList.toggle('show', runObols > 0);
    this.purseCount.textContent = String(runObols);

    let worst = 1;
    let ready = 0;
    let live = 0;

    players.forEach((p) => {
      // Look up by seat, never by array index — in co-op a player can leave and
      // the remaining ones must keep their own corner of the screen.
      const s = this.seats.find((x) => x.seat === p.seat);
      if (!s) return;

      const frac = clamp(p.hp / p.maxHp, 0, 1);
      worst = Math.min(worst, p.dead ? 0 : frac);
      if (!p.dead) live++;
      if (!p.dead && p.callGauge >= 1) ready++;

      s.plate.style.setProperty('--hp', p.dead ? '0' : frac.toFixed(3));
      s.plate.style.setProperty('--call', p.callGauge.toFixed(3));
      s.plate.classList.toggle('downed', p.dead);
      s.plate.classList.toggle('ready', !p.dead && p.callGauge >= 1);
      s.root.classList.toggle('downed', p.dead);

      s.hp.replaceChildren(
        document.createTextNode(String(Math.ceil(p.hp))),
        el('span', '', ` / ${p.maxHp}`)
      );

      if (p.dead) {
        s.revive.textContent = t('hud.downedPct', {
          pct: Math.round(p.reviveProgress * 100),
        });
        if (s.fallen) s.fallen.textContent = t('hud.downed');
      } else if (s.fallen) {
        s.fallen.textContent = '';
      }

      if (s.pips) {
        const ammo = 3 + p.boons.extraCastAmmo;
        // One extra child: the trailing "cast" label.
        if (s.pips.children.length !== ammo + 1) {
          s.pips.innerHTML = '';
          for (let k = 0; k < ammo; k++) s.pips.appendChild(el('i'));
          s.pips.appendChild(el('span', 'e-pips-label', t('hud.cast')));
        }
        Array.from(s.pips.children).forEach((c, k) => {
          if (k < ammo) c.classList.toggle('on', k < p.castAmmo);
        });
      }

      if (s.boons && s.lastBoonCount !== p.boons.taken.length) {
        s.lastBoonCount = p.boons.taken.length;
        s.boons.innerHTML = '';
        // Allies show a few; the local shade shows everything plus one empty
        // socket, so there is always somewhere for the next one to go.
        const shown = s.lore ? p.boons.taken : p.boons.taken.slice(0, 4);
        for (const b of shown) {
          // The mark wears its throne's numeral. Seven desaturated stones are
          // not seven distinguishable colours at this size — legion and rodnova
          // sit 8 dE apart — so the numeral is what actually answers "who gave
          // me this", and the stone is mood. Every other throne mark in the
          // design carries its numeral too; these were the only ones without.
          const throne = PANTHEONS[b.pantheon];
          const disc = el('i', '', throne.numeral);
          disc.style.background = roundel(b.pantheon);
          disc.style.color = throne.ink;
          disc.title = `${b.name} · ${pantheonName(b.pantheon)}`;
          s.boons.appendChild(disc);
        }
        if (s.lore) s.boons.appendChild(el('i', 'empty'));

        if (s.sworn) {
          const first = p.boons.taken[0];
          s.sworn.textContent = first
            ? t('hud.sworn', { cls: p.def.name, pantheon: pantheonName(first.pantheon) })
            : t('hud.unsworn', { cls: p.def.name });
        }
        if (s.lore) {
          const last = p.boons.taken[p.boons.taken.length - 1];
          s.lore.textContent = last ? `${last.name} · ${pantheonName(last.pantheon)}` : '';
        }
      }
    });

    // Two shades with full gauges can agree on something. The prompt is the only
    // place the mechanic is ever explained, so it goes up whenever it is
    // actually available — not once someone has already started holding.
    this.concord.classList.toggle('show', ready >= 2 && live >= 2);

    this.hurt.style.opacity = worst < 0.34 ? String(0.35 + (0.34 - worst) * 1.6) : '0';
  }

  // ------------------------------------------------------------ the sheet

  get sheetOpen() {
    return this.sheet.classList.contains('show');
  }

  /** True while a throne is mid-offer. The sheet must not land on top of it. */
  get offerOpen() {
    return this.choice.classList.contains('show');
  }

  closeSheet() {
    this.sheet.classList.remove('show');
    this.sheet.innerHTML = '';
  }

  /**
   * Everything this shade is carrying, and what it adds up to.
   *
   * Built fresh on every open rather than kept in sync: it is read for a few
   * seconds at a time and a stale build sheet is worse than no build sheet.
   *
   * Only what was taken. A roguelike offers three cards and gives you one, so a
   * list of the two you turned down is a list of things that never happened —
   * the screen is a record of the shade you built, not of the ones you didn't.
   */
  openSheet(p: Player) {
    const { held, owner } = readBuild(p);
    const wrap = el('div', 'e-sheet-inner');

    wrap.append(
      el('div', 'e-sheet-kicker', t('sheet.kicker')),
      el('div', 'e-sheet-name', p.asc ? p.asc.name : p.def.name),
      el('div', 'e-sheet-sub', p.asc ? p.asc.title : p.def.title)
    );

    /*
     * What your hits carry, first and on its own.
     *
     * This is the one thing the game never told anyone: a status is
     * last-write-wins, so a second card on the same slot silently unseats the
     * first. Stating the three slots outright means the answer is a fact on
     * screen rather than something to be inferred from a pile of cards.
     */
    const carried = el('div', 'e-sheet-carried');
    carried.appendChild(el('div', 'e-sheet-head', t('sheet.carried')));
    for (const s of SLOTS) {
      const key = owner[s];
      const from = key && held.find((h) => h.key === key);
      const row = el('div', 'e-carry' + (from ? '' : ' none'));
      const status = from ? from.sets[s] : null;
      row.append(
        el('span', 'e-carry-slot', t(`sheet.slot.${s}` as Key)),
        el('span', 'e-carry-what', status ? t(`status.${status}` as Key) : t('sheet.plain'))
      );
      if (from) row.style.setProperty('--tint', from.accent);
      carried.appendChild(row);
    }
    wrap.appendChild(carried);

    // --- the cards, in the order they were taken -------------------------
    if (held.length) {
      wrap.appendChild(el('div', 'e-sheet-head', t('sheet.held')));
      const list = el('div', 'e-sheet-list');
      for (const h of held) {
        const card = el('div', 'e-sheet-card' + (h.overruled.length ? ' overruled' : ''));
        card.style.setProperty('--tint', h.accent);

        const mark = h.roundel ? el('i', 'e-sheet-mark', h.numeral) : el('i', 'e-sheet-bar');
        if (h.roundel) {
          mark.style.background = h.roundel;
          if (h.ink) mark.style.color = h.ink;
        } else {
          mark.style.background = h.accent;
        }

        const body = el('div', 'e-sheet-body');
        const line = el('div', 'e-sheet-line');
        line.append(el('span', 'e-sheet-kick', h.kicker), el('span', 'e-sheet-title', h.name));
        // Levels as pips, the same shorthand the offer screen uses for a boon
        // being stacked, so "taken twice" reads the same in both places.
        if (h.level > 1) {
          const pips = el('span', 'e-sheet-pips');
          for (let i = 0; i < h.level; i++) pips.appendChild(el('i'));
          line.appendChild(pips);
        }
        body.append(line, el('div', 'e-sheet-desc', h.desc));

        /*
         * The part of this card that is no longer in force. Named, not merely
         * greyed: "your Attack no longer carries this" is the sentence the
         * player needed, and a dimmed row alone does not say it.
         */
        if (h.overruled.length) {
          const slots = h.overruled.map((s) => t(`sheet.slot.${s}` as Key)).join(' · ');
          body.appendChild(el('div', 'e-sheet-dead', t('sheet.overruled', { slots })));
        }

        card.append(mark, body);
        list.appendChild(card);
      }
      wrap.appendChild(list);
    }

    // --- what it all comes to --------------------------------------------
    const sums = totals(p);
    wrap.appendChild(el('div', 'e-sheet-head', t('sheet.totals')));
    const grid = el('div', 'e-sheet-totals');
    for (const [label, value] of sums) {
      const row = el('div', 'e-total');
      row.append(el('span', '', label), el('b', '', value));
      grid.appendChild(row);
    }
    wrap.appendChild(grid);

    wrap.appendChild(el('div', 'e-sheet-foot', t('sheet.close')));

    this.sheet.replaceChildren(wrap);
    this.sheet.classList.add('show');
  }

  /** Pass the live boss, or null when there isn't one. */
  updateBoss(boss: Enemy | null) {
    this.boss.classList.toggle('show', !!boss && !boss.dead);
    if (!boss) return;
    const frac = clamp(boss.hp / boss.maxHp, 0, 1);
    this.bossFill.style.transform = `scaleX(${frac})`;
    this.bossLag.style.transform = `scaleX(${frac})`;
    this.boss.classList.toggle('enraged', boss.enraged);
    const title = boss.a.title ?? t('hud.boss');
    if (this.bossTitle.textContent !== title) this.bossTitle.textContent = title;
  }

  /** Damage numbers, projected from world space each frame they're spawned. */
  spawnDamage(events: DamageEvent[], camera: THREE.Camera) {
    for (const e of events) {
      this.v3.set(e.x, 1.6, e.z).project(camera);
      if (this.v3.z > 1) continue;
      const n = el(
        'div',
        `float${e.crit ? ' crit' : ''}`,
        e.crit ? `${e.amount}!` : `${e.amount}`
      );
      n.style.color = e.color;
      n.style.left = `${((this.v3.x + 1) / 2) * 100}%`;
      n.style.top = `${((-this.v3.y + 1) / 2) * 100}%`;
      this.root.appendChild(n);
      setTimeout(() => n.remove(), 800);
    }
    events.length = 0;
  }

  /** Prompt under the reticle while the exit is open. Null clears it. */
  setGatePrompt(text: string | null) {
    this.gatePrompt.textContent = text ?? '';
    this.gatePrompt.classList.toggle('show', !!text);
  }

  showBanner(text: string) {
    this.banner.textContent = text;
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
  }

  /**
   * The offer.
   *
   * One screen for every "pick one of three" moment — a throne's boons, a weapon
   * hammer, empowering something already held. The god fills the left half and
   * the terms sit beside it, which is the design's whole argument: you are being
   * spoken to by someone, not browsing a list.
   */
  offerCards<T extends Card>(view: OfferView, cards: T[]): Promise<T> {
    return new Promise((resolve) => {
      const screen = el('div', 'e-offer');

      // --- the god ------------------------------------------------------
      const plate = el('div', 'e-offer-god');
      const sigil = (view.title[0] ?? '?').toUpperCase();
      const art = view.art
        ? view.artKind === 'asc'
          ? ascArt(view.art, sigil)
          : godArt(view.art, sigil)
        : el('div', 'e-art missing');
      art.style.setProperty('--tint', view.accent);
      plate.append(art, el('div', 'e-scrim'));

      const body = el('div', 'e-god-body');
      if (view.numeral && view.roundel) {
        const throne = el('div', 'e-god-throne');
        const disc = el('span', 'e-roundel', view.numeral);
        disc.style.background = view.roundel;
        if (view.ink) disc.style.color = view.ink;
        throne.append(disc, el('span', '', view.throne ?? ''));
        body.appendChild(throne);
      }
      body.appendChild(el('div', 'e-god-name e-leaf', view.title));
      if (view.epithet) body.appendChild(el('div', 'e-god-epithet', view.epithet));
      if (view.quote) body.appendChild(el('div', 'e-god-quote', view.quote));
      plate.appendChild(body);

      // --- the terms ----------------------------------------------------
      const terms = el('div', 'e-offer-terms');
      terms.appendChild(el('div', 'e-terms-kicker', view.subtitle));

      const finish = (c: T) => {
        this.choice.classList.remove('show');
        this.choice.innerHTML = '';
        removeEventListener('keydown', onKey);
        resolve(c);
      };
      const onKey = (e: KeyboardEvent) => {
        const i = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
        if (i >= 0 && cards[i]) finish(cards[i]);
      };

      cards.forEach((card, i) => {
        const c = el(
          'button',
          'e-card' + (card.rival ? ' rival' : '') + (card.branch ? ' asc' : ''),
        );
        // The interrupting throne's own metal drives the whole card, not just
        // the seal — a rival from netjer must not arrive wearing the legion's red.
        if (card.rival) c.style.setProperty('--rival', card.accent);
        if (card.branch) c.style.setProperty('--branch', card.accent);
        const row = el('div', 'e-card-row');

        const seal = el('span', 'e-seal');
        seal.style.background = card.accent;

        const text = el('div', 'e-card-text');
        if (card.kicker) text.appendChild(el('div', 'e-card-kicker', card.kicker));
        const cname = el('div', 'e-card-name', card.name);
        if (card.rival) cname.style.color = card.accent;
        text.append(cname, el('div', 'e-card-desc', card.desc));

        // Levels already held, so stacking reads as progress rather than as the
        // same card turning up twice.
        if (card.pipsOf) {
          const pips = el('div', 'e-card-pips');
          for (let k = 0; k < card.pipsOf; k++) {
            pips.appendChild(el('i', k < (card.pips ?? 0) ? 'on' : ''));
          }
          text.appendChild(pips);
        }

        row.append(seal, text, el('span', 'e-card-index', ROMAN_SMALL[i] ?? String(i + 1)));
        c.appendChild(row);
        c.onclick = () => finish(card);
        terms.appendChild(c);
      });

      terms.appendChild(this.offerFoot());
      screen.append(plate, terms);

      this.choice.replaceChildren(screen);
      this.choice.classList.add('show');
      addEventListener('keydown', onKey);
    });
  }

  /** Who else is still deciding. Empty in a solo run, so it collapses away. */
  private offerFoot() {
    const foot = el('div', 'e-offer-foot');
    const waiting = el('div', 'e-waiting');
    for (const s of this.seats) {
      if (s.seat === this.localSeat) continue;
      const who = el('div', 'e-who');
      const dot = el('i');
      dot.style.background = PLATE_TINTS[s.seat % PLATE_TINTS.length];
      who.append(dot, el('span', '', t('round.choosing', { name: s.name.textContent ?? '' })));
      waiting.appendChild(who);
    }
    foot.append(waiting, el('div', 'e-hint', t('hud.press', { n: '1 · 2 · 3' })));
    return foot;
  }
}
