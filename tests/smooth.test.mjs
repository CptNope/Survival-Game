// Tests for the smooth-and-sharp update: pooled world models, graphics
// quality and its automatic mode.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import BABYLON from 'babylonjs';
import { QUALITY, QUALITY_LEVELS, QUALITY_CHOICES, QUALITY_LABELS, AUTO, isQuality, startingLevel, hardwareScale, autoStep } from '../js/quality.js';
import { ModelPool, VARIANTS } from '../js/models/pool.js';
import { QualitySystem } from '../js/components/quality.js';
import { TerrainSystem } from '../js/components/terrain.js';
import { normalizeSettings, DEFAULT_SETTINGS } from '../js/settings.js';

globalThis.BABYLON = BABYLON;

// --- Pooled models ----------------------------------------------------------------
test('world props are instances of a few shared models, each still its own object', () => {
    const engine = new BABYLON.NullEngine(), scene = new BABYLON.Scene(engine);
    try {
        const pool = new ModelPool(scene);
        const trees = [];
        for (let seed = 1; seed <= 60; seed++) trees.push(pool.spawn('pine', seed * 7919));
        assert.equal(pool.sources.size, VARIANTS.pine, 'sixty pines come from six models');
        assert.equal(scene.materials.length, VARIANTS.pine, 'and six materials, not sixty');
        const sources = new Set(trees.map(tree => tree.sourceMesh));
        assert.equal(sources.size, VARIANTS.pine);
        for (const source of sources) {
            assert.equal(source.isVisible, false, 'the original is never drawn itself');
            assert.equal(source.isPickable, false);
            assert.equal(source.checkCollisions, false, 'nor bumped into at the world origin');
            assert.equal(source.receiveShadows, true);
            // A frozen material keeps its old shader when shadows are switched off by
            // the quality setting, and the draw is then rejected by the graphics driver.
            assert.equal(source.material.isFrozen, false, 'shared materials must follow lighting changes');
        }
        const [first, second] = trees;
        assert.ok(first instanceof BABYLON.InstancedMesh);
        assert.equal(first.metadata.model, 'pine-tree');
        assert.equal(first.isPickable, true);
        assert.equal(first.checkCollisions, true, 'a placed tree is solid');
        assert.ok(first.getTotalVertices() > 500);
        // Each copy has its own place, size and fate.
        first.position.set(10, 0, 5); second.position.set(-4, 0, 9);
        assert.notDeepEqual(first.position.asArray(), second.position.asArray());
        const sizes = new Set(trees.map(tree => tree.scaling.x.toFixed(2)));
        assert.ok(sizes.size > 10, 'sizes vary: ' + sizes.size);
        assert.ok(trees.every(tree => tree.scaling.x >= .88 && tree.scaling.x <= 1.16));
        first.dispose(false, true);
        assert.ok(first.isDisposed() && !second.isDisposed() && !second.sourceMesh.isDisposed(), 'felling one leaves the rest standing');
        assert.ok(second.sourceMesh.material && scene.materials.length === VARIANTS.pine, 'and does not take the shared material with it');
        // A ray finds the copy where it stands.
        second.computeWorldMatrix(true);
        const hit = scene.pickWithRay(new BABYLON.Ray(new BABYLON.Vector3(-4, 3, -20), new BABYLON.Vector3(0, 0, 1), 60));
        assert.equal(hit.pickedMesh, second);
        // The same seed always gives the same variant and size.
        const again = pool.spawn('pine', 2 * 7919);
        assert.equal(again.sourceMesh, second.sourceMesh);
        assert.equal(again.scaling.x, second.scaling.x);
        // Every kind the world plants can be made, with the name the game expects.
        const names = {pine: 'pine-tree', oak: 'oak-tree', snowpine: 'snowpine-tree', bogtree: 'bogtree-tree', deadwood: 'deadwood-tree', cactus: 'cactus-plant', mushroom: 'mushroom-plant'};
        for (const kind of Object.keys(VARIANTS)) {
            const prop = pool.spawn(kind, 12345);
            assert.ok(prop.getTotalVertices() > 20, kind);
            if (names[kind]) assert.equal(prop.metadata.model, names[kind]);
            assert.equal(prop.checkCollisions, prop.sourceMesh.metadata.collides);
        }
        assert.equal(pool.spawn('rock', -7).sourceMesh, pool.spawn('rock', 7).sourceMesh, 'a negative seed is no trouble');
        pool.dispose();
        assert.equal(pool.sources.size, 0);
    } finally { engine.dispose(); }
});

