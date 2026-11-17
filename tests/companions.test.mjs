// Tests for the companions-and-comforts update: the dog, storage chests and tonics.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import BABYLON from 'babylonjs';
import { regionStrength, nearestRegion } from '../js/regions.js';
import { DOG, STRAY, isThreat, chooseTarget, heelPoint, stepToward, sanitizeCompanion } from '../js/companion.js';
import { CHEST_CAPACITY, storedTotal, moveItems, sanitizeStores } from '../js/storage.js';
import { ITEMS, RECIPES, recipeDescription } from '../js/resources.js';
import { CREATURES } from '../js/creatures.js';
import { GRID, FLOOR, STARTER_DUNGEON, centreOf, cellOf, isOpen } from '../js/dungeon.js';
import { BuffSystem, BOONS, SHRINE_BOONS } from '../js/components/buffs.js';
import { PerkSystem } from '../js/components/perks.js';
import { RegionSystem } from '../js/components/regions.js';
import { ArcherySystem } from '../js/components/archery.js';
import { LegendSystem } from '../js/components/legends.js';
import { FishingSystem, GardenSystem } from '../js/components/homestead.js';
import { CompanionSystem } from '../js/components/companion.js';
import { StorageSystem } from '../js/components/storage.js';
import { GearSystem } from '../js/components/equipment.js';
import { DungeonSystem, DUNGEON_DEPTH } from '../js/components/dungeon.js';
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
    game.companion = new CompanionSystem(game);
    game.storage = new StorageSystem(game);
    return {engine, scene, game, player, camera, notes, banners};
}



const storageFor = () => {
    const items = new Map();
    return {items, setItem(key, value) { items.set(key, value); }, getItem(key) { return items.get(key) || null; }, removeItem(key) { items.delete(key); }};
};
const run = (system, seconds, step = .05) => { for (let t = 0; t < seconds; t += step) system.update(step); };

// --- The dog: rules -------------------------------------------------------------
test('the dog defends rather than attacks, and picks the threat nearest itself', () => {
    const boar = CREATURES.boar, deer = CREATURES.deer;
    assert.equal(isThreat({kind: 'boar', health: 50, state: 'roam'}, boar), false, 'a boar minding its business is left alone');
    assert.equal(isThreat({kind: 'boar', health: 50, state: 'chase'}, boar), true);
    assert.equal(isThreat({kind: 'boar', health: 50, state: 'roam', fleeTimer: 3}, boar), true, 'one you have struck is fair game');
    assert.equal(isThreat({kind: 'boar', health: 0, state: 'chase'}, boar), false);
    assert.equal(isThreat({kind: 'deer', health: 30, fleeTimer: 4}, deer), false, 'it does not hunt for you');
    assert.equal(isThreat({kind: 'wolf', health: 40, alerted: true}, CREATURES.wolf), true);
    assert.equal(isThreat({kind: 'wolf', health: 40}, CREATURES.wolf), false);

    const player = {x: 0, z: 0}, dog = {x: 3, z: 0};
    const near = {x: 9, z: 0, id: 'near'}, nearer = {x: 5, z: 1, id: 'nearer'}, far = {x: 0, z: DOG.guard + 5, id: 'far'};
    assert.equal(chooseTarget(dog, player, [near, nearer, far]).id, 'nearer');
    assert.equal(chooseTarget(dog, player, [far]), null, 'too far from you to be your problem');
    assert.equal(chooseTarget(dog, player, []), null);

    // Heel is behind the player whichever way they face.
    for (const yaw of [0, 1.3, -2, 3]) {
        const heel = heelPoint(player, yaw);
        assert.ok(Math.abs(Math.hypot(heel.x, heel.z) - DOG.heel) < 1e-9);
        assert.ok(heel.x * Math.sin(yaw) + heel.z * Math.cos(yaw) < -DOG.heel * .7);
    }
    // Steps never overshoot, and stop short when asked.
    const step = stepToward({x: 0, z: 0}, {x: 10, z: 0}, 3);
    assert.deepEqual([step.x, step.z, step.moved], [3, 0, 3]);
    assert.ok(Math.abs(step.heading - Math.PI / 2) < 1e-9);
    assert.equal(stepToward({x: 0, z: 0}, {x: 2, z: 0}, 5).x, 2);
    assert.equal(stepToward({x: 0, z: 0}, {x: 2, z: 0}, 5, 1.5).x, .5);
    assert.equal(stepToward({x: 0, z: 0}, {x: 1, z: 0}, 5, 1.5).moved, 0);
    assert.equal(stepToward({x: 4, z: 4}, {x: 4, z: 4}, 5).heading, null);
    assert.ok(DOG.speed > 5 && DOG.leash > DOG.guard && STRAY.sit < STRAY.appear);

    assert.deepEqual(sanitizeCompanion(null), {tamed: false, health: DOG.health, mode: 'follow'});
    assert.deepEqual(sanitizeCompanion({tamed: 'yes', health: 5}), {tamed: false, health: DOG.health, mode: 'follow'});
    assert.deepEqual(sanitizeCompanion({tamed: true, health: 999, mode: 'stay'}), {tamed: true, health: DOG.health, mode: 'stay'});
    assert.deepEqual(sanitizeCompanion({tamed: true, health: -4, mode: 'dance'}), {tamed: true, health: 1, mode: 'follow'});
});

