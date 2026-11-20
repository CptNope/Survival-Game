// Tests for points of interest: where they stand, and what a watchtower, a
// waystone, a den and a haven each do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import BABYLON from 'babylonjs';
import {
    POI_SPACING, HOME_CLEAR, DISCOVER_RADIUS, USE_RADIUS, SURVEY_RADIUS, SURVEY_SITE_RADIUS, DEN_WAKE_RADIUS, DEN_REFILL_DAYS,
    WAYSTONE_MIN, ELITE_LEVEL, POI_KINDS, DENS, HAVENS, STARTER_POIS,
    EXTRA_SPACING, EXTRA_HOME_CLEAR, EXTRA_KINDS, KIND_LABELS, SHRINES, SHRINE_SECONDS, WORTH, TRADE_MARGIN, TRADE_STOCK, GEAR_PRICE,
    poiForCell, extraForCell, wreckForLake, gridPoisNear, poisNear, poiById, surveyTargets, denPack, denReady, denOutcome, havenReady,
    travelChoices, cacheFor, tradeOffers, canAfford
} from '../js/pois.js';
import { regionAt, REGION_IDS } from '../js/regions.js';
import { dungeonsNear, STARTER_DUNGEON } from '../js/dungeon.js';
import { LEGEND_LIST, lairFor } from '../js/legends.js';
import { CREATURES } from '../js/creatures.js';
import { ITEMS } from '../js/resources.js';
import { landmarksNear, ExplorationSystem } from '../js/components/exploration.js';
import { BOONS, BuffSystem } from '../js/components/buffs.js';
import { PoiSystem } from '../js/components/pois.js';
import { createPoiModel, createCacheModel } from '../js/models/pois.js';
import { AnimalSystem } from '../js/components/animals.js';
import { InventorySystem } from '../js/components/inventory.js';
import { CombatSystem } from '../js/components/combat.js';
import { PlayerSystem } from '../js/components/player.js';
import { SurvivalSystem, WATERSKIN_CAPACITY } from '../js/components/survival.js';
import { BuildingSystem } from '../js/components/building.js';
import { GearSystem } from '../js/components/equipment.js';
import { ProgressionSystem, STAT_LABELS } from '../js/components/progression.js';
import { SaveSystem } from '../js/components/save.js';
import { normalizeSettings } from '../js/settings.js';

globalThis.BABYLON = BABYLON;

const near = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const ALL = poisNear(0, 0, 1600), GRID = gridPoisNear(0, 0, 1600);
const lake = (x, z) => Math.sin(x * .005) * Math.cos(z * .005);
const first = (kind, region) => ALL.filter(poi => poi.kind === kind && (!region || poi.region === region))
    .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];

// Real systems on the headless engine, with a real camera for the player's body.
function world() {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    engine.getDeltaTime = () => 50;
    scene.getAnimationRatio = () => 1;
    const notes = [], banners = [], sounds = [], panels = [];
    const game = {
        scene, engine, paused: false, dayTime: 60, dayLength: 300, dayCount: 1, settings: normalizeSettings(null),
        updateSettings(changes) { Object.assign(this.settings, changes); },
        audio: {play(name) { sounds.push(name); }},
        uiSystem: {
            notes, banners, panel: null, showNotification(message) { notes.push(message); }, showLoot() {}, updateInventoryUI() {},
            updateExperienceUI() {}, updateHealthUI() {}, updateGearUI() {}, showLevelUpMessage() {}, setSaveStatus() {},
            showDayBanner(title, text) { banners.push([title, text]); }, showGatherProgress() {},
            openPanel(name) { this.panel = name; panels.push(name); }, closePanel() { this.panel = null; }
        },
        terrainSystem: {
            waterHeight: 1, getPerlinHeight: () => 2, isWaterArea: () => false, isWithinSpawnArea: () => false,
            harvestedIds: new Set(), harvestedOn: new Map(), chunkMap: new Map(), moved: 0, checkChunkUpdates() { this.moved++; }
        },
        explorationSystem: {discovered: new Set(), isClearing: () => false},
        dungeonSystem: {active: false, runs: {}},
        companion: {heeled: 0, toHeel() { this.heeled++; }},
        registerModelShadow() {},
        effects: {heldKind: null, torchLit: false, swingStart: -1e9, firstPerson: true, setFirstPerson() {}, strike() {}, burst() {}}
    };
    const player = game.playerSystem = Object.create(PlayerSystem.prototype);
    const camera = new BABYLON.FreeCamera('body', new BABYLON.Vector3(0, 4, 0), scene);
    Object.assign(player, {game, camera, isDead: false, health: 100, maxHealth: 100, isGrounded: true, isFlying: false,
        jumpVelocity: 0, poisonLeft: 0, keys: {jump: false, descend: false, sprint: false}});
    game.inventorySystem = new InventorySystem(game);
    game.combatSystem = new CombatSystem(game);
    game.survivalSystem = new SurvivalSystem(game);
    game.buildSystem = new BuildingSystem(game);
    game.progression = new ProgressionSystem(game);
    game.gear = new GearSystem(game);
    game.buffs = new BuffSystem(game);
    game.animalSystem = new AnimalSystem(game);
    game.animalSystem.animals = [];
    const pois = game.pois = new PoiSystem(game);
    const stand = (poi, dx = 0, dz = 0) => { camera.position.x = poi.x + dx; camera.position.z = poi.z + dz; };
    const tick = () => { pois.timer = 0; pois.update(.4); };
    return {engine, scene, game, player, camera, pois, notes, banners, sounds, panels, stand, tick};
}

// --- Where they stand -------------------------------------------------------
test('the same cell always holds the same place, and most cells hold one', () => {
    let filled = 0, cells = 0;
    for (let cx = -6; cx <= 6; cx++) for (let cz = -6; cz <= 6; cz++) {
        const poi = poiForCell(cx, cz);
        cells++;
        assert.equal(poiForCell(cx, cz), poi, 'asking twice gives the same answer');
        if (!poi) continue;
        filled++;
        assert.equal(poi.id, `poi:${cx}:${cz}`);
        assert.ok(poi.x >= cx * POI_SPACING + 26 && poi.x <= (cx + 1) * POI_SPACING - 26, 'well inside its own cell');
        assert.ok(poi.z >= cz * POI_SPACING + 26 && poi.z <= (cz + 1) * POI_SPACING - 26);
        assert.ok(POI_KINDS[poi.kind], poi.kind);
        assert.equal(poi.region, regionAt(poi.x, poi.z));
        assert.ok(Number.isInteger(poi.level) && poi.level >= 1 && poi.level <= 9);
        assert.ok(Object.isFrozen(poi));
        assert.equal(poiById(poi.id), poi, 'and can be found again by its id');
    }
    assert.ok(filled / cells > .6 && filled / cells < .95, `${filled} of ${cells} cells`);
    for (const bad of ['poi:x:1', 'site:1:2', 'poi:1', '', null, 42, 'poi:1:2:3', 'poi:9999999:1']) assert.equal(poiById(bad), null, String(bad));
});

