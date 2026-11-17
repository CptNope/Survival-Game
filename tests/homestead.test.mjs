// Tests for the legends-and-homestead update: region bosses, the world map,
// fishing and garden beds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import BABYLON from 'babylonjs';
import { REGIONS, FRONTIERS, regionAt, regionStrength, nearestRegion } from '../js/regions.js';
import { LEGENDS, LEGEND_LIST, WAKE_RADIUS, LEASH, lairFor, marksPassed, legendById } from '../js/legends.js';
import { MAP_SPAN, MAP_CELLS, MAP_COLORS, mapCells, toSheet, onSheet } from '../js/map.js';
import { FISHING, biteDelay, fishingCatch, CROPS, CROP_IDS, pickCrop, growth, growthStage, ripeIn, sanitizeBeds } from '../js/homestead.js';
import { ITEMS, RECIPES } from '../js/resources.js';
import { CREATURES } from '../js/creatures.js';
import { BuffSystem } from '../js/components/buffs.js';
import { PerkSystem } from '../js/components/perks.js';
import { RegionSystem } from '../js/components/regions.js';
import { ArcherySystem } from '../js/components/archery.js';
import { LegendSystem } from '../js/components/legends.js';
import { FishingSystem, GardenSystem } from '../js/components/homestead.js';
import { GearSystem } from '../js/components/equipment.js';
import { DungeonSystem } from '../js/components/dungeon.js';
import { AnimalSystem } from '../js/components/animals.js';
import { InventorySystem } from '../js/components/inventory.js';
import { CombatSystem } from '../js/components/combat.js';
import { PlayerSystem } from '../js/components/player.js';
import { SurvivalSystem } from '../js/components/survival.js';
import { BuildingSystem, BUILDINGS } from '../js/components/building.js';
import { ProgressionSystem, QUESTS, STAT_LABELS } from '../js/components/progression.js';
import { SaveSystem, SAVE_KEY, SAVE_VERSION } from '../js/components/save.js';
import { SOUNDS } from '../js/components/audio.js';
import { normalizeSettings } from '../js/settings.js';

// Tests decide where the water is.
let water = () => false;

globalThis.BABYLON = BABYLON;

// A spot well inside each region, found the way the game finds one.
function deepIn(id) {
    if (id === 'meadow') return {x: 20, z: 20};
    const edge = nearestRegion(0, 0, id);
    let {x, z} = edge;
    for (let n = 0; n < 60 && regionStrength(x, z, id) < 1; n++) { x += Math.sin(edge.bearing) * 10; z += Math.cos(edge.bearing) * 10; }
    return {x, z};
}

// Real systems on the headless engine; the player's body is a real camera.
function world() {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    engine.getDeltaTime = () => 50;
    scene.getAnimationRatio = () => 1;
    const notes = [], banners = [];
    const game = {
        scene, engine, paused: false, dayTime: 60, dayLength: 300, dayCount: 1, settings: normalizeSettings(null),
        updateSettings(changes) { Object.assign(this.settings, changes); },
        uiSystem: {
            notes, banners, showNotification(message) { notes.push(message); }, showLoot() {}, updateInventoryUI() {},
            updateExperienceUI() {}, updateHealthUI() {}, updateGearUI() {}, showLevelUpMessage() {},
            setSaveStatus() {}, showDayBanner(title, text) { banners.push([title, text]); }, showGatherProgress() {}
        },
        terrainSystem: {
            waterHeight: 1, getPerlinHeight: () => 2, isWaterArea: (x, z) => water(x, z), isWithinSpawnArea: () => false,
            harvestedIds: new Set(), harvestedOn: new Map(), chunkMap: new Map(), checkChunkUpdates() {}
        },
        explorationSystem: {discovered: new Set(), isClearing: () => false},
        registerModelShadow() {},
        effects: {heldKind: null, torchLit: false, swingStart: -1e9, firstPerson: true, setFirstPerson(first) { this.firstPerson = first; }, strike() {}}
    };
    const player = game.playerSystem = Object.create(PlayerSystem.prototype);
    const camera = new BABYLON.FreeCamera('body', new BABYLON.Vector3(0, 4, 0), scene);
    Object.assign(player, {
        game, camera, isDead: false, health: 100, maxHealth: 100, oxygenLevel: 100, maxOxygen: 100,
        isGrounded: true, isFlying: false, isSwimming: false, isUnderwater: false, isJumping: false, jumpVelocity: 0,
        jumpHeight: .22, gravity: .012, jumpCount: 0, jumpTimer: 0, jumpTimerThreshold: 300, canDoubleJump: false,
        swimSpeed: .15, swimDepth: 1.25, surfaceOffset: .35, oxygenDepletionRate: .2, oxygenRefillRate: .5,
        slowDamage: 0, lastDamageCause: '', keys: {jump: false, descend: false, sprint: false}
    });
    game.inventorySystem = new InventorySystem(game);
    game.combatSystem = new CombatSystem(game);
    game.survivalSystem = new SurvivalSystem(game);
    game.buildSystem = new BuildingSystem(game);
    game.progression = new ProgressionSystem(game);
    game.gear = new GearSystem(game);
    game.buffs = new BuffSystem(game);
    game.perks = new PerkSystem(game);
    game.regions = new RegionSystem(game);
    game.dungeonSystem = new DungeonSystem(game);
    game.animalSystem = new AnimalSystem(game);
    game.animalSystem.animals = [];
    game.archery = new ArcherySystem(game);
    game.legends = new LegendSystem(game);
    game.fishing = new FishingSystem(game);
    game.gardens = new GardenSystem(game);
    return {engine, scene, game, player, camera, notes, banners};
}