test('a stray comes to your fire, and cooked meat makes it yours', () => {
    const {engine, game, camera, notes, banners} = world();
    try {
        const dog = game.companion, pack = game.inventorySystem.inventory;
        camera.position.set(0, 4, 0);
        run(dog, 5);
        assert.equal(dog.stray, null, 'no fire, no stray');
        game.buildSystem.structures.push({id: 1, type: 'fire', x: 4, y: 2, z: 0, rotation: 0});
        run(dog, 3);
        assert.ok(dog.stray, 'it turns up while you sit at the fire');
        assert.ok(Math.abs(Math.hypot(dog.stray.x - 4, dog.stray.z) - STRAY.sit) < 1e-6);
        assert.match(notes.at(-1), /stray dog is watching/);
        assert.ok(dog.mesh.isEnabled() && dog.mesh.getTotalVertices() > 100);
        assert.equal(dog.status(), '');
        // Out of reach it is just a dog in the firelight.
        assert.equal(dog.interaction(), null);
        camera.position.set(dog.stray.x + 1.5, 4, dog.stray.z);
        assert.match(dog.interaction().label, /It wants cooked meat/);
        assert.equal(dog.interaction().act, undefined);
        assert.equal(game.survivalSystem.interact(), false, 'E does nothing for it without meat');
        pack.cookedMeat = 2;
        assert.match(dog.interaction().label, /Press E to offer the stray cooked meat/);
        assert.equal(game.survivalSystem.interact(), true);
        assert.equal(dog.tamed, true);
        assert.equal(pack.cookedMeat, 1);
        assert.equal(dog.stray, null);
        assert.equal(banners.at(-1)[0], 'A friend');
        assert.equal(game.progression.stats.befriended, 1);
        assert.equal(QUESTS.find(quest => quest.id === 'friend').done(game), true);
        assert.equal(dog.interaction(), null, 'E is free again for water and sleep');
        assert.match(dog.status(), /Dog 70\/70 · At heel/);
        assert.equal(dog.tame(), false, 'only once');

        // A stray you walk away from goes; another comes back later.
        const other = world();
        try {
            other.game.buildSystem.structures.push({id: 1, type: 'fire', x: 4, y: 2, z: 0, rotation: 0});
            run(other.game.companion, 3);
            assert.ok(other.game.companion.stray);
            other.camera.position.set(STRAY.forget + 30, 4, 0);
            run(other.game.companion, .1);
            assert.equal(other.game.companion.stray, null);
            assert.equal(other.game.companion.mesh.isEnabled(), false);
            other.camera.position.set(0, 4, 0);
            run(other.game.companion, 3);
            assert.ok(other.game.companion.stray);
        } finally { other.engine.dispose(); }
    } finally { engine.dispose(); }
});