test('places keep clear of water, home, landmarks, ways underground, lairs and each other', () => {
    assert.ok(ALL.length > 150, `${ALL.length} places within 1600 m`);
    const lairs = LEGEND_LIST.map(legend => lairFor(legend.region)).filter(Boolean);
    for (const poi of ALL) {
        // A wreck is the one thing that belongs in the water, and in the deep of it.
        if (poi.kind === 'wreck') { assert.ok(lake(poi.x, poi.z) > .86, `${poi.id} lies in deep water`); continue; }
        assert.ok(lake(poi.x, poi.z) <= .56, `${poi.id} is not in a lake`);
        if (STARTER_POIS.includes(poi)) continue;
        assert.ok(Math.hypot(poi.x, poi.z) >= HOME_CLEAR, `${poi.id} is not on top of the clearing`);
        assert.equal(landmarksNear(poi.x, poi.z, 24).length, 0, `${poi.id} is clear of landmarks`);
        assert.equal(dungeonsNear(poi.x, poi.z, 28).length, 0, `${poi.id} is clear of ways underground`);
        for (const lair of lairs) assert.ok(near(poi, lair) >= 70, `${poi.id} is clear of a lair`);
        for (const starter of STARTER_POIS) assert.ok(near(poi, starter) >= 60);
    }
    for (const a of ALL) for (const b of ALL) if (a !== b) assert.ok(near(a, b) >= 50, `${a.id} and ${b.id} are ${near(a, b).toFixed(0)} m apart`);
});

test('every kind turns up in every region, named for where it is', () => {
    const counts = {};
    for (const poi of GRID) counts[poi.kind] = (counts[poi.kind] || 0) + 1;
    for (const kind of Object.keys(POI_KINDS)) assert.ok(counts[kind] >= GRID.length * .18, `${kind}: ${counts[kind]} of ${GRID.length}`);
    assert.deepEqual(Object.keys(counts).sort(), Object.keys(POI_KINDS).sort(), 'the first layer holds only its own four kinds');
    for (const region of REGION_IDS) {
        const den = first('den', region), haven = first('haven', region);
        assert.ok(den && haven, `${region} has a den and a haven`);
        assert.equal(den.name, DENS[region].name);
        assert.equal(haven.name, HAVENS[region].name);
        assert.ok(CREATURES[DENS[region].kind]?.brain, `${DENS[region].kind} can fight`);
        for (const item of Object.keys({...DENS[region].spoils, ...(HAVENS[region].effect.items || {})})) assert.ok(ITEMS[item], item);
        if (HAVENS[region].effect.buff) assert.ok(BOONS[HAVENS[region].effect.buff]);
    }
    assert.match(first('tower').name, / Watchtower$|Lookout$/);
    assert.match(first('waystone').name, / Waystone$/);
    assert.equal(Math.abs(Object.values(POI_KINDS).reduce((sum, kind) => sum + kind.weight, 0) - 1) < 1e-9, true, 'the weights add up');
});

test('the clearing has a waystone and a lookout, and no other waystone is a short walk away', () => {
    const [home, lookout] = STARTER_POIS;
    assert.equal(home.kind, 'waystone');
    assert.equal(lookout.kind, 'tower');
    assert.ok(Math.hypot(home.x, home.z) < 60 && Math.hypot(lookout.x, lookout.z) < 140);
    assert.equal(poiById('poi:home'), home);
    assert.ok(poisNear(0, 0, 60).includes(home));
    for (const poi of ALL) if (poi.kind === 'waystone' && poi !== home) assert.ok(Math.hypot(poi.x, poi.z) >= WAYSTONE_MIN, `${poi.name} at ${Math.hypot(poi.x, poi.z).toFixed(0)} m`);
    assert.ok(ALL.some(poi => poi.kind === 'waystone' && poi !== home && Math.hypot(poi.x, poi.z) < 500), 'but one is within reach of a first trip');
    // The two starters are clear of the first landmarks and the first barrow.
    for (const starter of STARTER_POIS) {
        assert.equal(landmarksNear(starter.x, starter.z, 20).length, 0);
        assert.ok(near(starter, STARTER_DUNGEON) > 40);
    }
});

test('nearby lookups agree with the cells', () => {
    const spot = first('den');
    assert.ok(poisNear(spot.x, spot.z, 1).includes(spot));
    assert.ok(!poisNear(spot.x + 30, spot.z, 20).includes(spot));
    for (const poi of poisNear(300, -200, 400)) assert.ok(Math.hypot(poi.x - 300, poi.z + 200) <= 400);
    assert.deepEqual(poisNear(300, -200, 400).map(poi => poi.id).sort(), ALL.filter(poi => Math.hypot(poi.x - 300, poi.z + 200) <= 400).map(poi => poi.id).sort());
});

// --- Rules ------------------------------------------------------------------
test('den rules: who comes out, when it is lived in again, and how a fight ends', () => {
    for (const region of REGION_IDS) {
        const pack = denPack({region, level: 1});
        assert.equal(pack.length, DENS[region].count);
        assert.ok(pack.every(one => one.kind === DENS[region].kind && !one.elite), 'no elites near home');
        const far = denPack({region, level: ELITE_LEVEL});
        assert.equal(far.filter(one => one.elite).length, 1, 'one elite leads a far den');
        assert.ok(far[0].elite);
    }
    assert.equal(denReady(undefined, 1), true);
    assert.equal(denReady(3, 3), false);
    assert.equal(denReady(3, 3 + DEN_REFILL_DAYS - 1), false);
    assert.equal(denReady(3, 3 + DEN_REFILL_DAYS), true);
    assert.equal(denOutcome([]), 'empty');
    assert.equal(denOutcome([{health: 10, present: true}, {health: 0, present: false}]), 'fighting');
    assert.equal(denOutcome([{health: 0, present: false}, {health: -4, present: false}]), 'cleared');
    assert.equal(denOutcome([{health: 0, present: false}, {health: 12, present: false}]), 'abandoned', 'one got away, so it is not cleared');
    assert.equal(denOutcome([{health: 0, present: true}, {health: 0, present: true}]), 'cleared');
});

test('a haven gives once a day, and what it gives fits its region', () => {
    assert.equal(havenReady(undefined, 1), true);
    assert.equal(havenReady(4, 4), false);
    assert.equal(havenReady(4, 5), true);
    assert.equal(HAVENS.tundra.effect.cold, 0);
    assert.equal(HAVENS.tundra.effect.buff, 'warmth');
    assert.equal(HAVENS.desert.effect.thirst, 100);
    assert.ok(HAVENS.desert.effect.water);
    assert.ok(HAVENS.marsh.effect.cure);
    assert.equal(HAVENS.marsh.effect.buff, 'antivenom');
    assert.ok(HAVENS.meadow.effect.items.berries > 0);
});

test('a survey lists what is near, and only the near landmarks', () => {
    const tower = STARTER_POIS[1], targets = surveyTargets(tower.x, tower.z);
    const types = new Set(targets.map(target => target.type));
    assert.deepEqual([...types].sort(), ['dungeon', 'poi', 'site']);
    for (const target of targets) {
        const limit = target.type === 'site' ? SURVEY_SITE_RADIUS : SURVEY_RADIUS;
        assert.ok(near(target, tower) <= limit + 1e-9, `${target.name} at ${near(target, tower).toFixed(0)} m`);
        assert.ok(typeof target.id === 'string' && target.name);
    }
    assert.ok(targets.filter(target => target.type === 'site').length < landmarksNear(tower.x, tower.z, SURVEY_RADIUS).length, 'far landmarks are left off');
    assert.ok(targets.some(target => target.id === 'poi:home'));
    assert.ok(targets.length <= 30, `${targets.length} marks is not a blizzard`);
});

