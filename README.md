# Survival Game

> **Play the live game:** https://cptnope.github.io/Survival-Game/ — the GitHub Pages project path is case-sensitive. The lowercase `/survival-game/` URL is not the deployed project path.


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
- Procedural sound, a day/night sky with weather, swimmable lakes, field-note
  goals, sleeping, and a build preview (see *Expedition overhaul* below)
- Procedurally generated dungeons, new enemies and a boss, and found gear with
  rolled bonuses graded Common to Legendary (see *Depths and loot* below)

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
- WASD: Move player (W=forward, A=left, S=backward, D=right), Shift to sprint
- Space: Jump (tap twice quickly to activate flying)
- While Flying:
  - Hold Space: Ascend higher
  - Hold Ctrl: Descend
  - Press Space again: Deactivate flying and fall
- In deep water: you float at the surface; hold Ctrl to dive, Space to rise
- Left Click (hold): Gather resources / Attack animals / Confirm a build
- Right Click: Heavy sweep (uses a stone tool) / Cancel a build
- C: Craft · B: Build · R or mouse wheel: Rotate the build preview
- E: Drink at a lake or from the waterskin; rest in a shelter at night
- G: Gear (equip, compare and break down found equipment)
- E at a stone doorway, stairs or chest: descend, climb out, open
- V: Switch between first-person, third-person and overhead views · Mouse
  wheel: zoom the two outside views
- Q: Dodge (a short dash that blows miss) · H: Quick heal
- F: Torch · M: Mute · P: Save · Esc: Pause

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

## Discoverable wilderness

Walk the dirt trails leading out of the spawn clearing to three persistent
landmarks: Ember Camp (east), Old Watch Post (northwest), and Trapper Shelter
(south). More trail camps, ruins, shelters, and standing stones are seeded
deterministically as you travel farther. A field compass gives the name,
distance, and cardinal direction of the nearest undiscovered location.

Coming within 8 world units discovers the site and recovers a small cache of
materials for crafting. Rewards are granted **once per location per session**
and the on-screen counter records progress. Landmarks render as a single
merged, vertex-colored low-poly model each and are released with their chunk.
Paths are tinted directly in the existing terrain vertices (zero extra
trail draw calls); trees, rocks, and tall grass avoid paths and site clearings.

Survival progression remains offline-first after initial asset caching.
World/expedition discoveries still reset upon reloading the game.

## Wildlife

Deer now share the woods with smaller rabbits. Rabbits hop and flee faster,
take fewer hits to hunt, and provide a little crafting fiber plus experience.
Both wildlife types are spawned near the player and outside water. Animal
counts remain capped and distant creatures are released to protect frame rate.

## Camp building, survival needs & saved expeditions

A new survival loop adds three environmental meters:

- **Hunger** falls slowly as you explore. Use the existing *Eat berries*
  recipe in the crafting menu to restore hunger, even when health is full.
- **Thirst** falls faster during sprinting. At the edge of lakes, press
  **E** to drink and replenish it. Look for the shoreline prompt.
- **Cold** builds at night when exposed outdoors. A nearby lean-to or
  campfire protects the player and allows the cold meter to recover.
  Starvation, dehydration, and severe exposure eventually damage health.

**B** opens the build menu. Face clear, dry, relatively flat terrain in
front of the character and choose a structure. Construction instantly
uses the required inventory items, and rejected placement consumes nothing.

| Structure | Materials | Benefit |
| --- | --- | --- |
| Lean-to shelter | 6 wood, 2 planks, 3 fiber | Nighttime protection within 8 units |
| Campfire | 3 wood, 3 stone | Warmth within 5 units |

The player can have up to 64 built structures per save. Each uses locally
generated, low-poly geometry merged into one mesh; distant structures are
unloaded and reconstructed when the player returns.

**Local saves:** Progress automatically saves about every 30 seconds of
active play, and on page exit, gathering, crafting, building, and
discovering a landmark. Press **P** or use **Save expedition** in the
pause menu for a manual save. A versioned save restores player location
and facing, health, XP, crafting materials, hunger, thirst, cold,
discovered locations, depleted resource nodes, placed structures,
remaining dropped loot, and the day/night clock. Dying respawns at the
original clearing, resets needs, and saves the updated state. Saved
structures remain on the map.

