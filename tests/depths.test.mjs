// Tests for dungeons, creatures and graded loot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import BABYLON from 'babylonjs';
import {
    RARITIES, SLOTS, STATS, rarityIndex, rollGear, gearScore, gradeForScore, totalStats, sanitizeGear,
    salvageValue, statUnit, describeStat
} from '../js/gear.js';
import {
    GRID, CELL, FLOOR, FLOORS, RESET_DAYS, STARTER_DUNGEON, dungeonForCell, dungeonsNear, dungeonEpoch,
    daysUntilReset, floorSeed, generateFloor, flowField, cellOf, centreOf, isOpen, resolveCircle, lineOfSight
} from '../js/dungeon.js';
import { CREATURES, scaleFor } from '../js/creatures.js';
import { seededRandom } from '../js/models/wilderness.js';
import { createCreatureModel, createChestModel, createEntranceModel, createBrazierModel, createStairsModel, createGearDropModel } from '../js/models/creatures.js';
import { GearSystem, BAG_SIZE } from '../js/components/equipment.js';
import { DungeonSystem, DUNGEON_DEPTH, CEILING } from '../js/components/dungeon.js';
import { AnimalSystem } from '../js/components/animals.js';
import { InventorySystem } from '../js/components/inventory.js';
import { CombatSystem } from '../js/components/combat.js';
import { PlayerSystem } from '../js/components/player.js';
import { SurvivalSystem } from '../js/components/survival.js';
import { BuildingSystem } from '../js/components/building.js';
import { ProgressionSystem, QUESTS } from '../js/components/progression.js';
import { SaveSystem, SAVE_KEY } from '../js/components/save.js';
import { SOUNDS } from '../js/components/audio.js';

globalThis.BABYLON = BABYLON;
const ORDER = RARITIES.map(rarity => rarity.id);

// A whole game with real systems and a stub world, run on the headless engine.
function world() {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    const notes = [];
    const game = {
        scene, paused: false, dayTime: 60, dayLength: 300, dayCount: 1,
        engine,
        uiSystem: {
            notes, showNotification(message) { notes.push(message); }, showLoot(item, verb) { notes.push(verb + ' ' + item.name); },
            updateInventoryUI() {}, updateExperienceUI() {}, updateHealthUI() {}, updateGearUI() {},
            showLevelUpMessage() {}, setSaveStatus() {}, showDayBanner() {}, showGatherProgress() {}
        },
        terrainSystem: {
            waterHeight: 1, getPerlinHeight: () => 2, isWaterArea: () => false, isWithinSpawnArea: () => false,
            harvestedIds: new Set(), harvestedOn: new Map(), chunkMap: new Map(), checkChunkUpdates() {},
            expireRegrown() { return []; }
        },
        explorationSystem: {discovered: new Set(), isClearing: () => false},
        registerModelShadow() {}
    };
    engine.getDeltaTime = () => 50; // A steady 20 simulation steps a second.
    const player = game.playerSystem = Object.create(PlayerSystem.prototype);
    Object.assign(player, {
        game, isDead: false, health: 100, maxHealth: 100, oxygenLevel: 100, maxOxygen: 100,
        isGrounded: true, isFlying: false, isSwimming: false, isUnderwater: false, isJumping: false,
        jumpVelocity: 0, jumpHeight: .22, gravity: .012, jumpCount: 0, jumpTimer: 0, jumpTimerThreshold: 300,
        canDoubleJump: false, swimSpeed: .15, swimDepth: 1.25, surfaceOffset: .35, oxygenDepletionRate: .2,
        oxygenRefillRate: .5, slowDamage: 0, lastDamageCause: '', keys: {jump: false, descend: false, sprint: false},
        camera: {position: new BABYLON.Vector3(STARTER_DUNGEON.x + 3, 4, STARTER_DUNGEON.z + 3), rotation: new BABYLON.Vector3(0, 0, 0), speed: 0}
    });
    scene.getAnimationRatio = () => 1;
    game.inventorySystem = new InventorySystem(game);
    game.combatSystem = new CombatSystem(game);
    game.survivalSystem = new SurvivalSystem(game);
    game.buildSystem = new BuildingSystem(game);
    game.progression = new ProgressionSystem(game);
    game.gear = new GearSystem(game);
    game.dungeonSystem = new DungeonSystem(game);
    game.animalSystem = new AnimalSystem(game);
    return {engine, scene, game, player, notes};
}
const item = (slot, stats, extra = {}) => ({id: 't' + Math.random().toString(36).slice(2), slot, level: 1, name: 'Test ' + slot, rarity: gradeForScore(gearScore({stats, level: extra.level || 1})), stats, ...extra});

// --- Loot ---------------------------------------------------------------
test('rarity is graded from the bonuses an item rolled, never assigned on its own', () => {
    const random = seededRandom(20261116);
    const best = Object.fromEntries(ORDER.map(id => [id, {low: Infinity, high: -Infinity, count: 0}]));
    for (let n = 0; n < 4000; n++) {
        const gear = rollGear(random, {level: 1 + n % 8, luck: (n % 5) * .2});
        const score = gearScore(gear);
        assert.equal(gear.rarity, gradeForScore(score), gear.name);
        assert.ok(SLOTS[gear.slot] && gear.name.length > 2 && gear.level >= 1);
        const stats = Object.entries(gear.stats);
        assert.ok(stats.length >= 1 && stats.length <= 4);
        for (const [stat, value] of stats) assert.ok(STATS[stat] && value > 0, stat);
        const seen = best[gear.rarity];
        seen.low = Math.min(seen.low, score); seen.high = Math.max(seen.high, score); seen.count++;
    }
    // Every grade appears, and a higher grade always carries more than a lower one.
    for (let grade = 1; grade < ORDER.length; grade++) {
        assert.ok(best[ORDER[grade]].count > 0, ORDER[grade] + ' never rolled');
        assert.ok(best[ORDER[grade]].low >= best[ORDER[grade - 1]].high - 1e-9, ORDER[grade] + ' overlaps the grade below');
        assert.ok(best[ORDER[grade]].low >= RARITIES[grade].score);
    }
    assert.equal(gradeForScore(0), 'common');
    assert.equal(gradeForScore(99), 'legendary');
});

