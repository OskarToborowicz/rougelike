import * as THREE from "three";
import { Stage } from "./render/scene";
import { Arena } from "./render/arena";
import { Vfx } from "./render/vfx";
import { FxBus } from "./render/fxbus";
import { Input, type Frame } from "./core/input";
import { ASSIST, assistAim } from "./core/aim";
import { World } from "./game/world";
import type { Enemy } from "./game/enemy";
import { Player, PLAYER_TINTS } from "./game/player";
import { BoonSet, offerFrom, rivalOffer, type Boon } from "./game/boons";
import type { WireCard, WireOffer, WireView } from "./net/protocol";
import { CLASSES, type ClassId } from "./game/classes";
import { biomeForDepth } from "./render/biome";
import { Director } from "./game/director";
import { Gate } from "./game/gate";
import { offerDoors, type Reward } from "./game/rewards";
import { hammerColor, hammerSlotLabel, offerHammers } from "./game/hammers";
import {
  godEpithet,
  godName,
  godOfPantheon,
  godQuote,
  PANTHEON_ORDER,
  PANTHEONS,
  roundel,
  throneLine,
  type PantheonId,
} from "./game/pantheons";
import { onLanguageChange, t } from "./ui/i18n";
import { shuffle } from "./core/math";
import { Hud, type OfferView } from "./ui/hud";
import { Menu, type RunSummary } from "./ui/menu";
import { pixelRatioFor, settings } from "./ui/settings";
import { Net } from "./net/net";
import { MAX_PLAYERS } from "./net/protocol";
import { buildSnapshot, RemoteView } from "./net/sync";
import { clamp } from "./core/math";
import { Audio } from "./audio/audio";
import {
  applyMeta,
  decodeMeta,
  earn,
  encodeMeta,
  meta,
  recordRun,
  type MetaState,
} from "./game/meta";
import {
  ascendanciesOf,
  ASCEND_DEPTH,
  CAPSTONE_DEPTH,
  type Ascendancy,
  type Capstone,
} from "./game/ascendancy";
import { clearRun, loadRun, saveRun, type RunSave } from "./game/save";

const host = document.getElementById("app")!;
const stage = new Stage(host);
const arena = new Arena(stage.scene);
stage.root.add(arena.group);

const vfx = new Vfx(stage.fx);
const audio = new Audio();
const fx = new FxBus(vfx, stage, audio);
const input = new Input(stage.renderer.domElement);
const hud = new Hud();
const menu = new Menu(document.body, audio);
const world = new World(stage.root, fx);
const remote = new RemoteView(stage.root, fx);

// Dev-only handle. Combat states that take a minute to reach by playing — a full
// Call gauge, a specific boon's status — are one line away from the console with
// this, and it is stripped from production builds.
/** Pool of doors. Never more than three are shown at once. */
const gates = [
  new Gate(stage.root),
  new Gate(stage.root),
  new Gate(stage.root),
];
const openGates = () => gates.filter((g) => g.isVisible);
const hideGates = () => gates.forEach((g) => g.hide());

/**
 * Seat labels. The class matters more than the shade's name once four people are
 * on screen — you need to know at a glance whose health bar is the fragile mage.
 * Once a branch is sworn to, that is what the plate reads instead: the whole
 * point of ascending is that the shade is no longer just its class.
 */
const seatLabel = (seat: number, cls: ClassId, asc: Ascendancy | null = null) =>
  t("hud.seat", { n: seat + 1, cls: asc ? asc.name : CLASSES[cls].name });

// Seat titles are written once when the seat is created, so switching language
// mid-run has to go back and re-title them.
onLanguageChange(() => {
  const seated = mode === "guest" ? remote.playerList : world.players;
  for (const p of seated) hud.setSeatName(p.seat, seatLabel(p.seat, p.cls, p.asc));
});

/** Which network id owns which seat. Seat 0 is always the local host player. */
const seatOwner = new Map<number, number>();

/** Guest-side: seats whose plate has already been re-titled for a branch. */
const guestAscended = new Set<number>();

/**
 * Set whenever a shade's build changes, cleared once it has gone out.
 *
 * Builds are a list of ids, not a number, and they change a few times a descent
 * — putting them in every snapshot would send the same few hundred bytes per
 * player thirty times a second to say nothing new.
 */
let buildsDirty = true;
const markBuilds = () => (buildsDirty = true);

let mode: "solo" | "host" | "guest" = "solo";
let paused = true;
let running = false;
const focus = new THREE.Vector3();
const frames = new Map<number, Frame | null>();

const net = new Net({
  onRole: (role, _id, room) => {
    mode = role === "host" ? "host" : "guest";
    menu.showRoom(room, role === "host", startRun);
    refreshRoster();
    menu.setStatus(role === "guest" ? t("net.waitingHost") : "");
  },
  onJoin: () => {
    refreshRoster();
    if (mode === "host") {
      fx.record = true;
      if (running) seatJoin();
    }
  },
  onLeave: (id) => {
    refreshRoster();
    dropSeat(id);
  },
  onSnapshot: (snap) => {
    if (mode !== "guest") return;
    if (!running) {
      running = true;
      menu.hide();
    }
    remote.apply(snap, net.id);
  },
  onFull: () => menu.setStatus(t("net.full")),
  onClose: () => {
    if (mode === "guest" && running) {
      // The host owned the simulation, so there is nothing left to play.
      running = false;
      remote.clear();
      guestAscended.clear();
      hud.reset();
      boot();
      menu.setStatus(t("net.lostHost"));
    }
  },
});

/**
 * Captured once at boot. Reading it back from localStorage would be wrong the
 * moment two clients share an origin — a second tab overwrites the key and the
 * host starts displaying the guest's name as its own.
 */
