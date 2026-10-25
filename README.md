# Survival Game

A 3D survival game built with Babylon.js featuring procedural terrain generation, resource harvesting, crafting, and combat.

## Features

- Procedurally generated terrain using Perlin noise
- Chunk-based terrain generation for better performance
- Day/night cycle with changing lighting
- Harvestable trees and rocks for resources
- Flying mechanics with double-jump activation
- Physics-enabled objects with realistic placement
- Safe spawn area with flat terrain and no obstacles
- Crafting system for creating tools and planks
- Animal spawning and AI movement
- Combat system with experience and leveling
- Health and experience tracking
- User interface for inventory and crafting
- Progressive Web App (PWA) support for offline play

## Setup

1. Start a local web server in the project directory
   - Python: `python -m http.server 8000`
   - Node.js: `npx serve`
2. Open `http://localhost:8000` in a modern web browser
3. Use mouse to look around and WASD keys (W=forward, A=left, S=backward, D=right) to move

## Dependencies

- Babylon.js (loaded from CDN)
- Babylon.js Loaders
- Babylon.js Procedural Textures
- Babylon.js Serializers
- Babylon.js GUI

## Controls

- Mouse: Look around
- WASD: Move player (W=forward, A=left, S=backward, D=right)
- Space: Jump (tap twice quickly to activate flying)
- While Flying:
  - Hold Space: Ascend higher
  - Hold Ctrl: Descend
  - Press Space again: Deactivate flying and fall
- Left Click: Harvest resources / Attack animals
- Right Click: Special attack (requires tools)

## Codebase Structure

The game is organized into a modular component-based architecture:

### Core Files
- `index.html`: Main HTML file with canvas and script imports
- `js/main.js`: Entry point that initializes the game
- `js/game.js`: Core game class that coordinates all systems
- `js/utils.js`: Utility functions used across the game

### Component System
Each game system is separated into its own module:

- `js/components/terrain.js`: Terrain generation and management
- `js/components/player.js`: Player movement, physics, and camera
- `js/components/inventory.js`: Resource management and crafting
- `js/components/animals.js`: Animal spawning and behavior
- `js/components/combat.js`: Combat mechanics and experience system
- `js/components/ui.js`: User interface elements

## Development

The game is built using Babylon.js, a powerful 3D engine for the web. The modular architecture makes it easy to extend with new features by adding new component systems or enhancing existing ones.

## License

MIT License

## Expedition update

The desktop interface now includes a pause screen, centered interaction reticle,
resource quick view, oxygen/health/XP meters, contextual gathering hints, and a
first-tool objective. Press **C** for field crafting and **Esc** to pause.
Click the canvas to capture the mouse; use Esc to release it. Losing focus pauses
simulation. The original optional virtual gamepad UI has been replaced by this
desktop-focused interface; a dedicated mobile control pass is still needed.

Recipes: 2 wood makes a plank; 1 plank + 2 stone makes a tool; 3 wood makes a
field dressing that immediately restores up to 30 health. Gathering and normal
attacks require a target within 5 units. Right click spends one tool on an area
attack. Night lighting, distance fog, evergreen trees, and fleeing wildlife add
atmosphere. Distant terrain now releases its associated resources and water.

Run regression tests with Node.js 22 or newer:

```sh
node --test tests/game.test.mjs
```

The world and inventory are session-only. CDN dependencies require an initial
online load; offline availability depends on successful service-worker caching.

## Wilderness models

Trees, rocks, deer, and dropped supplies are generated locally by
`js/models/wilderness.js`. The collection uses matte materials and per-face
colors, with seeded variation for trees and rocks. Pines have layered crowns,
branches and roots; broadleaf trees use branching trunks and clustered canopies.
Boulders include smaller stones and moss. Deer have a four-leg diagonal gait,
antlers, ears, eyes, and hooves. Dropped resources have item-specific silhouettes.

Open `models.html` on the same local server to orbit and inspect the collection.
The viewer uses studio lighting; the game uses its own day/night lighting and
camera-following shadow map. Static assets merge into one mesh each; deer use
five visible meshes to retain leg animation. No external model downloads are
needed. The first-person player remains invisible.

To run gameplay and real Babylon geometry tests:

```sh
npm ci --ignore-scripts
npm test
```

The pinned Babylon development dependency is test-only; the game still loads
its existing CDN engine. Tests cover geometry, deterministic variants, disposal,
canopy orientation, animation, and hits on nested deer meshes.

## Ore and foraging

Iron deposits, fiber plants, purple medicinal flowers, and red berry bushes now
populate dry terrain. A starter group appears just outside the spawn clearing.
Aim at the plant/deposit within five units and click; the reticle shows its type.
Ore requires a stone or iron tool in inventory (mining does not consume it).

- Iron deposits yield 2 ore, or 3 with an iron tool.
- Fiber plants yield 3 fiber; medicinal flowers yield 2 herbs; bushes yield 3 berries.
- 2 ore + 2 wood smelts into 1 iron ingot through field crafting.
- 2 ingots + 1 plank + 2 fiber crafts an iron tool (+8 normal attack damage).
- 2 fiber + 2 herbs restores up to 50 health; eating 2 berries restores up to 15.

Recipes are shared between the UI and inventory logic in `js/resources.js`.
Healing consumes nothing at full health. All new items drop on death and can be
recovered. Resource depletion is session/chunk-local, like the existing trees.
Open `resources.html` for an orbitable resource field guide. Run `npm test` for
gathering gates, crafting costs, healing, death drops, and asset cleanup tests.

## Responsive-world improvements

- Lower camera inertia for precise keyboard/mouse movement; hold **Shift** to sprint.
- Frame-time-clamped jumping, flight, and swimming without excessive vertical drift.
- Nearby deer visible from the start; wandering, grazing and water avoidance.
- Richer hills, deterministic resource placements, and resource depletion retained
  when crossing chunk boundaries during a session.
- Thin-instanced grass groundcover: many tufts with a single draw call per chunk.
- Share terrain/grass/water materials across chunks and cast fewer expensive shadows.
- Load the immediate 3×3 terrain chunks first and spread the outer ring over
  subsequent frames to avoid a long blocking startup.
- Drop unneeded Cannon physics and Babylon add-on downloads from the game page.
- Lower high-DPI rendering resolution on touch devices for smoother frame rates.

The game is still desktop-controlled and the world state is not saved across reloads.
No network assets or monetized systems were added by this improvement pass.
