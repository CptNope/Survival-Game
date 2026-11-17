// Tests for the frontier update: surface regions and their wildlife, the bow,
// perks, and the items and recipes that came with them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import BABYLON from 'babylonjs';
import {
    HOME_RADIUS, REGIONS, REGION_IDS, FRONTIERS, regionWeights, regionAt, regionStrength, groundColor,
    treeFor, plantFor, wildlifeFor, nearestRegion, spotHash
} from '../js/regions.js';
import { BOW, drawAmount, drawPower, arrowDamage, segmentHit, aimVector, assistAim } from '../js/archery.js';
import { PERKS, PERK_IDS, OFFER_SIZE, pointsFor, perkOffer, perkValue, ranksSpent, sanitizeRanks } from '../js/perks.js';
import { ITEMS, RESOURCES, RECIPES, REGROW_DAYS, recipeDescription } from '../js/resources.js';
import { CREATURES } from '../js/creatures.js';
import { GRID, FLOOR, STARTER_DUNGEON, centreOf } from '../js/dungeon.js';
import { ViewSystem } from '../js/components/view.js';
import { BuffSystem } from '../js/components/buffs.js';
import { PerkSystem } from '../js/components/perks.js';
import { RegionSystem } from '../js/components/regions.js';
import { ArcherySystem } from '../js/components/archery.js';
import { GearSystem } from '../js/components/equipment.js';
import { DungeonSystem, DUNGEON_DEPTH } from '../js/components/dungeon.js';
import { AnimalSystem } from '../js/components/animals.js';
import { InventorySystem } from '../js/components/inventory.js';
import { CombatSystem } from '../js/components/combat.js';
import { PlayerSystem, DODGE } from '../js/components/player.js';
import { SurvivalSystem } from '../js/components/survival.js';
import { BuildingSystem } from '../js/components/building.js';
import { ProgressionSystem, QUESTS, STAT_LABELS } from '../js/components/progression.js';
import { SaveSystem, SAVE_KEY, SAVE_VERSION } from '../js/components/save.js';
import { TerrainSystem } from '../js/components/terrain.js';
import { SOUNDS } from '../js/components/audio.js';
import { normalizeSettings } from '../js/settings.js';

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
            waterHeight: 1, getPerlinHeight: () => 2, isWaterArea: () => false, isWithinSpawnArea: () => false,
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
    return {engine, scene, game, player, camera, notes, banners};
}

// --- Regions ----------------------------------------------------------------
test('the country round the clearing stays meadow, so an existing camp never changes', () => {
    for (let x = -HOME_RADIUS; x <= HOME_RADIUS; x += 9) for (let z = -HOME_RADIUS; z <= HOME_RADIUS; z += 9) {
        if (Math.hypot(x, z) > HOME_RADIUS) continue;
        assert.equal(regionAt(x, z), 'meadow');
        assert.deepEqual(regionWeights(x, z), {meadow: 1, tundra: 0, desert: 0, marsh: 0});
        // The same trees and plants as before, in the same places.
        assert.deepEqual(treeFor(x, z), {type: 'tree', model: null});
        for (const type of ['ore', 'fiber', 'herb', 'berry']) assert.equal(plantFor(type, x, z), type);
    }
    // And the same ground colour as before the frontier existed.
    for (const patch of [0, .3, 1]) {
        const [r, g, b] = groundColor(12, -40, patch);
        assert.ok(Math.abs(r - (.30 + .13 * patch)) < 1e-9 && Math.abs(g - (.44 + .09 * patch)) < 1e-9 && Math.abs(b - (.23 + .04 * patch)) < 1e-9);
    }
    assert.equal(regionStrength(30, 30), 0);
});

test('regions blend smoothly, cover the map in fair shares and all lie within reach', () => {
    const share = Object.fromEntries(REGION_IDS.map(id => [id, 0]));
    let total = 0;
    for (let x = -1500; x <= 1500; x += 25) for (let z = -1500; z <= 1500; z += 25) {
        const weights = regionWeights(x, z);
        const sum = REGION_IDS.reduce((all, id) => all + weights[id], 0);
        assert.ok(Math.abs(sum - 1) < 1e-9, 'weights sum to one');
        assert.ok(REGION_IDS.every(id => weights[id] >= 0 && weights[id] <= 1));
        assert.ok(!(weights.tundra > 0 && weights.desert > 0), 'snow never touches sand');
        const colour = groundColor(x, z, .5);
        assert.ok(colour.every(value => value >= 0 && value <= 1));
        share[regionAt(x, z)]++; total++;
    }
    for (const id of REGION_IDS) assert.ok(share[id] / total > .08, `${id} covers ${(share[id] / total * 100).toFixed(1)}%`);
    // No cliff-edge in the weights: a metre's walk changes them only slightly.
    for (let x = -900; x < 900; x += 37) for (const z of [-640, 15, 480]) {
        const here = regionWeights(x, z), next = regionWeights(x + 1, z);
        for (const id of REGION_IDS) assert.ok(Math.abs(here[id] - next[id]) < .03);
    }
    const bearings = new Set();
    for (const id of FRONTIERS) {
        const spot = nearestRegion(0, 0, id);
        assert.ok(spot && spot.distance > HOME_RADIUS && spot.distance <= 480, `${id} is ${spot?.distance}m from the clearing`);
        assert.equal(regionAt(spot.x, spot.z), id);
        bearings.add(Math.round(spot.bearing / (Math.PI / 4)));
        const deep = deepIn(id);
        assert.equal(regionStrength(deep.x, deep.z), 1);
        assert.ok(REGIONS[id].name && REGIONS[id].note && REGIONS[id].grass.length === 4);
    }
    assert.equal(bearings.size, 3, 'each lies in a different direction');
    assert.equal(nearestRegion(0, 0, 'tundra', 100), null, 'nothing that close');
    assert.equal(spotHash(3.2, 9.9, 1), spotHash(3.2, 9.9, 1));
    assert.notEqual(spotHash(3.2, 9.9, 1), spotHash(3.2, 9.9, 2));
});

