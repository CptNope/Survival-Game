// Tests for the ending: the First Wolf, the last hunt and what follows,
// through the real pack-night, animal and save code.
import test from 'node:test';
import assert from 'node:assert/strict';
import BABYLON from 'babylonjs';
import { FIRST_WOLF, finalePack, raidPack, nextRaidDay } from '../js/raids.js';
import { LEGEND_LIST } from '../js/legends.js';
import { CREATURES, ELITE, WOLF_BITE, wolfBite, wolfName } from '../js/creatures.js';
import { RaidSystem } from '../js/components/raids.js';
import { AnimalSystem } from '../js/components/animals.js';
import { InventorySystem } from '../js/components/inventory.js';
import { CombatSystem } from '../js/components/combat.js';
import { PlayerSystem } from '../js/components/player.js';
import { ProgressionSystem, QUESTS, STAT_LABELS } from '../js/components/progression.js';
import { SaveSystem } from '../js/components/save.js';
import { SurvivalSystem } from '../js/components/survival.js';
import { BuildingSystem } from '../js/components/building.js';
import { normalizeSettings } from '../js/settings.js';

globalThis.BABYLON = BABYLON;
const MIDNIGHT = 300 * .75 + 1, DUSK = 300 * .47 + 1;

function world(day = 9, difficulty = 'standard') {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    engine.getDeltaTime = () => 50;
    scene.getAnimationRatio = () => 1;
    const notes = [], banners = [], drops = [], bites = [];
    let endings = 0;
    const game = {
        scene, engine, paused: false, dayTime: 100, dayLength: 300, dayCount: day, settings: normalizeSettings({difficulty}),
        audio: {play() {}},
        uiSystem: {showNotification(message) { notes.push(message); }, showLoot() {}, updateInventoryUI() {}, updateExperienceUI() {},
            updateHealthUI() {}, updateGearUI() {}, showLevelUpMessage() {}, setSaveStatus() {}, updateObjectiveUI() {},
            showDayBanner(title, text) { banners.push([title, text]); }, showEnding() { endings++; }},
        terrainSystem: {waterHeight: 1, getPerlinHeight: () => 2, isWaterArea: () => false, isWithinSpawnArea: () => false, chunkMap: new Map(),
            harvestedIds: new Set(), harvestedOn: new Map(), checkChunkUpdates() {}},
        explorationSystem: {discovered: new Set(), isClearing: () => false},
        dungeonSystem: {active: false, runs: {}},
        regions: {current: 'desert', strength: 1},
        legends: {slain: new Set()},
        gear: {dropRoll(position, options) { const item = {name: 'something'}; drops.push({options, item}); return item; }, stat: () => 0,
            capture: () => null, restore() {}},
        registerModelShadow() {},
        effects: {strike() {}, burst() {}, hurt() {}}
    };
    const player = game.playerSystem = Object.create(PlayerSystem.prototype);
    const camera = new BABYLON.FreeCamera('body', new BABYLON.Vector3(0, 4, 0), scene);
    Object.assign(player, {game, camera, isDead: false, health: 1e6, maxHealth: 1e6, isGrounded: true, isFlying: false,
        takeDamage(amount, from) { bites.push([amount, from]); }});
    game.inventorySystem = new InventorySystem(game);
    game.combatSystem = new CombatSystem(game);
    game.progression = new ProgressionSystem(game);
    game.survivalSystem = new SurvivalSystem(game);
    game.buildSystem = new BuildingSystem(game);
    const animals = game.animalSystem = new AnimalSystem(game);
    animals.animals = [];
    animals.spawnTimer = 1e9;
    const raids = game.raids = new RaidSystem(game);
    const tick = () => { raids.timer = 0; raids.update(.5); };
    const slay = animal => { animal.health = 0; animals.finish(animal, animals.animals.indexOf(animal)); };
    const allSlain = () => { for (const legend of LEGEND_LIST) game.legends.slain.add(legend.id); };
    return {engine, game, camera, animals, raids, notes, banners, drops, bites, tick, slay, allSlain, endings: () => endings};
}

