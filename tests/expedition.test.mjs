// Regression tests for the expedition overhaul: tool-tiered gathering, new
// gear, swimming, sleeping, regrowth, field notes, sky, settings and audio.
import test from 'node:test';
import assert from 'node:assert/strict';
import BABYLON from 'babylonjs';
import { InventorySystem } from '../js/components/inventory.js';
import { CombatSystem } from '../js/components/combat.js';
import { PlayerSystem } from '../js/components/player.js';
import { SurvivalSystem, WATERSKIN_CAPACITY } from '../js/components/survival.js';
import { BuildingSystem } from '../js/components/building.js';
import { SaveSystem, SAVE_KEY } from '../js/components/save.js';
import { TerrainSystem, LAKE_DEPTH } from '../js/components/terrain.js';
import { ProgressionSystem, QUESTS, STAT_LABELS } from '../js/components/progression.js';
import { skyState, clockTime } from '../js/components/sky.js';
import { weatherAt } from '../js/components/weather.js';
import { AudioSystem, SOUNDS } from '../js/components/audio.js';
import { RESOURCES, RECIPES, REGROW_DAYS, ITEMS, hitsNeeded, toolTier } from '../js/resources.js';
import { normalizeSettings, loadSettings, saveSettings, DEFAULT_SETTINGS, SETTINGS_KEY } from '../js/settings.js';

globalThis.BABYLON = BABYLON;

const ui = () => ({
    messages: [],
    showNotification(message) { this.messages.push(message); },
    updateInventoryUI() {}, updateExperienceUI() {}, updateHealthUI() {},
    showLevelUpMessage() {}, setSaveStatus() {}, showGatherProgress() {}
});

function world() {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    const game = {
        scene, paused: false, dayTime: 60, dayLength: 300, dayCount: 1,
        uiSystem: ui(),
        playerSystem: {
            isDead: false, health: 60, maxHealth: 100, oxygenLevel: 100, maxOxygen: 100,
            isGrounded: true, isFlying: false, isSwimming: false, jumpVelocity: 0,
            keys: {sprint: false},
            camera: {position: new BABYLON.Vector3(0, 4, 0), rotation: new BABYLON.Vector3(0, 0, 0)},
            takeDamage(amount) { this.health -= amount; }
        },
        terrainSystem: {
            waterHeight: 1, getPerlinHeight: () => 2, isWaterArea: () => false,
            isWithinSpawnArea: () => true, harvestedIds: new Set(), harvestedOn: new Map(),
            chunkMap: new Map(), checkChunkUpdates() {}, expireRegrown() { return []; }
        },
        explorationSystem: {discovered: new Set(), isClearing: () => false},
        animalSystem: {animals: []},
        combatSystem: null
    };
    game.inventorySystem = new InventorySystem(game);
    game.combatSystem = new CombatSystem(game);
    game.survivalSystem = new SurvivalSystem(game);
    game.buildSystem = new BuildingSystem(game);
    game.progression = new ProgressionSystem(game);
    return {engine, scene, game};
}

function swing(inventory, times = 1) {
    let last = false;
    for (let n = 0; n < times; n++) { inventory.nextSwingAt = 0; last = inventory.tryHarvest(); }
    return last;
}

test('better tools need fewer swings and bare hands cannot mine ore', () => {
    assert.equal(toolTier({}), 'hand');
    assert.equal(toolTier({tools: 1}), 'stone');
    assert.equal(toolTier({tools: 1, ironTools: 1}), 'iron');
    assert.deepEqual(['hand', 'stone', 'iron'].map(tier => RESOURCES.tree.hits[tier]), [3, 2, 1]);
    assert.equal(hitsNeeded('tree', {}), 3);
    assert.equal(hitsNeeded('rock', {tools: 1}), 2);
    assert.equal(hitsNeeded('tree', {ironTools: 1}), 1);
    assert.equal(hitsNeeded('ore', {}), Infinity);
    assert.equal(hitsNeeded('berry', {}), 1);
    // Every gatherable type regrows and yields a real item.
    for (const [type, resource] of Object.entries(RESOURCES)) {
        assert.ok(REGROW_DAYS[type] >= 1, type + ' must regrow');
        for (const item of Object.keys(resource.yields)) assert.ok(Object.hasOwn(ITEMS, item));
    }
});