test('each region grows and breeds its own things', () => {
    const seen = {tundra: {snowpine: 0, bare: 0}, desert: {cactus: 0, deadwood: 0, bare: 0}, marsh: {bogtree: 0}};
    for (const id of FRONTIERS) {
        const centre = deepIn(id);
        for (let n = 0; n < 600; n++) {
            const x = centre.x + (n % 25) * 1.7, z = centre.z + Math.floor(n / 25) * 1.7;
            if (regionAt(x, z) !== id) continue;
            const growth = treeFor(x, z);
            const key = !growth ? 'bare' : growth.type === 'cactus' ? 'cactus' : growth.model;
            assert.ok(key in seen[id], `${id} should not grow ${key}`);
            seen[id][key]++;
            assert.equal(plantFor('ore', x, z), 'ore', 'ore is found everywhere');
            if (id === 'marsh') assert.equal(plantFor('berry', x, z), 'mushroom');
            if (id === 'desert') assert.equal(plantFor('berry', x, z), 'cactus');
            if (id === 'tundra') assert.ok([null, 'berry'].includes(plantFor('berry', x, z)));
        }
    }
    assert.ok(seen.tundra.snowpine > seen.tundra.bare && seen.tundra.bare > 100, 'a thinner forest in the snow');
    assert.ok(seen.desert.bare > seen.desert.cactus && seen.desert.cactus > seen.desert.deadwood && seen.desert.deadwood > 20, 'mostly open sand');
    assert.ok(seen.marsh.bogtree > 300);

    // Wildlife: one hunter per region, and the meadow keeps its own rules.
    assert.equal(wildlifeFor('meadow', false, .1), null);
    const kinds = id => new Set([0, .2, .45, .55, .7, .8, .9, .99].flatMap(roll => [wildlifeFor(id, false, roll), wildlifeFor(id, true, roll)]));
    assert.ok(kinds('tundra').has('icewolf') && kinds('desert').has('scorpion') && kinds('marsh').has('toad'));
    for (const id of FRONTIERS) for (const kind of kinds(id)) assert.ok(CREATURES[kind], kind + ' exists');
    for (const kind of ['icewolf', 'scorpion', 'toad']) {
        const def = CREATURES[kind];
        assert.ok(def.brain && def.damage > 0 && def.cause && SOUNDS[def.sound], kind);
    }
});

test('a desert chunk grows cactus in its tree slots, and cactus gives fruit', () => {
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
        const count = (id, wanted) => {
            harvestables.length = 0;
            const spot = deepIn(id), chunkX = Math.round(spot.x / 32), chunkZ = Math.round(spot.z / 32);
            for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) terrain.populateChunk(chunkX + dx, chunkZ + dz);
            const ids = harvestables.map(node => node.resourceId);
            assert.equal(new Set(ids).size, ids.length, 'ids stay unique');
            // Nine chunks reach past the region's edge: keep what stands inside it.
            const inside = harvestables.filter(node => regionAt(node.mesh.position.x, node.mesh.position.z) === id);
            harvestables.length = 0; harvestables.push(...inside);
            return harvestables.filter(node => wanted(node));
        };
        const cacti = count('desert', node => node.type === 'cactus');
        assert.ok(cacti.length >= 3, cacti.length + ' cacti in nine desert chunks');
        // A cactus standing where a tree would keeps the tree slot's id, and so its regrowth time.
        assert.ok(cacti.some(node => /:tree:\d+$/.test(node.resourceId)));
        assert.ok(cacti.every(node => node.mesh.metadata.model === 'cactus-plant'));
        assert.ok(harvestables.some(node => node.type === 'tree' && node.mesh.metadata.model === 'deadwood-tree'));
        assert.ok(count('marsh', node => node.type === 'mushroom').length >= 1);
        assert.ok(harvestables.filter(node => node.type === 'tree').every(node => node.mesh.metadata.model === 'bogtree-tree'));
        assert.ok(count('tundra', node => node.type === 'tree').every(node => node.mesh.metadata.model === 'snowpine-tree'));
        // The colour under your feet follows the region too.
        const snow = deepIn('tundra'), sand = deepIn('desert');
        assert.ok(terrain.terrainColor(snow.x, snow.z, 3).every(value => value > .7), 'snow is pale');
        const [r, , b] = terrain.terrainColor(sand.x, sand.z, 3);
        assert.ok(r > b + .2, 'sand is warm');
    } finally { engine.dispose(); }

    assert.deepEqual(RESOURCES.cactus.yields, {cactusFruit: 2, fiber: 1});
    assert.deepEqual(RESOURCES.mushroom.yields, {mushrooms: 2});
    for (const id of ['cactus', 'mushroom']) assert.ok(REGROW_DAYS[id] > 0 && SOUNDS[RESOURCES[id].sound]);
});