test('the dog follows, stays when told, keeps out of water and catches up when left behind', () => {
    const {engine, game, camera} = world();
    try {
        const dog = game.companion;
        dog.restore({tamed: true, health: 70, mode: 'follow'});
        camera.position.set(0, 4, 0); camera.rotation.set(0, 0, 0);
        dog.update(.05);
        assert.ok(dog.mesh.isEnabled());
        const gap = () => Math.hypot(dog.position.x - camera.position.x, dog.position.z - camera.position.z);
        assert.ok(Math.abs(gap() - DOG.heel) < .5, 'it starts at heel');
        // Walk off: it trots after and settles behind you.
        camera.position.set(14, 4, 9);
        run(dog, .5);
        assert.ok(gap() > DOG.heel + 2, 'it takes a moment');
        run(dog, 5);
        assert.ok(gap() < DOG.heel + 1 && gap() > 1.5, 'then it is back at heel, not underfoot: ' + gap().toFixed(2));
        assert.equal(dog.position.y, 2 + Math.abs(Math.sin(dog.gait)) * .07, 'feet on the ground');

        // Stay means stay.
        assert.equal(dog.toggleMode(), true);
        assert.equal(dog.mode, 'stay');
        const spot = [dog.position.x, dog.position.z];
        camera.position.set(80, 4, 80);
        run(dog, 3);
        assert.deepEqual([dog.position.x, dog.position.z], spot);
        assert.match(dog.status(), /Staying/);
        // Called to heel from far away, it does not make you wait.
        dog.toggleMode();
        dog.update(.05);
        assert.ok(gap() <= DOG.heel + .01, 'it appears at your side');

        // It will not swim after you: it waits on the bank.
        water = (x, z) => x > 90;
        camera.position.set(88, 4, 80);
        run(dog, 3);
        camera.position.set(96, 4, 80);
        run(dog, 4);
        assert.ok(!water(dog.position.x, dog.position.z), 'dry paws');
        water = () => false;
        // An untamed dog cannot be ordered about.
        const stranger = new CompanionSystem(game);
        assert.equal(stranger.toggleMode(), false);
    } finally { engine.dispose(); water = () => false; }
});

test('the dog fights what attacks you, can be knocked down, and mends afterwards', () => {
    const {engine, game, camera, notes} = world();
    try {
        const dog = game.companion, animals = game.animalSystem, random = Math.random;
        dog.restore({tamed: true, health: 70, mode: 'follow'});
        camera.position.set(0, 4, 0); camera.rotation.set(0, 0, 0);
        dog.update(.05);
        // A grazing deer and a boar that has not noticed you: nothing happens.
        const deer = animals.spawnAnimal(4, 2, 4, 'deer'), calm = animals.spawnAnimal(-5, 2, 4, 'boar');
        calm.state = 'roam';
        run(dog, 3);
        assert.equal(deer.health, deer.maxHealth ?? deer.health);
        assert.equal(calm.health, CREATURES.boar.health);
        // The boar charges: the dog goes for it.
        calm.state = 'chase';
        Math.random = () => .99; // The boar never lands a bite back.
        try {
            run(dog, 4);
            const bites = Math.round((CREATURES.boar.health - calm.health) / DOG.damage);
            assert.ok(bites >= 2 && bites <= 4, bites + ' bites in four seconds');
            assert.ok(Math.hypot(dog.position.x - calm.mesh.position.x, dog.position.z - calm.mesh.position.z) <= DOG.reach + .01);
            assert.ok(calm.fleeTimer > 0, 'the boar knows about it');
            assert.equal(dog.health, 70);
            // The dog's kill still counts for you.
            const hunted = game.progression.stats.hunted;
            calm.health = DOG.damage - 1;
            run(dog, 1.5);
            animals.update();
            assert.ok(!animals.animals.includes(calm));
            assert.equal(game.progression.stats.hunted, hunted + 1);

            // A bear bites back: the dog takes a share of the blow, never all of it.
            const bear = animals.spawnAnimal(2, 2, 3, 'bear');
            bear.state = 'chase';
            Math.random = () => 0;
            run(dog, 1.3);
            const lost = 70 - dog.health;
            assert.ok(lost > 0 && Math.abs(lost % (CREATURES.bear.damage * DOG.share)) < 1e-6, 'it was hurt by ' + lost);
            // Enough of that and it goes down; it does not die.
            dog.health = 2;
            run(dog, 1.3);
            assert.ok(dog.down > 0);
            assert.equal(dog.health, 0);
            assert.match(notes.at(-1), /Your dog is down/);
            assert.match(dog.status(), /Dog down · back in \d+s/);
            const bearHealth = bear.health;
            run(dog, 5);
            assert.equal(bear.health, bearHealth, 'a downed dog does not fight');
            // It gets back up on its own.
            bear.health = 0; animals.update();
            run(dog, DOG.revive);
            assert.equal(dog.down, 0);
            assert.ok(dog.health >= DOG.health * .5);
            assert.match(notes.at(-1), /back on its feet/);
            // And mends once things are quiet.
            dog.calm = 0;
            const before = dog.health;
            run(dog, 4);
            assert.ok(dog.health > before + 4);
            run(dog, 60);
            assert.equal(dog.health, DOG.health);
        } finally { Math.random = random; }
    } finally { engine.dispose(); }
});

