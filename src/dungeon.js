import * as THREE from 'three';

/**
 * Bleak-Falls-style barrow built from an ASCII tile grid.
 *  '#' = solid rock / void      '.' = walkable floor
 *  'E' = entrance (player spawn)
 * Rows are +Z (south), columns are +X (east).
 */
const MAP = [
  '####################', // 0
  '####################', // 1
  '#######......#######', // 2  final chamber (word wall)
  '#######......#######', // 3
  '#######......#######', // 4
  '#######......#######', // 5
  '#########..#########', // 6  corridor
  '#########..#########', // 7
  '######........######', // 8  puzzle / lever room
  '######........######', // 9
  '######........######', // 10
  '######........######', // 11
  '#########..#########', // 12 gate corridor
  '#########..#########', // 13
  '#########..#########', // 14
  '####............####', // 15 great hall (draugr fight)
  '####............####', // 16
  '####............####', // 17
  '####............####', // 18
  '####............####', // 19
  '#########..#########', // 20 entry corridor
  '#########..#########', // 21
  '#########..#########', // 22
  '#########EE#########', // 23 entrance
  '####################', // 24
];

export const CELL = 4.5;       // world units per tile
export const WALL_H = 6.0;     // wall height

export class Dungeon {
  constructor() {
    this.rows = MAP.length;
    this.cols = MAP[0].length;
    this.colliders = [];   // {min:{x,z}, max:{x,z}} AABBs for solid cells
    this.torches = [];     // {x,y,z} torch positions
    this.group = new THREE.Group();
    this.spawn = new THREE.Vector3(0, 0, 0);
    this._build();
  }

  isFloor(col, row) {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return false;
    return MAP[row][col] !== '#';
  }

  cellToWorld(col, row) {
    return new THREE.Vector3(
      (col - this.cols / 2 + 0.5) * CELL,
      0,
      (row - this.rows / 2 + 0.5) * CELL
    );
  }