test('entering a region is announced once it holds, discovered once, and remembered', () => {
    const {engine, game, camera, banners, notes} = world();
    try {
        const regions = game.regions, snow = deepIn('tundra');
        regions.update(1);
        assert.equal(regions.current, 'meadow');
        assert.equal(regions.guide?.id, 'desert', 'the compass points at the nearest frontier');
        camera.position.set(snow.x, 4, snow.z);
        regions.update(1);
        assert.equal(regions.current, 'meadow', 'one look is not enough: borders flicker');
        const xp = game.combatSystem.experience;
        regions.update(1);
        assert.equal(regions.current, 'tundra');
        assert.equal(regions.strength, 1);
        assert.deepEqual(banners.at(-1), ['Frostfell', REGIONS.tundra.note]);
        assert.ok(game.combatSystem.experience > xp || game.combatSystem.level > 1, 'a discovery is worth experience');
        assert.ok(regions.discovered.has('tundra'));
        // Home and back again: no second fanfare.
        camera.position.set(0, 4, 0);
        regions.update(1); regions.update(1);
        assert.equal(regions.current, 'meadow');
        camera.position.set(snow.x, 4, snow.z);
        regions.update(1); regions.update(1);
        assert.equal(banners.length, 1);
        assert.equal(notes.at(-1), 'Entering Frostfell');
        // Underground the surface is not consulted.
        camera.position.set(0, 4, 0);
        game.dungeonSystem.active = true;
        regions.update(1); regions.update(1);
        assert.equal(regions.current, 'tundra');
        game.dungeonSystem.active = false;

        // Saved and restored, without re-announcing where you already stand.
        const saved = JSON.parse(JSON.stringify(regions.capture()));
        assert.deepEqual(saved.sort(), ['meadow', 'tundra']);
        const sand = deepIn('desert');
        camera.position.set(sand.x, 4, sand.z);
        regions.restore([...saved, 'atlantis', 7]);
        assert.equal(regions.current, 'desert');
        assert.deepEqual([...regions.discovered].sort(), ['desert', 'meadow', 'tundra']);
        assert.equal(banners.length, 1);
        regions.restore(null);
        assert.ok(regions.discovered.has('meadow'));
    } finally { engine.dispose(); }
});

test('Frostfell is cold by day, the desert sun doubles thirst, and both can be prepared for', () => {
    const {engine, game} = world();
    try {
        const survival = game.survivalSystem, regions = game.regions, pack = game.inventorySystem.inventory;
        const cold = () => { survival.cold = 40; survival.update(.05); return (survival.cold - 40) / .05; };
        const thirst = () => { survival.thirst = 80; survival.update(.05); return (80 - survival.thirst) / .05; };
        assert.ok(cold() < 0, 'a clear day in the meadow is warm');
        const baseline = thirst();

        regions.current = 'tundra'; regions.strength = 1;
        assert.ok(Math.abs(cold() - .55) < 1e-9, 'the snow chills even at noon');
        regions.strength = .5;
        assert.ok(Math.abs(cold() - .275) < 1e-9, 'less at its edge');
        regions.strength = 1;
        pack.furCloak = 1;
        assert.ok(Math.abs(cold() - .275) < 1e-9, 'a fur cloak halves it');
        game.perks.ranks = {insulated: 2};
        assert.ok(Math.abs(cold() - .275 * .6) < 1e-9, 'and Insulated helps on top');
        game.perks.ranks = {}; pack.furCloak = 0;
        game.effects.torchLit = true;
        assert.ok(Math.abs(cold() - .55 * .7) < 1e-9, 'a torch takes the edge off');
        game.effects.torchLit = false;
        game.buildSystem.structures.push({type: 'fire', x: game.playerSystem.camera.position.x, z: game.playerSystem.camera.position.z});
        assert.ok(cold() < 0, 'a fire is still a fire');
        game.buildSystem.structures.length = 0;
        game.dayTime = 200; // Night: the weather's cold and the region's stack.
        assert.ok(Math.abs(cold() - (.65 + .55 * 1.6)) < 1e-9);
        game.dayTime = 60;
        assert.equal(thirst(), baseline, 'the cold does not parch');

        regions.current = 'desert';
        assert.ok(Math.abs(thirst() / baseline - REGIONS.desert.thirst) < 1e-9);
        assert.ok(cold() < 0);
        game.dayTime = 200;
        assert.ok(thirst() / baseline < 1.3, 'the desert night is kind');
        game.dayTime = 60;
        game.perks.ranks = {hardy: 3};
        assert.ok(Math.abs(thirst() / baseline - REGIONS.desert.thirst * .55) < 1e-9);
        game.perks.ranks = {};

        // Cactus fruit is the desert's answer to itself.
        pack.cactusFruit = 1; survival.thirst = 40; survival.hunger = 50;
        assert.equal(game.inventorySystem.craft('eatCactus'), true);
        assert.equal(survival.thirst, 75);
        assert.equal(survival.hunger, 58);
        assert.equal(pack.cactusFruit, 0);
        assert.match(recipeDescription(RECIPES.eatCactus), /35 thirst/);
        // Mushrooms want a fire.
        pack.mushrooms = 2;
        assert.equal(game.inventorySystem.canCraft('roastMushrooms'), false);
        game.buildSystem.structures.push({type: 'fire', x: game.playerSystem.camera.position.x, z: game.playerSystem.camera.position.z});
        game.playerSystem.health = 50;
        assert.equal(game.inventorySystem.craft('roastMushrooms'), true);
        assert.equal(game.playerSystem.health, 75);
    } finally { engine.dispose(); }
});

