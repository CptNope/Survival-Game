// Tests for the seasons: the calendar, what each season does to the player,
// the garden, the wild and the weather, and how the land changes colour.
import test from 'node:test';
import assert from 'node:assert/strict';
import BABYLON from 'babylonjs';
import {
    SEASON_DAYS, SEASON_IDS, YEAR_DAYS, TURN_DAYS, LOOK_STEPS, SEASONS, WILD_PLANTS, SKY_LABELS,
    seasonAt, seasonEnd, calendarLine, dawnMessage, grownDays, readyAt, regrown, precipitation, seasonChill,
    foliageColor, seasonBlend, seasonLook
} from '../js/seasons.js';
import { REGIONS, groundColor, regionAt, regionWeights } from '../js/regions.js';
import { CROPS, growth, ripeIn } from '../js/homestead.js';
import { REGROW_DAYS, RESOURCES } from '../js/resources.js';
import { CREATURES } from '../js/creatures.js';
import { WeatherSystem, weatherAt } from '../js/components/weather.js';
import { SeasonSystem } from '../js/components/seasons.js';
import { TerrainSystem } from '../js/components/terrain.js';
import { SurvivalSystem } from '../js/components/survival.js';
import { PlayerSystem } from '../js/components/player.js';
import { InventorySystem } from '../js/components/inventory.js';
import { CombatSystem } from '../js/components/combat.js';
import { BuildingSystem } from '../js/components/building.js';
import { AnimalSystem } from '../js/components/animals.js';
import { GardenSystem } from '../js/components/homestead.js';
import { ProgressionSystem, STAT_LABELS } from '../js/components/progression.js';
import { SaveSystem } from '../js/components/save.js';
import { ModelPool } from '../js/models/pool.js';
import { createTreeModel, createRockModel, tintFoliage } from '../js/models/wilderness.js';
import { normalizeSettings } from '../js/settings.js';

globalThis.BABYLON = BABYLON;

const FIRST = {spring: 1, summer: 4, autumn: 7, winter: 10};
const close = (a, b, slack = 1e-9) => Math.abs(a - b) <= slack;
const colours = mesh => Array.from(mesh.getVerticesData(BABYLON.VertexBuffer.ColorKind));
// Colours live in 32-bit buffers, so "the same" means to five places.
const alike = (a, b, message) => {
    assert.equal(a.length, b.length, message);
    for (let i = 0; i < a.length; i++) assert.ok(close(a[i], b[i], 1e-5), message);
};

// Real systems on the headless engine, standing in the open in the Greenwood.
function world(day = 1) {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    engine.getDeltaTime = () => 50;
    const notes = [], banners = [], sounds = [];
    const game = {
        scene, engine, paused: false, dayTime: 60, dayLength: 300, dayCount: day, settings: normalizeSettings(null),
        audio: {play(name) { sounds.push(name); }},
        uiSystem: {
            showNotification(message) { notes.push(message); }, showLoot() {}, updateInventoryUI() {}, updateExperienceUI() {},
            updateHealthUI() {}, updateGearUI() {}, showLevelUpMessage() {}, setSaveStatus() {}, updateWeatherUI() {},
            showDayBanner(title, text) { banners.push([title, text]); }, showGatherProgress() {}
        },
        terrainSystem: {
            waterHeight: 1, getPerlinHeight: () => 2, isWaterArea: () => false, isWithinSpawnArea: () => false,
            harvestedIds: new Set(), harvestedOn: new Map(), chunkMap: new Map(), checkChunkUpdates() {}
        },
        explorationSystem: {discovered: new Set(), isClearing: () => false},
        dungeonSystem: {active: false, runs: {}},
        regions: {current: 'meadow', strength: 0, coldRate: () => 0, thirstFactor: () => 1},
        registerModelShadow() {},
        effects: {torchLit: false, strike() {}, burst() {}}
    };
    const player = game.playerSystem = Object.create(PlayerSystem.prototype);
    const camera = new BABYLON.FreeCamera('body', new BABYLON.Vector3(0, 4, 0), scene);
    Object.assign(player, {game, camera, isDead: false, health: 100, maxHealth: 100, isGrounded: true, isFlying: false,
        poisonLeft: 0, keys: {sprint: false}, takeDamage() {}});
    game.inventorySystem = new InventorySystem(game);
    game.combatSystem = new CombatSystem(game);
    game.buildSystem = new BuildingSystem(game);
    game.progression = new ProgressionSystem(game);
    game.weatherSystem = {type: 'clear', form: 'clear', refresh() {}};
    game.survivalSystem = new SurvivalSystem(game);
    game.seasons = new SeasonSystem(game);
    return {engine, scene, game, player, camera, notes, banners, sounds};
}