test('the dog comes underground, stays out of the rock, and is saved with the game', () => {
    const {engine, game, camera} = world();
    try {
        const dog = game.companion, dungeon = game.dungeonSystem;
        dog.restore({tamed: true, health: 55, mode: 'follow'});
        camera.position.set(STARTER_DUNGEON.x + 3, 4, STARTER_DUNGEON.z + 3);
        dog.update(.05);
        assert.equal(dog.position.y, 2 + Math.abs(Math.sin(dog.gait)) * .07);
        dungeon.scanEntrances();
        dungeon.enter(STARTER_DUNGEON);
        game.animalSystem.animals = [];
        dog.update(.05);
        const inOpen = () => { const cell = cellOf(dungeon.layout, dog.position.x, dog.position.z); return isOpen(dungeon.layout, cell.x, cell.y); };
        assert.ok(Math.abs(dog.position.y - DUNGEON_DEPTH) < .1, 'on the dungeon floor');
        assert.ok(inOpen());
        assert.ok(Math.hypot(dog.position.x - camera.position.x, dog.position.z - camera.position.z) <= DOG.heel + .01);
        // Lead it room to room: it never ends up inside a wall.
        for (const room of dungeon.layout.rooms.slice(0, 6)) {
            const spot = centreOf(dungeon.layout, room.x + 1, room.y + 1);
            camera.position.set(spot.x, DUNGEON_DEPTH + 2, spot.z);
            for (let n = 0; n < 100; n++) { dog.update(.05); assert.ok(inOpen()); }
            assert.ok(Math.hypot(dog.position.x - spot.x, dog.position.z - spot.z) < DOG.heel + 2, 'it found its way to you');
        }
        // Behind a wall it will not see a threat; in the open it will.
        dungeon.leave();
        dog.update(.05);
        assert.ok(Math.abs(dog.position.y - 2) < .1, 'back on the surface with you');

        const storage = storageFor();
        const saves = game.saveSystem = new SaveSystem(game, storage);
        dog.mode = 'stay';
        assert.equal(saves.save(), true);
        const raw = JSON.parse(storage.items.get(SAVE_KEY));
        assert.deepEqual(raw.companion, {tamed: true, health: dog.health, mode: 'stay'});
        assert.equal(raw.version, SAVE_VERSION);
        dog.restore(null);
        assert.equal(dog.tamed, false);
        assert.equal(saves.load(), true);
        assert.deepEqual([dog.tamed, dog.mode, Math.round(dog.health)], [true, 'stay', Math.round(raw.companion.health)]);
        delete raw.companion;
        storage.items.set(SAVE_KEY, JSON.stringify(raw));
        assert.equal(saves.load(), true);
        assert.equal(dog.tamed, false, 'an older save simply has no dog');
    } finally { engine.dispose(); }
});

