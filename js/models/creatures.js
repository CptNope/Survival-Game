// Procedural models for hostile creatures and dungeon props. Same pipeline as
// the wildlife: a handful of low-poly primitives merged into one mesh with
// per-face vertex colours, so each creature is a single draw call.
import { V, palette, ellipsoid, branch, finish, colorMesh, seededRandom } from './wilderness.js';

function box(scene, name, position, size, color, random, rotationY = 0) {
    const mesh = BABYLON.MeshBuilder.CreateBox(name, {width: size.x, height: size.y, depth: size.z}, scene);
    mesh.position.copyFrom(position);
    mesh.rotation.y = rotationY;
    return colorMesh(mesh, color, random);
}

function glow(mesh, r, g, b) {
    mesh.material.emissiveColor = new BABYLON.Color3(r, g, b);
    return mesh;
}

const bone = [.82, .79, .68], boneDark = [.55, .52, .43];

function boar(scene, random) {
    const hide = [.30, .22, .17], bristle = [.19, .14, .11];
    const pieces = [
        ellipsoid(scene, 'boar-body', V(0, .78, 0), V(.5, .5, .9), hide, random),
        ellipsoid(scene, 'boar-shoulder', V(0, .92, .45), V(.5, .56, .5), bristle, random),
        ellipsoid(scene, 'boar-head', V(0, .74, 1.05), V(.36, .36, .46), hide, random),
        ellipsoid(scene, 'boar-snout', V(0, .62, 1.5), V(.2, .18, .22), [.45, .33, .28], random),
        branch(scene, V(0, .95, -.85), V(0, 1.2, -1.1), .08, bristle, random, .03)
    ];
    for (const side of [-1, 1]) {
        pieces.push(branch(scene, V(side * .2, .58, 1.42), V(side * .34, .86, 1.52), .09, bone, random, .02));
        pieces.push(ellipsoid(scene, 'boar-ear', V(side * .3, 1.08, .9), V(.1, .16, .08), bristle, random));
        pieces.push(ellipsoid(scene, 'boar-eye', V(side * .27, .86, 1.3), V(.05, .05, .05), [.8, .2, .1], random));
        for (const z of [-.55, .5]) pieces.push(branch(scene, V(side * .3, .55, z), V(side * .3, 0, z), .2, bristle, random, .12));
    }
    return finish(scene, pieces, 'boar');
}

function bear(scene, random) {
    const fur = [.27, .18, .12], light = [.4, .29, .2];
    const pieces = [
        ellipsoid(scene, 'bear-body', V(0, 1.25, -.1), V(.85, .85, 1.35), fur, random),
        ellipsoid(scene, 'bear-hump', V(0, 1.65, .55), V(.75, .7, .7), fur, random),
        ellipsoid(scene, 'bear-head', V(0, 1.6, 1.45), V(.5, .46, .52), fur, random),
        ellipsoid(scene, 'bear-muzzle', V(0, 1.46, 1.95), V(.26, .22, .3), light, random),
        ellipsoid(scene, 'bear-nose', V(0, 1.52, 2.24), V(.11, .09, .08), palette.dark, random)
    ];
    for (const side of [-1, 1]) {
        pieces.push(ellipsoid(scene, 'bear-ear', V(side * .38, 2.02, 1.3), V(.15, .16, .1), fur, random));
        pieces.push(ellipsoid(scene, 'bear-eye', V(side * .24, 1.72, 1.86), V(.05, .05, .05), palette.dark, random));
        for (const z of [-.85, .8]) {
            pieces.push(branch(scene, V(side * .52, 1.05, z), V(side * .52, .12, z + .05), .5, fur, random, .36));
            pieces.push(ellipsoid(scene, 'bear-paw', V(side * .52, .12, z + .18), V(.24, .13, .32), palette.dark, random));
        }
    }
    return finish(scene, pieces, 'bear');
}

