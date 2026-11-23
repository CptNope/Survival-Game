// Tests for camp defences: spike traps, palisades and watch fires, through
// the real building, animal and creature code.
import test from 'node:test';
import assert from 'node:assert/strict';
import BABYLON from 'babylonjs';
import {
    SPIKES, PALISADE, WATCHFIRE, DEFENCES, SMALL_PIECES, SMALL_GAP,
    isHunter, palisadeEnds, crossesPalisade, palisadeLeft, spikesLeft
} from '../js/defences.js';
import { BUILDINGS, BuildingSystem } from '../js/components/building.js';
import { AnimalSystem } from '../js/components/animals.js';
import { InventorySystem } from '../js/components/inventory.js';
import { CombatSystem } from '../js/components/combat.js';
import { PlayerSystem } from '../js/components/player.js';
import { SurvivalSystem } from '../js/components/survival.js';
import { ProgressionSystem } from '../js/components/progression.js';
import { SaveSystem } from '../js/components/save.js';
import { normalizeSettings } from '../js/settings.js';

globalThis.BABYLON = BABYLON;

const close = (a, b, slack = 1e-9) => Math.abs(a - b) <= slack;

function world() {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    engine.getDeltaTime = () => 50;
    scene.getAnimationRatio = () => 1;
    const notes = [];
    const game = {
        scene, engine, paused: false, dayTime: 225, dayLength: 300, dayCount: 2, settings: normalizeSettings(null),
        audio: {play() {}},
        uiSystem: {
            showNotification(message) { notes.push(message); }, showLoot() {}, updateInventoryUI() {}, updateExperienceUI() {},
            updateHealthUI() {}, updateGearUI() {}, showLevelUpMessage() {}, setSaveStatus() {}, showGatherProgress() {}, showDayBanner() {}
        },
        terrainSystem: {
            waterHeight: 1, getPerlinHeight: () => 2, isWaterArea: () => false, isWithinSpawnArea: () => false,
            harvestedIds: new Set(), harvestedOn: new Map(), chunkMap: new Map(), checkChunkUpdates() {}
        },
        explorationSystem: {discovered: new Set(), isClearing: () => false},
        dungeonSystem: {active: false, runs: {}},
        regions: {current: 'meadow', strength: 0, coldRate: () => 0, thirstFactor: () => 1},
        registerModelShadow() {},
        effects: {torchLit: false, strike() {}, burst() {}, refreshHeld() {}, hurt() {}}
    };
    const player = game.playerSystem = Object.create(PlayerSystem.prototype);
    const camera = new BABYLON.FreeCamera('body', new BABYLON.Vector3(0, 4, 0), scene);
    Object.assign(player, {game, camera, isDead: false, health: 1e6, maxHealth: 1e6, isGrounded: true, isFlying: false,
        jumpVelocity: 0, poisonLeft: 0, keys: {jump: false, descend: false, sprint: false}, takeDamage() {}});
    game.inventorySystem = new InventorySystem(game);
    game.combatSystem = new CombatSystem(game);
    game.survivalSystem = new SurvivalSystem(game);
    game.progression = new ProgressionSystem(game);
    const build = game.buildSystem = new BuildingSystem(game);
    const animals = game.animalSystem = new AnimalSystem(game);
    animals.animals = [];
    animals.spawnTimer = 1e9;
    const put = (type, x, z, rotation = 0, extra = {}) => { const record = {id: build.nextId++, type, x, y: 2, z, rotation, ...extra}; build.structures.push(record); return record; };
    const spawn = (kind, x, z, options = {}) => animals.spawnAnimal(x, 2, z, kind, options);
    // Run the world for some seconds with wandering pinned, so runs are repeatable.
    const run = seconds => {
        const random = Math.random;
        Math.random = () => .5;
        try { for (let i = 0; i < Math.round(seconds * 20); i++) { animals.update(); build.defend(.05); } } finally { Math.random = random; }
    };
    return {engine, scene, game, camera, build, animals, notes, put, spawn, run};
}

