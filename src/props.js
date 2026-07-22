import * as THREE from 'three';

/**
 * Wall torch VISUAL only (bracket + flame). The actual illumination comes from
 * a small pool of shared PointLights (see game.js) that hop to the nearest
 * torches each frame — toggling real lights on/off would recompile materials
 * and stutter on mobile, so we keep the light count fixed instead.
 */
export function makeTorch(pos) {
  const group = new THREE.Group();
  group.position.copy(pos);

  const bracket = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.5, 6),
    new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.8, metalness: 0.5 })
  );
  bracket.position.y = -0.25;
  group.add(bracket);

  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.4, 7),
    new THREE.MeshBasicMaterial({ color: 0xffb24d }));
  flame.position.y = 0.06;
  group.add(flame);
  const flameCore = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.24, 6),
    new THREE.MeshBasicMaterial({ color: 0xffe6a0 }));
  flameCore.position.y = 0.08;
  group.add(flameCore);

  let t = Math.random() * 10;
  return {
    group,
    flicker: 1,
    update(dt) {
      t += dt * 12;
      const f = 0.75 + Math.sin(t) * 0.12 + Math.sin(t * 2.3) * 0.08 + (Math.random() - 0.5) * 0.1;
      this.flicker = f;
      flame.scale.y = 0.85 + f * 0.25;
      flame.rotation.z = Math.sin(t * 0.7) * 0.08;
    },
  };
}

/** A sliding stone portcullis / gate that seals the way forward. */
export class Gate {
  constructor(scene, pos, width = 4.5) {
    this.group = new THREE.Group();
    this.group.position.copy(pos);
    this.open = false;
    this._t = 0;

    const mat = new THREE.MeshStandardMaterial({ color: 0x55503f, roughness: 0.9, metalness: 0.15 });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(width, 5.4, 0.5), mat);
    slab.position.y = 2.7;
    slab.castShadow = true;
    this.group.add(slab);
    // bars for a portcullis look
    const barMat = new THREE.MeshStandardMaterial({ color: 0x3a3830, roughness: 0.7, metalness: 0.4 });
    for (let i = -1; i <= 1; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 5.4, 0.12), barMat);
      bar.position.set(i * 1.2, 2.7, 0.3);
      this.group.add(bar);
    }
    this._slab = this.group;
    this._closedY = 0;
    scene.add(this.group);
  }

  trigger() { this.open = true; }

  /** Solid collider box while closed, so it blocks the player. */
  get collider() {
    if (this.open) return null;
    const w = 2.6, d = 1.0;
    return {
      min: { x: this.group.position.x - w, z: this.group.position.z - d },
      max: { x: this.group.position.x + w, z: this.group.position.z + d },
    };
  }

  update(dt) {
    if (this.open && this._t < 1) {
      this._t = Math.min(1, this._t + dt * 0.6);
      this.group.position.y = this._closedY + this._t * 5.2; // rise into the ceiling
    }
  }
}

/** Base for anything the player can walk up to and interact with. */
class Interactable {
  constructor(pos, prompt, radius = 2.6) {
    this.position = pos.clone();
    this.prompt = prompt;
    this.radius = radius;
    this.done = false;
  }
}

export class Lever extends Interactable {
  constructor(scene, pos, onPull) {
    super(pos, 'Pull', 2.4);
    this.onPull = onPull;
    this.group = new THREE.Group();
    this.group.position.copy(pos);

    const baseMat = new THREE.MeshStandardMaterial({ color: 0x4a4636, roughness: 0.9 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.3), baseMat);
    base.position.y = 0.4; this.group.add(base);

    this._handle = new THREE.Group();
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 6),
      new THREE.MeshStandardMaterial({ color: 0x6b6250, metalness: 0.4, roughness: 0.5 }));
    rod.position.y = 0.35; this._handle.add(rod);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xc8a24a, metalness: 0.6, roughness: 0.3 }));
    knob.position.y = 0.7; this._handle.add(knob);
    this._handle.position.y = 0.7;
    this._handle.rotation.x = -0.5;
    this.group.add(this._handle);
    scene.add(this.group);
  }

  interact() {
    if (this.done) return null;
    this.done = true;
    this._handle.rotation.x = 0.5;
    if (this.onPull) this.onPull();
    return 'With a grinding roar, ancient chains haul the gate open.';
  }
}