test('good loot is scarce, luck improves the odds, and boss loot has a floor', () => {
    const tally = luck => {
        const random = seededRandom(77 + Math.round(luck * 100)), counts = Object.fromEntries(ORDER.map(id => [id, 0]));
        for (let n = 0; n < 6000; n++) counts[rollGear(random, {level: 3, luck}).rarity]++;
        return counts;
    };
    const plain = tally(0), lucky = tally(1);
    assert.ok(plain.common > plain.uncommon && plain.uncommon > plain.rare && plain.rare > plain.epic && plain.epic > plain.legendary);
    assert.ok(plain.legendary > 0 && plain.legendary < 6000 * .03, 'legendaries stay under 3%');
    assert.ok(plain.common > 6000 * .4);
    assert.ok(lucky.common < plain.common && lucky.epic + lucky.legendary > plain.epic + plain.legendary);
    const random = seededRandom(5);
    for (const minimum of ['rare', 'epic', 'legendary']) for (let n = 0; n < 300; n++) {
        const gear = rollGear(random, {level: 1 + n % 5, minRarity: minimum});
        assert.ok(rarityIndex(gear.rarity) >= rarityIndex(minimum), `${gear.rarity} below ${minimum}`);
    }
});

test('items carry their slot signature, scale with level and total up under caps', () => {
    const random = seededRandom(9);
    for (let n = 0; n < 200; n++) {
        assert.ok(rollGear(random, {slot: 'weapon'}).stats.power > 0);
        assert.ok(rollGear(random, {slot: 'armor'}).stats.vitality > 0);
        assert.ok(rollGear(random, {slot: 'boots'}).stats.swiftness > 0);
    }
    assert.ok(statUnit('power', 10) > statUnit('power', 1) * 3, 'flat bonuses grow with level');
    assert.ok(statUnit('armor', 10) < statUnit('armor', 1) * 1.5, 'percentages barely grow');
    const average = level => { const roll = seededRandom(3); let sum = 0; for (let n = 0; n < 400; n++) sum += rollGear(roll, {slot: 'weapon', level}).stats.power; return sum / 400; };
    assert.ok(average(8) > average(1) * 2);
    // Same seed, same item (apart from its unique id).
    const a = rollGear(seededRandom(42), {level: 4}), b = rollGear(seededRandom(42), {level: 4});
    assert.deepEqual({...a, id: 0}, {...b, id: 0});
    assert.notEqual(a.id, b.id);
    const worn = {armor: item('armor', {armor: 50}), boots: item('boots', {armor: 40, swiftness: 90}), charm: null};
    const total = totalStats(worn);
    assert.equal(total.armor, STATS.armor.cap);
    assert.equal(total.swiftness, STATS.swiftness.cap);
    assert.equal(total.power, 0);
    assert.equal(describeStat('crit', 8), '+8% Critical chance');
    assert.equal(describeStat('leech', 1.5), '+1.5 Health per hit');
    assert.ok(salvageValue(item('weapon', {power: 40})).xp > salvageValue(item('weapon', {power: 2})).xp);
});

test('gear read from a save is re-graded and stripped of anything invalid', () => {
    const forged = sanitizeGear({id: 'x1', slot: 'weapon', level: 2, rarity: 'legendary', name: '<b>Blade</b>', stats: {power: 3}});
    assert.equal(forged.rarity, 'common', 'a save cannot claim a grade its stats do not earn');
    const absurd = sanitizeGear({slot: 'armor', level: 1, stats: {armor: 1e9, vitality: -4, nonsense: 5, warmth: NaN}});
    assert.deepEqual(Object.keys(absurd.stats), ['armor']);
    assert.ok(absurd.stats.armor <= statUnit('armor', 1) * 3);
    assert.equal(absurd.level, 1);
    for (const junk of [null, 7, {}, {slot: 'hat', stats: {power: 1}}, {slot: 'weapon', stats: {}}, {slot: 'weapon', stats: {power: 0}}])
        assert.equal(sanitizeGear(junk), null);
    const real = rollGear(seededRandom(8), {level: 5, luck: 1});
    assert.deepEqual(sanitizeGear(JSON.parse(JSON.stringify(real))), real);
});