test('travel choices are the other woken waystones, nearest first', () => {
    const home = STARTER_POIS[0], stones = ALL.filter(poi => poi.kind === 'waystone' && poi !== home).slice(0, 3);
    const den = first('den');
    const choices = travelChoices(new Set([home.id, ...stones.map(stone => stone.id), den.id, 'poi:nonsense']), home);
    assert.equal(choices.length, 3, 'not itself, not a den, not rubbish');
    for (let n = 1; n < choices.length; n++) assert.ok(choices[n - 1].distance <= choices[n].distance);
    for (const choice of choices) {
        assert.ok(Math.abs(choice.distance - near(choice, home)) < 1e-9);
        assert.ok(Math.abs(choice.bearing - Math.atan2(choice.x - home.x, choice.z - home.z)) < 1e-9);
    }
    assert.deepEqual(travelChoices(new Set([home.id]), home), []);
});

// --- In the world -----------------------------------------------------------
test('models: one mesh per place, solid where you would expect, and none of them heavy', () => {
    const {scene} = world();
    const cases = [first('tower'), first('waystone'), ...REGION_IDS.map(region => first('den', region)), ...REGION_IDS.map(region => first('haven', region))];
    for (const poi of cases) {
        const mesh = createPoiModel(scene, poi);
        assert.ok(mesh.getTotalVertices() > 100 && mesh.getTotalVertices() < 4000, `${poi.name}: ${mesh.getTotalVertices()} vertices`);
        assert.equal(mesh.metadata.poi, poi.id);
        assert.equal(mesh.isPickable, false);
        assert.ok(mesh.getVerticesData(BABYLON.VertexBuffer.ColorKind), 'coloured by vertex');
        assert.equal(mesh.getChildMeshes().length, poi.kind === 'waystone' ? 1 : 0, 'only a waystone carries a rune');
        const box = mesh.getBoundingInfo().boundingBox;
        assert.ok(box.minimum.y > -2.5 && box.maximum.y < 12 && box.maximum.y > .8, `${poi.name} stands on the ground`);
    }
});

test('models appear as you come near, go as you leave, and trees keep off the doorstep', () => {
    const {game, pois, stand, tick} = world();
    const den = first('den', 'meadow');
    stand(den, 200, 0); tick();
    assert.ok(pois.meshes.has(den.id), 'in view at 200 m');
    const mesh = pois.meshes.get(den.id);
    assert.equal(mesh.position.x, den.x);
    assert.ok(Math.abs(mesh.position.y - 2) < .2, 'on the ground');
    assert.equal(mesh.checkCollisions, false, 'a den is not a wall');
    stand(den, 400, 0); tick();
    assert.ok(!pois.meshes.has(den.id) && mesh.isDisposed(), 'gone at 400 m');
    const tower = first('tower');
    stand(tower, 100, 0); tick();
    assert.equal(pois.meshes.get(tower.id).checkCollisions, true, 'a tower is solid');
    assert.equal(pois.isClearing(tower.x + 6, tower.z), true);
    assert.equal(pois.isClearing(tower.x + 40, tower.z), false);
    // The exploration system, which terrain asks, passes the question on.
    const exploration = new ExplorationSystem(game);
    assert.equal(exploration.isClearing(tower.x + 6, tower.z), true);
    // Nothing is placed, found or woken while you are underground or paused.
    const other = first('haven', 'meadow');
    game.dungeonSystem.active = true; stand(other); tick();
    assert.ok(!pois.meshes.has(other.id) && !pois.found.has(other.id));
    assert.equal(pois.interaction(), null);
    game.dungeonSystem.active = false; game.paused = true; tick();
    assert.ok(!pois.found.has(other.id));
});

test('walking up to a place finds it once, for a little experience', () => {
    const {game, pois, notes, sounds, stand, tick} = world();
    const haven = first('haven', 'meadow');
    stand(haven, DISCOVER_RADIUS + 4, 0); tick();
    assert.ok(!pois.found.has(haven.id), 'not yet');
    const before = game.combatSystem.experience;
    stand(haven, DISCOVER_RADIUS - 2, 0); tick();
    assert.ok(pois.found.has(haven.id));
    assert.ok(game.combatSystem.experience > before);
    assert.equal(game.progression.stats.places, 1);
    assert.match(notes.at(-1), /^Found Old orchard/);
    assert.ok(sounds.includes('discover'));
    const count = notes.length;
    tick(); tick();
    assert.equal(notes.length, count, 'and only once');
    assert.equal(game.progression.stats.places, 1);
    assert.ok(STAT_LABELS.places && STAT_LABELS.dens);
    // The dead find nothing.
    const {pois: ghost, player, stand: move, tick: step} = world();
    player.isDead = true; move(haven); step();
    assert.ok(!ghost.found.has(haven.id));
});

test('a watchtower puts what it can see on the map, once', () => {
    const {game, pois, banners, notes, stand, tick} = world();
    const tower = STARTER_POIS[1];
    stand(tower, 2, 2); tick();
    const act = pois.interaction();
    assert.match(act.label, /^Press E to climb the watchtower/);
    assert.equal(game.survivalSystem.interact(), true, 'E climbs it');
    const targets = surveyTargets(tower.x, tower.z).filter(target => target.id !== tower.id);
    assert.equal(pois.sighted.size, targets.length - 1, 'everything but the barrow you start beside');
    assert.ok(!pois.sighted.has(STARTER_DUNGEON.id) && !pois.sighted.has(tower.id));
    assert.equal(banners.at(-1)[0], tower.name);
    assert.match(banners.at(-1)[1], /^From the top: \d+ landmarks?, \d+ ways? underground, \d+ points? of interest · marked on your map$/);
    // Seen things are drawn hollow until you reach them.
    const marks = pois.mapMarks(game.playerSystem.camera.position, 1350);
    assert.ok(marks.filter(mark => mark.seen).length === pois.sighted.size);
    assert.ok(marks.some(mark => mark.seen && mark.kind === 'site') && marks.some(mark => mark.seen && mark.kind === 'dungeon'));
    assert.deepEqual(marks.filter(mark => !mark.seen).map(mark => mark.kind), ['tower']);
    // A second look shows nothing new, and things you have since reached drop off.
    const size = pois.sighted.size, count = banners.length;
    pois.interaction().act();
    assert.equal(pois.sighted.size, size);
    assert.equal(banners.length, count);
    assert.match(notes.at(-1), /Nothing new/);
    const site = marks.find(mark => mark.seen && mark.kind === 'site');
    game.explorationSystem.discovered.add(landmarksNear(site.x, site.z, 1)[0].id);
    assert.equal(pois.mapMarks(game.playerSystem.camera.position, 1350).filter(mark => mark.seen).length, size - 1);
});