Local storage stays **on this browser and this device**—there is no account
or cloud sync. Clearing site data erases the expedition; an ordinary page
reload keeps it. Offline play still requires caching external Babylon
assets on an earlier online visit.

**Developer checks:** Run `npm ci --ignore-scripts && npm test` before
merging. The added `tests/survival.test.mjs` exercises starvation,
warming, drinking, ingredient costs, construction boundaries and
persistent save/restore.

## Weather, modular construction, cooking and threats

- **Clear, rainy and stormy conditions** cycle with the in-game clock.
  A CSS-only rain overlay keeps draw-call and download overhead low, and
  reduced-motion users get a static weather indicator. Rain and especially
  storms increase cold exposure while outside; fire, lean-tos and roofs warm
  players back up.
- **Modular building** expands the B panel with 4-unit grid **floors**
  (2 planks), **walls** (4 wood) and **roofs** (3 planks, 2 fiber).
  Matching pieces can occupy the same grid location (no duplicate of the same
  kind), allowing connected multi-part construction. A roof protects against
  exposure within 3 world units. Larger structures remain saved locally.
- **Nighttime wolves** spawn in small, capped numbers. They approach and
  damage nearby players at controlled intervals. Wolves take more hits and
  reward extra experience. Deer, rabbits and wolves all yield raw meat when
  hunted; animals are cleaned up outside the streaming radius.
- **Campfire cooking**: hunt for raw meat, build a fire, stand within
  6 units of it, then use **Roast meat at campfire** (1 raw meat yields
  1 cooked meat). Eating cooked meat restores 50 hunger and up to 10 health.
  Cooking cannot be performed away from a placed campfire. Meat is carried
  in the ordinary inventory and saved with the expedition.

The weather cycle uses existing saved day/time so it restores
deterministically without new save migration.

## Phase 5 — Mobile and PWA touch controls

Phones and tablets with a coarse pointer now get a dedicated control surface
while the existing mouse/keyboard game remains unchanged:

- **Left thumbstick:** analog move/strafe relative to camera direction.
  Diagonal input is clamped to avoid increased movement speed.
- **Drag the open world:** turn/tilt the camera. Look is pitch-clamped
  and ignores non-touch pointer events; Babylon's duplicate native touch
  camera input is disabled.
- **HIT:** gather the targeted resource or attack a creature in range.
- **JUMP:** jump; double-tap while airborne to fly, hold to rise in flight.
- **RUN:** hold to sprint, **DOWN:** hold to descend when flying.
- **DRINK:** drink at the shoreline, **SKILL:** existing heavy area attack.
- **Craft**, **Build**, **Pack**, and **Pause** are reachable by touch.
  Pack expands/collapses the inventory without pausing the game.

The phone HUD uses compact vital bars, safe-area-aware joystick and action
placement, and a collapsible inventory to keep most of the 3D world visible.
Landscape layouts show smaller controls. The initial paused-game screen
explains touch gestures instead of desktop keyboard shortcuts.

Touch pointers are cancelled when paused; keyboard and mouse controls still
work on desktop and hybrid devices. There are **no added runtime
dependencies or external control assets**. Regression tests cover normalized
stick motion, camera-look limits, framerate compensation, pause resets, and
dead-player input gating; use `npm test`.

**Note:** GitHub Actions validates gameplay/unit tests, but physical Android
and iOS browser playtests remain valuable for multitouch behavior, frame
rate, PWA installation and orientation changes.

## Installability and offline reliability

The old 1-byte icon placeholders have been replaced with valid 192px and
512px PNG app icons, referenced by `manifest.json`. A new deterministic
128px locally generated grass texture replaces the Babylon asset-CDN
download, so terrain rendering no longer needs a second host.

The service worker now pre-caches the complete set of local game scripts
and the real icons, activates new versions promptly, and attempts to cache
the Babylon engine separately. An unreachable engine CDN does not prevent
the local app-shell update. The engine must still be successfully loaded
online at least once to become available offline; an offline-first install
without previously caching the engine is not supported.

Install-time and offline-asset regression tests verify icon PNG signatures
and dimensions, game module precaching, and the absence of remote terrain
texture dependencies. Run the full suite with `npm test`.

On phones, after a new deploy, refresh/relaunch once while online before
going offline. Existing installed copies should update their cached shell
when their service worker activates.

## Expedition overhaul: feel, world and progression