function skeleton(scene, random) {
    const pieces = [
        ellipsoid(scene, 'skull', V(0, 1.78, .02), V(.2, .23, .22), bone, random),
        ellipsoid(scene, 'jaw', V(0, 1.6, .1), V(.14, .08, .14), boneDark, random),
        branch(scene, V(0, .95, 0), V(0, 1.58, 0), .09, bone, random, .08),
        ellipsoid(scene, 'pelvis', V(0, .95, 0), V(.22, .12, .13), boneDark, random)
    ];
    for (let rib = 0; rib < 3; rib++) pieces.push(ellipsoid(scene, 'rib', V(0, 1.2 + rib * .14, .02), V(.24 - rib * .02, .045, .15), bone, random));
    for (const side of [-1, 1]) {
        pieces.push(ellipsoid(scene, 'socket', V(side * .08, 1.82, .2), V(.05, .06, .04), [.9, .25, .1], random));
        pieces.push(branch(scene, V(side * .27, 1.5, 0), V(side * .36, 1.08, .12), .07, bone, random, .05));
        pieces.push(branch(scene, V(side * .36, 1.08, .12), V(side * .3, .8, .42), .06, boneDark, random, .04));
        pieces.push(branch(scene, V(side * .13, .92, 0), V(side * .15, .48, .04), .09, bone, random, .06));
        pieces.push(branch(scene, V(side * .15, .48, .04), V(side * .15, .04, 0), .07, boneDark, random, .05));
        pieces.push(ellipsoid(scene, 'foot', V(side * .15, .04, .1), V(.08, .05, .17), boneDark, random));
    }
    // A notched blade in the right hand.
    pieces.push(branch(scene, V(.3, .8, .42), V(.3, 1.5, .95), .09, [.5, .52, .54], random, .02));
    return finish(scene, pieces, 'skeleton');
}

function spider(scene, random) {
    const shell = [.13, .11, .13], leg = [.2, .16, .17];
    const pieces = [
        ellipsoid(scene, 'abdomen', V(0, .5, -.42), V(.45, .36, .55), shell, random),
        ellipsoid(scene, 'thorax', V(0, .42, .22), V(.3, .24, .32), leg, random),
        ellipsoid(scene, 'mark', V(0, .82, -.45), V(.14, .06, .2), [.75, .16, .1], random)
    ];
    for (const side of [-1, 1]) {
        pieces.push(ellipsoid(scene, 'eye', V(side * .1, .5, .5), V(.05, .05, .04), [.95, .2, .12], random));
        pieces.push(branch(scene, V(side * .08, .34, .5), V(side * .12, .16, .66), .06, shell, random, .015));
        for (let n = 0; n < 4; n++) {
            const z = .38 - n * .22, reach = .95 + (n % 2) * .15;
            pieces.push(branch(scene, V(side * .22, .42, z), V(side * reach * .62, .78, z + (.3 - n * .2)), .07, leg, random, .05));
            pieces.push(branch(scene, V(side * reach * .62, .78, z + (.3 - n * .2)), V(side * reach, 0, z + (.55 - n * .37)), .05, shell, random, .02));
        }
    }
    return finish(scene, pieces, 'spider');
}

function bat(scene, random) {
    const fur = [.2, .16, .2], membrane = [.32, .2, .26];
    const pieces = [
        ellipsoid(scene, 'bat-body', V(0, 0, 0), V(.17, .2, .26), fur, random),
        ellipsoid(scene, 'bat-head', V(0, .1, .26), V(.13, .13, .13), fur, random)
    ];
    for (const side of [-1, 1]) {
        pieces.push(ellipsoid(scene, 'bat-ear', V(side * .08, .27, .24), V(.045, .11, .04), fur, random));
        pieces.push(ellipsoid(scene, 'bat-eye', V(side * .06, .13, .37), V(.03, .03, .03), [.95, .75, .2], random));
        pieces.push(ellipsoid(scene, 'bat-wing', V(side * .5, .06, 0), V(.42, .03, .28), membrane, random));
        pieces.push(ellipsoid(scene, 'bat-wingtip', V(side * 1.0, .12, -.06), V(.26, .025, .2), membrane, random));
    }
    return finish(scene, pieces, 'bat');
}

function wraith(scene, random) {
    const robe = [.2, .15, .32], hood = [.12, .09, .2];
    const pieces = [
        branch(scene, V(0, .25, 0), V(0, 1.55, 0), 1.05, robe, random, .42),
        ellipsoid(scene, 'tatters', V(0, .3, 0), V(.56, .22, .56), hood, random),
        ellipsoid(scene, 'hood', V(0, 1.72, -.02), V(.3, .32, .32), hood, random),
        ellipsoid(scene, 'void', V(0, 1.7, .16), V(.19, .21, .16), [.02, .02, .04], random)
    ];
    for (const side of [-1, 1]) {
        pieces.push(ellipsoid(scene, 'ghost-eye', V(side * .08, 1.74, .3), V(.04, .03, .03), [.55, .95, 1], random));
        pieces.push(branch(scene, V(side * .32, 1.38, 0), V(side * .5, 1.05, .5), .16, robe, random, .07));
        pieces.push(ellipsoid(scene, 'ghost-hand', V(side * .52, 1.02, .56), V(.07, .07, .09), [.6, .72, .78], random));
    }
    return glow(finish(scene, pieces, 'wraith'), .16, .13, .3);
}

