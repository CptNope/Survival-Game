// Procedural, locally generated assets. Static pieces are merged into one draw call.
// Vertex colors supply variation without textures or a material per branch/stone.
const V = (x, y, z) => new BABYLON.Vector3(x, y, z);
const palette = {
    bark: [0.25, 0.16, 0.105], barkLight: [0.37, 0.25, 0.16],
    pine: [0.12, 0.29, 0.23], pineLight: [0.24, 0.41, 0.29],
    leaf: [0.35, 0.45, 0.23], stone: [0.39, 0.43, 0.43],
    moss: [0.29, 0.37, 0.22], fur: [0.52, 0.32, 0.18],
    cream: [0.78, 0.68, 0.48], dark: [0.10, 0.09, 0.075]
};

export function seededRandom(seed) {
    return () => {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function colorMesh(mesh, color, random) {
    mesh.removeVerticesData(BABYLON.VertexBuffer.UVKind);
    mesh.convertToFlatShadedMesh();
    const colors = [];
    for (let i = 0; i < mesh.getTotalVertices(); i += 3) {
        const shade = 0.88 + random() * 0.22;
        for (let j = 0; j < 3; j++) colors.push(...color.map(c => c * shade), 1);
    }
    mesh.setVerticesData(BABYLON.VertexBuffer.ColorKind, colors);
    return mesh;
}

function ellipsoid(scene, name, position, scale, color, random) {
    const mesh = BABYLON.MeshBuilder.CreateIcoSphere(name, {radius: 1, subdivisions: 1, flat: true}, scene);
    mesh.position.copyFrom(position);
    mesh.scaling.copyFrom(scale);
    return colorMesh(mesh, color, random);
}

function branch(scene, start, end, width, color, random, top = width * 0.55) {
    const delta = end.subtract(start);
    const mesh = BABYLON.MeshBuilder.CreateCylinder('branch', {
        height: delta.length(), diameterBottom: width, diameterTop: top, tessellation: 7
    }, scene);
    mesh.position.copyFrom(start.add(end).scale(0.5));
    mesh.rotationQuaternion = BABYLON.Quaternion.FromUnitVectorsToRef(BABYLON.Axis.Y, delta.normalize(), new BABYLON.Quaternion());
    return colorMesh(mesh, color, random);
}

function finish(scene, pieces, name) {
    const mesh = BABYLON.Mesh.MergeMeshes(pieces, true, true);
    mesh.name = name;
    // Bake merged geometry around the world origin so placing the model uses its feet.
    mesh.bakeCurrentTransformIntoVertices();
    mesh.position.setAll(0);
    const material = new BABYLON.StandardMaterial(`${name}-mat`, scene);
    material.diffuseColor = BABYLON.Color3.White();
    material.specularColor = BABYLON.Color3.Black();
    mesh.material = material;
    mesh.metadata = { model: name };
    return mesh;
}

function crown(scene, radius, height, base, random, color) {
    const positions = [], indices = [], sides = 9;
    // Staggered rings give foliage broken, asymmetric edges instead of a perfect cone.
    const rings = [[0, 0.48], [0.17, 1], [0.40, 0.67], [0.65, 0.37], [1, 0.015]];
    for (let ring = 0; ring < rings.length; ring++) {
        for (let i = 0; i < sides; i++) {
            const angle = i / sides * Math.PI * 2;
            const r = radius * rings[ring][1] * (0.82 + random() * 0.30);
            positions.push(Math.cos(angle) * r + base.x, base.y + rings[ring][0] * height + (ring === 4 ? 0 : random() * 0.14), Math.sin(angle) * r + base.z);
            if (ring < rings.length - 1) {
                const a = ring * sides + i, b = ring * sides + (i + 1) % sides;
                indices.push(a, b, b + sides, a, b + sides, a + sides);
            }
        }
    }
    // Close the underside; it is visible when looking up at a tree.
    for (let i = 1; i < sides - 1; i++) indices.push(0, i + 1, i);
    const mesh = new BABYLON.Mesh('foliage', scene);
    const data = new BABYLON.VertexData();
    data.positions = positions; data.indices = indices;
    data.normals = [];
    BABYLON.VertexData.ComputeNormals(positions, indices, data.normals);
    data.applyToMesh(mesh);
    return colorMesh(mesh, color, random);
}

export function createTreeModel(scene, seed = 1, kind = 'pine') {
    const random = seededRandom(seed), pieces = [];
    const height = 6.2 + random() * 2.6;
    pieces.push(branch(scene, V(0, 0, 0), V(0.13, height * 0.82, 0), 0.55, palette.bark, random, 0.16));
    for (let i = 0; i < 5; i++) {
        const a = i * Math.PI * 2 / 5;
        pieces.push(branch(scene, V(0, 0.6, 0), V(Math.cos(a) * 0.9, 0.06, Math.sin(a) * 0.9), 0.28, palette.bark, random, 0.06));
    }
    if (kind === 'pine') {
        for (let i = 0; i < 5; i++) {
            const y = 1.65 + i * height * 0.12;
            const radius = (2.1 - i * 0.32) * (0.9 + random() * 0.18);
            pieces.push(crown(scene, radius, height * 0.39, V((random() - .5) * .3, y, (random() - .5) * .3), random, i % 2 ? palette.pineLight : palette.pine));
            if (i < 3) {
                const a = i * 2.4;
                pieces.push(branch(scene, V(0, y + .3, 0), V(Math.cos(a) * radius * .9, y + .1, Math.sin(a) * radius * .9), .15, palette.barkLight, random, .04));
            }
        }
    } else {
        for (let i = 0; i < 8; i++) {
            const a = i * 2.4, r = i === 7 ? 0 : 1.3 + random() * .5;
            const end = V(Math.cos(a) * r, height * .65 + random() * 1.7, Math.sin(a) * r);
            pieces.push(branch(scene, V(0, 2.8, 0), end, .23, palette.barkLight, random, .07));
            pieces.push(ellipsoid(scene, 'leaf-cluster', end, V(1.5 + random() * .5, 1.15 + random() * .5, 1.4), palette.leaf.map(c => c * (.85 + random() * .3)), random));
        }
    }
    const tree = finish(scene, pieces, `${kind}-tree`);
    tree.checkCollisions = true;
    return tree;
}

export function createRockModel(scene, seed = 1) {
    const random = seededRandom(seed), pieces = [];
    const count = 3 + Math.floor(random() * 3);
    for (let i = 0; i < count; i++) {
        const a = i * 2.4, size = i === 0 ? 1.15 : .3 + random() * .65;
        const x = i === 0 ? 0 : Math.cos(a) * 1.0, z = i === 0 ? 0 : Math.sin(a) * .9;
        const rock = ellipsoid(scene, 'stone', V(x, size * .48, z), V(size, size * .82, size * .85), palette.stone, random);
        // Distort shared points consistently, preserving a closed faceted surface.
        const positions = rock.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        for (let j = 0; j < positions.length; j += 3) {
            const wobble = 1 + .15 * Math.sin(positions[j] * 13 + positions[j + 1] * 7 + seed);
            positions[j] *= wobble; positions[j + 2] *= wobble;
        }
        rock.updateVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
        rock.refreshBoundingInfo();
        pieces.push(rock);
        if (i === 0) pieces.push(ellipsoid(scene, 'moss', V(-.18, size * 1.15, .1), V(size * .64, .12, size * .5), palette.moss, random));
    }
    const model = finish(scene, pieces, 'mossy-boulders');
    model.checkCollisions = true;
    return model;
}

export function createDeerModel(scene, seed = 1) {
    const random = seededRandom(seed);
    const root = new BABYLON.Mesh('deer', scene);
    const pieces = [
        ellipsoid(scene, 'body', V(0, 1.25, 0), V(.38, .46, .85), palette.fur, random),
        ellipsoid(scene, 'chest', V(0, 1.35, .5), V(.32, .46, .36), palette.fur, random),
        branch(scene, V(0, 1.4, .52), V(0, 2.02, .78), .44, palette.fur, random, .26),
        ellipsoid(scene, 'head', V(0, 2.08, .88), V(.23, .29, .38), palette.fur, random),
        ellipsoid(scene, 'muzzle', V(0, 1.99, 1.18), V(.16, .15, .24), palette.cream, random),
        ellipsoid(scene, 'nose', V(0, 2.01, 1.36), V(.13, .10, .07), palette.dark, random),
        ellipsoid(scene, 'tail', V(0, 1.45, -.88), V(.13, .21, .13), palette.cream, random)
    ];
    for (const side of [-1, 1]) {
        const ear = ellipsoid(scene, 'ear', V(side * .27, 2.35, .81), V(.13, .29, .09), palette.cream, random);
        ear.rotation.z = -side * .55; pieces.push(ear);
        pieces.push(ellipsoid(scene, 'eye', V(side * .215, 2.14, 1.02), V(.04, .045, .055), palette.dark, random));
        const base = V(side * .14, 2.29, .72), tip = V(side * .44, 2.95, .45);
        pieces.push(branch(scene, base, tip, .075, palette.cream, random, .025));
        pieces.push(branch(scene, V(side * .3, 2.65, .57), V(side * .58, 2.88, .75), .05, palette.cream, random, .012));
    }
    const body = finish(scene, pieces, 'deer-body'); body.parent = root;
    const legs = [];
    for (const side of [-1, 1]) for (const z of [-.54, .52]) {
        const pivot = new BABYLON.TransformNode('leg-pivot', scene);
        pivot.parent = root; pivot.position.set(side * .25, 1.15, z);
        const leg = finish(scene, [
            branch(scene, V(0, 0, 0), V(0, -.57, -.04), .16, palette.fur, random, .09),
            branch(scene, V(0, -.57, -.04), V(0, -1.02, .03), .09, palette.cream, random, .07),
            ellipsoid(scene, 'hoof', V(0, -1.08, .06), V(.10, .075, .16), palette.dark, random)
        ], 'deer-leg');
        leg.parent = pivot; legs.push(pivot);
    }
    root.metadata = {model: 'deer', legs};
    return {mesh: root, legs};
}

export function animateDeer(animal, dt, speed) {
    animal.gait = (animal.gait || 0) + dt * speed * 3.8;
    animal.legs.forEach((leg, i) => {
        leg.rotation.x = Math.sin(animal.gait + (i === 0 || i === 3 ? 0 : Math.PI)) * (speed > 2 ? .65 : .28);
    });
}

// Small wildlife shares the same procedural geometry/material pipeline as deer,
// but merges into just one mesh and needs no per-leg draw calls.
export function createWolfModel(scene, seed = 1) {
    const random=seededRandom(seed), pieces=[];
    const coat=[.27,.29,.29], lighter=[.44,.43,.38];
    pieces.push(ellipsoid(scene,'wolf-body',V(0,1.00,0),V(.45,.43,.87),coat,random));
    pieces.push(ellipsoid(scene,'wolf-chest',V(0,1.13,.57),V(.47,.48,.43),lighter,random));
    pieces.push(ellipsoid(scene,'wolf-head',V(0,1.45,.9),V(.38,.34,.42),coat,random));
    pieces.push(ellipsoid(scene,'wolf-muzzle',V(0,1.30,1.27),V(.22,.17,.37),lighter,random));
    pieces.push(ellipsoid(scene,'wolf-nose',V(0,1.36,1.63),V(.17,.11,.11),palette.dark,random));
    pieces.push(branch(scene,V(0,1.1,-.7),V(0,1.5,-1.3),.22,coat,random,.04));
    for(const side of [-1,1]) {
        pieces.push(ellipsoid(scene,'wolf-ear',V(side*.29,1.81,.8),V(.16,.30,.14),coat,random));
        pieces.push(ellipsoid(scene,'wolf-eye',V(side*.29,1.56,1.12),V(.065,.07,.065),[.76,.67,.35],random));
        for(const z of [-.60,.57]) {
            pieces.push(branch(scene,V(side*.32, .98,z),V(side*.32,.12,z+.08),.20,coat,random,.13));
            pieces.push(ellipsoid(scene,'wolf-paw',V(side*.32,.13,z+.15),V(.14,.13,.23),palette.dark,random));
        }
    }
    const mesh=finish(scene,pieces,'wolf');
    mesh.metadata={model:'wolf'};
    return {mesh,legs:[]};
}

export function createRabbitModel(scene, seed = 1) {
    const random = seededRandom(seed);
    const pieces = [
        ellipsoid(scene, 'rabbit-body', V(0, .38, 0), V(.28, .30, .48), [.47,.43,.36], random),
        ellipsoid(scene, 'rabbit-head', V(0, .65, .37), V(.22, .23, .22), [.52,.47,.39], random),
        ellipsoid(scene, 'rabbit-muzzle', V(0, .54, .56), V(.15, .12, .11), [.76,.72,.63], random),
        ellipsoid(scene, 'rabbit-tail', V(0, .44, -.47), V(.16, .17, .14), [.78,.74,.65], random),
        ellipsoid(scene, 'rabbit-nose', V(0, .60, .66), V(.08, .06, .06), palette.dark, random)
    ];
    for (const side of [-1, 1]) {
        const ear = ellipsoid(scene, 'rabbit-ear', V(side*.13, 1, .32), V(.10, .32, .075), [.52,.47,.39], random);
        ear.rotation.z = -side * .12; pieces.push(ear);
        pieces.push(ellipsoid(scene, 'rabbit-eye', V(side*.18, .72, .52), V(.042,.045,.046), palette.dark, random));
        pieces.push(ellipsoid(scene, 'rabbit-paw', V(side*.20, .10, -.17), V(.14,.11,.19), [.39,.35,.29], random));
    }
    const body = finish(scene, pieces, 'rabbit');
    return {mesh: body, legs: []};
}

export function animateRabbit(animal, dt, speed) {
    animal.gait = (animal.gait || 0) + dt * speed * 4.2;
    animal.mesh.scaling.y = 1 + Math.max(0, Math.sin(animal.gait)) * .065;
}

export function createLootModel(scene, itemType = 'wood') {
    if (['fiber', 'herbs', 'berries', 'ironOre'].includes(itemType)) {
        const mesh = itemType === 'ironOre' ? createOreModel(scene, 73) : createPlantModel(scene, 73, {fiber: 'fiber', herbs: 'herb', berries: 'berry'}[itemType]);
        mesh.scaling.setAll(.4); mesh.checkCollisions = false;
        return mesh;
    }
    if (itemType === 'rawMeat' || itemType === 'cookedMeat') {
        const random=seededRandom(73);
        return finish(scene,[ellipsoid(scene,'meat',V(0,.18,0),
            V(.42,.21,.28),itemType==='rawMeat'?[.55,.19,.21]:[.45,.28,.14],random)], itemType+'-pickup');
    }
    if (itemType === 'iron') {
        const random = seededRandom(73);
        return finish(scene, [ellipsoid(scene, 'ingot', V(0,.12,0), V(.35,.14,.20), [.60,.67,.70],random)], 'iron-ingot');
    }
    if (itemType === 'ironTools') {
        const random = seededRandom(73);
        return finish(scene, [branch(scene,V(0,.08,-.32),V(0,.15,.35),.09,palette.barkLight,random,.07),ellipsoid(scene,'iron-axe-head',V(.05,.17,.28),V(.32,.08,.18),[.68,.74,.78],random)], 'iron-tool');
    }
    const random = seededRandom(73), pieces = [];
    if (itemType === 'wood') {
        for (let i = 0; i < 3; i++) pieces.push(branch(scene, V((i - 1) * .16, .14 + (i === 1 ? .12 : 0), -.3), V((i - 1) * .16, .14 + (i === 1 ? .12 : 0), .3), .17, palette.barkLight, random, .17));
        pieces.push(branch(scene, V(-.23, .22, 0), V(.23, .22, 0), .06, palette.cream, random, .06));
    } else if (itemType === 'tools') {
        pieces.push(branch(scene, V(0, .08, -.32), V(0, .15, .35), .09, palette.barkLight, random, .07));
        pieces.push(ellipsoid(scene, 'axe-head', V(.05, .17, .28), V(.28, .09, .17), palette.stone, random));
    } else if (itemType === 'planks') {
        for (let i = 0; i < 3; i++) {
            const board = BABYLON.MeshBuilder.CreateBox('board', {width: .46, height: .07, depth: .75}, scene);
            board.position.set((i % 2) * .06, .06 + i * .08, 0);
            pieces.push(colorMesh(board, palette.barkLight, random));
        }
    } else {
        for (let i = 0; i < 3; i++) pieces.push(ellipsoid(scene, 'stone-chip', V((i - 1) * .17, .12, 0), V(.17, .15, .21), palette.stone, random));
    }
    return finish(scene, pieces, `${itemType}-pickup`);
}

export function createOreModel(scene, seed = 1) {
    const random = seededRandom(seed), pieces = [];
    pieces.push(ellipsoid(scene, 'ore-host', V(0, .55, 0), V(1.1, .85, .9), [.25, .27, .29], random));
    for (let i = 0; i < 7; i++) {
        const angle = i * 2.4, r = .4 + random() * .35;
        const ore = ellipsoid(scene, 'iron-vein', V(Math.cos(angle) * r, .75 + random() * .4, Math.sin(angle) * r), V(.20, .30 + random() * .18, .20), i % 2 ? [.64, .39, .22] : [.57, .65, .70], random);
        ore.rotation.z = (random() - .5) * .8;
        pieces.push(ore);
    }
    const model = finish(scene, pieces, 'iron-deposit');
    model.checkCollisions = true;
    return model;
}

export function createPlantModel(scene, seed = 1, kind = 'fiber') {
    const random = seededRandom(seed), pieces = [];
    const green = kind === 'herb' ? [.30, .48, .32] : [.22, .40, .19];
    const count = kind === 'berry' ? 7 : 5;
    for (let i = 0; i < count; i++) {
        const angle = i * 2.4, r = .12 + random() * .34;
        const height = (kind === 'fiber' ? .9 : .6) + random() * .35;
        const tip = V(Math.cos(angle) * r, height, Math.sin(angle) * r);
        pieces.push(branch(scene, V(0, 0, 0), tip, .045, green, random, .02));
        const leaf = ellipsoid(scene, 'leaf', V(tip.x * 1.2, height * .6, tip.z * 1.2), V(kind === 'fiber' ? .12 : .24, .32, .09), green, random);
        leaf.rotation.z = Math.cos(angle) * .7;
        leaf.rotation.y = angle;
        pieces.push(leaf);
        if (kind === 'herb') {
            for (let petal = 0; petal < 5; petal++) {
                const a = petal / 5 * Math.PI * 2;
                pieces.push(ellipsoid(scene, 'flower', tip.add(V(Math.cos(a) * .09, 0, Math.sin(a) * .09)), V(.07, .035, .07), [.71, .57, .83], random));
            }
            pieces.push(ellipsoid(scene, 'pollen', tip.add(V(0,.025,0)), V(.035,.035,.035), [.91,.73,.28],random));
        } else if (kind === 'berry') {
            pieces.push(ellipsoid(scene, 'berry-leaves', tip, V(.26,.22,.25),green,random));
            for (let b = 0; b < 3; b++) pieces.push(ellipsoid(scene, 'berry', tip.add(V((b - 1) * .12, .1, -.17)), V(.065,.07,.065), [.62,.12,.20],random));
        } else {
            pieces.push(ellipsoid(scene, 'fiber-head', tip, V(.06,.17,.06), [.74,.65,.40],random));
        }
    }
    return finish(scene, pieces, `${kind}-plant`);
}