test('a node is worn down swing by swing, pays out once and records its day', () => {
    const {engine, game} = world();
    try {
        const inventory = game.inventorySystem;
        let disposed = 0;
        const mesh = {dispose() { disposed++; }, position: new BABYLON.Vector3(0, 2, 3)};
        const node = {mesh, type: 'tree', resourceId: '0,0:tree:1'};
        inventory.harvestableObjects = [node];
        game.pickTarget = () => ({hit: true, pickedMesh: mesh, pickedPoint: mesh.position});
        game.dayCount = 4;
        assert.equal(swing(inventory), true);
        assert.equal(node.hits, 1);
        assert.equal(inventory.inventory.wood, 0);
        assert.equal(disposed, 0);
        swing(inventory, 2);
        assert.equal(inventory.inventory.wood, 2);
        assert.equal(disposed, 1);
        assert.equal(inventory.harvestableObjects.length, 0);
        assert.equal(game.terrainSystem.harvestedOn.get('0,0:tree:1'), 4);
        assert.equal(game.progression.stats.gathered, 1);
        // Nothing left to hit: further swings do nothing.
        assert.equal(swing(inventory), false);
        assert.equal(inventory.inventory.wood, 2);
    } finally { engine.dispose(); }
});

test('the swing cooldown stops one click from landing twice', () => {
    const {engine, game} = world();
    try {
        const inventory = game.inventorySystem;
        const mesh = {dispose() {}, position: new BABYLON.Vector3(0, 2, 3)};
        const node = {mesh, type: 'rock'};
        inventory.harvestableObjects = [node];
        game.pickTarget = () => ({hit: true, pickedMesh: mesh});
        assert.equal(inventory.tryHarvest(), true);
        assert.equal(inventory.swinging(), true);
        assert.equal(inventory.tryHarvest(), false);
        assert.equal(node.hits, 1);
    } finally { engine.dispose(); }
});

test('aiming near a thin plant is enough, but looking at an animal is not foraging', () => {
    const {engine, game} = world();
    try {
        const inventory = game.inventorySystem;
        const plant = {mesh: {position: new BABYLON.Vector3(.4, 1.6, 3), dispose() {}}, type: 'fiber'};
        const tree = {mesh: {position: new BABYLON.Vector3(.4, 1.6, 3), dispose() {}}, type: 'tree'};
        game.playerSystem.camera.getForwardRay = () =>
            ({origin: new BABYLON.Vector3(0, 2, 0), direction: new BABYLON.Vector3(0, 0, 1)});
        game.pickTarget = () => ({hit: false});
        inventory.harvestableObjects = [tree];
        assert.equal(inventory.findTarget(), null, 'trees must be hit directly');
        inventory.harvestableObjects = [tree, plant];
        assert.equal(inventory.findTarget(), plant);
        plant.mesh.position.x = 2;
        assert.equal(inventory.findTarget(), null, 'too far off the reticle');
        plant.mesh.position.x = .4;
        const deer = {};
        game.animalSystem.animals = [{mesh: deer}];
        game.pickTarget = () => ({hit: true, pickedMesh: deer});
        assert.equal(inventory.findTarget(), null);
    } finally { engine.dispose(); }
});

test('gear is crafted once and the panel explains why a recipe is unavailable', () => {
    const {engine, game} = world();
    try {
        const inventory = game.inventorySystem;
        assert.equal(inventory.blockedReason('spear'), 'Missing materials');
        Object.assign(inventory.inventory, {wood: 9, stone: 4, fiber: 12, rawMeat: 1});
        for (const item of ['spear', 'torch', 'waterskin']) {
            assert.equal(RECIPES[item].unique, true);
            assert.equal(inventory.craft(item), true);
            assert.equal(inventory.inventory[item], 1);
            assert.equal(inventory.craft(item), false);
            assert.equal(inventory.blockedReason(item), 'Already carried');
        }
        assert.deepEqual([inventory.inventory.wood, inventory.inventory.stone, inventory.inventory.fiber], [6, 3, 6]);
        assert.equal(inventory.blockedReason('cookMeat'), 'Stand by a campfire');
        assert.equal(inventory.blockedReason('planks'), '');
        assert.equal(game.progression.stats.crafted, 3);
    } finally { engine.dispose(); }
});