function warden(scene, random) {
    const rock = [.36, .38, .4], dark = [.22, .24, .27], moss = [.26, .34, .24];
    const pieces = [
        ellipsoid(scene, 'torso', V(0, 2.3, 0), V(1.0, 1.0, .75), rock, random),
        ellipsoid(scene, 'belly', V(0, 1.4, 0), V(.75, .65, .6), dark, random),
        ellipsoid(scene, 'head', V(0, 3.35, .15), V(.42, .4, .42), rock, random),
        ellipsoid(scene, 'brow', V(0, 3.52, .38), V(.4, .12, .2), dark, random),
        ellipsoid(scene, 'core', V(0, 2.3, .66), V(.3, .34, .16), [1, .55, .16], random),
        ellipsoid(scene, 'moss', V(-.5, 3.1, -.2), V(.5, .2, .45), moss, random)
    ];
    for (const side of [-1, 1]) {
        pieces.push(ellipsoid(scene, 'eye', V(side * .16, 3.36, .52), V(.07, .05, .05), [1, .6, .2], random));
        pieces.push(ellipsoid(scene, 'shoulder', V(side * 1.15, 2.9, 0), V(.55, .5, .55), rock, random));
        pieces.push(branch(scene, V(side * 1.3, 2.7, 0), V(side * 1.5, 1.55, .25), .62, dark, random, .5));
        pieces.push(ellipsoid(scene, 'fist', V(side * 1.55, 1.2, .35), V(.48, .5, .5), rock, random));
        pieces.push(branch(scene, V(side * .45, 1.1, 0), V(side * .5, .25, .05), .62, dark, random, .55));
        pieces.push(ellipsoid(scene, 'foot', V(side * .5, .2, .15), V(.42, .22, .55), rock, random));
    }
    return glow(finish(scene, pieces, 'warden'), .1, .05, .02);
}

const BUILDERS = {boar, bear, skeleton, spider, bat, wraith, warden};

export function createCreatureModel(scene, kind, seed = 1) {
    const build = BUILDERS[kind];
    if (!build) throw new Error('Unknown creature: ' + kind);
    return {mesh: build(scene, seededRandom(seed)), legs: []};
}

// --- Props ------------------------------------------------------------
export function createChestModel(scene, boss = false, open = false) {
    const random = seededRandom(boss ? 311 : 211);
    const wood = boss ? [.2, .16, .22] : [.36, .24, .14], band = boss ? [.85, .66, .25] : [.5, .52, .5];
    const pieces = [
        box(scene, 'chest-base', V(0, .32, 0), V(1.15, .62, .78), wood, random),
        box(scene, 'chest-band-left', V(-.4, .33, 0), V(.12, .66, .82), band, random),
        box(scene, 'chest-band-right', V(.4, .33, 0), V(.12, .66, .82), band, random),
        box(scene, 'chest-lock', V(0, .5, .41), V(.2, .22, .08), band, random)
    ];
    const lid = box(scene, 'chest-lid', V(0, open ? 1.0 : .74, open ? -.5 : 0), V(1.19, .24, .82), wood, random);
    if (open) lid.rotation.x = -1.2;
    pieces.push(lid);
    if (open) pieces.push(box(scene, 'chest-dark', V(0, .6, 0), V(1, .06, .64), [.05, .04, .03], random));
    return finish(scene, pieces, boss ? 'boss-chest' : 'chest');
}

// The way down: a weathered stone doorway set into a mound on the surface.
export function createEntranceModel(scene, seed = 1) {
    const random = seededRandom(seed);
    const stone = palette.stone, dark = [.2, .22, .23];
    const pieces = [
        ellipsoid(scene, 'mound', V(0, .6, -3.9), V(3.8, 2.5, 3.3), palette.moss, random),
        box(scene, 'post-left', V(-1.35, 1.5, 0), V(.8, 3, 1), stone, random),
        box(scene, 'post-right', V(1.35, 1.5, 0), V(.8, 3, 1), stone, random),
        box(scene, 'lintel', V(0, 3.25, 0), V(4, .6, 1.2), dark, random, .03),
        box(scene, 'capstone', V(.1, 3.75, 0), V(2.2, .4, 1), stone, random, -.05),
        box(scene, 'doorway', V(0, 1.45, -.2), V(1.95, 2.9, .5), [.015, .015, .02], random),
        box(scene, 'back-wall', V(0, 1.6, -.75), V(3.6, 3.2, .6), dark, random),
        box(scene, 'step-1', V(0, .12, 1.0), V(2.6, .24, .9), dark, random),
        box(scene, 'step-2', V(0, .08, 1.8), V(3, .16, .9), stone, random)
    ];
    for (let n = 0; n < 5; n++) {
        pieces.push(ellipsoid(scene, 'rubble', V(-2.6 + n * 1.3 + random() * .4, .2, 1.4 + random() * 1.4),
            V(.3 + random() * .25, .2 + random() * .15, .3 + random() * .2), n % 2 ? stone : palette.moss, random));
    }
    return finish(scene, pieces, 'dungeon-entrance');
}

