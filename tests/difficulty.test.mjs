// Tests for the difficulty setting: what each level changes, and that it
// reaches blows, needs, pack nights and alphas through the real systems.
import test from 'node:test';
import assert from 'node:assert/strict';
import BABYLON from 'babylonjs';
import { DIFFICULTIES, DIFFICULTY, difficultyOf } from '../js/difficulty.js';
import { DEFAULT_SETTINGS, normalizeSettings, loadSettings, saveSettings } from '../js/settings.js';
import { raidPack } from '../js/raids.js';
import { ALPHA } from '../js/creatures.js';
import { RaidSystem } from '../js/components/raids.js';
import { AnimalSystem } from '../js/components/animals.js';
import { InventorySystem } from '../js/components/inventory.js';
import { CombatSystem } from '../js/components/combat.js';
import { PlayerSystem } from '../js/components/player.js';
import { SurvivalSystem } from '../js/components/survival.js';
import { ProgressionSystem } from '../js/components/progression.js';

globalThis.BABYLON = BABYLON;
const close = (a, b, slack = 1e-6) => Math.abs(a - b) <= slack;

function world(difficulty) {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    engine.getDeltaTime = () => 50;
    scene.getAnimationRatio = () => 1;
    const game = {
        scene, engine, paused: false, dayTime: 75, dayLength: 300, dayCount: 5,
        settings: normalizeSettings(difficulty === undefined ? null : {difficulty}),
        audio: {play() {}},
        uiSystem: {showNotification() {}, showLoot() {}, updateInventoryUI() {}, updateExperienceUI() {}, updateHealthUI() {},
            updateGearUI() {}, showLevelUpMessage() {}, setSaveStatus() {}, showDayBanner() {}, showDeathSummary() {}},
        terrainSystem: {waterHeight: 1, getPerlinHeight: () => 2, isWaterArea: () => false, isWithinSpawnArea: () => false, chunkMap: new Map()},
        explorationSystem: {discovered: new Set(), isClearing: () => false},
        dungeonSystem: {active: false, runs: {}},
        regions: {current: 'meadow', strength: 0, coldRate: () => 0, thirstFactor: () => 1},
        weatherSystem: {type: 'clear', form: 'clear'},
        buildSystem: {isProtected: () => false},
        registerModelShadow() {},
        effects: {torchLit: false, strike() {}, burst() {}, hurt() {}}
    };
    const player = game.playerSystem = Object.create(PlayerSystem.prototype);
    const camera = new BABYLON.FreeCamera('body', new BABYLON.Vector3(0, 4, 0), scene);
    Object.assign(player, {game, camera, isDead: false, health: 1000, maxHealth: 1000, isGrounded: true, isFlying: false, poisonLeft: 0, keys: {sprint: false}});
    game.inventorySystem = new InventorySystem(game);
    game.combatSystem = new CombatSystem(game);
    game.survivalSystem = new SurvivalSystem(game);
    game.progression = new ProgressionSystem(game);
    const animals = game.animalSystem = new AnimalSystem(game);
    animals.animals = [];
    animals.spawnTimer = 1e9;
    return {engine, game, player, animals};
}

test('three levels, Standard by default, and the setting survives bad data', () => {
    assert.deepEqual(DIFFICULTIES, ['gentle', 'standard', 'harsh']);
    assert.deepEqual(Object.keys(DIFFICULTY), DIFFICULTIES);
    assert.equal(DEFAULT_SETTINGS.difficulty, 'standard');
    assert.deepEqual({damage: 1, needs: 1, pack: 0, alphas: true}, (({damage, needs, pack, alphas}) => ({damage, needs, pack, alphas}))(DIFFICULTY.standard), 'Standard changes nothing');
    const {gentle, harsh} = DIFFICULTY;
    assert.ok(gentle.damage < 1 && gentle.needs < 1 && gentle.pack < 0 && gentle.alphas === false);
    assert.ok(harsh.damage > 1 && harsh.needs > 1 && harsh.pack > 0 && harsh.alphas === true);
    for (const id of DIFFICULTIES) { assert.ok(DIFFICULTY[id].label && DIFFICULTY[id].note.length > 10); }
    assert.match(gentle.note, /40% less.*30% slower.*one short/);
    assert.match(harsh.note, /40% more.*quarter faster.*one stronger/);
    for (const junk of [null, {}, {difficulty: 'nightmare'}, {difficulty: 3}, 'x']) {
        assert.equal(normalizeSettings(junk).difficulty, 'standard');
        assert.equal(difficultyOf(junk), DIFFICULTY.standard);
    }
    assert.equal(normalizeSettings({difficulty: 'gentle'}).difficulty, 'gentle');
    assert.equal(difficultyOf({difficulty: 'harsh'}), harsh);
    const items = new Map(), storage = {setItem(k, v) { items.set(k, v); }, getItem(k) { return items.get(k) || null; }};
    assert.equal(saveSettings({...DEFAULT_SETTINGS, difficulty: 'harsh'}, storage), true);
    assert.equal(loadSettings(storage).difficulty, 'harsh', 'kept with the other device settings, apart from the expedition');
});

