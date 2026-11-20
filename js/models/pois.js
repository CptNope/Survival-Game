// Models for the points of interest: a watchtower, a waystone, a den, four
// havens, a trader's camp, a shrine, a cairn with its cache, and a wreck. Like everything else out here they are low-poly shapes built in
// code, merged into one mesh each and coloured by vertex.
import { V, ellipsoid, branch, finish, colorMesh, seededRandom } from './wilderness.js';

const WOOD = [.36, .25, .15], WOOD_DARK = [.24, .17, .11], STONE = [.43, .45, .46], BONE = [.86, .83, .74];
const EARTH = {meadow: [.33, .26, .17], tundra: [.80, .85, .90], desert: [.74, .59, .37], marsh: [.24, .27, .18]};
const ROOF = {meadow: [.42, .22, .16], tundra: [.30, .36, .46], desert: [.62, .36, .20], marsh: [.26, .30, .22]};

function box(scene, name, position, size, color, random, rotationY = 0) {
    const mesh = BABYLON.MeshBuilder.CreateBox(name, {width: size.x, height: size.y, depth: size.z}, scene);
    mesh.position.copyFrom(position);
    mesh.rotation.y = rotationY;
    return colorMesh(mesh, color, random);
}

function disc(scene, name, position, diameter, height, color, random, sides = 10) {
    const mesh = BABYLON.MeshBuilder.CreateCylinder(name, {height, diameter, tessellation: sides}, scene);
    mesh.position.copyFrom(position);
    return colorMesh(mesh, color, random);
}

function cone(scene, name, position, diameter, height, color, random, sides = 4) {
    const mesh = BABYLON.MeshBuilder.CreateCylinder(name, {height, diameterBottom: diameter, diameterTop: 0, tessellation: sides}, scene);
    mesh.position.copyFrom(position);
    mesh.rotation.y = Math.PI / 4;
    return colorMesh(mesh, color, random);
}

const ring = (count, radius, each, offset = 0) =>
    Array.from({length: count}, (_, n) => each(Math.cos(n / count * Math.PI * 2 + offset) * radius, Math.sin(n / count * Math.PI * 2 + offset) * radius, n));

// A lookout on four splayed legs, with a ladder, a railed deck and a roof.
function tower(scene, region, random) {
    const pieces = [], deck = 6.2, roof = ROOF[region] || ROOF.meadow;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        pieces.push(branch(scene, V(sx * 2.1, 0, sz * 2.1), V(sx * 1.35, deck, sz * 1.35), .34, WOOD, random, .26));
        pieces.push(branch(scene, V(sx * 1.35, deck, sz * 1.35), V(sx * 1.35, deck + 2.1, sz * 1.35), .2, WOOD_DARK, random, .18));
    }
    // Cross braces on two faces keep it from looking like a table.
    pieces.push(branch(scene, V(-2, .6, -2), V(1.5, 4.6, -1.5), .16, WOOD_DARK, random, .14));
    pieces.push(branch(scene, V(2, .6, 2), V(-1.5, 4.6, 1.5), .16, WOOD_DARK, random, .14));
    pieces.push(box(scene, 'tower-deck', V(0, deck, 0), V(3.5, .22, 3.5), WOOD, random));
    for (const [x, z, w, d] of [[0, -1.65, 3.5, .12], [0, 1.65, 3.5, .12], [-1.65, 0, .12, 3.5]])
        pieces.push(box(scene, 'tower-rail', V(x, deck + 1, z), V(w, .14, d), WOOD_DARK, random));
    pieces.push(cone(scene, 'tower-roof', V(0, deck + 2.75, 0), 5.4, 1.5, roof, random));
    // The ladder, on the open side.
    pieces.push(branch(scene, V(2.3, 0, -.4), V(1.7, deck + .9, -.4), .1, WOOD_DARK, random, .1));
    pieces.push(branch(scene, V(2.3, 0, .4), V(1.7, deck + .9, .4), .1, WOOD_DARK, random, .1));
    for (let n = 1; n <= 9; n++) {
        const t = n / 10.5;
        pieces.push(box(scene, 'tower-rung', V(2.3 - .6 * t, (deck + .9) * t, 0), V(.08, .08, .9), WOOD, random));
    }
    pieces.push(box(scene, 'tower-pennant', V(.55, deck + 3.75, 0), V(1, .5, .05), [.86, .70, .30], random));
    pieces.push(branch(scene, V(0, deck + 3.2, 0), V(0, deck + 4.1, 0), .08, WOOD_DARK, random, .06));
    return finish(scene, pieces, 'poi-tower');
}