let localName = t("menu.defaultName");

function refreshRoster() {
  menu.setRoster([localName, ...net.peers.map((p) => p.name)]);
}

// ---------------------------------------------------------------- seating

/**
 * `metaSource` is the upgrade state to fold in. Local seats use this machine's
 * own; a guest's arrives in the handshake, because the host simulates every
 * body and would otherwise silently strip what that player had bought.
 */
function addSeat(
  seat: number,
  cls: ClassId = "warrior",
  metaSource = meta,
) {
  const p = new Player(
    0,
    seat,
    applyMeta(new BoonSet(), metaSource),
    PLAYER_TINTS[seat % PLAYER_TINTS.length],
    cls,
  );
  p.onStep = (x, z, speed) => audio.play("step", { x, z }, clamp(speed / 8, 0.4, 1.2));
  // Remembered so a wipe can rebuild this seat from the right upgrades.
  seatMeta.set(seat, metaSource);
  const a = (seat / MAX_PLAYERS) * Math.PI * 2;
  p.pos.set(Math.cos(a) * 2, 0, 3 + Math.sin(a) * 2);
  world.addPlayer(p);
  hud.addSeat(seat, seatLabel(seat, cls), cls);
  // A new arrival has to be told everyone's build, not just its own.
  markBuilds();
  return p;
}

/** Give every connected guest without a seat the next free one. */
function seatJoin() {
  for (const peer of net.peers) {
    if (seatOwner.has(peer.id)) continue;
    if (world.players.length >= MAX_PLAYERS) return;
    const p = addSeat(
      world.players.length,
      (peer.cls as ClassId) ?? "warrior",
      decodeMeta(peer.meta ?? ""),
    );
    seatOwner.set(peer.id, p.id);
    // A new arrival means the room needs to grow.
    reshapeArena();
    fx.ring(
      p.pos.x,
      p.pos.z,
      PLAYER_TINTS[p.seat % PLAYER_TINTS.length],
      2.2,
      0.6,
    );
    hud.showBanner(t("banner.joins", { name: peer.name }));
  }
}

function dropSeat(netId: number) {
  const playerId = seatOwner.get(netId);
  if (playerId === undefined) return;
  seatOwner.delete(netId);
  const i = world.players.findIndex((p) => p.id === playerId);
  if (i < 0) return;
  stage.root.remove(world.players[i].mesh);
  world.players.splice(i, 1);
}

const director = new Director(world, () => world.players.length);

/**
 * What this run has earned so far. Obols are banked the instant they drop —
 * these two only exist so the shore screen can show what *this* descent was
 * worth, separately from the lifetime purse.
 */
let runObols = 0;
let runKills = 0;

/** Which upgrade state each seat was built from. Guests bring their own. */
const seatMeta = new Map<number, MetaState>();

// ------------------------------------------------------------- the run save

/**
 * Only a descent this machine owns outright is written down.
 *
 * A co-op run lives on the host and is made of people, not state: resuming one
 * alone would mean inventing bodies for players who are not here, and a guest
 * has no authority over the world it would be restoring. Both would be a lie
 * about what was saved, so neither is offered.
 */
const canSaveRun = () => mode === "solo";

/** The descent as it stands, in the only form that survives a rebalance. */
function snapshotRun(): RunSave {
  return {
    v: 1,
    depth: director.depth,
    room: director.room,
    obols: runObols,
    kills: runKills,
    shades: world.players.map((p) => ({
      seat: p.seat,
      cls: p.cls,
      picks: p.picks.slice(),
      spurned: [...p.boons.spurned],
      hp: p.maxHp > 0 ? p.hp / p.maxHp : 1,
    })),
  };
}

/**
 * Write the checkpoint.
 *
 * Called where a chamber begins and nowhere else. Saving mid-fight would mean
 * serialising every enemy, every projectile and the wave the director is part
 * way through — and would hand the player a way to reload out of a blow already
 * in the air. The chamber threshold is the one moment a descent is fully
 * described by what has been chosen rather than by what is currently moving.
 */
function checkpoint() {
  if (!canSaveRun() || !running) return;
  saveRun(snapshotRun());
}

/** Obols a corpse is worth. Bosses pay for the fight they actually were. */
const bounty = (e: Enemy) =>
  e.a.boss ? 60 + director.depth * 8 : Math.round(4 + e.a.hp / 24 + director.depth * 0.6);

world.onConcord = () => hud.showBanner(t("banner.concord"));

world.onKill = (e) => {
  runKills++;
  runObols += earn(bounty(e));
};

// ------------------------------------------------------------------- run

function startRun() {
  running = true;
  paused = false;
  if (mode === "host") {
    fx.record = net.peers.length > 0;
    seatJoin();
  }
  reshapeArena();
  audio.unlock();
  audio.startMusic();
  hud.showBanner(director.biome.name);
  // Chamber one is a checkpoint like any other: a player who walks away from the
  // first room should find it waiting, not have to earn the right to be saved.
  checkpoint();
}

/**
 * Lay the room out for the current region and party size. A no-op unless one of
 * those actually changed, so it is safe to call whenever the run moves on.
 */
function reshapeArena() {
  const guest = mode === "guest";
  // A guest has no director of its own; depth and roster arrive in snapshots.
  const depth = guest ? remote.depth : director.depth;
  const count = guest ? remote.playerList.length : world.players.length;
  arena.rebuild(biomeForDepth(depth), Math.max(1, count));
}

/** A second local gamepad joins in solo/host play — couch co-op needs no menu. */
function checkLocalJoin() {
  if (mode === "guest" || !running) return;
  if (!input.hasSecondPad) return;
  if (world.players.some((p) => p.seat === 1)) return;
  if (world.players.length >= MAX_PLAYERS) return;
  const p = addSeat(1);
  fx.ring(p.pos.x, p.pos.z, PLAYER_TINTS[1], 2.2, 0.6);
  hud.showBanner(t("banner.playerTwo"));
}