test('a chunk full of trees adds instances, not models, and is quick to build', () => {
    const engine = new BABYLON.NullEngine(), scene = new BABYLON.Scene(engine);
    try {
        const harvestables = [];
        const terrain = Object.create(TerrainSystem.prototype);
        Object.assign(terrain, {
            scene, chunkSize: 32, spawnPosition: {x: 0, z: 0}, spawnHeight: 2, spawnAreaRadius: 10,
            waterHeight: 1, waterMeshes: [], harvestedIds: new Set(), harvestedOn: new Map(), chunkMap: new Map(),
            game: {scene, inventorySystem: {harvestableObjects: harvestables}, registerModelShadow() {}}
        });
        terrain.warmModels();
        const warmed = terrain.pool.sources.size, materials = scene.materials.length;
        assert.equal(warmed, ['pine', 'oak', 'rock', 'ore', 'fiber', 'herb', 'berry'].reduce((sum, kind) => sum + VARIANTS[kind], 0));
        const started = performance.now();
        for (let cx = -2; cx <= 1; cx++) for (let cz = -2; cz <= 1; cz++) terrain.populateChunk(cx, cz);
        const each = (performance.now() - started) / 16;
        assert.ok(harvestables.length > 120, harvestables.length + ' things planted in sixteen chunks');
        assert.ok(harvestables.every(node => node.mesh instanceof BABYLON.InstancedMesh));
        assert.equal(terrain.pool.sources.size, warmed, 'meadow chunks need no new models once warmed');
        assert.equal(scene.materials.length, materials);
        assert.ok(each < 6, `a chunk's props took ${each.toFixed(2)} ms (it was about 15 before pooling)`);
        // Gathering still works on a copy: it has a place, can be found and removed.
        const tree = harvestables.find(node => node.type === 'tree');
        assert.ok(tree.resourceId && tree.mesh.position.length() > 5);
        tree.mesh.dispose(false, true);
        assert.ok(tree.mesh.isDisposed());
    } finally { engine.dispose(); }
});

// --- Graphics quality ---------------------------------------------------------------
test('quality levels trade resolution, shadows and ground cover in order', () => {
    assert.deepEqual([...QUALITY_LEVELS], ['low', 'medium', 'high']);
    assert.deepEqual([...QUALITY_CHOICES], ['auto', 'low', 'medium', 'high']);
    for (const choice of QUALITY_CHOICES) assert.ok(QUALITY_LABELS[choice]);
    assert.ok(isQuality('auto') && isQuality('low') && !isQuality('ultra') && !isQuality(undefined));
    for (let n = 1; n < QUALITY_LEVELS.length; n++) {
        const lower = QUALITY[QUALITY_LEVELS[n - 1]], higher = QUALITY[QUALITY_LEVELS[n]];
        assert.ok(higher.pixelRatio > lower.pixelRatio && higher.cover > lower.cover);
    }
    assert.equal(QUALITY.low.shadowEvery, 0, 'no shadows on low');
    assert.equal(QUALITY.high.shadowEvery, 1);
    assert.equal(startingLevel(true), 'medium');
    assert.equal(startingLevel(false), 'high');

    // A plain monitor is drawn pixel for pixel at every level.
    for (const level of QUALITY_LEVELS) assert.equal(hardwareScale(1, level), 1);
    // A dense phone screen is not drawn at its full density.
    assert.equal(hardwareScale(3, 'high'), 1.5);
    assert.equal(hardwareScale(3, 'medium'), 2);
    assert.equal(hardwareScale(3, 'low'), 3);
    assert.equal(hardwareScale(2, 'high'), 1);
    // The automatic scale lowers resolution further, within limits.
    assert.equal(hardwareScale(1, 'high', .8), 1.25);
    assert.equal(hardwareScale(1, 'high', .01), Math.round(1 / AUTO.minScale * 100) / 100);
    assert.equal(hardwareScale(1, 'high', 9), 1);
    assert.equal(hardwareScale(NaN, 'low'), 1);
    assert.equal(hardwareScale(.5, 'high'), 1, 'a zoomed-out browser never renders above its pixels');

    assert.equal(normalizeSettings({quality: 'low'}).quality, 'low');
    assert.equal(normalizeSettings({quality: 'ultra'}).quality, 'auto');
    assert.equal(DEFAULT_SETTINGS.quality, 'auto');
});