// --- Legends ------------------------------------------------------------------
test('each frontier region has one legend, with a lair deep inside its nearest patch', () => {
    assert.deepEqual(Object.keys(LEGENDS).sort(), [...FRONTIERS].sort());
    const ids = new Set(), slots = new Set();
    for (const legend of LEGEND_LIST) {
        ids.add(legend.id); slots.add(legend.reward.slot);
        const def = CREATURES[legend.kind];
        assert.ok(def?.legend && def.brain && def.stat === 'legends' && SOUNDS[def.sound], legend.kind);
        assert.ok(def.health >= 300 && def.aggro > WAKE_RADIUS * .5, 'a real fight, and it notices you');
        assert.ok(CREATURES[legend.summon.kind], 'it calls on real creatures');
        assert.ok(legend.summon.at.every((mark, n) => mark > 0 && mark < 1 && (n === 0 || mark < legend.summon.at[n - 1])), 'marks run high to low');
        assert.equal(legendById(legend.id), legend);
        const lair = lairFor(legend.region);
        assert.equal(regionAt(lair.x, lair.z), legend.region);
        assert.equal(regionStrength(lair.x, lair.z, legend.region), 1, 'well inside, not on the border');
        const edge = nearestRegion(0, 0, legend.region);
        assert.ok(Math.hypot(lair.x - edge.x, lair.z - edge.z) < 160, 'in the first patch you reach');
        assert.ok(Math.hypot(lair.x, lair.z) < 520);
        assert.deepEqual(lairFor(legend.region), lair, 'always the same place');
    }
    assert.equal(ids.size, 3);
    assert.equal(slots.size, 3, 'three different prizes');
    assert.equal(legendById('nobody'), null);
    assert.ok(LEASH > WAKE_RADIUS * 2);
    // Summoning marks: each is passed once, several at a time if the blow is big enough.
    assert.equal(marksPassed(.7, [.66, .33]), 0);
    assert.equal(marksPassed(.6, [.66, .33]), 1);
    assert.equal(marksPassed(.1, [.66, .33]), 2);
    assert.equal(marksPassed(.6, [.66, .33], 1), 0);
    assert.equal(marksPassed(.3, [.66, .33], 1), 1);
    assert.equal(marksPassed(0, [.66, .33], 2), 0);
});

