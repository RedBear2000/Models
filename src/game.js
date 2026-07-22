import * as THREE from 'three';
import { Dungeon, CELL } from './dungeon.js';
import { Player } from './player.js';
import { EnemyManager } from './enemies.js';
import { Controls } from './controls.js';
import { makeTorch, Gate, Lever, Chest, WordWall } from './props.js';

const MAX_ACTIVE_TORCHES = 6; // point-light budget for mobile GPUs

class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05060a);
    this.scene.fog = new THREE.FogExp2(0x05060a, 0.045);

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 200);
    this.camYaw = 0;
    this.camPitch = 0.32;
    this.camDist = 6.2;

    this.clock = new THREE.Clock();
    this.state = 'title';
    this.interactables = [];
    this.torches = [];
    this.running = false;

    this._moveDir = new THREE.Vector3();
    this._camTarget = new THREE.Vector3();
    this._attackPt = new THREE.Vector3();

    this._makeDamageFlash();
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  async init() {
    this.dungeon = new Dungeon();
    this.scene.add(this.dungeon.group);

    // Global soft light so nothing is pure black (kept low for barrow mood,
    // but high enough that draugr and walls read on a phone in daylight).
    this.scene.add(new THREE.HemisphereLight(0x3a405a, 0x0c0a08, 0.55));
    this.scene.add(new THREE.AmbientLight(0x262a36, 0.7));

    // Torch visuals (all of them) + a fixed pool of shared point lights.
    for (const p of this.dungeon.torches) {
      const t = makeTorch(p);
      this.scene.add(t.group);
      this.torches.push(t);
    }
    this.lightPool = [];
    for (let i = 0; i < MAX_ACTIVE_TORCHES; i++) {
      const l = new THREE.PointLight(0xffa646, 0, 17, 2);
      this.scene.add(l);
      this.lightPool.push(l);
    }

    // Player
    this.player = new Player();
    const info = await this.player.load();
    console.log('Hero animation clips:', info.clipNames);
    this.scene.add(this.player.root);
    const spawn = this.dungeon.spawn.clone();
    // Deeper into the barrow is toward smaller row index = -Z, so the hero
    // faces -Z (yaw = PI) and the camera sits behind on the +Z side (camYaw = 0).
    this.player.spawnAt(spawn, Math.PI);
    this.camYaw = 0;

    // A torch that follows the player so the hero (and nearby foes) stay lit
    this.heroLight = new THREE.PointLight(0xfff0d0, 1.7, 17, 2);
    this.scene.add(this.heroLight);

    // Enemies
    this.enemies = new EnemyManager(this.scene, this.dungeon);
    // Great hall guardians (rows 15-19, cols 4-15)
    this.enemies.spawn(6, 17, { health: 55, yaw: Math.PI });
    this.enemies.spawn(13, 17, { health: 55, yaw: Math.PI });
    this.enemies.spawn(9, 15, { health: 60, yaw: Math.PI });
    // Puzzle room lurker
    this.puzzleDraugr = this.enemies.spawn(11, 10, { health: 55, yaw: 0 });
    // Boss in the inner sanctum (rows 2-5)
    this.boss = this.enemies.spawn(9, 4, { health: 160, boss: true, damage: 20, speed: 3.0, wakeRange: 0.1, yaw: 0 });

    this._buildProps();

    // Controls
    this.controls = new Controls({
      onAttack: () => this._doAttack(),
      onInteract: () => this._doInteract(),
    });

    // Objective / progress flags
    this.flags = { hallCleared: false, gateOpen: false, bossArmed: false, bossDead: false, won: false };
    this._setObjective('Descend into the barrow and seek the Dragonstone.');
  }

  _buildProps() {
    const d = this.dungeon;

    // Sealed gate blocking the corridor up to the inner sanctum (row 6 area)
    const gA = d.cellToWorld(9, 6), gB = d.cellToWorld(10, 6);
    const gatePos = new THREE.Vector3((gA.x + gB.x) / 2, 0, gA.z);
    this.gate = new Gate(this.scene, gatePos, 9);
    this._gateCollider = { min: { x: gatePos.x - 4.2, z: gatePos.z - 1.2 }, max: { x: gatePos.x + 4.2, z: gatePos.z + 1.2 } };
    d.colliders.push(this._gateCollider);

    // Lever in the puzzle room that opens the gate
    const leverPos = d.cellToWorld(6, 9); leverPos.x += CELL / 2 - 0.5;
    this.lever = new Lever(this.scene, leverPos, () => {
      this.gate.trigger();
      const i = d.colliders.indexOf(this._gateCollider);
      if (i >= 0) d.colliders.splice(i, 1);
      this.flags.gateOpen = true;
      this._setObjective('The gate is open. Ascend to the inner sanctum.');
    });
    this.interactables.push(this.lever);

    // Treasure chest in the great hall — reward: a keener blade
    const chestPos = d.cellToWorld(5, 18);
    this.chest = new Chest(this.scene, chestPos, {
      msg: 'An honed ancient Nord sword! Your strikes bite deeper (+damage).',
      apply: () => { this.player.attackDamage = 52; this.player.heal(25); },
    });
    this.interactables.push(this.chest);

    // Word wall + Dragonstone in the inner sanctum
    const wallPos = d.cellToWorld(9, 3); wallPos.z -= 0.5;
    this.wordWall = new WordWall(this.scene, wallPos, () => {
      this.flags.won = true;
      this._win();
    });
    this.wordWall.armed = false; // locked until the Overlord falls
    this.interactables.push(this.wordWall);
  }

  start() {
    this.state = 'play';
    document.getElementById('title-screen').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('compass').style.display = 'flex';
    this.clock.start();
    if (!this.running) { this.running = true; this._loop(); }
  }

  _doAttack() {
    if (this.state !== 'play' || !this.player.alive) return;
    this.player.attack();
  }

  _doInteract() {
    if (this.state !== 'play') return;
    const target = this._nearestInteractable();
    if (!target) return;
    if (target === this.wordWall && !this.wordWall.armed) {
      this._toast('The Overlord guards the wall. Defeat it first.');
      return;
    }
    const msg = target.interact();
    if (msg) this._toast(msg);
    this._updateInteractButton();
  }

  _nearestInteractable() {
    let best = null, bestD = Infinity;
    const p = this.player.root.position;
    for (const it of this.interactables) {
      if (it.done) continue;
      const dx = it.position.x - p.x, dz = it.position.z - p.z;
      const dd = dx * dx + dz * dz;
      if (dd < it.radius * it.radius && dd < bestD) { best = it; bestD = dd; }
    }
    return best;
  }

  _doAttackResolve() {
    // Apply the player's sword hit to any draugr within reach.
    if (!this.player.consumeAttackHit()) return;
    this.player.attackPoint(this._attackPt);
    for (const d of this.enemies.list) {
      if (d.isDead) continue;
      const dx = d.group.position.x - this._attackPt.x;
      const dz = d.group.position.z - this._attackPt.z;
      if (dx * dx + dz * dz < 1.9 * 1.9) {
        const killed = d.takeDamage(this.player.attackDamage);
        if (killed && d === this.boss) this._onBossDead();
      }
    }
  }

  _onBossDead() {
    this.flags.bossDead = true;
    this.wordWall.armed = true;
    this._setObjective('The Overlord is slain. Claim the Dragonstone.');
    this._toast('The Draugr Overlord crumbles to dust.');
  }

  _updateZones() {
    const cell = this._playerCell();
    const f = this.flags;

    // Wake the great hall when the player steps inside (rows 15-19)
    if (!f.hallEntered && cell.row >= 15 && cell.row <= 19) {
      f.hallEntered = true;
      for (const d of this.enemies.list) {
        if (d !== this.boss && d.group.position.z > this.dungeon.cellToWorld(0, 12).z) d.wake();
      }
      this._setObjective('Barrow guardians rise! Clear the great hall.');
    }

    // Hall cleared?
    if (f.hallEntered && !f.hallCleared) {
      const hallAlive = this.enemies.list.filter(
        (d) => d !== this.boss && d !== this.puzzleDraugr && !d.isDead
      ).length;
      if (hallAlive === 0) {
        f.hallCleared = true;
        this._setObjective('Find the lever to open the sealed gate.');
      }
    }

    // Wake the boss when the player reaches the inner sanctum (rows 2-5)
    if (!f.bossArmed && cell.row <= 5) {
      f.bossArmed = true;
      this.boss.wake();
      this._setObjective('Defeat the Draugr Overlord!');
      this._toast('A Draugr Overlord bursts from its sarcophagus!');
    }
  }

  _playerCell() {
    const p = this.player.root.position;
    const col = Math.round(p.x / CELL + this.dungeon.cols / 2 - 0.5);
    const row = Math.round(p.z / CELL + this.dungeon.rows / 2 - 0.5);
    return { col, row };
  }

  _objectiveTarget() {
    const f = this.flags;
    if (f.won) return null;
    if (this.flags.bossDead) return this.wordWall.position;
    if (this.flags.bossArmed) return this.boss.group.position;
    if (this.flags.gateOpen) return this.dungeon.cellToWorld(9, 3);
    if (this.flags.hallCleared) return this.lever.position;
    if (this.flags.hallEntered) {
      const alive = this.enemies.list.find((d) => d !== this.boss && d !== this.puzzleDraugr && !d.isDead);
      return alive ? alive.group.position : this.lever.position;
    }
    return this.dungeon.cellToWorld(9, 17);
  }

  _updateCamera(dt) {
    const look = this.controls.consumeLook();
    this.camYaw -= look.dx * 0.005;
    this.camPitch += look.dy * 0.004;
    this.camPitch = Math.max(0.02, Math.min(0.85, this.camPitch));

    const p = this.player.root.position;
    this._camTarget.set(p.x, p.y + 1.5, p.z);

    const horiz = Math.cos(this.camPitch) * this.camDist;
    const offX = Math.sin(this.camYaw) * horiz;
    const offZ = Math.cos(this.camYaw) * horiz;
    const offY = Math.sin(this.camPitch) * this.camDist + 1.6;

    const desired = new THREE.Vector3(p.x + offX, p.y + offY, p.z + offZ);
    // keep the camera out of walls
    this.dungeon.collide(desired, 0.5);
    desired.y = Math.max(desired.y, 1.0);

    this.camera.position.lerp(desired, Math.min(1, 10 * dt));
    this.camera.lookAt(this._camTarget);
  }

  _computeMoveDir() {
    this.controls.pollKeyboard();
    const m = this.controls.move;
    // Forward = camera's view direction projected on the ground
    const F = new THREE.Vector3(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
    const R = new THREE.Vector3(-F.z, 0, F.x);
    this._moveDir.set(0, 0, 0)
      .addScaledVector(F, m.y)
      .addScaledVector(R, m.x);
    if (this._moveDir.lengthSq() > 1) this._moveDir.normalize();
    return this._moveDir;
  }

  _updateTorches(dt) {
    // Animate every flame; move the fixed light pool onto the nearest torches.
    for (const t of this.torches) t.update(dt);
    const p = this.player.root.position;
    const sorted = this.torches
      .map((t) => ({ t, d: t.group.position.distanceToSquared(p) }))
      .sort((a, b) => a.d - b.d);
    for (let i = 0; i < this.lightPool.length; i++) {
      const l = this.lightPool[i];
      const src = sorted[i];
      if (src) {
        l.position.set(src.t.group.position.x, src.t.group.position.y + 0.1, src.t.group.position.z);
        l.intensity = 2.4 * src.t.flicker;
      } else {
        l.intensity = 0;
      }
    }
  }

  _updateHUD() {
    document.getElementById('health-fill').style.width = (this.player.health / this.player.maxHealth * 100) + '%';
    document.getElementById('stamina-fill').style.width = (this.player.stamina / this.player.maxStamina * 100) + '%';

    // interact button
    this._updateInteractButton();

    // compass toward objective
    const target = this._objectiveTarget();
    const marker = document.getElementById('compass-marker');
    if (target) {
      const p = this.player.root.position;
      const ang = Math.atan2(target.x - p.x, target.z - p.z);
      const rel = ang - (this.camYaw + Math.PI);
      marker.style.transform = `rotate(${-rel + Math.PI / 2}rad)`;
      marker.style.opacity = '1';
    } else {
      marker.style.opacity = '0.2';
    }
  }

  _updateInteractButton() {
    const btn = document.getElementById('btn-interact');
    const t = this._nearestInteractable();
    if (t) {
      btn.textContent = t.prompt;
      btn.classList.remove('hidden');
    } else {
      btn.classList.add('hidden');
    }
  }

  _setObjective(text) {
    document.getElementById('objective').textContent = text;
    this._toast(text);
  }

  _toast(text) {
    const el = document.getElementById('toast');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.add('hidden'), 2800);
  }

  _makeDamageFlash() {
    this.flashEl = document.createElement('div');
    this.flashEl.id = 'damage-flash';
    document.body.appendChild(this.flashEl);
  }

  _hurtPlayer(amount) {
    if (!this.player.alive) return;
    this.player.takeDamage(amount);
    this.flashEl.style.opacity = Math.min(0.9, amount / 20);
    setTimeout(() => { this.flashEl.style.opacity = 0; }, 120);
    if (!this.player.alive) this._lose();
  }

  _win() {
    if (this.state !== 'play') return;
    this.state = 'end';
    document.getElementById('end-title').textContent = 'DRAGONSTONE CLAIMED';
    document.getElementById('end-text').textContent =
      'You escape the barrow with the map to Skyrim’s dragon burial sites. The first delve is done.';
    document.getElementById('end-screen').classList.remove('hidden');
    document.getElementById('hud').classList.add('hidden');
  }

  _lose() {
    if (this.state !== 'play') return;
    this.state = 'end';
    document.getElementById('end-title').textContent = 'YOU DIED';
    document.getElementById('end-text').textContent = 'The barrow claims another soul. The draugr return to their slumber.';
    document.getElementById('end-screen').classList.remove('hidden');
    setTimeout(() => document.getElementById('hud').classList.add('hidden'), 400);
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(0.05, this.clock.getDelta());
    if (this.state !== 'play') { this.renderer.render(this.scene, this.camera); return; }

    const moveDir = this._computeMoveDir();
    this.player.update(dt, moveDir, this.controls.sprint, this.dungeon);
    this._doAttackResolve();

    this.enemies.update(dt, this.player, (dmg) => this._hurtPlayer(dmg));

    // keep player from walking through the boss/enemies
    const pp = this.player.root.position;
    for (const d of this.enemies.list) {
      if (d.isDead || d.state === 'dead') continue;
      const dx = pp.x - d.group.position.x, dz = pp.z - d.group.position.z;
      const dd = Math.hypot(dx, dz);
      const min = this.player.radius + d.radius;
      if (dd > 0.001 && dd < min) {
        const push = (min - dd) / dd;
        pp.x += dx * push; pp.z += dz * push;
      }
    }

    this.gate.update(dt);
    this.wordWall.update(dt);
    this._updateZones();
    this._updateCamera(dt);
    this._updateTorches(dt);

    // hero fill light follows player
    this.heroLight.position.set(pp.x, 2.6, pp.z);

    this._updateHUD();
    this.renderer.render(this.scene, this.camera);
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}

// ---------- Boot ----------
const game = new Game();
window.__game = game; // exposed for debugging / automated tests
const startBtn = document.getElementById('start-btn');
const status = document.getElementById('loading-status');

game.init().then(() => {
  status.textContent = 'The barrow awaits.';
  startBtn.disabled = false;
  startBtn.addEventListener('click', () => game.start());
}).catch((err) => {
  console.error(err);
  status.textContent = 'Failed to load: ' + err.message;
});

document.getElementById('restart-btn').addEventListener('click', () => location.reload());
