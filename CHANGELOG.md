# Changelog

What changed in The Wilds, newest first. Each entry is one merged pull request.
There are no version numbers yet, so entries are grouped by the day they were
merged. The README has the full notes for every update.

## 2026-11-17

### Added
- **The explorer** ([#19](https://github.com/CptNope/Survival-Game/pull/19)).
  A rebuilt, jointed player model for the third-person and overhead views: a
  hooded explorer with a pack and bedroll, with real shoulders, elbows, hips
  and knees. It walks, sprints, steps backwards, sidesteps, carries an axe or
  spear, holds a torch upright and draws the bow.
- **Graphics setting** ([#18](https://github.com/CptNope/Survival-Game/pull/18)).
  Low, Medium, High and Auto in the pause menu. Auto lowers the drawing
  resolution, then shadows and ground cover, when the frame rate drops, and
  raises them again when it recovers.
- A Map button in the menu bar, and tabs to move between Craft, Build, Gear,
  Perks and Map without closing a menu first (#18).

### Changed
- **Smooth and sharp** (#18). The interface was rebuilt on one scale so it
  holds from a small phone to a 4K monitor, with separate touch layouts for
  upright and sideways phones. No text is under 12 px and every touch target
  is at least 44 px.
- Trees, rocks, ore and plants are drawn as instances of a few shared models,
  which cut materials in the starting area from 383 to 68 and the worst
  terrain-loading hitch from 55 ms to 12 ms in headless measurements (#18).
- The world draws at an eighth of the rate behind a menu (#18).
- Avatar motion is eased at a rate that does not depend on frame rate, and a
  teleport is no longer read as a sprint (#19).

## 2026-11-16

### Added
- **Companions and comforts** ([#17](https://github.com/CptNope/Survival-Game/pull/17)).
  A stray dog to tame that follows and fights beside you, storage chests,
  and tonics that grant a boon.
- **Legends and homestead** ([#16](https://github.com/CptNope/Survival-Game/pull/16)).
  A boss in each frontier region, a map, fishing, and garden beds.
- **Frontiers** ([#15](https://github.com/CptNope/Survival-Game/pull/15)).
  Three regions beyond the meadow (tundra, desert and marsh), a bow, and
  perks to choose as you level.
- **Views and dangers** ([#14](https://github.com/CptNope/Survival-Game/pull/14)).
  First-person, third-person and overhead cameras, a dodge, a quick heal,
  and deadlier dungeons: elites, slimes, mimics, spike traps, shrines and
  themes.
- **Depths and loot** ([#13](https://github.com/CptNope/Survival-Game/pull/13)).
  Procedurally generated dungeons, new enemies and a boss, and found gear
  graded from Common to Legendary by the bonuses it rolls.
- **Expedition overhaul** ([#12](https://github.com/CptNope/Survival-Game/pull/12)).
  Sound, a day and night sky, swimming, field notes that teach the game,
  sleeping, and a preview of a building before it is placed.

### Fixed
- Garden beds lost their crops when the page reloaded; beds and chests are
  now restored after the buildings they belong to (#17).
- Movement keys stayed dead after using a menu until the canvas was clicked,
  and the game now falls back gracefully when mouse capture is refused (#12).

## 2026-10-28

### Changed
- Credit Jeremy Anderson Tech in the README
  ([#11](https://github.com/CptNope/Survival-Game/pull/11)).

## 2026-10-25

### Added
- Startup checks in real desktop and mobile Chrome, run on every change
  ([#10](https://github.com/CptNope/Survival-Game/pull/10)).
- Real 192 px and 512 px install icons, and more reliable offline caching
  ([#9](https://github.com/CptNope/Survival-Game/pull/9)).
- **Touch controls** ([#8](https://github.com/CptNope/Survival-Game/pull/8)).
  A thumbstick, drag to look, action buttons, a collapsible pack and a
  safe-area aware HUD for phones.
- **Weather, modular building, wolves and cooking**
  ([#7](https://github.com/CptNope/Survival-Game/pull/7)). Rain and storms,
  floors, walls and roofs that snap together, hostile wolves at night, and
  meat to hunt and cook over a fire.
- **Hunger, shelter and saves** ([#6](https://github.com/CptNope/Survival-Game/pull/6)).
  Hunger, thirst and cold, lean-to shelters and campfires, and a versioned
  save kept in the browser.
- **Landmarks and wildlife** ([#5](https://github.com/CptNope/Survival-Game/pull/5)).
  Trails and landmarks to discover with a field compass, and rabbits.
- A regression test suite that runs in CI.

### Changed
- **Responsive controls and a livelier world**
  ([#4](https://github.com/CptNope/Survival-Game/pull/4)). Sprinting, tighter
  movement, terrain streamed over several frames to avoid hitches, grass
  drawn in one call per chunk, and deer near the start.

## 2026-10-23

### Added
- **Ore and foraging** ([#3](https://github.com/CptNope/Survival-Game/pull/3)).
  Iron deposits, fiber plants, herbs and berry bushes, iron tools, and
  healing recipes.
- **Wilderness models** ([#2](https://github.com/CptNope/Survival-Game/pull/2)).
  Trees, rocks, deer and dropped supplies generated in code, with a model
  viewer.
- **Survival expedition upgrade** ([#1](https://github.com/CptNope/Survival-Game/pull/1)).
  A pause screen, reticle, resource quick view, meters, crafting menu and
  first objectives.

## 2025-05-09

### Added
- First release: procedural terrain from Perlin noise, harvesting trees and
  rocks, crafting, animals and combat, experience and levels, a day and night
  cycle, flying by double jump, and Progressive Web App support.
