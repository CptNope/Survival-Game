// Tests for the three camera views, dodge and quick heal, and the dungeon
// dangers added with them: elites, slimes, mimics, spike traps, shrines, themes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import BABYLON from 'babylonjs';
import { VIEW_MODES, ZOOM, nextView, isView, clampZoom, cameraRig, clampRig, coneTarget } from '../js/view.js';
import {
    GRID, CELL, FLOOR, FLOORS, TRAP_CYCLE, THEMES, STARTER_DUNGEON, trapState, themeFor, dungeonForCell,
    generateFloor, floorSeed, flowField, centreOf, cellOf, isOpen
} from '../js/dungeon.js';
import { CREATURES, ELITE } from '../js/creatures.js';
import { ViewSystem } from '../js/components/view.js';
import { BuffSystem, BOONS } from '../js/components/buffs.js';
import { GearSystem } from '../js/components/equipment.js';
import { DungeonSystem, DUNGEON_DEPTH } from '../js/components/dungeon.js';
import { AnimalSystem } from '../js/components/animals.js';
import { InventorySystem } from '../js/components/inventory.js';
import { CombatSystem } from '../js/components/combat.js';
import { PlayerSystem, DODGE } from '../js/components/player.js';
import { SurvivalSystem } from '../js/components/survival.js';
import { BuildingSystem } from '../js/components/building.js';
import { ProgressionSystem } from '../js/components/progression.js';
import { SOUNDS } from '../js/components/audio.js';
import { normalizeSettings } from '../js/settings.js';

globalThis.BABYLON = BABYLON;

// Real systems on the headless engine; the player's body is a real camera.
function world() {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    engine.getDeltaTime = () => 50;
    scene.getAnimationRatio = () => 1;
    const notes = [];
    const game = {
        scene, engine, paused: false, dayTime: 60, dayLength: 300, dayCount: 1, settings: normalizeSettings(null),
        updateSettings(changes) { Object.assign(this.settings, changes); },
        uiSystem: {
            notes, showNotification(message) { notes.push(message); }, showLoot() {}, updateInventoryUI() {},
            updateExperienceUI() {}, updateHealthUI() {}, updateGearUI() {}, showLevelUpMessage() {},
            setSaveStatus() {}, showDayBanner() {}, showGatherProgress() {}
        },
        terrainSystem: {
            waterHeight: 1, getPerlinHeight: () => 2, isWaterArea: () => false, isWithinSpawnArea: () => false,
            harvestedIds: new Set(), harvestedOn: new Map(), chunkMap: new Map(), checkChunkUpdates() {}
        },
        explorationSystem: {discovered: new Set(), isClearing: () => false},
        registerModelShadow() {},
        effects: {heldKind: null, torchLit: false, swingStart: -1e9, firstPerson: true, setFirstPerson(first) { this.firstPerson = first; }}
    };
    const player = game.playerSystem = Object.create(PlayerSystem.prototype);
    const camera = new BABYLON.FreeCamera('body', new BABYLON.Vector3(STARTER_DUNGEON.x + 3, 4, STARTER_DUNGEON.z + 3), scene);
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
    game.dungeonSystem = new DungeonSystem(game);
    game.animalSystem = new AnimalSystem(game);
    game.animalSystem.animals = [];
    return {engine, scene, game, player, camera, notes};
}

// --- Camera maths ---------------------------------------------------------
test('views cycle first, third, overhead and the rigs sit where they should', () => {
    assert.deepEqual([...VIEW_MODES], ['first', 'third', 'overhead']);
    assert.equal(nextView('first'), 'third');
    assert.equal(nextView('third'), 'overhead');
    assert.equal(nextView('overhead'), 'first');
    assert.equal(nextView('nonsense'), 'first');
    assert.ok(isView('overhead') && !isView('side'));
    assert.equal(clampZoom('third', 99), ZOOM.third.max);
    assert.equal(clampZoom('overhead', -5), ZOOM.overhead.min);

    const eye = {x: 10, y: 4, z: -6};
    for (const yaw of [0, 1, 2.5, -2]) {
        const facing = {x: Math.sin(yaw), z: Math.cos(yaw)};
        const behind = rig => (rig.position.x - eye.x) * facing.x + (rig.position.z - eye.z) * facing.z;
        const third = cameraRig('third', eye, yaw, 0, 5.5);
        assert.ok(behind(third) < -4.5, 'third-person camera trails the player');
        assert.ok(third.position.y > eye.y && third.position.y < eye.y + 1.5);
        assert.ok((third.target.x - third.position.x) * facing.x + (third.target.z - third.position.z) * facing.z > 0, 'and looks the way they face');
        // Looking down swings the camera up and over; looking up drops it low.
        assert.ok(cameraRig('third', eye, yaw, .8, 5.5).position.y > third.position.y + 2);
        assert.ok(cameraRig('third', eye, yaw, -.4, 5.5).position.y < third.position.y - 1);
        const above = cameraRig('overhead', eye, yaw, .7, 20);
        assert.equal(above.position.y, eye.y + 20);
        assert.ok(behind(above) < -5 && behind(above) > -12, 'overhead sits a little behind, so forward is up the screen');
        assert.deepEqual(above, cameraRig('overhead', eye, yaw, -1, 20), 'pitch does not matter from above');
    }
});