test('a legend wakes at its lair, calls for help, goes home if you flee and pays out when slain', () => {
    const {engine, game, camera, player, banners, notes} = world();
    try {
        const legends = game.legends, animals = game.animalSystem, tick = () => { legends.timer = 0; legends.update(.5); };
        const legend = LEGENDS.tundra, lair = legends.lair('tundra');
        game.combatSystem.level = 6;
        // Far away: nothing stirs, nothing is built.
        camera.position.set(0, 4, 0);
        tick();
        assert.equal(legends.active, null);
        assert.equal(legends.markers.size, 0);
        assert.equal(legends.nearest(camera.position), null, 'unknown until its region is found');
        game.regions.discovered.add('tundra');
        assert.equal(legends.nearest(camera.position).legend, legend);
        // In sight of the stones, but not yet close.
        camera.position.set(lair.x, 4, lair.z - 120);
        tick();
        assert.equal(legends.markers.size, 1, 'the standing stones are there to be seen');
        assert.equal(legends.active, null);
        // Close enough.
        camera.position.set(lair.x, 4, lair.z - (WAKE_RADIUS - 5));
        tick();
        const beast = legends.active.animal;
        assert.equal(beast.kind, 'rime');
        assert.equal(beast.legend, 'rime');
        assert.equal(beast.maxHealth, CREATURES.rime.health);
        assert.deepEqual(banners.at(-1)[0], 'Old Rime');
        tick();
        assert.equal(animals.animals.filter(animal => animal.kind === 'rime').length, 1, 'only one of it');

        // Wound it past the first mark, then the second: wolves come each time.
        beast.health = beast.maxHealth * .6;
        tick();
        assert.equal(animals.animals.filter(animal => animal.kind === 'icewolf').length, 2);
        assert.match(notes.at(-1), /calls for help/);
        tick();
        assert.equal(animals.animals.filter(animal => animal.kind === 'icewolf').length, 2, 'not again for the same mark');
        beast.health = beast.maxHealth * .2;
        tick();
        assert.equal(animals.animals.filter(animal => animal.kind === 'icewolf').length, 4);

        // Run: it goes home, and the next visit meets it at full strength.
        camera.position.set(lair.x, 4, lair.z - (LEASH + 10));
        tick();
        assert.equal(legends.active, null);
        assert.ok(!animals.animals.includes(beast));
        assert.ok(beast.mesh.isDisposed(), 'and takes its body with it');
        assert.match(notes.at(-1), /returns to its lair/);
        assert.equal(legends.slain.size, 0);
        camera.position.set(lair.x, 4, lair.z - 20);
        tick();
        const again = legends.active.animal;
        assert.notEqual(again, beast);
        assert.equal(again.health, again.maxHealth);
        // Dying sends it home too.
        player.isDead = true;
        tick();
        assert.equal(legends.active, null);
        player.isDead = false;
        tick();

        // Kill it: a legendary weapon carrying its name, pelts, and it stays dead.
        const quarry = legends.active.animal, xp = game.combatSystem.experience + game.combatSystem.level * 1e6;
        animals.animals = [quarry];
        quarry.health = 0;
        animals.update();
        assert.ok(legends.slain.has('rime'));
        assert.equal(legends.active, null);
        const prize = game.gear.drops.at(-1).item;
        assert.deepEqual([prize.name, prize.rarity, prize.slot], ["Rime's Fang", 'legendary', 'weapon']);
        assert.ok(prize.level >= 6, 'made for whoever won it');
        assert.equal(game.progression.stats.legends, 1);
        assert.equal(game.inventorySystem.inventory.pelt, 3);
        assert.ok(game.combatSystem.experience + game.combatSystem.level * 1e6 > xp);
        assert.match(banners.at(-1)[0], /Old Rime is slain/);
        tick(); tick();
        assert.equal(legends.active, null, 'it does not come back');
        assert.equal(legends.nearest(camera.position), null);
        assert.equal(QUESTS.find(quest => quest.id === 'legend').done(game), true);

        // Underground nothing wakes; saves keep the tally and drop nonsense.
        game.regions.discovered.add('desert');
        const sand = legends.lair('desert');
        camera.position.set(sand.x, 4, sand.z - 10);
        game.dungeonSystem.active = true;
        tick();
        assert.equal(legends.active, null);
        game.dungeonSystem.active = false;
        tick();
        assert.equal(legends.active.legend.id, 'tyrant');
        const saved = JSON.parse(JSON.stringify(legends.capture()));
        legends.restore([...saved, 'dragon', 4]);
        assert.deepEqual([...legends.slain], ['rime']);
        assert.equal(legends.active, null, 'a load sends any waking legend home');
        legends.restore(undefined);
        assert.equal(legends.slain.size, 0);
    } finally { engine.dispose(); }
});