This pass gives the existing systems weight, atmosphere and a reason to keep
going. It adds **no downloads**: sound, sky, particles and new models are all
generated in the browser, so the game stays offline-first.

### Feel

- **Sound.** Every effect is synthesised with the Web Audio API
  (`js/components/audio.js`): chopping, mining, picking, crafting, building,
  hits, hurt, footsteps, splashes, wolves, thunder, and ambience beds for wind,
  rain, night insects, birdsong and a crackling fire. Audio starts on the first
  click, mutes with **M**, and has a volume slider in the pause menu.
- **Gathering takes swings.** Trees and rocks take 3 swings by hand, 2 with a
  stone tool and 1 with an iron tool; ore takes 3 with stone and 2 with iron.
  Hold the button to keep swinging. Struck nodes shake and throw debris, trees
  topple, and pips under the reticle show progress. Thin plants no longer need
  a pixel-perfect aim.
- **Hits read.** Damage numbers, a recoil and stagger on struck animals, a red
  vignette and screen shake when you are hurt, a low-health pulse, and a death
  screen that names what killed you. Struck prey bolts wherever you stand.
- **A tool in hand.** The axe or spear you carry is drawn in view and swings
  with each action.

### World

- **Sky.** One procedural dome (a single draw call) with a sun, moon, stars,
  drifting clouds, warm dawns and dusks, and overcast rain and storm skies with
  lightning. Moonlight keeps nights readable.
- **Lakes you swim in.** Shores now slope from a sandy beach into deep water.
  You wade the shallows, float in the deep, and can dive (which is what the
  oxygen meter is for). Dry land never dips below the water table, which also
  removes the square water patches at chunk edges.
- **Terrain colour.** Meadow, sand, rocky high ground and lake bed are tinted
  per vertex; highlands add relief to the hills.
- **Fire and torchlight.** Campfires have flames and a flickering light. A
  craftable **torch** (F) lights your way and slows the cold.

### Progression

- **Field notes.** Ten ordered goals, each paying experience: first tool,
  campfire, hot meal, shelter, first dawn, three landmarks, iron tool, a wolf,
  a cabin, five days. The pause menu keeps an expedition log.
- **New gear.** *Spear* (2 wood, 1 stone, 1 fiber): +12 damage and longer
  reach. *Torch* (1 wood, 1 fiber). *Waterskin* (4 fiber): fill it at any lake
  and carry three drinks inland.
- **Sleep.** Press **E** in a lean-to or under a roof at night to rest until
  dawn. You wake healed, warm, hungry and thirsty. Wolves nearby keep you up.
- **Regrowth.** Plants return after 2 days, trees after 3, rocks after 4 and
  ore after 5, so a settled camp stays supplied.
- **Building preview.** Choosing a structure shows a translucent preview that
  follows your aim, turns red where it cannot stand and says why. Rotate with
  **R** or the mouse wheel, click to place, Esc or right click to cancel.
  Floors, walls and roofs keep placing while materials last.

### Fixes

- New expeditions open on a clear morning instead of always starting in rain.
- The heavy sweep no longer breaks a tool when nothing is in reach.
- Trees streaming in during the first seconds could be gathered from the spawn
  point; new meshes now settle their position immediately.
- Dropped supplies land on the ground instead of hanging at eye height.
- Esc now pauses reliably while the mouse is captured.
- W A S D work straight after closing a menu; before, the keyboard stayed
  dead until the canvas was clicked.
- Where a browser refuses to capture the mouse, clicks still gather and
  attack instead of being swallowed.
- The crafting panel opens at the top of the list and explains unavailable recipes.
- The pack shows only what you carry; the HUD refreshes ten times a second
  instead of every frame.

### Notes for developers

- New modules: `sky.js`, `audio.js`, `effects.js`, `progression.js` (in
  `js/components/`) and `js/settings.js`. All are precached by `sw.js`.
- `effects` and `audio` are cosmetic and called through optional chaining, so
  gameplay systems run unchanged in tests without them.
- Saves stay at version 1. New fields (`water`, `progression`,
  `harvestedDays`) are optional, so existing expeditions load; structures are
  re-seated on the reshaped ground. Volume, mute and look speed are stored
  separately and survive **Start a new expedition** in the pause menu.
