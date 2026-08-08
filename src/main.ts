import * as THREE from "three";
import { Stage } from "./render/scene";
import { Arena } from "./render/arena";
import { Vfx } from "./render/vfx";
import { FxBus } from "./render/fxbus";
import { Input, type Frame } from "./core/input";
import { World } from "./game/world";
import { Player, PLAYER_TINTS } from "./game/player";
import { BoonSet, offer, randomGod, type Boon, type God } from "./game/boons";
import type { WireOffer } from "./net/protocol";
import { CLASSES, type ClassId } from "./game/classes";
import { biomeForDepth } from "./render/biome";
import { Director } from "./game/director";
import { Gate } from "./game/gate";
import { offerDoors, type Reward } from "./game/rewards";
import { hammerColor, offerHammers } from "./game/hammers";
import { GODS } from "./game/boons";
import { shuffle } from "./core/math";
import { Hud } from "./ui/hud";
import { Menu } from "./ui/menu";
import { pixelRatioFor, settings } from "./ui/settings";
import { Net } from "./net/net";
import { MAX_PLAYERS } from "./net/protocol";
import { buildSnapshot, RemoteView } from "./net/sync";
import { clamp } from "./core/math";

const host = document.getElementById("app")!;
const stage = new Stage(host);
const arena = new Arena(stage.scene);
stage.root.add(arena.group);

const vfx = new Vfx(stage.fx);
const fx = new FxBus(vfx, stage);
const input = new Input(stage.renderer.domElement);
const hud = new Hud();
const menu = new Menu(document.body);
const world = new World(stage.root, fx);
const remote = new RemoteView(stage.root, fx);
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