test('a lair is moved out of a lake, and the Mother of the Mire spits a fan of three', () => {
    const {engine, game} = world();
    try {
        const base = lairFor('marsh');
        water = (x, z) => Math.hypot(x - base.x, z - base.z) < 12;
        const lair = game.legends.lair('marsh');
        assert.ok(!water(lair.x, lair.z));
        assert.ok(Math.hypot(lair.x - base.x, lair.z - base.z) < 150);
        water = () => false;

        const mother = game.animalSystem.spawnAnimal(0, 2, 12, 'miremother');
        assert.ok(mother.mesh.scaling.x > 2, 'she is huge');
        const ai = game.animalSystem.ai;
        ai.strike(mother, CREATURES.miremother);
        assert.equal(ai.bolts.length, 3);
        const headings = ai.bolts.map(bolt => Math.atan2(bolt.vx, bolt.vz));
        // The player is due south of her: the middle bolt comes straight, the others either side.
        assert.ok(Math.abs(Math.abs(headings[1]) - Math.PI) < 1e-6);
        assert.ok(Math.abs(Math.abs(headings[0] - headings[2]) - .6) < 1e-6 || Math.abs(Math.abs(headings[0] - headings[2]) - (Math.PI * 2 - .6)) < 1e-6);
        assert.ok(ai.bolts.every(bolt => bolt.cause === 'the Mother of the Mire' && Math.abs(Math.hypot(bolt.vx, bolt.vz) - Math.hypot(ai.bolts[0].vx, ai.bolts[0].vz)) < 1e-9));
        // An ordinary toad still spits one.
        ai.bolts.length = 0;
        ai.strike(game.animalSystem.spawnAnimal(0, 2, 12, 'toad'), CREATURES.toad);
        assert.equal(ai.bolts.length, 1);
    } finally { engine.dispose(); water = () => false; }
});