// --- The calendar ------------------------------------------------------------
test('the year is four seasons of three days, starting with spring on day 1', () => {
    assert.deepEqual(SEASON_IDS, ['spring', 'summer', 'autumn', 'winter']);
    assert.equal(YEAR_DAYS, SEASON_DAYS * 4);
    assert.deepEqual(Object.keys(SEASONS), SEASON_IDS);
    for (const [id, first] of Object.entries(FIRST)) {
        for (let n = 0; n < SEASON_DAYS; n++) {
            const at = seasonAt(first + n);
            assert.equal(at.id, id);
            assert.equal(at.def, SEASONS[id]);
            assert.equal(at.day, n + 1);
            assert.equal(at.daysLeft, SEASON_DAYS - n);
            assert.equal(at.year, 1);
        }
        assert.equal(seasonAt(first + YEAR_DAYS * 3).id, id, 'the same day of every year');
        assert.equal(seasonAt(first + .99).id, id, 'the hour does not matter');
        assert.equal(seasonEnd(first + 1.4), first + SEASON_DAYS);
    }
    assert.equal(seasonAt(13).year, 2);
    assert.deepEqual(SEASON_IDS.map(id => seasonAt(FIRST[id]).next), ['summer', 'autumn', 'winter', 'spring']);
    // Nonsense in a save is the first morning, not a crash.
    for (const junk of [0, -4, NaN, undefined, Infinity, '7']) {
        const at = seasonAt(junk);
        assert.ok(SEASON_IDS.includes(at.id), String(junk));
        assert.ok(at.day >= 1 && at.day <= SEASON_DAYS);
    }
    assert.equal(seasonAt(NaN).id, 'spring');
});

test('the calendar says what is coming, and dawn only speaks up when it matters', () => {
    assert.equal(calendarLine(8), 'Autumn, day 2 of 3 · Winter in 2 days');
    assert.equal(calendarLine(9), 'Autumn, day 3 of 3 · Winter comes tomorrow');
    assert.equal(calendarLine(12), 'Winter, day 3 of 3 · Spring comes tomorrow');
    assert.equal(calendarLine(1), 'Spring, day 1 of 3 · Summer in 3 days');
    for (const id of SEASON_IDS) {
        const message = dawnMessage(FIRST[id]);
        assert.ok(message.startsWith(SEASONS[id].name + ' has come · '), message);
        assert.ok(message.endsWith(SEASONS[id].note));
        assert.equal(dawnMessage(FIRST[id] + 1), null, 'nothing to say in the middle of a season');
    }
    assert.match(dawnMessage(9), /^Winter comes tomorrow · gather/);
    assert.equal(dawnMessage(3), 'Summer comes tomorrow');
    assert.equal(dawnMessage(12), 'Spring comes tomorrow');
});

// --- Growing -------------------------------------------------------------------
test('growing is counted at each season\'s pace, across seasons and across years', () => {
    assert.equal(grownDays(4, 5.5), 1.5, 'summer is the plain rate');
    assert.equal(grownDays(1, 2), SEASONS.spring.crops);
    assert.equal(grownDays(10, 12), 2 * SEASONS.winter.crops);
    assert.ok(SEASONS.spring.crops > 1 && SEASONS.winter.crops < .5 && SEASONS.winter.crops > 0, 'a winter bed still creeps along');
    // Half a day of autumn and half a day of winter.
    assert.ok(close(grownDays(9.5, 10.5), .5 * SEASONS.autumn.crops + .5 * SEASONS.winter.crops));
    assert.equal(grownDays(5, 5), 0);
    assert.equal(grownDays(8, 5), 0, 'a clock that ran backwards grows nothing');
    assert.equal(grownDays(NaN, 3), grownDays(1, 3));
    // A whole year is the sum of its seasons, however it is walked.
    const year = SEASON_IDS.reduce((sum, id) => sum + SEASONS[id].crops * SEASON_DAYS, 0);
    assert.ok(close(grownDays(1, 1 + YEAR_DAYS), year));
    assert.ok(close(grownDays(5.3, 5.3 + YEAR_DAYS * 40), year * 40, 1e-6));
    let stepped = 0;
    for (let at = 2.25; at < 2.25 + YEAR_DAYS * 3; at += .25) stepped += grownDays(at, at + .25);
    assert.ok(close(grownDays(2.25, 2.25 + YEAR_DAYS * 3), stepped, 1e-6));
    // Wild plants stop dead in winter and hurry in spring.
    assert.equal(grownDays(10, 13, 'wild'), 0);
    assert.equal(grownDays(1, 2, 'wild'), 2);
});

test('readyAt is the moment the growing is done, whatever seasons lie between', () => {
    for (const pace of ['crops', 'wild']) {
        for (let from = 1; from < 1 + YEAR_DAYS; from += .7) {
            for (const needed of [.25, 1, 1.5, 2, 3, 5, 9, 30]) {
                const ready = readyAt(from, needed, pace);
                assert.ok(ready > from && Number.isFinite(ready));
                assert.ok(close(grownDays(from, ready, pace), needed, 1e-6), `${pace} from ${from} needing ${needed}`);
                assert.ok(grownDays(from, ready - .01, pace) < needed, 'and not a moment sooner');
            }
        }
    }
    assert.equal(readyAt(4, 1.5), 5.5);
    assert.equal(readyAt(6, 0), 6);
    assert.equal(readyAt(10, 1, 'wild'), 13.5, 'nothing wild grows until spring, then it grows fast');
    // Garden beds: quick in spring, slow in winter, and the words keep up.
    assert.equal(growth(2, 1, 'berries'), 1, 'a day of spring ripens berries');
    assert.equal(growth(11.5, 10, 'berries'), .25);
    assert.equal(ripeIn(1, 1, 'berries'), 'about a day');
    assert.equal(ripeIn(10, 10, 'berries'), 'about 4 days', 'three slow days of winter, then spring finishes the job');
    assert.equal(CROPS.berries.days, 1.5);
});

