import * as THREE from 'three';

const STATE = { DORMANT: 'dormant', CHASE: 'chase', ATTACK: 'attack', DEAD: 'dead' };

/**
 * A Draugr — undead barrow guardian assembled from primitives so we need
 * no extra model files. Rises from dormancy when the player draws near.
 */
export class Draugr {
  constructor(pos, opts = {}) {
    this.group = new THREE.Group();
    this.group.position.copy(pos);
    this.radius = 0.7;
    this.state = STATE.DORMANT;

    this.maxHealth = opts.health ?? 60;
    this.health = this.maxHealth;
    this.speed = opts.speed ?? 3.4;
    this.damage = opts.damage ?? 12;
    this.wakeRange = opts.wakeRange ?? 9;
    this.attackRange = 2.1;
    this.attackCooldown = 0;
    this.isBoss = opts.boss ?? false;

    this._riseT = 0;               // 0..1 rising animation
    this._attackAnim = 0;
    this._hitFlash = 0;
    this._walkPhase = Math.random() * Math.PI * 2;
    this._tmp = new THREE.Vector3();

    this._build(opts.boss);
    this.group.rotation.y = opts.yaw ?? 0;
  }

  _build(boss) {
    const scale = boss ? 1.35 : 1.0;
    const boneMat = new THREE.MeshStandardMaterial({
      color: boss ? 0x6a5a3a : 0x6e6656, roughness: 1, metalness: 0.05,
    });
    const ragMat = new THREE.MeshStandardMaterial({
      color: 0x2a2418, roughness: 1, metalness: 0,
    });
    this._eyeMat = new THREE.MeshBasicMaterial({ color: boss ? 0x7fdfff : 0x8fd0ff });
    this._boneMat = boneMat;

    const body = new THREE.Group();
    body.scale.setScalar(scale);

    // torso (tattered wrap)
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.28, 1.0, 8), ragMat);
    torso.position.y = 1.15; torso.castShadow = true;
    body.add(torso);

    // ribcage hint
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.32), boneMat);
    chest.position.y = 1.35; body.add(chest);

    // head (skull)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), boneMat);
    head.position.y = 1.92; head.scale.set(1, 1.15, 0.95); head.castShadow = true;
    body.add(head);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.22), boneMat);
    jaw.position.set(0, 1.74, 0.05); body.add(jaw);

    // glowing eyes
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), this._eyeMat);
      eye.position.set(sx * 0.09, 1.95, 0.2);
      body.add(eye);
    }

    // arms
    this._arms = [];
    for (const sx of [-1, 1]) {
      const arm = new THREE.Group();
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.55, 6), boneMat);
      upper.position.y = -0.27; arm.add(upper);
      const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.5, 6), boneMat);
      lower.position.y = -0.75; arm.add(lower);
      arm.position.set(sx * 0.42, 1.55, 0);
      arm.rotation.z = sx * 0.15;
      body.add(arm);
      this._arms.push({ grp: arm, side: sx });
    }

    // ancient sword in right hand
    const sword = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x8a8577, roughness: 0.6, metalness: 0.4 }));
    blade.position.y = 0.45; sword.add(blade);
    const hilt = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.05), boneMat);
    sword.add(hilt);
    sword.position.set(0, -1.0, 0.05);
    this._arms[1].grp.add(sword);
    this._sword = sword;

    // legs
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.9, 6), boneMat);
      leg.position.set(sx * 0.15, 0.5, 0); body.add(leg);
    }

    // blob shadow
    body.add(makeBlobShadow(0.8 * scale));

    this._body = body;
    this.group.add(body);

    // Start crumpled / dormant (bowed forward, sunk down)
    this._applyRise(0);
  }

  _applyRise(t) {
    // t: 0 = dormant slump, 1 = fully risen
    this._body.position.y = -1.4 * (1 - t);
    this._body.rotation.x = (1 - t) * 0.9;
  }

  wake() {
    if (this.state === STATE.DORMANT) this.state = STATE.CHASE;
  }

  takeDamage(amount) {
    if (this.state === STATE.DEAD) return false;
    this.wake();
    this.health -= amount;
    this._hitFlash = 0.12;
    if (this.health <= 0) {
      this.state = STATE.DEAD;
      this._deathT = 0;
      return true; // killed
    }
    return false;
  }

  get isDead() { return this.state === STATE.DEAD && this._deathT >= 1; }

  update(dt, playerPos, onHitPlayer) {
    this._eyeMat.emissiveIntensity = 1;

    // hit flash
    if (this._hitFlash > 0) {
      this._hitFlash -= dt;
      this._boneMat.emissive = new THREE.Color(0x883322);
      this._boneMat.emissiveIntensity = this._hitFlash * 6;
    } else {
      this._boneMat.emissiveIntensity = 0;
    }

    if (this.state === STATE.DEAD) {
      this._deathT = Math.min(1, (this._deathT ?? 0) + dt * 1.6);
      // collapse
      this._body.rotation.x = this._deathT * 1.6;
      this._body.position.y = -this._deathT * 1.0;
      this._body.traverse((o) => {
        if (o.material && o.material.transparent !== undefined && o.material.opacity !== undefined) {
          o.material.transparent = true;
          o.material.opacity = 1 - this._deathT;
        }
      });
      return;
    }

    const toPlayer = this._tmp.copy(playerPos).sub(this.group.position);
    toPlayer.y = 0;
    const dist = toPlayer.length();

    if (this.state === STATE.DORMANT) {
      if (dist < this.wakeRange) this.wake();
      return;
    }

    // Rise up when waking
    if (this._riseT < 1) {
      this._riseT = Math.min(1, this._riseT + dt * 1.6);
      this._applyRise(this._riseT);
      if (this._riseT < 0.6) return; // still emerging
    }

    // face player
    if (dist > 0.001) {
      const targetYaw = Math.atan2(toPlayer.x, toPlayer.z);
      this.group.rotation.y = lerpAngle(this.group.rotation.y, targetYaw, Math.min(1, 8 * dt));
    }

    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    if (dist > this.attackRange) {
      // chase
      this.state = STATE.CHASE;
      toPlayer.normalize();
      this.group.position.x += toPlayer.x * this.speed * dt;
      this.group.position.z += toPlayer.z * this.speed * dt;
      // shambling walk bob
      this._walkPhase += dt * 6;
      this._body.position.y = Math.abs(Math.sin(this._walkPhase)) * 0.06;
      this._arms[0].grp.rotation.x = Math.sin(this._walkPhase) * 0.5;
      this._arms[1].grp.rotation.x = -Math.sin(this._walkPhase) * 0.3;
    } else {
      // in range -> attack
      if (this.attackCooldown <= 0) {
        this.state = STATE.ATTACK;
        this._attackAnim = 0.5;
        this.attackCooldown = this.isBoss ? 1.1 : 1.5;
        this._pendingHit = 0.25; // land damage mid-swing
      }
    }

    // attack swing animation + damage application
    if (this._attackAnim > 0) {
      this._attackAnim -= dt;
      const swing = Math.sin((0.5 - this._attackAnim) / 0.5 * Math.PI);
      this._arms[1].grp.rotation.x = -1.4 * swing;
      if (this._pendingHit !== null && this._pendingHit !== undefined) {
        this._pendingHit -= dt;
        if (this._pendingHit <= 0) {
          this._pendingHit = null;
          if (dist <= this.attackRange + 0.4) onHitPlayer(this.damage);
        }
      }
    }

    return dist;
  }
}

