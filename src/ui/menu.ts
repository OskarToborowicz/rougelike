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

const CONTROLS: [string, string][] = [
  ['Move', 'W A S D  ·  left stick'],
  ['Aim', 'Mouse  ·  right stick'],
  ['Attack', 'Left mouse  ·  A'],
  ['Special', 'Right mouse  ·  X'],
  ['Cast', 'Q  ·  Y'],
  ['Call', 'F  ·  RB — when the gauge is full'],
  ['Dash', 'Space  ·  B'],
  ['Pause', 'Escape  ·  Start'],
  ['Player two', 'Connect a second gamepad — joins instantly'],
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
  private status = el('div', 'lstatus', '');
  private roster = el('div', 'lroster', '');
  private startBtn = el('button', 'lbtn primary', 'DESCEND') as HTMLButtonElement;

  /** Set while the pause overlay owns the screen. */
  private paused = false;
  private onResume: (() => void) | null = null;
  private onAbandon: (() => void) | null = null;
  private onStart: (() => void) | null = null;
  /** Where escape returns to from the current sub-screen. */
  private backTo: (() => void) | null = null;

  constructor(host: HTMLElement, private audio?: Audio) {
    this.root.id = 'lobby';
    this.root.appendChild(this.panel);
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
    this.panel.innerHTML = '';
    this.panel.append(...children);
    this.root.classList.add('show');
  }

  hide() {
    this.root.classList.remove('show');
    this.backTo = null;
  }

  private title(sub: string) {
    return [el('div', 'ltitle', 'STYX'), el('div', 'lsub', sub)];
  }

  // ------------------------------------------------------------ main menu

  /** Resolves once the player has chosen how to play. */
  choose(): Promise<MenuChoice> {
    return new Promise((resolve) => {
      const titleScreen = () => {
        this.backTo = null;
        const play = el('button', 'lbtn primary', 'PLAY');
        const shrine = el('button', 'lbtn', `THE SHORE · ${meta.obols} ⛁`);
        const options = el('button', 'lbtn', 'OPTIONS');
        const controls = el('button', 'lbtn', 'CONTROLS');
        play.onclick = () => setupScreen();
        shrine.onclick = () => this.showShrine(titleScreen);
        options.onclick = () => this.showOptions(titleScreen);
        controls.onclick = () => this.showControls(titleScreen);
        this.show([
          ...this.title('a co-op descent · up to four shades'),
          play,
          // Only offered once there is something to spend or something spent —
          // a first-time player has no idea what an obol is yet.
          ...(meta.obols > 0 || meta.runs > 0 ? [shrine] : []),
          options,
          controls,
        ]);
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
        code.placeholder = 'CODE';
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
          settings.playerName = name.value.trim() || 'Shade';
          settings.relayUrl = url.value.trim();
          saveSettings();
          localStorage.setItem('styx.class', cls);
        };

        const solo = el('button', 'lbtn primary', 'PLAY SOLO');
        const hostBtn = el('button', 'lbtn', 'HOST ONLINE');
        const joinBtn = el('button', 'lbtn', 'JOIN WITH CODE');
        const back = el('button', 'lbtn ghost', 'BACK');

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
            name: name.value.trim() || 'Shade',
            cls,
          });
        };
        joinBtn.onclick = () => {
          if (code.value.trim().length < 4) {
            this.setStatus('Enter the four-letter code from your host.');
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
          ...this.title('choose your shade'),
          row('name', name),
          picker,
          blurb,
          solo,
          el('div', 'ldiv', 'online'),
          row('relay', url),
          hostBtn,
          row('code', code),
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
          el('div', 'lsumhead', summary.won ? 'THE DESCENT ENDS' : 'YOU HAVE DIED'),
          statLine('Chamber reached', String(summary.depth)),
          statLine('Foes felled', String(summary.kills)),
          statLine('Obols earned', `${summary.earned} ⛁`),
        );
        rows.push(card);
      }

      const purse = el('div', 'lpurse', `${meta.obols} ⛁  ·  deepest ${meta.deepest}  ·  ${meta.runs} runs`);
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
          el('span', 'uc', maxed ? 'MAX' : `${cost} ⛁`),
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

      const done = el('button', 'lbtn primary', summary ? 'DESCEND AGAIN' : 'BACK');
      done.onclick = back;
      rows.push(done);

      this.show([...this.title('the shore'), ...rows]);
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
      sliderRow('Sound', settings.sfxVolume, 0, 1, 0.05, (v) => {
        settings.sfxVolume = v;
        this.audio?.applyVolumes();
        this.audio?.play('uiClick');
        saveSettings();
      })
    );
    rows.push(
      sliderRow('Music', settings.musicVolume, 0, 1, 0.05, (v) => {
        settings.musicVolume = v;
        this.audio?.applyVolumes();
        saveSettings();
      })
    );
    rows.push(
      toggleRow('Damage numbers', settings.damageNumbers, (v) => {
        settings.damageNumbers = v;
        saveSettings();
      })
    );
    rows.push(
      toggleRow('Shadows', settings.shadows, (v) => {
        settings.shadows = v;
        saveSettings();
      })
    );
    rows.push(
      choiceRow('Quality', ['low', 'medium', 'high'], settings.quality, (v) => {
        settings.quality = v as typeof settings.quality;
        saveSettings();
      })
    );
    rows.push(
      sliderRow('Screen shake', settings.shake, 0, 2, 0.1, (v) => {
        settings.shake = v;
        saveSettings();
      })
    );
    rows.push(
      sliderRow('Camera distance', settings.zoom, 0.7, 1.6, 0.05, (v) => {
        settings.zoom = v;
        saveSettings();
      })
    );

    const reset = el('button', 'lbtn ghost', 'RESET TO DEFAULTS');
    reset.onclick = () => {
      Object.assign(settings, { ...DEFAULTS, playerName: settings.playerName, relayUrl: settings.relayUrl });
      saveSettings();
      this.showOptions(back);
    };
    const done = el('button', 'lbtn primary', 'BACK');
    done.onclick = back;

    this.show([...this.title('options'), ...rows, reset, done]);
  }

  showControls(back: () => void) {
    this.backTo = back;
    const list = el('div', 'lkeys');
    for (const [what, how] of CONTROLS) {
      const r = el('div', 'lkey');
      r.append(el('span', 'kw', what), el('span', 'kh', how));
      list.appendChild(r);
    }
    const done = el('button', 'lbtn primary', 'BACK');
    done.onclick = back;
    this.show([...this.title('controls'), list, done]);
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
    const resume = el('button', 'lbtn primary', 'RESUME');
    const options = el('button', 'lbtn', 'OPTIONS');
    const controls = el('button', 'lbtn', 'CONTROLS');
    const abandon = el('button', 'lbtn danger', 'ABANDON RUN');
    resume.onclick = () => this.resume();
    options.onclick = () => this.showOptions(() => this.pauseScreen());
    controls.onclick = () => this.showControls(() => this.pauseScreen());
    abandon.onclick = () => {
      this.paused = false;
      this.onAbandon?.();
    };
    this.show([...this.title('paused'), resume, options, controls, abandon]);
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
    codeBox.title = 'click to copy';
    codeBox.onclick = () => navigator.clipboard?.writeText(room);

    this.startBtn.onclick = () => {
      this.hide();
      this.onStart?.();
    };

    this.show([
      ...this.title(isHost ? 'share this code' : 'joined room'),
      codeBox,
      this.roster,
      isHost ? this.startBtn : el('div', 'lstatus', 'waiting for the host to begin…'),
      this.status,
    ]);
  }

  setRoster(names: string[]) {
    this.roster.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const slot = el('div', 'lslot' + (names[i] ? ' filled' : ''), names[i] || 'open');
      this.roster.appendChild(slot);
    }
  }

  setStatus(text: string) {
    this.status.textContent = text;
  }
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
  const btn = el('button', 'ltoggle' + (value ? ' on' : ''), value ? 'ON' : 'OFF');
  let v = value;
  btn.onclick = () => {
    v = !v;
    btn.textContent = v ? 'ON' : 'OFF';
    btn.classList.toggle('on', v);
    onChange(v);
  };
  r.append(el('span', 'lolabel', label), btn);
  return r;
}

function choiceRow(label: string, options: string[], value: string, onChange: (v: string) => void) {
  const r = el('div', 'lopt');
  const group = el('div', 'lseg');
  const btns = options.map((o) => {
    const b = el('button', 'lsegbtn' + (o === value ? ' on' : ''), o.toUpperCase());
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
