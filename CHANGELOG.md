# Changelog

What changed in The Wilds, newest first. Each version is a group of merged pull
requests, dated the day the last of them was merged, and matches a post in the
[devlog on itch.io](https://cptnope.itch.io/survival-game-web-demo/devlog).
The README has the full notes for every update.

## v0.7.0 (2026-11-19)

### Added
- **More places** ([#25](https://github.com/CptNope/Survival-Game/pull/25)),
  on a second layer so that nothing from 0.6.0 moved:
  - Traders, with three swaps and a piece of gear on a board that changes
    every morning.
  - Shrines to the boar, the tortoise and the hare, each lending a boon for
    four minutes once a day.
  - Cairns, whose notes lead to a buried cache marked on the map.
  - Wrecks on the lake beds, with a chest to dive for.
- Map marks for each, and caches, wrecks and trades on the expedition summary.

## v0.6.0 (2026-11-19)

### Added
- **Points of interest** ([#24](https://github.com/CptNope/Survival-Game/pull/24)).
  Places out in the country that do something when you reach them, in about
  three of every four 160 m squares:
  - Watchtowers, which put nearby landmarks, ways underground and other places
    on your map.
  - Waystones, which you wake and then travel between. One stands by the
    clearing as the way home.
  - Dens, defended by three of the region's hunters, with gear and a hoard for
    clearing one. They refill after four days.
  - Havens, one kind per region and usable once a day: an old orchard, a hot
    spring, an oasis and a stilt hut.
- Map marks for each kind of place, and hollow marks for anything seen from a
  watchtower but not yet reached.
- Places found and dens cleared on the expedition summary.

## v0.5.1 (2026-11-18)

### Added
- This changelog, and donation and help links in the README and `SUPPORT.md`
  ([#20](https://github.com/CptNope/Survival-Game/pull/20)).

### Changed
- The page title, the installed app and the link preview now say The Wilds (#20).

### Fixed
- **One walking pace** ([#21](https://github.com/CptNope/Survival-Game/pull/21)).
  Keyboard walking was about four times slower than
  intended and the touch stick about four times faster. Both now move at the
  same speed, set in units a second: walk 6, sprint 9.5. Each frame's step is
  limited to what the collision check can follow, so slow frames cost a little
  pace instead of sticking the player to the ground.

## v0.5.0 (2026-11-17)

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

## v0.4.0 (2026-11-16)

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

### Fixed
- Garden beds lost their crops when the page reloaded; beds and chests are
  now restored after the buildings they belong to (#17).

## v0.3.0 (2026-11-16)

### Added
- **Depths and loot** ([#13](https://github.com/CptNope/Survival-Game/pull/13)).
  Procedurally generated dungeons, new enemies and a boss, and found gear
  graded from Common to Legendary by the bonuses it rolls.
- **Expedition overhaul** ([#12](https://github.com/CptNope/Survival-Game/pull/12)).
  Sound, a day and night sky, swimming, field notes that teach the game,
  sleeping, and a preview of a building before it is placed.

### Fixed
- Movement keys stayed dead after using a menu until the canvas was clicked,
  and the game now falls back gracefully when mouse capture is refused (#12).

## v0.2.0 (2026-10-28)

The first pass after the prototype: pull requests 1 to 11, merged between 23
and 28 October 2026.

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
- **Ore and foraging** ([#3](https://github.com/CptNope/Survival-Game/pull/3)).
  Iron deposits, fiber plants, herbs and berry bushes, iron tools, and
  healing recipes.
- **Wilderness models** ([#2](https://github.com/CptNope/Survival-Game/pull/2)).
  Trees, rocks, deer and dropped supplies generated in code, with a model
  viewer.
- **Survival expedition upgrade** ([#1](https://github.com/CptNope/Survival-Game/pull/1)).
  A pause screen, reticle, resource quick view, meters, crafting menu and
  first objectives.

### Changed
- **Responsive controls and a livelier world**
  ([#4](https://github.com/CptNope/Survival-Game/pull/4)). Sprinting, tighter
  movement, terrain streamed over several frames to avoid hitches, grass
  drawn in one call per chunk, and deer near the start.
- Credit Jeremy Anderson Tech in the README
  ([#11](https://github.com/CptNope/Survival-Game/pull/11)).

## v0.1.0 (2025-05-09)

### Added
- First release: procedural terrain from Perlin noise, harvesting trees and
  rocks, crafting, animals and combat, experience and levels, a day and night
  cycle, flying by double jump, and Progressive Web App support.
