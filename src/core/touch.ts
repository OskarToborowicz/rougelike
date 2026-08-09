import { clamp } from './math';
import type { Action } from './input';
import { onLanguageChange, t, type Key } from '../ui/i18n';

/**
 * On-screen controls for touch devices.
 *
 * The game is a twin-stick action roguelike, so it gets twin-stick controls:
 * the left thumb moves, the right thumb aims *and* fires. Anything else — a
 * fire button separate from aiming, or tap-to-move — would make the dodge/aim
 * overlap that the whole combat design rests on physically impossible.
 *
 * Both sticks are floating: they appear wherever the thumb lands rather than at
 * a fixed spot, because a fixed stick on a phone means constantly looking down
 * to find it. The buttons are fixed, because they are targets, not axes.
 */

/** One live finger driving a stick. */
interface Stick {
  /** Pointer id that owns this stick, or null when idle. */
  id: number | null;
  /** Where the thumb first landed — the stick's centre. */
  originX: number;
  originY: number;
  /** Current offset from the origin, already normalised to -1..1. */
  x: number;
  y: number;
}

const newStick = (): Stick => ({ id: null, originX: 0, originY: 0, x: 0, y: 0 });

/** How far the thumb must travel for full deflection. */
const STICK_RANGE = 62;
/** Below this the stick reads as "not moving" — thumbs are never perfectly still. */
const STICK_DEAD = 0.16;

/** The buttons, in the order they are laid out. */
const BUTTONS: { action: Action; key: Key; cls: string }[] = [
  { action: 'dash', key: 'touch.dash', cls: 'b-dash' },
  { action: 'special', key: 'touch.special', cls: 'b-special' },
  { action: 'cast', key: 'touch.cast', cls: 'b-cast' },
  { action: 'call', key: 'touch.call', cls: 'b-call' },
];

/**
 * Take pinch and double-tap zoom away.
 *
 * Three layers, because no single one covers every engine:
 *
 *   · `touch-action: none` in hud.css handles pinch and double-tap wherever it
 *     is honoured, and is what stops the browser stealing a pointer stream
 *     mid-gesture
 *   · `user-scalable=no` in the viewport meta handles the rest — except iOS,
 *     which has ignored that attribute since iOS 10
 *   · and these three Safari-only gesture events are what is actually left on
 *     an iPhone
 *
 * A zoomed-in arena mid-fight is a lost run, and there is no in-game control to
 * zoom back out — the only way back is a page reload, which ends the descent.
 *
 * Deliberately not touching keyboard zoom: ctrl+scroll and ctrl+plus are how a
 * player with poor eyesight reads a desktop screen, and nothing about a mouse
 * makes the arena scroll away by accident.
 */
function blockZoomGestures() {
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }

  // Belt and braces for engines that honour neither the meta tag nor
  // touch-action: a second finger is never anything this game needs.
  addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false }
  );
}

export class TouchControls {
  /** True once this device has actually been touched, not merely capable of it. */
  active = false;

  private move = newStick();
  private aim = newStick();
  private held = new Set<Action>();
  private pressed = new Set<Action>();
  /** Buttons currently under a finger, by pointer id, so lifting releases the right one. */
  private buttonOf = new Map<number, Action>();

  private root = document.createElement('div');
  private moveEl = stickElement();
  private aimEl = stickElement();
  private buttonEls = new Map<Action, HTMLElement>();

