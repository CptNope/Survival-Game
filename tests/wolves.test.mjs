// Tests for tiered wolves and alphas, Greenwood packs led by one, and the
// map drawn in the season's colours.
import test from 'node:test';
import assert from 'node:assert/strict';
import BABYLON from 'babylonjs';
import { CREATURES, ELITE, ALPHA, WOLF_BITE, wolfBite, wolfName, nightWolf, scaleFor } from '../js/creatures.js';
import { raidPack } from '../js/raids.js';
import { MAP_COLORS, mapColors } from '../js/map.js';
import { seasonLook } from '../js/seasons.js';
import { AnimalSystem } from '../js/components/animals.js';
import { RaidSystem } from '../js/components/raids.js';
import { InventorySystem } from '../js/components/inventory.js';
import { CombatSystem } from '../js/components/combat.js';
import { PlayerSystem } from '../js/components/player.js';
import { ProgressionSystem } from '../js/components/progression.js';
import { normalizeSettings } from '../js/settings.js';

globalThis.BABYLON = BABYLON;

function world(day = 6) {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    engine.getDeltaTime = () => 50;
    scene.getAnimationRatio = () => 1;
    const notes = [], drops = [], bites = [];
    const game = {
        scene, engine, paused: false, dayTime: 230, dayLength: 300, dayCount: day, settings: normalizeSettings(null),
        audio: {play() {}},
        uiSystem: {showNotification(message) { notes.push(message); }, showLoot() {}, updateInventoryUI() {}, updateExperienceUI() {},
            updateHealthUI() {}, updateGearUI() {}, showLevelUpMessage() {}, setSaveStatus() {}, showDayBanner() {}},
        terrainSystem: {waterHeight: 1, getPerlinHeight: () => 2, isWaterArea: () => false, isWithinSpawnArea: () => false, chunkMap: new Map()},
        explorationSystem: {discovered: new Set(), isClearing: () => false},
        dungeonSystem: {active: false, runs: {}},
        regions: {current: 'meadow', strength: 0},
        gear: {dropRoll(position, options) { drops.push(options); return true; }, stat: () => 0},
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
    const animals = game.animalSystem = new AnimalSystem(game);
    animals.animals = [];
    animals.spawnTimer = 1e9;
    const run = seconds => {
        const random = Math.random;
        Math.random = () => .5;
        try { for (let i = 0; i < Math.round(seconds * 20); i++) animals.update(); } finally { Math.random = random; }
    };
    return {engine, game, camera, animals, notes, drops, bites, run};
}

test('a wolf toughens by tier and has an elite form, the alpha', () => {
    const {engine, animals} = world();
    try {
        const plain = animals.spawnAnimal(30, 2, 30, 'wolf');
        assert.deepEqual([plain.health, plain.elite, plain.damageScale, wolfBite(plain), wolfName(plain)], [CREATURES.wolf.health, false, 1, WOLF_BITE, 'wolf'], 'an ordinary wolf is what it always was');
        assert.equal(plain.mesh.scaling.x, 1);

        const hardened = animals.spawnAnimal(32, 2, 30, 'wolf', {tier: 2, level: 3});
        assert.equal(hardened.health, Math.round(CREATURES.wolf.health * scaleFor(2).health));
        assert.ok(hardened.health > plain.health && wolfBite(hardened) > WOLF_BITE);
        assert.equal(hardened.level, 3);

        const alpha = animals.spawnAnimal(34, 2, 30, 'wolf', {elite: true});
        assert.equal(alpha.elite, true);
        assert.equal(alpha.health, Math.round(CREATURES.wolf.health * ELITE.health));
        assert.equal(wolfBite(alpha), Math.round(WOLF_BITE * ELITE.damage));
        assert.equal(wolfName(alpha), 'alpha wolf');
        assert.equal(alpha.mesh.scaling.x, ELITE.size, 'bigger');
        // Black-coated: darker than a grey wolf, vertex for vertex on the body.
        const shade = animal => { const c = animal.mesh.getVerticesData(BABYLON.VertexBuffer.ColorKind); let sum = 0; for (let i = 0; i < c.length; i += 4) sum += c[i] + c[i + 1] + c[i + 2]; return sum / c.length; };
        assert.ok(shade(alpha) < shade(plain) * .75, 'and dark');
        assert.ok(ALPHA.coat.every(c => c < .2));

        // Deer and rabbits are still just deer and rabbits.
        const deer = animals.spawnAnimal(36, 2, 30, 'deer', {elite: true, tier: 4});
        assert.deepEqual([deer.health, deer.elite, deer.damageScale], [CREATURES.deer.health, false, 1]);
        assert.equal(wolfBite(null), WOLF_BITE);
    } finally { engine.dispose(); }
});

test('an alpha bites harder, says so, and always leaves gear behind', () => {
    const {engine, game, animals, notes, drops, bites, run} = world();
    try {
        const plain = animals.spawnAnimal(1.5, 2, 0, 'wolf');
        run(.2);
        assert.deepEqual(bites.at(-1), [WOLF_BITE, 'a wolf']);
        plain.health = 0; run(.1);
        assert.match(notes.at(-1), /^Hunted wolf · /);
        assert.equal(drops.length, 0, 'an ordinary wolf carries nothing');
        const stat = game.progression.stats.wolves;

        const alpha = animals.spawnAnimal(1.5, 2, 0, 'wolf', {elite: true, level: 2});
        bites.length = 0;
        run(.2);
        assert.deepEqual(bites.at(-1), [Math.round(WOLF_BITE * ELITE.damage), 'an alpha wolf']);
        const xp = game.combatSystem.experience + game.combatSystem.level * 1e6;
        alpha.health = 0; run(.1);
        assert.match(notes.at(-1), /^Hunted alpha wolf · \+1 raw meat · /);
        assert.deepEqual(drops, [{level: 3, luck: ELITE.luck}], 'gear, a level above it, with an elite\'s luck');
        assert.equal(game.progression.stats.wolves, stat + 1, 'still a wolf for the tally and for bounties');
        assert.ok(game.combatSystem.experience + game.combatSystem.level * 1e6 - xp >= Math.round(CREATURES.wolf.xp * ELITE.xp));
    } finally { engine.dispose(); }
});

test('alphas turn up on ordinary nights from the fourth day, now and then, one at a time', () => {
    for (let day = 1; day < ALPHA.fromDay; day++) assert.deepEqual(nightWolf(day, 0), {elite: false}, 'not in the first days');
    assert.deepEqual(nightWolf(ALPHA.fromDay, 0), {elite: true});
    assert.deepEqual(nightWolf(40, ALPHA.chance - .001), {elite: true});
    assert.deepEqual(nightWolf(40, ALPHA.chance), {elite: false});
    assert.deepEqual(nightWolf(40, 0, true), {elite: false}, 'never two at once');
    assert.ok(ALPHA.chance > .05 && ALPHA.chance < .3);

    // Through the real spawner: a night of wolves on day 10.
    const {engine, game, animals} = world(10);
    try {
        game.dayTime = 230;
        const rolls = [.3, 0];   // Picks a wolf, then rolls an alpha.
        const random = Math.random;
        let n = 0;
        Math.random = () => rolls[n++ % rolls.length];
        try {
            animals.spawnTimer = 0;
            for (let i = 0; i < 400 && animals.animals.filter(a => a.kind === 'wolf').length < 3; i++) { animals.spawnTimer = 0; animals.update(); }
        } finally { Math.random = random; }
        const wolves = animals.animals.filter(a => a.kind === 'wolf');
        assert.ok(wolves.length >= 2, 'wolves came');
        assert.equal(wolves.filter(a => a.elite).length, 1, 'and exactly one of them is the alpha');
    } finally { engine.dispose(); }
});

test('a Greenwood pack is led by an alpha from the second pack night, and toughens like any other', () => {
    assert.equal(raidPack(3).members.filter(one => one.elite).length, 0, 'the first pack has no leader');
    for (const day of [6, 9, 12, 30]) assert.equal(raidPack(day).members.filter(one => one.elite).length, 1);
    const {engine, game, animals} = world(12);
    try {
        const raids = game.raids = new RaidSystem(game);
        game.dayTime = 300 * .75 + 1;
        raids.update(1);
        const pack = animals.animals, plan = raidPack(12);
        assert.equal(pack.length, plan.size);
        assert.ok(pack.every(animal => animal.kind === 'wolf' && animal.raid === 12));
        const [alpha, ...rest] = pack;
        assert.equal(alpha.elite, true);
        assert.equal(rest.filter(animal => animal.elite).length, 0);
        const tiered = Math.round(CREATURES.wolf.health * scaleFor(plan.tier).health);
        assert.ok(plan.tier > 1 && tiered > CREATURES.wolf.health, 'by the fourth pack night the wolves are tougher');
        assert.ok(rest.every(animal => animal.health === tiered));
        assert.equal(alpha.health, Math.round(CREATURES.wolf.health * scaleFor(plan.tier).health * ELITE.health));
        assert.ok(wolfBite(alpha) > wolfBite(rest[0]) && wolfBite(rest[0]) > WOLF_BITE);
    } finally { engine.dispose(); }
});

test('the map is drawn in the season\'s colours, and summer is the map as it was', () => {
    assert.equal(mapColors(), MAP_COLORS);
    assert.equal(mapColors(null), MAP_COLORS);
    assert.deepEqual(mapColors(seasonLook(5).ground), {...MAP_COLORS}, 'summer changes nothing');
    const rgb = hex => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));
    const winter = mapColors(seasonLook(11).ground), autumn = mapColors(seasonLook(8).ground), spring = mapColors(seasonLook(2).ground);
    for (const colours of [winter, autumn, spring]) {
        for (const id of ['tundra', 'desert', 'water', 'unknown']) assert.equal(colours[id], MAP_COLORS[id], id + ' is the same all year');
        for (const id of ['meadow', 'marsh']) { assert.match(colours[id], /^#[0-9a-f]{6}$/); assert.notEqual(colours[id], MAP_COLORS[id]); }
    }
    assert.ok(rgb(winter.meadow).every(c => c > 185), 'the Greenwood is white in winter');
    const [r, g, b] = rgb(autumn.meadow), [sr, sg] = rgb(MAP_COLORS.meadow);
    assert.ok(r > sr && r >= g - 12 && b < g, 'and straw-coloured in autumn');
    assert.ok(rgb(spring.meadow)[1] > sg, 'and greenest in spring');
    assert.ok(rgb(winter.marsh).every((c, i) => c > rgb(MAP_COLORS.marsh)[i]), 'Mirefen frosts over');
    // Halfway through the first morning of winter the map is halfway there.
    const turning = rgb(mapColors(seasonLook(10.125).ground).meadow);
    turning.forEach((c, i) => assert.ok(c > rgb(autumn.meadow)[i] - 2 && c < rgb(winter.meadow)[i] + 2));
    assert.notEqual(MAP_COLORS.meadow, winter.meadow);
    assert.equal(Object.isFrozen(MAP_COLORS), true);
});