test('waystones: wake two, then step from one to the other', () => {
    const {game, pois, camera, player, notes, panels, stand, tick} = world();
    const home = STARTER_POIS[0], far = first('waystone', undefined) === home ? ALL.filter(poi => poi.kind === 'waystone')[1] : ALL.filter(poi => poi.kind === 'waystone' && poi !== home)[0];
    stand(home, 2, 3); tick();
    assert.match(pois.interaction().label, /^Press E to wake the waystone$/);
    assert.equal(game.survivalSystem.interact(), true);
    assert.ok(pois.attuned.has(home.id));
    assert.match(notes.at(-1), /Wake another/);
    assert.equal(pois.interaction().act, undefined, 'one stone alone goes nowhere');
    assert.match(pois.interaction().label, /wake another waystone/);
    assert.deepEqual(pois.travelOptions(), []);
    assert.equal(pois.attune(home), false, 'waking twice does nothing');
    // The rune lights when the stone is woken.
    assert.ok(pois.meshes.get(home.id).metadata.rune.material.emissiveColor.g > .9);

    stand(far, 2, 3); tick();
    assert.ok(pois.meshes.get(far.id).metadata.rune.material.emissiveColor.g < .3, 'a sleeping stone is dull');
    game.survivalSystem.interact();
    assert.ok(pois.attuned.has(far.id));
    assert.match(pois.interaction().label, /^Press E to travel from the waystone$/);
    game.survivalSystem.interact();
    assert.deepEqual(panels, ['map'], 'E opens the map, where the choices are');
    const options = pois.travelOptions();
    assert.deepEqual(options.map(option => option.id), [home.id]);

    // Not from thin air, not to a stone you have not woken, not while hunted.
    const elsewhere = ALL.filter(poi => poi.kind === 'waystone' && poi !== home && poi !== far)[0];
    assert.equal(pois.travel(elsewhere.id), false);
    game.legends = {active: {}};
    assert.equal(pois.travel(home.id), false);
    assert.match(notes.at(-1), /will not answer/);
    game.legends = {active: null};
    player.isFlying = true; player.jumpVelocity = -3; camera.cameraDirection.set(1, 0, 1);
    const moved = game.terrainSystem.moved;
    assert.equal(pois.travel(home.id), true);
    assert.ok(Math.hypot(camera.position.x - home.x, camera.position.z - home.z) < 6, 'beside the stone');
    assert.ok(Math.hypot(camera.position.x - home.x, camera.position.z - home.z) > 2, 'not inside it');
    assert.equal(camera.position.y, 4, 'standing on the ground');
    assert.equal(camera.cameraDirection.length(), 0, 'not sliding');
    assert.ok(player.isGrounded && !player.isFlying && player.jumpVelocity === 0, 'and not falling');
    assert.ok(game.terrainSystem.moved > moved, 'the country around is loaded');
    assert.equal(game.companion.heeled, 1, 'the dog comes too');
    assert.equal(game.uiSystem.panel, null);
    assert.match(notes.at(-1), /You step out at Clearing Waystone/);
    stand({x: home.x + 40, z: home.z});
    assert.deepEqual(pois.travelOptions(), [], 'away from a stone there is nowhere to go');
    assert.equal(pois.travel(far.id), false);
});

test('havens: each answers its region, once a day', () => {
    const {game, pois, player, notes, stand, tick} = world();
    const survival = game.survivalSystem, inventory = game.inventorySystem.inventory;
    const use = region => {
        const haven = first('haven', region);
        stand(haven, 2, 2); tick();
        assert.match(pois.interaction().label, new RegExp('^Press E to ' + HAVENS[region].verb + '$'));
        assert.equal(game.survivalSystem.interact(), true);
        assert.equal(pois.used.get(haven.id), game.dayCount);
        assert.match(pois.interaction().label, /come back tomorrow$/);
        assert.equal(pois.interaction().act, undefined);
        assert.equal(pois.useHaven(haven), false, 'not twice in a day');
        return haven;
    };
    survival.hunger = 40; inventory.berries = 0;
    use('meadow');
    assert.equal(survival.hunger, 60);
    assert.equal(inventory.berries, 4);

    survival.cold = 80; player.health = 50;
    use('tundra');
    assert.equal(survival.cold, 0);
    assert.equal(player.health, 80);
    assert.ok(game.buffs.has('warmth'));

    survival.thirst = 20; inventory.waterskin = 1; survival.water = 0; player.health = 95;
    use('desert');
    assert.equal(survival.thirst, 100);
    assert.equal(survival.water, WATERSKIN_CAPACITY);
    assert.equal(player.health, 100, 'healing stops at full');
    assert.match(notes.at(-1), /waterskin filled/);

    player.poisonLeft = 9; player.health = 60; inventory.herbs = 0; inventory.mushrooms = 0;
    const hut = use('marsh');
    assert.equal(player.poisonLeft, 0);
    assert.ok(game.buffs.has('antivenom'));
    assert.equal(inventory.herbs, 2);
    assert.equal(inventory.mushrooms, 2);

    // Without a waterskin an oasis still slakes you. And tomorrow it gives again.
    const {game: dry, pois: other, stand: move, tick: step} = world();
    const oasis = first('haven', 'desert');
    dry.survivalSystem.thirst = 10; move(oasis, 1, 1); step();
    other.interaction().act();
    assert.equal(dry.survivalSystem.thirst, 100);
    assert.equal(dry.survivalSystem.water || 0, 0);
    game.dayCount++;
    assert.match(pois.interaction().label, /^Press E to rest a while$/);
    assert.equal(pois.useHaven(hut), true);
    assert.equal(inventory.herbs, 4);
});

test('a den: its owners come out, and killing all of them clears it for a few days', () => {
    const {game, pois, banners, notes, stand, tick} = world();
    const den = first('den', 'tundra'), animals = game.animalSystem.animals, inventory = game.inventorySystem.inventory;
    stand(den, DEN_WAKE_RADIUS + 10, 0); tick();
    assert.equal(animals.length, 0, 'quiet from a distance');
    stand(den, DEN_WAKE_RADIUS - 6, 0); tick();
    assert.equal(animals.length, DENS.tundra.count);
    assert.ok(animals.every(animal => animal.kind === 'icewolf' && animal.den === den.id && !animal.dungeon));
    assert.ok(animals.every(animal => Math.hypot(animal.mesh.position.x - den.x, animal.mesh.position.z - den.z) < 8));
    assert.ok(pois.found.has(den.id), 'you know it is there now');
    assert.match(notes.find(note => note.startsWith(den.name)), /3 ice wolfs? come out|3 .* come out/);
    tick(); tick();
    assert.equal(animals.length, DENS.tundra.count, 'they come out once');
    assert.equal(pois.interaction(), null, 'nothing to press at a den');

    // Kill two: still a fight. Kill the last: cleared.
    const pelts = inventory.pelt, experience = game.combatSystem.experience + game.combatSystem.level * 1000;
    const kill = animal => { animal.health = 0; animals.splice(animals.indexOf(animal), 1); animal.mesh.dispose(); };
    const [a, b, c] = [...animals];
    kill(a); kill(b); tick();
    assert.ok(!pois.cleared.has(den.id));
    kill(c); tick();
    assert.equal(pois.cleared.get(den.id), game.dayCount);
    assert.equal(inventory.pelt, pelts + DENS.tundra.spoils.pelt);
    assert.ok(game.combatSystem.experience + game.combatSystem.level * 1000 > experience);
    assert.equal(game.progression.stats.dens, 1);
    assert.equal(game.gear.drops.length, 1, 'and something worth having is left on the step');
    assert.equal(banners.at(-1)[0], `${den.name} cleared`);
    assert.match(banners.at(-1)[1], new RegExp(`within ${DEN_REFILL_DAYS} days$`));
    assert.equal(pois.mapMarks(game.playerSystem.camera.position, 500).find(mark => mark.label === den.name).kind, 'denCleared');

    // Empty for now, lived in again later.
    tick(); tick();
    assert.equal(animals.length, 0);
    game.dayCount += DEN_REFILL_DAYS - 1; tick();
    assert.equal(animals.length, 0);
    game.dayCount += 1; tick();
    assert.equal(animals.length, DENS.tundra.count);
    assert.equal(pois.mapMarks(game.playerSystem.camera.position, 500).find(mark => mark.label === den.name).kind, 'den');
});