- `tests/expedition.test.mjs` covers tool tiers, swing cooldown, aim assist,
  gear, combat, waterskin, sleep, field notes, lake shape, swimming, regrowth,
  save compatibility, the build preview, sky state, settings and audio.
- Not verified here: how the synthesised audio actually sounds, and frame rate
  on real phones. Both need a listen and a playtest on hardware.

## Depths and loot: dungeons, enemies and graded gear

### Dungeons

- **Entrances in the world.** Stone doorways are scattered through the hills,
  placed deterministically like the landmarks. The first, the **Old Barrow**,
  is a short walk south-west of the clearing, and the compass card points to
  the nearest one. Press **E** at a doorway to descend.
- **Procedurally generated floors.** Each dungeon has three floors built from
  a seed: around 7 to 11 rooms joined by corridors with a few loops, an entry as far
  as possible from the way on, chests tucked into dead ends, braziers, and
  enemies that get tougher as you go down. The third floor is a great hall
  with a boss.
- **Layouts change.** A dungeon's seed comes from its location and a three-day
  cycle, so the same dungeon is the same if you leave and return, then redraws
  itself (and refills its chests) every three days. A cleared dungeon stays
  quiet until then, which is the reason to go and find the next one. Dungeons
  farther from home are a higher tier: harder enemies, higher-level loot.
- **Underground rules.** No sky and no flying, no weather, no building. It is
  dark: bring a torch. A minimap fills in as you explore and shows stairs,
  unopened chests and any enemy you can see.
- **Dying underground** ends the run. You wake at camp, your pack is waiting
  outside the entrance, and you keep your gear.

### Enemies

| Creature | Where | Behaviour |
| --- | --- | --- |
| Cave spider | Dungeons | Fast and fragile; lunges from a few metres away |
| Bat | Dungeons | Weaves through the air, bites and retreats |
| Skeleton | Dungeons | Walks you down and swings |
| Wraith | Floors 2 and 3 | Keeps its distance and throws bolts down corridors |
| Stone Warden | Floor 3 | Boss. Slow, telegraphed slam; enrages and calls spiders at half health |
| Boar | Surface, by day | Leaves you alone until you come close, then charges |
| Bear | Surface, far from camp | Rare and dangerous; always drops a piece of gear |

Every attack has a wind-up you can see, so stepping out of reach avoids it.
Creatures that cannot see you follow a flow field through the corridors rather
than walking into walls. The reticle shows the name and health of whatever you
are looking at, and the boss has its own health bar.

### Loot

- **Rolled bonuses.** Gear drops from chests, monsters, bears and some
  landmarks. Each piece rolls one to four bonuses from ten stats: damage,
  critical chance, swing speed, health per hit, max health, damage reduction,
  cold resistance, slower hunger and thirst, move speed and bonus experience.
- **Rarity is graded, not assigned.** An item's bonuses are scored against its
  level, and the score sets the grade: Common, Uncommon, Rare, Epic or
  Legendary. A higher grade is therefore always measurably stronger. With no
  luck bonus roughly 54% of drops are Common, 27% Uncommon, 13% Rare, 5% Epic
  and 1% Legendary; deeper floors improve the odds and the boss hoard is always
  Rare or better.
- **Four slots:** weapon, armor, boots and charm. The **Gear** panel (**G**)
  shows what you wear, your combined bonuses, and a bag of 24 with each item
  compared against the one equipped. Spare gear breaks down into experience
  (and iron ingots from Rare upwards).
- Gear is separate from the resource pack and is **kept on death**.

### Notes for developers

- Pure, engine-free modules: `js/gear.js` (rolling and grading),
  `js/dungeon.js` (sites, floor generation, grid collision, line of sight,
  flow field) and `js/creatures.js` (the stat table). Engine-side:
  `js/components/dungeon.js`, `equipment.js`, `creatures.js` (AI) and
  `js/models/creatures.js`.
- A floor is one mesh (floor, ceiling and only the wall faces that border a
  walkable cell). Walls are enforced on the grid, not with mesh collisions.
- Saves stay at version 1 with optional `gear` and `dungeons` fields. A save
  made underground resumes outside the entrance. Gear is re-graded on load, so
  an edited save cannot claim a rarity its bonuses do not earn.