test('a spear adds reach and damage without stacking on an iron tool', () => {
    const {engine, game} = world();
    try {
        const combat = game.combatSystem, items = game.inventorySystem.inventory;
        assert.equal(combat.reach(), 5);
        assert.equal(combat.damage(), 10);
        items.ironTools = 1;
        assert.equal(combat.damage(), 18);
        items.spear = 1;
        assert.equal(combat.reach(), 7);
        assert.equal(combat.damage(), 22);
        items.ironTools = 0;
        assert.equal(combat.damage(), 22);
    } finally { engine.dispose(); }
});

test('a heavy sweep keeps the tool when nothing is in reach', () => {
    const {engine, game} = world();
    try {
        const combat = game.combatSystem, items = game.inventorySystem.inventory;
        items.tools = 1;
        assert.equal(combat.specialAttack(), false);
        assert.equal(items.tools, 1);
        const wolf = {kind: 'wolf', health: 45, mesh: {position: new BABYLON.Vector3(3, 2, 0), scaling: {y: 1}}};
        game.animalSystem.animals = [wolf];
        assert.equal(combat.specialAttack(), true);
        assert.equal(items.tools, 0);
        assert.equal(wolf.health, 15);
        assert.ok(wolf.fleeTimer > 0 && wolf.knockX > 0, 'a struck animal recoils away from the player');
    } finally { engine.dispose(); }
});

test('a waterskin is filled at the shore and carries three drinks inland', () => {
    const {engine, game} = world();
    try {
        const survival = game.survivalSystem;
        survival.thirst = 30;
        assert.equal(survival.drink(), false, 'no water and no waterskin');
        game.inventorySystem.inventory.waterskin = 1;
        assert.equal(survival.drink(), false, 'an empty waterskin is no help');
        game.terrainSystem.isWaterArea = () => true;
        game.playerSystem.camera.position.y = 3;
        assert.equal(survival.drink(), true);
        assert.equal(survival.thirst, 70);
        assert.equal(survival.water, WATERSKIN_CAPACITY);
        survival.thirst = 100;
        survival.water = 1;
        assert.equal(survival.drink(), true, 'topping up the waterskin is worthwhile when not thirsty');
        assert.equal(survival.water, WATERSKIN_CAPACITY);
        game.terrainSystem.isWaterArea = () => false;
        assert.equal(survival.drink(), false, 'not thirsty: do not waste a carried drink');
        survival.thirst = 20;
        for (let left = WATERSKIN_CAPACITY - 1; left >= 0; left--) {
            assert.equal(survival.drink(), true);
            assert.equal(survival.water, left);
            survival.thirst = 20;
        }
        assert.equal(survival.drink(), false);
    } finally { engine.dispose(); }
});

test('rest needs night, a bed and no wolves, and wakes the player at dawn', () => {
    const {engine, game} = world();
    try {
        const survival = game.survivalSystem;
        let dawn = null;
        game.advanceToDawn = message => { dawn = message; game.dayCount++; game.dayTime = 8; };
        assert.equal(survival.sleepStatus().near, false);
        assert.equal(survival.sleep(), false);
        game.buildSystem.structures.push({id: 1, type: 'shelter', x: 2, y: 2, z: 1, rotation: 0});
        assert.equal(game.buildSystem.nearBed(game.playerSystem.camera.position), true);
        assert.equal(survival.sleepStatus().ok, false, 'not during the day');
        game.dayTime = 220;
        const wolf = {kind: 'wolf', mesh: {position: new BABYLON.Vector3(10, 2, 0)}};
        game.animalSystem.animals = [wolf];
        assert.match(survival.sleepStatus().reason, /Wolves/);
        assert.equal(survival.sleep(), false);
        game.animalSystem.animals = [];
        Object.assign(survival, {hunger: 50, thirst: 50, cold: 80});
        assert.equal(survival.interact(), true);
        assert.equal(game.dayCount, 2);
        assert.equal(dawn, 'You slept until dawn');
        assert.deepEqual([survival.hunger, survival.thirst, survival.cold], [36, 32, 0]);
        assert.equal(game.playerSystem.health, 90);
        assert.equal(game.progression.stats.slept, 1);
        // A campfire alone is warmth, not a bed.
        game.buildSystem.structures = [{id: 2, type: 'fire', x: 0, y: 2, z: 0, rotation: 0}];
        game.dayTime = 220;
        assert.equal(survival.sleepStatus().near, false);
    } finally { engine.dispose(); }
});

