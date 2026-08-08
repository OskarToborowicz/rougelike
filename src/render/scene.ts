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

  constructor(host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      // Lets a frame be read back for side-by-side art review without a capture harness.
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.5, 200);
    this.camPos.copy(this.offset);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(0, 0, 0);

    // Cool violet haze, thin enough that the lit floor keeps its value range.
    this.scene.fog = new THREE.FogExp2(0x140c22, 0.016);
    this.scene.background = new THREE.Color(0x090612);
    this.scene.add(this.root, this.fx);

    this.buildLights();

    addEventListener('resize', () => this.resize());
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

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  /** Player-facing multipliers, driven by the options screen. */
  shakeScale = 1;
  zoomScale = 1;

  shake(amp: number) {
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

    const aspectPad = this.camera.aspect < 1.5 ? 1 + (1.5 - this.camera.aspect) * 0.55 : 1;
    const spreadPad = 1 + Math.max(0, spread - 3.0) * 0.1;
    const wantZoom = Math.min(1.85, aspectPad * spreadPad) * this.zoomScale;
    this.zoom = damp(this.zoom, wantZoom, 3.5, dt);

    const want = this.camTarget.clone().addScaledVector(this.offset, this.zoom);
    this.camPos.x = damp(this.camPos.x, want.x, 6, dt);
    this.camPos.y = damp(this.camPos.y, want.y, 6, dt);
    this.camPos.z = damp(this.camPos.z, want.z, 6, dt);

    this.shakeT += dt * 34;
    this.shakeAmp = damp(this.shakeAmp, 0, 9, dt);
    const sx = Math.sin(this.shakeT * 1.7) * this.shakeAmp * 0.42;
    const sy = Math.cos(this.shakeT * 2.3) * this.shakeAmp * 0.3;

    this.camera.position.set(this.camPos.x + sx, this.camPos.y + sy, this.camPos.z);
    this.camera.lookAt(this.camTarget.x + sx * 0.4, 0.6, this.camTarget.z);
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