test('a den you run from is not cleared, and far dens are led by an elite', () => {
    const {game, pois, stand, tick} = world();
    const den = first('den', 'meadow'), animals = game.animalSystem.animals;
    stand(den, 10, 0); tick();
    const pack = [...animals];
    assert.equal(pack.length, 3);
    // Kill one, then leave the rest behind: the world lets go of them.
    pack[0].health = 0; animals.length = 0;
    stand(den, 150, 0); tick();
    assert.ok(!pois.cleared.has(den.id));
    assert.equal(pois.fights.has(den.id), false);
    stand(den, 10, 0); tick();
    assert.equal(animals.length, 3, 'a full pack again when you come back');
    // The dead do not wake dens.
    const {game: grave, pois: quiet, player, stand: move, tick: step} = world();
    player.isDead = true; move(den, 10, 0); step();
    assert.equal(grave.animalSystem.animals.length, 0);
    assert.equal(quiet.fights.size, 0);

    const far = ALL.filter(poi => poi.kind === 'den' && poi.level >= ELITE_LEVEL)[0];
    const {game: frontier, stand: go, tick: beat} = world();
    go(far, 10, 0); beat();
    const elites = frontier.animalSystem.animals.filter(animal => animal.elite);
    assert.equal(elites.length, 1);
    const plain = frontier.animalSystem.animals.find(animal => !animal.elite);
    assert.ok(elites[0].maxHealth > plain.maxHealth);
    assert.ok(plain.maxHealth > CREATURES[plain.kind].health, 'and tougher than the ones near home');
});

test('what you have found, seen, woken, cleared and used survives a save', () => {
    const {game, pois, stand, tick} = world();
    game.saveSystem = new SaveSystem(game, {setItem() {}, getItem: () => null});
    game.terrainSystem.restoreHarvested = () => {};
    const home = STARTER_POIS[0], tower = STARTER_POIS[1], den = first('den', 'meadow'), haven = first('haven', 'meadow');
    stand(home, 2, 2); tick(); pois.interaction().act();
    stand(tower, 2, 2); tick(); pois.interaction().act();
    stand(haven, 2, 2); tick(); pois.interaction().act();
    pois.found.add(den.id); pois.cleared.set(den.id, 3);
    const saved = JSON.parse(JSON.stringify(pois.capture()));
    assert.deepEqual(Object.keys(saved).sort(), ['attuned', 'cleared', 'dug', 'found', 'leads', 'looted', 'sighted', 'trades', 'used']);
    assert.ok(JSON.parse(JSON.stringify(game.saveSystem.capture())).pois, 'the save file carries it');

    const {pois: fresh, stand: move, tick: step} = world();
    move(home, 200, 0); step();
    fresh.restore(saved);
    assert.deepEqual(fresh.capture(), saved);
    move(home, 2, 2); step();
    assert.ok(fresh.meshes.get(home.id).metadata.rune.material.emissiveColor.g > .9, 'a woken stone is still lit');
    assert.equal(fresh.interaction().label.includes('wake the waystone'), false);

    // Rubbish in a save is dropped, not trusted.
    fresh.restore({found: ['poi:home', 'poi:nope', 7, null, 'x'.repeat(80)], attuned: [den.id, 'poi:home', 'site:1:1'], sighted: ['site:1:1', {}, 'ok'],
        cleared: {[den.id]: 2.7, 'poi:nope': 3, [haven.id]: 'soon'}, used: {[haven.id]: -5, bad: 1}});
    assert.deepEqual([...fresh.found], ['poi:home']);
    assert.deepEqual([...fresh.attuned], ['poi:home'], 'only waystones can be woken');
    assert.deepEqual([...fresh.sighted], ['site:1:1', 'ok']);
    assert.deepEqual([...fresh.cleared], [[den.id, 2]]);
    assert.deepEqual([...fresh.used], [[haven.id, 1]]);
    for (const empty of [null, undefined, 'x', 3, []]) {
        fresh.restore(empty);
        assert.equal(fresh.found.size + fresh.sighted.size + fresh.attuned.size + fresh.cleared.size + fresh.used.size, 0);
    }
});

test('E still does the older things first, and the new files are wired in', async () => {
    const read = path => readFile(new URL(path, import.meta.url), 'utf8');
    const [survival, ui, game, worker, save, exploration] = await Promise.all(
        ['../js/components/survival.js', '../js/components/ui.js', '../js/game.js', '../sw.js', '../js/components/save.js', '../js/components/exploration.js'].map(read));
    const body = survival.slice(survival.indexOf('    interact() {'));
    const order = ['dungeonSystem?.interaction', 'gardens?.interaction', 'companion?.interaction', 'storage?.interaction', 'pois?.interaction', 'sleepStatus()'].map(text => body.indexOf(text));
    assert.ok(order.every(index => index > 0), 'all in the chain');
    assert.deepEqual([...order].sort((a, b) => a - b), order, 'chests and beds before places, places before sleeping and drinking');
    assert.match(ui, /game\.pois\?\.interaction\(\)/);
    assert.match(ui, /id="map-travel"[^>]*hidden><\/div><canvas id="map-canvas"/, 'the travel list sits above the map');
    for (const kind of ['tower', 'waystone', 'den', 'denCleared', 'haven', 'seen']) assert.match(ui, new RegExp(`\\n    ${kind}: \\['#`), `${kind} has a map mark`);
    assert.ok(game.indexOf('new PoiSystem(this)') < game.indexOf('new TerrainSystem(this)'), 'made before the first trees are planted');
    assert.match(game, /this\.pois\.update\(dt\)/);
    assert.match(save, /pois:g\.pois\?\.capture/);
    assert.match(save, /g\.pois\?\.restore\?\.\(saved\.pois\)/);
    assert.match(exploration, /this\.game\.pois\?\.isClearing\(x, z\)/);
    for (const file of ['./js/pois.js', './js/components/pois.js', './js/models/pois.js']) assert.ok(worker.includes(`'${file}'`), `${file} is cached for offline play`);
    assert.ok(USE_RADIUS < DISCOVER_RADIUS && DISCOVER_RADIUS < DEN_WAKE_RADIUS);
});

// --- The second batch: traders, shrines, cairns and wrecks -----------------
const EXTRA = ALL.filter(poi => EXTRA_KINDS[poi.kind]), WRECKS = ALL.filter(poi => poi.kind === 'wreck');

test('adding a second layer moved nothing in the first', () => {
    // These were on players' maps in 0.6.0. They must still be where they were.
    const golden = [
        ['poi:-1:1', 'waystone', 'desert', 'Rowan Waystone', -122, 291, 2], ['poi:-3:-2', 'den', 'desert', 'Scorpion nest', -355, -219, 2],
        ['poi:0:-3', 'den', 'tundra', 'Ice wolf den', 47, -387, 2], ['poi:-2:0', 'tower', 'meadow', 'Iron Watchtower', -281, 110, 2],
        ['poi:1:-2', 'haven', 'meadow', 'Old orchard', 261, -216, 2]
    ];
    for (const [id, kind, region, name, x, z, level] of golden) {
        const poi = poiById(id);
        assert.deepEqual([poi.id, poi.kind, poi.region, poi.name, Math.round(poi.x), Math.round(poi.z), poi.level], [id, kind, region, name, x, z, level]);
    }
    assert.equal(poiById('poi:5:4'), null);
    assert.equal(gridPoisNear(0, 0, 1500).length, 209);
    assert.deepEqual(STARTER_POIS.map(poi => [poi.id, poi.x, poi.z]), [['poi:home', -22, 24], ['poi:lookout', 84, 66]]);
});