test('a lit torch slows the chill but does not replace shelter', () => {
    const {engine, game} = world();
    try {
        const survival = game.survivalSystem;
        game.dayTime = 220;
        survival.cold = 10; survival.update(.05);
        const bare = survival.cold - 10;
        game.effects = {torchLit: true};
        survival.cold = 10; survival.update(.05);
        const lit = survival.cold - 10;
        assert.ok(lit > 0 && lit < bare);
    } finally { engine.dispose(); }
});

test('field notes complete in order, pay experience and survive a save', () => {
    const {engine, game} = world();
    try {
        const notes = game.progression;
        assert.equal(notes.current().id, 'tool');
        assert.deepEqual(notes.check(), []);
        // A later goal met early waits its turn.
        game.buildSystem.structures.push({id: 1, type: 'fire', x: 20, y: 2, z: 20, rotation: 0});
        assert.equal(notes.check().length, 0);
        game.inventorySystem.inventory.tools = 1;
        const finished = notes.check().map(quest => quest.id);
        assert.deepEqual(finished, ['tool', 'fire']);
        assert.equal(game.combatSystem.experience, 55);
        assert.equal(notes.current().id, 'meal');
        notes.record('meals');
        assert.equal(notes.current().id, 'shelter');
        notes.record('not-a-stat');
        const saved = JSON.parse(JSON.stringify(notes.capture()));
        const fresh = new ProgressionSystem(game);
        fresh.restore({completed: [...saved.completed, 'bogus'], stats: {...saved.stats, wolves: -4, hunted: 'x'}});
        assert.deepEqual([...fresh.completed], ['tool', 'fire', 'meal']);
        assert.equal(fresh.stats.meals, 1);
        assert.equal(fresh.stats.wolves, 0);
        assert.equal(fresh.stats.hunted, 0);
        fresh.restore(undefined);
        assert.equal(fresh.completed.size, 0);
        // The chain is well formed.
        assert.equal(new Set(QUESTS.map(quest => quest.id)).size, QUESTS.length);
        for (const quest of QUESTS) {
            assert.ok(quest.xp > 0 && quest.title && quest.text);
            assert.equal(typeof quest.progress(game), 'string');
            assert.equal(typeof quest.done(game), 'boolean');
        }
        assert.ok(Object.keys(STAT_LABELS).every(key => Object.hasOwn(notes.stats, key)));
    } finally { engine.dispose(); }
});

test('lakes shelve from a beach to swimming depth and dry land stays dry', () => {
    const terrain = Object.create(TerrainSystem.prototype);
    Object.assign(terrain, {spawnPosition: {x: 0, z: 0}, spawnHeight: 2, spawnAreaRadius: 10, waterHeight: 1});
    // The nearest lake is centred 314 units east of the clearing.
    assert.equal(terrain.isWaterArea(314, 0), true);
    assert.ok(Math.abs(terrain.waterDepthAt(314, 0) - (LAKE_DEPTH + .04)) < 1e-9);
    assert.equal(terrain.isWaterArea(0, 0), false);
    assert.equal(terrain.waterDepthAt(0, 0), 0);
    let previous = terrain.getPerlinHeight(100, 0), shore = null;
    for (let x = 100.5; x <= 314; x += .5) {
        const height = terrain.getPerlinHeight(x, 0);
        assert.ok(Math.abs(height - previous) < .35, 'no cliff at x=' + x);
        if (shore === null && terrain.isWaterArea(x, 0)) shore = x;
        // Water only ever stands where the lake mask says so.
        assert.equal(height < terrain.waterHeight, terrain.isWaterArea(x, 0), 'waterline at x=' + x);
        previous = height;
    }
    assert.ok(shore > 140 && shore < 170);
    assert.equal(terrain.isShore(shore - 5, 0), true, 'beach stays clear of trees');
    assert.equal(terrain.isShore(40, 0), false);
    for (let x = -400; x <= 400; x += 37) for (let z = -400; z <= 400; z += 41) {
        const height = terrain.getPerlinHeight(x, z);
        assert.ok(Number.isFinite(height));
        if (!terrain.isWaterArea(x, z)) assert.ok(height >= terrain.waterHeight, `dry at ${x},${z}`);
        assert.ok(terrain.terrainColor(x, z, height).every(c => c >= 0 && c <= 1));
    }
});