test('gathered plants wait out the winter; trees, rock and ore keep their own time', () => {
    assert.deepEqual([...WILD_PLANTS].sort(), ['berry', 'cactus', 'fiber', 'herb', 'mushroom']);
    const back = (type, since) => {
        for (let day = since; day < since + 40; day++) if (regrown(type, since, day, REGROW_DAYS[type])) return day - since;
        return Infinity;
    };
    assert.equal(back('berry', 4), 2, 'summer: the usual two days');
    assert.equal(back('berry', 7), 2);
    assert.equal(back('berry', 1), 1, 'spring: half the time');
    assert.equal(back('cactus', 1), 2);
    assert.equal(back('berry', 10), 4, 'gathered on the first day of winter: back on the first full day of spring');
    assert.equal(back('herb', 12), 2);
    assert.equal(back('berry', 9), 5, 'one day of autumn is not enough, and then it snows');
    for (const since of [1, 4, 7, 10, 12]) {
        assert.equal(back('tree', since), REGROW_DAYS.tree);
        assert.equal(back('rock', since), REGROW_DAYS.rock);
        assert.equal(back('ore', since), REGROW_DAYS.ore);
    }
    assert.equal(regrown('berry', 5, 4, 2), false);
});

test('the terrain uses the rule: a bush picked in winter is still bare at the next dawn', () => {
    const terrain = Object.create(TerrainSystem.prototype);
    Object.assign(terrain, {harvestedIds: new Set(['1,1:berry:0', '1,1:tree:0']), harvestedOn: new Map([['1,1:berry:0', 10], ['1,1:tree:0', 10]])});
    assert.deepEqual(terrain.expireRegrown(12), []);
    assert.deepEqual(terrain.expireRegrown(13), ['1,1:tree:0'], 'the tree is back after its three days');
    assert.deepEqual(terrain.expireRegrown(13), []);
    assert.deepEqual(terrain.expireRegrown(14), ['1,1:berry:0'], 'the bush waits for spring');
    assert.equal(terrain.harvestedIds.size, 0);
});

// --- Weather and cold ------------------------------------------------------------
test('each season has its own skies, and the first morning is still dry', () => {
    const share = id => {
        const tally = {clear: 0, rain: 0, storm: 0};
        for (let year = 0; year < 30; year++) for (let n = 0; n < SEASON_DAYS; n++) for (let time = 0; time < 300; time += 75) {
            const day = FIRST[id] + n + year * YEAR_DAYS;
            if (day > 1) tally[weatherAt(day, time)]++;
        }
        const total = tally.clear + tally.rain + tally.storm;
        return Object.fromEntries(Object.entries(tally).map(([kind, count]) => [kind, count / total]));
    };
    const spring = share('spring'), summer = share('summer'), autumn = share('autumn'), winter = share('winter');
    assert.ok(summer.clear > .6 && summer.clear > spring.clear + .15 && summer.clear > winter.clear, 'summer is the clear season');
    assert.ok(spring.rain > autumn.rain + .08 && spring.rain > summer.rain + .2, 'spring is the wet one');
    assert.ok(autumn.storm > spring.storm + .08 && autumn.storm > summer.storm + .08, 'autumn has the storms');
    for (const season of [spring, summer, autumn, winter]) for (const kind of ['clear', 'rain', 'storm']) assert.ok(season[kind] > .05, 'every season sees every kind');
    for (let time = 0; time < 150; time += 10) assert.equal(weatherAt(1, time), 'clear');
    for (const id of SEASON_IDS) {
        const [clear, wet] = SEASONS[id].skies;
        assert.ok(clear >= 1 && wet > clear && wet < 7);
    }
});