test('the second layer: a trader, a shrine or a cairn in most 220 m squares, clear of everything else', () => {
    let filled = 0, cells = 0;
    for (let cx = -5; cx <= 5; cx++) for (let cz = -5; cz <= 5; cz++) {
        const poi = extraForCell(cx, cz);
        cells++;
        assert.equal(extraForCell(cx, cz), poi);
        if (!poi) continue;
        filled++;
        assert.equal(poi.id, `poi:x:${cx}:${cz}`);
        assert.equal(poiById(poi.id), poi);
        assert.ok(EXTRA_KINDS[poi.kind] && KIND_LABELS[poi.kind].label);
        assert.ok(poi.x >= cx * EXTRA_SPACING + 30 && poi.x <= (cx + 1) * EXTRA_SPACING - 30);
        assert.equal(poi.region, regionAt(poi.x, poi.z));
        assert.ok(Math.hypot(poi.x, poi.z) >= EXTRA_HOME_CLEAR);
        assert.equal(gridPoisNear(poi.x, poi.z, 60).length, 0, `${poi.id} is clear of the first layer`);
        assert.equal(landmarksNear(poi.x, poi.z, 24).length, 0);
        assert.equal(dungeonsNear(poi.x, poi.z, 28).length, 0);
        assert.ok(lake(poi.x, poi.z) <= .56);
    }
    assert.ok(filled / cells > .5 && filled / cells < .85, `${filled} of ${cells}`);
    const counts = {};
    for (const poi of EXTRA) counts[poi.kind] = (counts[poi.kind] || 0) + 1;
    for (const kind of Object.keys(EXTRA_KINDS)) assert.ok(counts[kind] >= EXTRA.length * .18, `${kind}: ${counts[kind]} of ${EXTRA.length}`);
    assert.ok(Math.abs(Object.values(EXTRA_KINDS).reduce((sum, kind) => sum + kind.weight, 0) - 1) < 1e-9);
    for (const poi of EXTRA) {
        if (poi.kind === 'trader') { assert.ok(poi.keeper); assert.equal(poi.name, `${poi.keeper}'s trading camp`); }
        if (poi.kind === 'shrine') { assert.ok(SHRINES[poi.boon] && BOONS[poi.boon]); assert.equal(poi.name, SHRINES[poi.boon].name); }
        if (poi.kind === 'cairn') assert.equal(poi.name, "Traveller's cairn");
    }
    assert.deepEqual([...new Set(EXTRA.filter(poi => poi.kind === 'shrine').map(poi => poi.boon))].sort(), ['fury', 'haste', 'stoneskin'], 'all three beasts have shrines');
});

test('wrecks lie in the deep middle of lakes, most lakes have one, and dry land has none', () => {
    assert.ok(WRECKS.length >= 5, `${WRECKS.length} wrecks within 1600 m`);
    for (const wreck of WRECKS) {
        assert.match(wreck.id, /^poi:w:-?\d+:-?\d+$/);
        assert.match(wreck.name, /^Wreck of the /);
        assert.equal(poiById(wreck.id), wreck);
        assert.ok(lake(wreck.x, wreck.z) > .9, 'well out from the shore');
    }
    assert.equal(wreckForLake(0, 1), null, 'no lake on the odd squares of the lattice');
    assert.equal(wreckForLake(1, 0), null);
    assert.equal(wreckForLake(.5, 0), null);
    assert.equal(poiById('poi:w:0:1'), null);
    const nearest = WRECKS.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
    assert.equal(nearest.id, 'poi:w:0:0', 'the lake east of the clearing has one');
    assert.ok(Math.hypot(nearest.x, nearest.z) < 380);
    let lakes = 0, held = 0;
    for (let m = -8; m <= 8; m++) for (let n = -8; n <= 8; n++) if ((m + n) % 2 === 0) { lakes++; if (wreckForLake(m, n)) held++; }
    assert.ok(held / lakes > .7 && held < lakes, `${held} of ${lakes} lakes`);
    assert.ok(poisNear(nearest.x, nearest.z, 5).includes(nearest));
});

test("a cairn's note points to dry ground some way off, and always the same spot", () => {
    const cairns = EXTRA.filter(poi => poi.kind === 'cairn');
    assert.ok(cairns.length > 20);
    for (const cairn of cairns) {
        const cache = cacheFor(cairn);
        assert.ok(cache, `${cairn.id} has a cache`);
        assert.equal(cacheFor(cairn), cache);
        assert.ok(cache.distance >= 140 && cache.distance <= 300);
        assert.ok(Math.abs(Math.hypot(cache.x - cairn.x, cache.z - cairn.z) - cache.distance) < 1e-6);
        assert.ok(Math.abs(Math.atan2(cache.x - cairn.x, cache.z - cairn.z) - (cache.bearing > Math.PI ? cache.bearing - Math.PI * 2 : cache.bearing)) < 1e-6, 'the bearing is the way to it');
        assert.ok(lake(cache.x, cache.z) <= .56, 'not under water');
        assert.ok(Math.hypot(cache.x, cache.z) >= 90, 'not in the clearing');
    }
});

test('trading rules: four lines a day, fair but in the trader\'s favour, different tomorrow', () => {
    const traders = EXTRA.filter(poi => poi.kind === 'trader');
    assert.ok(traders.length > 15);
    const worth = bundle => Object.entries(bundle).reduce((sum, [item, amount]) => sum + WORTH[item] * amount, 0);
    let changed = 0;
    for (const trader of traders) {
        const offers = tradeOffers(trader, 3);
        assert.deepEqual(tradeOffers(trader, 3), offers, 'the same all day');
        assert.equal(offers.length, 4);
        for (const offer of offers.slice(0, 3)) {
            const [give] = Object.keys(offer.give), [get] = Object.keys(offer.get);
            assert.ok(ITEMS[give] && ITEMS[get] && give !== get, `${give} for ${get}`);
            assert.equal(offer.stock, TRADE_STOCK);
            assert.equal(offer.gear, false);
            assert.ok(Number.isInteger(offer.give[give]) && offer.give[give] >= 1 && offer.give[give] <= 60);
            const ratio = worth(offer.give) / worth(offer.get);
            assert.ok(ratio >= TRADE_MARGIN - 1e-9 && ratio < TRADE_MARGIN + .7, `${trader.name}: ${give} for ${get} at ${ratio.toFixed(2)}`);
        }
        assert.equal(new Set(offers.slice(0, 3).map(offer => Object.keys(offer.get)[0])).size, 3, 'three different things on the board');
        const gear = offers[3], [coin] = Object.keys(gear.give);
        assert.ok(gear.gear && gear.get === null && gear.stock === 1);
        assert.ok(WORTH[coin] >= 4, `gear is paid for in ${coin}`);
        assert.ok(worth(gear.give) >= GEAR_PRICE * (1 + .2 * (trader.level - 1)) && gear.give[coin] <= 30);
        if (JSON.stringify(tradeOffers(trader, 4)) !== JSON.stringify(offers)) changed++;
    }
    assert.ok(changed > traders.length * .7, 'most boards change overnight');
    const near = traders.sort((a, b) => a.level - b.level)[0], far = traders.at(-1);
    assert.ok(worth(tradeOffers(far, 1)[3].give) > worth(tradeOffers(near, 1)[3].give) || far.level === near.level, 'gear costs more where it is better');
    assert.equal(canAfford({pelt: 3}, {give: {pelt: 3}}), true);
    assert.equal(canAfford({pelt: 2}, {give: {pelt: 3}}), false);
    assert.equal(canAfford({}, {give: {pelt: 1}}), false);
    for (const item of Object.keys(WORTH)) assert.ok(ITEMS[item], item);
});

