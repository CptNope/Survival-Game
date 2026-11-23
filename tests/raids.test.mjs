// Tests for the hunting pack: when it comes, how strong it is, and a whole
// night of it through the real animal, combat, sleep and save systems.
import test from 'node:test';
import assert from 'node:assert/strict';
import BABYLON from 'babylonjs';
import {
    WARN_AT, STRIKE_AT, RAID_RING, RAID_SIGHT, OUTLAST_XP, RAIDERS,
    isRaidDay, raidNumber, nextRaidDay, raidPhase, raidPack, raidReward, raidOutcome, raiderName
} from '../js/raids.js';
import { SEASON_DAYS, seasonAt } from '../js/seasons.js';
import { DENS } from '../js/pois.js';
import { CREATURES } from '../js/creatures.js';
import { RaidSystem } from '../js/components/raids.js';
import { AnimalSystem } from '../js/components/animals.js';
import { InventorySystem } from '../js/components/inventory.js';
import { CombatSystem } from '../js/components/combat.js';
import { PlayerSystem } from '../js/components/player.js';
import { SurvivalSystem } from '../js/components/survival.js';
import { BuildingSystem } from '../js/components/building.js';
import { GearSystem } from '../js/components/equipment.js';
import { BuffSystem } from '../js/components/buffs.js';
import { ProgressionSystem, STAT_LABELS } from '../js/components/progression.js';
import { SaveSystem } from '../js/components/save.js';
import { normalizeSettings } from '../js/settings.js';

globalThis.BABYLON = BABYLON;

const DUSK = 300 * WARN_AT + 1, MIDNIGHT = 300 * STRIKE_AT + 1, NOON = 75;

function world(day = 3) {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    engine.getDeltaTime = () => 50;
    scene.getAnimationRatio = () => 1;
    const notes = [], banners = [], drops = [];
    const game = {
        scene, engine, paused: false, dayTime: NOON, dayLength: 300, dayCount: day, settings: normalizeSettings(null),
        audio: {play() {}},
        uiSystem: {
            showNotification(message) { notes.push(message); }, showLoot() {}, updateInventoryUI() {}, updateExperienceUI() {},
            updateHealthUI() {}, updateGearUI() {}, showLevelUpMessage() {}, setSaveStatus() {}, showGatherProgress() {},
            showDayBanner(title, text) { banners.push([title, text]); }
        },
        terrainSystem: {
            waterHeight: 1, getPerlinHeight: () => 2, isWaterArea: () => false, isWithinSpawnArea: () => false,
            harvestedIds: new Set(), harvestedOn: new Map(), chunkMap: new Map(), checkChunkUpdates() {}
        },
        explorationSystem: {discovered: new Set(), isClearing: () => false},
        dungeonSystem: {active: false, runs: {}},
        regions: {current: 'meadow', strength: 0, coldRate: () => 0, thirstFactor: () => 1},
        registerModelShadow() {},
        effects: {torchLit: false, strike() {}, burst() {}, refreshHeld() {}}
    };
    const player = game.playerSystem = Object.create(PlayerSystem.prototype);
    const camera = new BABYLON.FreeCamera('body', new BABYLON.Vector3(40, 4, -30), scene);
    Object.assign(player, {game, camera, isDead: false, health: 100, maxHealth: 100, isGrounded: true, isFlying: false,
        jumpVelocity: 0, poisonLeft: 0, keys: {jump: false, descend: false, sprint: false}});
    game.inventorySystem = new InventorySystem(game);
    game.combatSystem = new CombatSystem(game);
    game.survivalSystem = new SurvivalSystem(game);
    game.buildSystem = new BuildingSystem(game);
    game.progression = new ProgressionSystem(game);
    game.gear = new GearSystem(game);
    game.gear.dropRoll = (position, options) => { drops.push(options); return true; };
    game.buffs = new BuffSystem(game);
    game.animalSystem = new AnimalSystem(game);
    game.animalSystem.animals = [];
    const raids = game.raids = new RaidSystem(game);
    const tick = (seconds = .5) => { raids.timer = 0; raids.update(seconds); };
    const slay = animal => { animal.health = 0; game.animalSystem.finish(animal, game.animalSystem.animals.indexOf(animal)); };
    return {engine, game, camera, raids, notes, banners, drops, tick, slay};
}