test('rain falls as snow in winter and in Frostfell, but not deep in the desert', () => {
    assert.equal(precipitation('rain', 'winter'), 'snow');
    assert.equal(precipitation('storm', 'winter'), 'blizzard');
    assert.equal(precipitation('clear', 'winter'), 'clear');
    for (const season of ['spring', 'summer', 'autumn']) {
        assert.equal(precipitation('rain', season, 'meadow', 0), 'rain');
        assert.equal(precipitation('storm', season, 'marsh', 1), 'storm');
        assert.equal(precipitation('rain', season, 'tundra', 1), 'snow', 'Frostfell never sees rain');
        assert.equal(precipitation('storm', season, 'tundra', .8), 'blizzard');
        assert.equal(precipitation('rain', season, 'tundra', .2), 'rain', 'at its edge the snow turns to rain');
    }
    assert.equal(precipitation('rain', 'winter', 'desert', 1), 'rain');
    assert.equal(precipitation('storm', 'winter', 'desert', .9), 'storm');
    assert.equal(precipitation('rain', 'winter', 'desert', .2), 'snow');
    assert.equal(precipitation('rain', 'winter', 'marsh', 1), 'snow');
    assert.equal(precipitation('fog', 'winter'), 'clear');
    assert.deepEqual(Object.keys(SKY_LABELS).sort(), ['blizzard', 'clear', 'rain', 'snow', 'storm']);

    // The weather system reports what is falling where the player stands.
    const wet = (id, kind) => {
        for (let year = 0; year < 50; year++) for (let n = 0; n < SEASON_DAYS; n++) for (let time = 0; time < 300; time += 75) {
            const day = FIRST[id] + n + year * YEAR_DAYS;
            if (day > 1 && weatherAt(day, time) === kind) return [day, time];
        }
    };
    const labels = [];
    const game = {dayLength: 300, regions: {current: 'meadow', strength: 0}, uiSystem: {updateWeatherUI(label) { labels.push(label); }}};
    [game.dayCount, game.dayTime] = wet('winter', 'rain');
    const weather = new WeatherSystem(game);
    assert.deepEqual([weather.type, weather.form, weather.label], ['rain', 'snow', 'Snow']);
    assert.equal(labels.at(-1), 'Snow');
    game.regions = {current: 'desert', strength: 1};
    weather.refresh();
    assert.deepEqual([weather.type, weather.form, weather.label], ['rain', 'rain', 'Rain'], 'walking into the desert turns it to rain');
    [game.dayCount, game.dayTime] = wet('winter', 'storm');
    game.regions = {current: 'marsh', strength: 1};
    weather.refresh();
    assert.deepEqual([weather.type, weather.form, weather.label], ['storm', 'blizzard', 'Blizzard']);
    [game.dayCount, game.dayTime] = wet('summer', 'rain');
    weather.refresh();
    assert.equal(weather.form, 'rain');
    game.regions = {current: 'tundra', strength: 1};
    weather.refresh();
    assert.equal(weather.form, 'snow');
});

test('winter is cold at noon, summer nights are mild, and none of it reaches underground', () => {
    assert.equal(seasonChill('winter'), SEASONS.winter.chill);
    assert.ok(SEASONS.winter.chill > 0);
    for (const id of ['spring', 'summer', 'autumn']) assert.equal(seasonChill(id), 0);
    assert.equal(seasonChill('winter', 'desert', 0), SEASONS.winter.chill);
    assert.ok(close(seasonChill('winter', 'desert', 1), SEASONS.winter.chill * .25));
    assert.equal(seasonChill('winter', 'tundra', 1), SEASONS.winter.chill);
    assert.equal(seasonChill('nonsense'), 0);

    const run = (day, dayTime, seconds = 10) => {
        const {engine, game} = world(day);
        try {
            game.dayTime = dayTime;
            const survival = game.survivalSystem;
            survival.cold = 30; survival.thirst = 100;
            for (let i = 0; i < seconds * 20; i++) survival.update(.05);
            return {cold: survival.cold - 30, thirst: 100 - survival.thirst, game, survival};
        } finally { engine.dispose(); }
    };
    const NOON = 75, MIDNIGHT = 225;
    assert.ok(run(4, NOON).cold < -10, 'a summer noon warms you');
    assert.ok(run(7, NOON).cold < -10);
    assert.ok(close(run(10, NOON).cold, SEASONS.winter.chill * 10, .05), 'a winter noon chills you');
    const summerNight = run(4, MIDNIGHT).cold, autumnNight = run(7, MIDNIGHT).cold, winterNight = run(10, MIDNIGHT).cold;
    assert.ok(close(autumnNight, 6.5, .05), 'the ordinary night');
    assert.ok(close(summerNight, 6.5 * SEASONS.summer.night, .05));
    assert.ok(close(winterNight, 6.5 + SEASONS.winter.chill * 10, .05));
    assert.ok(summerNight < autumnNight && autumnNight < winterNight);
    // Thirst: quicker under the summer sun, and only then.
    assert.ok(close(run(4, NOON).thirst / run(7, NOON).thirst, SEASONS.summer.thirst, .01));
    assert.ok(close(run(4, MIDNIGHT).thirst, run(7, MIDNIGHT).thirst, .001));

    // A fur cloak halves it, a fire or roof stops it, and a dungeon has no seasons.
    const {engine, game} = world(10);
    try {
        const survival = game.survivalSystem;
        game.dayTime = NOON;
        const step = () => { survival.cold = 30; for (let i = 0; i < 200; i++) survival.update(.05); return survival.cold - 30; };
        game.inventorySystem.inventory.furCloak = 1;
        assert.ok(close(step(), SEASONS.winter.chill * 5, .05));
        game.inventorySystem.inventory.furCloak = 0;
        game.buildSystem.isProtected = () => true;
        assert.ok(step() < -10, 'by the fire the cold lifts');
        game.buildSystem.isProtected = () => false;
        game.dungeonSystem = {active: true, theme: {chill: -.25}};
        assert.ok(close(step(), -2.5, .05), 'underground it is merely cool, winter or not');
    } finally { engine.dispose(); }
});