test('a scorpion sting poisons, an ice wolf bite chills, and a dodge avoids both', () => {
    const {engine, game, player} = world();
    try {
        const animals = game.animalSystem, ai = animals.ai, survival = game.survivalSystem;
        const scorpion = animals.spawnAnimal(1, 2, 1, 'scorpion'), wolf = animals.spawnAnimal(1, 2, 1, 'icewolf'), toad = animals.spawnAnimal(1, 2, 8, 'toad');
        for (const animal of [scorpion, wolf, toad]) assert.ok(animal.mesh.getTotalVertices() > 100, animal.kind + ' has a model');

        // Dodged: no damage, so no venom either.
        player.invulnerableUntil = performance.now() + 1e6;
        ai.hurtPlayer(scorpion, CREATURES.scorpion);
        assert.equal(player.health, 100);
        assert.ok(!(player.poisonLeft > 0));
        player.invulnerableUntil = 0;

        ai.hurtPlayer(scorpion, CREATURES.scorpion);
        assert.equal(player.health, 100 - CREATURES.scorpion.damage);
        assert.equal(player.poisonLeft, CREATURES.scorpion.venom.seconds);
        // Venom ticks whatever you do: it cannot be dodged.
        player.invulnerableUntil = performance.now() + 1e6;
        const before = player.health;
        let frames = 0;
        while (player.poisonLeft > 0 && frames++ < 500) player.update();
        const lost = before - player.health, expected = CREATURES.scorpion.venom.rate * CREATURES.scorpion.venom.seconds;
        assert.ok(Math.abs(lost - expected) < .2, `venom did ${lost}, expected about ${expected}`);
        assert.equal(player.lastDamageCause, 'venom');
        player.update();
        assert.equal(before - player.health, lost, 'and then it is over');
        player.invulnerableUntil = 0;
        // A second sting while poisoned restarts the clock rather than stacking.
        player.poison(2.5, 4); player.poisonLeft = 1.5; player.poison(2.5, 4);
        assert.equal(player.poisonLeft, 4);
        player.poisonLeft = 0;

        survival.cold = 20;
        ai.hurtPlayer(wolf, CREATURES.icewolf);
        assert.equal(survival.cold, 20 + CREATURES.icewolf.chill);
        survival.cold = 97;
        ai.hurtPlayer(wolf, CREATURES.icewolf);
        assert.equal(survival.cold, 100);

        // The toad spits green; the wraith's bolts stay blue.
        ai.fireBolt(toad, CREATURES.toad);
        const green = ai.bolts.at(-1).mesh.material.emissiveColor;
        assert.ok(green.g > green.r && green.g > green.b);
        assert.equal(ai.bolts.at(-1).cause, 'a bog toad');
        ai.fireBolt(toad, CREATURES.wraith);
        assert.ok(ai.bolts.at(-1).mesh.material.emissiveColor.b > .9);
        assert.notEqual(ai.bolts.at(-1).mesh.material, ai.bolts.at(-2).mesh.material);

        // Wolves and bears are now worth their pelts.
        const pack = game.inventorySystem.inventory;
        animals.animals = [wolf];
        wolf.health = 0;
        animals.update();
        assert.equal(pack.pelt, 1);
        assert.match(game.uiSystem.notes.at(-1), /Hunted ice wolf · \+1 raw meat · \+1 pelts/);
        assert.equal(CREATURES.wolf.loot.pelt, 1);
        assert.equal(CREATURES.bear.loot.pelt, 2);
    } finally { engine.dispose(); }
});

// --- The bow ------------------------------------------------------------------
test('bow maths: draw, damage, hit tests and aim', () => {
    assert.equal(drawAmount(0), 0);
    assert.equal(drawAmount(BOW.drawTime), 1);
    assert.equal(drawAmount(99), 1);
    assert.equal(drawPower(0), BOW.minPower);
    assert.equal(drawPower(BOW.drawTime), 1);
    let previous = 0;
    for (let t = 0; t <= BOW.drawTime; t += .05) { assert.ok(drawPower(t) > previous); previous = drawPower(t); }
    assert.ok(drawAmount(BOW.drawTime / 2) > .5, 'most of the power comes early');

    assert.equal(arrowDamage(1), BOW.damage);
    assert.equal(arrowDamage(.5), BOW.damage / 2);
    assert.ok(arrowDamage(1, 5) > arrowDamage(1, 1));
    assert.ok(arrowDamage(1, 1, 10) > arrowDamage(1, 1, 0));
    assert.ok(Math.abs(arrowDamage(1, 1, 0, .3) - BOW.damage * 1.3) < 1e-9);

    const a = {x: 0, y: 0, z: 0}, b = {x: 0, y: 0, z: 10};
    assert.ok(Math.abs(segmentHit(a, b, {x: 0, y: 0, z: 5}, 1) - .4) < 1e-9, 'enters the sphere at z = 4');
    assert.equal(segmentHit(a, b, {x: 3, y: 0, z: 5}, 1), null, 'passes beside it');
    assert.equal(segmentHit(a, b, {x: 0, y: 0, z: 15}, 1), null, 'falls short');
    assert.equal(segmentHit(a, b, {x: 0, y: 0, z: -5}, 1), null, 'it is behind');
    assert.equal(segmentHit(a, b, {x: 0, y: .5, z: 0}, 1), 0, 'already inside');
    assert.equal(segmentHit(a, a, {x: 0, y: 0, z: 5}, 1), null);

    // aimVector agrees with the engine's own idea of where a camera looks.
    const engine = new BABYLON.NullEngine(), scene = new BABYLON.Scene(engine);
    try {
        const camera = new BABYLON.FreeCamera('probe', BABYLON.Vector3.Zero(), scene);
        for (const [yaw, pitch] of [[0, 0], [1.1, .3], [-2.4, -.5], [3, .9]]) {
            camera.rotation.set(pitch, yaw, 0);
            camera.computeWorldMatrix(true);
            const forward = camera.getDirection(BABYLON.Axis.Z), mine = aimVector(yaw, pitch);
            assert.ok(Math.abs(forward.x - mine.x) < 1e-6 && Math.abs(forward.y - mine.y) < 1e-6 && Math.abs(forward.z - mine.z) < 1e-6);
        }
    } finally { engine.dispose(); }

    // A near miss is steered on to the target; a wide one is left alone.
    const ahead = {x: 0, y: 0, z: 1};
    const steered = assistAim(a, ahead, [{x: .6, y: 0, z: 10}], 40);
    assert.ok(steered.x > .05 && Math.abs(Math.hypot(steered.x, steered.y, steered.z) - 1) < 1e-9);
    assert.equal(assistAim(a, ahead, [{x: 3, y: 0, z: 10}], 40), ahead);
    assert.equal(assistAim(a, ahead, [{x: .6, y: 0, z: 60}], 40), ahead, 'out of range');
    const nearer = assistAim(a, ahead, [{x: .8, y: 0, z: 10}, {x: -.2, y: 0, z: 10}], 40);
    assert.ok(nearer.x < 0, 'the one closest to the line of fire');
});