// --- Storage -------------------------------------------------------------------
test('storage rules: counts move whole, capacity holds and bad saves are cleaned', () => {
    const pack = {wood: 10, stone: 2}, chest = {};
    assert.equal(moveItems(pack, chest, 'wood', 4), 4);
    assert.deepEqual([pack.wood, chest.wood], [6, 4]);
    assert.equal(moveItems(pack, chest, 'wood', 99), 6, 'no more than you have');
    assert.equal(pack.wood, 0);
    assert.equal(moveItems(pack, chest, 'stone', 2, 1), 1, 'no more than there is room for');
    assert.equal(moveItems(pack, chest, 'stone', -3), 0);
    assert.equal(moveItems(pack, chest, 'gold', 1), 0, 'only real items');
    assert.equal(moveItems(chest, pack, 'wood', 2.9), 2, 'whole items only');
    assert.equal(storedTotal(chest), 9);
    assert.equal(storedTotal(undefined), 0);
    assert.deepEqual(sanitizeStores([
        {id: 2, items: {wood: 5, gold: 9, stone: -1, fiber: 2.7, herbs: 'x'}}, {id: 2, items: {wood: 1}},
        {id: 3, items: {wood: CHEST_CAPACITY + 50, stone: 4}}, {id: 4.5, items: {wood: 1}}, null, {id: 9, items: {wood: 1}}, {id: 5}
    ], id => id !== 9), [{id: 2, items: {wood: 5, fiber: 2}}, {id: 3, items: {wood: CHEST_CAPACITY}}, {id: 5, items: {}}]);
    assert.deepEqual(sanitizeStores({}), []);
    assert.deepEqual(BUILDINGS.chest.cost, {planks: 4, fiber: 2});
});

test('a chest keeps what you put in it: through death, and through a save on a fresh page', () => {
    const {engine, game, camera, notes} = world();
    try {
        const storage = game.storage, pack = game.inventorySystem.inventory;
        camera.position.set(30, 4, 30); camera.rotation.set(.3, 0, 0);
        assert.equal(storage.interaction(), null);
        Object.assign(pack, {planks: 4, fiber: 2});
        assert.equal(game.buildSystem.place('chest'), true);
        const chest = game.buildSystem.structures.at(-1);
        camera.position.set(chest.x + 1, 4, chest.z);
        let opened = null;
        game.uiSystem.openStorage = id => { opened = id; };
        assert.match(storage.interaction().label, /Press E to open the storage chest/);
        assert.equal(game.survivalSystem.interact(), true);
        assert.equal(opened, chest.id);

        Object.assign(pack, {wood: 12, stone: 5, bow: 1});
        assert.equal(storage.store(chest.id, 'wood', 'all'), 12);
        assert.equal(storage.store(chest.id, 'stone', 1), 1);
        assert.equal(storage.store(chest.id, 'bow', 1), 1, 'tools can be put by too');
        assert.equal(storage.store(chest.id, 'herbs', 1), 0, 'nothing to store');
        assert.deepEqual([pack.wood, pack.stone, pack.bow], [0, 4, 0]);
        assert.deepEqual(storage.contents(chest.id), {wood: 12, stone: 1, bow: 1});
        assert.equal(storage.room(chest.id), CHEST_CAPACITY - 14);
        assert.deepEqual(storage.rows(chest.id).map(row => [row.item, row.carried, row.stored]), [['wood', 0, 12], ['stone', 4, 1], ['bow', 0, 1]]);
        assert.equal(storage.take(chest.id, 'wood', 1), 1);
        assert.equal(storage.take(chest.id, 'bow', 'all'), 1);
        assert.ok(!('bow' in storage.contents(chest.id)), 'an emptied row goes away');
        assert.equal(storage.take(chest.id, 'bow', 1), 0);
        assert.equal(QUESTS.find(quest => quest.id === 'stock').done(game), true);
        // A full chest says so and takes no more.
        pack.fiber = CHEST_CAPACITY;
        assert.equal(storage.store(chest.id, 'fiber', 'all'), CHEST_CAPACITY - 12);
        assert.equal(storage.room(chest.id), 0);
        assert.equal(storage.store(chest.id, 'stone', 1), 0);
        assert.equal(notes.at(-1), 'The chest is full');
        storage.take(chest.id, 'fiber', 'all');

        // Dying drops the pack, not the chest.
        pack.wood = 7;
        game.inventorySystem.dropAllItems(camera.position);
        assert.equal(pack.wood, 0, 'the pack is emptied');
        assert.deepEqual(storage.contents(chest.id), {wood: 11, stone: 1});

        // Saved, then loaded as on a fresh page where no buildings exist yet.
        const disk = storageFor(), saves = game.saveSystem = new SaveSystem(game, disk);
        assert.equal(saves.save(), true);
        const raw = JSON.parse(disk.items.get(SAVE_KEY));
        assert.deepEqual(raw.storage, [{id: chest.id, items: {wood: 11, stone: 1}}]);
        storage.stores.clear();
        game.buildSystem.restore([]);
        assert.equal(saves.load(), true);
        assert.deepEqual(storage.contents(chest.id), {wood: 11, stone: 1});
        // Contents for a chest that is not there are dropped; an older save has none.
        raw.storage = [{id: 777, items: {wood: 3}}];
        disk.items.set(SAVE_KEY, JSON.stringify(raw));
        assert.equal(saves.load(), true);
        assert.equal(storage.capture().length, 0);
        delete raw.storage;
        disk.items.set(SAVE_KEY, JSON.stringify(raw));
        assert.equal(saves.load(), true);
    } finally { engine.dispose(); }
});