// --- What each season gives ------------------------------------------------------
test('autumn gives one more from bushes and beds, and winter one more cut of meat', () => {
    assert.deepEqual(SEASON_IDS.map(id => SEASONS[id].forage), [0, 0, 1, 0]);
    assert.deepEqual(SEASON_IDS.map(id => SEASONS[id].game), [0, 0, 0, 1]);
    for (const id of SEASON_IDS) {
        const {engine, game} = world(FIRST[id] + YEAR_DAYS * 2);
        try {
            const seasons = game.seasons, autumn = id === 'autumn' ? 1 : 0;
            for (const type of WILD_PLANTS) assert.equal(seasons.forage(type), autumn, `${id} ${type}`);
            for (const type of ['tree', 'rock', 'ore']) assert.equal(seasons.forage(type), 0);
            assert.equal(seasons.gardenBonus(), autumn);
            assert.equal(seasons.gameBonus(), id === 'winter' ? 1 : 0);

            // A ripe bed gives its yield, plus one in autumn.
            const gardens = game.gardens = new GardenSystem(game), pack = game.inventorySystem.inventory;
            const bed = {id: 1, x: 5, z: 5};
            gardens.beds.set(bed.id, {crop: 'berries', plantedAt: game.dayCount - 20});
            gardens.refresh = () => {};
            pack.berries = 0;
            assert.equal(gardens.harvest(bed), true);
            assert.equal(pack.berries, CROPS.berries.yield + autumn, id);

            // A berry bush gives its three, plus one in autumn; a tree gives the same wood all year.
            const gather = (type, swings) => {
                const mesh = new BABYLON.Mesh(type, game.scene);
                game.pickTarget = () => ({hit: true, pickedMesh: mesh});
                game.inventorySystem.harvestableObjects.push({mesh, type, resourceId: `0,0:${type}:1`});
                for (let n = 0; n < swings; n++) { game.inventorySystem.nextSwingAt = 0; game.inventorySystem.tryHarvest(); }
            };
            pack.berries = 0; pack.wood = 0;
            gather('berry', 1);
            assert.equal(pack.berries, RESOURCES.berry.yields.berries + autumn, id);
            gather('tree', 3);
            assert.equal(pack.wood, RESOURCES.tree.yields.wood, id);

            // A deer gives its meat, plus one in winter; a dungeon monster gives no more than it carries.
            const animals = game.animalSystem = new AnimalSystem(game);
            const hunt = extraState => {
                const mesh = new BABYLON.Mesh('deer', game.scene);
                animals.animals = [{kind: 'deer', mesh, ...extraState}];
                pack.rawMeat = 0;
                animals.finish(animals.animals[0], 0);
                return pack.rawMeat;
            };
            assert.equal(hunt({}), CREATURES.deer.loot.rawMeat + (id === 'winter' ? 1 : 0), id);
            assert.equal(hunt({dungeon: true}), CREATURES.deer.loot.rawMeat);
        } finally { engine.dispose(); }
    }
});

test('dawn announces a new season, warns of winter, and counts the winters seen out', () => {
    assert.equal(STAT_LABELS.winters, 'Winters seen out');
    const {engine, game, sounds} = world(9);
    try {
        const seasons = game.seasons;
        assert.match(seasons.onNewDay(), /^Winter comes tomorrow/);
        assert.equal(sounds.length, 0);
        game.dayCount = 10;
        assert.match(seasons.onNewDay(), /^Winter has come · Snow/);
        assert.deepEqual(sounds, ['discover']);
        assert.equal(seasons.calendar, 'Winter, day 1 of 3 · Spring in 3 days');
        game.dayCount = 11;
        assert.equal(seasons.onNewDay(), null);
        assert.equal(game.progression.stats.winters, 0);
        game.dayCount = 13;
        assert.match(seasons.onNewDay(), /^Spring has come/);
        assert.equal(game.progression.stats.winters, 1);
        game.dayCount = 25;
        game.playerSystem.isDead = true;
        seasons.onNewDay();
        assert.equal(game.progression.stats.winters, 1, 'not if the winter saw you out');
        // The very first morning is spring, but no winter came before it.
        game.playerSystem.isDead = false; game.dayCount = 1;
        seasons.onNewDay();
        assert.equal(game.progression.stats.winters, 1);

        // A save made in winter comes back white, with the count of winters, and no new save format.
        const items = new Map();
        const storage = {setItem(key, value) { items.set(key, value); }, getItem(key) { return items.get(key) || null; }, removeItem(key) { items.delete(key); }};
        const saves = game.saveSystem = new SaveSystem(game, storage);
        game.dayCount = 11; game.dayTime = 150;
        seasons.refresh();
        assert.equal(saves.save(), true);
        assert.equal(JSON.stringify([...items.values()]).includes('season'), false, 'the season is worked out from the day, never stored');
        game.dayCount = 5; game.progression.stats.winters = 0;
        seasons.refresh();
        assert.equal(seasons.look.key, 'summer');
        assert.equal(saves.load(), true);
        assert.equal(game.dayCount, 11);
        assert.equal(seasons.look.key, 'winter', 'repainted as the save is restored, not half a second later');
        assert.equal(seasons.look.snow, 1);
        assert.equal(game.progression.stats.winters, 1);
    } finally { engine.dispose(); }
});