test('models for the new places, and the mound over a cache', () => {
    const {scene} = world();
    for (const kind of ['trader', 'shrine', 'cairn', 'wreck']) {
        const poi = ALL.find(one => one.kind === kind), mesh = createPoiModel(scene, poi);
        assert.equal(mesh.metadata.poi, poi.id);
        assert.ok(mesh.getTotalVertices() > 300 && mesh.getTotalVertices() < 4000, `${kind}: ${mesh.getTotalVertices()}`);
        assert.ok(mesh.getVerticesData(BABYLON.VertexBuffer.ColorKind));
        const box = mesh.getBoundingInfo().boundingBox;
        assert.ok(box.minimum.y > -.5 && box.maximum.y > (kind === 'wreck' ? 6 : 2), `${kind} is ${box.maximum.y.toFixed(1)} tall`);
    }
    const mound = createCacheModel(scene, 5);
    assert.ok(mound.getTotalVertices() > 100 && mound.getBoundingInfo().boundingBox.maximum.y > 1.4, 'the rag stands above the grass');
    assert.equal(mound.isPickable, false);
});

test('a shrine lends its beast\'s boon once a day, for longer than a dungeon shrine', () => {
    const {game, pois, notes, stand, tick} = world();
    const shrine = EXTRA.find(poi => poi.kind === 'shrine' && poi.boon === 'haste');
    stand(shrine, 2, 2); tick();
    assert.ok(pois.found.has(shrine.id));
    assert.match(pois.interaction().label, /^Press E to pray at the shrine$/);
    assert.equal(game.survivalSystem.interact(), true);
    assert.ok(game.buffs.has('haste'));
    assert.equal(game.buffs.list()[0].left, SHRINE_SECONDS);
    assert.ok(SHRINE_SECONDS > BOONS.haste.seconds);
    assert.match(notes.at(-1), /the hare lends you its legs for 4 minutes/);
    assert.equal(game.progression.stats.shrines, 1);
    assert.match(pois.interaction().label, /it has given today$/);
    assert.equal(pois.interaction().act, undefined);
    assert.equal(pois.pray(shrine), false);
    game.dayCount++;
    assert.equal(pois.pray(shrine), true);
    assert.equal(pois.pray(STARTER_POIS[0]), false, 'a waystone is not a shrine');
});

test('a cairn: read the note, find the mound, dig up the cache', () => {
    const {game, pois, banners, notes, stand, tick} = world();
    const cairn = EXTRA.find(poi => poi.kind === 'cairn'), cache = cacheFor(cairn), inventory = game.inventorySystem.inventory;
    // Standing on the spot before you have read the note finds nothing.
    stand(cache, 1, 1); tick();
    assert.equal(pois.interaction(), null);
    assert.equal(pois.mounds.size, 0);
    stand(cairn, 2, 2); tick();
    assert.match(pois.interaction().label, /^Press E to read the note under the cairn$/);
    assert.equal(game.survivalSystem.interact(), true);
    assert.ok(pois.leads.has(cairn.id));
    assert.equal(banners.at(-1)[0], 'A note under the stones');
    assert.match(banners.at(-1)[1], /^"\d+ paces (north|south|east|west)(-east|-west)?, under two crossed sticks" · marked on your map$/);
    assert.match(pois.interaction().label, /^The note says: \d+ paces /);
    assert.equal(pois.interaction().act, undefined);
    assert.equal(pois.readCairn(cairn), false, 'once is enough');
    const mark = pois.mapMarks(game.playerSystem.camera.position, 600).find(one => one.kind === 'cache');
    assert.ok(Math.abs(mark.x - cache.x) < 1e-9 && Math.abs(mark.z - cache.z) < 1e-9);

    // The mound shows as you come near.
    stand(cache, 200, 0); tick();
    assert.equal(pois.mounds.size, 0);
    stand(cache, 60, 0); tick();
    assert.equal(pois.mounds.size, 1);
    const mound = pois.mounds.get(cairn.id);
    assert.ok(Math.abs(mound.position.x - cache.x) < 1e-9);
    stand(cache, 1, 1); tick();
    assert.match(pois.interaction().label, /^Press E to dig up the cache$/);
    const iron = inventory.iron, drops = game.gear.drops.length, experience = game.combatSystem.experience + game.combatSystem.level * 1000;
    assert.equal(game.survivalSystem.interact(), true);
    assert.ok(pois.dug.has(cairn.id));
    assert.equal(inventory.iron, iron + 1);
    assert.equal(game.gear.drops.length, drops + 1);
    assert.ok(game.combatSystem.experience + game.combatSystem.level * 1000 > experience);
    assert.equal(game.progression.stats.caches, 1);
    assert.ok(mound.isDisposed() && pois.mounds.size === 0);
    assert.match(notes.at(-1), /^Dug up a cache/);
    // Not twice, and not for a cairn whose note you have not read.
    const unread = EXTRA.filter(poi => poi.kind === 'cairn')[1];
    assert.equal(pois.dig({poi: cairn, cache}), false);
    assert.equal(pois.dig({poi: unread, cache: cacheFor(unread)}), false);
    assert.equal(inventory.iron, iron + 1);
    assert.equal(game.gear.drops.length, drops + 1);
    assert.ok(!pois.dug.has(unread.id));
    // Nothing more to dig, no mark left, and the cairn has nothing more to say.
    assert.equal(pois.interaction(), null);
    assert.equal(pois.mapMarks(game.playerSystem.camera.position, 600).some(one => one.kind === 'cache'), false);
    stand(cairn, 2, 2); tick();
    assert.equal(pois.interaction(), null);
});

test('a wreck: seen from the surface, opened only from under the water, and only once', () => {
    const {game, pois, player, notes, stand, tick} = world();
    const wreck = poiById('poi:w:0:0'), inventory = game.inventorySystem.inventory;
    stand(wreck, 18, 0); tick();
    assert.ok(pois.found.has(wreck.id), 'found from further off than a place on land');
    assert.equal(pois.interaction(), null, 'too far to reach');
    stand(wreck, 4, 3); tick();
    assert.equal(pois.meshes.get(wreck.id).checkCollisions, false);
    player.isUnderwater = false;
    assert.match(pois.interaction().label, /^Wreck of the .* lies below · dive to reach her chest$/);
    assert.equal(pois.interaction().act, undefined);
    assert.equal(game.survivalSystem.interact(), false, 'E at the surface does not open it');
    assert.ok(!pois.looted.has(wreck.id));
    player.isUnderwater = true;
    assert.match(pois.interaction().label, /^Press E to prise open the chest$/);
    const arrows = inventory.arrows, gear = Object.values(game.gear.equipped).filter(Boolean).length + game.gear.bag.length;
    assert.equal(game.survivalSystem.interact(), true);
    assert.ok(pois.looted.has(wreck.id));
    assert.equal(inventory.arrows, arrows + 8);
    assert.equal(Object.values(game.gear.equipped).filter(Boolean).length + game.gear.bag.length, gear + 1, 'straight into your gear, not left on the lake bed');
    assert.equal(game.gear.drops.length, 0);
    assert.notEqual([...Object.values(game.gear.equipped), ...game.gear.bag].filter(Boolean)[0].rarity, 'common');
    assert.equal(game.progression.stats.wrecks, 1);
    assert.match(notes.at(-1), /gives up her chest/);
    assert.equal(pois.interaction(), null, 'an empty wreck has no prompt');
    assert.equal(pois.loot(wreck), false);
});