test('the third-person camera is pulled in front of whatever blocks it', () => {
    const anchor = {x: 0, y: 4, z: 0}, rig = {position: {x: 0, y: 4, z: -10}};
    const open = clampRig(rig, anchor, () => true);
    assert.ok(Math.abs(open.z + 10) < 1e-9 && open.fraction === 1);
    const wall = clampRig(rig, anchor, (x, y, z) => z > -4);
    assert.ok(wall.z > -4 && wall.z < -2.5, 'stops just short of the wall at z = -4');
    const boxed = clampRig(rig, anchor, () => false);
    assert.ok(boxed.fraction > 0 && boxed.fraction < .2, 'never collapses onto the eye itself');
});

test('without a reticle the target is whatever stands closest in front', () => {
    const origin = {x: 0, z: 0};
    const ahead = {x: 0, z: 3, id: 'ahead'}, nearer = {x: .5, z: 2, id: 'nearer'}, behind = {x: 0, z: -3, id: 'behind'},
        far = {x: 0, z: 9, id: 'far'}, touching = {x: 0, z: -1, id: 'touching'}, side = {x: 3, z: .2, id: 'side'};
    assert.equal(coneTarget(origin, 0, [ahead, nearer, behind, far], 5).id, 'nearer');
    assert.equal(coneTarget(origin, 0, [behind, far], 5), null);
    assert.equal(coneTarget(origin, Math.PI, [ahead, behind], 5).id, 'behind', 'turning round changes the target');
    assert.equal(coneTarget(origin, 0, [touching], 5).id, 'touching', 'anything close enough to touch counts');
    assert.equal(coneTarget(origin, 0, [side], 5), null, 'well off to the side is not in front');
    assert.equal(coneTarget(origin, Math.PI / 2, [side], 5).id, 'side');
    // A creature is preferred to a bush at a similar distance; reach includes its bulk.
    assert.equal(coneTarget(origin, 0, [{...nearer, bias: 0}, {...ahead, bias: 1.6}], 5).id, 'ahead');
    assert.equal(coneTarget(origin, 0, [{x: 0, z: 5.8, radius: 1.4, id: 'big'}], 5).id, 'big');
});

// --- The view system ------------------------------------------------------
test('switching views swaps the camera, shows the avatar and is remembered', () => {
    const {engine, scene, game, camera} = world();
    try {
        scene.activeCamera = camera;
        game.effects.heldKind = 'tools';
        const view = game.viewSystem = new ViewSystem(game);
        assert.equal(view.mode, 'first');
        assert.equal(scene.activeCamera, camera);
        assert.equal(view.avatar.root.isEnabled(), false, 'no body to see in first person');

        assert.equal(view.cycle(), true);
        assert.equal(view.mode, 'third');
        assert.equal(scene.activeCamera, view.camera);
        assert.equal(view.avatar.root.isEnabled(), true);
        assert.equal(game.effects.firstPerson, false, 'the first-person tool is put away');
        assert.equal(view.heldKind, 'tools', 'and the avatar carries it instead');
        assert.equal(game.settings.view, 'third');
        const facing = {x: Math.sin(camera.rotation.y), z: Math.cos(camera.rotation.y)};
        assert.ok((view.camera.position.x - camera.position.x) * facing.x + (view.camera.position.z - camera.position.z) * facing.z < -3);

        // Zoom is clamped, and only applies outside first person.
        for (let n = 0; n < 40; n++) view.zoomBy(1);
        assert.equal(view.zoom.third, ZOOM.third.max);
        for (let n = 0; n < 40; n++) view.zoomBy(-1);
        assert.equal(view.zoom.third, ZOOM.third.min);

        view.cycle();
        assert.equal(view.mode, 'overhead');
        camera.rotation.x = .9;
        view.update(.05);
        assert.equal(camera.rotation.x, 0, 'pitch is pinned level under the overhead camera');
        assert.ok(view.camera.position.y > camera.position.y + ZOOM.overhead.min - 1);
        view.cycle();
        assert.equal(view.mode, 'first');
        assert.equal(scene.activeCamera, camera);
        assert.equal(view.zoomBy(1), false);
        assert.equal(game.effects.firstPerson, true);
        assert.equal(view.heldKind, null);
        assert.equal(view.setMode('sideways'), false);

        // A saved preference is restored on the next start.
        game.settings.view = 'overhead';
        assert.equal(new ViewSystem(game).mode, 'overhead');
        assert.equal(normalizeSettings({view: 'third'}).view, 'third');
        assert.equal(normalizeSettings({view: 7}).view, 'first');
    } finally { engine.dispose(); }
});