- `tests/depths.test.mjs` covers grading and drop rates, generated floors
  (connectivity across 180 generated floors), collision, sight and pathing, each
  creature's behaviour in a simulated arena (including dodging a wind-up), a
  complete run from doorway to boss hoard, death underground and save
  compatibility.
- Not verified here: difficulty and pacing with real hands on the controls,
  how the new sounds actually sound, and frame rate on real phones.

## Views and dangers: three cameras, dodging and deadlier dungeons

### Three ways to look at it

Press **V** (or the **View** button) to cycle the camera. The choice is saved
with your other settings.

| View | What it is for | Aiming |
| --- | --- | --- |
| First person | The original view, with the tool in hand | The crosshair |
| Third person | Over the shoulder, with your character on screen | The crosshair, limited to your reach; if it is on nothing, whatever stands in front of you |
| Overhead | High above and a little behind, so forward is up the screen | Whatever stands closest in front of you; a ring marks it |

- The mouse wheel (or a two-finger pinch on a touch screen) zooms the two
  outside views.
- Your character carries the tool or torch you are holding, walks, swings and
  swims.
- In third person the camera slides in front of walls and hills instead of
  going through them. With your back against a wall it hides the character
  rather than fill the screen with the back of a head.
- In overhead view a dungeon's ceiling is taken off and solid rock is capped in
  black, so only the rooms and corridors show. Creatures behind a wall cannot
  be targeted.
- On a portrait phone the outside cameras sit further back.

### Dodge and quick heal

- **Dodge (Q)**: a 3.4 metre dash in the direction you are moving, or
  backwards if you are standing still. Blows miss for a third of a second.
  It needs about a second before it can be used again, and does not help
  against hunger, cold or drowning.
- **Quick heal (H)**: uses the strongest remedy you can make or eat right now
  (herbal wrap, then field dressing, then food). Nothing is used at full
  health.

### New in the depths

| Danger | Where | What it does |
| --- | --- | --- |
| Slime | Any floor | Slow and sturdy; splits into two quick slimelets when it dies |
| Elite | One per floor from floor 2, sometimes on floor 1 | A larger, glowing version of an ordinary creature: more than twice the health, harder hits, and it always drops gear a level above the floor |
| Mimic | Floors 2 and 3 | Looks like a chest until you open it. Always drops gear when beaten. Never the boss hoard, and never every chest on a floor |
| Spike trap | Corridors | A plate that glows for 0.7 seconds, then strikes. Wait, or jump over it |
| Shrine | Some floors | Touch it once for a two-minute boon or, if you are hurt, sometimes a full heal instead |

Boons: **Fury** (+30% damage), **Stoneskin** (30% less damage from blows) and
**Swiftness** (20% faster movement and swings). Active boons show above the
health bar with the time left, and are saved.

Dungeons now come in three kinds, fixed by where they are: stone **crypts**,
warm earthen **caverns**, and **frozen vaults**, where the cold builds unless
your torch is lit. The Old Barrow is always a crypt.

### Notes for developers

- `js/view.js` is pure camera maths (`cameraRig`, `clampRig`, `coneTarget`).
  `js/components/view.js` owns a second camera that does the drawing in the
  outside views. The player's body is still the original `FreeCamera`, and
  everything else keeps reading its position and rotation; because it is no
  longer the active camera in those views, `ViewSystem.update` runs its input
  update by hand.
- `game.pickTarget()` returns a real pick in first person and a synthetic one
  (same shape, plus `assisted: true`) from the other views, so gathering,
  combat and building did not need to know about views.
- A dungeon floor is now three meshes (floor and walls, ceiling, rock caps) so
  the ceiling can be switched off.
- Saves stay at version 1 with an optional `buffs` field; settings gained
  `view`.
- `tests/views.test.mjs` covers the camera maths, mode switching, aiming in
  each view (including through-wall checks), dodge distance and immunity,
  quick heal, trap timing and avoidance, shrines and boons, mimics, elites,
  slime splitting, the generator's placement rules across 240 floors, and
  dungeon themes.
- Not verified here: how third-person and overhead play with real hands on the
  controls, pinch zoom on a real phone, the new sounds, and frame rate on real
  phones.

---

Built by [Jeremy Anderson Tech](https://jeremyanderson.tech/), a web development and security practice in Shrewsbury, MA. Read more on the [project page](https://jeremyanderson.tech/project/babylon-js-survival-game/). [Services](https://jeremyanderson.tech/services/)