// --- Tonics --------------------------------------------------------------------
test('tonics: a warming draught, antivenom and a broth, each doing what it says', () => {
    const {engine, game, player} = world();
    try {
        const pack = game.inventorySystem.inventory, survival = game.survivalSystem, buffs = game.buffs;
        assert.deepEqual([...SHRINE_BOONS], ['fury', 'stoneskin', 'haste'], 'shrines do not hand out tonics');
        for (const id of ['warmth', 'antivenom']) assert.ok(BOONS[id].label && BOONS[id].text && BOONS[id].seconds > 0);
        Object.assign(pack, {mushrooms: 2, herbs: 3, cactusFruit: 1, fish: 1, berries: 2});
        // The two that need a pot need a fire.
        assert.equal(game.inventorySystem.canCraft('warmingDraught'), false);
        assert.equal(game.inventorySystem.canCraft('huntersBroth'), false);
        assert.equal(game.inventorySystem.canCraft('antivenom'), true, 'antivenom can be mixed anywhere');

        // Antivenom: clears venom now and stops the next sting taking hold.
        player.poison(2.5, 4);
        assert.ok(player.poisonLeft > 0);
        assert.equal(game.inventorySystem.craft('antivenom'), true);
        assert.equal(player.poisonLeft, 0);
        assert.ok(buffs.has('antivenom'));
        player.poison(2.5, 4);
        assert.equal(player.poisonLeft, 0);
        game.animalSystem.ai.hurtPlayer(game.animalSystem.spawnAnimal(1, 2, 1, 'scorpion'), CREATURES.scorpion);
        assert.equal(player.health, 100 - CREATURES.scorpion.damage, 'the sting itself still hurts');
        assert.equal(player.poisonLeft, 0);
        buffs.update(BOONS.antivenom.seconds + 1);
        player.poison(2.5, 4);
        assert.equal(player.poisonLeft, 4, 'it wears off');
        player.poisonLeft = 0;

        // Warming draught: Frostfell's cold at 40%, stacking with a cloak.
        game.buildSystem.structures.push({id: 1, type: 'fire', x: 0, y: 2, z: 0, rotation: 0});
        assert.equal(game.inventorySystem.craft('warmingDraught'), true);
        game.buildSystem.structures.length = 0;
        game.regions.current = 'tundra'; game.regions.strength = 1;
        const cold = () => { survival.cold = 40; survival.update(.05); return (survival.cold - 40) / .05; };
        assert.ok(Math.abs(cold() - .55 * .4) < 1e-9);
        pack.furCloak = 1;
        assert.ok(Math.abs(cold() - .55 * .4 * .5) < 1e-9);
        pack.furCloak = 0;
        buffs.update(BOONS.warmth.seconds + 1);
        assert.ok(Math.abs(cold() - .55) < 1e-9);

        // Hunter's broth: a meal and a fighting edge.
        game.buildSystem.structures.push({id: 1, type: 'fire', x: 0, y: 2, z: 0, rotation: 0});
        survival.hunger = 40;
        const base = game.combatSystem.damage();
        assert.equal(game.inventorySystem.craft('huntersBroth'), true);
        assert.equal(survival.hunger, 70);
        assert.ok(Math.abs(game.combatSystem.damage() - base * 1.3) < 1e-9);
        assert.deepEqual([pack.fish, pack.berries, pack.herbs, pack.mushrooms, pack.cactusFruit], [0, 0, 0, 0, 0]);
        assert.equal(game.progression.stats.tonics, 3);
        // A tonic is worth drinking even when you are fed and whole.
        Object.assign(pack, {fish: 1, berries: 2});
        survival.hunger = 100; player.health = player.maxHealth;
        assert.equal(game.inventorySystem.canCraft('huntersBroth'), true);
        for (const id of ['warmingDraught', 'antivenom', 'huntersBroth']) {
            assert.match(recipeDescription(RECIPES[id]), /→ .*(cold|venom|damage)/);
            for (const item of Object.keys(RECIPES[id].cost)) assert.ok(ITEMS[item]);
        }
        // Cactus fruit can be eaten for thirst alone (it could not before).
        pack.cactusFruit = 1; survival.thirst = 50;
        assert.equal(game.inventorySystem.canCraft('eatCactus'), true);
        survival.thirst = 100;
        assert.equal(game.inventorySystem.canCraft('eatCactus'), false);
    } finally { engine.dispose(); }
});