test('overhead aiming picks what is in front, feeds gathering and combat, and respects walls', () => {
    const {engine, game, camera} = world();
    try {
        const view = game.viewSystem = new ViewSystem(game);
        view.setMode('overhead', false);
        camera.position.set(0, 4, 0); camera.rotation.y = 0;
        const animals = game.animalSystem;
        const front = animals.spawnAnimal(.5, 2, 3, 'boar'), back = animals.spawnAnimal(0, 2, -3, 'boar');
        const hit = game.viewSystem.pick(5);
        assert.equal(hit.hit, true);
        assert.equal(hit.pickedMesh, front.mesh);
        assert.equal(game.combatSystem.constructor.prototype.targeted.call(game.combatSystem, hit), front);
        camera.rotation.y = Math.PI;
        assert.equal(view.pick(5).pickedMesh, back.mesh);
        // The same hit drives the swing: no first-person ray is involved.
        game.pickTarget = range => view.pick(range);
        const health = back.health;
        assert.equal(game.combatSystem.tryAttack(), true);
        assert.ok(back.health < health);

        // Gathering: a tree in front is targeted when no creature is.
        animals.animals = [];
        camera.rotation.y = 0;
        const tree = {type: 'tree', mesh: {position: new BABYLON.Vector3(0, 2, 3.5), dispose() {}}};
        game.inventorySystem.harvestableObjects = [tree];
        assert.equal(game.inventorySystem.findTarget(), tree);
        camera.rotation.y = Math.PI;
        assert.equal(game.inventorySystem.findTarget(), null);

        // Underground, a creature behind a wall cannot be targeted.
        const grid = new Uint8Array(GRID * GRID);
        for (let y = 2; y <= 6; y++) for (const x of [2, 3, 4, 6, 7, 8]) grid[y * GRID + x] = FLOOR;
        const layout = {grid, originX: 0, originZ: 0};
        Object.assign(game.dungeonSystem, {active: true, layout, site: {...STARTER_DUNGEON}, floor: 1});
        const here = centreOf(layout, 4, 4), beyond = centreOf(layout, 6, 4), beside = centreOf(layout, 3, 4);
        camera.position.set(here.x, DUNGEON_DEPTH + 2, here.z); camera.rotation.y = Math.PI / 2;
        const hidden = animals.spawnAnimal(beyond.x, DUNGEON_DEPTH, beyond.z, 'skeleton', {dungeon: true});
        assert.equal(view.pick(9).hit, false, 'solid rock is in the way');
        camera.rotation.y = -Math.PI / 2;
        const seen = animals.spawnAnimal(beside.x, DUNGEON_DEPTH, beside.z, 'skeleton', {dungeon: true});
        assert.equal(view.pick(9).pickedMesh, seen.mesh);
        assert.notEqual(hidden, seen);
        // The marker ring follows the target.
        view.targetTimer = 0;
        view.update(.05);
        assert.equal(view.marker.isEnabled(), true);
        assert.ok(Math.abs(view.marker.position.x - beside.x) < 1e-6);
    } finally { engine.dispose(); }
});