// A tall carved stone in a ring of smaller ones. The rune is a separate,
// unlit mesh so it can be lit once the stone knows you.
function waystone(scene, random) {
    const pieces = [
        disc(scene, 'waystone-step', V(0, .12, 0), 4.2, .24, [.36, .38, .39], random, 9),
        branch(scene, V(0, .2, 0), V(.12, 3.7, 0), 1.25, STONE, random, .62),
        ellipsoid(scene, 'waystone-cap', V(.12, 3.78, 0), V(.42, .26, .42), [.34, .36, .38], random)
    ];
    ring(5, 2.5, (x, z, n) => pieces.push(branch(scene, V(x, 0, z), V(x * 1.04, .8 + (n % 2) * .5, z * 1.04), .5, [.40, .42, .42], random, .3)), .5);
    const stone = finish(scene, pieces, 'poi-waystone');
    const material = new BABYLON.StandardMaterial('waystone-rune-mat', scene);
    material.diffuseColor = BABYLON.Color3.Black();
    material.specularColor = BABYLON.Color3.Black();
    material.disableLighting = true;
    const rune = BABYLON.MeshBuilder.CreatePolyhedron('waystone-rune', {type: 1, size: .2}, scene);
    rune.position.set(.07, 2.2, .52); rune.material = material; rune.parent = stone; rune.isPickable = false;
    stone.metadata = {...stone.metadata, rune};
    return stone;
}

// A mound with a dark mouth, boulders at the door and bones on the step.
function den(scene, region, random) {
    const earth = EARTH[region] || EARTH.meadow, pieces = [
        ellipsoid(scene, 'den-mound', V(0, .5, -1.2), V(3.6, 2.1, 3.2), earth, random),
        ellipsoid(scene, 'den-mouth', V(0, .7, 1.25), V(1.15, .95, .7), [.05, .045, .04], random),
        ellipsoid(scene, 'den-rock-left', V(-1.9, .5, 1.5), V(.9, .75, .8), STONE, random),
        ellipsoid(scene, 'den-rock-right', V(1.8, .42, 1.7), V(.75, .6, .7), STONE, random),
        ellipsoid(scene, 'den-skull', V(.5, .2, 3.1), V(.26, .22, .3), BONE, random)
    ];
    for (let n = 0; n < 6; n++) {
        const x = (random() - .5) * 4, z = 2.4 + random() * 2.2;
        pieces.push(branch(scene, V(x, .1, z), V(x + (random() - .5) * 1.1, .14 + random() * .2, z + (random() - .5) * 1.1), .08, BONE, random, .05));
    }
    return finish(scene, pieces, 'poi-den');
}

function fruitTree(scene, pieces, x, z, random) {
    const top = V(x + (random() - .5) * .5, 2.1 + random() * .5, z + (random() - .5) * .5);
    pieces.push(branch(scene, V(x, 0, z), top, .34, WOOD, random, .2));
    pieces.push(ellipsoid(scene, 'orchard-crown', top.add(V(0, .7, 0)), V(1.5, 1.15, 1.5), [.30, .46, .22], random));
    for (let n = 0; n < 5; n++) {
        const angle = random() * Math.PI * 2;
        pieces.push(ellipsoid(scene, 'orchard-fruit', top.add(V(Math.cos(angle) * 1.25, .35 + random() * .7, Math.sin(angle) * 1.25)), V(.16, .16, .16), [.78, .18, .14], random));
    }
}

// Four old fruit trees round a log to sit on, with a basket somebody left.
function orchard(scene, random) {
    const pieces = [];
    ring(4, 3.6, (x, z) => fruitTree(scene, pieces, x, z, random), .6);
    pieces.push(branch(scene, V(-1.3, .28, .2), V(1.3, .28, -.2), .5, WOOD_DARK, random, .46));
    pieces.push(disc(scene, 'orchard-basket', V(.4, .28, 1.4), .7, .5, [.62, .48, .28], random, 8));
    for (let n = 0; n < 4; n++) pieces.push(ellipsoid(scene, 'orchard-windfall', V(.25 + (n % 2) * .3, .6, 1.3 + (n > 1 ? .22 : 0)), V(.15, .15, .15), [.78, .18, .14], random));
    return finish(scene, pieces, 'poi-orchard');
}