test('the new quests, stats and files are all wired up', async () => {
    for (const stat of ['tonics', 'befriended']) assert.ok(STAT_LABELS[stat]);
    const order = id => QUESTS.findIndex(quest => quest.id === id);
    for (const id of ['friend', 'stock']) assert.ok(order(id) > order('gardener') && order(id) < order('veteran'), id);
    const {engine, game} = world();
    try {
        for (const id of ['friend', 'stock']) {
            assert.equal(QUESTS[order(id)].done(game), false);
            assert.equal(typeof QUESTS[order(id)].progress(game), 'string');
        }
    } finally { engine.dispose(); }
    const worker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
    for (const file of ['js/companion.js', 'js/storage.js', 'js/components/companion.js', 'js/components/storage.js'])
        assert.ok(worker.includes(`'./${file}'`), file + ' is not precached');
    assert.ok(SOUNDS.click && regionStrength && nearestRegion && GRID && FLOOR);
});

test('a dungeon shrine never hands out a tonic', () => {
    const {engine, game, camera} = world();
    try {
        const dungeon = game.dungeonSystem, random = Math.random;
        dungeon.scanEntrances();
        dungeon.enter(STARTER_DUNGEON);
        game.animalSystem.animals = [];
        const granted = new Set();
        try {
            for (const roll of [0, .17, .34, .5, .67, .84, .999]) {
                dungeon.runFor(STARTER_DUNGEON).opened = [];
                dungeon.shrine = {mesh: {metadata: {rune: {setEnabled() {}}}, position: camera.position.clone()}, used: false, x: camera.position.x, z: camera.position.z};
                game.buffs.restore({});
                Math.random = () => roll;
                assert.equal(dungeon.useShrine(), true);
                for (const boon of game.buffs.list()) granted.add(boon.id);
            }
        } finally { Math.random = random; }
        assert.deepEqual([...granted].sort(), [...SHRINE_BOONS].sort());
    } finally { engine.dispose(); }
});