// Stand the player at the origin facing +Z with a boar `distance` ahead, aimed at.
function range(setup, distance, kind = 'boar') {
    const {game, camera} = setup;
    camera.position.set(0, 4, 0); camera.rotation.set(0, 0, 0);
    const target = game.animalSystem.spawnAnimal(0, 2, distance, kind);
    const centre = 2 + (CREATURES[kind].radius || .7) * 1.1;
    camera.rotation.x = Math.atan2((4 - .25) - centre, distance - .5);
    return target;
}
function shoot(game, seconds = 1) {
    const archery = game.archery;
    archery.readyAt = 0;
    assert.equal(archery.beginDraw(), true);
    archery.drawStart = performance.now() - seconds * 1000;
    assert.equal(archery.release(), true);
}
function fly(game, frames = 80) { for (let n = 0; n < frames && game.archery.arrows.length; n++) game.archery.update(.05); }

test('the bow needs arrows, spends one a shot, and hits harder the longer it is drawn', () => {
    const setup = world(), {engine, game, notes} = setup;
    try {
        const archery = game.archery, pack = game.inventorySystem.inventory;
        assert.equal(archery.beginDraw(), false);
        assert.match(notes.at(-1), /Craft a bow first/);
        // Crafting: a bow from wood and fiber, arrows four to a bundle.
        Object.assign(pack, {wood: 5, fiber: 3, stone: 2});
        assert.equal(game.inventorySystem.craft('bow'), true);
        assert.equal(game.inventorySystem.canCraft('bow'), false, 'one bow is enough');
        assert.equal(archery.beginDraw(), false);
        assert.match(notes.at(-1), /Out of arrows/);
        assert.equal(game.inventorySystem.craft('arrows'), true);
        assert.equal(game.inventorySystem.craft('arrows'), true);
        assert.deepEqual([pack.arrows, pack.wood, pack.stone], [8, 0, 0]);

        // A full draw.
        let boar = range(setup, 12);
        let health = boar.health;
        shoot(game, 1);
        assert.equal(pack.arrows, 7);
        assert.equal(archery.arrows.length, 1);
        assert.equal(boar.health, health, 'the arrow has to get there first');
        fly(game);
        const full = health - boar.health;
        assert.ok(Math.abs(full - arrowDamage(1, 1)) < 1e-9);
        assert.equal(archery.arrows.length, 0);
        assert.equal(game.progression.stats.arrows, 1);
        assert.equal(game.progression.stats.arrowHits, 1);
        assert.ok(boar.fleeTimer > 0, 'it knows it has been shot');

        // A snap shot does less, and falls short of a distant target.
        game.animalSystem.animals = [];
        boar = range(setup, 12);
        health = boar.health;
        shoot(game, 0);
        fly(game);
        assert.ok(Math.abs((health - boar.health) - arrowDamage(BOW.minPower, 1)) < .1, 'a snap shot does ' + (health - boar.health));
        game.animalSystem.animals = [];
        boar = range(setup, 38);
        health = boar.health;
        shoot(game, 0);
        fly(game);
        assert.equal(boar.health, health, 'out of a snap shot\'s range');
        assert.equal(archery.stuck.length, 1, 'the spent arrow lies where it fell');
        shoot(game, 1);
        fly(game);
        assert.ok(boar.health < health, 'within a full draw\'s');

        // The first creature in the way takes the arrow.
        game.animalSystem.animals = [];
        const far = range(setup, 20), near = game.animalSystem.spawnAnimal(0, 2, 9, 'boar');
        const aim = game.playerSystem.camera.rotation;
        aim.x = Math.atan2(3.75 - 2.77, 8.5);
        const farHealth = far.health, nearHealth = near.health;
        shoot(game, 1);
        fly(game);
        assert.ok(near.health < nearHealth);
        assert.equal(far.health, farHealth);

        // A miss flies on, sticks, and is cleared away after a few seconds.
        game.animalSystem.animals = [];
        aim.set(.5, 0, 0);
        const stuck = archery.stuck.length;
        shoot(game, 1);
        fly(game);
        assert.equal(archery.stuck.length, stuck + 1);
        for (let n = 0; n < 120; n++) archery.update(.05);
        assert.equal(archery.stuck.length, 0);

        // Lowering the bow costs nothing.
        const left = pack.arrows;
        archery.readyAt = 0;
        assert.equal(archery.beginDraw(), true);
        assert.ok(archery.amount() >= 0 && archery.drawing);
        assert.equal(archery.cancel(), true);
        assert.equal(archery.release(), false);
        assert.equal(pack.arrows, left);
        // No drawing while paused, dead, swimming or placing a building.
        game.paused = true; assert.equal(archery.beginDraw(), false); game.paused = false;
        game.playerSystem.isSwimming = true; assert.equal(archery.beginDraw(), false); game.playerSystem.isSwimming = false;
        game.buildSystem.placing = {type: 'fire'}; assert.equal(archery.beginDraw(), false); game.buildSystem.placing = null;
        // The last arrow says so.
        pack.arrows = 1;
        shoot(game, 1);
        assert.equal(pack.arrows, 0);
        assert.match(notes.at(-1), /last arrow/);
        for (const sound of ['draw', 'loose', 'arrow']) assert.ok(SOUNDS[sound]);
    } finally { engine.dispose(); }
});