// --- The map ------------------------------------------------------------------
test('the map colours what you have found, hides what you have not, and puts north up', () => {
    const all = new Set(['meadow', ...FRONTIERS]);
    const home = mapCells(0, 0, new Set(['meadow']));
    assert.equal(home.length, MAP_CELLS * MAP_CELLS);
    const centre = home[(MAP_CELLS / 2) * MAP_CELLS + MAP_CELLS / 2];
    assert.equal(centre, 'meadow');
    assert.ok(home.includes('unknown'), 'the frontier is dark at first');
    assert.ok(!home.some(cell => FRONTIERS.includes(cell)));
    const full = mapCells(0, 0, all);
    assert.ok(!full.includes('unknown'));
    for (const id of FRONTIERS) assert.ok(full.includes(id), id + ' is on the sheet');
    assert.equal(full.filter((cell, n) => home[n] !== 'unknown' && cell !== home[n]).length, 0, 'finding a region only fills in the dark');
    // Water is drawn where the terrain says, but never reveals unknown country.
    const wet = mapCells(0, 0, new Set(['meadow']), (x, z) => x > 0);
    assert.ok(wet.includes('water') && wet.includes('meadow'));
    wet.forEach((cell, n) => { if (home[n] === 'unknown') assert.equal(cell, 'unknown'); });
    for (const code of new Set([...full, 'unknown', 'water'])) assert.match(MAP_COLORS[code], /^#[0-9a-f]{6}$/);

    // Each cell matches the country at its own centre: north up, east right.
    const step = MAP_SPAN / MAP_CELLS;
    for (const [row, column] of [[0, 0], [3, 80], [44, 45], [89, 12]]) {
        const x = -MAP_SPAN / 2 + (column + .5) * step, z = MAP_SPAN / 2 - (row + .5) * step;
        assert.equal(full[row * MAP_CELLS + column], regionAt(x, z));
    }
    const size = 540;
    assert.deepEqual(toSheet(100, 200, 100, 200, size), {px: 270, py: 270}, 'you are in the middle');
    assert.ok(toSheet(100, 500, 100, 200, size).py < 270, 'north is up');
    assert.ok(toSheet(400, 200, 100, 200, size).px > 270, 'east is right');
    assert.deepEqual(toSheet(100 + MAP_SPAN / 2, 200 - MAP_SPAN / 2, 100, 200, size), {px: size, py: size});
    assert.ok(onSheet({px: 10, py: 530}, size, 8) && !onSheet({px: 4, py: 100}, size, 8) && !onSheet({px: 100, py: 541}, size));
    // Every lair falls on a map centred on the clearing.
    for (const legend of LEGEND_LIST) {
        const lair = lairFor(legend.region);
        assert.ok(onSheet(toSheet(lair.x, lair.z, 0, 0, size), size, 8), legend.name);
    }
});

// --- Fishing ------------------------------------------------------------------
test('fishing rules: bites come within the window and most casts land a fish', () => {
    assert.equal(biteDelay(() => 0), FISHING.minWait);
    assert.ok(Math.abs(biteDelay(() => 1) - FISHING.maxWait) < 1e-9);
    assert.deepEqual(fishingCatch(() => .05), {item: 'fiber', amount: 1, text: 'A clump of weed'});
    assert.equal(fishingCatch(() => .5).item, 'fish');
    assert.equal(fishingCatch(() => .5).amount, 1);
    assert.equal(fishingCatch(() => .95).amount, 2, 'now and then a fine catch');
    const rolls = [.5, .1];
    assert.equal(fishingCatch(() => rolls.shift(), .2).amount, 2, 'the Forager perk can add one');
    assert.ok(FISHING.window >= 1, 'time enough to react');
    assert.ok(ITEMS.fish && ITEMS.fishingRod && RECIPES.fishingRod.unique && RECIPES.grillFish.requiresFire);
    for (const sound of ['splash', 'bite', 'plant']) assert.ok(SOUNDS[sound]);
});

test('cast from the shore, wait, and strike when the float dips', () => {
    const {engine, game, camera, notes} = world();
    try {
        const fishing = game.fishing, pack = game.inventorySystem.inventory;
        water = (x, z) => z > 4;   // A lake to the north.
        camera.position.set(0, 4, 0); camera.rotation.set(0, 0, 0);
        assert.equal(fishing.spot(), null, 'no rod, no fishing');
        assert.equal(fishing.hint(), '');
        pack.fishingRod = 1;
        const spot = fishing.spot();
        assert.ok(spot && water(spot.x, spot.z));
        assert.equal(fishing.hint(), 'Click to cast your line');
        camera.rotation.y = Math.PI;
        assert.equal(fishing.spot(), null, 'facing away from the water');
        camera.rotation.y = 0;
        camera.position.z = 10;
        assert.equal(fishing.spot(), null, 'not while standing in it');
        camera.position.z = 0;
        game.dungeonSystem.active = true;
        assert.equal(fishing.spot(), null);
        game.dungeonSystem.active = false;

        const random = Math.random;
        try {
            // Cast, wait out the delay, strike in time.
            Math.random = () => 0;
            assert.equal(fishing.act(), true);
            assert.equal(fishing.state, 'waiting');
            assert.ok(fishing.float.isEnabled());
            assert.ok(Math.abs(fishing.float.position.x - spot.x) < 1e-9 && Math.abs(fishing.float.position.z - spot.z) < 1e-9);
            assert.match(fishing.hint(), /Waiting for a bite/);
            for (let t = 0; t < FISHING.minWait - .2; t += .05) fishing.update(.05);
            assert.equal(fishing.state, 'waiting');
            for (let t = 0; t < .4; t += .05) fishing.update(.05);
            assert.equal(fishing.state, 'bite');
            assert.match(fishing.hint(), /A bite/);
            Math.random = () => .5;
            assert.equal(fishing.act(), true);
            assert.equal(pack.fish, 1);
            assert.equal(game.progression.stats.fish, 1);
            assert.equal(fishing.state, 'idle');
            assert.equal(fishing.float.isEnabled(), false);
            assert.equal(QUESTS.find(quest => quest.id === 'angler').done(game), true);

            // Too slow: it gets away.
            Math.random = () => 0;
            fishing.act();
            for (let t = 0; t < FISHING.minWait + FISHING.window + .3; t += .05) fishing.update(.05);
            assert.equal(fishing.state, 'idle');
            assert.equal(notes.at(-1), 'It got away');
            assert.equal(pack.fish, 1);
            // Too eager: reeling in before the bite catches nothing.
            fishing.act();
            fishing.update(.5);
            assert.equal(fishing.act(), true);
            assert.equal(notes.at(-1), 'You reel in too soon');
            assert.equal(pack.fish, 1);
            // Wander off and the line comes in.
            fishing.act();
            camera.position.x = FISHING.tether + 1;
            fishing.update(.05);
            assert.equal(fishing.state, 'idle');
            camera.position.x = 0;
        } finally { Math.random = random; }

        // The catch is a meal once grilled.
        game.buildSystem.structures.push({id: 1, type: 'fire', x: 0, y: 2, z: 0, rotation: 0});
        game.playerSystem.health = 50; game.survivalSystem.hunger = 30;
        assert.equal(game.inventorySystem.craft('grillFish'), true);
        assert.deepEqual([pack.fish, game.playerSystem.health, game.survivalSystem.hunger], [0, 65, 70]);
    } finally { engine.dispose(); water = () => false; }
});

// --- Gardens --------------------------------------------------------------------
test('garden rules: what can be planted, how it grows, and what a bed gives back', () => {
    for (const id of CROP_IDS) {
        const crop = CROPS[id];
        assert.ok(ITEMS[id], id + ' is a real item');
        assert.ok(crop.yield >= crop.seed * 3, id + ' is worth planting');
        assert.ok(crop.days >= 1 && crop.days <= 3 && crop.colour.length === 3);
    }
    assert.equal(pickCrop({}), null);
    assert.equal(pickCrop({berries: 1, herbs: 1}), null, 'not enough of anything');
    assert.equal(pickCrop({berries: 2, herbs: 5, cactusFruit: 1}), 'herbs', 'whatever you carry most of');
    assert.equal(pickCrop({cactusFruit: 1}), 'cactusFruit');
    assert.equal(growth(10, 10, 'berries'), 0);
    assert.equal(growth(10 + CROPS.berries.days / 2, 10, 'berries'), .5);
    assert.equal(growth(99, 10, 'berries'), 1);
    assert.equal(growth(5, 10, 'berries'), 0, 'a clock that ran backwards does no harm');
    assert.equal(growth(11, 10, 'turnips'), 0);
    assert.deepEqual([0, .39, .4, .99, 1].map(growthStage), [0, 0, 1, 1, 2]);
    assert.equal(ripeIn(10, 10, 'berries'), 'about a day and a half');
    assert.equal(ripeIn(10, 10, 'mushrooms'), 'about 2 days');
    assert.equal(ripeIn(10.6, 10, 'berries'), 'about a day');
    assert.equal(ripeIn(11.2, 10, 'berries'), 'about 7 hours');
    assert.equal(ripeIn(11.48, 10, 'berries'), 'about an hour');
    assert.equal(ripeIn(12, 10, 'berries'), 'now');
    assert.deepEqual(sanitizeBeds([
        {id: 3, crop: 'herbs', plantedAt: 2.5}, {id: 3, crop: 'berries', plantedAt: 1}, {id: 4, crop: 'turnips', plantedAt: 1},
        {id: 5, crop: 'berries', plantedAt: NaN}, {id: 6.5, crop: 'berries', plantedAt: 1}, null, {id: 9, crop: 'berries', plantedAt: 1}
    ], id => id !== 9), [{id: 3, crop: 'herbs', plantedAt: 2.5}]);
    assert.deepEqual(sanitizeBeds('nonsense'), []);
    assert.deepEqual(BUILDINGS.garden.cost, {wood: 4, fiber: 2});
});

test('build a bed, plant it, wait, harvest more than you sowed, and keep it across a save', () => {
    const {engine, game, camera, notes} = world();
    try {
        const gardens = game.gardens, pack = game.inventorySystem.inventory, survival = game.survivalSystem;
        camera.position.set(30, 4, 30); camera.rotation.set(.3, 0, 0);
        assert.equal(gardens.interaction(), null, 'no bed here');
        Object.assign(pack, {wood: 4, fiber: 2});
        assert.equal(game.buildSystem.place('garden'), true);
        const bed = game.buildSystem.structures.at(-1);
        assert.equal(bed.type, 'garden');
        camera.position.set(bed.x + 1, 4, bed.z);
        assert.match(gardens.interaction().label, /Empty bed/);
        assert.equal(gardens.interaction().act, undefined);
        // E plants what you carry, before it would sleep or drink.
        pack.berries = 5; survival.thirst = 100;
        assert.match(gardens.interaction().label, /Press E to plant berries · uses 2/);
        assert.equal(survival.interact(), true);
        assert.equal(pack.berries, 3);
        assert.equal(gardens.beds.get(bed.id).crop, 'berries');
        assert.match(notes.at(-1), /Berries planted/);
        gardens.timer = 0; gardens.update(1);
        assert.equal(gardens.meshes.get(bed.id).stage, 0, 'seedlings');
        assert.match(gardens.interaction().label, /Berries growing · ripe in about a day and a half/);
        assert.equal(gardens.harvest(bed), false, 'not yet');
        assert.equal(gardens.plant(bed, 'berries'), false, 'one crop to a bed');

        // Time passes: half grown, then ripe.
        game.dayTime += game.dayLength * .8;
        gardens.timer = 0; gardens.update(1);
        assert.equal(gardens.meshes.get(bed.id).stage, 1);
        const young = gardens.meshes.get(bed.id).mesh;
        game.dayCount += 1;
        gardens.timer = 0; gardens.update(1);
        assert.equal(gardens.meshes.get(bed.id).stage, 2);
        assert.ok(young.isDisposed(), 'the old plants are replaced, not piled up');
        assert.match(gardens.interaction().label, /Press E to harvest berries/);

        // A planted bed survives a save and a load.
        const items = new Map();
        const storage = {setItem(key, value) { items.set(key, value); }, getItem(key) { return items.get(key) || null; }, removeItem(key) { items.delete(key); }};
        const saves = game.saveSystem = new SaveSystem(game, storage);
        assert.equal(saves.save(), true);
        const raw = JSON.parse(items.get(SAVE_KEY));
        assert.equal(raw.version, SAVE_VERSION);
        assert.equal(raw.gardens.length, 1);
        gardens.beds.clear();
        assert.equal(saves.load(), true);
        assert.equal(gardens.beds.get(bed.id).crop, 'berries');
        const restored = game.buildSystem.structures.find(item => item.id === bed.id);
        assert.equal(restored.type, 'garden');

        const random = Math.random;
        Math.random = () => .99;
        try { assert.equal(survival.interact(), true); } finally { Math.random = random; }
        assert.equal(pack.berries, 3 + CROPS.berries.yield);
        assert.equal(gardens.beds.size, 0);
        assert.equal(gardens.meshes.size, 0);
        assert.equal(game.progression.stats.harvests, 1);
        assert.equal(QUESTS.find(quest => quest.id === 'gardener').done(game), true);
        assert.match(gardens.interaction().label, /Press E to plant/, 'ready to sow again');
        // The Forager perk finds one more in the bed too.
        gardens.plant(restored, 'berries');
        game.dayCount += 3;
        game.perks.ranks = {forager: 3};
        Math.random = () => .5;
        try { gardens.harvest(restored); } finally { Math.random = random; }
        assert.equal(pack.berries, 1 + CROPS.berries.yield * 2 + 1);

        // A save naming a bed that no longer exists, or an older save with none, loads cleanly.
        raw.gardens = [{id: 999, crop: 'herbs', plantedAt: 1}];
        items.set(SAVE_KEY, JSON.stringify(raw));
        assert.equal(saves.load(), true);
        assert.equal(gardens.beds.size, 0);
        delete raw.gardens; delete raw.legends;
        items.set(SAVE_KEY, JSON.stringify(raw));
        assert.equal(saves.load(), true);
        assert.equal(game.legends.slain.size, 0);
    } finally { engine.dispose(); }
});

test('the new quests, stats and files are all wired up', async () => {
    for (const stat of ['fish', 'harvests', 'legends']) assert.ok(STAT_LABELS[stat]);
    const order = id => QUESTS.findIndex(quest => quest.id === id);
    for (const id of ['angler', 'gardener', 'legend']) assert.ok(order(id) > order('cloak') && order(id) < order('veteran'), id);
    const {engine, game} = world();
    try {
        for (const id of ['angler', 'gardener', 'legend']) {
            const quest = QUESTS[order(id)];
            assert.equal(quest.done(game), false);
            assert.equal(typeof quest.progress(game), 'string');
        }
        assert.match(QUESTS[order('legend')].progress(game), /Find a frontier region first/);
        game.regions.discovered.add('desert');
        assert.match(QUESTS[order('legend')].progress(game), /The Sand Tyrant · \d+m away/);
    } finally { engine.dispose(); }
    const worker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
    for (const file of ['js/legends.js', 'js/map.js', 'js/homestead.js', 'js/components/legends.js', 'js/components/homestead.js'])
        assert.ok(worker.includes(`'./${file}'`), file + ' is not precached');
    assert.ok(REGIONS.meadow && SAVE_VERSION === 1);
});