function swimmer(depthBelowSurface) {
    const player = Object.create(PlayerSystem.prototype);
    const bed = 1 - depthBelowSurface;
    Object.assign(player, {
        game: {
            scene: {getAnimationRatio: () => 1},
            terrainSystem: {waterHeight: 1, isWaterArea: () => true, getPerlinHeight: () => bed}
        },
        camera: {position: {x: 0, y: bed + 2, z: 0}, speed: 0},
        isDead: false, isGrounded: true, isFlying: false, isSwimming: false, isUnderwater: false,
        jumpHeight: .22, gravity: .012, jumpVelocity: 0, swimSpeed: .15, swimDepth: 1.25, surfaceOffset: .35,
        oxygenLevel: 100, maxOxygen: 100, oxygenDepletionRate: .2, oxygenRefillRate: .5,
        health: 100, maxHealth: 100, slowDamage: 0,
        keys: {jump: false, descend: false, sprint: false}
    });
    return player;
}

test('shallows are waded, deep water is swum, and only diving costs oxygen', () => {
    const wader = swimmer(.8);
    wader.update();
    assert.equal(wader.isSwimming, false);
    assert.equal(wader.camera.position.y, 2.2);
    assert.equal(wader.camera.speed, .27);

    const player = swimmer(3);
    for (let n = 0; n < 40; n++) player.update();
    assert.equal(player.isSwimming, true);
    assert.equal(player.isUnderwater, false);
    assert.ok(Math.abs(player.camera.position.y - 1.35) < 1e-9, 'treads water with eyes above the surface');
    assert.equal(player.oxygenLevel, 100);
    assert.equal(player.camera.speed, .15);

    player.keys.descend = true;
    for (let n = 0; n < 30; n++) player.update();
    assert.equal(player.isUnderwater, true);
    assert.ok(player.oxygenLevel < 100);
    assert.ok(player.camera.position.y >= -2 + .7 - 1e-9, 'cannot sink through the lake bed');

    player.keys.descend = false;
    for (let n = 0; n < 80; n++) player.update();
    assert.equal(player.isUnderwater, false);
    assert.ok(Math.abs(player.camera.position.y - 1.35) < 1e-9);

    // Out of breath: drowning is credited on the death screen.
    player.keys.descend = true;
    player.oxygenLevel = 0;
    player.game.effects = {hurt() {}};
    for (let n = 0; n < 12; n++) player.update();
    assert.ok(player.health < 100);
    assert.equal(player.lastDamageCause, 'drowning');
});