// --- When, and how strong ---------------------------------------------------
test('the pack comes on the last night of every season, and never on the first two', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 9, 12, 13, 15].map(isRaidDay), [false, false, true, false, false, true, true, true, false, true]);
    for (let day = 1; day <= 60; day++) assert.equal(isRaidDay(day), seasonAt(day).daysLeft === 1, 'day ' + day);
    assert.deepEqual([3, 6, 9, 12, 30].map(raidNumber), [1, 2, 3, 4, 10]);
    assert.deepEqual([1, 3, 4, 6, 7].map(nextRaidDay), [3, 3, 6, 6, 9]);
    assert.equal(isRaidDay(NaN), false);
    assert.ok(WARN_AT < .48, 'the warning comes before night falls, so nobody is asleep for it');
    assert.ok(STRIKE_AT > WARN_AT + .2, 'and there is time to get ready');
    assert.equal(raidPhase(2, 290, 300), 'none');
    assert.equal(raidPhase(3, 10, 300), 'quiet');
    assert.equal(raidPhase(3, 300 * WARN_AT - 1, 300), 'quiet');
    assert.equal(raidPhase(3, 300 * WARN_AT, 300), 'warned');
    assert.equal(raidPhase(3, 300 * STRIKE_AT - 1, 300), 'warned');
    assert.equal(raidPhase(3, 300 * STRIKE_AT, 300), 'strike');
    assert.equal(raidPhase(3, 299, 300), 'strike');
    assert.equal(raidPhase(3, 100, 0), 'quiet');
});

test('the pack is the region\'s own hunters, grows each season, and winter\'s is the largest of its year', () => {
    assert.deepEqual(Object.keys(RAIDERS).sort(), ['desert', 'marsh', 'meadow', 'tundra']);
    for (const [region, kind] of Object.entries(RAIDERS)) {
        assert.ok(CREATURES[kind], kind);
        let last = 0;
        for (let day = SEASON_DAYS; day <= SEASON_DAYS * 12; day += SEASON_DAYS) {
            const pack = raidPack(day, region);
            assert.equal(pack.kind, kind);
            assert.equal(pack.members.length, pack.size);
            assert.ok(pack.members.every(one => one.kind === kind));
            assert.ok(pack.size >= 3 && pack.size <= 8);
            assert.ok(pack.level >= 1 && pack.level <= 6 && pack.level >= last);
            last = pack.level;
            assert.equal(pack.tier, 1 + (pack.level - 1) * .5);
            const leaders = pack.members.filter(one => one.elite).length;
            // Plain wolves have no elite form; elsewhere there is one leader from the second raid on.
            assert.equal(leaders, kind !== 'wolf' && pack.number >= 2 ? 1 : 0, `${region} raid ${pack.number}`);
            const reward = raidReward(pack, region);
            assert.equal(reward.gearLevel, pack.level + 1);
            assert.ok(reward.xp >= 55);
            assert.deepEqual(reward.spoils, region === 'meadow' ? {pelt: 2, rawMeat: 2} : DENS[region].spoils);
        }
    }
    assert.deepEqual([3, 6, 9, 12].map(day => raidPack(day).size), [3, 4, 5, 7], 'three on the first night; winter adds one');
    assert.equal(raidPack(12).size, raidPack(9).size + 2);
    assert.equal(raidPack(15).size, 7, 'spring after it is no larger');
    assert.equal(raidPack(3, 'nowhere').kind, 'wolf');
    assert.equal(raidPack(1).number, 1, 'asked early, it answers for the first raid');
    assert.equal(raiderName('wolf', 3), 'wolves');
    assert.equal(raiderName('icewolf', 1), 'ice wolf');
    assert.equal(raiderName('toad', 4), 'bog toads');
    const alive = {health: 10, present: true}, dead = {health: 0, present: false}, gone = {health: 10, present: false};
    assert.equal(raidOutcome([alive, dead]), 'fighting');
    assert.equal(raidOutcome([dead, dead]), 'broken');
    assert.equal(raidOutcome([gone, dead]), 'escaped');
    assert.equal(raidOutcome([]), 'over');
});