export function createBrazierModel(scene) {
    const random = seededRandom(57);
    const iron = [.2, .2, .22];
    return glow(finish(scene, [
        branch(scene, V(0, 0, 0), V(0, .85, 0), .34, iron, random, .16),
        branch(scene, V(0, .85, 0), V(0, 1.15, 0), .3, iron, random, .74),
        ellipsoid(scene, 'coals', V(0, 1.14, 0), V(.3, .1, .3), [1, .45, .12], random)
    ], 'brazier'), .22, .09, .02);
}

// A marker for the stairs: a ring on the floor under a soft column of light.
export function createStairsModel(scene, kind = 'down') {
    const colour = kind === 'down' ? new BABYLON.Color3(1, .62, .22) : new BABYLON.Color3(.5, .82, 1);
    const root = new BABYLON.Mesh('stairs-' + kind, scene);
    const material = new BABYLON.StandardMaterial('stairs-mat-' + kind, scene);
    material.emissiveColor = colour;
    material.diffuseColor = BABYLON.Color3.Black();
    material.specularColor = BABYLON.Color3.Black();
    material.disableLighting = true;
    const ring = BABYLON.MeshBuilder.CreateTorus('stairs-ring', {diameter: 2.2, thickness: .16, tessellation: 20}, scene);
    ring.position.y = .08; ring.material = material; ring.parent = root;
    const pit = BABYLON.MeshBuilder.CreateDisc('stairs-pit', {radius: 1.02, tessellation: 20}, scene);
    pit.rotation.x = Math.PI / 2; pit.position.y = .04; pit.parent = root;
    const pitMaterial = new BABYLON.StandardMaterial('stairs-pit-mat', scene);
    pitMaterial.diffuseColor = BABYLON.Color3.Black(); pitMaterial.specularColor = BABYLON.Color3.Black();
    pitMaterial.emissiveColor = colour.scale(kind === 'down' ? .06 : .3);
    pit.material = pitMaterial;
    const beamMaterial = material.clone('stairs-beam-mat');
    beamMaterial.alpha = .16;
    beamMaterial.backFaceCulling = false;
    const beam = BABYLON.MeshBuilder.CreateCylinder('stairs-beam', {height: 4, diameterTop: 1.5, diameterBottom: 1.9, tessellation: 14}, scene);
    beam.position.y = 2; beam.material = beamMaterial; beam.parent = root;
    for (const mesh of [root, ring, pit, beam]) { mesh.isPickable = false; mesh.checkCollisions = false; }
    return root;
}

// A piece of gear lying on the ground: a gem lit in its rarity colour.
export function createGearDropModel(scene, hex) {
    const colour = BABYLON.Color3.FromHexString(hex);
    const root = new BABYLON.Mesh('gear-drop', scene);
    const material = new BABYLON.StandardMaterial('gear-drop-mat', scene);
    material.emissiveColor = colour.scale(.85);
    material.diffuseColor = colour;
    material.specularColor = new BABYLON.Color3(.4, .4, .4);
    const gem = BABYLON.MeshBuilder.CreatePolyhedron('gear-gem', {type: 1, size: .24}, scene);
    gem.position.y = .6; gem.material = material; gem.parent = root;
    const beamMaterial = new BABYLON.StandardMaterial('gear-beam-mat', scene);
    beamMaterial.emissiveColor = colour; beamMaterial.diffuseColor = BABYLON.Color3.Black();
    beamMaterial.specularColor = BABYLON.Color3.Black(); beamMaterial.disableLighting = true;
    beamMaterial.alpha = .2; beamMaterial.backFaceCulling = false;
    const beam = BABYLON.MeshBuilder.CreateCylinder('gear-beam', {height: 2.6, diameter: .14, tessellation: 8}, scene);
    beam.position.y = 1.5; beam.material = beamMaterial; beam.parent = root;
    for (const mesh of [root, gem, beam]) { mesh.isPickable = false; mesh.checkCollisions = false; }
    root.metadata = {gem};
    return root;
}
