// Tests for how fast the player covers ground (js/movement.js): one pace in
// units a second, whichever way the player steers and however fast frames come.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import BABYLON from 'babylonjs';
import { SPEED, MAX_STEP_SECONDS, MAX_STEP_UNITS, keyboardSpeed, frameStep, frameFactor } from '../js/movement.js';
import { applyJoystick } from '../js/components/touch.js';
import { DODGE } from '../js/components/player.js';
import { DOG } from '../js/companion.js';
import { CREATURES } from '../js/creatures.js';

const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message || 'value'}: ${actual} is not within ${tolerance} of ${expected}`);
const INERTIA = .12;

// What the engine does with a push: move by it, then keep `inertia` of it.
const travel = (seconds, fps, push) => {
    let direction = 0, distance = 0;
    for (let frame = 0; frame < seconds * fps; frame++) {
        direction += push();
        distance += direction;
        direction *= INERTIA;
    }
    return distance / seconds;
};

// The engine's own keyboard step, taken from the real camera class.
const engineStep = (speed, fps) => BABYLON.FreeCamera.prototype._computeLocalCameraSpeed.call({
    speed, getEngine: () => ({getDeltaTime: () => 1000 / fps, getFps: () => fps})
});

test('the paces are in order and frozen', () => {
    assert.ok(SPEED.swim < SPEED.wade && SPEED.wade < SPEED.walk && SPEED.walk < SPEED.sprint);
    assert.ok(Object.isFrozen(SPEED));
    assert.ok(MAX_STEP_SECONDS > 1 / 30 && MAX_STEP_SECONDS <= .1);
});

test('the keyboard walks at the stated pace at any frame rate', () => {
    for (const fps of [30, 60, 120, 144, 240]) {
        const speed = keyboardSpeed(SPEED.walk, INERTIA);
        near(travel(10, fps, () => engineStep(speed, fps)), SPEED.walk, .06, `walk at ${fps} fps`);
        const sprint = keyboardSpeed(SPEED.sprint, INERTIA);
        near(travel(10, fps, () => engineStep(sprint, fps)), SPEED.sprint, .09, `sprint at ${fps} fps`);
    }
});

test('the thumbstick walks at the same pace as the keyboard', () => {
    for (const fps of [30, 60, 90, 120]) {
        const camera = {inertia: INERTIA, rotation: {x: 0, y: 0, z: 0}, cameraDirection: {x: 0, z: 0}};
        const push = () => {
            camera.cameraDirection.z = 0;
            applyJoystick(camera, {x: 0, y: -1}, SPEED.walk, 1 / fps);
            return camera.cameraDirection.z;
        };
        near(travel(10, fps, push), SPEED.walk, .06, `full push at ${fps} fps`);
    }
    near(travel(10, 60, () => frameStep(SPEED.walk * .5, 1 / 60, INERTIA)), SPEED.walk / 2, .03, 'half push');
});

test('a hitch or a bad number never throws the player across the map', () => {
    assert.equal(frameStep(SPEED.sprint, 5, 0), Math.min(SPEED.sprint * MAX_STEP_SECONDS, MAX_STEP_UNITS));
    for (const bad of [NaN, -1, Infinity, undefined]) {
        assert.ok(frameStep(SPEED.walk, bad, INERTIA) >= 0 && frameStep(SPEED.walk, bad, INERTIA) <= SPEED.walk * MAX_STEP_SECONDS);
        assert.equal(keyboardSpeed(bad === Infinity ? NaN : bad, INERTIA), 0);
        assert.equal(frameStep(bad === Infinity ? NaN : bad, 1 / 60, INERTIA), 0);
    }
    assert.ok(Number.isFinite(keyboardSpeed(SPEED.walk, 1)) && keyboardSpeed(SPEED.walk, 1) > 0, 'full inertia does not zero the keys');
});

test('no frame pushes the camera further than its collision check can follow', () => {
    assert.equal(frameFactor(1000 / 60, 60), engineStep(1, 60), 'the same sum the engine does');
    assert.equal(frameFactor(NaN, 60), 0);
    assert.equal(frameFactor(16, 0), 0);
    const hasted = SPEED.sprint * 1.6;
    for (const fps of [5, 10, 15, 20, 30, 60, 144]) {
        for (const pace of [SPEED.walk, SPEED.sprint, hasted]) {
            const speed = keyboardSpeed(pace, INERTIA, frameFactor(1000 / fps, fps));
            const settled = engineStep(speed, fps) / (1 - INERTIA);
            assert.ok(settled <= MAX_STEP_UNITS + 1e-9, `keyboard step at ${fps} fps and pace ${pace}: ${settled}`);
            assert.ok(frameStep(pace, 1 / fps, INERTIA) / (1 - INERTIA) <= MAX_STEP_UNITS + 1e-9, `stick step at ${fps} fps`);
        }
    }
    // Slow frames cost pace, evenly for both ways of steering, and never stop the player.
    const slowKeys = keyboardSpeed(SPEED.walk, INERTIA, frameFactor(100, 10));
    near(travel(10, 10, () => engineStep(slowKeys, 10)), MAX_STEP_UNITS * 10, .05, 'keyboard at 10 fps');
    near(travel(10, 10, () => frameStep(SPEED.walk, 1 / 10, INERTIA)), MAX_STEP_UNITS * 10, .05, 'stick at 10 fps');
    // At an ordinary frame rate the cap changes nothing.
    assert.equal(keyboardSpeed(SPEED.sprint, INERTIA, frameFactor(1000 / 60, 60)), keyboardSpeed(SPEED.sprint, INERTIA));
});

test('the rest of the world agrees with the walking pace', () => {
    assert.ok(DOG.speed > SPEED.walk && DOG.speed < SPEED.sprint, 'the dog keeps up with a walk, not a sprint');
    assert.ok(DODGE.speed > SPEED.sprint, 'a dodge is quicker than running');
    // Deer, rabbits and wolves keep their paces with the animal system.
    const paced = Object.entries(CREATURES).filter(([, creature]) => Number.isFinite(creature.speed));
    assert.ok(paced.length > 10);
    for (const [name, creature] of paced) {
        assert.ok(creature.speed < SPEED.sprint, `${name} can be outrun at a sprint`);
        assert.ok(creature.speed > SPEED.walk / 4, `${name} is not left standing by a walk`);
    }
});

test('the player and the touch stick both take their pace from the one module', async () => {
    const player = await readFile(new URL('../js/components/player.js', import.meta.url), 'utf8');
    const touch = await readFile(new URL('../js/components/touch.js', import.meta.url), 'utf8');
    const worker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
    assert.match(player, /this\.camera\.speed = keyboardSpeed\(this\.moveSpeed, this\.camera\.inertia,\s+engine\?\.getFps \? frameFactor\(engine\.getDeltaTime\(\), engine\.getFps\(\)\) : 0\)/);
    assert.doesNotMatch(player, /camera\.speed = (0?\.\d|\d)/, 'no bare camera speeds left');
    assert.match(touch, /player\.moveSpeed/);
    assert.doesNotMatch(touch, /camera\.speed/, 'the stick no longer borrows the keyboard number');
    assert.match(worker, /'\.\/js\/movement\.js'/);
});