// --- How it looks -----------------------------------------------------------------
test('summer is the land as it always was; winter whitens the Greenwood but not the desert', () => {
    const summer = seasonLook(5), winter = seasonLook(11), autumn = seasonLook(8), spring = seasonLook(2);
    assert.deepEqual(summer.ground.meadow, REGIONS.meadow.ground);
    assert.deepEqual(summer.grass.marsh, REGIONS.marsh.grass);
    // Find a spot wholly inside each region.
    const spots = {};
    for (let x = -1500; x <= 1500; x += 37) for (let z = -1500; z <= 1500; z += 41) {
        const id = regionAt(x, z);
        if (!spots[id] && regionWeights(x, z)[id] > .999) spots[id] = [x, z];
    }
    assert.deepEqual(Object.keys(spots).sort(), ['desert', 'marsh', 'meadow', 'tundra']);
    for (const [id, [x, z]] of Object.entries(spots)) {
        const plain = groundColor(x, z, .5);
        assert.deepEqual(groundColor(x, z, .5, summer.ground), plain, 'summer changes nothing in ' + id);
        for (const look of [spring, autumn, winter]) {
            const seasonal = groundColor(x, z, .5, look.ground);
            if (id === 'tundra' || id === 'desert') assert.deepEqual(seasonal, plain, `${id} is the same all year`);
            else assert.notDeepEqual(seasonal, plain, `${id} changes in ${look.from}`);
        }
    }
    const [mx, mz] = spots.meadow;
    const snow = groundColor(mx, mz, .5, winter.ground), leaf = groundColor(mx, mz, .5, autumn.ground), green = groundColor(mx, mz, .5);
    assert.ok(snow.every(channel => channel > .8), 'snow');
    assert.ok(leaf[0] > green[0] && leaf[0] >= leaf[1], 'autumn ground is browner than it is green');
    assert.ok(groundColor(mx, mz, .5, spring.ground)[1] > green[1], 'spring is the greenest');
    assert.deepEqual([spring, summer, autumn, winter].map(look => look.snow), [0, 0, 0, 1]);
    assert.ok(close(seasonLook(FIRST.winter + TURN_DAYS / 2).snow, .5), 'the snow settles over the first morning of winter');
    assert.ok(close(seasonLook(FIRST.spring + YEAR_DAYS + TURN_DAYS / 2).snow, .5), 'and goes over the first morning of spring');
    for (const look of [spring, summer, autumn, winter]) for (const region of ['meadow', 'marsh']) {
        assert.equal(look.grass[region].length, 4);
        assert.equal(look.ground[region].length, 2);
        for (const colour of [...look.grass[region], ...look.ground[region]]) assert.ok(colour.every(c => c >= 0 && c <= 1));
    }
});

test('the land turns over the first morning of a season, in a few steps, then holds its colours', () => {
    for (const id of SEASON_IDS) {
        // The second year, so that spring has a winter before it.
        const first = FIRST[id] + YEAR_DAYS, before = SEASON_IDS[(SEASON_IDS.indexOf(id) + 3) % 4];
        const keys = [];
        let last = 0;
        for (let at = first; at < first + TURN_DAYS; at += .001) {
            const blend = seasonBlend(at);
            assert.ok(blend.t >= last, 'it only ever moves towards the new season');
            last = blend.t;
            assert.deepEqual([blend.from, blend.to], [before, id]);
            if (keys.at(-1) !== blend.key) keys.push(blend.key);
        }
        assert.equal(keys.length, LOOK_STEPS + 1, 'the old look, then one repaint per step');
        assert.equal(keys[0], before, 'dawn still wears the old season');
        assert.equal(keys.at(-1), id);
        for (let at = first + TURN_DAYS; at < first + SEASON_DAYS; at += .05) {
            const blend = seasonBlend(at);
            assert.equal(blend.key, id, 'and by noon it has settled until the season ends');
            assert.equal(blend.t, 1);
        }
        // Halfway through the morning the ground is between the two.
        const old = seasonLook(first - 1).ground.meadow[0], settled = seasonLook(first + 1).ground.meadow[0];
        const middle = seasonLook(first + TURN_DAYS / 2).ground.meadow[0];
        for (let c = 0; c < 3; c++) assert.ok(close(middle[c], (old[c] + settled[c]) / 2, 1e-9));
        assert.deepEqual(seasonLook(first).ground.meadow, seasonLook(first - .5).ground.meadow, 'no jump at dawn');
        assert.deepEqual(seasonLook(first + TURN_DAYS).ground.meadow, seasonLook(first + 2).ground.meadow, 'no jump at noon');
    }
    // A new expedition wakes in spring, not in the tail of a winter that never was.
    for (let at = 1; at < 1 + SEASON_DAYS; at += .01) assert.equal(seasonBlend(at).key, 'spring');
    assert.equal(seasonLook(1).snow, 0);
    assert.deepEqual(seasonLook(1.01).ground.meadow, seasonLook(2).ground.meadow);
});