test('arrows stop at dungeon walls, and the outside views aim without a reticle', () => {
    const setup = world(), {engine, game, camera} = setup;
    try {
        const archery = game.archery, animals = game.animalSystem, pack = game.inventorySystem.inventory;
        Object.assign(pack, {bow: 1, arrows: 30});
        // Two rooms with solid rock between them.
        const grid = new Uint8Array(GRID * GRID);
        for (let y = 2; y <= 6; y++) for (const x of [2, 3, 4, 6, 7, 8]) grid[y * GRID + x] = FLOOR;
        const layout = {grid, originX: 0, originZ: 0};
        Object.assign(game.dungeonSystem, {active: true, layout, site: {...STARTER_DUNGEON}, floor: 1});
        const here = centreOf(layout, 4, 4), beyond = centreOf(layout, 7, 4), beside = centreOf(layout, 2, 4);
        const face = (target, yaw) => {
            camera.position.set(here.x, DUNGEON_DEPTH + 2, here.z);
            camera.rotation.set(Math.atan2(1.75 - .77, Math.hypot(target.x - here.x, target.z - here.z) - .5), yaw, 0);
        };
        const hidden = animals.spawnAnimal(beyond.x, DUNGEON_DEPTH, beyond.z, 'skeleton', {dungeon: true});
        face(beyond, Math.PI / 2);
        let health = hidden.health;
        shoot(game, 1); fly(game);
        assert.equal(hidden.health, health, 'the wall takes the arrow');
        assert.equal(archery.stuck.length, 1);
        const seen = animals.spawnAnimal(beside.x, DUNGEON_DEPTH, beside.z, 'skeleton', {dungeon: true});
        face(beside, -Math.PI / 2);
        health = seen.health;
        shoot(game, 1); fly(game);
        assert.ok(seen.health < health, 'open floor does not');
        // A surface creature is in another world as far as arrows go.
        const outside = animals.spawnAnimal(beside.x, DUNGEON_DEPTH, beside.z, 'boar');
        assert.ok(!archery.targets().some(target => target.animal === outside));
        game.dungeonSystem.active = false;
        animals.animals = [];

        // Overhead: no need to pitch the camera, the shot goes to whatever is ahead.
        const view = game.viewSystem = new ViewSystem(game);
        view.setMode('overhead', false);
        camera.position.set(0, 4, 0); camera.rotation.set(0, 0, 0);
        const ahead = animals.spawnAnimal(1.5, 2, 14, 'boar'), behind = animals.spawnAnimal(0, 2, -8, 'boar');
        view.update(.05);
        health = ahead.health;
        const behindHealth = behind.health;
        shoot(game, 1); fly(game);
        assert.ok(ahead.health < health);
        assert.equal(behind.health, behindHealth);
        // Nothing ahead: the arrow flies level the way the player faces.
        animals.animals = [];
        camera.rotation.y = 1;
        const direction = archery.aim().direction;
        assert.ok(Math.abs(direction.x - Math.sin(1)) < 1e-9 && Math.abs(direction.y) < 1e-9);

        // Third person: the arrow goes where the middle of the screen points.
        view.setMode('third', false);
        camera.rotation.set(.12, 0, 0);
        view.place();
        const forward = view.camera.getDirection(BABYLON.Axis.Z);
        const spot = view.camera.position.add(forward.scale((view.camera.position.y - 2.77) / -forward.y));
        assert.ok(spot.z > 6, 'the screen centre meets the ground ahead of the player');
        const marked = animals.spawnAnimal(spot.x, 2, spot.z, 'boar');
        health = marked.health;
        shoot(game, 1); fly(game);
        assert.ok(marked.health < health);
    } finally { engine.dispose(); }
});