test('the last hunt is the First Wolf, an alpha and an escort, and waits for all three legends', () => {
    assert.equal(LEGEND_LIST.length, 3);
    const pack = finalePack();
    assert.deepEqual([pack.finale, pack.kind, pack.size, pack.level], [true, 'wolf', FIRST_WOLF.escort + 1, FIRST_WOLF.level]);
    assert.deepEqual(pack.members[0], {kind: 'wolf', elite: true, first: true});
    assert.equal(pack.members.filter(one => one.first).length, 1);
    assert.equal(pack.members.slice(1).filter(one => one.elite).length, 1, 'one alpha among the escort');
    assert.equal(finalePack(-1).size, FIRST_WOLF.escort, 'Gentle: one fewer in the escort');
    assert.equal(finalePack(1).size, FIRST_WOLF.escort + 2);
    assert.equal(finalePack(-9).size, 3, 'never fewer than two with it');
    assert.ok(FIRST_WOLF.health > 5 * CREATURES.wolf.health * ELITE.health, 'far beyond an alpha');
    assert.ok(FIRST_WOLF.bite > 2 * WOLF_BITE && FIRST_WOLF.size > 1.5);
    assert.deepEqual(FIRST_WOLF.reward, {slot: 'charm', name: "The First Wolf's Tooth"}, 'the one slot the other legends leave empty');
    assert.deepEqual(LEGEND_LIST.map(legend => legend.reward.slot).sort(), ['armor', 'boots', 'weapon']);

    const {engine, game, raids, allSlain} = world();
    try {
        assert.equal(raids.finaleDue, false);
        game.legends.slain.add(LEGEND_LIST[0].id); game.legends.slain.add(LEGEND_LIST[1].id);
        assert.equal(raids.finaleDue, false, 'two is not three');
        assert.equal(raids.plan().finale, undefined);
        allSlain();
        assert.equal(raids.finaleDue, true);
        assert.equal(raids.plan().finale, true);
        raids.crowned = 9;
        assert.equal(raids.finaleDue, false, 'and it comes only until it is broken');
        assert.deepEqual(raids.plan(), raidPack(9, 'desert'), 'after that, pack nights are ordinary again');
    } finally { engine.dispose(); }
});

test('the First Wolf comes for you wherever you are, and breaking it ends the story', () => {
    const {engine, game, camera, animals, raids, notes, banners, drops, bites, tick, slay, allSlain, endings} = world(9);
    try {
        allSlain();
        game.dayTime = DUSK; tick();
        assert.equal(banners[0][0], 'The First Wolf is hunting tonight');
        assert.match(banners[0][1], /comes at midnight with 4 of its pack/);
        assert.equal(raids.blocksSleep(), true);
        game.dayTime = MIDNIGHT; tick();
        assert.equal(animals.animals.length, FIRST_WOLF.escort + 1, 'wolves, though this is the desert');
        assert.ok(animals.animals.every(animal => animal.kind === 'wolf'));
        const first = animals.animals.find(animal => animal.first);
        assert.deepEqual([first.health, first.maxHealth, first.mesh.scaling.x, wolfBite(first), wolfName(first)],
            [FIRST_WOLF.health, FIRST_WOLF.health, FIRST_WOLF.size, FIRST_WOLF.bite, 'the First Wolf']);
        assert.equal(notes.at(-1), 'The First Wolf is here');
        assert.deepEqual(raids.boss, {legend: {name: 'The First Wolf'}, animal: first}, 'its name and health go across the top of the screen');
        // It bites as itself.
        first.mesh.position.set(camera.position.x + 1.5, 2, camera.position.z);
        for (let i = 0; i < 4; i++) animals.update();
        assert.ok(bites.some(([amount, from]) => amount === FIRST_WOLF.bite && from === 'the First Wolf'));

        // Killing the escort is not enough.
        const escort = animals.animals.filter(animal => !animal.first);
        slay(escort[0]); slay(escort[1]);
        tick();
        assert.ok(raids.fight, 'the hunt goes on while it stands');
        assert.equal(endings(), 0);
        // When it falls, the rest scatter and the story is over.
        slay(first);
        assert.match(notes.join('|'), /Hunted the First Wolf/);
        assert.equal(raids.boss, null);
        tick();
        assert.equal(raids.fight, null);
        assert.equal(animals.animals.length, 0, 'the last two have gone');
        assert.deepEqual(banners.at(-1), ['The First Wolf is broken', "The First Wolf's Tooth lies where it fell · the Wilds are yours"]);
        assert.equal(endings(), 1);
        assert.equal(raids.crowned, 9);
        assert.deepEqual(drops.at(-1).options, {level: FIRST_WOLF.level, luck: .4, slot: 'charm', minRarity: 'legendary'});
        assert.equal(drops.at(-1).item.name, "The First Wolf's Tooth");
        assert.equal(game.progression.stats.firstWolf, 1);
        assert.equal(STAT_LABELS.firstWolf, 'First Wolf broken');
        assert.equal(raids.blocksSleep(), false);

        // The game goes on: the next pack night is an ordinary pack.
        game.dayCount = 12; game.dayTime = MIDNIGHT; tick();
        assert.ok(animals.animals.length >= 3 && animals.animals.every(animal => !animal.first));
        assert.equal(animals.animals[0].kind, 'scorpion', 'the desert\'s own again');
        assert.equal(endings(), 1);
    } finally { engine.dispose(); }
});

