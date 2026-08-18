import * as THREE from 'three';
import { damp } from '../core/math';

/**
 * Hades reads as a painted diorama: a locked ~40° camera, warm key light from the
 * torches, cold rim from the underworld haze, and the floor doing most of the work.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly root = new THREE.Group();
  readonly fx = new THREE.Group();

  private shakeAmp = 0;
  private shakeT = 0;
  private camTarget = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();
  private floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  /** Camera offset from the focus point. Steep enough to read the arena, low enough to feel 3D. */
  private offset = new THREE.Vector3(0, 13.5, 10.5);
  /** Multiplier on `offset`, eased toward whatever the frame needs to contain. */
  private zoom = 1;

  /*
   * Steady-mode comfort pack. All three attack the same thing steady mode was
   * built for — sim sickness — from angles the shake/zoom freeze does not reach:
   *
   *  - deadzone: the frame holds perfectly still until the player leaves a box
   *    at screen centre, then moves only by the overflow. A camera that creeps
   *    after every footstep slides the whole world under a still image, and that
   *    world-slide (vection) is the strongest trigger in a top-down game.
   *  - narrower FOV: less optical flow across the edges of frame, where the eye
   *    reads motion the inner ear cannot feel. The camera pulls back by the same
   *    ratio so the arena still fills the frame — flatter, not more zoomed in.
   *  - motion vignette: darkens the far edges only while the camera is actually
   *    sliding, cutting the peripheral flow the moment it would start to register.
   */
  private steadyFov = 34;
  private baseFov = 42;
  private steadyDistMul = 1.26; // tan(21°)/tan(17°): keeps floor coverage constant as FOV narrows.
  private deadzone = 4.2; // world units; radius of the still box at screen centre.
  private distMul = 1; // eased toward steadyDistMul in steady mode.
  private deadFocus = new THREE.Vector3(); // anchored follow point; only the overflow moves it.
  private deadInit = false;
  private lastCamPos = new THREE.Vector3();
  private lastCamInit = false;
  private vigA = 0; // eased vignette opacity.
  private vignette!: HTMLElement;

  /**
   * The host element, measured for every resize.
   *
   * `innerHeight` is the wrong number on a phone: it counts the space behind a
   * collapsing URL bar, while the canvas is laid out with `100dvh`. Sizing the
   * drawing buffer from the element keeps the two in agreement, so the image
   * never ends up subtly stretched.
   */
  private host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      // Lets a frame be read back for side-by-side art review without a capture harness.
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const size = this.viewport();
    this.renderer.setSize(size.w, size.h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);

    /*
     * The motion vignette lives in #app, next to the canvas and below #ui
     * (z-index 10), so it darkens the arena's far edges without ever touching
     * the HUD — health bars and sticks stay at full strength. pointer-events are
     * off, so it never intercepts a click or a drag.
     */
    this.vignette = document.createElement('div');
    this.vignette.className = 'cam-vignette';
    host.appendChild(this.vignette);

    this.camera = new THREE.PerspectiveCamera(this.baseFov, size.w / size.h, 0.5, 200);
    this.camPos.copy(this.offset);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(0, 0, 0);

    // Cool violet haze, thin enough that the lit floor keeps its value range.
    this.scene.fog = new THREE.FogExp2(0x140c22, 0.016);
    this.scene.background = new THREE.Color(0x090612);
    this.scene.add(this.root, this.fx);

    this.buildLights();

    addEventListener('resize', () => this.resize());
    // Fires when the URL bar slides away or the on-screen keyboard opens —
    // neither of which necessarily raises a window resize.
    visualViewport?.addEventListener('resize', () => this.resize());
    addEventListener('orientationchange', () => this.resize());
  }

  private buildLights() {
    // Cold ambient bounce from the underworld sky, warm from the floor.
    // Kept low: the frame's darks must stay dark or nothing reads as lit.
    this.scene.add(new THREE.HemisphereLight(0x3a4a9c, 0x1a0c14, 0.4));

    const key = new THREE.DirectionalLight(0xffcf92, 2.1);
    key.position.set(-9, 18, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 60;
    const s = 22;
    const cam = key.shadow.camera as THREE.OrthographicCamera;
    cam.left = -s;
    cam.right = s;
    cam.top = s;
    cam.bottom = -s;
    cam.updateProjectionMatrix();
    key.shadow.bias = -0.0012;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);

    // Cold rim from behind separates every silhouette from the floor. This is the
    // single cheapest thing that makes the frame stop looking like grey soup.
    const rim = new THREE.DirectionalLight(0x8fa4ff, 1.5);
    rim.position.set(7, 5, -12);
    this.scene.add(rim);

    const rim2 = new THREE.DirectionalLight(0x5be0d0, 0.55);
    rim2.position.set(-11, 4, -6);
    this.scene.add(rim2);
  }

  /**
   * A fixed pool of lights for projectiles.
   *
   * Three.js bakes the light count into every material's shader, so adding or
   * removing a light recompiles all of them — a boss volley that spawns a light
   * per bolt recompiles the whole scene several times a second, which is exactly
   * what the hitching was. The pool is allocated once and never grows or
   * shrinks; unused lights are simply set to zero intensity.
   */
  private boltLights: THREE.PointLight[] = [];

  private ensureBoltLights(count = 5) {
    while (this.boltLights.length < count) {
      const l = new THREE.PointLight(0xffffff, 0, 7, 2);
      l.visible = true;
      this.scene.add(l);
      this.boltLights.push(l);
    }
  }

  /** Point the pool at whichever bolts are closest to the camera focus. */
  lightBolts(bolts: { pos: THREE.Vector3; color: number }[]) {
    this.ensureBoltLights();
    for (let i = 0; i < this.boltLights.length; i++) {
      const l = this.boltLights[i];
      const b = bolts[i];
      if (!b) {
        // Zero intensity, never removed — keeps the light count constant.
        l.intensity = 0;
        continue;
      }
      l.position.set(b.pos.x, 1.1, b.pos.z);
      l.color.setHex(b.color);
      l.intensity = 5;
    }
  }

  /** Visible size in CSS pixels, from the laid-out host rather than the window. */
  private viewport() {
    const r = this.host.getBoundingClientRect();
    return { w: Math.max(1, Math.round(r.width)), h: Math.max(1, Math.round(r.height)) };
  }

  resize() {
    const { w, h } = this.viewport();
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // `false` leaves the canvas's CSS size alone — the stylesheet owns that, and
    // letting three write inline styles would fight the `!important` rules.
    this.renderer.setSize(w, h, false);
  }

  /** Player-facing multipliers, driven by the options screen. */
  shakeScale = 1;
  zoomScale = 1;
  /** Steady mode: no shake, no zoom drift, a tighter follow. See Settings.steadyCam. */
  steady = false;

  shake(amp: number) {
    if (this.steady) return;
    this.shakeAmp = Math.min(1.4, this.shakeAmp + amp * this.shakeScale);
  }

  /**
   * Follow the action, easing so the frame never snaps.
   *
   * `spread` is the distance from the focus point to the furthest thing that has
   * to stay visible (a second player, the boss). The camera backs off to fit it,
   * and backs off further on narrow viewports where the arena would otherwise
   * overflow the sides.
   */
  follow(focus: THREE.Vector3, dt: number, spread = 0) {
    this.camTarget.copy(focus);

    /*
     * Back off far enough that the room fits front to back.
     *
     * This used to pad only below 1.5, on the theory that a narrow viewport is
     * the one that overflows. It is the wrong axis. The camera looks down at
     * about 52 degrees, so a wide frame projects onto the floor as a wide,
     * shallow trapezoid: at 16:9 it covered 34.6 units across but only 19.1
     * deep, against an arena 23 across. A third of the screen was empty floor
     * beside the arena while the arena's own near and far edges sat off frame —
     * which is exactly what makes a room feel cramped, however big it is.
     *
     * Depth is what has to fit, so the pad is driven by depth for every shape of
     * screen, and the old narrow-viewport case falls out of the same number.
     */
    const aspectPad = 1.4 + Math.max(0, 1.5 - this.camera.aspect) * 0.4;
    const spreadPad = 1 + Math.max(0, spread - 3.0) * 0.1;
    const wantZoom = Math.min(1.85, aspectPad * spreadPad) * this.zoomScale;
    /*
     * Steady mode parks the camera at the distance the worst case would have
     * pulled it to, and leaves it there. The dynamic version is the nicer shot,
     * but a frame that creeps in and out while the player stands still is the
     * classic sim-sickness trigger — the eyes report motion the inner ear does
     * not. It still honours `spread`, because callers in steady mode pass a
     * value that is either zero or frozen for the whole phase — so the distance
     * settles once and then holds, instead of tracking a moving boss.
     */
    const steadyZoom =
      Math.min(1.85, aspectPad * Math.max(1.3, spreadPad)) * this.zoomScale;
    this.zoom = damp(this.zoom, this.steady ? steadyZoom : wantZoom, 3.5, dt);

    /*
     * Deadzone (steady only). The camera follows an anchor, not the raw focus.
     * The anchor holds still while the player stays within `deadzone` of it, and
     * when the player crosses that edge the anchor is pulled up to the edge —
     * never nearer — so the interior of the box stays perfectly dead. Small
     * steps and combat shuffling move nothing; only a real traverse pans.
     */
    let followFocus = this.camTarget;
    if (this.steady) {
      if (!this.deadInit) {
        this.deadFocus.copy(this.camTarget);
        this.deadInit = true;
      }
      const dx = this.camTarget.x - this.deadFocus.x;
      const dz = this.camTarget.z - this.deadFocus.z;
      const d = Math.hypot(dx, dz);
      if (d > this.deadzone) {
        const s = (d - this.deadzone) / d;
        this.deadFocus.x += dx * s;
        this.deadFocus.z += dz * s;
      }
      followFocus = this.deadFocus;
    } else {
      this.deadInit = false;
    }

    // Ease FOV and the matching pull-back so toggling steady mid-run glides
    // rather than jumping. Only touch the projection when the FOV actually moves.
    const wantFov = this.steady ? this.steadyFov : this.baseFov;
    const nextFov = damp(this.camera.fov, wantFov, 4, dt);
    if (Math.abs(nextFov - this.camera.fov) > 1e-3) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }
    this.distMul = damp(this.distMul, this.steady ? this.steadyDistMul : 1, 4, dt);

    // A tighter spring in steady mode: the camera sits on the player rather
    // than swimming after them, so the world stops sliding under a still frame.
    const k = this.steady ? 14 : 6;
    const want = followFocus.clone().addScaledVector(this.offset, this.zoom * this.distMul);
    this.camPos.x = damp(this.camPos.x, want.x, k, dt);
    this.camPos.y = damp(this.camPos.y, want.y, k, dt);
    this.camPos.z = damp(this.camPos.z, want.z, k, dt);

    this.shakeT += dt * 34;
    this.shakeAmp = damp(this.shakeAmp, 0, 9, dt);
    const sx = Math.sin(this.shakeT * 1.7) * this.shakeAmp * 0.42;
    const sy = Math.cos(this.shakeT * 2.3) * this.shakeAmp * 0.3;

    this.camera.position.set(this.camPos.x + sx, this.camPos.y + sy, this.camPos.z);
    this.camera.lookAt(followFocus.x + sx * 0.4, 0.6, followFocus.z);

    /*
     * Motion vignette. Driven by how fast the camera itself is sliding, not by
     * the player's speed — a player walking inside the deadzone moves across a
     * still frame (comfortable), and only a panning frame produces the edge flow
     * we want to mask. Off entirely outside steady mode.
     */
    const camSpeed = this.lastCamInit
      ? Math.hypot(this.camPos.x - this.lastCamPos.x, this.camPos.z - this.lastCamPos.z) /
        Math.max(dt, 1e-3)
      : 0;
    this.lastCamPos.set(this.camPos.x, this.camPos.y, this.camPos.z);
    this.lastCamInit = true;
    const wantVig = this.steady ? Math.min(1, Math.max(0, (camSpeed - 1) / 6)) : 0;
    this.vigA = damp(this.vigA, wantVig, 6, dt);
    this.vignette.style.opacity = (this.vigA * 0.55).toFixed(3);
  }

  /** Project mouse NDC onto the arena floor so keyboard aim tracks the cursor. */
  pointerToFloor(ndc: { x: number; y: number }, out: { x: number; z: number }) {
    this.raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this.camera);
    const hit = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.floorPlane, hit)) {
      out.x = hit.x;
      out.z = hit.z;
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