function addSeat(seat: number, cls: ClassId = "warrior") {
  const p = new Player(
    0,
    seat,
    new BoonSet(),
    PLAYER_TINTS[seat % PLAYER_TINTS.length],
    cls,
  );
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
    const p = addSeat(world.players.length, (peer.cls as ClassId) ?? "warrior");
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

// ------------------------------------------------------------------- run

function startRun() {
  running = true;
  paused = false;
  if (mode === "host") {
    fx.record = net.peers.length > 0;
    seatJoin();
  }
  reshapeArena();
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
 * Everyone chooses at once.
 *
 * Each seat gets its own offer; the local player sees the chooser, remote seats
 * get theirs pushed in the snapshot and answer with a pick. A guest who never
 * answers falls back to a random boon after a timeout, so one idle player can
 * never stall the run.
 */
async function runBoonRound(god: God) {
  const rolls = world.players
    .map((p) => ({ p, god, choices: offer(p.boons, 3) }))
    .filter((r) => r.choices.length > 0);
  if (!rolls.length) return;

  openOffers = rolls
    .filter((r) => isRemoteSeat(r.p.id))
    .map((r) => ({
      pid: r.p.id,
      god: r.god,
      boons: r.choices.map((b) => ({
        id: b.id,
        god: b.god,
        name: b.name,
        desc: b.desc,
      })),
    }));

  const remote = rolls.filter((r) => isRemoteSeat(r.p.id));
  const local = rolls.filter((r) => !isRemoteSeat(r.p.id));

  // Remote seats choose in parallel — they each have their own screen.
  const remotePicks = remote.map(async (r) => {
    const chosenId = await new Promise<string | null>((resolve) => {
      pendingPicks.set(r.p.id, resolve);
      // 45s is long enough to read three cards and far short of stalling a run.
      setTimeout(() => resolve(null), 45000);
    });
    pendingPicks.delete(r.p.id);
    return {
      p: r.p,
      boon:
        r.choices.find((b) => b.id === chosenId) ??
        r.choices[Math.floor(Math.random() * r.choices.length)],
    };
  });

  // Local seats share one screen, so they must choose one after another.
  const localPicks: { p: Player; boon: Boon }[] = [];
  for (const r of local) {
    const boon = await hud.offerBoons(
      r.god,
      r.choices,
      seatLabel(r.p.seat, r.p.cls),
    );
    localPicks.push({ p: r.p, boon });
  }

  const all = [...localPicks, ...(await Promise.all(remotePicks))];
  openOffers = [];

  for (const { p, boon } of all) {
    p.boons.add(boon);
    p.castAmmo = 3 + p.boons.extraCastAmmo;
    fx.ring(p.pos.x, p.pos.z, 0xffd27f, 2.4, 0.6);
  }
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

/** Weapon hammer: pick one of three upgrades to a slot. Local seats only for now. */
async function runHammerRound() {
  for (const p of world.players) {
    const choices = offerHammers(p.boons, p.cls, 3);
    if (!choices.length) continue;
    if (isRemoteSeat(p.id)) {
      // Remote seats take a random hammer until they have their own screen.
      const h = choices[Math.floor(Math.random() * choices.length)];
      h.apply(p.boons);
      p.boons.hammers.push(h.id);
      continue;
    }
    const picked = await hud.offerCards(
      "HAMMER",
      "#ffb04a",
      `A weapon upgrade for ${seatLabel(p.seat, p.cls)}`,
      choices.map((h) => ({
        id: h.id,
        name: h.name,
        desc: h.desc,
        kicker: h.slot,
        accent: hammerColor(h),
      })),
    );
    const h = choices.find((x) => x.id === picked.id)!;
    h.apply(p.boons);
    p.boons.hammers.push(h.id);
    p.castAmmo = 3 + p.boons.extraCastAmmo;
    fx.ring(p.pos.x, p.pos.z, 0xffb04a, 2.4, 0.6);
  }
}

/** Pom: empower a boon already held, raising its level. */
async function runPomRound() {
  for (const p of world.players) {
    const held = p.boons.taken;
    if (!held.length) continue;
    const choices = shuffle(held.slice()).slice(0, 3);
    if (isRemoteSeat(p.id)) {
      p.boons.upgrade(choices[Math.floor(Math.random() * choices.length)]);
      continue;
    }
    const picked = await hud.offerCards(
      "EMPOWER",
      "#d6a6ff",
      `Strengthen a boon of ${seatLabel(p.seat, p.cls)}`,
      choices.map((b) => ({
        id: b.id,
        name: `${b.name}  ${"I".repeat(Math.min(5, p.boons.levelOf(b.id)))}→${"I".repeat(
          Math.min(5, p.boons.levelOf(b.id) + 1),
        )}`,
        desc: b.desc,
        kicker: b.god,
        accent: GODS[b.god].css,
      })),
    );
    p.boons.upgrade(held.find((b) => b.id === picked.id)!);
    p.castAmmo = 3 + p.boons.extraCastAmmo;
    fx.ring(p.pos.x, p.pos.z, 0xd6a6ff, 2.4, 0.6);
  }
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

  const chosen = await new Promise<Gate | null>((resolve) => {
    const check = () => {
      const taken = openGates().find((g) => g.allThrough(world.players));
      if (taken) return resolve(taken);
      if (!openGates().length) return resolve(null);
      setTimeout(check, 100);
    };
    check();
  });

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
 * Guest side of the boon round. The host publishes open offers in the snapshot;
 * when one is addressed to this client's shade, put the same chooser on screen
 * the host uses and send the answer back.
 */
function checkGuestOffer() {
  const mine = remote.offers.find((o) => o.pid === remote.myPlayerId);
  if (!mine) {
    shownOffer = "";
    return;
  }
  const key = `${mine.pid}:${mine.boons.map((b) => b.id).join(",")}`;
  if (key === shownOffer) return;
  shownOffer = key;

  const me = remote.players.get(remote.myPlayerId);
  const seatName = me ? seatLabel(me.seat, me.cls) : "SHADE";
  hud
    .offerBoons(mine.god as God, mine.boons as unknown as Boon[], seatName)
    .then((picked) => net.sendPick(picked.id));
}

/**
 * A wipe ends the run. Boons are lost, the descent restarts at chamber one —
 * the roguelike contract. Co-op only wipes when *everyone* is down, so a single
 * death is always recoverable by a partner.
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
  for (const p of world.players) {
    p.boons = new BoonSet();
    p.hp = p.maxHp;
    p.dead = false;
    p.state = "idle";
    p.iframes = 1.5;
    p.reviveProgress = 0;
    p.castAmmo = 3;
    p.callGauge = 0;
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
  net.disconnect();
  world.clearEnemies();
  hideGates();
  hud.setGatePrompt(null);
  world.projectiles.forEach((pr) => stage.root.remove(pr.mesh));
  world.projectiles.length = 0;
  for (const p of world.players) stage.root.remove(p.mesh);
  world.players.length = 0;
  remote.clear();
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
    );

    hud.updateBoss(world.enemies.find((e) => e.a.boss && !e.dead) ?? null);

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