test('gathered nodes grow back on schedule and reappear in loaded chunks', () => {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    try {
        const harvestables = [];
        const terrain = Object.create(TerrainSystem.prototype);
        Object.assign(terrain, {
            scene, chunkSize: 32, spawnPosition: {x: 0, z: 0}, spawnHeight: 2, spawnAreaRadius: 10,
            waterHeight: 1, waterMeshes: [], harvestedIds: new Set(), harvestedOn: new Map(), chunkMap: new Map(),
            game: {scene, inventorySystem: {harvestableObjects: harvestables}, registerModelShadow() {}}
        });
        terrain.populateChunk(2, 1);
        const all = harvestables.map(node => node.resourceId);
        assert.ok(all.length >= 8);
        assert.equal(new Set(all).size, all.length);
        terrain.chunkMap.set('2,1', {objects: [...harvestables]});

        // Gather one tree and one berry bush on day 1.
        const tree = harvestables.find(node => node.type === 'tree');
        const berry = harvestables.find(node => node.type === 'berry');
        for (const node of [tree, berry]) {
            node.mesh.dispose(false, true);
            harvestables.splice(harvestables.indexOf(node), 1);
            terrain.harvestedIds.add(node.resourceId);
            terrain.harvestedOn.set(node.resourceId, 1);
        }
        terrain.harvestedIds.add('9,9:rock:0'); // In a chunk that is not loaded.
        terrain.harvestedOn.set('9,9:rock:0', 1);

        assert.equal(terrain.regrow(2), 0, 'nothing is back after a single day');
        assert.equal(terrain.regrow(1 + REGROW_DAYS.berry), 1);
        assert.ok(harvestables.some(node => node.resourceId === berry.resourceId));
        assert.equal(terrain.harvestedIds.has(tree.resourceId), true);
        assert.equal(terrain.regrow(1 + REGROW_DAYS.tree), 1);
        const regrown = harvestables.find(node => node.resourceId === tree.resourceId);
        assert.deepEqual(regrown.mesh.position.asArray(), tree.mesh.position.asArray(), 'same tree, same place');
        assert.equal(harvestables.length, all.length, 'nothing was duplicated');
        assert.equal(terrain.chunkMap.get('2,1').objects.length, all.length + 2);
        assert.equal(terrain.regrow(1 + REGROW_DAYS.rock), 0, 'unloaded chunks just forget the depletion');
        assert.equal(terrain.harvestedIds.size, 0);
        // Legacy saves have no recorded day: treated as gathered on day 1.
        terrain.harvestedIds.add('3,3:fiber:1');
        assert.deepEqual(terrain.expireRegrown(1 + REGROW_DAYS.fiber), ['3,3:fiber:1']);
    } finally { engine.dispose(); }
});

test('saves carry field notes, waterskin and regrowth days, and old saves still load', () => {
    const {engine, game} = world();
    try {
        const items = new Map();
        const storage = {
            setItem(key, value) { items.set(key, value); }, getItem(key) { return items.get(key) || null; },
            removeItem(key) { items.delete(key); }
        };
        const saves = game.saveSystem = new SaveSystem(game, storage);
        game.inventorySystem.inventory.waterskin = 1;
        game.survivalSystem.water = 2;
        game.dayCount = 3;
        game.progression.completed.add('tool');
        game.progression.stats.nights = 2;
        game.terrainSystem.harvestedIds.add('1,1:tree:0');
        game.terrainSystem.harvestedOn.set('1,1:tree:0', 3);
        assert.equal(saves.save(), true);
        const raw = JSON.parse(items.get(SAVE_KEY));
        assert.equal(raw.water, 2);
        assert.deepEqual(raw.harvestedDays, {'1,1:tree:0': 3});

        game.survivalSystem.water = 0;
        game.progression.restore(null);
        game.terrainSystem.harvestedOn.clear();
        assert.equal(saves.load(), true);
        assert.equal(game.survivalSystem.water, 2);
        assert.ok(game.progression.completed.has('tool'));
        assert.equal(game.progression.stats.nights, 2);
        assert.equal(game.terrainSystem.harvestedOn.get('1,1:tree:0'), 3);

        // A save written before this update has none of the new fields.
        for (const key of ['water', 'progression', 'harvestedDays']) delete raw[key];
        raw.inventory = {wood: 5};
        items.set(SAVE_KEY, JSON.stringify(raw));
        assert.equal(saves.load(), true);
        assert.equal(game.inventorySystem.inventory.wood, 5);
        assert.equal(game.inventorySystem.inventory.spear, 0);
        assert.equal(game.survivalSystem.water, 0);
        assert.equal(game.progression.completed.size, 0);
        assert.equal(game.terrainSystem.harvestedOn.get('1,1:tree:0'), 1);

        // Starting over erases the save and blocks the page-exit autosave from restoring it.
        assert.equal(saves.clear(), true);
        assert.equal(items.has(SAVE_KEY), false);
        assert.equal(saves.save(), false);
        assert.equal(items.has(SAVE_KEY), false);
    } finally { engine.dispose(); }
});

