import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const WALK_SPEED = 5.2;
const RUN_SPEED = 9.0;
const TURN_LERP = 12;

export class Player {
  constructor() {
    this.root = new THREE.Group();
    this.model = null;
    this.mixer = null;
    this.actions = {};       // name -> AnimationAction
    this.current = null;
    this.radius = 0.75;

    this.maxHealth = 100; this.health = 100;
    this.maxStamina = 100; this.stamina = 100;
    this.alive = true;

    this.attackDamage = 34;
    this.attacking = false;
    this.attackTimer = 0;
    this.attackDuration = 0.62;
    this.hitWindow = [0.18, 0.42];  // seconds during which the swing connects
    this.hasHitThisSwing = false;
    this.attackCooldown = 0;

    this.facing = 0;         // yaw radians
    this._tmp = new THREE.Vector3();
  }

  async load() {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync('assets/models/hero.glb');
    const model = gltf.scene;

    // Normalize scale to ~1.85 units tall and drop feet to y=0.
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3(); box.getSize(size);
    const height = size.y || 1;
    const scale = 1.85 / height;
    model.scale.setScalar(scale);

    box.setFromObject(model);
    model.position.y -= box.min.y;      // feet on the floor
    model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });

    this.model = model;
    this.root.add(model);

    // Blob shadow
    this.root.add(makeBlobShadow(0.95));

    // Animations — pick clips heuristically since we don't know the rig's names.
    this.mixer = new THREE.AnimationMixer(model);
    const clips = gltf.animations || [];
    const find = (...keys) =>
      clips.find((c) => keys.some((k) => c.name.toLowerCase().includes(k)));

    const idle = find('idle', 'stand', 'breath') || clips[0];
    const move = find('run', 'walk', 'jog', 'sprint') || idle;
    const attack = find('attack', 'slash', 'swing', 'punch', 'hit', 'kick', 'melee') || move;

    if (idle) this.actions.idle = this._makeAction(idle);
    if (move) this.actions.move = this._makeAction(move);
    // Only wire up a one-shot attack action if it's a genuinely distinct clip;
    // otherwise reusing the idle/move clip as LoopOnce would freeze locomotion.
    if (attack && attack !== idle && attack !== move) {
      this.actions.attack = this._makeAction(attack);
      this.actions.attack.setLoop(THREE.LoopOnce, 1);
      this.actions.attack.clampWhenFinished = true;
    }

    // If there's really only a single generic clip, we still animate on the move.
    this._singleClip = clips.length <= 1;

    this._play('idle');
    return { clipNames: clips.map((c) => c.name) };
  }

  _makeAction(clip) {
    const a = this.mixer.clipAction(clip);
    a.enabled = true;
    return a;
  }

  _play(name, fade = 0.2) {
    const next = this.actions[name] || this.actions.idle;
    if (!next || next === this.current) return;
    if (this.current) this.current.fadeOut(fade);
    next.reset().fadeIn(fade).play();
    this.current = next;
  }

  spawnAt(vec, yaw = 0) {
    this.root.position.copy(vec);
    this.facing = yaw;
    this.root.rotation.y = yaw;
  }

  attack() {
    if (this.attacking || this.attackCooldown > 0 || !this.alive) return false;
    if (this.stamina < 12) return false;
    this.stamina -= 12;
    this.attacking = true;
    this.attackTimer = 0;
    this.hasHitThisSwing = false;
    this.attackCooldown = this.attackDuration + 0.08;
    if (this.actions.attack) {
      this.actions.attack.reset();
      this.actions.attack.setEffectiveTimeScale(
        this.actions.attack.getClip().duration / this.attackDuration
      );
      this._play('attack', 0.06);
    }
    return true;
  }

  /** True only during the connecting window, once per swing (until consumed). */
  consumeAttackHit() {
    if (!this.attacking || this.hasHitThisSwing) return false;
    if (this.attackTimer >= this.hitWindow[0] && this.attackTimer <= this.hitWindow[1]) {
      this.hasHitThisSwing = true;
      return true;
    }
    return false;
  }

  /** Point in front of the player where the sword connects. */
  attackPoint(out) {
    out.set(Math.sin(this.facing), 0, Math.cos(this.facing))
      .multiplyScalar(1.6)
      .add(this.root.position);
    out.y = 1.0;
    return out;
  }

  takeDamage(amount) {
    if (!this.alive) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) {
      this.alive = false;
      this._play('idle');
    }
  }

  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  /**
   * @param dt seconds
   * @param moveDir THREE.Vector3 world-space desired direction (length 0..1)
   * @param sprint boolean
   * @param dungeon for collision
   */
  update(dt, moveDir, sprint, dungeon) {
    if (this.mixer) this.mixer.update(dt);
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    if (this.attacking) {
      this.attackTimer += dt;
      if (this.attackTimer >= this.attackDuration) {
        this.attacking = false;
        this._play(moveDir.lengthSq() > 0.01 ? 'move' : 'idle');
      }
    }

    const moving = moveDir.lengthSq() > 0.0004;
    const canSprint = sprint && this.stamina > 0 && moving;
    const speed = canSprint ? RUN_SPEED : WALK_SPEED;

    // Stamina economy
    if (canSprint) this.stamina = Math.max(0, this.stamina - 22 * dt);
    else this.stamina = Math.min(this.maxStamina, this.stamina + 16 * dt);

    if (moving && this.alive) {
      const dir = this._tmp.copy(moveDir).normalize();
      // face movement direction
      const target = Math.atan2(dir.x, dir.z);
      this.facing = lerpAngle(this.facing, target, Math.min(1, TURN_LERP * dt));

      if (!this.attacking) {
        const factor = Math.min(1, moveDir.length());
        this.root.position.x += dir.x * speed * factor * dt;
        this.root.position.z += dir.z * speed * factor * dt;
        dungeon.collide(this.root.position, this.radius);
      }
    }
    this.root.rotation.y = this.facing;

    // Animation state (when not attacking)
    if (!this.attacking && this.alive) {
      if (this._singleClip) {
        // Single generic clip: play it while moving, freeze on idle.
        if (this.current) this.current.paused = !moving;
        if (moving && !this.current) this._play('idle');
      } else {
        this._play(moving ? 'move' : 'idle');
      }
    }
  }
}

function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

function makeBlobShadow(radius) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.02;
  return mesh;
}