test('the third-person camera stays inside dungeon walls and hides the avatar when cramped', () => {
    const {engine, game, camera} = world();
    try {
        const view = game.viewSystem = new ViewSystem(game);
        const dungeon = game.dungeonSystem;
        dungeon.scanEntrances();
        dungeon.enter(STARTER_DUNGEON);
        game.animalSystem.animals = [];
        view.setMode('third', false);
        const layout = dungeon.layout;
        for (const room of layout.rooms) for (const yaw of [0, 1.57, 3.14, -1.57]) {
            const spot = centreOf(layout, room.x, room.y); // A corner: walls on two sides.
            camera.position.set(spot.x, DUNGEON_DEPTH + 2, spot.z); camera.rotation.y = yaw; camera.rotation.x = .2;
            view.place();
            const cell = cellOf(layout, view.camera.position.x, view.camera.position.z);
            assert.ok(isOpen(layout, cell.x, cell.y), 'the camera never ends up inside rock');
            assert.ok(view.camera.position.y < DUNGEON_DEPTH + dungeon.ceiling);
            assert.equal(view.avatar.root.isEnabled(), !view.cramped);
        }
        // Overhead looks through the roof: the ceiling goes, rock caps appear.
        assert.equal(dungeon.ceilingMesh.isEnabled(), true);
        view.setMode('overhead', false);
        assert.equal(dungeon.ceilingMesh.isEnabled(), false);
        assert.equal(dungeon.capMesh.isEnabled(), true);
        assert.ok(dungeon.capMesh.getTotalVertices() > 100);
        dungeon.descend();
        assert.equal(dungeon.ceilingMesh.isEnabled(), false, 'a new floor keeps the same view');
        view.setMode('first', false);
        assert.equal(dungeon.ceilingMesh.isEnabled(), true);
        assert.equal(dungeon.capMesh.isEnabled(), false);
    } finally { engine.dispose(); }
});

// --- Dodge and quick heal --------------------------------------------------
test('a dodge covers a fixed distance, shrugs off blows and then needs a moment', () => {
    const {engine, player, camera} = world();
    try {
        camera.position.set(0, 4, 0); camera.rotation.y = 0;
        // Move the body the way the engine would: apply and clear the pending direction.
        camera.inertia = .12;
        const step = () => { player.update(); camera.position.addInPlace(camera.cameraDirection); camera.cameraDirection.scaleInPlace(camera.inertia); };
        step();
        assert.equal(player.dodge(), true);
        player.takeDamage(40, 'a wolf');
        assert.equal(player.health, 100, 'a blow during the dodge misses');
        player.takeDamage(5, 'starvation');
        assert.equal(player.health, 95, 'hunger cannot be dodged');
        assert.equal(player.dodge(), false, 'no chaining dodges');
        for (let n = 0; n < 20; n++) step();
        assert.ok(Math.abs(camera.position.z + DODGE.distance) < 1e-3, 'standing still, the dodge is a hop backwards');
        assert.ok(Math.abs(camera.position.x) < 1e-6);

        // Moving: the dodge follows the direction of travel.
        player.dodgeReadyAt = 0; player.invulnerableUntil = 0;
        camera.position.set(0, 4, 0);
        player.previous = {x: -.3, z: 0};
        step();
        assert.equal(player.dodge(), true);
        for (let n = 0; n < 20; n++) step();
        assert.ok(Math.abs(camera.position.x - DODGE.distance) < 1e-3 && Math.abs(camera.position.z) < 1e-3);
        // Once it is over, blows land again.
        player.invulnerableUntil = 0;
        player.takeDamage(10, 'a wolf');
        assert.equal(player.health, 85);
        player.dodgeReadyAt = 0;
        player.isSwimming = true;
        assert.equal(player.dodge(), false);
        player.isSwimming = false; player.isDead = true;
        assert.equal(player.dodge(), false);
        assert.ok(SOUNDS.dodge);
    } finally { engine.dispose(); }
});

test('quick heal uses the strongest remedy carried and wastes nothing at full health', () => {
    const {engine, game, player, notes} = world();
    try {
        const pack = game.inventorySystem, items = pack.inventory;
        Object.assign(items, {herbs: 2, fiber: 2, wood: 3, berries: 2});
        assert.equal(pack.quickHeal(), false);
        assert.match(notes.at(-1), /full health/);
        assert.equal(items.wood, 3);
        player.health = 20;
        assert.equal(pack.quickHeal(), true);
        assert.equal(player.health, 70, 'the herbal wrap first');
        assert.deepEqual([items.herbs, items.fiber, items.wood], [0, 0, 3]);
        assert.equal(pack.quickHeal(), true);
        assert.equal(player.health, 100, 'then a field dressing');
        assert.equal(items.wood, 0);
        player.health = 50;
        assert.equal(pack.quickHeal(), true);
        assert.equal(player.health, 65, 'then berries');
        player.health = 50;
        assert.equal(pack.quickHeal(), false);
        assert.match(notes.at(-1), /Nothing to heal with/);
    } finally { engine.dispose(); }
});