test('found gear fills empty slots, swaps on equip and changes what the player can do', () => {
    const {engine, game, player} = world();
    try {
        const gear = game.gear, combat = game.combatSystem;
        const blade = item('weapon', {power: 6, crit: 100, leech: 4, haste: 50});
        assert.equal(gear.add(blade), true);
        assert.equal(gear.equipped.weapon, blade, 'the first weapon found is equipped at once');
        assert.equal(combat.damage(), 16);
        assert.equal(combat.cooldown(450), 300);
        assert.ok(Math.abs(game.inventorySystem.swingCooldown() - 220) < 1e-9);

        // A guaranteed critical hit doubles the blow and the leech heals.
        const deer = {kind: 'deer', health: 100, mesh: {position: new BABYLON.Vector3(0, 0, 0), scaling: {y: 1}, isDescendantOf: () => false}};
        game.animalSystem.animals = [deer];
        game.pickTarget = () => ({hit: true, pickedMesh: deer.mesh, pickedPoint: null});
        player.health = 50;
        assert.equal(game.gear.stat('crit'), STATS.crit.cap, 'critical chance is capped');
        const realRandom = Math.random;
        Math.random = () => 0; // Force the roll under the critical chance.
        try { assert.equal(combat.tryAttack(), true); } finally { Math.random = realRandom; }
        assert.equal(deer.health, 68);
        assert.equal(player.health, 54);
        assert.equal(combat.targeted(), deer);

        // A second weapon goes to the bag; equipping swaps the two.
        const club = item('weapon', {power: 2});
        gear.add(club);
        assert.deepEqual(gear.bag, [club]);
        assert.equal(gear.isUpgrade(club), false);
        assert.equal(gear.equip(club.id), true);
        assert.equal(gear.equipped.weapon, club);
        assert.deepEqual(gear.bag, [blade]);
        assert.equal(combat.damage(), 12);
        assert.equal(gear.isUpgrade(blade), true);

        // Armour: bonus health comes and goes without ever killing the wearer.
        const plate = item('armor', {vitality: 40, armor: 50});
        gear.add(plate);
        assert.equal(player.maxHealth, 140);
        assert.equal(player.health, 94);
        player.takeDamage(20, 'a wolf');
        assert.equal(player.health, 84, 'armour halves a blow');
        player.takeDamage(10, 'starvation');
        assert.equal(player.health, 74, 'armour does nothing against hunger');
        player.health = 130;
        assert.equal(gear.unequip('armor'), true);
        assert.equal(player.maxHealth, 100);
        assert.equal(player.health, 100);

        // Experience bonus applies to everything earned.
        gear.add(item('charm', {fortune: 50}));
        const before = combat.experience;
        combat.gainExperience(20);
        assert.equal(combat.experience - before, 30);
    } finally { engine.dispose(); }
});

test('boots and cloaks change movement and survival', () => {
    const {engine, game, player} = world();
    try {
        player.update();
        const base = player.camera.speed;
        game.gear.add(item('boots', {swiftness: 25, endurance: 50, warmth: 50}));
        player.update();
        assert.ok(Math.abs(player.camera.speed - base * 1.25) < 1e-9);
        const survival = game.survivalSystem;
        const drain = () => { survival.hunger = 100; survival.thirst = 100; survival.cold = 10; survival.update(.05); return [100 - survival.hunger, 100 - survival.thirst, survival.cold - 10]; };
        game.dayTime = 220; // Night, in the open.
        const worn = drain();
        game.gear.unequip('boots');
        const bare = drain();
        for (let n = 0; n < 3; n++) assert.ok(Math.abs(worn[n] - bare[n] * .5) < 1e-9, 'half the drain with 50% bonuses');
    } finally { engine.dispose(); }
});

test('a full bag breaks new finds down, salvage pays out, and gear survives a save', () => {
    const {engine, game, notes} = world();
    try {
        const gear = game.gear;
        gear.add(item('weapon', {power: 3}));
        for (let n = 0; n < BAG_SIZE; n++) gear.add(item('weapon', {power: 1}), false);
        assert.equal(gear.bag.length, BAG_SIZE);
        const xp = game.combatSystem.experience;
        assert.equal(gear.add(item('weapon', {power: 9})), false);
        assert.equal(gear.bag.length, BAG_SIZE);
        assert.ok(game.combatSystem.experience > xp);
        assert.match(notes.at(-1), /Gear bag full/);
        const rare = item('charm', {fortune: 6, crit: 4, vitality: 10});
        assert.equal(rare.rarity, 'rare');
        gear.bag[0] = rare;
        const iron = game.inventorySystem.inventory.iron;
        assert.equal(gear.salvage(rare.id), true);
        assert.equal(game.inventorySystem.inventory.iron, iron + 1);
        assert.equal(gear.salvage('missing'), false);
        assert.equal(gear.salvageBelow('rare'), BAG_SIZE - 1);
        assert.equal(gear.bag.length, 0);

        gear.add(item('armor', {vitality: 30}));
        gear.add(item('armor', {vitality: 5}), false);
        const saved = JSON.parse(JSON.stringify(gear.capture()));
        const fresh = new GearSystem(game);
        game.playerSystem.maxHealth = 100;
        saved.bag.push({slot: 'weapon', stats: {}}, saved.bag[0]);
        fresh.restore(saved);
        assert.equal(fresh.equipped.armor.stats.vitality, 30);
        assert.equal(fresh.equipped.weapon.stats.power, 3);
        assert.equal(fresh.bag.length, 2, 'invalid entries are dropped, duplicates kept apart');
        assert.notEqual(fresh.bag[0].id, fresh.bag[1].id);
        assert.equal(game.playerSystem.maxHealth, 130);
        // A load always resets the player's own maximum first, then gear adds to it.
        game.playerSystem.maxHealth = 100;
        fresh.restore(null);
        assert.equal(game.playerSystem.maxHealth, 100);
        assert.deepEqual(Object.values(fresh.equipped), [null, null, null, null]);
    } finally { engine.dispose(); }
});

test('gear on the ground is picked up by walking over it', () => {
    const {engine, game, player, scene} = world();
    try {
        const gear = game.gear, start = scene.meshes.length;
        const dropped = gear.dropRoll(new BABYLON.Vector3(20, 2, 20), {level: 2});
        assert.equal(gear.drops.length, 1);
        assert.ok(scene.meshes.length > start);
        gear.update(1);
        assert.equal(gear.drops.length, 1, 'too far away');
        player.camera.position.set(20.5, 4, 20.5);
        gear.update(.1);
        assert.equal(gear.drops.length, 0);
        assert.equal(gear.equipped[dropped.slot], dropped);
        assert.equal(scene.meshes.length, start, 'the gem is cleaned up');
        assert.equal(game.progression.stats.gearFound, 1);
    } finally { engine.dispose(); }
});