  _build() {
    const floorTex = makeStoneTexture('#3a352b', '#26221b', 8);
    floorTex.repeat.set(1, 1);
    const ceilTex = makeStoneTexture('#1a1712', '#100e0a', 6);
    const wallTex = makeStoneTexture('#4a4437', '#2c281f', 10);

    const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95, metalness: 0.02 });
    const ceilMat = new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 1.0, metalness: 0.0 });
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.92, metalness: 0.03 });

    const floorGeoCache = new THREE.PlaneGeometry(CELL, CELL);

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const c = MAP[row][col];
        const center = this.cellToWorld(col, row);

        if (c === '#') {
          // Solid block collider (only add if it borders a floor, to save geometry)
          if (this._bordersFloor(col, row)) {
            this.colliders.push({
              min: { x: center.x - CELL / 2, z: center.z - CELL / 2 },
              max: { x: center.x + CELL / 2, z: center.z + CELL / 2 },
            });
          }
          continue;
        }

        // Floor
        const floor = new THREE.Mesh(floorGeoCache, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(center.x, 0, center.z);
        floor.receiveShadow = true;
        this.group.add(floor);

        // Ceiling
        const ceil = new THREE.Mesh(floorGeoCache, ceilMat);
        ceil.rotation.x = Math.PI / 2;
        ceil.position.set(center.x, WALL_H, center.z);
        this.group.add(ceil);

        if (c === 'E') this.spawn.copy(center);

        // Walls: build a wall on each side that faces a solid cell
        this._maybeWall(col, row, center, 1, 0, wallMat);   // east
        this._maybeWall(col, row, center, -1, 0, wallMat);  // west
        this._maybeWall(col, row, center, 0, 1, wallMat);   // south
        this._maybeWall(col, row, center, 0, -1, wallMat);  // north
      }
    }

    this._placeTorches();
  }

  _bordersFloor(col, row) {
    return (
      this.isFloor(col + 1, row) || this.isFloor(col - 1, row) ||
      this.isFloor(col, row + 1) || this.isFloor(col, row - 1) ||
      this.isFloor(col + 1, row + 1) || this.isFloor(col - 1, row - 1) ||
      this.isFloor(col + 1, row - 1) || this.isFloor(col - 1, row + 1)
    );
  }

  _maybeWall(col, row, center, dx, dz, mat) {
    if (this.isFloor(col + dx, row + dz)) return; // open, no wall
    const geo = new THREE.PlaneGeometry(CELL, WALL_H);
    const wall = new THREE.Mesh(geo, mat);
    wall.position.set(
      center.x + dx * CELL / 2,
      WALL_H / 2,
      center.z + dz * CELL / 2
    );
    // Face inward toward the floor cell
    if (dx === 1) wall.rotation.y = -Math.PI / 2;
    else if (dx === -1) wall.rotation.y = Math.PI / 2;
    else if (dz === 1) wall.rotation.y = Math.PI;
    else wall.rotation.y = 0;
    wall.receiveShadow = true;
    this.group.add(wall);
  }

  _placeTorches() {
    // Hand-picked torch spots (col,row) along walls for atmosphere + light.
    const spots = [
      [8, 22], [11, 22],        // entry corridor
      [4, 16], [15, 16], [4, 19], [15, 19], // great hall
      [6, 9], [13, 9],          // puzzle room
      [9, 6], [10, 7],          // corridor
      [7, 3], [12, 3], [8, 5], [11, 5], // final chamber
    ];
    for (const [col, row] of spots) {
      const p = this.cellToWorld(col, row);
      // push torch toward nearest wall
      const off = this._wallOffset(col, row);
      this.torches.push(new THREE.Vector3(p.x + off.x, 3.4, p.z + off.z));
    }
  }

  _wallOffset(col, row) {
    if (!this.isFloor(col - 1, row)) return { x: -CELL / 2 + 0.3, z: 0 };
    if (!this.isFloor(col + 1, row)) return { x: CELL / 2 - 0.3, z: 0 };
    if (!this.isFloor(col, row - 1)) return { x: 0, z: -CELL / 2 + 0.3 };
    if (!this.isFloor(col, row + 1)) return { x: 0, z: CELL / 2 - 0.3 };
    return { x: 0, z: 0 };
  }

  /** Resolve a circle (player/enemy) out of wall colliders. Mutates pos. */
  collide(pos, radius) {
    for (const b of this.colliders) {
      const cx = Math.max(b.min.x, Math.min(pos.x, b.max.x));
      const cz = Math.max(b.min.z, Math.min(pos.z, b.max.z));
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        const d = Math.sqrt(d2) || 0.0001;
        // If center is inside the box (d==0), push along smallest axis
        if (d2 < 1e-6) {
          const toLeft = Math.abs(pos.x - b.min.x);
          const toRight = Math.abs(b.max.x - pos.x);
          const toTop = Math.abs(pos.z - b.min.z);
          const toBot = Math.abs(b.max.z - pos.z);
          const m = Math.min(toLeft, toRight, toTop, toBot);
          if (m === toLeft) pos.x = b.min.x - radius;
          else if (m === toRight) pos.x = b.max.x + radius;
          else if (m === toTop) pos.z = b.min.z - radius;
          else pos.z = b.max.z + radius;
        } else {
          const push = (radius - d) / d;
          pos.x += dx * push;
          pos.z += dz * push;
        }
      }
    }
  }
}

/** Procedural mottled-stone canvas texture so we need no external image files. */
function makeStoneTexture(base, dark, blocks) {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // brick-ish blocks
  const bs = size / blocks;
  for (let y = 0; y < blocks; y++) {
    for (let x = 0; x < blocks; x++) {
      const off = (y % 2) * (bs / 2);
      const px = (x * bs + off) % size;
      const py = y * bs;
      const shade = Math.random() * 0.22 - 0.11;
      ctx.fillStyle = shadeColor(base, shade);
      ctx.fillRect(px + 1, py + 1, bs - 2, bs - 2);
    }
  }
  // grit / noise
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.04)';
    ctx.fillRect(x, y, 1.5, 1.5);
  }
  // mortar lines
  ctx.strokeStyle = shadeColor(dark, -0.1);
  ctx.lineWidth = 2;
  for (let y = 0; y <= blocks; y++) {
    ctx.beginPath(); ctx.moveTo(0, y * bs); ctx.lineTo(size, y * bs); ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function shadeColor(hex, amt) {
  const c = hex.replace('#', '');
  let r = parseInt(c.substring(0, 2), 16);
  let g = parseInt(c.substring(2, 4), 16);
  let b = parseInt(c.substring(4, 6), 16);
  r = Math.max(0, Math.min(255, r + amt * 255));
  g = Math.max(0, Math.min(255, g + amt * 255));
  b = Math.max(0, Math.min(255, b + amt * 255));
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