// --- Dungeon dangers --------------------------------------------------------
test('generated floors place traps, shrines, mimics and elites by the rules', () => {
    let trapped = 0, shrines = 0, mimics = 0, elites = 0, slimes = 0;
    for (let seed = 1; seed <= 80; seed++) for (let floor = 1; floor <= FLOORS; floor++) {
        const layout = generateFloor(floorSeed('dungeon:rules', seed, floor), floor);
        const label = `seed ${seed} floor ${floor}`, open = (x, y) => layout.grid[y * GRID + x] === FLOOR;
        const inRoom = (x, y) => layout.rooms.some(room => x >= room.x && x < room.x + room.w && y >= room.y && y < room.y + room.h);
        const fromStart = flowField(layout.grid, layout.start.x, layout.start.y);
        for (const trap of layout.traps) {
            trapped++;
            assert.ok(open(trap.x, trap.y) && !inRoom(trap.x, trap.y), label + ': traps belong in corridors');
            assert.ok(fromStart[trap.y * GRID + trap.x] >= 3, label + ': never on the first steps in');
            const walled = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => !open(trap.x + dx, trap.y + dy)).length;
            assert.equal(walled, 2, label + ': a straight stretch, so it cannot be walked around');
            assert.ok(trap.phase >= 0 && trap.phase < TRAP_CYCLE);
        }
        assert.ok(layout.traps.length <= floor + 1);
        if (layout.shrine) { shrines++; assert.ok(open(layout.shrine.x, layout.shrine.y) && inRoom(layout.shrine.x, layout.shrine.y), label); }
        const plain = layout.chests.filter(chest => chest.tier === 'chest');
        const fake = layout.chests.filter(chest => chest.mimic);
        mimics += fake.length;
        assert.ok(fake.every(chest => chest.tier === 'chest'), label + ': the boss hoard is never a mimic');
        if (floor === 1) assert.equal(fake.length, 0, label + ': the first floor is honest');
        if (plain.length) assert.ok(fake.length < plain.length, label + ': at least one real chest');
        const elite = layout.spawns.filter(spawn => spawn.elite);
        elites += elite.length;
        assert.ok(elite.length <= 1 && elite.every(spawn => spawn.kind !== 'warden' && spawn.kind !== 'bat'), label);
        if (floor >= 2) assert.equal(elite.length, 1, label + ': deeper floors always have an elite');
        slimes += layout.spawns.filter(spawn => spawn.kind === 'slime').length;
    }
    assert.ok(trapped > 200 && shrines > 100 && shrines < 190 && mimics > 30 && elites > 180 && slimes > 100,
        JSON.stringify({trapped, shrines, mimics, elites, slimes}));
});

test('a spike trap rests, warns, strikes and retracts on a fixed cycle', () => {
    assert.equal(trapState(0).stage, 'rest');
    assert.equal(trapState(2).stage, 'warn');
    assert.equal(trapState(2).raised, 0, 'the warning comes before the points do');
    assert.equal(trapState(2.8).stage, 'up');
    assert.equal(trapState(2.8).raised, 1);
    assert.equal(trapState(3.3).stage, 'rest');
    assert.ok(trapState(3.2).raised > 0 && trapState(3.2).raised < 1, 'retracting');
    for (const t of [.4, 2.1, 2.9]) assert.equal(trapState(t + TRAP_CYCLE * 7).stage, trapState(t).stage, 'the cycle repeats');
    assert.equal(trapState(0, 2.8).stage, 'up', 'phase offsets neighbouring traps');
    let warned = 0;
    for (let t = 0; t < TRAP_CYCLE; t += .01) if (trapState(t).stage === 'warn') warned += .01;
    assert.ok(warned > .5, 'there is always time to step off');
});