// --- Rules --------------------------------------------------------------------
test('defences work on what hunts you, above ground, and on nothing else', () => {
    assert.deepEqual(DEFENCES, ['spikes', 'palisade', 'watchfire']);
    for (const type of DEFENCES) assert.ok(BUILDINGS[type].name && Object.keys(BUILDINGS[type].cost).length, type);
    for (const kind of ['wolf', 'icewolf', 'scorpion', 'toad', 'boar', 'bear']) assert.equal(isHunter({kind, health: 10}), true, kind);
    for (const kind of ['deer', 'rabbit']) assert.equal(isHunter({kind, health: 10}), false, kind);
    assert.equal(isHunter({kind: 'wolf', health: 0}), false, 'not the dead');
    assert.equal(isHunter({kind: 'icewolf', health: 10, dungeon: true}), false, 'nor anything underground');
    assert.equal(isHunter(null), false);
    assert.ok(SPIKES.damage > 0 && SPIKES.catches >= 5 && SPIKES.every > 0 && SPIKES.reach < SMALL_GAP);
    assert.ok(PALISADE.health / PALISADE.batter >= 20, 'a palisade holds one hunter for a good while, and a pack of seven for a few seconds');
    assert.ok(WATCHFIRE.pace > .4 && WATCHFIRE.pace < 1, 'wary, not frozen');
    assert.equal(spikesLeft({}), SPIKES.catches);
    assert.equal(spikesLeft({wear: 3}), SPIKES.catches - 3);
    assert.equal(spikesLeft({wear: 99}), 0);
    assert.equal(palisadeLeft({}), 1);
    assert.equal(palisadeLeft({wear: PALISADE.health / 4}), .75);
    assert.equal(palisadeLeft({wear: 1e6}), 0);
});

test('a step crosses a palisade only through its length, whichever way it is turned', () => {
    const along = {x: 10, z: 20, rotation: 0};
    const [a, b] = palisadeEnds(along);
    assert.ok(close(a.x, 10 - PALISADE.half) && close(b.x, 10 + PALISADE.half) && close(a.z, 20) && close(b.z, 20), 'unturned, it runs east to west');
    assert.equal(crossesPalisade(along, 10, 21, 10, 19), true);
    assert.equal(crossesPalisade(along, 10, 19, 10, 21), true, 'from either side');
    assert.equal(crossesPalisade(along, 11.9, 20.3, 12, 19.8), true);
    assert.equal(crossesPalisade(along, 10, 23, 10, 21), false, 'stopping short');
    assert.equal(crossesPalisade(along, 8, 21, 12, 21), false, 'walking alongside');
    assert.equal(crossesPalisade(along, 13, 21, 13, 19), false, 'round the end');
    assert.equal(crossesPalisade(along, 10 + PALISADE.half + .1, 21, 10 + PALISADE.half + .1, 19), false);
    const turned = {x: 10, z: 20, rotation: Math.PI / 2};
    const [c, d] = palisadeEnds(turned);
    assert.ok(close(c.x, 10, 1e-9) && close(d.x, 10, 1e-9) && close(Math.abs(c.z - d.z), PALISADE.half * 2), 'a quarter turn, north to south');
    assert.equal(crossesPalisade(turned, 11, 20, 9, 20), true);
    assert.equal(crossesPalisade(turned, 10, 21, 10, 19), false);
    const slant = {x: 0, z: 0, rotation: Math.PI / 4};
    const [e, f] = palisadeEnds(slant);
    // The ends lie where the model's ends are: Babylon turns +x towards -z.
    assert.ok(e.x < 0 && e.z > 0 && f.x > 0 && f.z < 0);
    assert.equal(crossesPalisade(slant, -1, -1, 1, 1), true);
    assert.equal(crossesPalisade(slant, -1, 1, 1, -1), false, 'along it');
});