test('a blow is scaled by the level; hunger, thirst and the cold are not blows', () => {
    const taken = (difficulty, cause) => {
        const {engine, player} = world(difficulty);
        try { player.takeDamage(20, cause); return 1000 - player.health; } finally { engine.dispose(); }
    };
    assert.ok(close(taken('standard', 'a wolf'), 20));
    assert.ok(close(taken(undefined, 'a wolf'), 20));
    assert.ok(close(taken('gentle', 'a wolf'), 20 * DIFFICULTY.gentle.damage));
    assert.ok(close(taken('harsh', 'a wolf'), 20 * DIFFICULTY.harsh.damage));
    assert.ok(close(taken('harsh', 'an alpha wolf'), 28));
    for (const cause of ['starvation', 'thirst', 'the cold', 'drowning', 'a long fall', 'venom']) {
        assert.ok(close(taken('gentle', cause), 20), cause);
        assert.ok(close(taken('harsh', cause), 20), cause);
    }
});

test('hunger, thirst and the cold build at the level\'s pace, and warming up is never slowed', () => {
    const tick = (difficulty, night, safe = false) => {
        const {engine, game} = world(difficulty);
        try {
            game.dayTime = night ? 225 : 75;
            game.buildSystem.isProtected = () => safe;
            const survival = game.survivalSystem;
            survival.hunger = 80; survival.thirst = 80; survival.cold = 40;
            for (let i = 0; i < 200; i++) survival.update(.05);
            return {hunger: 80 - survival.hunger, thirst: 80 - survival.thirst, cold: survival.cold - 40};
        } finally { engine.dispose(); }
    };
    const standard = tick('standard', true), gentle = tick('gentle', true), harsh = tick('harsh', true);
    assert.ok(standard.hunger > 0 && standard.thirst > 0 && standard.cold > 5);
    for (const need of ['hunger', 'thirst', 'cold']) {
        assert.ok(close(gentle[need] / standard[need], DIFFICULTY.gentle.needs, .001), 'gentle ' + need);
        assert.ok(close(harsh[need] / standard[need], DIFFICULTY.harsh.needs, .001), 'harsh ' + need);
    }
    // By a fire the cold lifts at the same rate whatever the level.
    const warm = ['gentle', 'standard', 'harsh'].map(level => tick(level, true, true).cold);
    assert.ok(warm[0] < -10 && close(warm[0], warm[1]) && close(warm[1], warm[2]));
});

test('packs come one short on Gentle and one stronger on Harsh, never fewer than two', () => {
    assert.equal(raidPack(3, 'meadow', 0).size, 3);
    assert.equal(raidPack(3, 'meadow', -1).size, 2);
    assert.equal(raidPack(3, 'meadow', 1).size, 4);
    assert.equal(raidPack(3, 'meadow', -9).size, 2);
    assert.equal(raidPack(12, 'tundra', 1).size, raidPack(12, 'tundra').size + 1);
    assert.equal(raidPack(3, 'meadow', 'lots').size, 3);
    for (const extra of [-1, 0, 1]) { const pack = raidPack(9, 'marsh', extra); assert.equal(pack.members.length, pack.size); assert.equal(pack.members.filter(one => one.elite).length, 1); }
    // Through the real system on the first pack night.
    for (const [level, size] of [['gentle', 2], ['standard', 3], ['harsh', 4]]) {
        const {engine, game, animals} = world(level);
        try {
            game.dayCount = 3; game.dayTime = 226;
            const banners = [];
            game.uiSystem.showDayBanner = (title, text) => banners.push(text);
            const raids = game.raids = new RaidSystem(game);
            raids.update(1);
            assert.equal(animals.animals.length, size, level);
            assert.match(banners[0], new RegExp(`^${size} wolves will come`), 'and the warning says the same number');
        } finally { engine.dispose(); }
    }
});

test('no alpha comes on an ordinary night on Gentle', () => {
    const night = level => {
        const {engine, game, animals} = world(level);
        try {
            game.dayCount = 10; game.dayTime = 230;
            const rolls = [.3, 0], random = Math.random;
            let n = 0;
            Math.random = () => rolls[n++ % rolls.length];
            try { for (let i = 0; i < 400 && animals.animals.filter(a => a.kind === 'wolf').length < 3; i++) { animals.spawnTimer = 0; animals.update(); } } finally { Math.random = random; }
            const wolves = animals.animals.filter(a => a.kind === 'wolf');
            return {wolves: wolves.length, alphas: wolves.filter(a => a.elite).length};
        } finally { engine.dispose(); }
    };
    assert.ok(ALPHA.chance > 0);
    const gentle = night('gentle'), standard = night('standard'), harsh = night('harsh');
    assert.ok(gentle.wolves >= 2 && standard.wolves >= 2 && harsh.wolves >= 2, 'wolves still come');
    assert.deepEqual([gentle.alphas, standard.alphas, harsh.alphas], [0, 1, 1]);
});