test('oaks blossom, turn and go white; pines only take snow; Frostfell and desert trees never change', () => {
    const base = [.35, .45, .23];
    for (let index = 0; index < 8; index++) {
        assert.equal(foliageColor('oak', index, base, 'summer'), base);
        const turned = foliageColor('oak', index, base, 'autumn');
        assert.ok(turned[0] > turned[1] && turned[1] > turned[2], 'reds, oranges and golds');
        const winter = foliageColor('oak', index, base, 'winter');
        assert.ok(winter.every(c => c > .6) && Math.max(...winter) - Math.min(...winter) < .08, 'snow or rime: pale and grey');
        assert.notDeepEqual(foliageColor('oak', index, base, 'spring'), base);
        for (const season of ['spring', 'summer', 'autumn']) assert.equal(foliageColor('pine', index, base, season), base, 'evergreen');
        assert.notDeepEqual(foliageColor('pine', index, base, 'winter'), base);
        assert.notDeepEqual(foliageColor('bogtree', index, base, 'autumn'), base);
        for (const season of SEASON_IDS) for (const kind of ['snowpine', 'deadwood', 'rock']) assert.equal(foliageColor(kind, index, base, season), base);
    }
    assert.ok(new Set([0, 1, 2, 3].map(i => foliageColor('oak', i, base, 'autumn').join())).size >= 3, 'no two neighbours the same');
    assert.ok([0, 1, 2, 3].some(i => foliageColor('oak', i, base, 'spring')[0] > .8), 'some blossom');
    // Mid-turn, a clump is between its two colours.
    const look = seasonLook(FIRST.autumn + TURN_DAYS / 2);
    const mid = look.foliage('oak', 0, base), end = foliageColor('oak', 0, base, 'autumn');
    for (let c = 0; c < 3; c++) assert.ok(close(mid[c], (base[c] + end[c]) / 2));
});

test('a tree model knows its leaves: recolouring touches them and nothing else, and can be undone', () => {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    try {
        for (const kind of ['oak', 'pine', 'bogtree']) {
            const tree = createTreeModel(scene, 4242, kind);
            const parts = tree.metadata.foliage;
            assert.ok(parts.length >= 5, kind);
            const total = tree.getTotalVertices(), leafy = new Set();
            for (const part of parts) {
                assert.ok(part.start >= 0 && part.start + part.count <= total);
                for (let v = part.start; v < part.start + part.count; v++) { assert.ok(!leafy.has(v), 'no vertex belongs to two clumps'); leafy.add(v); }
            }
            assert.ok(leafy.size > total * .2 && leafy.size < total, 'leaves and wood both');
            const built = colours(tree);
            assert.equal(tintFoliage(tree, kind, seasonLook(11).foliage), true);
            const winter = colours(tree);
            let changed = 0;
            for (let v = 0; v < total; v++) {
                const same = [0, 1, 2, 3].every(c => close(winter[v * 4 + c], built[v * 4 + c], 1e-6));
                if (leafy.has(v)) { if (!same) changed++; } else assert.ok(same, 'bark is left alone');
            }
            assert.ok(changed > leafy.size * .3, `${kind} looks different in winter`);
            // The shading of each face survives: snow is not one flat white.
            if (kind === 'oak') {
                const whites = [...leafy].map(v => winter[v * 4 + 1]).filter(g => g > .7);
                assert.ok(new Set(whites.map(g => g.toFixed(3))).size > 5);
            }
            assert.equal(tintFoliage(tree, kind, seasonLook(5).foliage), true);
            const summer = colours(tree);
            for (let i = 0; i < built.length; i++) assert.ok(close(summer[i], built[i], 1e-6), 'summer is the tree as built');
        }
        const pine = createTreeModel(scene, 7, 'pine');
        const before = colours(pine);
        tintFoliage(pine, 'pine', seasonLook(8).foliage);
        alike(colours(pine), before, 'a pine does not turn in autumn');
        assert.equal(tintFoliage(createRockModel(scene, 3), 'rock', seasonLook(11).foliage), false);
    } finally { engine.dispose(); }
});

