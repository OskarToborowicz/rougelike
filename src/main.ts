import * as THREE from "three";
import { Stage } from "./render/scene";
import { Arena } from "./render/arena";
import { Vfx } from "./render/vfx";
import { FxBus } from "./render/fxbus";
import { Input, type Frame } from "./core/input";
import { World } from "./game/world";
import type { Enemy } from "./game/enemy";
import { Player, PLAYER_TINTS } from "./game/player";
import { BoonSet, offer, randomGod, type Boon, type God } from "./game/boons";
import type { WireCard, WireOffer } from "./net/protocol";
import { CLASSES, type ClassId } from "./game/classes";
import { biomeForDepth } from "./render/biome";
import { Director } from "./game/director";
import { Gate } from "./game/gate";
import { offerDoors, type Reward } from "./game/rewards";
import { hammerColor, offerHammers } from "./game/hammers";
import { GODS } from "./game/boons";
import { shuffle } from "./core/math";
import { Hud } from "./ui/hud";
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
 */
const seatLabel = (seat: number, cls: ClassId) =>
  `P${seat + 1} · ${CLASSES[cls].name}`;

/** Which network id owns which seat. Seat 0 is always the local host player. */
const seatOwner = new Map<number, number>();

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
    menu.setStatus(role === "guest" ? "connected — waiting for the host" : "");
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
  onFull: () => menu.setStatus("that room is full — four shades is the limit"),
  onClose: () => {
    if (mode === "guest" && running) {
      // The host owned the simulation, so there is nothing left to play.
      running = false;
      remote.clear();
      hud.reset();
      boot();
      menu.setStatus("lost the host — the run is over");
    }
  },
});

/**
 * Captured once at boot. Reading it back from localStorage would be wrong the
 * moment two clients share an origin — a second tab overwrites the key and the
 * host starts displaying the guest's name as its own.
 */
let localName = "Shade";

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
  hud.addSeat(seat, seatLabel(seat, cls));
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
    hud.showBanner(`${peer.name} joins`);
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

/** Obols a corpse is worth. Bosses pay for the fight they actually were. */
const bounty = (e: Enemy) =>
  e.a.boss ? 60 + director.depth * 8 : Math.round(4 + e.a.hp / 24 + director.depth * 0.6);

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
  hud.showBanner("Player Two");
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
  title: (p: Player) => string;
  accent: (p: Player) => string;
  subtitle: (p: Player) => string;
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
    title: round.title(r.p),
    accent: round.accent(r.p),
    subtitle: round.subtitle(r.p),
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
      round.title(r.p),
      round.accent(r.p),
      round.subtitle(r.p),
      r.choices.map((c) => round.card(r.p, c)),
    );
    localPicks.push({ p: r.p, choice: r.choices.find((c) => c.id === picked.id)! });
  }

  const all = [...localPicks, ...(await Promise.all(remotePicks))];
  openOffers = [];

  for (const { p, choice } of all) {
    round.apply(p, choice);
    p.castAmmo = 3 + p.boons.extraCastAmmo;
    fx.ring(p.pos.x, p.pos.z, round.ring, 2.4, 0.6);
    fx.sfx("boon", p.pos.x, p.pos.z);
  }
}

const runBoonRound = (god: God) =>
  runCardRound<Boon>({
    title: () => god,
    accent: () => GODS[god].css,
    subtitle: (p) => `A boon for ${seatLabel(p.seat, p.cls)}`,
    choices: (p) => offer(p.boons, 3),
    card: (_p, b) => ({
      id: b.id,
      name: b.name,
      desc: b.desc,
      kicker: b.god,
      accent: GODS[b.god].css,
    }),
    apply: (p, b) => p.boons.add(b),
    ring: 0xffd27f,
  });

/** Weapon hammer: pick one of three upgrades to a slot. */
const runHammerRound = () =>
  runCardRound({
    title: () => "HAMMER",
    accent: () => "#ffb04a",
    subtitle: (p) => `A weapon upgrade for ${seatLabel(p.seat, p.cls)}`,
    choices: (p) => offerHammers(p.boons, p.cls, 3),
    card: (_p, h) => ({
      id: h.id,
      name: h.name,
      desc: h.desc,
      kicker: h.slot,
      accent: hammerColor(h),
    }),
    apply: (p, h) => {
      h.apply(p.boons);
      p.boons.hammers.push(h.id);
    },
    ring: 0xffb04a,
  });

/** Pom: empower a boon already held, raising its level. */
const runPomRound = () =>
  runCardRound<Boon>({
    title: () => "EMPOWER",
    accent: () => "#d6a6ff",
    subtitle: (p) => `Strengthen a boon of ${seatLabel(p.seat, p.cls)}`,
    choices: (p) => shuffle(p.boons.taken.slice()).slice(0, 3),
    card: (p, b) => ({
      id: b.id,
      name: `${b.name}  ${"I".repeat(Math.min(5, p.boons.levelOf(b.id)))}→${"I".repeat(
        Math.min(5, p.boons.levelOf(b.id) + 1),
      )}`,
      desc: b.desc,
      kicker: b.god,
      accent: GODS[b.god].css,
    }),
    apply: (p, b) => p.boons.upgrade(b),
    ring: 0xd6a6ff,
  });