// --- Dungeon layout -------------------------------------------------------
test('every generated floor is fully connected and holds what a run needs', () => {
    for (let seed = 1; seed <= 60; seed++) for (let floor = 1; floor <= FLOORS; floor++) {
        const layout = generateFloor(floorSeed('dungeon:test', seed, floor), floor);
        const label = `seed ${seed} floor ${floor}`;
        assert.ok(layout.rooms.length >= 6, label + ' has too few rooms');
        // Solid rock all the way round.
        for (let n = 0; n < GRID; n++) for (const [x, y] of [[n, 0], [n, GRID - 1], [0, n], [GRID - 1, n]]) assert.equal(isOpen({...layout}, x, y), false, label);
        // Every walkable cell can be reached from the entry.
        const field = flowField(layout.grid, layout.start.x, layout.start.y);
        let open = 0;
        for (let n = 0; n < GRID * GRID; n++) {
            if (layout.grid[n] !== FLOOR) continue;
            open++;
            assert.ok(field[n] >= 0, label + ' has an unreachable cell');
        }
        assert.ok(open > 90 && open < GRID * GRID * .6, label + ' open area ' + open);
        const cellIsFloor = cell => layout.grid[cell.y * GRID + cell.x] === FLOOR;
        assert.ok(field[layout.exit.y * GRID + layout.exit.x] >= 6, label + ' exit is too close to the entry');
        for (const thing of [...layout.chests, ...layout.spawns, ...layout.braziers, layout.start, layout.exit]) assert.ok(cellIsFloor(thing), label);
        assert.ok(layout.chests.length >= (floor >= 2 ? 2 : 1), label + ' needs treasure');
        assert.ok(layout.spawns.length >= 4, label + ' needs enemies');
        const startRoom = layout.rooms.find(room => room.kind === 'start');
        for (const spawn of layout.spawns) {
            assert.ok(CREATURES[spawn.kind]?.brain, spawn.kind);
            assert.ok(!(spawn.x >= startRoom.x && spawn.x < startRoom.x + startRoom.w && spawn.y >= startRoom.y && spawn.y < startRoom.y + startRoom.h), label + ' spawns in the entry room');
        }
        const boss = floor === FLOORS;
        assert.equal(layout.boss, boss);
        assert.equal(layout.spawns.filter(spawn => spawn.kind === 'warden').length, boss ? 1 : 0);
        assert.equal(layout.chests.filter(chest => chest.tier === 'boss').length, boss ? 1 : 0);
        if (boss) assert.ok(layout.rooms.some(room => room.kind === 'boss' && room.w >= 9 && room.h >= 9));
        if (floor === 1) assert.ok(!layout.spawns.some(spawn => spawn.kind === 'wraith'), 'wraiths wait for deeper floors');
    }
});

test('layouts are deterministic per site, floor and epoch', () => {
    const one = generateFloor(floorSeed('dungeon:start', 0, 1), 1), again = generateFloor(floorSeed('dungeon:start', 0, 1), 1);
    assert.deepEqual([...one.grid], [...again.grid]);
    assert.deepEqual(one.spawns, again.spawns);
    for (const [site, epoch, floor] of [['dungeon:start', 1, 1], ['dungeon:start', 0, 2], ['dungeon:2:3', 0, 1]])
        assert.notDeepEqual([...generateFloor(floorSeed(site, epoch, floor), floor).grid], [...one.grid]);
    assert.equal(dungeonEpoch(1), 0);
    assert.equal(dungeonEpoch(RESET_DAYS), 0);
    assert.equal(dungeonEpoch(RESET_DAYS + 1), 1);
    assert.equal(daysUntilReset(1), RESET_DAYS);
    assert.equal(daysUntilReset(RESET_DAYS), 1);
});

test('entrances are scattered deterministically on dry land, the first near home', () => {
    assert.ok(Math.hypot(STARTER_DUNGEON.x, STARTER_DUNGEON.z) < 90, 'the first dungeon is a short walk');
    assert.ok(Math.hypot(STARTER_DUNGEON.x, STARTER_DUNGEON.z) > 30, 'but not on top of the camp');
    assert.deepEqual(dungeonsNear(0, 0, 100), [STARTER_DUNGEON]);
    let found = 0;
    const ids = new Set();
    for (let cx = -8; cx <= 8; cx++) for (let cz = -8; cz <= 8; cz++) {
        const site = dungeonForCell(cx, cz);
        assert.deepEqual(site, dungeonForCell(cx, cz));
        if (!site) continue;
        found++;
        ids.add(site.id);
        assert.ok(Math.sin(site.x * .005) * Math.cos(site.z * .005) <= .56, site.id + ' is in a lake');
        assert.ok(site.tier >= 1 && site.name.length > 3);
        assert.ok(Math.hypot(site.x - STARTER_DUNGEON.x, site.z - STARTER_DUNGEON.z) > 60);
    }
    assert.equal(ids.size, found);
    assert.ok(found > 150 && found < 289, 'most regions, but not all, hide a dungeon: ' + found);
    const far = dungeonsNear(2000, 2000, 400);
    assert.ok(far.length >= 2 && far.every(site => site.tier > 1), 'distant dungeons are harder');
    assert.ok(far.every(site => Math.hypot(site.x - 2000, site.z - 2000) <= 400));
});

