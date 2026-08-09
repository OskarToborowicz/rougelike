import * as THREE from 'three';
import type { Player } from '../game/player';
import type { Enemy } from '../game/enemy';
import { GODS } from '../game/boons';
import type { DamageEvent } from '../game/world';
import { clamp } from '../core/math';
import { ROOMS, type RoomKind } from '../game/rewards';
import { onLanguageChange, t } from './i18n';

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
  return room && room !== 'combat'
    ? `${ROOMS[room as RoomKind].label} · ${wave}`
    : wave;
}

const el = (tag: string, cls?: string, html?: string) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};

/** Anything the card chooser can display. */
export interface Card {
  id: string;
  name: string;
  desc: string;
  /** Small label above the name — a god, a rarity, a slot. */
  kicker: string;
  accent: string;
}

interface SeatUi {
  seat: number;
  root: HTMLElement;
  fill: HTMLElement;
  lag: HTMLElement;
  num: HTMLElement;
  pips: HTMLElement;
  call: HTMLElement;
  boons: HTMLElement;
  downed: HTMLElement;
  name: HTMLElement;
  lastBoonCount: number;
}

export class Hud {
  private root = document.getElementById('ui')!;
  private seats: SeatUi[] = [];
  private roomWave = el('div', 'wave', '');
  private roomDepth = el('div', 'depth', '');
  /** Obols banked so far this run. Hidden until the first one drops. */
  private purse = el('div', 'purse', '');
  private choice = el('div');
  private banner = el('div');
  private hurt = el('div');
  private boss = el('div');
  private bossBar = el('div');
  private bossFill = el('i');
  private bossLag = el('i');
  private bossTitle = el('div');
  private gatePrompt = el('div');
  private v3 = new THREE.Vector3();

  constructor() {
    this.root.appendChild(el('div', '', '')).id = 'vignette';
    (this.root.lastChild as HTMLElement).id = 'vignette';

    this.hurt.id = 'hurtflash';
    this.root.appendChild(this.hurt);

    const info = el('div');
    info.id = 'roominfo';
    info.append(this.roomDepth, this.roomWave, this.purse);
    this.root.appendChild(info);

    this.boss.id = 'boss';
    this.bossBar.className = 'bbar';
    this.bossBar.append(this.bossLag, this.bossFill);
    this.bossLag.className = 'lag';
    this.boss.append(this.bossTitle, this.bossBar);
    this.bossTitle.className = 'btitle';
    this.root.appendChild(this.boss);

    this.choice.id = 'choice';
    this.root.appendChild(this.choice);

    this.banner.id = 'banner';
    this.root.appendChild(this.banner);

    this.gatePrompt.id = 'gateprompt';
    this.root.appendChild(this.gatePrompt);

    const hint = el('div', '', t('hud.hint'));
    hint.id = 'hint';
    this.root.appendChild(hint);
    // Written once at boot and then left on screen, so it has to be told.
    onLanguageChange(() => {
      hint.textContent = t('hud.hint');
      // Boon chips are only rebuilt when the count changes; force the next frame
      // to redraw them so their names follow the language too.
      for (const s of this.seats) s.lastBoonCount = -1;
    });
  }