// A warm pool in a ring of dark rock, with steam standing over it.
function spring(scene, random) {
    const pieces = [disc(scene, 'spring-water', V(0, .16, 0), 5.6, .12, [.40, .72, .74], random, 11)];
    ring(9, 3, (x, z, n) => pieces.push(ellipsoid(scene, 'spring-rock', V(x, .3, z), V(.85 + (n % 3) * .2, .5 + (n % 2) * .3, .8), [.30, .32, .35], random)));
    for (let n = 0; n < 6; n++) {
        const angle = random() * Math.PI * 2, radius = random() * 1.6;
        pieces.push(ellipsoid(scene, 'spring-steam', V(Math.cos(angle) * radius, 1 + n * .42, Math.sin(angle) * radius), V(.5 - n * .05, .28, .5 - n * .05), [.93, .96, .98], random));
    }
    return finish(scene, pieces, 'poi-spring');
}

function palm(scene, pieces, x, z, lean, random) {
    const mid = V(x + Math.cos(lean) * .5, 1.9, z + Math.sin(lean) * .5), top = V(x + Math.cos(lean) * 1.3, 3.7, z + Math.sin(lean) * 1.3);
    pieces.push(branch(scene, V(x, 0, z), mid, .34, [.50, .40, .26], random, .28));
    pieces.push(branch(scene, mid, top, .28, [.50, .40, .26], random, .2));
    ring(6, 1.25, (fx, fz) => {
        const frond = ellipsoid(scene, 'oasis-frond', top.add(V(fx, -.12, fz)), V(1.25, .1, .34), [.24, .46, .22], random);
        frond.rotation.y = -Math.atan2(fz, fx);
        frond.rotation.z = -.38;
        pieces.push(frond);
    }, lean);
}

// Water where there should not be any, three palms and a fringe of reeds.
function oasis(scene, random) {
    const pieces = [
        disc(scene, 'oasis-bank', V(0, .08, 0), 7.2, .1, [.42, .46, .26], random, 12),
        disc(scene, 'oasis-water', V(0, .15, 0), 5.2, .1, [.22, .52, .66], random, 11)
    ];
    palm(scene, pieces, -3, 1.2, 2.6, random);
    palm(scene, pieces, 2.6, 2.2, .7, random);
    palm(scene, pieces, .8, -3.2, -1.3, random);
    ring(8, 2.9, (x, z, n) => pieces.push(branch(scene, V(x, .1, z), V(x * 1.03, .9 + (n % 3) * .25, z * 1.03), .07, [.36, .50, .24], random, .03)), .2);
    return finish(scene, pieces, 'poi-oasis');
}

// A one-room hut on stilts above the wet, with a ladder and a lit lantern.
function hut(scene, random) {
    const pieces = [], floor = 2.2, wall = [.30, .25, .17];
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]])
        pieces.push(branch(scene, V(sx * 1.6, 0, sz * 1.4), V(sx * 1.5, floor, sz * 1.3), .26, WOOD_DARK, random, .22));
    pieces.push(box(scene, 'hut-floor', V(0, floor, 0), V(3.8, .2, 3.4), WOOD, random));
    pieces.push(box(scene, 'hut-back', V(0, floor + 1.1, -1.5), V(3.4, 2, .16), wall, random));
    pieces.push(box(scene, 'hut-left', V(-1.6, floor + 1.1, 0), V(.16, 2, 3), wall, random));
    pieces.push(box(scene, 'hut-right', V(1.6, floor + 1.1, 0), V(.16, 2, 3), wall, random));
    pieces.push(box(scene, 'hut-front-left', V(-1.05, floor + 1.1, 1.5), V(1.3, 2, .16), wall, random));
    pieces.push(box(scene, 'hut-front-right', V(1.05, floor + 1.1, 1.5), V(1.3, 2, .16), wall, random));
    pieces.push(cone(scene, 'hut-roof', V(0, floor + 2.85, 0), 6, 1.6, ROOF.marsh, random));
    pieces.push(branch(scene, V(-.4, 0, 2.6), V(-.4, floor + .1, 1.75), .1, WOOD_DARK, random, .1));
    pieces.push(branch(scene, V(.4, 0, 2.6), V(.4, floor + .1, 1.75), .1, WOOD_DARK, random, .1));
    for (let n = 1; n <= 4; n++) pieces.push(box(scene, 'hut-rung', V(0, floor * n / 5, 2.6 - .85 * n / 5), V(.9, .08, .08), WOOD, random));
    pieces.push(ellipsoid(scene, 'hut-lantern', V(.9, floor + 1.75, 1.72), V(.16, .22, .16), [1, .78, .32], random));
    return finish(scene, pieces, 'poi-hut');
}

