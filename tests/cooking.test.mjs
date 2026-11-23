// Tests for the cook pot: what it is, what it cooks, and what eating a stew
// does, through the real crafting, building, buff and save code.
import test from 'node:test';
import assert from 'node:assert/strict';
import BABYLON from 'babylonjs';
import { ITEMS, RECIPES, STEWS, SERVINGS, itemAmount, recipeDescription } from '../js/resources.js';
import { BOONS, BuffSystem } from '../js/components/buffs.js';
import { BUILDINGS, BuildingSystem } from '../js/components/building.js';
import { SMALL_GAP } from '../js/defences.js';
import { InventorySystem } from '../js/components/inventory.js';
import { CombatSystem } from '../js/components/combat.js';
import { PlayerSystem } from '../js/components/player.js';
import { SurvivalSystem } from '../js/components/survival.js';
import { ProgressionSystem, STAT_LABELS } from '../js/components/progression.js';
import { SaveSystem } from '../js/components/save.js';
import { GearSystem } from '../js/components/equipment.js';
import { normalizeSettings } from '../js/settings.js';

globalThis.BABYLON = BABYLON;

const COOK = {hunterStew: 'cookHunterStew', fishChowder: 'cookFishChowder', winterPottage: 'cookWinterPottage'};
const EAT = {hunterStew: 'eatHunterStew', fishChowder: 'eatFishChowder', winterPottage: 'eatWinterPottage'};

function world() {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    const notes = [];
    const game = {
        scene, engine, paused: false, dayTime: 75, dayLength: 300, dayCount: 5, settings: normalizeSettings(null),
        audio: {play() {}},
        uiSystem: {showNotification(message) { notes.push(message); }, showLoot() {}, updateInventoryUI() {}, updateExperienceUI() {},
            updateHealthUI() {}, updateGearUI() {}, showLevelUpMessage() {}, setSaveStatus() {}, showDayBanner() {}},
        terrainSystem: {waterHeight: 1, getPerlinHeight: () => 2, isWaterArea: () => false, isWithinSpawnArea: () => false,
            harvestedIds: new Set(), harvestedOn: new Map(), chunkMap: new Map(), checkChunkUpdates() {}},
        explorationSystem: {discovered: new Set(), isClearing: () => false},
        dungeonSystem: {active: false, runs: {}},
        regions: {current: 'meadow', strength: 0, coldRate: () => 0, thirstFactor: () => 1},
        registerModelShadow() {},
        effects: {torchLit: false, strike() {}, burst() {}, refreshHeld() {}}
    };
    const player = game.playerSystem = Object.create(PlayerSystem.prototype);
    const camera = new BABYLON.FreeCamera('body', new BABYLON.Vector3(0, 4, 0), scene);
    Object.assign(player, {game, camera, isDead: false, health: 100, maxHealth: 100, isGrounded: true, isFlying: false, poisonLeft: 0});
    const pack = (game.inventorySystem = new InventorySystem(game)).inventory;
    game.combatSystem = new CombatSystem(game);
    game.survivalSystem = new SurvivalSystem(game);
    game.progression = new ProgressionSystem(game);
    game.buffs = new BuffSystem(game);
    game.gear = new GearSystem(game);
    const build = game.buildSystem = new BuildingSystem(game);
    const put = (type, x, z) => { const record = {id: build.nextId++, type, x, y: 2, z, rotation: 0}; build.structures.push(record); return record; };
    return {engine, game, camera, pack, build, notes, put, craft: id => game.inventorySystem.craft(id), why: id => game.inventorySystem.blockedReason(id)};
}