test('the automatic setting gives up resolution first, then shadows, and climbs back carefully', () => {
    let state = {level: 'high', scale: 1, slow: 0, fast: 0, ceiling: 'high'};
    // One bad moment changes nothing.
    state = autoStep(state, 30);
    assert.deepEqual([state.level, state.scale], ['high', 1]);
    state = autoStep(state, 60);
    assert.equal(state.slow, 0, 'a good window clears the count');
    // Sustained slowness lowers resolution step by step.
    const seen = [];
    for (let n = 0; n < 40 && !(state.level === 'low' && state.scale <= AUTO.minScale); n++) { state = autoStep(state, 28); seen.push(state.level + '@' + state.scale); }
    const order = [...new Set(seen)];
    assert.deepEqual(order.slice(0, 2), ['high@1', 'high@0.85'], 'it takes two slow windows to act');
    assert.ok(order.indexOf('high@0.6') >= 0 && order.indexOf('high@0.6') < order.indexOf('medium@0.85'), 'resolution bottoms out before the level drops: ' + order.join(' '));
    assert.ok(order.indexOf('medium@0.6') < order.indexOf('low@0.85'));
    assert.deepEqual([state.level, state.scale], ['low', AUTO.minScale]);
    state = autoStep(autoStep(state, 10), 10);
    assert.deepEqual([state.level, state.scale], ['low', AUTO.minScale], 'there is a floor');
    // A steady frame rate in between leaves things alone.
    const held = {...state};
    for (let n = 0; n < 20; n++) state = autoStep(state, 50);
    assert.deepEqual([state.level, state.scale], [held.level, held.scale]);
    // Plenty to spare: resolution comes back, then the level, but slowly.
    state = autoStep(autoStep(autoStep(state, 60), 60), 60);
    assert.equal(state.scale, AUTO.minScale, 'three good windows are not yet enough');
    state = autoStep(state, 60);
    assert.ok(state.scale > AUTO.minScale);
    for (let n = 0; n < 200; n++) state = autoStep(state, 60);
    assert.deepEqual([state.level, state.scale], ['high', 1]);
    // A phone's ceiling is respected on the way back up.
    let phone = {level: 'low', scale: 1, slow: 0, fast: 0, ceiling: 'medium'};
    for (let n = 0; n < 200; n++) phone = autoStep(phone, 60);
    assert.deepEqual([phone.level, phone.scale], ['medium', 1]);
    // Nonsense readings are ignored.
    assert.deepEqual(autoStep(phone, 0), phone);
    assert.deepEqual(autoStep(phone, NaN), phone);
});

test('the quality system applies its level to the engine and only judges real play', () => {
    const calls = [];
    const map = {refreshRate: 1};
    const game = {
        paused: false, settings: normalizeSettings(null),
        updateSettings(changes) { Object.assign(this.settings, changes); },
        engine: {setHardwareScalingLevel(level) { calls.push(level); }},
        sunLight: {shadowEnabled: true}, shadowGenerator: {getShadowMap: () => map}, terrainSystem: {coverScale: 1}
    };
    const quality = new QualitySystem(game);
    assert.equal(quality.choice, 'auto');
    assert.equal(quality.level, 'high');
    assert.equal(quality.describe(), 'Auto · High');
    // A fixed choice is applied at once and never drifts.
    assert.equal(quality.setChoice('low'), true);
    assert.equal(game.settings.quality, 'low');
    assert.deepEqual([game.sunLight.shadowEnabled, game.terrainSystem.coverScale, calls.at(-1)], [false, QUALITY.low.cover, 1]);
    for (let n = 0; n < 2000; n++) quality.update(1 / 20);
    assert.equal(quality.level, 'low');
    assert.equal(quality.describe(), 'Low');
    assert.equal(quality.setChoice('ultra'), false);
    quality.setChoice('medium');
    assert.deepEqual([game.sunLight.shadowEnabled, map.refreshRate], [true, 2]);

    // Auto: slow play lowers resolution after a settling period.
    quality.setChoice('auto');
    const run = (seconds, fps) => { for (let t = 0; t < seconds; t += 1 / fps) quality.update(1 / fps); };
    run(2.5, 25);
    assert.equal(quality.scale, 1, 'the first seconds after a change do not count');
    run(8, 25);
    assert.ok(quality.scale < 1, 'then it eases off');
    assert.match(quality.describe(), /^Auto · High, \d+% resolution$/);
    assert.ok(calls.at(-1) > 1);
    // Pauses, hitches and a hidden tab are not evidence.
    const scale = quality.scale;
    game.paused = true;
    run(20, 5);
    game.paused = false;
    assert.equal(quality.scale, scale);
    for (let n = 0; n < 50; n++) quality.update(.6);
    assert.equal(quality.scale, scale, 'a long stall is a hitch, not a frame rate');
    // Smooth play brings it back.
    run(60, 60);
    assert.equal(quality.scale, 1);
});