test('standing on a trap as it strikes hurts once; waiting or jumping does not', () => {
    const {engine, game, player, camera} = world();
    try {
        const dungeon = game.dungeonSystem;
        dungeon.scanEntrances();
        dungeon.enter(STARTER_DUNGEON);
        game.animalSystem.animals = [];
        const layout = dungeon.layout;
        assert.equal(dungeon.traps.length, layout.traps.length);
        // Make sure there is a trap to test whatever this layout rolled.
        if (!dungeon.traps.length) dungeon.traps.push({mesh: {material: {}}, spikes: {position: {y: 0}}, phase: 0, x: camera.position.x, z: camera.position.z, struck: false, stage: 'rest'});
        const trap = dungeon.traps[0];
        dungeon.traps = [trap];
        const run = (frames, each) => { for (let n = 0; n < frames; n++) { each?.(); dungeon.updateTraps(); dungeon.time += .05; } };
        const stand = () => { camera.position.x = trap.x; camera.position.z = trap.z; camera.position.y = DUNGEON_DEPTH + 2; };
        dungeon.time = 0; trap.phase = 0;
        run(Math.round(TRAP_CYCLE * 2 / .05), stand);
        assert.equal(Math.round(100 - player.health), 18, 'one hit per strike, two strikes in two cycles');
        assert.equal(player.lastDamageCause, 'a spike trap');
        assert.ok(SOUNDS.trap);

        // Step off during the warning, back on after: unharmed.
        player.health = 100; dungeon.time = 0;
        run(Math.round(TRAP_CYCLE / .05), () => {
            stand();
            if (trapState(dungeon.time).stage !== 'rest' || trapState(dungeon.time).raised > 0) camera.position.x = trap.x + 3;
        });
        assert.equal(player.health, 100);
        // In the air over the points: unharmed.
        dungeon.time = 0;
        run(Math.round(TRAP_CYCLE / .05), () => { stand(); camera.position.y = DUNGEON_DEPTH + 3.2; });
        assert.equal(player.health, 100);
        // The spikes really move.
        dungeon.time = 2.8; dungeon.updateTraps();
        const raised = trap.spikes.position.y;
        dungeon.time = .5; dungeon.updateTraps();
        assert.ok(raised > trap.spikes.position.y + 1);
    } finally { engine.dispose(); }
});

test('a shrine gives one boon per floor, and boons change the fight until they fade', () => {
    const {engine, game, player, camera, notes} = world();
    try {
        const dungeon = game.dungeonSystem, buffs = game.buffs;
        dungeon.scanEntrances();
        dungeon.enter(STARTER_DUNGEON);
        game.animalSystem.animals = [];
        // Put a shrine on this floor whatever the layout rolled.
        dungeon.layout.shrine = dungeon.layout.shrine || {...dungeon.layout.rooms.find(room => room.kind === 'room')};
        dungeon.layout.shrine = {x: dungeon.layout.shrine.x, y: dungeon.layout.shrine.y};
        const shrineCell = dungeon.layout.shrine;
        const generate = dungeon.buildFloor.bind(dungeon);
        dungeon.shrine = null;
        const spot = centreOf(dungeon.layout, shrineCell.x, shrineCell.y);
        dungeon.shrine = {mesh: {metadata: {rune: {setEnabled() {}}}, position: new BABYLON.Vector3(spot.x, DUNGEON_DEPTH, spot.z)}, used: false, x: spot.x, z: spot.z};
        camera.position.x = spot.x + 1.5; camera.position.z = spot.z;
        assert.match(dungeon.interaction().label, /touch the shrine/);

        // Hurt: the shrine may heal instead of blessing. Either way it works once.
        player.health = 30;
        const realRandom = Math.random;
        Math.random = () => .999; // The last option: healing.
        try { assert.equal(game.survivalSystem.interact(), true); } finally { Math.random = realRandom; }
        assert.equal(player.health, 100);
        assert.equal(dungeon.shrine.used, true);
        assert.equal(dungeon.useShrine(), false);
        assert.notEqual(dungeon.interaction()?.label, 'Press E to touch the shrine');
        assert.ok(dungeon.runs[STARTER_DUNGEON.id].opened.includes('shrine:1'), 'remembered for the rest of the epoch');
        assert.equal(game.progression.stats.shrines, 1);
        assert.equal(typeof generate, 'function');
        // At full health a shrine never wastes itself on healing.
        Math.random = () => .999;
        try {
            dungeon.shrine.used = false;
            assert.equal(dungeon.useShrine(), true);
        } finally { Math.random = realRandom; }
        assert.equal(game.buffs.list().length, 1);
        game.buffs.restore({});

        // Each boon does what it says.
        const base = game.combatSystem.damage();
        buffs.add('fury');
        assert.ok(Math.abs(game.combatSystem.damage() - base * BOONS.fury.damage) < 1e-9);
        buffs.add('stoneskin');
        player.takeDamage(20, 'a skeleton');
        assert.equal(player.health, 86);
        player.takeDamage(10, 'the cold');
        assert.equal(player.health, 76, 'stoneskin does not stop the cold');
        buffs.add('haste');
        assert.ok(Math.abs(game.combatSystem.cooldown(450) - 375) < 1e-9);
        assert.equal(buffs.factor('speed'), 1.2);
        assert.equal(buffs.list().length, 3);

        // Time runs them out; saving keeps what is left.
        buffs.update(100);
        const saved = JSON.parse(JSON.stringify(buffs.capture()));
        assert.equal(saved.fury, 20);
        buffs.update(21);
        assert.equal(buffs.list().length, 0);
        assert.equal(game.combatSystem.damage(), base);
        assert.ok(notes.some(note => /has faded/.test(note)));
        buffs.restore({...saved, nonsense: 50, haste: -3, stoneskin: 'x'});
        assert.deepEqual(buffs.list().map(boon => boon.id), ['fury']);
        assert.equal(buffs.add('nonsense'), false);
        for (const boon of Object.values(BOONS)) assert.ok(boon.label && boon.text && boon.seconds > 0);
    } finally { engine.dispose(); }
});