test('the model pool repaints every tree at once, and trees made later match', () => {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    try {
        const pool = new ModelPool(scene);
        const oak = pool.spawn('oak', 3), rock = pool.spawn('rock', 2);
        const source = oak.sourceMesh, summer = colours(source), stone = colours(rock.sourceMesh);
        assert.equal(pool.retint(seasonLook(8).foliage), 1, 'one tree model so far; the rock is not counted');
        const autumn = colours(source);
        assert.notDeepEqual(autumn, summer);
        assert.deepEqual(colours(oak.sourceMesh), autumn, 'the placed copy draws from the same colours');
        assert.deepEqual(colours(rock.sourceMesh), stone);
        // A variant first needed in autumn is built in autumn colours.
        const late = pool.spawn('oak', 4).sourceMesh;
        assert.notEqual(late, source);
        const lateAutumn = colours(late);
        pool.retint(seasonLook(5).foliage);
        assert.notDeepEqual(colours(late), lateAutumn, 'and goes green with the rest');
        alike(colours(source), summer, 'the first oak is green again');
        assert.equal(pool.retint(null), 0);
    } finally { engine.dispose(); }
});

test('a loaded chunk is repainted in place: ground and grass change, heights do not', () => {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    try {
        const game = {scene, dayCount: 5, dayTime: 150, dayLength: 300, explorationSystem: {isTrail: () => false, isClearing: () => false}};
        game.seasons = new SeasonSystem(game);
        const terrain = Object.create(TerrainSystem.prototype);
        Object.assign(terrain, {scene, game, chunkSize: 32, spawnPosition: {x: 0, z: 0}, spawnHeight: 2, spawnAreaRadius: 10,
            waterHeight: 1, waterMeshes: [], chunkMap: new Map(), currentChunkX: 0, currentChunkZ: 0});
        game.terrainSystem = terrain;
        terrain.setupSharedMaterials = TerrainSystem.prototype.setupSharedMaterials;
        const chunks = [[1, 1], [2, 1], [1, 2]].map(([x, z]) => {
            const mesh = BABYLON.MeshBuilder.CreateGround(`terrain_${x}_${z}`, {width: 32, height: 32, subdivisions: 6, updatable: true}, scene);
            mesh.position.x = x * 32; mesh.position.z = z * 32;
            terrain.applyHeightMap(mesh);
            const chunk = {mesh, x, z, groundCover: terrain.createGroundCover(x, z)};
            terrain.chunkMap.set(`${x},${z}`, chunk);
            return chunk;
        });
        const snapshot = () => chunks.map(chunk => [colours(chunk.mesh), colours(chunk.groundCover),
            Array.from(chunk.mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind))]);
        const summer = snapshot();
        assert.equal(game.seasons.refresh(), false, 'nothing to do within a season');

        // Winter arrives while these chunks are loaded.
        game.dayCount = 10;
        assert.equal(game.seasons.refresh(), true);
        assert.deepEqual(game.seasons.queue, ['1,1', '2,1', '1,2'].sort((a, b) => Math.max(...a.split(',')) - Math.max(...b.split(','))), 'nearest first');
        assert.deepEqual(snapshot(), summer, 'nothing is repainted until the frames come round');
        game.seasons.timer = 9;
        game.seasons.update(.016);
        assert.equal(game.seasons.queue.length, 2, 'one chunk a frame');
        game.seasons.update(.016); game.seasons.update(.016); game.seasons.update(.016);
        assert.equal(game.seasons.queue.length, 0);
        const winter = snapshot();
        for (let i = 0; i < chunks.length; i++) {
            assert.notDeepEqual(winter[i][0], summer[i][0], 'ground');
            assert.notDeepEqual(winter[i][1], summer[i][1], 'grass');
            assert.deepEqual(winter[i][2], summer[i][2], 'the shape of the land is untouched');
            const ground = winter[i][0];
            let white = 0;
            for (let v = 0; v < ground.length; v += 4) if (ground[v] > .7 && ground[v + 1] > .7 && ground[v + 2] > .7) white++;
            assert.ok(white > ground.length / 4 * .8, 'snow on the ground');
        }
        // A chunk generated now is born in winter colours, the same as a repainted one.
        const fresh = BABYLON.MeshBuilder.CreateGround('fresh', {width: 32, height: 32, subdivisions: 6, updatable: true}, scene);
        fresh.position.x = 32; fresh.position.z = 32;
        terrain.applyHeightMap(fresh);
        alike(colours(fresh), winter[0][0], 'born in winter colours');

        // A restored save repaints everything at once, and a missing chunk is skipped.
        game.dayCount = 5;
        chunks[2].mesh.dispose();
        terrain.chunkMap.delete('1,2');
        game.seasons.queue.push('9,9');
        assert.equal(game.seasons.refresh(true), true);
        assert.equal(game.seasons.queue.length, 0);
        alike(colours(chunks[0].mesh), summer[0][0], 'back to summer ground');
        alike(colours(chunks[1].groundCover), summer[1][1], 'back to summer grass');
        assert.equal(terrain.recolorChunk(chunks[2]), false);
        assert.equal(terrain.recolorChunk(null), false);
    } finally { engine.dispose(); }
});