test('three stews, each cooked two servings at a time from things the country grows, each with an effect of its own', () => {
    assert.deepEqual(STEWS, ['hunterStew', 'fishChowder', 'winterPottage']);
    assert.equal(SERVINGS, 2);
    for (const stew of STEWS) {
        assert.ok(ITEMS[stew], stew + ' is an item');
        const cook = RECIPES[COOK[stew]], eat = RECIPES[EAT[stew]];
        assert.deepEqual([cook.output, cook.amount, cook.requiresPot, cook.group], [stew, SERVINGS, true, 'food']);
        assert.equal(cook.requiresFire, undefined, 'a campfire will not do');
        for (const [item, count] of Object.entries(cook.cost)) { assert.ok(ITEMS[item] && !STEWS.includes(item), item); assert.ok(count >= 1 && count <= 3); }
        assert.ok(Object.keys(cook.cost).length >= 2, 'a stew is more than one thing in a pot');
        assert.deepEqual(eat.cost, {[stew]: 1}, 'one serving at a time');
        assert.equal(eat.meal, true);
        assert.ok(eat.hunger >= 45, 'a full meal');
        const boon = BOONS[eat.buff];
        assert.ok(boon.seconds >= 300, 'and it lasts at least as long as a night is deep');
        assert.ok(eat.effect.includes(String(boon.seconds / 60) + ' minutes'), 'the recipe says how long');
        assert.match(recipeDescription(eat), /hunger/);
    }
    assert.equal(new Set(STEWS.map(stew => RECIPES[EAT[stew]].buff)).size, 3);
    // A stew's effect is milder than a shrine's or a tonic's, and lasts much longer.
    assert.ok(BOONS.wellFed.damage > 1 && BOONS.wellFed.damage < BOONS.fury.damage && BOONS.wellFed.defence < 1 && BOONS.wellFed.defence > BOONS.stoneskin.defence);
    assert.ok(BOONS.nimble.speed > 1 && BOONS.nimble.speed < BOONS.haste.speed);
    assert.ok(BOONS.warmThrough.cold < BOONS.warmth.cold && BOONS.warmThrough.seconds === 2 * BOONS.warmth.seconds, 'winter pottage beats a warming draught on both counts');
    assert.ok(BOONS.wellFed.seconds > 2 * BOONS.fury.seconds);
    assert.equal(itemAmount('hunterStew', 2), "2 servings of hunter's stew");
    assert.equal(itemAmount('fishChowder', 1), '1 serving of fish chowder');
    assert.equal(STAT_LABELS.stews, 'Pots of stew cooked');
});

test('a stew needs the pot; a campfire will not do, but the pot will do for a campfire', () => {
    const {engine, game, camera, pack, build, notes, put, craft, why} = world();
    try {
        assert.deepEqual(BUILDINGS.cookpot, {name: 'Cook pot', cost: {stone: 4, wood: 3, iron: 1}}, 'iron: not a first-day thing');
        Object.assign(pack, {rawMeat: 5, mushrooms: 4, herbs: 3, fish: 2, berries: 4});
        assert.equal(craft('cookHunterStew'), false);
        assert.equal(why('cookHunterStew'), 'Stand by a cook pot');
        put('fire', 0, 3);
        assert.equal(build.nearFire(camera.position), true);
        assert.equal(build.nearPot(camera.position), false);
        assert.equal(craft('cookHunterStew'), false, 'not over a campfire');
        assert.equal(why('cookHunterStew'), 'Stand by a cook pot');
        assert.equal(pack.rawMeat, 5, 'nothing used');

        camera.position.x = 60;
        put('cookpot', 60, 4);
        assert.equal(build.nearPot(camera.position), true);
        assert.equal(build.nearFire(camera.position), true, 'the fire under the pot roasts and brews');
        assert.equal(build.isProtected(camera.position), true, 'and warms');
        assert.equal(build.nearPot({x: 60, z: 4 + 6.5}), false);
        assert.equal(craft('cookHunterStew'), true);
        assert.deepEqual([pack.hunterStew, pack.rawMeat, pack.mushrooms, pack.herbs], [SERVINGS, 3, 3, 2]);
        assert.equal(notes.at(-1), "Cooked 2 servings of hunter's stew");
        assert.equal(game.progression.stats.stews, 1);
        assert.equal(game.progression.stats.crafted, 0, 'cooking is not crafting');
        assert.equal(craft('cookMeat'), true, 'roast meat at the pot too');
        assert.equal(pack.cookedMeat, 1);
        assert.equal(craft('cookFishChowder'), true);
        assert.equal(pack.fishChowder, SERVINGS);
        pack.berries = 1;
        assert.equal(craft('cookWinterPottage'), false);
        assert.equal(why('cookWinterPottage'), 'Missing materials');

        // The pot is a small piece: it can stand close to the fire or the shelter.
        const at = (x, z) => ({x, y: 2, z, rotation: 0});
        put('shelter', 200, 200);
        assert.equal(build.blockedReason('cookpot', at(200 + SMALL_GAP + .5, 200)), '');
        assert.equal(build.blockedReason('cookpot', at(201, 200)), 'Too close to another structure');
        const record = {id: build.nextId++, type: 'cookpot', x: 0, y: 0, z: 0, rotation: 0};
        build.createVisible(record);
        const box = build.meshes.get(record.id).getBoundingInfo().boundingBox;
        assert.ok(box.maximum.y > 1.5 && box.maximum.y < 2 && box.maximum.x - box.minimum.x < 2.5, 'a pot under a crossbar');
    } finally { engine.dispose(); }
});