// --- Perks --------------------------------------------------------------------
test('perk points come with levels and the offer of three cannot be rerolled', () => {
    assert.equal(pointsFor(1), 0);
    assert.equal(pointsFor(2), 1);
    assert.equal(pointsFor(7), 6);
    for (const id of PERK_IDS) {
        const perk = PERKS[id];
        assert.ok(perk.name && perk.text && perk.stat && perk.per > 0 && perk.max >= 1 && perk.max <= 3, id);
    }
    assert.equal(new Set(PERK_IDS.map(id => PERKS[id].stat)).size, PERK_IDS.length, 'one stat each');
    const offer = perkOffer({});
    assert.equal(offer.length, OFFER_SIZE);
    assert.equal(new Set(offer).size, OFFER_SIZE);
    assert.deepEqual(perkOffer({}), offer, 'the same ranks always give the same offer');
    // Different stages of a run offer different things.
    const seen = new Set();
    let ranks = {};
    for (let n = 0; n < 12; n++) {
        const next = perkOffer(ranks);
        next.forEach(id => seen.add(id));
        ranks = {...ranks, [next[0]]: (ranks[next[0]] || 0) + 1};
        assert.ok(ranks[next[0]] <= PERKS[next[0]].max);
    }
    assert.ok(seen.size >= 7, 'variety across a run: ' + seen.size);
    // A maxed perk is never offered; with everything maxed there is nothing left.
    const maxed = Object.fromEntries(PERK_IDS.map(id => [id, PERKS[id].max]));
    assert.deepEqual(perkOffer(maxed), []);
    assert.deepEqual(perkOffer({...maxed, tough: 2, fleet: 0}).sort(), ['fleet', 'tough']);
    assert.equal(ranksSpent({tough: 2, fleet: 1}), 3);
    assert.ok(Math.abs(perkValue({brawler: 2}, 'melee') - .24) < 1e-9);
    assert.equal(perkValue({brawler: 2}, 'ranged'), 0);
    assert.deepEqual(sanitizeRanks({tough: 9, fleet: 1.7, nonsense: 2, medic: -1, lucky: 'x'}), {tough: 3, fleet: 1});
    assert.deepEqual(sanitizeRanks(null), {});
});

test('choosing a perk spends the point and changes the game', () => {
    const setup = world(), {engine, game, player, camera, notes} = setup;
    try {
        const perks = game.perks, combat = game.combatSystem, pack = game.inventorySystem.inventory;
        assert.equal(perks.available(), 0);
        assert.deepEqual(perks.offer(), []);
        assert.equal(perks.choose('tough'), false, 'no point, no perk');
        combat.gainExperience(260); // Level 3: two points.
        assert.equal(perks.available(), 2);
        const offer = perks.offer();
        const refused = PERK_IDS.find(id => !offer.includes(id));
        assert.equal(perks.choose(refused), false, 'only what is on offer');
        assert.equal(perks.choose(offer[0]), true);
        assert.equal(perks.available(), 1);
        assert.match(notes.at(-1), new RegExp(PERKS[offer[0]].name));
        assert.ok(SOUNDS.perk);

        // Each perk does what it says. (Set directly: the offer is tested above.)
        const base = (perks.ranks = {}, combat.damage());
        perks.ranks = {brawler: 2};
        assert.ok(Math.abs(combat.damage() - base * 1.24) < 1e-9);
        perks.ranks = {marksman: 2};
        assert.ok(Math.abs(game.archery.damage(1) - arrowDamage(1, combat.level) * 1.3) < 1e-9);
        assert.equal(combat.damage(), base, 'the bow perk does nothing for an axe');

        perks.ranks = {};
        player.update();
        const pace = camera.speed;
        perks.ranks = {fleet: 3};
        player.update();
        assert.ok(Math.abs(camera.speed / pace - 1.18) < 1e-9);

        perks.ranks = {acrobat: 2};
        player.dodgeReadyAt = 0;
        const now = performance.now();
        assert.equal(player.dodge(), true);
        assert.ok(Math.abs((player.dodgeReadyAt - now) - DODGE.cooldown * .6) < 20);

        perks.ranks = {medic: 2};
        Object.assign(pack, {herbs: 2, fiber: 2});
        player.health = 10;
        assert.equal(game.inventorySystem.craft('herbalWrap'), true);
        assert.equal(player.health, 10 + Math.round(RECIPES.herbalWrap.heal * 1.5));

        // Fletcher: some arrows come back.
        Object.assign(pack, {bow: 1, arrows: 5});
        perks.ranks = {fletcher: 2};
        const random = Math.random;
        try {
            camera.rotation.set(.5, 0, 0);
            Math.random = () => .4; shoot(game, 1);
            assert.equal(pack.arrows, 5, 'kept');
            Math.random = () => .6; shoot(game, 1);
            assert.equal(pack.arrows, 4, 'spent');
        } finally { Math.random = random; }

        // Tough is applied once, when chosen.
        perks.ranks = {};
        player.maxHealth = 140; player.health = 100;
        const tough = (() => { for (let n = 0; n < 40; n++) { if (perks.offer().includes('tough')) return true; const pick = perks.offer()[0]; if (!pick) return false; combat.level++; perks.ranks[pick] = (perks.ranks[pick] || 0) + 1; } return false; })();
        assert.ok(tough, 'Tough comes up eventually');
        combat.level = pointsFor(1) + perks.spent() + 2;
        assert.equal(perks.choose('tough'), true);
        assert.deepEqual([player.maxHealth, player.health], [160, 120]);

        // Saved, restored and cleaned.
        const saved = JSON.parse(JSON.stringify(perks.capture()));
        perks.restore({...saved, cheat: 5});
        assert.deepEqual(perks.capture(), saved);
        assert.ok(perks.list().every(perk => perk.name && perk.rank >= 1));
        // A save from before perks existed has every point still to spend.
        perks.restore(undefined);
        combat.level = 5;
        assert.equal(perks.available(), 4);
    } finally { engine.dispose(); }
});