// A hand-made floor: two 5x5 rooms joined by a corridor, with a wall between.
function twoRooms() {
    const grid = new Uint8Array(GRID * GRID);
    const open = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid[y * GRID + x] = FLOOR; };
    open(2, 2, 6, 6); open(10, 2, 14, 6); open(4, 6, 4, 10); open(4, 10, 12, 10); open(12, 6, 12, 10);
    return {grid, originX: 0, originZ: 0};
}

test('walls stop movement and sight, and the flow field routes around them', () => {
    const layout = twoRooms();
    const middle = centreOf(layout, 4, 4);
    assert.deepEqual(resolveCircle(layout, middle.x, middle.z, .7), middle, 'open floor is left alone');
    // Pressed against the west wall of the room: pushed back out to arm's length.
    const pressed = resolveCircle(layout, 2 * CELL + .1, middle.z, .7);
    assert.ok(Math.abs(pressed.x - (2 * CELL + .7)) < 1e-9 && pressed.z === middle.z);
    // A corner pushes both ways.
    const corner = resolveCircle(layout, 2 * CELL + .2, 2 * CELL + .2, .7);
    assert.ok(Math.hypot(corner.x - 2 * CELL, corner.z - 2 * CELL) >= .7 - 1e-9);
    // Inside solid rock: snapped to the nearest open cell.
    const rescued = resolveCircle(layout, 8.5 * CELL, 4.5 * CELL, .7), cell = cellOf(layout, rescued.x, rescued.z);
    assert.ok(isOpen(layout, cell.x, cell.y));
    const a = centreOf(layout, 6, 4), b = centreOf(layout, 10, 4), c = centreOf(layout, 2, 4);
    assert.equal(lineOfSight(layout, a.x, a.z, c.x, c.z), true);
    assert.equal(lineOfSight(layout, a.x, a.z, b.x, b.z), false, 'the dividing wall blocks sight');
    const field = flowField(layout.grid, 12, 4);
    assert.equal(field[4 * GRID + 12], 0);
    assert.equal(field[4 * GRID + 4], 20, 'the only way is round by the corridor');
    assert.equal(field[0], -1);
    assert.equal(flowField(layout.grid, 0, 0).every(value => value === -1), true);
});

// --- Creatures ------------------------------------------------------------
test('every creature is fully described and has a model and a voice', () => {
    const engine = new BABYLON.NullEngine(), scene = new BABYLON.Scene(engine);
    try {
        for (const [kind, def] of Object.entries(CREATURES)) {
            assert.ok(def.label && def.health > 0 && def.xp > 0, kind);
            if (!def.brain) continue;
            for (const key of ['damage', 'speed', 'aggro', 'reach', 'cooldown', 'windup', 'radius']) assert.ok(def[key] > 0, `${kind}.${key}`);
            assert.ok(SOUNDS[def.sound], `${kind} sound ${def.sound}`);
            assert.ok(def.cause && def.stat);
            const model = createCreatureModel(scene, kind, 3);
            assert.ok(model.mesh.getTotalVertices() > 60, kind);
            model.mesh.dispose(false, true);
        }
        for (const make of [() => createChestModel(scene), () => createChestModel(scene, true, true), () => createEntranceModel(scene, 4),
            () => createBrazierModel(scene), () => createStairsModel(scene, 'down'), () => createGearDropModel(scene, '#ffb23e')]) {
            make().dispose(false, true);
        }
        assert.equal(scene.meshes.length, 0, 'models clean up after themselves');
        assert.equal(scene.materials.length, 0);
        assert.throws(() => createCreatureModel(scene, 'dragon'));
        const deep = scaleFor(3, 3), shallow = scaleFor(1, 1);
        assert.deepEqual(shallow, {health: 1, damage: 1, xp: 1});
        assert.ok(deep.health > 1.9 && deep.damage > 1.5 && deep.damage < deep.health);
        for (const sound of ['chest', 'stairs', 'loot', 'legendary', 'equip', 'crit', 'slam', 'bolt', 'drip']) assert.ok(SOUNDS[sound], sound);
    } finally { engine.dispose(); }
});

// Put the player and one creature on the hand-made floor and step the simulation.
function arena(kind, creatureCell, playerCell) {
    const setup = world(), {game, player} = setup;
    const dungeon = game.dungeonSystem, layout = twoRooms();
    Object.assign(dungeon, {active: true, layout, floor: 1, site: {...STARTER_DUNGEON}});
    game.animalSystem.animals = [];
    const spot = centreOf(layout, ...playerCell), at = centreOf(layout, ...creatureCell);
    player.camera.position.set(spot.x, DUNGEON_DEPTH + 2, spot.z);
    dungeon.reveal();
    const animal = game.animalSystem.spawnAnimal(at.x, DUNGEON_DEPTH, at.z, kind, {dungeon: true, tier: 1, floor: 1});
    const step = (frames, each) => {
        for (let n = 0; n < frames; n++) { dungeon.update(.05); game.animalSystem.update(); each?.(n); }
    };
    return {...setup, dungeon, layout, animal, step};
}

test('a skeleton closes in, winds up and strikes, and stepping back dodges the blow', () => {
    const {engine, player, animal, step, layout} = arena('skeleton', [2, 4], [6, 4]);
    try {
        const states = new Set();
        step(200, () => states.add(animal.state));
        assert.ok(states.has('chase') && states.has('windup') && states.has('recover'));
        assert.ok(player.health < 100, 'standing still gets you hit');
        assert.equal(player.lastDamageCause, 'a skeleton');
        const cell = cellOf(layout, animal.mesh.position.x, animal.mesh.position.z);
        assert.ok(isOpen(layout, cell.x, cell.y));

        // Now watch for the wind-up and walk away before it lands.
        player.health = 100;
        let dodged = 0;
        step(260, () => {
            if (animal.state !== 'windup') return;
            const far = centreOf(layout, animal.mesh.position.x > 4.5 * CELL ? 2 : 6, 2);
            player.camera.position.x = far.x; player.camera.position.z = far.z;
            dodged++;
        });
        assert.ok(dodged > 0);
        assert.equal(player.health, 100, 'a telegraphed blow can always be avoided');
    } finally { engine.dispose(); }
});