// A covered cart, an awning with crates under it, a lantern, and the trader.
function trader(scene, random) {
    const pieces = [], canvas = [.80, .72, .52], cloth = [.34, .46, .50];
    // The cart: bed, hooped cover, two wheels and a shaft resting on the ground.
    pieces.push(box(scene, 'cart-bed', V(-2.2, .95, -.4), V(2.6, .22, 1.5), WOOD, random));
    pieces.push(box(scene, 'cart-side-near', V(-2.2, 1.3, .32), V(2.6, .5, .08), WOOD_DARK, random));
    pieces.push(box(scene, 'cart-side-far', V(-2.2, 1.3, -1.12), V(2.6, .5, .08), WOOD_DARK, random));
    pieces.push(ellipsoid(scene, 'cart-cover', V(-2.2, 1.95, -.4), V(1.35, .85, .82), canvas, random));
    for (const z of [.5, -1.3]) {
        const wheel = disc(scene, 'cart-wheel', V(-2.5, .62, z), 1.24, .12, WOOD_DARK, random, 10);
        wheel.rotation.x = Math.PI / 2;
        pieces.push(wheel);
    }
    pieces.push(branch(scene, V(-.9, .95, -.4), V(.5, .12, -.4), .12, WOOD_DARK, random, .1));
    // The stall: four poles, a sloping cloth, a board on trestles and the goods.
    for (const [x, z, tall] of [[.9, 1.6, 2.5], [3.1, 1.6, 2.5], [.9, -.2, 2.1], [3.1, -.2, 2.1]])
        pieces.push(branch(scene, V(x, 0, z), V(x, tall, z), .1, WOOD_DARK, random, .09));
    const awning = box(scene, 'stall-awning', V(2, 2.36, .7), V(2.6, .06, 2.1), cloth, random);
    awning.rotation.x = -.21;
    pieces.push(awning);
    pieces.push(box(scene, 'stall-board', V(2, .9, .9), V(2, .1, .8), WOOD, random));
    pieces.push(box(scene, 'stall-leg-left', V(1.2, .45, .9), V(.1, .9, .7), WOOD_DARK, random));
    pieces.push(box(scene, 'stall-leg-right', V(2.8, .45, .9), V(.1, .9, .7), WOOD_DARK, random));
    pieces.push(box(scene, 'stall-crate', V(1.45, 1.13, .9), V(.5, .36, .5), [.52, .38, .22], random, .3));
    pieces.push(ellipsoid(scene, 'stall-sack', V(2.2, 1.12, .95), V(.3, .24, .28), canvas, random));
    pieces.push(ellipsoid(scene, 'stall-pot', V(2.7, 1.1, .8), V(.18, .2, .18), [.56, .30, .20], random));
    pieces.push(box(scene, 'camp-crate', V(3.7, .3, -.6), V(.8, .6, .7), [.46, .33, .2], random, -.3));
    pieces.push(disc(scene, 'camp-barrel', V(.3, .45, 2.2), .7, .9, [.40, .28, .17], random, 9));
    pieces.push(ellipsoid(scene, 'stall-lantern', V(.9, 2.2, 1.6), V(.14, .2, .14), [1, .78, .32], random));
    // The trader, behind the board: coat, head and a wide hat.
    pieces.push(branch(scene, V(2, 0, -.1), V(2, 1.35, -.1), .62, [.30, .22, .34], random, .44));
    pieces.push(ellipsoid(scene, 'trader-head', V(2, 1.6, -.1), V(.2, .23, .2), [.80, .62, .48], random));
    pieces.push(disc(scene, 'trader-brim', V(2, 1.8, -.1), .74, .05, [.22, .18, .13], random, 9));
    pieces.push(cone(scene, 'trader-crown', V(2, 1.95, -.1), .44, .3, [.22, .18, .13], random, 6));
    return finish(scene, pieces, 'poi-trader');
}