test('a serving is a meal, mends you a little, and leaves its effect; eaten anywhere, full or not', () => {
    const {engine, game, pack, craft} = world();
    try {
        const player = game.playerSystem, survival = game.survivalSystem, buffs = game.buffs;
        Object.assign(pack, {hunterStew: 2, fishChowder: 1, winterPottage: 1});
        player.health = 50; survival.hunger = 20;
        assert.equal(craft('eatHunterStew'), true, 'no pot or fire needed to eat');
        assert.equal(pack.hunterStew, 1);
        assert.equal(survival.hunger, 20 + RECIPES.eatHunterStew.hunger);
        assert.equal(player.health, 50 + RECIPES.eatHunterStew.heal);
        assert.deepEqual([buffs.factor('damage'), buffs.factor('defence'), buffs.factor('speed'), buffs.factor('cold')], [1.15, .85, 1, 1]);
        assert.ok(Math.abs(buffs.list()[0].left - 300) < 1e-9);
        assert.equal(game.progression.stats.meals, 1);

        // Already full and whole: you can still eat it for the effect, and it tops nothing past its limit.
        player.health = 100; survival.hunger = 100;
        assert.equal(craft('eatFishChowder'), true);
        assert.deepEqual([player.health, survival.hunger, pack.fishChowder], [100, 100, 0]);
        assert.equal(buffs.factor('speed'), 1.15);
        assert.equal(craft('eatFishChowder'), false, 'none left');
        assert.equal(craft('eatWinterPottage'), true);
        assert.equal(buffs.factor('cold'), .3);
        assert.equal(buffs.list().length, 3, 'three stews, three effects at once');

        // Eating the same stew again renews it; it does not stack.
        buffs.update(120);
        assert.equal(craft('eatHunterStew'), true);
        assert.equal(buffs.factor('damage'), 1.15);
        assert.ok(Math.abs(buffs.list().find(one => one.id === 'wellFed').left - 300) < 1e-9);
        // And in time it wears off.
        buffs.update(301);
        assert.equal(buffs.factor('damage'), 1);
        assert.equal(buffs.has('warmThrough'), false);
    } finally { engine.dispose(); }
});

test('winter pottage does what it says to the cold of a winter night', () => {
    const chill = stew => {
        const {engine, game, pack, craft} = world();
        try {
            game.dayCount = 11; game.dayTime = 225;
            game.buildSystem.isProtected = () => false;
            game.weatherSystem = {type: 'clear', form: 'clear'};
            if (stew) { pack.winterPottage = 1; assert.equal(craft('eatWinterPottage'), true); }
            const survival = game.survivalSystem;
            survival.cold = 10; survival.hunger = 100; survival.thirst = 100;
            for (let i = 0; i < 200; i++) survival.update(.05);
            return survival.cold - 10;
        } finally { engine.dispose(); }
    };
    const bare = chill(false), fed = chill(true);
    assert.ok(bare > 5, 'a night out is cold');
    assert.ok(Math.abs(fed / bare - BOONS.warmThrough.cold) < .02, 'and the pottage takes seven tenths of it away');
});

test('servings, the pot and a stew\'s effect all survive a save', () => {
    const {engine, game, pack, build, put, craft} = world();
    try {
        const items = new Map();
        const storage = {setItem(key, value) { items.set(key, value); }, getItem(key) { return items.get(key) || null; }, removeItem(key) { items.delete(key); }};
        const saves = game.saveSystem = new SaveSystem(game, storage);
        put('cookpot', 0, 4);
        Object.assign(pack, {hunterStew: 3, winterPottage: 2});
        assert.equal(craft('eatHunterStew'), true);
        game.buffs.update(100);
        assert.equal(saves.save(), true);
        Object.assign(pack, {hunterStew: 0, winterPottage: 0});
        build.restore([]); game.buffs.restore(null);
        assert.equal(saves.load(), true);
        assert.deepEqual([pack.hunterStew, pack.winterPottage, pack.fishChowder], [2, 2, 0]);
        assert.deepEqual(build.structures.map(item => item.type), ['cookpot']);
        assert.equal(build.nearPot(game.playerSystem.camera.position), true);
        assert.ok(Math.abs(game.buffs.list().find(one => one.id === 'wellFed').left - 200) < 1e-6);
    } finally { engine.dispose(); }
});