test('the new modules are cached for offline play', async () => {
    const worker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
    for (const file of ['js/quality.js', 'js/models/pool.js', 'js/components/quality.js'])
        assert.ok(worker.includes(`'./${file}'`), file + ' is not precached');
});

// --- Interface ----------------------------------------------------------------------
test('the stylesheet keeps text readable, targets tappable and scales up on big screens', async () => {
    const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
    // Every size is in rem so the whole interface scales from the root.
    const sizes = [...css.matchAll(/font-size:\s*([\d.]+)rem/g), ...css.matchAll(/font:[^;{}]*?\s([\d.]+)rem/g)].map(match => Number(match[1]));
    assert.ok(sizes.length > 40, 'sizes are declared in rem');
    assert.ok(Math.min(...sizes) >= .75, `no text under 12px at the base size (smallest is ${Math.min(...sizes)}rem)`);
    assert.equal(/font(-size)?:[^;{}]*\d(px|pt)\b(?![^;{}]*clamp)/.test(css.replace(/html\{font-size:\d+px[^}]*\}/g, '')), false, 'no pixel font sizes outside the root');
    // The root steps up on large screens instead of leaving the HUD in a corner.
    const steps = [...css.matchAll(/@media \(min-width:(\d+)px\) and \(min-height:(\d+)px\)\{html\{font-size:(\d+)px\}\}/g)].map(match => match.slice(1).map(Number));
    assert.ok(steps.length >= 3, 'at least three large-screen steps');
    assert.ok(steps.every((step, index) => !index || (step[0] > steps[index - 1][0] && step[2] > steps[index - 1][2])), 'each step is wider and larger than the last');
    assert.ok(steps.at(-1)[0] <= 3840 && steps.at(-1)[2] >= 28, 'a 4K screen roughly doubles the interface');
    // Touch: every HUD button is at least 44px, and the action buttons too.
    assert.match(css, /#hud\.touch button\{min-height:2\.75rem\}/);
    const actions = [...css.matchAll(/\.touch-actions button\{width:([\d.]+)rem;height:([\d.]+)rem/g)].map(match => Math.min(Number(match[1]), Number(match[2])));
    assert.ok(actions.length >= 3 && Math.min(...actions) * 16 >= 44, 'action buttons never drop under 44px');
    // Blurring the 3D view every frame is the costliest thing a HUD can do.
    assert.equal(css.includes('backdrop-filter'), false);
    assert.match(css, /env\(safe-area-inset-bottom/);
    assert.match(css, /prefers-reduced-motion/);
});

test('the HUD markup the stylesheet lays out is the markup the game builds', async () => {
    const [css, ui] = await Promise.all(['../styles.css', '../js/components/ui.js'].map(file => readFile(new URL(file, import.meta.url), 'utf8')));
    for (const area of ['objective', 'hud-status', 'hud-buttons', 'exploration-card', 'hud-chips', 'vitals', 'inventory', 'hud-menu']) {
        assert.ok(ui.includes(`class="${area}`) || ui.includes(`class="${area}"`), `${area} is built`);
        assert.ok(css.includes(`.${area}{`), `${area} is placed`);
    }
    for (const id of ['view-button', 'menu-button', 'craft-button', 'building-button', 'gear-button', 'map-button', 'inventory-toggle', 'panel-tabs', 'set-quality', 'quality-value', 'controls-wrap', 'resume', 'save-now'])
        assert.ok(ui.includes(`id="${id}"`), `#${id} exists`);
    // The old wrappers are gone from both sides.
    for (const gone of ['hud-top', 'hud-bottom']) { assert.equal(css.includes(gone), false); assert.equal(ui.includes(gone), false); }
    // Every graphics choice gets a button, and every panel a tab.
    assert.match(ui, /QUALITY_CHOICES\.map\(choice => `<button type="button" data-quality=/);
    for (const panel of ['menu', 'craft', 'build', 'gear', 'perks', 'map']) assert.ok(ui.includes(`data-panel="${panel}"`), `${panel} tab`);
});