  addSeat(index: number, name: string) {
    const root = el('div', `seat p${index}`);
    const bar = el('div', 'bar');
    const lag = el('i', 'lag') as HTMLElement;
    const fill = el('i', 'fill') as HTMLElement;
    const num = el('div', 'num', '');
    bar.append(lag, fill, num);
    const pips = el('div', 'pips');
    const callbar = el('div', 'callbar');
    const call = el('i');
    callbar.appendChild(call);
    const boons = el('div', 'boons');
    const downed = el('div', 'downed', '');
    const nameEl = el('div', 'name', name);
    root.append(nameEl, bar, pips, callbar, boons, downed);
    this.root.appendChild(root);
    this.seats.push({
      seat: index,
      root,
      fill,
      lag,
      num,
      pips,
      call,
      boons,
      downed,
      name: nameEl,
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
    for (const s of this.seats) s.root.remove();
    this.seats.length = 0;
    this.setGatePrompt(null);
    this.updateBoss(null);
  }

  /** Seats already laid out, by seat index. Guests learn theirs from snapshots. */
  hasSeat(seat: number) {
    return this.seats.some((s) => s.seat === seat);
  }

  update(
    players: Player[],
    depth: number,
    waveToken: string,
    region: string,
    runObols = 0
  ) {
    this.roomDepth.textContent = t('hud.room', { region, n: depth });
    this.roomWave.textContent = waveLabel(waveToken);
    // Stays blank until the first obol drops, so a brand new player is never
    // shown a counter for a system they have not met yet.
    this.purse.textContent = runObols > 0 ? `${runObols} ◆` : '';

    let worst = 1;
    players.forEach((p) => {
      // Look up by seat, never by array index — in co-op a player can leave and
      // the remaining ones must keep their own corner of the screen.
      const s = this.seats.find((x) => x.seat === p.seat);
      if (!s) return;
      const frac = clamp(p.hp / p.maxHp, 0, 1);
      worst = Math.min(worst, p.dead ? 0 : frac);
      s.fill.style.transform = `scaleX(${frac})`;
      s.lag.style.transform = `scaleX(${frac})`;
      s.num.textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;

      const ammo = 3 + p.boons.extraCastAmmo;
      if (s.pips.children.length !== ammo) {
        s.pips.innerHTML = '';
        for (let k = 0; k < ammo; k++) s.pips.appendChild(el('i', 'pip'));
      }
      Array.from(s.pips.children).forEach((c, k) =>
        c.classList.toggle('on', k < p.castAmmo)
      );

      s.call.style.transform = `scaleX(${p.callGauge})`;
      // A full bar has to announce itself, or the player never learns the key
      // exists. The pulse stops the moment it's spent.
      s.call.parentElement?.classList.toggle('ready', p.callGauge >= 1);

      if (s.lastBoonCount !== p.boons.taken.length) {
        s.lastBoonCount = p.boons.taken.length;
        s.boons.innerHTML = '';
        for (const b of p.boons.taken) {
          const chip = el('span', 'boon-chip', b.name);
          chip.style.color = GODS[b.god].css;
          s.boons.appendChild(chip);
        }
      }

      s.downed.textContent = p.dead
        ? t('hud.downed', { pct: Math.round(p.reviveProgress * 100) })
        : '';
    });

    this.hurt.style.opacity = worst < 0.34 ? String(0.35 + (0.34 - worst) * 1.6) : '0';
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
      const n = el('div', `float${e.crit ? ' crit' : ''}`, e.crit ? `${e.amount}!` : `${e.amount}`);
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
   * The card chooser, used for every "pick one of three" moment: god boons,
   * boon upgrades, and weapon hammers. They share one screen so the player
   * learns the interaction once.
   */
  offerCards<T extends Card>(
    title: string,
    titleColor: string,
    subtitle: string,
    cards: T[]
  ): Promise<T> {
    return new Promise((resolve) => {
      this.choice.innerHTML = '';
      const head = el('div', 'head');
      const g = el('div', 'god', title);
      g.style.color = titleColor;
      head.append(g, el('div', 'sub', subtitle));
      const list = el('div', 'cards');

      const finish = (c: T) => {
        this.choice.classList.remove('show');
        removeEventListener('keydown', onKey);
        resolve(c);
      };
      const onKey = (e: KeyboardEvent) => {
        const i = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
        if (i >= 0 && cards[i]) finish(cards[i]);
      };

      cards.forEach((card, i) => {
        const c = el('div', 'card');
        c.style.color = card.accent;
        const kicker = el('div', 'cgod', card.kicker);
        kicker.style.color = card.accent;
        c.append(
          kicker,
          el('div', 'cname', card.name),
          el('div', 'cdesc', card.desc),
          el('div', 'key', t('hud.press', { n: i + 1 }))
        );
        c.onclick = () => finish(card);
        list.appendChild(c);
      });

      this.choice.append(head, list);
      this.choice.classList.add('show');
      addEventListener('keydown', onKey);
    });
  }
}