/** Manages a set of draugr + collision + combat resolution. */
export class EnemyManager {
  constructor(scene, dungeon) {
    this.scene = scene;
    this.dungeon = dungeon;
    this.list = [];
  }

  spawn(cellX, cellRow, opts) {
    const p = this.dungeon.cellToWorld(cellX, cellRow);
    const d = new Draugr(p, opts);
    this.list.push(d);
    this.scene.add(d.group);
    return d;
  }

  aliveCount(filter) {
    return this.list.filter((d) => !d.isDead && (!filter || filter(d))).length;
  }

  update(dt, player, onPlayerHit) {
    for (const d of this.list) {
      if (d.isDead) continue;
      d.update(dt, player.root.position, onPlayerHit);
      // separate enemy from walls & from player overlap
      if (d.state !== STATE.DEAD) {
        this.dungeon.collide(d.group.position, d.radius);
      }
    }
    // resolve enemy-vs-enemy crowding lightly
    for (let i = 0; i < this.list.length; i++) {
      for (let j = i + 1; j < this.list.length; j++) {
        const a = this.list[i], b = this.list[j];
        if (a.isDead || b.isDead || a.state === STATE.DEAD || b.state === STATE.DEAD) continue;
        const dx = b.group.position.x - a.group.position.x;
        const dz = b.group.position.z - a.group.position.z;
        const dd = Math.hypot(dx, dz);
        const min = a.radius + b.radius;
        if (dd > 0.001 && dd < min) {
          const push = (min - dd) / dd / 2;
          a.group.position.x -= dx * push; a.group.position.z -= dz * push;
          b.group.position.x += dx * push; b.group.position.z += dz * push;
        }
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
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.5)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.03;
  return mesh;
}