test('the build preview follows the player, rotates, explains blocked sites and charges once', () => {
    const {engine, game, scene} = world();
    try {
        const build = game.buildSystem, items = game.inventorySystem.inventory;
        assert.equal(build.beginPlacement('fire'), false, 'cannot preview what cannot be afforded');
        Object.assign(items, {wood: 6, stone: 6, planks: 4});
        assert.equal(build.beginPlacement('fire'), true);
        assert.equal(scene.meshes.length, 1, 'only the preview exists so far');
        assert.equal(build.placing.blocked, '');
        build.rotatePlacement(1);
        build.rotatePlacement(1);
        build.updatePlacement();
        assert.ok(Math.abs(build.placing.ghost.rotation.y - Math.PI / 2) < 1e-9);
        game.terrainSystem.isWaterArea = () => true;
        build.updatePlacement();
        assert.equal(build.placing.blocked, 'Cannot build in water');
        assert.equal(build.confirmPlacement(), false);
        assert.equal(items.wood, 6);
        game.terrainSystem.isWaterArea = () => false;
        assert.equal(build.confirmPlacement(), true);
        assert.equal(build.placing, null, 'a campfire is a single placement');
        assert.deepEqual([items.wood, items.stone], [3, 3]);
        assert.ok(Math.abs(build.structures[0].rotation - Math.PI / 2) < 1e-9);
        assert.equal(scene.meshes.length, 1, 'the preview was replaced by the real fire');
        assert.equal(game.progression.stats.built, 1);

        // Modular pieces keep the preview up while materials last.
        game.playerSystem.camera.position.x = 40;
        assert.equal(build.beginPlacement('floor'), true);
        assert.equal(build.confirmPlacement(), true);
        assert.ok(build.placing, 'still placing floors');
        assert.equal(build.placing.blocked, 'That piece is already built here');
        game.playerSystem.camera.position.x = 48;
        assert.equal(build.confirmPlacement(), true);
        assert.equal(build.placing, null, 'planks ran out');
        assert.equal(build.cancelPlacement(), false);
        assert.equal(build.blockedReason('fire', null), 'Land before building');
    } finally { engine.dispose(); }
});

test('the sky brightens by day, shows stars at night and greys over in bad weather', () => {
    const noon = skyState(75), midnight = skyState(225), dusk = skyState(149), storm = skyState(75, 300, 'storm');
    assert.ok(noon.sunIntensity > 1 && noon.moonIntensity === 0 && noon.starAmount === 0);
    assert.ok(midnight.sunIntensity === 0 && midnight.moonIntensity > .2 && midnight.starAmount > .9);
    assert.ok(midnight.ambientIntensity >= .3, 'nights stay readable');
    assert.ok(noon.zenith[2] > midnight.zenith[2] * 5);
    assert.ok(dusk.horizon[0] > dusk.horizon[2] * 1.5, 'sunset is warm at the horizon');
    assert.ok(storm.sunIntensity < noon.sunIntensity * .6 && storm.cloudCover > noon.cloudCover);
    assert.ok(storm.fogDensity > noon.fogDensity);
    assert.ok(skyState(225, 300, 'rain').starAmount < midnight.starAmount);
    assert.ok(Math.abs(noon.sunDirection[1] - 1) < 1e-9);
    for (let time = 0; time < 300; time += 7) for (const weather of ['clear', 'rain', 'storm']) {
        const state = skyState(time, 300, weather);
        for (const value of [...state.zenith, ...state.horizon, ...state.sunColor, ...state.cloudColor,
            state.sunIntensity, state.moonIntensity, state.ambientIntensity, state.starAmount, state.cloudCover])
            assert.ok(Number.isFinite(value) && value >= 0 && value <= 1.5, `${weather}@${time}`);
    }
    assert.equal(clockTime(0), '06:00');
    assert.equal(clockTime(75), '12:00');
    assert.equal(clockTime(150), '18:00');
    assert.equal(clockTime(225), '00:00');
    assert.equal(clockTime(299.9), '05:59');
});

test('every expedition opens on a dry first morning', () => {
    for (let time = 0; time < 150; time += 10) assert.equal(weatherAt(1, time), 'clear');
    const later = new Set();
    for (let day = 1; day < 20; day++) for (let time = 150; time < 300; time += 75) later.add(weatherAt(day, time));
    assert.deepEqual([...later].sort(), ['clear', 'rain', 'storm']);
});