test('creatures find their way round walls to a player they cannot see', () => {
    const {engine, player, animal, step, layout} = arena('spider', [12, 4], [4, 4]);
    try {
        const start = Math.hypot(animal.mesh.position.x - player.camera.position.x, animal.mesh.position.z - player.camera.position.z);
        assert.equal(lineOfSight(layout, animal.mesh.position.x, animal.mesh.position.z, player.camera.position.x, player.camera.position.z), false);
        step(60);
        assert.equal(animal.state || 'roam', 'roam', 'unseen and unprovoked, it leaves the player alone');
        animal.fleeTimer = 30; // Struck: now it comes looking.
        let reached = false;
        step(700, () => {
            const cell = cellOf(layout, animal.mesh.position.x, animal.mesh.position.z);
            assert.ok(isOpen(layout, cell.x, cell.y), 'never walks through rock');
            if (player.health < 100) reached = true;
        });
        assert.ok(reached, 'it took the corridor round and bit the player');
        assert.ok(start > 20);
    } finally { engine.dispose(); }
});

test('a wraith keeps its distance and throws bolts that walls stop', () => {
    const {engine, game, player, animal, step, layout} = arena('wraith', [2, 4], [6, 4]);
    try {
        let most = 0;
        step(120, () => { most = Math.max(most, game.animalSystem.ai.bolts.length); });
        assert.ok(most >= 1, 'it cast');
        assert.ok(player.health < 100, 'the bolt found a player who stood still');
        assert.equal(player.lastDamageCause, 'a wraith');
        assert.ok(Math.hypot(animal.mesh.position.x - player.camera.position.x, animal.mesh.position.z - player.camera.position.z) > 3, 'it does not close to melee');
        // A bolt fired at the dividing wall is spent there.
        game.animalSystem.ai.clearBolts();
        player.health = 100;
        const from = centreOf(layout, 6, 4), behind = centreOf(layout, 10, 4);
        animal.mesh.position.set(from.x, DUNGEON_DEPTH, from.z);
        player.camera.position.set(behind.x, DUNGEON_DEPTH + 2, behind.z);
        game.animalSystem.ai.fireBolt(animal, CREATURES.wraith);
        animal.health = 0;
        step(40);
        assert.equal(game.animalSystem.ai.bolts.length, 0);
        assert.equal(player.health, 100);
    } finally { engine.dispose(); }
});

test('the Stone Warden shrugs off stagger, enrages at half health and calls spiders', () => {
    const {engine, game, player, animal, step, notes} = arena('warden', [3, 4], [5, 4]);
    try {
        assert.equal(animal.maxHealth, CREATURES.warden.health);
        animal.staggerTimer = 5;
        step(160);
        assert.ok(player.health < 100, 'its slam lands on anyone inside its reach');
        assert.equal(player.lastDamageCause, 'the Stone Warden');
        animal.health = animal.maxHealth * .4;
        player.health = 1e6; // Keep the test subject alive.
        step(2);
        assert.equal(animal.enraged, true);
        assert.equal(game.animalSystem.animals.filter(other => other.kind === 'spider' && other.dungeon).length, 2);
        assert.ok(notes.some(note => /enraged/.test(note)));
        // Death pays out and clears the run.
        const xp = game.combatSystem.experience + game.combatSystem.level * 1e6;
        animal.health = 0;
        step(1);
        assert.equal(game.progression.stats.bosses, 1);
        assert.equal(game.dungeonSystem.runs[STARTER_DUNGEON.id].cleared, true);
        assert.ok(game.combatSystem.experience + game.combatSystem.level * 1e6 > xp);
    } finally { engine.dispose(); }
});

test('surface and dungeon creatures each stand still while the player is in the other realm', () => {
    const {engine, game, player} = world();
    try {
        const animals = game.animalSystem;
        animals.animals = [];
        const boar = animals.spawnAnimal(player.camera.position.x + 3, 2, player.camera.position.z, 'boar');
        boar.fleeTimer = 30;
        game.dungeonSystem.active = true;
        game.dungeonSystem.layout = twoRooms();
        const before = boar.mesh.position.clone();
        for (let n = 0; n < 40; n++) animals.update();
        assert.deepEqual(boar.mesh.position.asArray(), before.asArray(), 'the boar waits on the surface');
        assert.equal(player.health, 100);
        assert.equal(animals.animals.length, 1, 'and nothing new wanders in underground');
        game.dungeonSystem.active = false;
        for (let n = 0; n < 60; n++) animals.update();
        assert.ok(player.health < 100, 'back above ground, it charges');
        assert.equal(player.lastDamageCause, 'a boar');
        // Killing it gives meat like any other animal.
        const meat = game.inventorySystem.inventory.rawMeat;
        boar.health = 0;
        animals.update();
        assert.equal(game.inventorySystem.inventory.rawMeat, meat + 3);
        assert.equal(game.progression.stats.hunted, 1);
    } finally { engine.dispose(); }
});