/**
 * Aim assist, applied to whichever frame this machine produced locally.
 *
 * Only on touch — a mouse is already precise and a stick has its own feel, and
 * silently bending either would be a bug rather than a feature. The profile
 * comes from how the class delivers damage: a swing has an arc to spare, a bolt
 * does not. See core/aim.ts.
 */
function withAssist(
  f: Frame,
  at: { pos: { x: number; z: number }; cls: ClassId },
  targets: Iterable<{ pos: { x: number; z: number }; dead: boolean }>,
): Frame {
  if (!input.usingTouch) return f;
  const melee = CLASSES[at.cls].attack === "melee";
  return assistAim(f, at.pos, targets, melee ? ASSIST.melee : ASSIST.ranged);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Boon offers the host is waiting on, published in every snapshot. */
let openOffers: WireOffer[] = [];
/** playerId -> resolve, for picks arriving over the wire. */
const pendingPicks = new Map<number, (boonId: string) => void>();

net.onPickHandler = (netId, boonId) => {
  const pid = seatOwner.get(netId);
  if (pid === undefined) return;
  pendingPicks.get(pid)?.(boonId);
};

/**
 * One seat's pending choice, whatever kind of choice it is.
 *
 * Boons, hammers and poms differ only in their heading, their colour and what
 * picking one does — so they share this single round rather than three copies
 * that each have to remember the remote-seat handling separately. Getting that
 * wrong is exactly why remote players used to be handed random hammers.
 */
interface CardRound<T extends { id: string }> {
  /** Everything the offer screen shows besides the cards. */
  view: (p: Player) => OfferView;
  /** Up to three options for this seat. Empty skips the seat entirely. */
  choices: (p: Player) => T[];
  card: (p: Player, choice: T) => WireCard;
  apply: (p: Player, choice: T) => void;
  /** Colour of the ring that pops on payout. */
  ring: number;
}

/**
 * Everyone chooses at once.
 *
 * Local seats share one screen, so they go one after another. Remote seats each
 * have their own screen and choose in parallel: the host publishes their offer
 * in every snapshot and waits for a pick. A seat that never answers falls back
 * to a random option after 45s, so one idle player can never stall the run.
 */
async function runCardRound<T extends { id: string }>(round: CardRound<T>) {
  const rolls = world.players
    .map((p) => ({ p, choices: round.choices(p) }))
    .filter((r) => r.choices.length > 0);
  if (!rolls.length) return;

  const remoteRolls = rolls.filter((r) => isRemoteSeat(r.p.id));
  const localRolls = rolls.filter((r) => !isRemoteSeat(r.p.id));

  openOffers = remoteRolls.map((r) => ({
    pid: r.p.id,
    view: round.view(r.p) as WireView,
    cards: r.choices.map((c) => round.card(r.p, c)),
  }));

  const remotePicks = remoteRolls.map(async (r) => {
    const chosenId = await new Promise<string | null>((resolve) => {
      pendingPicks.set(r.p.id, resolve);
      setTimeout(() => resolve(null), 45000);
    });
    pendingPicks.delete(r.p.id);
    return {
      p: r.p,
      choice:
        r.choices.find((c) => c.id === chosenId) ??
        r.choices[Math.floor(Math.random() * r.choices.length)],
    };
  });

  const localPicks: { p: Player; choice: T }[] = [];
  for (const r of localRolls) {
    const picked = await hud.offerCards(
      round.view(r.p),
      r.choices.map((c) => round.card(r.p, c)),
    );
    localPicks.push({ p: r.p, choice: r.choices.find((c) => c.id === picked.id)! });
  }

  const all = [...localPicks, ...(await Promise.all(remotePicks))];
  openOffers = [];

  for (const { p, choice } of all) {
    round.apply(p, choice);
    // Every kind of round ends here, so this is the one place a build can change
    // — boon, hammer, pom, branch or capstone alike.
    markBuilds();
    p.castAmmo = 3 + p.boons.extraCastAmmo;
    fx.ring(p.pos.x, p.pos.z, round.ring, 2.4, 0.6);
    fx.sfx("boon", p.pos.x, p.pos.z);
  }
}

/**
 * A throne comes to the door.
 *
 * Two of its own boons, and — when it has a live quarrel with someone — a third
 * card from a rival, answering over its head. The rival's card is not better on
 * paper; what it costs is the throne that was offering, which will not come back
 * this descent. That is the whole decision.
 */
const runBoonRound = (pantheon: PantheonId, god: string) => {
  // The rival wears one face for the whole round. `godOfPantheon` rolls, so
  // calling it per card would rename the speaker between the kicker and the log.
  const faces = new Map<PantheonId, string>();
  const faceOf = (p: PantheonId) => {
    const known = faces.get(p);
    if (known) return known;
    const fresh = godOfPantheon(p);
    faces.set(p, fresh);
    return fresh;
  };

  return runCardRound<Boon>({
    view: (p) => ({
      title: godName(god),
      accent: PANTHEONS[pantheon].css,
      subtitle: t("round.sub.boon", { seat: seatLabel(p.seat, p.cls, p.asc) }),
      epithet: godEpithet(god),
      quote: godQuote(god),
      numeral: PANTHEONS[pantheon].numeral,
      roundel: roundel(pantheon),
      ink: PANTHEONS[pantheon].ink,
      throne: throneLine(pantheon),
      art: god,
    }),
    choices: (p) => {
      const own = offerFrom(p.boons, pantheon, 3);
      // Only leave room for a rival when the throne can still fill two cards of
      // its own — a lone card plus an interruption reads as a bug, not a choice.
      const rival = own.length >= 2 ? rivalOffer(p.boons, pantheon) : null;
      return rival ? [...own.slice(0, 2), rival] : own;
    },
    card: (p, b) => ({
      id: b.id,
      name: b.name,
      desc: b.desc,
      kicker:
        b.pantheon === pantheon
          ? throneLine(pantheon)
          : t("round.answersOver", { god: godName(faceOf(b.pantheon)) }),
      accent: PANTHEONS[b.pantheon].css,
      rival: b.pantheon !== pantheon,
      // A boon already held shows how far along the track it is, so a repeat
      // offer reads as levelling rather than as the same card coming back.
      ...(p.boons.levelOf(b.id) > 0
        ? { pips: p.boons.levelOf(b.id), pipsOf: p.boons.levelOf(b.id) + 1 }
        : {}),
    }),
    apply: (p, b) => {
      p.boons.add(b);
      p.picks.push(["b", b.id]);
      // Taken over the offering throne's head. It is done with this shade.
      if (b.pantheon !== pantheon) p.boons.spurned.add(pantheon);
    },
    ring: PANTHEONS[pantheon].color,
  });
};

/** Weapon hammer: pick one of three upgrades to a slot. */
const runHammerRound = () =>
  runCardRound({
    view: (p) => ({
      title: t("round.hammer"),
      accent: "#ffb04a",
      subtitle: t("round.sub.hammer", { seat: seatLabel(p.seat, p.cls, p.asc) }),
    }),
    choices: (p) => offerHammers(p.boons, p.cls, 3),
    card: (_p, h) => ({
      id: h.id,
      name: h.name,
      desc: h.desc,
      kicker: hammerSlotLabel(h),
      accent: hammerColor(h),
    }),
    apply: (p, h) => {
      h.apply(p.boons);
      p.boons.hammers.push(h.id);
      p.picks.push(["h", h.id]);
    },
    ring: 0xffb04a,
  });

/** Pom: empower a boon already held, raising its level. */
const runPomRound = () =>
  runCardRound<Boon>({
    view: (p) => ({
      title: t("round.empower"),
      accent: "#d6a6ff",
      subtitle: t("round.sub.pom", { seat: seatLabel(p.seat, p.cls, p.asc) }),
    }),
    choices: (p) => shuffle(p.boons.taken.slice()).slice(0, 3),
    card: (p, b) => ({
      id: b.id,
      name: b.name,
      desc: b.desc,
      kicker: throneLine(b.pantheon),
      accent: PANTHEONS[b.pantheon].css,
      pips: p.boons.levelOf(b.id),
      pipsOf: p.boons.levelOf(b.id) + 1,
    }),
    // A pom is another level of a boon already held, so it writes another entry
    // rather than a different kind of one. Replaying two adds it twice, which is
    // exactly what `upgrade` does.
    apply: (p, b) => {
      p.boons.upgrade(b);
      p.picks.push(["b", b.id]);
    },
    ring: 0xd6a6ff,
  });

/**
 * The forking.
 *
 * One chamber past the first guardian, the class splits. Unlike every other
 * round this one is not a build decision that stacks on the last — it is the
 * only choice in the run that cannot be added to later, which is why it gets its
 * own moment instead of riding a door.
 */
const runAscendRound = () =>
  runCardRound<Ascendancy>({
    view: (p) => ({
      title: t("round.ascend"),
      accent: "#e8d6a8",
      subtitle: t("round.sub.ascend", { seat: seatLabel(p.seat, p.cls, p.asc) }),
    }),
    // An empty list skips the seat entirely, which is what makes a second call
    // — or a guest who joined after the fork — harmless.
    choices: (p) => (p.asc ? [] : ascendanciesOf(p.cls)),
    card: (_p, a) => ({
      id: a.id,
      name: a.name,
      desc: a.desc,
      kicker: a.title,
      accent: a.css,
      branch: true,
    }),
    apply: (p, a) => {
      p.ascend(a);
      hud.setSeatName(p.seat, seatLabel(p.seat, p.cls, p.asc));
    },
    ring: 0xe8d6a8,
  });

/** The branch's last word. One card, because this is a rite and not a choice. */
const runCapstoneRound = () =>
  runCardRound<Capstone>({
    view: (p) => ({
      title: t("round.capstone"),
      accent: p.asc?.css ?? "#e8d6a8",
      subtitle: t("round.sub.capstone", { seat: seatLabel(p.seat, p.cls, p.asc) }),
      art: p.asc?.id,
      artKind: "asc",
    }),
    choices: (p) => (p.asc && !p.hasCapstone ? [p.asc.capstone] : []),
    card: (p, c) => ({
      id: c.id,
      name: c.name,
      desc: c.desc,
      kicker: p.asc?.title ?? "",
      accent: p.asc?.css ?? "#e8d6a8",
      branch: true,
    }),
    apply: (p) => p.takeCapstone(),
    ring: 0xe8d6a8,
  });

// Dev-only handle. Combat and reward states that take minutes to reach by
// playing — a full Call gauge, a hammer round with a guest connected — are one
// line away from the console with this. Stripped from production builds.
if (import.meta.env.DEV) {
  (window as any).styx = {
    stage,
    world,
    hud,
    fx,
    audio,
    settings,
    meta,
    remote,
    net,
    input,
    runBoonRound,
    runHammerRound,
    runPomRound,
    runAscendRound,
    runCapstoneRound,
    // A checkpoint normally only lands on a chamber threshold, which is minutes
    // of play away; these make a save and its restore one line apiece.
    checkpoint,
    snapshotRun,
    seatOwner,
    get openOffers() {
      return openOffers;
    },
  };
}

/** Pay out whatever the chosen door promised. */
async function grantReward(reward: Reward) {
  if (reward.kind === "boon" && reward.pantheon) {
    await runBoonRound(reward.pantheon, reward.god ?? godOfPantheon(reward.pantheon));
    return;
  }

  if (reward.kind === "hammer") {
    await runHammerRound();
    return;
  }

  if (reward.kind === "pom") {
    await runPomRound();
    return;
  }

  for (const p of world.players) {
    p.maxHp += 12;
    p.hp = p.maxHp;
    fx.ring(p.pos.x, p.pos.z, reward.color, 2.4, 0.6);
  }
  hud.showBanner(t("banner.vitality"));
  await wait(900);
}

async function onChamberCleared() {
  paused = true;
  fx.ring(0, 0, 0xffd27f, 3, 0.8);
  hud.showBanner(t("banner.cleared"));
  // Let the banner finish its full animation before the boon screen comes up —
  // the two overlap in the middle of the frame otherwise.
  await wait(2000);

  world.projectiles.forEach((pr) => stage.root.remove(pr.mesh));
  world.projectiles.length = 0;

  // Hand control back and open the ways out. The chamber ends when the party
  // agrees on a door — not when the last enemy falls.
  paused = false;
  const anyBoons = world.players.some((p) => p.boons.taken.length > 0);
  // A throne spurned by everyone still standing has nothing left to offer, so
  // it is kept off the doors entirely rather than promising an empty room.
  const courted = PANTHEON_ORDER.filter((t) =>
    world.livePlayers.some((p) => !p.boons.spurned.has(t)),
  );
  const doors = offerDoors(
    director.depth,
    Math.random() < 0.25 ? 3 : 2,
    anyBoons,
    courted.length ? courted : PANTHEON_ORDER,
  );
  doors.forEach((door, i) => gates[i].show(door, i, doors.length));
  hud.showBanner(t("banner.choosePath"));

  /**
   * The doors are open and the party has control, which means the party can
   * still die here — a lobber's bolt already in the air, a wretch that spawned
   * late. `allThrough` needs at least one living player, so without this the
   * wait would never resolve and the run would hang on "Choose Your Path".
   */
  const chosen = await new Promise<Gate | null | "wiped">((resolve) => {
    const check = () => {
      if (world.players.length && !world.livePlayers.length) return resolve("wiped");
      const taken = openGates().find((g) => g.allThrough(world.players));
      if (taken) return resolve(taken);
      if (!openGates().length) return resolve(null);
      setTimeout(check, 100);
    };
    check();
  });

  // Everyone died in the doorway. Bail out and let the loop's wipe handler run:
  // no reward, no free revive, no next chamber — the run is over.
  if (chosen === "wiped") {
    hideGates();
    hud.setGatePrompt(null);
    return;
  }

  const reward = chosen?.reward ?? null;
  // The door also decides what kind of fight waits on the other side.
  director.room = chosen?.room ?? "combat";
  hideGates();
  hud.setGatePrompt(null);
  paused = true;

  if (reward) await grantReward(reward);

  // After the door's payout, so the throne that was speaking gets to finish
  // before the run asks what this shade is going to become. Both depths sit one
  // chamber past a guardian — see ascendancy.ts.
  if (director.depth === ASCEND_DEPTH) await runAscendRound();
  else if (director.depth === CAPSTONE_DEPTH) await runCapstoneRound();

  const wasBiome = director.biome.id;
  director.nextChamber();
  // The threshold. Everything chosen for this chamber is chosen; nothing in the
  // next one has started moving yet.
  checkpoint();
  reshapeArena();

  for (const p of world.players) {
    if (p.dead) {
      p.dead = false;
      p.hp = p.maxHp * 0.5;
      p.state = "idle";
      p.reviveProgress = 0;
    }
  }
  // Crossing into a new region is the run's landmark; say so instead of
  // announcing another anonymous chamber number.
  hud.showBanner(
    director.biome.id !== wasBiome
      ? director.biome.name
      : t("banner.chamber", { n: director.depth }),
  );
  paused = false;
}

const isRemoteSeat = (playerId: number) =>
  [...seatOwner.values()].includes(playerId);

/** Offer id the guest is currently showing, so it opens exactly once. */
let shownOffer = "";

/**
 * Guest side of any card round. The host publishes open offers in the snapshot;
 * when one is addressed to this client's shade, put up the same chooser the
 * host uses and send the answer back.
 *
 * Boon, hammer and pom all arrive here now — the offer carries its own heading
 * and colour, so a guest gets a real screen for each instead of a random pick
 * made on its behalf.
 */
function checkGuestOffer() {
  const mine = remote.offers.find((o) => o.pid === remote.myPlayerId);
  if (!mine) {
    shownOffer = "";
    return;
  }
  const key = `${mine.pid}:${mine.view.title}:${mine.cards.map((c) => c.id).join(",")}`;
  if (key === shownOffer) return;
  shownOffer = key;

  hud.offerCards(mine.view, mine.cards).then((picked) => net.sendPick(picked.id));
}

/**
 * Put the shore up and wait for the player to leave it.
 *
 * The run is already over by the time this is called, so it deliberately blocks
 * the restart: the summary is the payoff for a lost run, and skipping straight
 * to chamber one would throw it away.
 */
function visitShore(summary: RunSummary) {
  return new Promise<void>((resolve) => {
    pauseHeld = true;
    menu.showShrine(() => {
      menu.hide();
      pauseHeld = false;
      resolve();
    }, summary);
  });
}

/**
 * A wipe ends the run. Boons are lost, the descent restarts at chamber one —
 * the roguelike contract. Co-op only wipes when *everyone* is down, so a single
 * death is always recoverable by a partner.
 *
 * What is *not* lost is the obols: the shore screen goes up before the next
 * descent starts, so a failed run ends by making the next one stronger.
 */
async function onWipe() {
  paused = true;
  hud.closeSheet();
  pauseHeld = false;
  hud.showBanner(t("banner.died"));
  fx.shake(0.9);
  await wait(2300);
  world.clearEnemies();
  hideGates();
  hud.setGatePrompt(null);
  world.projectiles.forEach((pr) => stage.root.remove(pr.mesh));
  world.projectiles.length = 0;

  recordRun(director.depth);
  // The descent is over, so there is nothing left to come back to. Cleared
  // before the shore screen, not after: the player is about to sit on a menu
  // that can be closed, and a stale save would offer to resume a run they
  // already lost.
  clearRun();
  // Only the machine that owns the run gets the shore. A guest's death is the
  // host's run ending, and its own meta screen would be spending obols it did
  // not earn here.
  if (mode !== "guest") {
    await visitShore({
      depth: director.depth,
      kills: runKills,
      earned: runObols,
      won: false,
    });
  }
  runObols = 0;
  runKills = 0;

  for (const p of world.players) {
    // Rebuild from that seat's own upgrades — in co-op the host must not hand
    // its own purchases to a guest's shade, or take theirs away.
    p.boons = applyMeta(new BoonSet(), seatMeta.get(p.seat) ?? meta);
    // The branch goes with the build. `renounce` puts `def` back to the bare
    // class, which is what the line below already assumes.
    p.renounce();
    markBuilds();
    hud.setSeatName(p.seat, seatLabel(p.seat, p.cls));
    p.maxHp = CLASSES[p.cls].maxHp + p.boons.metaMaxHp;
    p.hp = p.maxHp;
    p.dead = false;
    p.state = "idle";
    p.iframes = 1.5;
    p.reviveProgress = 0;
    p.castAmmo = 3 + p.boons.extraCastAmmo;
    p.callGauge = Math.min(1, p.boons.metaStartCall);
    const a = (p.seat / MAX_PLAYERS) * Math.PI * 2;
    p.pos.set(Math.cos(a) * 2, 0, 3 + Math.sin(a) * 2);
    p.vel.set(0, 0, 0);
  }
  director.depth = 1;
  director.room = "combat";
  director.buildChamber();
  // A wipe does not end the session, it starts the next descent in place — so
  // that descent gets its chamber-one checkpoint here, the same one `startRun`
  // writes. Without it the run that follows a death is the only one a player
  // cannot walk away from.
  checkpoint();
  reshapeArena();
  hud.showBanner(director.biome.name);
  paused = false;
}

// ------------------------------------------------------------------ loop

let last = performance.now();
let clearedHandled = false;
let tick = 0;
/** True while the pause menu owns the screen. Only meaningful offline. */
let pauseHeld = false;

/**
 * Escape opens the pause menu, and escape again closes it.
 *
 * Closing is the menu's own job — it owns the sub-screens escape has to back out
 * of first — so all this handler has to do is keep out of the way once the menu
 * has consumed the key. Without the `defaultPrevented` check both listeners fire
 * on the same press: the menu resumes, `isPaused` goes false, and this reopens
 * the pause screen on the very keystroke meant to dismiss it.
 *
 * Only when hosting alone or playing solo: a host who pauses would freeze the
 * simulation for everyone else, and a guest cannot pause a world it does not
 * own. In a real party the menu still opens for settings, but the fight runs on.
 */
addEventListener("keydown", (e) => {
  if (e.code !== "Escape" || e.defaultPrevented || !running || menu.isPaused)
    return;
  // Escape backs out of the sheet before it reaches for the pause menu, so the
  // key means one thing at a time.
  if (hud.sheetOpen) {
    e.preventDefault();
    hud.closeSheet();
    pauseHeld = false;
    return;
  }
  const canFreeze =
    mode === "solo" || (mode === "host" && net.peers.length === 0);
  e.preventDefault();
  if (canFreeze) pauseHeld = true;
  menu.openPause(
    () => {
      pauseHeld = false;
    },
    () => abandonRun(),
  );
});

/**
 * The build sheet.
 *
 * Everything the shade is carrying, and — the part the game never said out loud
 * — which of those cards is still in force. Held open rather than glanced at, so
 * in a run this machine owns it stops the world exactly as the pause menu does:
 * reading your build should not be something you get hit for.
 */
addEventListener("keydown", (e) => {
  if (e.code !== "Tab" || e.defaultPrevented || !running || menu.isPaused) return;
  // An offer is already a screen about what you are taking; a second one over it
  // would be two answers to the same question.
  if (hud.offerOpen && !hud.sheetOpen) return;
  // The browser would move focus to whatever it thinks is next.
  e.preventDefault();
  if (hud.sheetOpen) {
    hud.closeSheet();
    pauseHeld = false;
    return;
  }
  // A guest's shade is simulated on the host, but the build now travels — its
  // local copy replays the same picks, so the sheet is as true there as here.
  const me =
    mode === "guest"
      ? remote.playerList.find((p) => p.id === remote.myPlayerId)
      : world.players.find((p) => p.seat === 0);
  if (!me) return;
  hud.openSheet(me);
  if (mode === "solo" || (mode === "host" && net.peers.length === 0)) pauseHeld = true;
});

/**
 * Push settings into the renderer.
 *
 * Applied every frame but guarded on change, so a slider moved in the pause menu
 * takes effect on the next frame instead of on the next run.
 */
let appliedQuality = "";
let appliedShadows: boolean | null = null;

function applySettings() {
  if (appliedQuality !== settings.quality) {
    appliedQuality = settings.quality;
    stage.renderer.setPixelRatio(
      Math.min(devicePixelRatio, pixelRatioFor(settings.quality)),
    );
  }
  if (appliedShadows !== settings.shadows) {
    appliedShadows = settings.shadows;
    stage.renderer.shadowMap.enabled = settings.shadows;
    // Materials cache their shadow settings; force one recompile on the switch.
    stage.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => (x.needsUpdate = true));
      else if (mat) mat.needsUpdate = true;
    });
  }
  stage.shakeScale = settings.shake;
  stage.zoomScale = settings.zoom;
}