// Dev-only handle. Combat and reward states that take minutes to reach by
// playing — a full Call gauge, a hammer round with a guest connected — are one
// line away from the console with this. Stripped from production builds.
if (import.meta.env.DEV) {
  (window as any).styx = {
    world,
    hud,
    fx,
    audio,
    settings,
    meta,
    remote,
    net,
    runBoonRound,
    runHammerRound,
    runPomRound,
    seatOwner,
    get openOffers() {
      return openOffers;
    },
  };
}

/** Pay out whatever the chosen door promised. */
async function grantReward(reward: Reward) {
  if (reward.kind === "boon" && reward.god) {
    await runBoonRound(reward.god);
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
  hud.showBanner("Vitality");
  await wait(900);
}

async function onChamberCleared() {
  paused = true;
  fx.ring(0, 0, 0xffd27f, 3, 0.8);
  hud.showBanner("Chamber Cleared");
  // Let the banner finish its full animation before the boon screen comes up —
  // the two overlap in the middle of the frame otherwise.
  await wait(2000);

  world.projectiles.forEach((pr) => stage.root.remove(pr.mesh));
  world.projectiles.length = 0;

  // Hand control back and open the ways out. The chamber ends when the party
  // agrees on a door — not when the last enemy falls.
  paused = false;
  const anyBoons = world.players.some((p) => p.boons.taken.length > 0);
  const doors = offerDoors(
    director.depth,
    Math.random() < 0.25 ? 3 : 2,
    anyBoons,
  );
  doors.forEach((door, i) => gates[i].show(door, i, doors.length));
  hud.showBanner("Choose Your Path");

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

  const wasBiome = director.biome.id;
  director.nextChamber();
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
      : `Chamber ${director.depth}`,
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
  const key = `${mine.pid}:${mine.title}:${mine.cards.map((c) => c.id).join(",")}`;
  if (key === shownOffer) return;
  shownOffer = key;

  hud
    .offerCards(mine.title, mine.accent, mine.subtitle, mine.cards)
    .then((picked) => net.sendPick(picked.id));
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
  hud.showBanner("You Have Died");
  fx.shake(0.9);
  await wait(2300);
  world.clearEnemies();
  hideGates();
  hud.setGatePrompt(null);
  world.projectiles.forEach((pr) => stage.root.remove(pr.mesh));
  world.projectiles.length = 0;

  recordRun(director.depth);
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
 * Escape opens the pause menu.
 *
 * Only when hosting alone or playing solo: a host who pauses would freeze the
 * simulation for everyone else, and a guest cannot pause a world it does not
 * own. In a real party the menu still opens for settings, but the fight runs on.
 */
addEventListener("keydown", (e) => {
  if (e.code !== "Escape" || !running || menu.isPaused) return;
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
  running = false;
  paused = true;
  // Walking away still counts as a descent — the obols are already banked, and
  // the deepest-chamber record should not depend on dying to earn it.
  if (mode !== "guest") recordRun(director.depth);
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

    const f = input.sample(0, me?.pos.x ?? 0, me?.pos.z ?? 0);

    const seq = net.sendInput(f, now);
    remote.predictLocal(dt, f, seq);
    remote.update(dt);

    // Seats appear on a guest as the host's roster arrives, not up front.
    for (const p of remote.playerList) {
      if (!hud.hasSeat(p.seat)) {
        hud.addSeat(p.seat, seatLabel(p.seat, p.cls));
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
            ? input.sample(p.seat, p.pos.x, p.pos.z)
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
    } else {
      // Keep the world breathing behind the boon screen, just without agency.
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
          : "Choose a door",
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

    if (mode === "host" && net.peers.length) {
      const owners: [number, number][] = [...seatOwner.entries()];
      // Tell each guest which of its inputs this snapshot already accounts for.
      const acks: [number, number][] = [...net.consumed.entries()];

      net.sendSnapshot(
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
        ),
        now,
      );
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

  if (settings.damageNumbers) {
    hud.spawnDamage(world.damageEvents, stage.camera);
  } else {
    world.damageEvents.length = 0;
  }

  applySettings();
  input.endFrame();
  stage.render();
}

// -------------------------------------------------------------- bootstrap

async function boot() {
  const choice = await menu.choose();
  if (choice.mode !== "solo") localName = choice.name;
  if (choice.mode === "solo") {
    mode = "solo";
    addSeat(0, choice.cls);
    startRun();
    return;
  }
  menu.setStatus("connecting…");
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