// --- The pieces ------------------------------------------------------------------
test('the three pieces are built to size, and a chest no longer has a campfire inside it', () => {
    const {engine, build} = world();
    try {
        const made = type => { const record = {id: build.nextId++, type, x: 0, y: 0, z: 0, rotation: 0}; build.createVisible(record); return build.meshes.get(record.id); };
        const size = mesh => { const box = mesh.getBoundingInfo().boundingBox; return {wide: box.maximum.x - box.minimum.x, tall: box.maximum.y, deep: box.maximum.z - box.minimum.z}; };
        const spikes = made('spikes'), palisade = made('palisade'), watchfire = made('watchfire');
        assert.ok(size(spikes).tall < 1.2 && size(spikes).wide < SMALL_GAP, 'a trap is low and small');
        assert.ok(size(palisade).wide > 3.9 && size(palisade).wide < 4.5 && size(palisade).tall > 2.4 && size(palisade).deep < 1, 'a palisade fills its four metres');
        assert.ok(close(size(palisade).wide / 2, PALISADE.half, .3), 'and blocks about as much as it looks like it does');
        assert.ok(size(watchfire).tall > 2.2 && size(watchfire).wide < 2.2, 'a watch fire stands head high');
        assert.equal(palisade.checkCollisions, true, 'you cannot walk through a palisade either');
        assert.equal(spikes.checkCollisions, false);
        assert.equal(watchfire.checkCollisions, false);
        for (const mesh of [spikes, palisade, watchfire]) assert.equal(mesh.isPickable, false);
        // Every piece used to get the campfire's stones, logs and coals unless it was a shelter, floor, wall or roof.
        const fire = made('fire'), chest = made('chest'), garden = made('garden');
        assert.ok(chest.getTotalVertices() < fire.getTotalVertices() / 2, 'a chest is a box');
        assert.ok(garden.getTotalVertices() < fire.getTotalVertices() / 2, 'a garden bed is a frame of soil');
        assert.ok(size(chest).wide < 1.7, 'with no ring of stones sticking out of it');
        assert.ok(size(fire).wide > 2);
    } finally { engine.dispose(); }
});

test('traps and watch fires may stand close to things; palisades join up on the grid', () => {
    const {engine, game, build, put} = world();
    try {
        assert.deepEqual(SMALL_PIECES, ['spikes', 'watchfire', 'cookpot']);
        put('fire', 0, 0);
        const at = (x, z) => ({x, y: 2, z, rotation: 0});
        assert.equal(build.blockedReason('shelter', at(6, 0)), 'Too close to another structure');
        assert.equal(build.blockedReason('spikes', at(4, 0)), '', 'a trap by the fire');
        assert.equal(build.blockedReason('watchfire', at(0, 4)), '');
        assert.equal(build.blockedReason('spikes', at(2, 0)), 'Too close to another structure', `but not within ${SMALL_GAP} m`);
        put('spikes', 20, 0);
        assert.equal(build.blockedReason('spikes', at(22, 0)), 'Too close to another structure');
        assert.equal(build.blockedReason('spikes', at(24, 0)), '', 'traps in a row');
        assert.equal(build.blockedReason('shelter', at(24, 0)), '', 'and a trap does not keep a shelter seven metres off');
        put('palisade', 40, 40);
        assert.equal(build.blockedReason('palisade', at(44, 40)), '', 'the next length of the fence');
        assert.equal(build.blockedReason('palisade', at(40, 40)), 'That piece is already built here');
        // Building one costs what it says and saves.
        Object.assign(game.inventorySystem.inventory, {wood: 6, fiber: 0, stone: 0});
        assert.equal(build.canAfford('palisade'), true);
        assert.equal(build.canAfford('spikes'), false, 'no fiber for the lashings');
        assert.equal(build.canAfford('watchfire'), false);
    } finally { engine.dispose(); }
});