const BANNER = {fury: [.74, .20, .16], stoneskin: [.42, .52, .62], haste: [.88, .72, .22]};
// A little roofed stone house for an idol, with a bowl in front and a banner
// in the colour of whichever beast it is to.
function shrine(scene, boon, random) {
    const stone = [.50, .51, .50], dark = [.33, .34, .35], banner = BANNER[boon] || BANNER.fury;
    const pieces = [
        disc(scene, 'shrine-step', V(0, .1, 0), 3.4, .2, dark, random, 8),
        box(scene, 'shrine-plinth', V(0, .55, -.2), V(1.5, .7, 1.1), stone, random),
        box(scene, 'shrine-post-left', V(-.62, 1.55, -.2), V(.2, 1.3, .9), stone, random),
        box(scene, 'shrine-post-right', V(.62, 1.55, -.2), V(.2, 1.3, .9), stone, random),
        box(scene, 'shrine-back', V(0, 1.55, -.6), V(1.1, 1.3, .14), dark, random),
        cone(scene, 'shrine-roof', V(0, 2.62, -.2), 2.5, .9, [.36, .26, .20], random),
        // The idol: a squat body, a head and two ears or horns.
        ellipsoid(scene, 'shrine-idol', V(0, 1.2, -.22), V(.3, .34, .26), banner.map(c => c * .8 + .1), random),
        ellipsoid(scene, 'shrine-idol-head', V(0, 1.66, -.14), V(.2, .18, .2), banner.map(c => c * .8 + .1), random),
        cone(scene, 'shrine-ear-left', V(-.13, 1.9, -.14), .12, boon === 'haste' ? .42 : .2, dark, random, 5),
        cone(scene, 'shrine-ear-right', V(.13, 1.9, -.14), .12, boon === 'haste' ? .42 : .2, dark, random, 5),
        disc(scene, 'shrine-bowl', V(0, .28, .95), .6, .16, [.62, .50, .26], random, 8),
        branch(scene, V(1.35, 0, .2), V(1.35, 3, .2), .1, WOOD_DARK, random, .08),
        box(scene, 'shrine-banner', V(1.62, 2.4, .2), V(.5, 1.1, .04), banner, random)
    ];
    return finish(scene, pieces, 'poi-shrine');
}

// Stones piled by someone who wanted them found, and a stick with a rag on it.
function cairn(scene, random) {
    const pieces = [];
    for (let n = 0; n < 6; n++) {
        const size = 1 - n * .14;
        pieces.push(ellipsoid(scene, 'cairn-stone', V((random() - .5) * .16, .28 + n * .36, (random() - .5) * .16), V(.7 * size, .26, .62 * size), STONE.map(c => c * (.85 + random() * .3)), random));
    }
    pieces.push(branch(scene, V(.75, 0, .2), V(.9, 2.3, .26), .08, WOOD_DARK, random, .06));
    pieces.push(box(scene, 'cairn-rag', V(1.1, 2.05, .26), V(.44, .3, .03), [.72, .24, .18], random));
    for (let n = 0; n < 3; n++) pieces.push(ellipsoid(scene, 'cairn-spill', V(-.8 + n * .5, .12, .9 - n * .2), V(.24, .14, .2), STONE, random));
    return finish(scene, pieces, 'poi-cairn');
}

// Turned earth with two sticks crossed over it: X marks the spot.
function cacheMound(scene, random) {
    const earth = [.36, .27, .17], pieces = [
        ellipsoid(scene, 'cache-mound', V(0, .1, 0), V(1.1, .34, .9), earth, random),
        ellipsoid(scene, 'cache-clod', V(.9, .1, .5), V(.3, .18, .26), earth.map(c => c * .85), random),
        ellipsoid(scene, 'cache-clod', V(-.8, .08, -.5), V(.24, .14, .22), earth.map(c => c * .85), random),
        branch(scene, V(-.55, .3, -.45), V(.55, .46, .45), .07, WOOD, random, .06),
        branch(scene, V(-.55, .46, .45), V(.55, .3, -.45), .07, WOOD, random, .06),
        // The same red rag as on the cairn that sent you, so you know it at a distance.
        branch(scene, V(.95, 0, -.3), V(1.02, 1.7, -.3), .07, WOOD_DARK, random, .05),
        box(scene, 'cache-rag', V(1.22, 1.5, -.3), V(.4, .28, .03), [.72, .24, .18], random)
    ];
    return finish(scene, pieces, 'poi-cache');
}