test('outlasted or outrun, the First Wolf comes back on the next pack night', () => {
    const {engine, game, animals, raids, tick, allSlain, endings} = world(9);
    try {
        allSlain();
        game.dayTime = MIDNIGHT; tick();
        assert.ok(animals.animals.some(animal => animal.first));
        game.dayCount = 10; game.dayTime = 5; tick();
        assert.equal(raids.fight, null);
        assert.deepEqual([raids.crowned, endings(), game.progression.stats.firstWolf], [0, 0, 0], 'dawn saves you, and wins nothing');
        assert.equal(animals.animals.length, 0);
        assert.equal(raids.finaleDue, true);
        game.dayCount = nextRaidDay(10); game.dayTime = MIDNIGHT; tick();
        assert.ok(animals.animals.some(animal => animal.first), 'it is back');
    } finally { engine.dispose(); }
});

test('the field notes end with the legends and the First Wolf, and a save remembers the ending', () => {
    const ids = QUESTS.map(quest => quest.id);
    assert.deepEqual(ids.slice(-3), ['veteran', 'legends', 'firstwolf'], 'the last two notes');
    const {engine, game, raids, tick, slay, allSlain, animals} = world(9);
    try {
        const [legends, firstwolf] = QUESTS.slice(-2);
        assert.equal(legends.done(game), false);
        assert.equal(legends.progress(game), '0 of 3');
        game.progression.stats.legends = 2;
        assert.equal(legends.done(game), false, 'two is not three');
        assert.equal(legends.progress(game), '2 of 3');
        game.progression.stats.legends = 3;
        assert.equal(legends.done(game), true);
        assert.equal(firstwolf.done(game), false);
        assert.equal(firstwolf.progress(game), 'It hunts tonight');
        game.dayCount = 10;
        assert.equal(firstwolf.progress(game), 'It hunts on the night of day 12');
        game.dayCount = 9;
        allSlain();
        game.dayTime = MIDNIGHT; tick();
        slay(animals.animals.find(animal => animal.first)); tick();
        assert.equal(firstwolf.done(game), true);

        const items = new Map();
        const storage = {setItem(key, value) { items.set(key, value); }, getItem(key) { return items.get(key) || null; }, removeItem(key) { items.delete(key); }};
        const saves = game.saveSystem = new SaveSystem(game, storage);
        assert.deepEqual(raids.capture(), {warned: 9, struck: 9, crowned: 9});
        assert.equal(saves.save(), true);
        raids.restore(null);
        assert.deepEqual(raids.capture(), {warned: 0, struck: 0}, 'an expedition that has not ended saves no ending');
        assert.equal(raids.finaleDue, true);
        assert.equal(saves.load(), true);
        assert.equal(raids.crowned, 9);
        assert.equal(raids.finaleDue, false, 'it does not come twice');
        raids.restore({crowned: -4}); assert.equal(raids.crowned, 0);
        raids.restore({crowned: 'yes'}); assert.equal(raids.crowned, 0);
    } finally { engine.dispose(); }
});

test('once tonight\'s pack has been, the next pack night is three days on', () => {
    const {engine, game, raids, tick} = world(9);
    try {
        assert.equal(raids.next, 9);
        game.dayTime = MIDNIGHT; tick();
        assert.equal(raids.next, 12, 'not "tonight" again');
        game.dayCount = 10;
        assert.equal(raids.next, 12);
    } finally { engine.dispose(); }
});