/** Leave the run and go back to the title screen. */
async function abandonRun() {
  pauseHeld = false;
  hud.closeSheet();
  running = false;
  paused = true;
  // Walking away still counts as a descent — the obols are already banked, and
  // the deepest-chamber record should not depend on dying to earn it.
  if (mode !== "guest") recordRun(director.depth);
  // Abandoning is a decision, not an interruption — the run is spent either way.
  clearRun();
  runObols = 0;
  runKills = 0;
  seatMeta.clear();
  net.disconnect();
  world.clearEnemies();
  hideGates();
  hud.setGatePrompt(null);
  world.projectiles.forEach((pr) => stage.root.remove(pr.mesh));
  world.projectiles.length = 0;
  for (const p of world.players) stage.root.remove(p.mesh);
  world.players.length = 0;
  remote.clear();
  guestAscended.clear();
  audio.stopMusic();
  hud.reset();
  seatOwner.clear();
  director.depth = 1;
  director.room = "combat";
  director.buildChamber();
  boot();
}

function loop(now: number) {
  requestAnimationFrame(loop);

  const dt = clamp((now - last) / 1000, 0, 0.05);
  last = now;

  stage.pointerToFloor(input.ndc, input.mouseWorld);

  if (running && mode === "guest") {
    // Guests own nothing but their own intent: predict the local shade from it
    // immediately, ship it, and render everyone else from the host's snapshots.
    const me = remote.players.get(remote.myPlayerId) ?? remote.playerList[0];

    const f = me
      ? withAssist(
          input.sample(0, me.pos.x, me.pos.z),
          me,
          remote.enemies.values(),
        )
      : input.sample(0, 0, 0);

    const seq = net.sendInput(f, now);
    // The host's hitstop, applied to the one thing a guest moves on its own.
    // Everything else already stalls, because the poses being interpolated stop
    // changing while the host is frozen — but the local shade is predicted, and
    // without this it glides on through everybody else's freeze frame.
    const gdt = fx.stepTime(dt);
    remote.predictLocal(gdt, f, seq);
    remote.update(gdt);

    // A guest does not know which body is its own until the roster lands, and
    // the big portrait plate belongs to whoever is actually holding the pad.
    if (me) hud.setLocalSeat(me.seat);

    // Seats appear on a guest as the host's roster arrives, not up front.
    for (const p of remote.playerList) {
      if (!hud.hasSeat(p.seat)) {
        hud.addSeat(p.seat, seatLabel(p.seat, p.cls, p.asc), p.cls);
        if (p.asc) guestAscended.add(p.seat);
      } else if (p.asc && !guestAscended.has(p.seat)) {
        // A plate is titled once, when its seat appears. A branch sworn to later
        // in the descent has to come back and rewrite it.
        guestAscended.add(p.seat);
        hud.setSeatName(p.seat, seatLabel(p.seat, p.cls, p.asc));
      }
    }

    hud.update(
      remote.playerList,
      remote.depth,
      remote.label,
      biomeForDepth(remote.depth).name,
    );

    hud.updateBoss(
      [...remote.enemies.values()].find((e) => e.a.boss && !e.dead) ?? null,
    );

    checkGuestOffer();
    reshapeArena();
  } else if (running) {
    checkLocalJoin();

    if (!paused && !pauseHeld) {
      frames.clear();

      for (const p of world.players) {
        const owner = [...seatOwner.entries()].find(
          ([, pid]) => pid === p.id,
        )?.[0];

        frames.set(
          p.id,
          owner === undefined
            ? withAssist(input.sample(p.seat, p.pos.x, p.pos.z), p, world.enemies)
            : (net.remoteFrames.get(owner) ?? null),
        );
      }

      world.update(dt, frames);
      director.update(dt);

      if (world.livePlayers.length === 0 && !clearedHandled) {
        clearedHandled = true;

        onWipe().then(() => {
          clearedHandled = false;
        });
      } else if (director.chamberDone && !clearedHandled) {
        clearedHandled = true;

        onChamberCleared().then(() => {
          clearedHandled = false;
        });
      }
    } else if (!pauseHeld) {
      // Keep the world breathing behind the boon screen, just without agency.
      //
      // Not behind the pause menu, though. The two states arrive here together
      // and want opposite things: an offer is a moment inside the fight and
      // should not freeze-frame it, while a pause is the player stepping away —
      // running the room at 35% still walked enemies into them and could kill a
      // shade sitting in the menu. `pauseHeld` is only ever set for a session
      // that owns its own simulation, so a party's fight still runs on.
      frames.clear();
      world.update(dt * 0.35, frames);
    }

    for (const g of gates) {
      g.update(dt, world.players);
    }

    const live = openGates();

    if (live.length) {
      // Prompt for whichever door someone is actually standing in.
      const active = live.find((g) => g.progress(world.players).in > 0);

      const p = active?.progress(world.players);

      hud.setGatePrompt(
        active && p
          ? p.of > 1
            ? `${active.caption} — ${p.in} / ${p.of}`
            : active.caption
          : t("hud.chooseDoor"),
      );
    }

    hud.update(
      world.players,
      director.depth,
      director.label,
      director.biome.name,
      runObols,
    );

    hud.updateBoss(world.enemies.find((e) => e.a.boss && !e.dead) ?? null);

    // Tension for the drone: how much is alive, whether a boss is up, and how
    // close the party is to going down. Bounded so a full room can't peg it.
    const alive = world.enemies.filter((e) => !e.dead);
    const boss = alive.some((e) => e.a.boss);
    const hurt =
      1 -
      (world.livePlayers.reduce((sum, p) => sum + p.hp / p.maxHp, 0) /
        Math.max(1, world.livePlayers.length));
    audio.setIntensity(
      clamp(alive.length / 8, 0, 0.55) + (boss ? 0.3 : 0) + hurt * 0.35,
    );

    // Cheap no-op unless the region or the party size actually changed.
    reshapeArena();

    /*
     * Only build one that is going to be sent.
     *
     * `buildSnapshot` drains the effect log, so a snapshot built on a tick the
     * 30Hz limiter then throws away takes that tick's sparks, damage numbers and
     * hitstop with it — permanently. Against a 60fps loop that was most of them,
     * which is why a guest's fight looked so much quieter than the host's.
     */
    if (mode === "host" && net.peers.length && net.dueForSnapshot(now)) {
      const owners: [number, number][] = [...seatOwner.entries()];
      // Tell each guest which of its inputs this snapshot already accounts for.
      const acks: [number, number][] = [...net.consumed.entries()];

      const withBuilds = buildsDirty;
      const sent = net.sendSnapshot(
        buildSnapshot(
          world,
          fx,
          tick++,
          owners,
          acks,
          director.depth,
          director.label,
          paused,
          openOffers,
          withBuilds,
        ),
        now,
      );
      if (withBuilds && sent) buildsDirty = false;
    }
  }

  arena.update(dt);
  vfx.update(dt);

  // Hand the fixed light pool the nearest few bolts,
  // so a volley still lights the floor without spawning a light per projectile.
  const lit =
    running && mode === "guest"
      ? remote.boltPositions()
      : world.projectiles.map((p) => ({
          pos: p.pos,
          color: p.color,
        }));

  stage.lightBolts(lit.slice(0, 5));

  let spread =
    running && mode === "guest" ? remote.focus(focus) : world.focus(focus);

  // Pull the open doors into frame the same way a boss is pulled in —
  // a choice between exits you cannot see is not a choice.
  const liveGates = openGates();

  if (liveGates.length) {
    let mx = 0;
    let mz = 0;

    for (const g of liveGates) {
      mx += g.position.x;
      mz += g.position.z;
    }

    mx /= liveGates.length;
    mz /= liveGates.length;

    focus.x += (mx - focus.x) * 0.4;
    focus.z += (mz - focus.z) * 0.4;

    for (const g of liveGates) {
      spread = Math.max(
        spread,
        Math.hypot(g.position.x - focus.x, g.position.z - focus.z),
      );
    }
  }

  stage.follow(focus, dt, spread);
  arena.cullOccluders(stage.camera, focus);

  // A guest simulates nothing, so its World never fills `damageEvents` — the
  // numbers arrive over the wire and land on the bus instead.
  const numbers = mode === "guest" ? fx.damageEvents : world.damageEvents;
  if (settings.damageNumbers) {
    hud.spawnDamage(numbers, stage.camera);
  } else {
    numbers.length = 0;
  }

  applySettings();
  input.endFrame();
  stage.render();
}