// --- What they do ------------------------------------------------------------------
test('a spike trap hurts and staggers a hunter standing on it, spares a deer, and breaks after its catches', () => {
    const {engine, game, build, notes, put, spawn} = world();
    try {
        const trap = put('spikes', 30, 30);
        const wolf = spawn('wolf', 30.5, 30.5), deer = spawn('deer', 30, 30), far = spawn('wolf', 30 + SPIKES.reach + 1, 30);
        const below = spawn('icewolf', 30, 30, {}); below.dungeon = true;
        const start = {wolf: wolf.health, deer: deer.health, far: far.health, below: below.health};
        build.defend(.05);
        assert.equal(wolf.health, start.wolf - SPIKES.damage);
        assert.ok(wolf.staggerTimer >= SPIKES.stagger);
        assert.deepEqual([deer.health, far.health, below.health], [start.deer, start.far, start.below]);
        assert.equal(spikesLeft(trap), SPIKES.catches - 1);
        build.defend(SPIKES.every / 2);
        assert.equal(wolf.health, start.wolf - SPIKES.damage, 'it needs a moment between catches');
        build.defend(SPIKES.every / 2);
        assert.equal(wolf.health, start.wolf - SPIKES.damage * 2);
        // Underground, the surface stands still and so does the trap.
        game.dungeonSystem.active = true;
        build.defend(5);
        assert.equal(wolf.health, start.wolf - SPIKES.damage * 2);
        game.dungeonSystem.active = false;
        // A dead hunter is no longer caught: the trap takes the next one.
        wolf.health = 0; far.mesh.position.x = 30;
        build.defend(SPIKES.every);
        assert.equal(far.health, start.far - SPIKES.damage);
        far.health = 1e6;
        for (let n = 3; n < SPIKES.catches; n++) { assert.ok(build.structures.includes(trap)); build.defend(SPIKES.every); }
        assert.equal(build.structures.includes(trap), false, 'worn out');
        assert.equal(build.meshes.has(trap.id), false);
        assert.equal(notes.at(-1), 'A spike trap has broken');
        const health = far.health;
        build.defend(SPIKES.every);
        assert.equal(far.health, health);
        assert.equal(build.remove(trap), false, 'already gone');
    } finally { engine.dispose(); }
});

test('a palisade stops a wolf until it is torn down, and a wolf with a way round takes it', () => {
    const {engine, camera, build, notes, put, spawn, run} = world();
    try {
        const fence = put('palisade', 0, 6);
        build.createVisible(fence);
        const wolf = spawn('wolf', 0, 12), free = spawn('wolf', 12, 0);
        run(3);
        assert.ok(wolf.mesh.position.z > 6 && wolf.mesh.position.z < 6.5, 'held at the fence');
        assert.ok(Math.hypot(free.mesh.position.x, free.mesh.position.z) < 3, 'the wolf with a clear run is on you');
        assert.ok(fence.wear > 5 && palisadeLeft(fence) < 1, 'and the fence is taking a battering');
        assert.equal(build.structures.includes(fence), true);
        const hold = PALISADE.health / PALISADE.batter;
        run(hold - 3 - 1.5);
        assert.equal(build.structures.includes(fence), true, `it holds one wolf for about ${hold} seconds`);
        run(4.5);   // The wolf spent its first second and a half getting to the fence.
        assert.equal(build.structures.includes(fence), false);
        assert.equal(build.meshes.has(fence.id), false);
        assert.equal(notes.filter(note => note === 'A palisade has been torn down').length, 1, 'said once, among the wolf attacks');
        run(3);
        assert.ok(Math.hypot(wolf.mesh.position.x - camera.position.x, wolf.mesh.position.z - camera.position.z) < 3, 'then it comes through');
        // Two at the same fence tear it down twice as fast.
        const second = put('palisade', 0, 6);
        const pair = [spawn('wolf', -1, 12), spawn('wolf', 1, 12)];
        wolf.health = 0; free.health = 0;
        run(hold / 2 + 2.5);
        assert.equal(build.structures.includes(second), false);
        assert.ok(pair.every(one => one.health > 0));
    } finally { engine.dispose(); }
});

test('a palisade stops the other hunters too, and prey walks where it likes', () => {
    const {engine, build, put, spawn, run} = world();
    try {
        const fence = put('palisade', 0, 6);
        const icewolf = spawn('icewolf', 0, 12, {});
        run(3);
        assert.ok(icewolf.mesh.position.z > 6, 'an ice wolf is held like any wolf');
        assert.ok(fence.wear > 5);
        assert.equal(build.barrier(0, 7, 0, 5), fence);
        assert.equal(build.barrier(0, 9, 0, 7), null);
        assert.equal(build.barrier(40, 7, 40, 5), null);
        // Underground creatures have their own walls.
        const {ai} = build.game.animalSystem;
        const delver = spawn('icewolf', 0, 7, {});
        const before = fence.wear;
        assert.equal(ai.move(delver, 0, -40, .05, null, {radius: .5}), false, 'blocked above ground');
        assert.ok(fence.wear > before);
        assert.ok(delver.mesh.position.z > 6);
    } finally { engine.dispose(); }
});