test('the Forager perk sometimes finds one more, and luck reaches dropped gear', () => {
    const {engine, game, camera} = world();
    try {
        const view = game.viewSystem = new ViewSystem(game);
        view.setMode('overhead', false);
        game.pickTarget = range => view.pick(range);
        const pack = game.inventorySystem.inventory, random = Math.random;
        const gather = roll => {
            camera.position.set(0, 4, 0); camera.rotation.set(0, 0, 0);
            const bush = {type: 'berry', resourceId: 't:berry:' + roll, mesh: {position: new BABYLON.Vector3(0, 2, 2.5), dispose() {}}};
            game.inventorySystem.harvestableObjects = [bush];
            game.inventorySystem.nextSwingAt = 0;
            const before = pack.berries;
            Math.random = () => roll;
            try { assert.equal(game.inventorySystem.tryHarvest(), true); } finally { Math.random = random; }
            return pack.berries - before;
        };
        assert.equal(gather(.1), 3, 'no perk, no extra');
        game.perks.ranks = {forager: 2};
        assert.equal(gather(.3), 4);
        assert.equal(gather(.5), 3);

        // Treasure hunter: the same rolls grade better with the perk than without.
        // Measured over the same stream of rolls, so the comparison is exact.
        const stream = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
        const drop = game.gear.drop;
        game.gear.drop = item => item; // No need to build two thousand loot models.
        const score = () => {
            Math.random = stream(11);
            try {
                let sum = 0;
                for (let n = 0; n < 2000; n++) sum += ['common', 'uncommon', 'rare', 'epic', 'legendary'].indexOf(game.gear.dropRoll(null, {level: 1, luck: 0}).rarity);
                return sum / 2000;
            } finally { Math.random = random; }
        };
        game.perks.ranks = {};
        const plain = score();
        game.perks.ranks = {lucky: 2};
        assert.ok(score() > plain + .05, 'better gear on average');
        game.gear.drop = drop;
    } finally { engine.dispose(); }
});

// --- Items, quests and saves ---------------------------------------------------
test('the new items, recipes, quests and stats are all wired up', async () => {
    for (const id of ['bow', 'arrows', 'pelt', 'furCloak', 'cactusFruit', 'mushrooms']) assert.ok(ITEMS[id], id);
    for (const [id, recipe] of Object.entries(RECIPES)) {
        for (const item of Object.keys(recipe.cost)) assert.ok(ITEMS[item], `${id} costs a real item`);
        if (recipe.output) assert.ok(ITEMS[recipe.output], `${id} makes a real item`);
    }
    assert.deepEqual(RECIPES.furCloak.cost, {pelt: 3, fiber: 2});
    assert.equal(RECIPES.arrows.amount, 4);
    assert.ok(RECIPES.bow.unique && RECIPES.furCloak.unique);
    for (const stat of ['arrows', 'arrowHits']) assert.ok(STAT_LABELS[stat]);

    const {engine, game} = world();
    try {
        const progression = game.progression, pack = game.inventorySystem.inventory;
        const quest = id => QUESTS.find(candidate => candidate.id === id);
        for (const id of ['archer', 'frontier', 'cloak']) {
            assert.ok(quest(id), id);
            assert.equal(quest(id).done(game), false);
            assert.equal(typeof quest(id).progress(game), 'string');
        }
        assert.ok(QUESTS.findIndex(q => q.id === 'veteran') > QUESTS.findIndex(q => q.id === 'cloak'), 'the long haul stays last');
        assert.match(quest('archer').progress(game), /No bow yet/);
        progression.stats.arrowHits = 1;
        assert.equal(quest('archer').done(game), true);
        game.regions.discovered.add('marsh');
        assert.equal(quest('frontier').done(game), true);
        pack.pelt = 2;
        assert.match(quest('cloak').progress(game), /2 of 3 pelts/);
        pack.furCloak = 1;
        assert.equal(quest('cloak').done(game), true);

        // Perks and regions ride along in the save, and an older save still loads.
        const items = new Map();
        const storage = {setItem(key, value) { items.set(key, value); }, getItem(key) { return items.get(key) || null; }, removeItem(key) { items.delete(key); }};
        const saves = game.saveSystem = new SaveSystem(game, storage);
        game.combatSystem.level = 4;
        game.perks.ranks = {fleet: 2, tough: 1};
        Object.assign(pack, {bow: 1, arrows: 9});
        assert.equal(saves.save(), true);
        const raw = JSON.parse(items.get(SAVE_KEY));
        assert.equal(raw.version, SAVE_VERSION);
        assert.equal(SAVE_VERSION, 1);
        assert.deepEqual(raw.perks, {fleet: 2, tough: 1});
        assert.ok(raw.regions.includes('marsh'));
        game.perks.ranks = {}; game.regions.discovered = new Set(['meadow']); pack.arrows = 0;
        assert.equal(saves.load(), true);
        assert.deepEqual(game.perks.ranks, {fleet: 2, tough: 1});
        assert.ok(game.regions.discovered.has('marsh'));
        assert.equal(pack.arrows, 9);
        delete raw.perks; delete raw.regions;
        raw.inventory = {wood: 5};
        items.set(SAVE_KEY, JSON.stringify(raw));
        assert.equal(saves.load(), true);
        assert.deepEqual(game.perks.ranks, {});
        assert.deepEqual([...game.regions.discovered], ['meadow']);
        assert.equal(pack.bow, 0);
        assert.equal(game.perks.available(), 3, 'an old save gets its points to spend');
    } finally { engine.dispose(); }

    const worker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
    for (const file of ['js/regions.js', 'js/archery.js', 'js/perks.js', 'js/components/regions.js', 'js/components/archery.js', 'js/components/perks.js'])
        assert.ok(worker.includes(`'./${file}'`), file + ' is not precached');
});