// -------------------------------------------------------------- bootstrap

/**
 * Put a saved descent back on its feet.
 *
 * The picks are replayed through the very functions that applied them the first
 * time, in the order they were made. That order is not incidental: a status is
 * last-write-wins, so a shade who took doom and then swore to the storms is a
 * different shade from one who did it the other way round, and only replaying
 * reproduces which of them this is.
 */
function resumeRun(save: RunSave) {
  mode = "solo";
  director.depth = save.depth;
  director.room = save.room;
  runObols = save.obols;
  runKills = save.kills;

  for (const sh of save.shades) {
    const p = addSeat(sh.seat, sh.cls);
    p.applyPicks(sh.picks);
    for (const s of sh.spurned) p.boons.spurned.add(s);

    p.castAmmo = 3 + p.boons.extraCastAmmo;
    p.hp = Math.max(1, Math.round(p.maxHp * sh.hp));
  }

  director.buildChamber();
  startRun();
}

async function boot() {
  const choice = await menu.choose();
  if (choice.mode === "continue") {
    const save = loadRun();
    // The save is read again here rather than trusted from the menu: it is the
    // only read whose result is actually played, and the file could have been
    // cleared by another tab in between.
    if (save) {
      resumeRun(save);
      return;
    }
    boot();
    return;
  }
  if (choice.mode !== "solo") localName = choice.name;
  if (choice.mode === "solo") {
    mode = "solo";
    addSeat(0, choice.cls);
    startRun();
    return;
  }
  menu.setStatus(t("net.connecting"));
  net.connect(
    import.meta.env.VITE_RELAY_URL,
    choice.room,
    choice.name,
    choice.cls,
    // A guest's permanent upgrades have to travel: the host builds every body,
    // so without this a joining player silently loses everything they bought.
    encodeMeta(),
  );
  if (choice.mode === "host") {
    mode = "host";
    addSeat(0, choice.cls);
  }
  // Guests get no local Player at all — their shade is whatever the host's
  // owner table says it is, and it arrives with the first snapshot.
}

boot();

// Dev handle: lets the arena be inspected from the console without a debug build.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__styx = {
    world,
    stage,
    director,
    vfx,
    input,
    net,
    remote,
    arena,
    startRun,
  };
}

requestAnimationFrame(loop);