// A boat on the lake bed, broken backed, with the mast still standing clear of
// the water so you can see where she lies. The chest is on what is left of the deck.
function wreck(scene, random) {
    const pieces = [], plank = [.30, .24, .17], weed = [.20, .34, .26];
    pieces.push(branch(scene, V(-3.6, .3, 0), V(3.4, .5, .3), .34, WOOD_DARK, random, .3));
    for (let n = 0; n < 8; n++) {
        const x = -3 + n * .86, lean = (random() - .5) * .3, tall = 1.1 + Math.sin(n / 7 * Math.PI) * .7;
        pieces.push(branch(scene, V(x, .35, 0), V(x + lean, tall, 1.25), .13, plank, random, .09));
        if (n !== 3 && n !== 6) pieces.push(branch(scene, V(x, .35, 0), V(x - lean, tall, -1.25), .13, plank, random, .09));
    }
    const port = box(scene, 'wreck-strake', V(-.4, .75, 1.05), V(5.6, .5, .08), plank, random); port.rotation.x = .42; pieces.push(port);
    const deck = box(scene, 'wreck-deck', V(-1.5, .95, 0), V(2.6, .1, 1.7), plank, random); deck.rotation.z = .08; pieces.push(deck);
    pieces.push(branch(scene, V(.6, .4, .1), V(1, 6.6, .3), .26, WOOD, random, .14));
    pieces.push(branch(scene, V(-.2, 5.5, .28), V(2.1, 5.7, .28), .1, WOOD_DARK, random, .08));
    pieces.push(box(scene, 'wreck-rag', V(1.5, 5.25, .28), V(.9, .7, .03), [.70, .66, .54], random));
    pieces.push(box(scene, 'wreck-chest', V(-1.6, 1.28, 0), V(.9, .5, .6), [.36, .24, .14], random, .3));
    pieces.push(box(scene, 'wreck-chest-band', V(-1.6, 1.3, 0), V(.2, .54, .64), [.85, .66, .25], random, .3));
    pieces.push(disc(scene, 'wreck-barrel', V(2.6, .45, -1.4), .7, .9, [.36, .26, .16], random, 9));
    for (let n = 0; n < 5; n++) pieces.push(branch(scene, V(-3 + n * 1.5, .1, 1.8 - (n % 2) * 3.4), V(-3 + n * 1.5 + (random() - .5) * .4, 1 + random() * .9, 1.8 - (n % 2) * 3.4), .09, weed, random, .02));
    return finish(scene, pieces, 'poi-wreck');
}

const HAVEN_MODELS = {meadow: orchard, tundra: spring, desert: oasis, marsh: hut};

// The model for a place. Solid ones (a tower, a stone, a hut) can be walked into.
export function createPoiModel(scene, poi) {
    const random = seededRandom(Math.floor(poi.x * 31 + poi.z * 17) | 0);
    const mesh = poi.kind === 'tower' ? tower(scene, poi.region, random)
        : poi.kind === 'waystone' ? waystone(scene, random)
        : poi.kind === 'den' ? den(scene, poi.region, random)
        : poi.kind === 'trader' ? trader(scene, random)
        : poi.kind === 'shrine' ? shrine(scene, poi.boon, random)
        : poi.kind === 'cairn' ? cairn(scene, random)
        : poi.kind === 'wreck' ? wreck(scene, random)
        : (HAVEN_MODELS[poi.region] || orchard)(scene, random);
    mesh.isPickable = false;
    mesh.metadata = {...mesh.metadata, poi: poi.id};
    return mesh;
}

// The mound that shows where a cairn's cache is buried.
export function createCacheModel(scene, seed = 1) {
    const mesh = cacheMound(scene, seededRandom(seed | 0));
    mesh.isPickable = false;
    return mesh;
}

// Light or dim a waystone's rune.
export function setRune(mesh, lit) {
    const rune = mesh?.metadata?.rune;
    if (rune?.material) rune.material.emissiveColor = lit ? new BABYLON.Color3(.35, .95, .85) : new BABYLON.Color3(.16, .19, .2);
}
