import { clamp } from './math';
import { TouchControls } from './touch';

export type Action = 'attack' | 'special' | 'cast' | 'dash' | 'call' | 'interact';

export interface Frame {
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  /** Actions pressed this frame (edge-triggered). */
  pressed: Set<Action>;
  held: Set<Action>;
}

const emptyFrame = (): Frame => ({
  moveX: 0,
  moveY: 0,
  aimX: 1,
  aimY: 0,
  pressed: new Set(),
  held: new Set(),
});

const KEYMAP: Record<string, Action> = {
  Mouse0: 'attack',
  Mouse2: 'special',
  KeyQ: 'cast',
  Space: 'dash',
  KeyF: 'call',
  KeyE: 'interact',
};

const PAD_MAP: Record<number, Action> = {
  0: 'attack', // A / cross
  2: 'special', // X / square
  3: 'cast', // Y / triangle
  1: 'dash', // B / circle
  5: 'call', // RB
  4: 'interact', // LB
};

/**
 * Two local seats. Seat 0 is keyboard+mouse (falls back to pad 0 if a stick moves),
 * seat 1 is the first gamepad. Online peers write their frames straight into `remote`.
 */
export class Input {
  private keys = new Set<string>();
  private keysDown = new Set<string>();
  private mouseNDC = { x: 0, y: 0 };
  /** World-space point the mouse currently hovers on the arena floor; set by the renderer. */
  mouseWorld = { x: 0, z: 0 };
  private padDeadzone = 0.22;
  /** On-screen sticks. Hidden until the screen is actually touched. */
  readonly touch: TouchControls;

  constructor(private canvasHost: HTMLElement) {
    this.touch = new TouchControls(document.body);

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.keysDown.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.keysDown.clear();
    });
    addEventListener('mousedown', (e) => {
      this.keys.add('Mouse' + e.button);
      this.keysDown.add('Mouse' + e.button);
    });
    addEventListener('mouseup', (e) => this.keys.delete('Mouse' + e.button));
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      const r = this.canvasHost.getBoundingClientRect();
      this.mouseNDC.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.mouseNDC.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    });
  }

  get ndc() {
    return this.mouseNDC;
  }

  private dz(v: number) {
    return Math.abs(v) < this.padDeadzone ? 0 : v;
  }

  private pad(index: number): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    let seen = 0;
    for (const p of pads) {
      if (!p) continue;
      if (seen === index) return p;
      seen++;
    }
    return null;
  }

  /** Build the frame for a local seat. Call once per seat per tick, then `endFrame()`. */
  sample(seat: number, playerX: number, playerZ: number): Frame {
    const f = emptyFrame();
    const pad = this.pad(seat === 0 ? 0 : 1);

    if (seat === 0) {
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) f.moveX -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) f.moveX += 1;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) f.moveY -= 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) f.moveY += 1;
      for (const [code, act] of Object.entries(KEYMAP)) {
        if (this.keys.has(code)) f.held.add(act);
        if (this.keysDown.has(code)) f.pressed.add(act);
      }
      const dx = this.mouseWorld.x - playerX;
      const dz = this.mouseWorld.z - playerZ;
      const len = Math.hypot(dx, dz) || 1;
      f.aimX = dx / len;
      f.aimY = dz / len;

      // Touch overrides the mouse rather than blending with it: a stale cursor
      // position sitting in the corner of a tablet would otherwise fight the
      // thumb for the aim direction on every frame.
      if (this.touch.active) {
        const m = this.touch.moveVector;
        if (m.x || m.y) {
          f.moveX = m.x;
          f.moveY = m.y;
        }
        const a = this.touch.aimVector;
        if (a) {
          f.aimX = a.x;
          f.aimY = a.y;
        } else if (m.x || m.y) {
          // No right thumb down: face where you are going. The aim above came
          // from the mouse, which on a phone is wherever the cursor happened to
          // land — so without this the shade walks sideways staring at a corner
          // of the screen. Matches what the second gamepad already does.
          const l = Math.hypot(m.x, m.y);
          f.aimX = m.x / l;
          f.aimY = m.y / l;
        }
        for (const act of this.touch.heldActions) f.held.add(act);
        for (const act of this.touch.pressedActions) f.pressed.add(act);
      }
    }

    if (pad) {
      const px = this.dz(pad.axes[0] ?? 0);
      const py = this.dz(pad.axes[1] ?? 0);
      if (px || py) {
        f.moveX = px;
        f.moveY = py;
      }
      const ax = this.dz(pad.axes[2] ?? 0);
      const az = this.dz(pad.axes[3] ?? 0);
      if (ax || az) {
        const l = Math.hypot(ax, az);
        f.aimX = ax / l;
        f.aimY = az / l;
      } else if (seat !== 0 && (px || py)) {
        const l = Math.hypot(px, py);
        f.aimX = px / l;
        f.aimY = py / l;
      }
      for (const [btn, act] of Object.entries(PAD_MAP)) {
        const b = pad.buttons[+btn];
        if (b?.pressed) {
          f.held.add(act);
          if (!this.padPrev[seat]?.has(+btn)) f.pressed.add(act);
        }
      }
      const now = new Set<number>();
      pad.buttons.forEach((b, i) => b.pressed && now.add(i));
      this.padPrev[seat] = now;
    }

    const mag = Math.hypot(f.moveX, f.moveY);
    if (mag > 1) {
      f.moveX /= mag;
      f.moveY /= mag;
    }
    f.moveX = clamp(f.moveX, -1, 1);
    f.moveY = clamp(f.moveY, -1, 1);
    return f;
  }

  private padPrev: Record<number, Set<number>> = {};

  endFrame() {
    this.keysDown.clear();
    this.touch.endFrame();
  }

  /** True once this device has actually been touched. Gates aim assist. */
  get usingTouch() {
    return this.touch.active;
  }

  /** True if a second gamepad-driven seat should exist. */
  get hasSecondPad() {
    return !!this.pad(1);
  }
}