  constructor(host: HTMLElement) {
    // Before anything else, and regardless of whether this device turns out to
    // have a touchscreen at all — the cost is three listeners that never fire.
    blockZoomGestures();

    this.root.id = 'touch';
    this.root.append(this.moveEl.wrap, this.aimEl.wrap);

    const pad = document.createElement('div');
    pad.className = 'tbuttons';
    for (const b of BUTTONS) {
      const el = document.createElement('button');
      el.className = `tbtn ${b.cls}`;
      el.textContent = t(b.key);
      // The pad is built once and then lives for the session, so it has to be
      // told when the language changes.
      onLanguageChange(() => (el.textContent = t(b.key)));
      // The button owns its own pointer so a thumb sliding off it still releases.
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.wake();
        // Register the press *before* capturing. Capture is only an ergonomic
        // nicety — it keeps a thumb that slides off the button still owning it —
        // and it can throw for a pointer the element never legitimately owned.
        // If that ever happened first, the button would silently do nothing.
        this.buttonOf.set(e.pointerId, b.action);
        this.held.add(b.action);
        this.pressed.add(b.action);
        el.classList.add('on');
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* no live pointer to capture; the press still counts */
        }
      });
      const release = (e: PointerEvent) => {
        if (this.buttonOf.get(e.pointerId) !== b.action) return;
        this.buttonOf.delete(e.pointerId);
        this.held.delete(b.action);
        el.classList.remove('on');
      };
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      pad.appendChild(el);
      this.buttonEls.set(b.action, el);
    }
    this.root.appendChild(pad);
    host.appendChild(this.root);

    // Sticks are driven from the whole surface, not from an element, so the
    // thumb can land anywhere on its half of the screen.
    addEventListener('pointerdown', (e) => this.onDown(e), { passive: false });
    addEventListener('pointermove', (e) => this.onMove(e), { passive: false });
    addEventListener('pointerup', (e) => this.onUp(e));
    addEventListener('pointercancel', (e) => this.onUp(e));
  }

  /**
   * Reveal the controls the first time a finger touches the screen.
   *
   * Capability is not intent: plenty of laptops report a touchscreen and are
   * played with a mouse, and showing a thumbstick to those players would be
   * clutter. So the layout stays hidden until someone actually touches it.
   */
  private wake() {
    if (this.active) return;
    this.active = true;
    document.body.classList.add('touching');
  }

  private isTouch(e: PointerEvent) {
    return e.pointerType === 'touch' || e.pointerType === 'pen';
  }

  private onDown(e: PointerEvent) {
    if (!this.isTouch(e)) return;
    // A tap on the menu, the card chooser or a button is UI, not a stick. The
    // listener is on `window`, so the target is not guaranteed to be an Element.
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('button, #lobby, #choice')) return;
    this.wake();
    e.preventDefault();

    const left = e.clientX < innerWidth * 0.5;
    const stick = left ? this.move : this.aim;
    if (stick.id !== null) return;
    stick.id = e.pointerId;
    stick.originX = e.clientX;
    stick.originY = e.clientY;
    stick.x = 0;
    stick.y = 0;
    this.render(stick, left ? this.moveEl : this.aimEl, true);
  }

  private onMove(e: PointerEvent) {
    if (!this.isTouch(e)) return;
    for (const [stick, el] of [
      [this.move, this.moveEl],
      [this.aim, this.aimEl],
    ] as const) {
      if (stick.id !== e.pointerId) continue;
      e.preventDefault();
      const dx = e.clientX - stick.originX;
      const dy = e.clientY - stick.originY;
      const len = Math.hypot(dx, dy);
      // Past full deflection the origin follows the thumb, so a long drag never
      // ends up with the stick pinned and the visual lagging behind the finger.
      if (len > STICK_RANGE) {
        stick.originX += (dx / len) * (len - STICK_RANGE);
        stick.originY += (dy / len) * (len - STICK_RANGE);
      }
      stick.x = clamp((e.clientX - stick.originX) / STICK_RANGE, -1, 1);
      stick.y = clamp((e.clientY - stick.originY) / STICK_RANGE, -1, 1);
      this.render(stick, el, true);
    }
  }

  private onUp(e: PointerEvent) {
    for (const [stick, el] of [
      [this.move, this.moveEl],
      [this.aim, this.aimEl],
    ] as const) {
      if (stick.id !== e.pointerId) continue;
      stick.id = null;
      stick.x = 0;
      stick.y = 0;
      this.render(stick, el, false);
    }
    const action = this.buttonOf.get(e.pointerId);
    if (action) {
      this.buttonOf.delete(e.pointerId);
      this.held.delete(action);
      this.buttonEls.get(action)?.classList.remove('on');
    }
  }

  private render(stick: Stick, el: StickEl, visible: boolean) {
    el.wrap.classList.toggle('show', visible);
    if (!visible) return;
    el.wrap.style.transform = `translate(${stick.originX}px, ${stick.originY}px)`;
    el.knob.style.transform = `translate(${stick.x * STICK_RANGE * 0.55}px, ${
      stick.y * STICK_RANGE * 0.55
    }px)`;
  }

  /** Movement vector, already deadzoned. */
  get moveVector() {
    const len = Math.hypot(this.move.x, this.move.y);
    if (len < STICK_DEAD) return { x: 0, y: 0 };
    return { x: this.move.x, y: this.move.y };
  }

  /**
   * Aim direction, or null when the right thumb is down. Holding the aim stick
   * is what fires — a separate fire button would need a third thumb.
   */
  get aimVector() {
    const len = Math.hypot(this.aim.x, this.aim.y);
    if (len < STICK_DEAD) return null;
    return { x: this.aim.x / len, y: this.aim.y / len };
  }

  /** Actions held this frame, including the implicit attack from the aim stick. */
  get heldActions(): Set<Action> {
    const out = new Set(this.held);
    if (this.aimVector) out.add('attack');
    return out;
  }

  /**
   * Actions that began this frame.
   *
   * A held aim stick re-arms `attack` every frame rather than only on the edge.
   * The attack is edge-triggered by design — on desktop you click once per
   * swing — but nobody can tap glass five times a second while also steering
   * with the other thumb, so touch autofires. The state machine still gates it:
   * a new swing only starts when the previous one has recovered, so this reads
   * as "hold to keep attacking", not as a faster attack.
   */
  get pressedActions(): Set<Action> {
    const out = new Set(this.pressed);
    if (this.aimVector) out.add('attack');
    return out;
  }

  /** Clear edge-triggered state. Called once per tick, after sampling. */
  endFrame() {
    this.pressed.clear();
  }
}

interface StickEl {
  wrap: HTMLElement;
  knob: HTMLElement;
}

function stickElement(): StickEl {
  const wrap = document.createElement('div');
  wrap.className = 'tstick';
  const ring = document.createElement('i');
  ring.className = 'tring';
  const knob = document.createElement('i');
  knob.className = 'tknob';
  wrap.append(ring, knob);
  return { wrap, knob };
}