test('a mimic keeps its loot until it is beaten, and never leaves a chest behind', () => {
    const {engine, game, camera} = world();
    try {
        const dungeon = game.dungeonSystem, animals = game.animalSystem;
        // Find a dungeon whose second floor really does hide a mimic.
        let site = null;
        for (let n = 0; n < 400 && !site; n++) {
            const candidate = {id: 'dungeon:mimic' + n, name: 'Test Hollow', x: 40, z: 40, tier: 1};
            if (generateFloor(floorSeed(candidate.id, dungeon.runFor(candidate).epoch, 2), 2).chests.some(cell => cell.mimic)) site = candidate;
        }
        assert.ok(site, 'some dungeon has a mimic');
        dungeon.enter(site);
        dungeon.descend();
        animals.animals = [];
        const chest = dungeon.chests.find(candidate => candidate.mimic);
        assert.ok(chest && !chest.boss);
        const chests = dungeon.chests.length;
        camera.position.x = chest.x + 1; camera.position.z = chest.z;
        assert.match(dungeon.interaction().label, /open the chest/, 'it looks like any other chest');
        assert.equal(game.survivalSystem.interact(), true);
        assert.equal(dungeon.chests.length, chests - 1);
        assert.equal(game.gear.drops.length, 0, 'no loot yet');
        const mimic = animals.animals.find(animal => animal.kind === 'mimic');
        assert.ok(mimic && mimic.dungeon && mimic.fleeTimer > 0, 'awake and coming for you');
        assert.equal(game.progression.stats.chests, 0);
        mimic.health = 0;
        animals.update();
        assert.equal(game.gear.drops.length, 1, 'it always drops gear');
        // Rebuilding the floor does not bring the false chest back.
        game.gear.collectStragglers();
        dungeon.buildFloor(2);
        assert.equal(dungeon.chests.length, chests - 1);
        assert.ok(SOUNDS[CREATURES.mimic.sound] && SOUNDS[CREATURES.slime.sound]);
    } finally { engine.dispose(); }
});

test('elites are tougher and always carry gear; slimes split when they die', () => {
    const {engine, game} = world();
    try {
        const dungeon = game.dungeonSystem, animals = game.animalSystem;
        dungeon.scanEntrances();
        dungeon.enter(STARTER_DUNGEON);
        animals.animals = [];
        const start = centreOf(dungeon.layout, dungeon.layout.start.x, dungeon.layout.start.y);
        const plain = animals.spawnAnimal(start.x, DUNGEON_DEPTH, start.z, 'skeleton', {dungeon: true, tier: 1, floor: 1});
        const elite = animals.spawnAnimal(start.x, DUNGEON_DEPTH, start.z, 'skeleton', {dungeon: true, tier: 1, floor: 1, elite: true});
        assert.equal(plain.elite, false);
        assert.equal(elite.maxHealth, Math.round(plain.maxHealth * ELITE.health));
        assert.ok(Math.abs(elite.damageScale - plain.damageScale * ELITE.damage) < 1e-9);
        assert.equal(elite.mesh.scaling.x, ELITE.size);
        const boss = animals.spawnAnimal(start.x, DUNGEON_DEPTH, start.z, 'warden', {dungeon: true, elite: true});
        assert.equal(boss.elite, false, 'the boss is never an elite');
        // An elite's drop is not left to chance, and it rolls with better odds.
        for (let round = 0; round < 12; round++) {
            const victim = animals.spawnAnimal(start.x, DUNGEON_DEPTH, start.z, 'skeleton', {dungeon: true, tier: 1, floor: 1, elite: true});
            animals.animals = [victim];
            const rolls = [], roll = game.gear.dropRoll;
            game.gear.dropRoll = function (position, options) { rolls.push(options); return roll.call(this, position, options); };
            try { victim.health = 0; animals.update(); } finally { game.gear.dropRoll = roll; }
            assert.equal(rolls.length, 1, 'an elite always drops something');
            assert.equal(rolls[0].level, 2, 'a level above the floor');
            assert.ok(Math.abs(rolls[0].luck - (CREATURES.skeleton.gear.luck + ELITE.luck)) < 1e-9);
        }
        assert.ok(CREATURES.skeleton.gear.chance < 1, 'where an ordinary skeleton often drops nothing');
        game.gear.collectStragglers();
        animals.animals = [];

        const slime = animals.spawnAnimal(start.x, DUNGEON_DEPTH, start.z, 'slime', {dungeon: true, tier: 1, floor: 1});
        slime.health = 0;
        animals.update();
        const small = animals.animals.filter(animal => animal.kind === 'slimelet');
        assert.equal(small.length, CREATURES.slime.split.count);
        for (const piece of small) {
            const cell = cellOf(dungeon.layout, piece.mesh.position.x, piece.mesh.position.z);
            assert.ok(isOpen(dungeon.layout, cell.x, cell.y));
            assert.ok(piece.fleeTimer > 0, 'the pieces keep fighting');
        }
        for (const piece of small) piece.health = 0;
        animals.update();
        assert.equal(animals.animals.length, 0, 'slimelets do not split again');
    } finally { engine.dispose(); }
});

