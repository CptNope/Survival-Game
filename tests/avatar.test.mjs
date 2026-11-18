// Tests for the explorer's body: the rules that pose it (js/avatar.js), the
// model those rules drive (js/models/avatar.js) and the view that animates it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import BABYLON from 'babylonjs';
import { AVATAR, ease, gait, attackCurve, avatarPose } from '../js/avatar.js';
import { createAvatarModel } from '../js/models/avatar.js';
import { ViewSystem } from '../js/components/view.js';
import { normalizeSettings } from '../js/settings.js';

globalThis.BABYLON = BABYLON;

const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message || 'value'}: ${actual} is not within ${tolerance} of ${expected}`);
const walkFor = (seconds, forward, right = 0, state = {}, moving = true) => {
    for (let frame = 0; frame < seconds * 60; frame++) state = gait(state, forward, right, 1 / 60, moving);
    return state;
};

// --- Proportions and easing ---------------------------------------------------
test('the skeleton adds up: feet on the ground, hands above the knees', () => {
    near(AVATAR.hips - .02 - AVATAR.thigh - AVATAR.shin, 0, 1e-9, 'sole height');
    const shoulder = AVATAR.hips + AVATAR.spine + AVATAR.shoulderHeight, palm = shoulder - AVATAR.upperArm - AVATAR.forearm;
    assert.ok(palm > AVATAR.shin && palm < AVATAR.hips, 'hands hang between knee and hip');
    assert.ok(Object.isFrozen(AVATAR));
});

test('easing does not depend on frame rate and never overshoots', () => {
    const once = ease(0, 1, 12, 1 / 30), twice = ease(ease(0, 1, 12, 1 / 60), 1, 12, 1 / 60);
    near(once, twice, 1e-12, 'one 30 fps step against two 60 fps steps');
    assert.ok(ease(0, 1, 12, 5) <= 1 && ease(0, 1, 12, 5) > .999, 'a long frame lands on the target, not past it');
    assert.equal(ease(.4, 1, 12, 0), .4);
    assert.equal(ease(.4, 1, 12, NaN), .4);
});

// --- The walk -------------------------------------------------------------------
test('standing, walking, sprinting, backing up and sidestepping are different gaits', () => {
    const still = walkFor(1, 0);
    assert.equal(still.phase, 0);
    near(still.stride, 0, 1e-6, 'no stride standing still');

    const walk = walkFor(2, 4.7), sprint = walkFor(2, 9.5);
    assert.ok(walk.phase > 0 && walk.stride > .6 && walk.stride < 1);
    assert.ok(sprint.stride > walk.stride);
    near(walk.turn, 0, .01, 'hips square walking forward');
    // A sprint covers more ground per step instead of only stepping faster.
    assert.ok(9.5 * 2 / (sprint.phase / (2 * Math.PI)) > 4.7 * 2 / (walk.phase / (2 * Math.PI)) * 1.2, 'longer steps at speed');
    assert.ok(sprint.phase / (2 * Math.PI) / 2 <= 2.5, 'cadence is capped');

    const back = walkFor(2, -3.5);
    assert.ok(back.phase < 0, 'the cycle runs in reverse');
    assert.equal(back.backwards, true);
    near(back.turn, 0, .01, 'and the hips stay square');

    const right = walkFor(2, 0, 4.7), left = walkFor(2, 0, -4.7), diagonal = walkFor(2, 4, 4);
    assert.ok(right.turn > .9 && right.turn <= 1 && left.turn < -.9, 'hips turn toward a sidestep, within reason');
    near(diagonal.turn, Math.PI / 4, .02, 'and halfway for a diagonal');

    // Falling or swimming at speed is not striding.
    const airborne = walkFor(1, 6, 0, {}, false);
    assert.equal(airborne.phase, 0);
    near(airborne.stride, 0, 1e-6);
    // Stopping winds the stride down smoothly.
    const stopping = walkFor(.1, 0, 0, walk), stopped = walkFor(1, 0, 0, walk);
    assert.ok(stopping.stride > 0 && stopping.stride < walk.stride);
    assert.ok(stopped.stride < .01);
});

// --- Poses ----------------------------------------------------------------------
const STATES = {
    idle: {}, walk: {stride: .75, speed: 4.7}, sprint: {stride: 1, speed: 10}, air: {grounded: false}, swim: {swimming: true},
    fly: {flying: true}, dodge: {dodging: true}, axe: {held: 'tools', stride: .75, speed: 4.7}, spear: {held: 'spear'},
    torch: {torch: true, stride: .75, speed: 4.7}, draw: {draw: .7}, chop: {held: 'tools', attack: .3}, thrust: {held: 'spear', attack: .5},
    punch: {attack: .5}, heavy: {held: 'ironTools', attack: .3, heavy: true}
};

test('no pose bends a knee or an elbow the wrong way', () => {
    for (const [name, state] of Object.entries(STATES)) {
        for (let step = 0; step < 48; step++) {
            const pose = avatarPose({...state, phase: step / 48 * Math.PI * 2, time: step * .13, attack: state.attack === undefined ? null : step / 48});
            for (const leg of pose.legs) {
                assert.ok(leg.knee >= 0 && leg.knee < 2.2, `${name}: knee ${leg.knee}`);
                assert.ok(Math.abs(leg.hip) < 1.3, `${name}: hip ${leg.hip}`);
            }
            for (const arm of pose.arms) {
                assert.ok(arm.elbow <= 0 && arm.elbow > -2.5, `${name}: elbow ${arm.elbow}`);
                assert.ok(arm.spread >= 0 && arm.spread < .6, `${name}: spread ${arm.spread}`);
            }
            for (const value of [pose.hipsY, pose.hipsYaw, pose.torsoPitch, pose.torsoYaw, pose.headPitch, pose.headYaw]) assert.ok(Number.isFinite(value), name);
        }
    }
});

test('standing is nearly still; walking swings opposite limbs and lifts the knees', () => {
    for (const time of [0, 1, 2.5]) {
        const idle = avatarPose({time});
        for (const leg of idle.legs) { near(leg.hip, 0, 1e-9); assert.ok(leg.knee < .1); }
        for (const arm of idle.arms) { near(arm.shoulder, 0, 1e-9); assert.ok(arm.elbow > -.2 && arm.elbow < 0, 'a relaxed elbow, not a locked one'); }
        assert.ok(Math.abs(idle.torsoPitch) < .02 && Math.abs(idle.hipsY) < .01, 'only breathing');
    }
    assert.notEqual(avatarPose({time: 0}).torsoPitch, avatarPose({time: .9}).torsoPitch, 'but it does breathe');

    const stride = avatarPose({phase: Math.PI / 2, stride: .75, speed: 4.7});
    assert.ok(stride.legs[0].hip < -.3 && stride.legs[1].hip > .3, 'left leg forward, right leg back');
    assert.ok(stride.arms[0].shoulder > .2 && stride.arms[1].shoulder < -.2, 'each arm swings against its own leg');
    assert.ok(stride.hipsY < 0, 'the body sinks as the feet land');
    const passing = avatarPose({phase: Math.PI, stride: .75, speed: 4.7});
    assert.ok(passing.legs[1].knee > .6 && passing.legs[0].knee < .3, 'the swinging leg folds, the standing leg does not');
    assert.ok(passing.hipsY > stride.hipsY, 'and the body rises over the standing leg');
    // Sprinting leans in and pumps the arms.
    const sprint = avatarPose({phase: Math.PI / 2, stride: 1, speed: 10});
    assert.ok(sprint.torsoPitch > stride.torsoPitch + .08);
    assert.ok(sprint.arms[0].elbow < -.9);
    // The hips turn with a sidestep and the chest and head turn back.
    const side = avatarPose({stride: .75, speed: 4.7, turn: 1});
    near(side.hipsYaw + side.torsoYaw + side.headYaw, 0, 1e-9, 'the head still faces where the player looks');
    // The head follows the camera, within what a neck can do.
    assert.ok(avatarPose({look: .6}).headPitch > .25 && avatarPose({look: -.6}).headPitch < -.25);
    assert.equal(avatarPose({look: 9}).headPitch, avatarPose({look: .9}).headPitch);
});

test('what is carried is held properly and stays level whatever the body does', () => {
    const empty = avatarPose({}), axe = avatarPose({held: 'tools'}), spear = avatarPose({held: 'spear'}), torch = avatarPose({torch: true});
    assert.equal(empty.arms[0].hand, null);
    assert.equal(empty.arms[1].hand, null);
    assert.ok(axe.arms[1].elbow < -.8 && axe.arms[1].hand > 0, 'forearm up, axe head tipped forward');
    assert.ok(spear.arms[1].elbow > axe.arms[1].elbow && spear.arms[1].hand < 0, 'a spear is carried low with the point up');
    assert.ok(torch.arms[0].shoulder < -.4 && torch.arms[0].elbow < -.9, 'the torch is held up in front');
    assert.equal(torch.arms[1].hand, null, 'and the other hand is unaffected');
    for (const state of [{dodging: true}, {grounded: false}, {swimming: true}, {flying: true}, {stride: 1, speed: 10, phase: 1}]) {
        assert.equal(avatarPose({...state, torch: true}).arms[0].hand, torch.arms[0].hand, 'torch tilt');
        assert.equal(avatarPose({...state, held: 'tools'}).arms[1].hand, axe.arms[1].hand, 'tool tilt');
    }
});

test('a chop goes up then down, a thrust goes back then out, and both come back to rest', () => {
    assert.deepEqual(attackCurve(-1), {raise: 0, strike: 0});
    assert.deepEqual(attackCurve(1), {raise: 0, strike: 0});
    const top = attackCurve(.2), hit = attackCurve(.5);
    assert.ok(top.raise > .9 && top.strike < .05 && hit.strike > .9 && hit.raise < .05);
    for (let t = 0; t < 1; t += .01) { const c = attackCurve(t); assert.ok(c.raise >= 0 && c.strike >= 0 && c.raise + c.strike <= 1 + 1e-9); }

    const carry = avatarPose({held: 'tools'}).arms[1];
    const up = avatarPose({held: 'tools', attack: .2}), down = avatarPose({held: 'tools', attack: .5}), done = avatarPose({held: 'tools', attack: .999});
    assert.ok(up.arms[1].shoulder < -2, 'raised over the shoulder');
    assert.ok(up.arms[1].hand < 0 && down.arms[1].hand > 1, 'the axe tips back, then over and down');
    assert.ok(down.arms[1].shoulder > up.arms[1].shoulder + 1, 'and the arm comes down through the target');
    assert.ok(up.torsoYaw > 0 && down.torsoYaw < 0 && down.torsoPitch > .15, 'the body winds up and follows through');
    near(done.arms[1].shoulder, carry.shoulder, .01, 'back to the carry');
    assert.ok(avatarPose({held: 'ironTools', attack: .2, heavy: true}).arms[1].shoulder < up.arms[1].shoulder, 'a heavy sweep reaches further');
    near(avatarPose({held: 'tools', attack: .3}).arms[0].shoulder, avatarPose({held: 'tools'}).arms[0].shoulder, 1e-9, 'the other arm is left alone');

    for (const held of ['spear', null]) {
        const back = avatarPose({held, attack: .2}), out = avatarPose({held, attack: .5});
        assert.ok(back.arms[1].shoulder > .2 && back.arms[1].elbow < -1.4, 'cocked at the hip');
        assert.ok(out.arms[1].shoulder < -1.1 && out.arms[1].elbow > -.4, 'driven straight out');
    }
    assert.ok(Math.abs(avatarPose({held: 'spear', attack: .5}).arms[1].hand) < .15, 'the spear stays level through the thrust');
});

test('drawing the bow straightens the bow arm and folds the string arm', () => {
    const half = avatarPose({draw: .1, held: 'tools', torch: true}), full = avatarPose({draw: 1, held: 'tools', torch: true});
    for (const pose of [half, full]) {
        near(pose.arms[0].shoulder, -1.5, .01, 'bow arm level');
        assert.ok(pose.arms[0].elbow > -.1, 'and straight');
        assert.equal(pose.arms[0].hand, 0, 'the bow stands upright in the hand');
    }
    assert.ok(full.arms[1].elbow < half.arms[1].elbow - .8, 'the string hand comes back as the bow is drawn');
    assert.equal(avatarPose({draw: 0, attack: .3, held: 'tools'}).arms[1].shoulder, avatarPose({draw: 0, held: 'tools'}).arms[1].shoulder, 'aiming wins over a swing');
});

// --- The model --------------------------------------------------------------------
function scene() {
    const engine = new BABYLON.NullEngine();
    return {engine, scene: new BABYLON.Scene(engine)};
}

test('the model is eleven parts on one material, standing on its feet at human height', () => {
    const {engine, scene: world} = scene();
    try {
        const avatar = createAvatarModel(world);
        assert.equal(avatar.parts.length, 11);
        assert.deepEqual(avatar.parts.map(part => part.name).sort(), ['avatar-forearm', 'avatar-forearm', 'avatar-head', 'avatar-pelvis', 'avatar-shin', 'avatar-shin',
            'avatar-thigh', 'avatar-thigh', 'avatar-torso', 'avatar-upper-arm', 'avatar-upper-arm']);
        assert.equal(new Set(avatar.parts.map(part => part.material)).size, 1, 'one shared material');
        assert.equal(world.materials.length, 1, 'and nothing left over from building it');
        assert.equal(world.meshes.length, 12, 'the root and its parts, no stray pieces');
        const vertices = avatar.parts.reduce((sum, part) => sum + part.getTotalVertices(), 0);
        assert.ok(vertices > 2000 && vertices < 4200, `vertex budget (${vertices})`);
        for (const part of avatar.parts) {
            assert.equal(part.isPickable, false);
            assert.equal(part.checkCollisions, false);
            assert.ok(part.isVerticesDataPresent(BABYLON.VertexBuffer.ColorKind) && part.isVerticesDataPresent(BABYLON.VertexBuffer.NormalKind));
            assert.equal(part.isVerticesDataPresent(BABYLON.VertexBuffer.UVKind), false);
        }
        avatar.root.computeWorldMatrix(true);
        const {min, max} = avatar.root.getHierarchyBoundingVectors(true);
        near(min.y, 0, .02, 'soles on the ground');
        assert.ok(max.y > 1.95 && max.y < 2.15, `about two metres tall (${max.y})`);
        near(min.x, -max.x, .02, 'symmetrical');
        assert.ok(max.x - min.x < .95, 'arms close to the body, not held out');
        // Left and right limbs are mirror images.
        const size = name => avatar.parts.filter(part => part.name === name).map(part => part.getTotalVertices());
        for (const name of ['avatar-upper-arm', 'avatar-forearm', 'avatar-thigh', 'avatar-shin']) assert.equal(size(name)[0], size(name)[1]);
        // Joints sit where the rules say.
        near(avatar.hips.position.y, AVATAR.hips, 1e-9);
        near(avatar.legs[0].knee.position.y, -AVATAR.thigh, 1e-9);
        near(avatar.arms[1].elbow.position.y, -AVATAR.upperArm, 1e-9);
        assert.equal(avatar.arms[0].side, -1);
        assert.equal(avatar.leftHand, avatar.arms[0].hand);
        assert.equal(avatar.rightHand, avatar.arms[1].hand);
        assert.ok(avatar.arms[0].shoulder.position.x < 0 && avatar.arms[1].shoulder.position.x > 0);
    } finally { engine.dispose(); }
});

test('every facet of the model faces outward', () => {
    const {engine, scene: world} = scene();
    try {
        const avatar = createAvatarModel(world);
        // A facet faces out when its normal points away from the middle of its own
        // cross-section. Checked on the limbs, which are simple tubes round their joint.
        for (const part of avatar.parts.filter(part => /arm|thigh/.test(part.name))) {
            const positions = part.getVerticesData(BABYLON.VertexBuffer.PositionKind), normals = part.getVerticesData(BABYLON.VertexBuffer.NormalKind);
            let out = 0, total = 0;
            for (let i = 0; i < positions.length; i += 9) {
                const x = (positions[i] + positions[i + 3] + positions[i + 6]) / 3, z = (positions[i + 2] + positions[i + 5] + positions[i + 8]) / 3;
                if (Math.abs(normals[i + 1]) > .7) continue; // An end cap.
                total++;
                if (x * normals[i] + z * normals[i + 2] > 0) out++;
            }
            assert.ok(total > 10 && out / total > .9, `${part.name}: ${out} of ${total} facets face out`);
        }
    } finally { engine.dispose(); }
});

// --- The view driving it -------------------------------------------------------
function world() {
    const {engine, scene: stage} = scene();
    const camera = new BABYLON.FreeCamera('body', new BABYLON.Vector3(0, 4, 0), stage);
    const game = {
        scene: stage, engine, settings: normalizeSettings(null), updateSettings(changes) { Object.assign(this.settings, changes); },
        playerSystem: {camera, isGrounded: true, isSwimming: false, isFlying: false, dodgeLeft: 0},
        terrainSystem: {getPerlinHeight: () => 2},
        effects: {heldKind: 'tools', torchLit: true, swingStart: -1e9, swingHeavy: false, setFirstPerson() {}},
        archery: {drawing: false, amount: () => .8},
        registerModelShadow() {}
    };
    const view = game.viewSystem = new ViewSystem(game);
    view.setMode('third', false);
    // Move the body and let the avatar follow, a frame at a time.
    const travel = (seconds, forward, right = 0) => {
        for (let frame = 0; frame < seconds * 60; frame++) {
            const yaw = camera.rotation.y;
            camera.position.x += (Math.sin(yaw) * forward + Math.cos(yaw) * right) / 60;
            camera.position.z += (Math.cos(yaw) * forward - Math.sin(yaw) * right) / 60;
            view.animate(1 / 60);
        }
    };
    return {engine, game, view, camera, travel};
}

test('the avatar walks when the body moves, in step, and settles when it stops', () => {
    const {engine, view, camera, travel, game} = world();
    try {
        const avatar = view.avatar;
        camera.rotation.y = .8; // Facing somewhere other than straight down an axis.
        travel(1.5, 4.7);
        near(view.gait.speed, 4.7, .1, 'measured speed');
        near(view.gait.turn, 0, .02, 'walking where it faces');
        // Sample a full stride: each leg goes forward and back, the knees fold, the body bobs.
        const seen = {left: [], right: [], knee: [], hips: []};
        for (let frame = 0; frame < 60; frame++) {
            travel(1 / 60, 4.7);
            seen.left.push(avatar.legs[0].hip.rotation.x); seen.right.push(avatar.legs[1].hip.rotation.x);
            seen.knee.push(avatar.legs[0].knee.rotation.x); seen.hips.push(avatar.hips.position.y);
        }
        assert.ok(Math.min(...seen.left) < -.25 && Math.max(...seen.left) > .25, 'the leg swings both ways');
        assert.ok(seen.left.every((value, frame) => value * seen.right[frame] <= .01), 'the legs are never both forward');
        assert.ok(Math.max(...seen.knee) > .5 && Math.min(...seen.knee) >= 0, 'the knee folds and never bends back');
        assert.ok(Math.max(...seen.hips) - Math.min(...seen.hips) > .02, 'the body bobs');
        // Movement between frames is small: nothing snaps.
        const jumps = seen.left.slice(1).map((value, frame) => Math.abs(value - seen.left[frame]));
        assert.ok(Math.max(...jumps) < .15, `largest change in one frame ${Math.max(...jumps)}`);
        // The avatar stands where the body is and faces the same way.
        near(avatar.root.position.x, camera.position.x, 1e-9); near(avatar.root.position.y, camera.position.y - 2, 1e-9);
        assert.equal(avatar.root.rotation.y, camera.rotation.y);
        // The torch stays upright and the axe keeps its tilt while the arms move.
        const tilt = arm => arm.shoulder.rotation.x + arm.elbow.rotation.x + arm.hand.rotation.x;
        near(tilt(avatar.arms[0]), .15, 1e-9, 'torch tilt');
        near(tilt(avatar.arms[1]), .5, 1e-9, 'axe tilt');

        travel(1, 0);
        for (const leg of avatar.legs) { near(leg.hip.rotation.x, 0, .02, 'legs at rest'); assert.ok(leg.knee.rotation.x < .1); }
        near(avatar.hips.position.y, AVATAR.hips, .01, 'standing height');
        near(view.gait.stride, 0, .01);

        // Stairs or a respawn move the body a long way in one frame: that is not a sprint.
        camera.position.x += 60;
        view.animate(1 / 60);
        assert.ok(view.gait.speed < .5, 'a teleport is ignored');
        near(avatar.root.position.x, camera.position.x, 1e-9, 'but the avatar still goes with the body');
        // In the air the stride stops and the legs tuck.
        game.playerSystem.isGrounded = false;
        travel(.5, 5);
        near(view.gait.stride, 0, .05);
        assert.ok(avatar.legs[0].knee.rotation.x > .7, 'knees up in a jump');
    } finally { engine.dispose(); }
});

test('swinging, sidestepping and drawing a bow reach the avatar', () => {
    const {engine, view, game, travel} = world();
    try {
        const avatar = view.avatar, right = avatar.arms[1];
        travel(.5, 0);
        const carry = right.shoulder.rotation.x;
        // A swing started 90 ms ago has the arm on its way up; by its end the arm is back.
        let highest = 0;
        game.effects.swingStart = performance.now();
        for (let frame = 0; frame < 40; frame++) {
            game.effects.swingStart = performance.now() - frame * 1000 / 60;
            view.animate(1 / 60);
            highest = Math.min(highest, right.shoulder.rotation.x);
        }
        assert.ok(highest < carry - .9, `the arm rises well above the carry (${highest})`);
        game.effects.swingStart = -1e9;
        travel(.6, 0);
        near(right.shoulder.rotation.x, carry, .03, 'and returns');

        travel(1, 0, 4.7);
        assert.ok(avatar.hips.rotation.y > .8, 'hips turn into a sidestep');
        assert.ok(avatar.torso.rotation.y < -.4, 'and the chest turns back');
        travel(1, -3.5);
        assert.ok(view.gait.backwards && Math.abs(avatar.hips.rotation.y) < .1, 'backing up keeps the hips square');

        assert.equal(view.held.isEnabled(), true);
        assert.equal(view.torch.isEnabled(), true);
        game.archery.drawing = true;
        travel(.5, 0);
        assert.equal(view.held.isEnabled(), false, 'the axe is put away to draw');
        assert.equal(view.torch.isEnabled(), false, 'and so is the torch');
        near(avatar.arms[0].shoulder.rotation.x, -1.5, .02, 'bow arm out');
        near(avatar.arms[0].shoulder.rotation.x + avatar.arms[0].elbow.rotation.x + avatar.arms[0].hand.rotation.x, 0, 1e-9, 'bow upright');
        game.archery.drawing = false;
        travel(.2, 0);
        assert.equal(view.held.isEnabled(), true);
        assert.equal(view.torch.isEnabled(), true);
        // Looking down tips the head.
        view.body.rotation.x = .7;
        travel(.5, 0);
        assert.ok(avatar.head.rotation.x > .3);
    } finally { engine.dispose(); }
});

test('the offline cache carries the new rules file', async () => {
    const worker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
    for (const file of ['./js/avatar.js', './js/models/avatar.js', './js/components/view.js']) assert.ok(worker.includes(`'${file}'`), `${file} is precached`);
});