// --- A run ----------------------------------------------------------------
test('a full run: descend, loot, clear the boss and climb out', () => {
    const {engine, game, player, scene} = world();
    try {
        const dungeon = game.dungeonSystem, animals = game.animalSystem;
        animals.animals = [];
        const surfaceMeshes = () => scene.meshes.length;
        dungeon.scanEntrances();
        assert.equal(dungeon.nearest.id, STARTER_DUNGEON.id);
        assert.equal(dungeon.entrances.size, 1);
        assert.ok(dungeon.found.has(STARTER_DUNGEON.id));
        const outside = surfaceMeshes();
        assert.match(dungeon.interaction().label, /descend into Old Barrow/);
        const entry = player.camera.position.clone();

        player.isFlying = true;
        assert.equal(game.survivalSystem.interact(), true);
        assert.equal(dungeon.active, true);
        assert.equal(dungeon.floor, 1);
        assert.equal(player.isFlying, false);
        assert.equal(player.camera.position.y, DUNGEON_DEPTH + 2);
        const start = centreOf(dungeon.layout, dungeon.layout.start.x, dungeon.layout.start.y);
        assert.deepEqual([player.camera.position.x, player.camera.position.z], [start.x, start.z]);
        assert.equal(animals.animals.length, dungeon.layout.spawns.length);
        assert.ok(animals.animals.every(animal => animal.dungeon));
        assert.equal(game.progression.stats.delves, 1);
        assert.ok(dungeon.mesh.getTotalVertices() > 1000);
        assert.ok(dungeon.braziers.length > 0 && dungeon.braziers.every(fire => fire.type === 'fire'));
        assert.match(dungeon.interaction().label, /climb back/);

        // Underground rules: no flight, a ceiling, no building, no water, no bed.
        player.update();
        assert.equal(player.camera.position.y, DUNGEON_DEPTH + 2);
        player.jump(); player.jump();
        assert.equal(player.isFlying, false);
        player.camera.position.y = DUNGEON_DEPTH + 50;
        player.update();
        assert.ok(player.camera.position.y <= DUNGEON_DEPTH + CEILING);
        player.isGrounded = true; player.camera.position.y = DUNGEON_DEPTH + 2;
        assert.equal(game.buildSystem.blockedReason('fire', {x: 0, y: 0, z: 0}), 'Nothing can be built underground');
        game.terrainSystem.isWaterArea = () => true;
        assert.equal(game.survivalSystem.nearWater(), false);
        game.terrainSystem.isWaterArea = () => false;
        // Pushed into a wall, the player is put back on the floor.
        player.camera.position.x = dungeon.layout.originX + .1; player.camera.position.z = dungeon.layout.originZ + .1;
        dungeon.update(.05);
        const here = cellOf(dungeon.layout, player.camera.position.x, player.camera.position.z);
        assert.ok(isOpen(dungeon.layout, here.x, here.y));
        assert.ok(dungeon.explored.some(value => value === 1));

        // A chest opens once, spills gear and stays open if the floor is rebuilt.
        const chest = dungeon.chests.find(candidate => !candidate.boss);
        player.camera.position.x = chest.x + 1; player.camera.position.z = chest.z;
        assert.match(dungeon.interaction().label, /open the chest/);
        assert.equal(game.survivalSystem.interact(), true);
        assert.ok(game.gear.drops.length >= 1);
        assert.equal(game.progression.stats.chests, 1);
        assert.equal(dungeon.openChest(chest), false);
        assert.notEqual(dungeon.interaction()?.label, 'Press E to open the chest');
        const carried = game.gear.drops.length;

        // Down to the last floor; gear left on the ground comes along.
        for (let floor = 2; floor <= FLOORS; floor++) {
            const down = dungeon.markers.find(marker => marker.kind === 'down');
            player.camera.position.x = down.x; player.camera.position.z = down.z;
            assert.match(dungeon.interaction().label, new RegExp('floor ' + floor));
            assert.equal(game.survivalSystem.interact(), true);
            assert.equal(dungeon.floor, floor);
        }
        assert.equal(game.gear.drops.length, 0);
        assert.equal(Object.values(game.gear.equipped).filter(Boolean).length + game.gear.bag.length, carried);
        assert.equal(dungeon.descend(), false, 'there is nothing below the last floor');
        assert.equal(dungeon.markers.some(marker => marker.kind === 'down'), false);
        assert.equal(dungeon.boss.kind, 'warden');
        assert.equal(dungeon.itemLevel(), FLOORS);

        // The hoard is sealed until the Warden falls.
        const hoard = dungeon.chests.find(candidate => candidate.boss);
        player.camera.position.x = hoard.x + 1; player.camera.position.z = hoard.z;
        assert.match(dungeon.interaction().label, /Sealed/);
        assert.equal(game.survivalSystem.interact(), false);
        dungeon.boss.health = 0;
        animals.update();
        assert.equal(dungeon.boss, null);
        assert.equal(dungeon.isCleared(STARTER_DUNGEON), true);
        assert.match(dungeon.interaction().label, /hoard/);
        assert.equal(game.survivalSystem.interact(), true);
        const hoardLoot = game.gear.drops.map(drop => drop.item);
        assert.equal(hoardLoot.length, 2);
        assert.ok(hoardLoot.every(piece => rarityIndex(piece.rarity) >= rarityIndex('rare')), 'boss loot is Rare or better');
        const shortcut = dungeon.markers.find(marker => marker.shortcut);
        assert.ok(shortcut, 'a way out opens beside the boss');

        // Climb out: back where we went in, with nothing left behind.
        player.camera.position.x = shortcut.x; player.camera.position.z = shortcut.z;
        assert.equal(game.survivalSystem.interact(), true);
        assert.equal(dungeon.active, false);
        assert.deepEqual([player.camera.position.x, player.camera.position.y, player.camera.position.z], [entry.x, 4, entry.z]);
        assert.equal(animals.animals.length, 0);
        assert.equal(game.gear.drops.length, 0);
        assert.equal(surfaceMeshes(), outside, 'every dungeon mesh was released');

        // Cleared dungeons stay shut until the layout is redrawn.
        assert.match(dungeon.interaction().label, /lies quiet/);
        assert.equal(dungeon.enter(STARTER_DUNGEON), false);
        game.dayCount = RESET_DAYS + 1;
        assert.equal(dungeon.isCleared(STARTER_DUNGEON), false);
        assert.equal(dungeon.enter(STARTER_DUNGEON), true);
        assert.equal(dungeon.chests.every(candidate => !candidate.opened), true, 'a new epoch refills the chests');
    } finally { engine.dispose(); }
});