// --- A whole night ------------------------------------------------------------
test('warned at dusk, struck at midnight, and paid when the last of them falls', () => {
    const {engine, game, camera, raids, notes, banners, drops, tick, slay} = world(3);
    try {
        const pack = raidPack(3), bed = () => game.survivalSystem.sleepStatus();
        game.buildSystem.nearBed = () => true;
        tick();
        assert.equal(banners.length, 0, 'nothing by day');
        assert.equal(raids.blocksSleep(), false);
        game.dayTime = DUSK;
        tick(); tick();
        assert.equal(banners.length, 1, 'one warning, not one every half second');
        assert.equal(banners[0][0], 'A pack is hunting tonight');
        assert.match(banners[0][1], /^3 wolves will come for you at midnight/);
        assert.equal(game.animalSystem.animals.length, 0);
        assert.equal(raids.blocksSleep(), true);
        game.dayTime = 200;   // Night has fallen, and the bed is right there.
        assert.deepEqual([bed().ok, bed().reason], [false, 'No sleeping with a pack hunting you']);

        game.dayTime = MIDNIGHT;
        tick();
        const animals = game.animalSystem.animals;
        assert.equal(animals.length, pack.size);
        for (const animal of animals) {
            assert.equal(animal.kind, 'wolf');
            assert.equal(animal.raid, 3);
            const distance = Math.hypot(animal.mesh.position.x - camera.position.x, animal.mesh.position.z - camera.position.z);
            assert.ok(Math.abs(distance - RAID_RING) < .01, 'on a ring round the player');
        }
        const bearings = animals.map(animal => Math.atan2(animal.mesh.position.x - camera.position.x, animal.mesh.position.z - camera.position.z).toFixed(2));
        assert.equal(new Set(bearings).size, pack.size, 'from every side');
        assert.match(notes.at(-1), /^The pack is here · 3 wolves$/);
        tick(); tick();
        assert.equal(animals.length, pack.size, 'it comes once');
        assert.equal(raids.left(), 3);

        slay(animals[0]);
        assert.equal(notes.at(-1), '2 of the pack left');
        tick();
        assert.equal(raids.blocksSleep(), true);
        slay(animals[0]);
        slay(animals[0]);
        const xp = game.combatSystem.experience + game.combatSystem.level * 1e6, pelts = game.inventorySystem.inventory.pelt;
        tick();
        assert.equal(banners.at(-1)[0], 'The pack is broken');
        assert.match(banners.at(-1)[1], /^2 pelts and 2 raw meat, and something they were carrying · the next comes on day 6$/);
        assert.deepEqual(drops.at(-1), {level: raidReward(pack).gearLevel, luck: .4});
        assert.equal(game.inventorySystem.inventory.pelt, pelts + 2);
        assert.ok(game.combatSystem.experience + game.combatSystem.level * 1e6 > xp);
        assert.equal(game.progression.stats.raids, 1);
        assert.equal(STAT_LABELS.raids, 'Packs broken');
        assert.equal(raids.fight, null);
        assert.equal(raids.blocksSleep(), false, 'now you can sleep');
        assert.equal(bed().ok, true);
        tick(); tick();
        assert.equal(animals.length, 0, 'and it does not come back tonight');
        assert.equal(game.progression.stats.raids, 1);
        assert.equal(raids.next, 3);
        game.dayCount = 4; game.dayTime = MIDNIGHT;
        tick();
        assert.equal(animals.length, 0, 'nor on an ordinary night');
        assert.equal(raids.next, 6);
    } finally { engine.dispose(); }
});

test('a pack on the hunt sees further than its kind usually does', () => {
    const {engine, game, camera, raids, tick} = world(6);
    try {
        game.regions.current = 'tundra';
        game.dayTime = MIDNIGHT;
        tick();
        const pack = game.animalSystem.animals;
        assert.equal(pack.length, raidPack(6, 'tundra').size);
        assert.equal(pack.filter(animal => animal.elite).length, 1, 'a leader');
        assert.ok(pack.every(animal => animal.kind === 'icewolf' && animal.raid === 6));
        assert.ok(RAID_RING > CREATURES.icewolf.aggro && RAID_SIGHT > RAID_RING, 'they start beyond their usual sight');
        // An ordinary ice wolf at the same distance for comparison.
        const stray = game.animalSystem.spawnAnimal(camera.position.x + RAID_RING, 2, camera.position.z, 'icewolf', {});
        const start = animal => Math.hypot(animal.mesh.position.x - camera.position.x, animal.mesh.position.z - camera.position.z);
        const before = pack.slice(0, -1).map(start), strayBefore = start(stray);
        // Wandering is random; pin it so the comparison is the same every run.
        const random = Math.random;
        Math.random = () => .5;
        try { for (let i = 0; i < 40; i++) game.animalSystem.update(.05); } finally { Math.random = random; }
        const closed = pack.slice(0, -1).map((animal, n) => before[n] - start(animal));
        assert.ok(Math.min(...closed) > 4, 'every one of the pack closes in');
        assert.ok(strayBefore - start(stray) < Math.min(...closed) / 2, 'the stray has not noticed');
        assert.ok(raids.fight);
    } finally { engine.dispose(); }
});

