import { makeRoomCode } from '../net/protocol';
import { CLASSES, CLASS_ORDER, type ClassId } from '../game/classes';
import type { Audio } from '../audio/audio';
import { buy, canAfford, levelOf, meta, nextCost, UPGRADES } from '../game/meta';

/** What a finished run is worth, shown at the top of the shore screen. */
export interface RunSummary {
  depth: number;
  kills: number;
  earned: number;
  won: boolean;
}
import { DEFAULTS, saveSettings, settings } from './settings';
import { LANG_LABEL, LANGS, language, setLanguage, t, type Key, type Lang } from './i18n';
import { PANTHEON_ORDER, PANTHEONS, pantheonName, roundel } from '../game/pantheons';
import { titleArt } from './art';

export type MenuChoice =
  | { mode: 'solo'; cls: ClassId }
  | { mode: 'host'; room: string; url: string; name: string; cls: ClassId }
  | { mode: 'join'; room: string; url: string; name: string; cls: ClassId };

const el = (tag: string, cls?: string, html?: string) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};

/** Default relay: same host as the page, on the relay port. */
function defaultRelay() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.hostname}:8787`;
}

/** Key pairs, resolved when the screen is built so a language switch takes. */
const CONTROLS: [Key, Key][] = [
  ['controls.move', 'controls.move.how'],
  ['controls.aim', 'controls.aim.how'],
  ['controls.attack', 'controls.attack.how'],
  ['controls.special', 'controls.special.how'],
  ['controls.cast', 'controls.cast.how'],
  ['controls.call', 'controls.call.how'],
  ['controls.concord', 'controls.concord.how'],
  ['controls.dash', 'controls.dash.how'],
  ['controls.pause', 'controls.pause.how'],
  ['controls.touch', 'controls.touch.how'],
  ['controls.p2', 'controls.p2.how'],
];

/**
 * Every screen the player sees outside the fight: title, setup, options,
 * controls, the waiting room, and the pause overlay.
 *
 * One element, one visible panel at a time. Keeping them in a single class means
 * "escape goes back" is a single rule rather than a rule per screen.
 */
export class Menu {
  private root = el('div');
  private panel = el('div', 'lpanel');
  /**
   * The title screen is full-bleed art, not a centred panel, so it gets its own
   * layer. Exactly one of the two is ever populated.
   */
  private bleed = el('div');
  private status = el('div', 'lstatus', '');
  private roster = el('div', 'lroster', '');
  private startBtn = el('button', 'lbtn primary', t('menu.descend')) as HTMLButtonElement;

  /** Set while the pause overlay owns the screen. */
  private paused = false;
  private onResume: (() => void) | null = null;
  private onAbandon: (() => void) | null = null;
  private onStart: (() => void) | null = null;
  /** Where escape returns to from the current sub-screen. */
  private backTo: (() => void) | null = null;

  constructor(host: HTMLElement, private audio?: Audio) {
    this.root.id = 'lobby';
    this.root.append(this.bleed, this.panel);
    host.appendChild(this.root);

    // The menu is where the first click of the session lands, which makes it the
    // only place allowed to start the AudioContext. Capture phase, so audio is
    // alive before any handler that wants to make a sound runs.
    this.root.addEventListener(
      'pointerdown',
      (e) => {
        this.audio?.unlock();
        const t = e.target as HTMLElement;
        if (t.closest('button')) this.audio?.play('uiClick');
      },
      true
    );
    this.root.addEventListener('pointerover', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('button')) this.audio?.play('uiHover');
    });

    addEventListener('keydown', (e) => {
      if (e.code !== 'Escape') return;
      if (this.backTo) {
        e.preventDefault();
        const back = this.backTo;
        this.backTo = null;
        back();
        return;
      }
      if (this.paused) {
        e.preventDefault();
        this.resume();
      }
    });
  }

  private show(children: HTMLElement[]) {
    this.bleed.innerHTML = '';
    this.panel.style.display = '';
    this.panel.innerHTML = '';
    this.panel.append(...children);
    this.root.classList.add('show');
  }

  /** Hand the whole screen to one element. Used only by the title. */
  private showBleed(node: HTMLElement) {
    this.panel.innerHTML = '';
    this.panel.style.display = 'none';
    this.bleed.replaceChildren(node);
    this.root.classList.add('show');
  }

  hide() {
    this.root.classList.remove('show');
    this.backTo = null;
  }

  private title(sub: string) {
    return [el('div', 'ltitle', t('brand')), el('div', 'lsub', sub)];
  }

  // ------------------------------------------------------------ main menu

  /** Resolves once the player has chosen how to play. */
  choose(): Promise<MenuChoice> {
    return new Promise((resolve) => {
      const titleScreen = () => {
        this.backTo = null;

        const screen = el('div', 'e-title');
        const art = el('div', 'e-title-art');
        art.appendChild(titleArt());
        screen.append(art, el('div', 'e-title-scrim'), el('div', 'e-title-glow'));

        const body = el('div', 'e-title-body');
        body.append(
          el('div', 'e-rule'),
          el('div', 'e-kicker', t('menu.kicker')),
          el('div', 'e-wordmark e-leaf', t('brand')),
          el('div', 'e-subtitle', t('menu.sub.title'))
        );

        const menu = el('div', 'e-menu');
        const row = (label: string, onClick: () => void, primary = false) => {
          const r = el('button', 'e-menu-row' + (primary ? ' primary' : ''));
          r.append(
            el('span', 'e-diamond'),
            el('span', 'e-menu-label', label),
            el('span')
          );
          r.onclick = onClick;
          menu.appendChild(r);
          return r;
        };

        row(t('menu.play'), () => setupScreen(), true);
        // The reliquary is only offered once there is something to spend or
        // something spent — a first-time player has no idea what an obol is yet.
        if (meta.obols > 0 || meta.runs > 0) {
          const r = row(t('menu.shore'), () => this.showShrine(titleScreen));
          const aside = el('span', 'e-menu-aside');
          aside.append(el('span', 'e-obol'), el('span', '', String(meta.obols)));
          r.replaceChild(aside, r.lastChild as HTMLElement);
        }
        row(t('menu.options'), () => this.showOptions(titleScreen));
        row(t('menu.controls'), () => this.showControls(titleScreen));
        body.appendChild(menu);
        screen.appendChild(body);

        screen.append(thronesRow(), el('div', 'e-tagline', t('menu.tagline')));
        this.showBleed(screen);
      };

      const setupScreen = () => {
        this.backTo = titleScreen;

        const name = el('input', 'lfield') as HTMLInputElement;
        name.value = settings.playerName;
        name.maxLength = 16;

        const url = el('input', 'lfield') as HTMLInputElement;
        url.value = settings.relayUrl || defaultRelay();

        const code = el('input', 'lfield code') as HTMLInputElement;
        code.maxLength = 6;
        code.placeholder = t('menu.code.placeholder');
        code.oninput = () => (code.value = code.value.toUpperCase());

        let cls: ClassId = (localStorage.getItem('styx.class') as ClassId) || 'warrior';
        if (!CLASS_ORDER.includes(cls)) cls = 'warrior';
        const blurb = el('div', 'lblurb', CLASSES[cls].blurb);
        const picker = el('div', 'lclasses');
        const tiles = new Map<ClassId, HTMLElement>();
        for (const id of CLASS_ORDER) {
          const def = CLASSES[id];
          const tile = el('button', 'lclass');
          tile.append(el('span', 'cn', def.name), el('span', 'ct', def.title));
          tile.onclick = () => {
            cls = id;
            tiles.forEach((t, k) => t.classList.toggle('on', k === id));
            blurb.textContent = def.blurb;
          };
          tiles.set(id, tile);
          picker.appendChild(tile);
        }
        tiles.get(cls)!.classList.add('on');

        const remember = () => {
          settings.playerName = name.value.trim() || t('menu.defaultName');
          settings.relayUrl = url.value.trim();
          saveSettings();
          localStorage.setItem('styx.class', cls);
        };

        const solo = el('button', 'lbtn primary', t('menu.playSolo'));
        const hostBtn = el('button', 'lbtn', t('menu.host'));
        const joinBtn = el('button', 'lbtn', t('menu.join'));
        const back = el('button', 'lbtn ghost', t('menu.back'));

        solo.onclick = () => {
          remember();
          this.hide();
          resolve({ mode: 'solo', cls });
        };
        hostBtn.onclick = () => {
          remember();
          this.backTo = null;
          resolve({
            mode: 'host',
            room: makeRoomCode(),
            url: url.value.trim(),
            name: name.value.trim() || t('menu.defaultName'),
            cls,
          });
        };
        joinBtn.onclick = () => {
          if (code.value.trim().length < 4) {
            this.setStatus(t('menu.needCode'));
            return;
          }
          remember();
          this.backTo = null;
          resolve({
            mode: 'join',
            room: code.value.trim(),
            url: url.value.trim(),
            name: name.value.trim() || 'Shade',
            cls,
          });
        };
        back.onclick = titleScreen;

        this.show([
          ...this.title(t('menu.sub.setup')),
          row(t('menu.field.name'), name),
          picker,
          blurb,
          solo,
          el('div', 'ldiv', t('menu.online')),
          row(t('menu.field.relay'), url),
          hostBtn,
          row(t('menu.field.code'), code),
          joinBtn,
          back,
          this.status,
        ]);
      };

      titleScreen();
    });
  }

  // --------------------------------------------------------------- shrine

  /**
   * Where obols are spent. Reachable from the title, and shown automatically
   * after a wipe with that run's summary at the top — the moment a player most
   * wants to see that the run they just lost was worth something.
   */
  showShrine(back: () => void, summary?: RunSummary) {
    this.backTo = back;

    const render = () => {
      const rows: HTMLElement[] = [];

      if (summary) {
        const card = el('div', 'lsummary');
        card.append(
          el('div', 'lsumhead', t(summary.won ? 'shrine.won' : 'shrine.died')),
          statLine(t('shrine.depth'), String(summary.depth)),
          statLine(t('shrine.kills'), String(summary.kills)),
          statLine(t('shrine.earned'), `${summary.earned} ◆`),
        );
        rows.push(card);
      }

      const purse = el(
        'div',
        'lpurse',
        t('shrine.purse', { obols: meta.obols, deepest: meta.deepest, runs: meta.runs })
      );
      rows.push(purse);

      const list = el('div', 'lupgrades');
      for (const u of UPGRADES) {
        const lvl = levelOf(u.id);
        const cost = nextCost(u);
        const maxed = cost === null;
        const afford = canAfford(u);

        const item = el(
          'button',
          'lupgrade' + (maxed ? ' maxed' : afford ? '' : ' poor'),
        ) as HTMLButtonElement;
        const pips = Array.from({ length: u.maxLevel }, (_, i) =>
          i < lvl ? '●' : '○',
        ).join('');
        item.append(
          el('span', 'un', u.name),
          el('span', 'ud', u.desc(lvl + (maxed ? 0 : 1))),
          el('span', 'ul', pips),
          el('span', 'uc', maxed ? t('shrine.max') : `${cost} ◆`),
        );
        item.disabled = maxed || !afford;
        item.onclick = () => {
          if (!buy(u)) return;
          this.audio?.play('boon');
          render();
        };
        list.appendChild(item);
      }
      rows.push(list);

      const done = el(
        'button',
        'lbtn primary',
        summary ? t('shrine.again') : t('menu.back')
      );
      done.onclick = back;
      rows.push(done);

      this.show([...this.title(t('shrine.sub')), ...rows]);
    };

    render();
  }

  // -------------------------------------------------------------- options

  showOptions(back: () => void) {
    this.backTo = back;
    const rows: HTMLElement[] = [];

    // Volume first: it is the setting a player reaches for soonest, and the one
    // they want to change without hunting.
    rows.push(
      sliderRow(t('options.sound'), settings.sfxVolume, 0, 1, 0.05, (v) => {
        settings.sfxVolume = v;
        this.audio?.applyVolumes();
        this.audio?.play('uiClick');
        saveSettings();
      })
    );
    rows.push(
      sliderRow(t('options.music'), settings.musicVolume, 0, 1, 0.05, (v) => {
        settings.musicVolume = v;
        this.audio?.applyVolumes();
        saveSettings();
      })
    );
    rows.push(
      toggleRow(t('options.damageNumbers'), settings.damageNumbers, (v) => {
        settings.damageNumbers = v;
        saveSettings();
      })
    );
    rows.push(
      toggleRow(t('options.shadows'), settings.shadows, (v) => {
        settings.shadows = v;
        saveSettings();
      })
    );
    rows.push(
      choiceRow(
        t('options.quality'),
        ['low', 'medium', 'high'],
        settings.quality,
        (q) => t(`options.quality.${q}` as Key),
        (v) => {
          settings.quality = v as typeof settings.quality;
          saveSettings();
        }
      )
    );
    rows.push(
      sliderRow(t('options.shake'), settings.shake, 0, 2, 0.1, (v) => {
        settings.shake = v;
        saveSettings();
      })
    );
    rows.push(
      sliderRow(t('options.zoom'), settings.zoom, 0.7, 1.6, 0.05, (v) => {
        settings.zoom = v;
        saveSettings();
      })
    );

    // Last of the settings, and the only one that redraws the screen it sits on.
    rows.push(
      choiceRow(
        t('options.language'),
        LANGS,
        language(),
        (l) => LANG_LABEL[l as Lang],
        (v) => {
          setLanguage(v as Lang);
          this.showOptions(back);
        }
      )
    );

    const reset = el('button', 'lbtn ghost', t('options.reset'));
    reset.onclick = () => {
      Object.assign(settings, { ...DEFAULTS, playerName: settings.playerName, relayUrl: settings.relayUrl });
      saveSettings();
      this.showOptions(back);
    };
    const done = el('button', 'lbtn primary', t('menu.back'));
    done.onclick = back;

    this.show([...this.title(t('options.sub')), ...rows, reset, done]);
  }

  showControls(back: () => void) {
    this.backTo = back;
    const list = el('div', 'lkeys');
    for (const [what, how] of CONTROLS) {
      const r = el('div', 'lkey');
      r.append(el('span', 'kw', t(what)), el('span', 'kh', t(how)));
      list.appendChild(r);
    }
    const done = el('button', 'lbtn primary', t('menu.back'));
    done.onclick = back;
    this.show([...this.title(t('controls.sub')), list, done]);
  }

  // ---------------------------------------------------------------- pause

  get isPaused() {
    return this.paused;
  }

  openPause(onResume: () => void, onAbandon: () => void) {
    this.paused = true;
    this.onResume = onResume;
    this.onAbandon = onAbandon;
    this.pauseScreen();
  }

  private pauseScreen() {
    this.backTo = null;
    const resume = el('button', 'lbtn primary', t('pause.resume'));
    const options = el('button', 'lbtn', t('menu.options'));
    const controls = el('button', 'lbtn', t('menu.controls'));
    const abandon = el('button', 'lbtn danger', t('pause.abandon'));
    resume.onclick = () => this.resume();
    options.onclick = () => this.showOptions(() => this.pauseScreen());
    controls.onclick = () => this.showControls(() => this.pauseScreen());
    abandon.onclick = () => {
      this.paused = false;
      this.onAbandon?.();
    };
    this.show([...this.title(t('pause.sub')), resume, options, controls, abandon]);
  }

  private resume() {
    this.paused = false;
    this.backTo = null;
    this.hide();
    this.onResume?.();
  }

  // ----------------------------------------------------------- room / net

  showRoom(room: string, isHost: boolean, onStart: () => void) {
    this.onStart = onStart;
    this.backTo = null;
    const codeBox = el('div', 'lcode', room);
    codeBox.title = t('room.copy');
    codeBox.onclick = () => navigator.clipboard?.writeText(room);

    this.startBtn.onclick = () => {
      this.hide();
      this.onStart?.();
    };

    this.show([
      ...this.title(t(isHost ? 'room.sub.host' : 'room.sub.guest')),
      codeBox,
      this.roster,
      isHost ? this.startBtn : el('div', 'lstatus', t('room.waiting')),
      this.status,
    ]);
  }

  setRoster(names: string[]) {
    this.roster.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const slot = el(
        'div',
        'lslot' + (names[i] ? ' filled' : ''),
        names[i] || t('room.slot.open')
      );
      this.roster.appendChild(slot);
    }
  }

  setStatus(text: string) {
    this.status.textContent = text;
  }
}

/**
 * The seven thrones along the foot of the title. Struck-metal roundels carrying
 * their numeral; `spurned` greys out the ones that have stopped speaking to the
 * party, which is only ever non-empty mid-run.
 */
export function thronesRow(spurned?: ReadonlySet<string>) {
  const row = el('div', 'e-thrones');
  for (const id of PANTHEON_ORDER) {
    const p = PANTHEONS[id];
    const cell = el('div', 'e-throne' + (spurned?.has(id) ? ' spurned' : ''));
    const disc = el('span', 'e-roundel', p.numeral);
    disc.style.background = roundel(id);
    disc.style.color = p.ink;
    cell.append(disc, el('span', 'e-throne-name', pantheonName(id)));
    row.appendChild(cell);
  }
  return row;
}

// --------------------------------------------------------------- widgets

function statLine(label: string, value: string) {
  const r = el('div', 'lstat');
  r.append(el('span', '', label), el('b', '', value));
  return r;
}

function row(label: string, input: HTMLElement) {
  const r = el('label', 'lrow');
  r.append(el('span', '', label), input);
  return r;
}

function toggleRow(label: string, value: boolean, onChange: (v: boolean) => void) {
  const r = el('div', 'lopt');
  const btn = el(
    'button',
    'ltoggle' + (value ? ' on' : ''),
    t(value ? 'options.on' : 'options.off')
  );
  let v = value;
  btn.onclick = () => {
    v = !v;
    btn.textContent = t(v ? 'options.on' : 'options.off');
    btn.classList.toggle('on', v);
    onChange(v);
  };
  r.append(el('span', 'lolabel', label), btn);
  return r;
}

/** `text` turns each option id into what its button says. */
function choiceRow(
  label: string,
  options: string[],
  value: string,
  text: (v: string) => string,
  onChange: (v: string) => void
) {
  const r = el('div', 'lopt');
  const group = el('div', 'lseg');
  const btns = options.map((o) => {
    const b = el('button', 'lsegbtn' + (o === value ? ' on' : ''), text(o));
    b.onclick = () => {
      btns.forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      onChange(o);
    };
    group.appendChild(b);
    return b;
  });
  r.append(el('span', 'lolabel', label), group);
  return r;
}

function sliderRow(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (v: number) => void
) {
  const r = el('div', 'lopt');
  const input = el('input', 'lslider') as HTMLInputElement;
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const read = el('span', 'lovalue', value.toFixed(2));
  input.oninput = () => {
    const v = Number(input.value);
    read.textContent = v.toFixed(2);
    onChange(v);
  };
  r.append(el('span', 'lolabel', label), input, read);
  return r;
}