export class Chest extends Interactable {
  constructor(scene, pos, reward) {
    super(pos, 'Loot', 2.4);
    this.reward = reward; // {msg, apply}
    this.group = new THREE.Group();
    this.group.position.copy(pos);
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x5a3d22, roughness: 0.85 });
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x3a352c, metalness: 0.5, roughness: 0.5 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.6, 0.7), woodMat);
    body.position.y = 0.3; body.castShadow = true; this.group.add(body);
    this._lid = new THREE.Group();
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.28, 0.72), woodMat);
    lid.position.set(0, 0, 0); this._lid.add(lid);
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.08, 0.74), ironMat);
    this._lid.add(band);
    this._lid.position.set(0, 0.6, -0.35);
    this.group.add(this._lid);

    // faint golden glow to draw the eye
    const glow = new THREE.PointLight(0xffcf66, 0.0, 4, 2);
    glow.position.set(0, 0.6, 0);
    this.group.add(glow);
    this._glow = glow;
    scene.add(this.group);
  }

  interact() {
    if (this.done) return null;
    this.done = true;
    this._lid.rotation.x = -1.6; // open
    this._glow.intensity = 1.5;
    if (this.reward.apply) this.reward.apply();
    return this.reward.msg;
  }
}

/** The word wall + Dragonstone — the dungeon's objective. */
export class WordWall extends Interactable {
  constructor(scene, pos, onClaim) {
    super(pos, 'Take Dragonstone', 3.2);
    this.onClaim = onClaim;
    this.group = new THREE.Group();
    this.group.position.copy(pos);

    // curved wall
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x4a4638, roughness: 0.95 });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 5, 24, 1, true, -0.9, 1.8), wallMat);
    wall.position.y = 2.5;
    wall.material.side = THREE.DoubleSide;
    this.group.add(wall);

    // glowing dragon-script arc
    this._glyphs = [];
    const glyphMat = new THREE.MeshBasicMaterial({ color: 0x63d6ff });
    for (let i = 0; i < 9; i++) {
      const a = -0.7 + i * 0.175;
      const g = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.05), glyphMat.clone());
      g.position.set(Math.sin(a) * 2.85, 3.1, Math.cos(a) * 2.85 - 0);
      g.lookAt(0, 3.1, 0);
      g.material.transparent = true;
      this.group.add(g);
      this._glyphs.push(g);
    }
    const wallLight = new THREE.PointLight(0x4fb0ff, 1.6, 12, 2);
    wallLight.position.set(0, 3, 1.5);
    this.group.add(wallLight);
    this._wallLight = wallLight;

    // Dragonstone on a pedestal
    this._stone = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.4),
      new THREE.MeshStandardMaterial({ color: 0x2c3540, emissive: 0x2266aa, emissiveIntensity: 0.6, roughness: 0.4, metalness: 0.3 })
    );
    this._stone.position.set(0, 1.4, 1.6);
    this.group.add(this._stone);
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 1.0, 8),
      new THREE.MeshStandardMaterial({ color: 0x413c30, roughness: 0.9 }));
    pedestal.position.set(0, 0.5, 1.6);
    this.group.add(pedestal);

    this._t = 0;
    scene.add(this.group);
  }

  interact() {
    if (this.done) return null;
    this.done = true;
    this._stone.visible = false;
    if (this.onClaim) this.onClaim();
    return 'You seize the Dragonstone. The barrow trembles…';
  }

  update(dt) {
    this._t += dt;
    if (this._stone.visible) {
      this._stone.rotation.y += dt * 1.2;
      this._stone.position.y = 1.4 + Math.sin(this._t * 2) * 0.08;
    }
    const pulse = 0.6 + Math.sin(this._t * 2.5) * 0.4;
    for (const g of this._glyphs) g.material.opacity = pulse;
    this._wallLight.intensity = 1.2 + pulse * 0.6;
  }
}