test('dungeons have themes, and a frozen vault is cold without a torch', () => {
    assert.equal(themeFor(STARTER_DUNGEON).id, 'crypt');
    assert.equal(themeFor(null).id, 'crypt');
    const seen = new Set();
    for (let cx = -6; cx <= 6; cx++) for (let cz = -6; cz <= 6; cz++) {
        const site = dungeonForCell(cx, cz);
        if (!site) continue;
        assert.equal(themeFor(site), themeFor({...site}), 'a dungeon keeps its theme');
        seen.add(themeFor(site).id);
    }
    assert.deepEqual([...seen].sort(), THEMES.map(theme => theme.id).sort());
    for (const theme of THEMES) for (const key of ['floor', 'wall', 'roof', 'fog', 'ambient'])
        assert.ok(theme[key].length === 3 && theme[key].every(value => value >= 0 && value <= 1), theme.id + '.' + key);

    const {engine, game} = world();
    try {
        const survival = game.survivalSystem, dungeon = game.dungeonSystem;
        dungeon.active = true;
        const chill = () => { survival.cold = 50; survival.update(.05); return survival.cold - 50; };
        dungeon.theme = THEMES.find(theme => theme.id === 'crypt');
        assert.ok(chill() < 0, 'an ordinary dungeon lets the cold ease');
        dungeon.theme = THEMES.find(theme => theme.id === 'frost');
        const dark = chill();
        assert.ok(dark > 0, 'a frozen vault bites');
        game.effects.torchLit = true;
        const lit = chill();
        assert.ok(lit > 0 && lit < dark * .3, 'a torch holds most of it off');
    } finally { engine.dispose(); }
});

test('the offline cache lists the new view and boon modules', async () => {
    const worker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
    for (const file of ['js/view.js', 'js/models/avatar.js', 'js/components/view.js', 'js/components/buffs.js'])
        assert.ok(worker.includes(`'./${file}'`), file + ' is not precached');
});

test('a pinch zooms the outside cameras: fingers apart brings the view closer', async () => {
    const { pinchSteps } = await import('../js/components/touch.js');
    assert.equal(pinchSteps(100, 100), 0);
    assert.equal(pinchSteps(100, 180), -2, 'spreading zooms in');
    assert.equal(pinchSteps(180, 100), 2, 'pinching zooms out');
    assert.equal(pinchSteps(0, 900), -3, 'one jump of the fingers cannot fling the camera');
    assert.equal(pinchSteps(NaN, 50), 0);
    const {engine, game} = world();
    try {
        const view = game.viewSystem = new ViewSystem(game);
        view.setMode('overhead', false);
        const start = view.zoom.overhead;
        view.zoomBy(pinchSteps(100, 180));
        assert.equal(view.zoom.overhead, start - 4);
        // A portrait screen sits the camera further back for the same zoom.
        const height = () => view.camera.position.y - game.playerSystem.camera.position.y;
        engine.getRenderWidth = () => 1280; engine.getRenderHeight = () => 720;
        view.place();
        const landscape = height();
        engine.getRenderWidth = () => 412; engine.getRenderHeight = () => 915;
        view.place();
        assert.ok(Math.abs(height() - landscape * 1.3) < 1e-6);
    } finally { engine.dispose(); }
});
