# Barrowdelve — The First Dungeon

A mobile-first, Skyrim-inspired 3D dungeon crawler that runs in any modern
browser. Play the opening delve of a Nordic barrow (in the spirit of *Bleak
Falls Barrow*): descend past torch-lit stone corridors, wake and fight the
undead **draugr**, open a sealed gate, slay the **Draugr Overlord**, and claim
the **Dragonstone**.

The hero is the `hero.glb` model that shipped in this repo — a hoplite with a
xiphos and dory, animated with its own idle / run / walk / slash clips.

## Play it

Because the game loads a `.glb` model and ES modules, it must be served over
HTTP (opening `index.html` directly from `file://` won't work). Any static
server does the job:

```bash
# from the repo root
npx http-server -p 8080 -c-1
#   …then open http://localhost:8080 on your phone or desktop
```

Or push to a static host — it works on **GitHub Pages** with zero config
(Settings → Pages → deploy from branch → root). Everything is self-contained:
Three.js r160 is vendored in `vendor/`, so there is no CDN or network
dependency and the game runs fully offline.

> Tip: play in **landscape**. On a phone, add the page to your home screen for
> a full-screen, app-like experience.

## Controls

| Action | Touch | Keyboard/Mouse |
| --- | --- | --- |
| Move | Left virtual joystick | `W A S D` / arrows |
| Look / rotate camera | Drag on the screen | Drag mouse |
| Attack (sword swing) | ⚔ button | `Space` |
| Sprint (hold) | **Run** button | hold `Shift` |
| Loot / pull / interact | context button (appears when near) | `E` / `F` |

## The delve

1. **Descend** the entry corridor into the great hall.
2. **Clear the great hall** — barrow guardians rise to meet you. Loot the chest
   for a keener blade.
3. **Find the lever** in the side chamber to raise the sealed gate.
4. **Ascend** to the inner sanctum and **defeat the Draugr Overlord**.
5. **Claim the Dragonstone** at the word wall to win.

Watch your **Health** (red) and **Stamina** (green). Sprinting and swinging
drain stamina; it regenerates when you ease off. The compass at the top points
toward your current objective.

## Project layout

```
index.html            Entry point + import map + HUD markup
css/style.css         HUD, menus, and mobile touch styling
assets/models/hero.glb  The playable hero model (was the repo's original upload)
vendor/               Vendored Three.js r160 (module + GLTFLoader + utils)
src/
  game.js             Orchestrator: scene, camera, lighting, loop, objectives
  dungeon.js          ASCII-tile barrow: geometry, collision, procedural stone
  player.js           Hero: GLB loading, animation, movement, combat, stats
  enemies.js          Draugr AI + the enemy manager
  props.js            Torches, gate, lever, chest, word wall + Dragonstone
  controls.js         Touch (joystick + drag-look + buttons) and keyboard input
```

## Tech notes

- **Rendering:** Three.js (WebGL). No real-time shadow maps — the barrow uses a
  pool of flickering torch point-lights plus fake blob shadows to stay smooth on
  mobile GPUs. The light pool is a *fixed* size that hops to the nearest torches
  each frame, avoiding the material recompiles that toggling lights would cause.
- **No external assets:** floor/wall/ceiling textures are generated procedurally
  on a `<canvas>`, and enemies/props are built from primitives, so the only
  binary asset is the hero model.
- **Collision** is circle-vs-AABB against solid tiles, resolved per frame for the
  player and every draugr.