test('settings are clamped, persisted and never throw on bad storage', () => {
    assert.deepEqual(normalizeSettings(null), {...DEFAULT_SETTINGS});
    assert.deepEqual(normalizeSettings({volume: 9, muted: 'yes', sensitivity: -3, view: 'sideways'}), {volume: 1, muted: false, sensitivity: .3, view: 'first', quality: 'auto'});
    const items = new Map();
    const storage = {setItem(key, value) { items.set(key, value); }, getItem(key) { return items.get(key) ?? null; }};
    assert.equal(saveSettings({volume: .25, muted: true, sensitivity: 1.8, view: 'overhead'}, storage), true);
    assert.ok(items.has(SETTINGS_KEY));
    assert.deepEqual(loadSettings(storage), {volume: .25, muted: true, sensitivity: 1.8, view: 'overhead', quality: 'auto'});
    assert.deepEqual(loadSettings({getItem() { throw new Error('blocked'); }}), {...DEFAULT_SETTINGS});
    assert.deepEqual(loadSettings({getItem: () => '{not json'}), {...DEFAULT_SETTINGS});
    assert.equal(saveSettings({}, {setItem() { throw new Error('full'); }}), false);
});

test('sound is inert without Web Audio and every cue is well formed', () => {
    const audio = new AudioSystem({}, {volume: .4, muted: false});
    assert.equal(audio.supported, false);
    assert.equal(audio.unlock(), false);
    assert.equal(audio.play('chop'), false);
    assert.doesNotThrow(() => {
        audio.setVolume(2); audio.setMuted(true); audio.suspend(); audio.resume();
        audio.update(.3, {weather: 'storm', night: true}); audio.footsteps({x: 0, z: 0}, true, false);
    });
    assert.equal(audio.volume, 1);
    for (const resource of Object.values(RESOURCES)) assert.ok(SOUNDS[resource.sound], resource.sound);
    for (const [name, voices] of Object.entries(SOUNDS)) {
        assert.ok(voices.length > 0, name);
        for (const voice of voices) {
            assert.ok(voice.d > 0 && voice.g > 0 && voice.g <= 1, name);
            assert.ok(voice.n > 0 || voice.f > 0, name + ' needs a tone or a noise band');
        }
    }
});

test('audio voices are scheduled through a real graph when Web Audio exists', () => {
    const calls = {started: 0, stopped: 0};
    const param = () => ({value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}});
    const node = () => ({connect() {}, start() { calls.started++; }, stop() { calls.stopped++; },
        gain: param(), frequency: param(), Q: param(), type: '', buffer: null, loop: false});
    class FakeContext {
        constructor() { this.currentTime = 0; this.sampleRate = 100; this.state = 'running'; this.destination = {}; }
        createGain() { return node(); } createOscillator() { return node(); }
        createBufferSource() { return node(); } createBiquadFilter() { return node(); }
        createBuffer(channels, length) { return {getChannelData: () => new Float32Array(length)}; }
        resume() {} suspend() {}
    }
    globalThis.AudioContext = FakeContext;
    try {
        const audio = new AudioSystem({}, {volume: .5, muted: false});
        assert.equal(audio.unlock(), true);
        const ambient = calls.started;
        assert.ok(ambient >= 5, 'ambience beds start once');
        assert.equal(audio.unlock(), true);
        assert.equal(calls.started, ambient, 'unlocking twice does not double the ambience');
        assert.equal(audio.play('chop'), true);
        assert.equal(calls.started - ambient, SOUNDS.chop.length);
        assert.equal(audio.play('no-such-sound'), false);
        audio.setMuted(true);
        assert.equal(audio.play('chop'), false);
        audio.setMuted(false);
        assert.doesNotThrow(() => audio.update(.3, {weather: 'rain', night: false, fireDistance: 3}));
        // Footsteps come from distance covered on the ground, not from time.
        const before = calls.started;
        audio.footsteps({x: 0, z: 0}, true, false);
        audio.footsteps({x: 1, z: 0}, true, false);
        assert.equal(calls.started, before);
        audio.footsteps({x: 2.5, z: 0}, true, false);
        assert.equal(calls.started - before, SOUNDS.step.length);
        audio.footsteps({x: 5, z: 0}, false, false);
        audio.footsteps({x: 7.4, z: 0}, false, false);
        assert.equal(calls.started - before, SOUNDS.step.length, 'no footsteps in the air');
    } finally { delete globalThis.AudioContext; }
});