test('dying underground ends the run with the pack outside and the gear kept', () => {
    const {engine, game, player} = world();
    try {
        const dungeon = game.dungeonSystem;
        game.animalSystem.animals = [];
        dungeon.scanEntrances();
        const entry = player.camera.position.clone();
        assert.equal(dungeon.deathDropPosition(), null);
        dungeon.enter(STARTER_DUNGEON);
        game.gear.add(item('weapon', {power: 5}));
        const dropped = [];
        game.inventorySystem.dropAllItems = position => dropped.push(position);
        player.dropLoot();
        assert.deepEqual(dropped, [{x: entry.x, y: 2, z: entry.z}]);
        game.terrainSystem.spawnPosition = {x: 0, z: 0}; game.terrainSystem.spawnHeight = 2;
        player.isDead = true;
        player.respawn();
        assert.equal(dungeon.active, false);
        assert.equal(game.animalSystem.animals.length, 0);
        assert.deepEqual([player.camera.position.x, player.camera.position.z], [0, 0]);
        assert.ok(game.gear.equipped.weapon, 'gear is kept through death');
    } finally { engine.dispose(); }
});

test('saves keep gear and dungeon progress, resume outside, and old saves still load', () => {
    const {engine, game, player} = world();
    try {
        const items = new Map();
        const storage = {setItem: (key, value) => items.set(key, value), getItem: key => items.get(key) || null, removeItem: key => items.delete(key)};
        const saves = game.saveSystem = new SaveSystem(game, storage);
        game.animalSystem.animals = [];
        const dungeon = game.dungeonSystem;
        dungeon.scanEntrances();
        const entry = player.camera.position.clone();
        game.gear.add(item('armor', {vitality: 30}));
        dungeon.enter(STARTER_DUNGEON);
        dungeon.openChest(dungeon.chests[0]);
        player.health = 120;
        assert.equal(saves.save(), true);
        const raw = JSON.parse(items.get(SAVE_KEY));
        assert.deepEqual([raw.position.x, raw.position.y, raw.position.z], [entry.x, 4, entry.z], 'the save points at the entrance, not the depths');
        assert.equal(raw.maxHealth, 100, 'health from gear is not baked into the save');
        assert.equal(raw.gear.equipped.armor.stats.vitality, 30);
        assert.ok(raw.gear.bag.length >= 1, 'gear lying on the floor is saved too');
        assert.deepEqual(raw.dungeons.runs[STARTER_DUNGEON.id].opened, ['1:0']);

        dungeon.leave(false);
        game.gear.restore(null);
        dungeon.restore(null);
        assert.equal(saves.load(), true);
        assert.equal(player.maxHealth, 130);
        assert.equal(player.health, 120);
        assert.equal(game.gear.equipped.armor.stats.vitality, 30);
        assert.ok(dungeon.found.has(STARTER_DUNGEON.id));
        dungeon.enter(STARTER_DUNGEON);
        assert.equal(dungeon.chests[0].opened, true, 'an opened chest stays open for the rest of the epoch');
        dungeon.leave(false);

        // Tampered and legacy data.
        dungeon.restore({found: [1, 'dungeon:a'], runs: {a: {epoch: 'x'}, b: {epoch: 2, opened: [3, '1:1'], cleared: 'yes', deepest: 99}}});
        assert.deepEqual([...dungeon.found], ['dungeon:a']);
        assert.deepEqual(dungeon.runs, {b: {epoch: 2, opened: ['1:1'], cleared: false, deepest: FLOORS}});
        delete raw.gear; delete raw.dungeons;
        raw.maxHealth = 100; raw.health = 90;
        items.set(SAVE_KEY, JSON.stringify(raw));
        assert.equal(saves.load(), true);
        assert.equal(player.maxHealth, 100);
        assert.equal(game.gear.bag.length, 0);
        assert.equal(dungeon.found.size, 0);
    } finally { engine.dispose(); }
});

test('the new field notes follow the dungeon loop', () => {
    const {engine, game} = world();
    try {
        const notes = game.progression;
        for (const quest of QUESTS) if (!['delve', 'relic', 'warden', 'veteran'].includes(quest.id)) notes.completed.add(quest.id);
        assert.equal(notes.current().id, 'delve');
        assert.equal(typeof notes.current().progress(game), 'string');
        notes.record('delves');
        assert.equal(notes.current().id, 'relic');
        game.gear.add(item('weapon', {power: 2}));
        assert.equal(notes.current().id, 'relic', 'a common blade is not enough');
        const rare = item('charm', {fortune: 6, crit: 4, vitality: 10});
        game.gear.add(rare);
        assert.equal(notes.current().id, 'warden');
        notes.record('bosses');
        assert.equal(notes.current().id, 'veteran');
    } finally { engine.dispose(); }
});

test('the offline cache lists every new module', async () => {
    const worker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
    for (const file of ['js/gear.js', 'js/dungeon.js', 'js/creatures.js', 'js/models/creatures.js',
        'js/components/creatures.js', 'js/components/dungeon.js', 'js/components/equipment.js'])
        assert.ok(worker.includes(`'./${file}'`), file + ' is not precached');
});