test('outlasted, outrun, slept below ground or dead: the other ways a pack night ends', () => {
    // Dawn with wolves still standing: no gear, a little experience.
    let w = world(3);
    try {
        w.game.dayTime = MIDNIGHT; w.tick();
        w.slay(w.game.animalSystem.animals[0]);
        w.game.dayCount = 4; w.game.dayTime = 1;
        w.game.animalSystem.clearWolves(0);      // What sunrise does to distant wolves.
        w.tick();
        assert.match(w.notes.at(-1), new RegExp(`^Dawn · what is left of the pack gives up · \\+${OUTLAST_XP} XP$`));
        assert.equal(w.drops.length, 0);
        assert.equal(w.game.progression.stats.raids, 0);
        assert.equal(w.game.animalSystem.animals.length, 0);
        assert.equal(w.raids.fight, null);
    } finally { w.engine.dispose(); }

    // Left far behind: the world lets go of them and the night is over.
    w = world(3);
    try {
        w.game.dayTime = MIDNIGHT; w.tick();
        for (const animal of w.game.animalSystem.animals.splice(0)) animal.mesh.dispose();
        w.tick();
        assert.equal(w.notes.at(-1), 'You have lost the pack');
        assert.equal(w.drops.length, 0);
        assert.equal(w.raids.blocksSleep(), false);
    } finally { w.engine.dispose(); }

    // Underground at midnight: nobody to find, no warning down there, and no second visit.
    w = world(3);
    try {
        w.game.dungeonSystem.active = true;
        w.game.dayTime = DUSK; w.tick();
        w.game.dayTime = MIDNIGHT; w.tick();
        assert.equal(w.banners.length, 0);
        assert.equal(w.game.animalSystem.animals.length, 0);
        w.game.dungeonSystem.active = false;
        w.tick(); w.tick();
        assert.equal(w.game.animalSystem.animals.length, 0, 'the pack has passed by');
        assert.equal(w.raids.blocksSleep(), false);
    } finally { w.engine.dispose(); }

    // Killed by them: the survivors leave and nothing is paid.
    w = world(3);
    try {
        w.game.dayTime = MIDNIGHT; w.tick();
        w.game.playerSystem.isDead = true;
        w.tick();
        assert.equal(w.raids.fight, null);
        assert.equal(w.game.animalSystem.animals.length, 0);
        assert.equal(w.drops.length + w.game.progression.stats.raids, 0);
    } finally { w.engine.dispose(); }

    // A lake on one side: nobody is put in the water.
    w = world(3);
    try {
        const {camera} = w;
        w.game.terrainSystem.isWaterArea = x => x > camera.position.x + 2;
        w.game.dayTime = MIDNIGHT; w.tick();
        assert.equal(w.game.animalSystem.animals.length, 3);
        for (const animal of w.game.animalSystem.animals) assert.ok(animal.mesh.position.x <= camera.position.x + 2);
    } finally { w.engine.dispose(); }
});

test('a save keeps tonight\'s warning and visit, so loading does not bring the pack twice', () => {
    const {engine, game, raids, tick, slay} = world(3);
    try {
        const items = new Map();
        const storage = {setItem(key, value) { items.set(key, value); }, getItem(key) { return items.get(key) || null; }, removeItem(key) { items.delete(key); }};
        const saves = game.saveSystem = new SaveSystem(game, storage);
        game.dayTime = MIDNIGHT; tick();
        for (const animal of [...game.animalSystem.animals]) slay(animal);
        tick();
        assert.deepEqual(raids.capture(), {warned: 3, struck: 3});
        assert.equal(saves.save(), true);
        raids.restore(null);
        assert.deepEqual(raids.capture(), {warned: 0, struck: 0});
        assert.equal(saves.load(), true);
        assert.deepEqual(raids.capture(), {warned: 3, struck: 3});
        game.dayTime = MIDNIGHT;
        tick(); tick();
        assert.equal(game.animalSystem.animals.length, 0);
        assert.equal(game.progression.stats.raids, 1);
        for (const junk of [{warned: -1, struck: 'x'}, {warned: 2.5, struck: 1e9}, 'no', []]) {
            raids.restore(junk);
            assert.deepEqual(raids.capture(), {warned: 0, struck: 0});
        }
    } finally { engine.dispose(); }
});