test('a watch fire slows hunters near it, warms like a campfire, and cooks nothing', () => {
    const lap = withFire => {
        const {engine, build, put, spawn, run} = world();
        try {
            if (withFire) put('watchfire', 3, 16);
            const wolf = spawn('wolf', 0, 20), icewolf = spawn('icewolf', 0, -16, {});
            run(1.5);
            return {wolf: 20 - wolf.mesh.position.z, icewolf: 16 + icewolf.mesh.position.z, build};
        } finally { engine.dispose(); }
    };
    const plain = lap(false), wary = lap(true);
    assert.ok(plain.wolf > 4, 'a wolf covers ground when nothing is in its way');
    assert.ok(close(wary.wolf / plain.wolf, WATCHFIRE.pace, .03), 'and is slowed by the watch fire');
    assert.ok(close(wary.icewolf, plain.icewolf, .01), 'one out of its reach is not');
    // The other hunters are as wary of it as wolves are.
    const {engine: e2, put: put2, spawn: spawn2, run: run2} = world();
    try {
        put2('watchfire', 3, -13);
        const icewolf = spawn2('icewolf', 0, -16, {});
        run2(1.5);
        assert.ok(plain.icewolf > 3);
        assert.ok(close((16 + icewolf.mesh.position.z) / plain.icewolf, WATCHFIRE.pace, .06), 'an ice wolf by a watch fire');
    } finally { e2.dispose(); }

    const {engine, build, put} = world();
    try {
        put('watchfire', 50, 50);
        assert.equal(build.wary(50, 50 + WATCHFIRE.reach - .1), WATCHFIRE.pace);
        assert.equal(build.wary(50, 50 + WATCHFIRE.reach + .1), 1);
        assert.equal(build.isProtected({x: 50, z: 50 + WATCHFIRE.warmth - .1}), true, 'warm beside it');
        assert.equal(build.isProtected({x: 50, z: 50 + WATCHFIRE.warmth + .5}), false);
        assert.equal(build.nearFire({x: 50, z: 50}), false, 'not a cooking fire');
        assert.equal(build.nearBed({x: 50, z: 50}), false);
    } finally { engine.dispose(); }
});

test('a save keeps how worn a trap or a palisade is', () => {
    const {engine, game, build, put} = world();
    try {
        const items = new Map();
        const storage = {setItem(key, value) { items.set(key, value); }, getItem(key) { return items.get(key) || null; }, removeItem(key) { items.delete(key); }};
        const saves = game.saveSystem = new SaveSystem(game, storage);
        const trap = put('spikes', 10, 10, 0, {wear: 4, cool: .5}), fence = put('palisade', 20, 20, Math.PI / 2, {wear: 37.5}), fresh = put('watchfire', 30, 30);
        assert.equal(saves.save(), true);
        const stored = JSON.parse([...items.values()].find(value => value.includes('"structures"'))).structures;
        assert.deepEqual(stored.map(item => Object.keys(item).sort().join()), ['id,rotation,type,wear,x,y,z', 'id,rotation,type,wear,x,y,z', 'id,rotation,type,x,y,z'], 'no wear, no field; and no cooldown saved');
        build.restore([]);
        assert.equal(saves.load(), true);
        const [a, b, c] = build.structures;
        assert.deepEqual([a.type, a.wear, b.type, b.wear, b.rotation, c.type, c.wear], ['spikes', 4, 'palisade', 37.5, Math.PI / 2, 'watchfire', undefined]);
        assert.equal(spikesLeft(a), SPIKES.catches - 4);
        assert.equal(palisadeLeft(b), .75);
        build.restore([{...trap, wear: -5}, {...fence, id: 9, wear: 'lots'}, {...fresh, id: 10, wear: Infinity}, {...fresh, id: 11, wear: 1e9}]);
        assert.deepEqual(build.structures.map(item => item.wear), [undefined, undefined, undefined, 1000]);
    } finally { engine.dispose(); }
});