test('a trader: swap what you have, twice a line, and a fresh board in the morning', () => {
    const {game, pois, panels, sounds, stand, tick} = world();
    const trader = EXTRA.find(poi => poi.kind === 'trader'), inventory = game.inventorySystem.inventory;
    let opened = null;
    game.uiSystem.openTrade = id => { opened = id; };
    stand(trader, 2, 2); tick();
    assert.equal(pois.interaction().label, `Press E to trade with ${trader.keeper}`);
    assert.equal(game.survivalSystem.interact(), true);
    assert.equal(opened, trader.id);

    const board = pois.offers(trader);
    assert.equal(board.length, 4);
    assert.ok(board.every(line => !line.affordable), 'an empty pack buys nothing');
    assert.equal(pois.trade(trader.id, 0), false);
    assert.equal(sounds.at(-1), 'deny');
    const [give] = Object.keys(board[0].give), [get] = Object.keys(board[0].get);
    inventory[give] = board[0].give[give] * 3;
    const had = inventory[get];
    assert.equal(pois.offers(trader)[0].affordable, true);
    assert.equal(pois.trade(trader.id, 0), true);
    assert.equal(inventory[give], board[0].give[give] * 2);
    assert.equal(inventory[get], had + board[0].get[get]);
    assert.equal(pois.offers(trader)[0].left, TRADE_STOCK - 1);
    assert.equal(pois.trade(trader.id, 0), true);
    assert.equal(pois.offers(trader)[0].left, 0);
    assert.equal(pois.trade(trader.id, 0), false, 'sold out, though you could pay');
    assert.equal(inventory[give], board[0].give[give]);
    assert.equal(game.progression.stats.trades, 2);

    // The gear line: one piece, into your gear.
    const [coin] = Object.keys(board[3].give);
    inventory[coin] = (inventory[coin] || 0) + board[3].give[coin];
    const before = inventory[coin];
    assert.equal(pois.trade(trader.id, 3), true);
    assert.equal(inventory[coin], before - board[3].give[coin]);
    assert.equal(Object.values(game.gear.equipped).filter(Boolean).length + game.gear.bag.length, 1);
    assert.equal(pois.offers(trader)[3].left, 0);
    assert.equal(pois.trade(trader.id, 9), false, 'no such line');
    // The id has to be the trader you are standing with, even for a line you could pay for.
    const [pay] = Object.keys(board[1].give);
    inventory[pay] = board[1].give[pay] * 2;
    assert.equal(pois.trade('poi:home', 1), false, 'not this trader');
    assert.equal(pois.trade(EXTRA.filter(poi => poi.kind === 'trader')[1].id, 1), false, 'nor one somewhere else');
    assert.equal(inventory[pay], board[1].give[pay] * 2, 'and nothing changes hands');
    assert.equal(pois.offers(trader)[1].left, TRADE_STOCK);

    // Not from across the field, and tomorrow the stock is back.
    stand(trader, 30, 0);
    assert.equal(pois.trade(trader.id, 1), false);
    assert.equal(pois.interaction(), null);
    stand(trader, 2, 2);
    game.dayCount++;
    assert.ok(pois.offers(trader).every(line => line.left === line.stock));
});

test('notes read, caches dug, wrecks opened and today\'s trades survive a save', () => {
    const {game, pois, player, stand, tick} = world();
    const cairn = EXTRA.find(poi => poi.kind === 'cairn'), other = EXTRA.filter(poi => poi.kind === 'cairn')[1];
    const trader = EXTRA.find(poi => poi.kind === 'trader'), wreck = poiById('poi:w:0:0'), shrine = EXTRA.find(poi => poi.kind === 'shrine');
    stand(cairn, 2, 2); tick(); pois.readCairn(cairn); pois.readCairn(other);
    stand(cacheFor(cairn), 1, 1); pois.dig(pois.digSpot());
    stand(wreck, 2, 2); tick(); player.isUnderwater = true; pois.loot(wreck);
    stand(shrine, 2, 2); tick(); pois.pray(shrine);
    stand(trader, 2, 2); tick();
    const line = pois.offers(trader)[1], [give] = Object.keys(line.give);
    game.inventorySystem.inventory[give] = 99; pois.trade(trader.id, 1);
    const saved = JSON.parse(JSON.stringify(pois.capture()));
    assert.deepEqual(saved.leads.sort(), [cairn.id, other.id].sort());
    assert.deepEqual(saved.dug, [cairn.id]);
    assert.deepEqual(saved.looted, [wreck.id]);
    assert.deepEqual(saved.trades, {[trader.id]: {day: 1, sold: [0, 1, 0, 0]}});
    assert.equal(saved.used[shrine.id], 1);

    const {game: later, pois: fresh, stand: move, tick: step} = world();
    fresh.restore(saved);
    assert.deepEqual(fresh.capture(), saved, 'a save loads back to exactly what was saved');
    assert.deepEqual([...fresh.leads].sort(), [cairn.id, other.id].sort());
    assert.ok(fresh.dug.has(cairn.id) && fresh.looted.has(wreck.id));
    move(trader, 2, 2); step();
    assert.equal(fresh.offers(trader)[1].left, TRADE_STOCK - 1, "today's dealings are remembered");
    assert.equal(fresh.openLeads().length, 1, 'one cache still to find');
    assert.equal(fresh.pray(shrine), false, 'the shrine has given today');
    // A mound standing when a save is loaded is taken down with the old state.
    move(cacheFor(other), 20, 0); step();
    assert.equal(fresh.mounds.size, 1);
    const mound = fresh.mounds.get(other.id);
    fresh.restore(null);
    assert.ok(mound.isDisposed() && fresh.mounds.size === 0 && fresh.leads.size === 0);
    // Yesterday's trades are not carried in a save made today.
    later.dayCount = 5;
    fresh.restore(saved);
    assert.deepEqual(fresh.capture().trades, {});
    assert.ok(fresh.offers(trader).every(one => one.left === one.stock));

    // Rubbish is dropped: wrong kinds, a cache dug without its note, bad counts.
    fresh.restore({leads: [trader.id, cairn.id, 'poi:x:nope', 3], dug: [other.id, cairn.id], looted: [cairn.id, wreck.id, 'poi:w:0:1'],
        trades: {[trader.id]: {day: 2.9, sold: [1, 'x', -4, 500, null]}, [cairn.id]: {day: 1, sold: [1]}, bad: {day: 'x', sold: []}, [shrine.id]: 7}});
    assert.deepEqual([...fresh.leads], [cairn.id]);
    assert.deepEqual([...fresh.dug], [cairn.id], 'no digging without the note');
    assert.deepEqual([...fresh.looted], [wreck.id]);
    assert.deepEqual([...fresh.trades], [[trader.id, {day: 2, sold: [1, 0, 0, 99, 0]}]]);
});

test('the new places are wired into the interface', async () => {
    const read = path => readFile(new URL(path, import.meta.url), 'utf8');
    const [ui, css, worker, progression] = await Promise.all(['../js/components/ui.js', '../styles.css', '../sw.js', '../js/components/progression.js'].map(read));
    for (const kind of ['trader', 'shrine', 'cairn', 'cache', 'wreck']) {
        assert.match(ui, new RegExp(`\\n    ${kind}: \\['#`), `${kind} has a map mark`);
        assert.match(ui, new RegExp(`${kind}: '[A-Z]`), `${kind} is named in the legend`);
    }
    assert.match(ui, /<div id="trade-panel"><\/div>/);
    assert.match(ui, /openTrade\(id\) \{ this\.tradeId = id; this\.openPanel\('trade'\); \}/);
    assert.match(ui, /game\.pois\?\.trade\(this\.tradeId, Number\(line\.dataset\.offer\)\)/);
    assert.match(ui, /!storage && !trade;/, 'the trade panel is not the pause menu');
    assert.match(css, /#trade-panel\[hidden\]\{display:none\}/);
    assert.doesNotMatch(worker, /v21-points-of-interest/, 'the offline cache was bumped');
    for (const stat of ['caches', 'wrecks', 'trades']) assert.ok(STAT_LABELS[stat], stat);
    assert.match(progression, /caches: 'Caches dug up'/);
});
