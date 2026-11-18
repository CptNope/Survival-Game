// The explorer seen in third-person and overhead views: a jointed figure in a
// hooded coat with a pack and bedroll. Eleven rigid parts hang from a small
// skeleton of plain transform nodes (hips, waist, neck, shoulders, elbows,
// hands, hip joints, knees) and share one material. js/avatar.js says how the
// joints move.
import { AVATAR } from '../avatar.js';
import { V, ellipsoid, seededRandom } from './wilderness.js';

const COAT = [.2, .37, .28], COAT_DARK = [.14, .27, .21], TROUSERS = [.33, .27, .21], SKIN = [.82, .63, .48];
const HAIR = [.3, .2, .12], SKIN_SHADE = [.74, .55, .41];
const BOOT = [.17, .13, .1], LEATHER = [.45, .31, .18], LEATHER_DARK = [.27, .18, .11], ROLL = [.78, .7, .52], EYE = [.1, .08, .07];

let outward = 0; // Which winding the engine treats as facing out; measured once from one of its own boxes.

function signedVolume(positions, indices) {
    let volume = 0;
    for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
        volume += positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1])
            - positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c])
            + positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c]);
    }
    return volume;
}

// A faceted solid drawn through a stack of cross-sections. Each ring is
// [y, half width, half depth, z offset, x offset]. Four sides make a box
// section; more make a rounded one with a flat face to the front.
function loft(scene, rings, color, random, sides = 6, caps = '') {
    const positions = [], indices = [], ends = [];
    for (const [y, rx, rz, cz = 0, cx = 0] of rings) {
        for (let i = 0; i < sides; i++) {
            if (sides === 4) positions.push(cx + (i === 0 || i === 3 ? rx : -rx), y, cz + (i < 2 ? rz : -rz));
            else { const angle = (i + .5) / sides * Math.PI * 2; positions.push(cx + Math.sin(angle) * rx, y, cz + Math.cos(angle) * rz); }
        }
    }
    for (let ring = 0; ring < rings.length - 1; ring++) {
        for (let i = 0; i < sides; i++) {
            const a = ring * sides + i, b = ring * sides + (i + 1) % sides;
            indices.push(a, b, b + sides, a, b + sides, a + sides);
        }
    }
    // An end is closed with a fan round its centre, but only where it can be
    // seen: `caps` names them, 'a' for the first ring and 'b' for the last.
    // Most ends are buried in the next part along.
    for (const end of [0, rings.length - 1]) {
        const [y, , , cz = 0, cx = 0] = rings[end], centre = positions.length / 3, fan = [];
        positions.push(cx, y, cz);
        for (let i = 0; i < sides; i++) {
            const a = end * sides + i, b = end * sides + (i + 1) % sides;
            if (end) fan.push(centre, b, a); else fan.push(centre, a, b);
        }
        ends.push(fan);
    }
    if (!outward) {
        const box = BABYLON.MeshBuilder.CreateBox('winding-probe', {size: 1}, scene);
        outward = Math.sign(signedVolume(box.getVerticesData(BABYLON.VertexBuffer.PositionKind), box.getIndices())) || 1;
        box.dispose();
    }
    // Decide which way is out while the shape is still closed, then drop the hidden ends.
    const flip = Math.sign(signedVolume(positions, [...indices, ...ends[0], ...ends[1]])) !== outward;
    if (caps.includes('a')) indices.push(...ends[0]);
    if (caps.includes('b')) indices.push(...ends[1]);
    if (flip) for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
    const mesh = new BABYLON.Mesh('avatar-piece', scene), normals = [];
    BABYLON.VertexData.ComputeNormals(positions, indices, normals);
    const data = new BABYLON.VertexData();
    data.positions = positions; data.indices = indices; data.normals = normals;
    data.applyToMesh(mesh);
    return paint(mesh, color, random);
}

// Flat facets, each a hair lighter or darker so the form reads without looking patchy.
function paint(mesh, color, random) {
    mesh.convertToFlatShadedMesh();
    const colors = [];
    for (let i = 0; i < mesh.getTotalVertices(); i += 3) {
        const shade = .95 + random() * .1;
        for (let j = 0; j < 3; j++) colors.push(color[0] * shade, color[1] * shade, color[2] * shade, 1);
    }
    mesh.setVerticesData(BABYLON.VertexBuffer.ColorKind, colors);
    return mesh;
}

export function createAvatarModel(scene) {
    const random = seededRandom(1907), A = AVATAR;
    const material = new BABYLON.StandardMaterial('avatar-mat', scene);
    material.diffuseColor = BABYLON.Color3.White();
    material.specularColor = BABYLON.Color3.Black();
    const root = new BABYLON.Mesh('player-avatar', scene);
    const parts = [];
    const joint = (name, parent, x, y, z = 0) => {
        const node = new BABYLON.TransformNode('avatar-' + name, scene);
        node.parent = parent; node.position.set(x, y, z);
        return node;
    };
    // Merge a joint's pieces into one mesh drawn with the shared material.
    const part = (name, parent, pieces) => {
        const mesh = BABYLON.Mesh.MergeMeshes(pieces, true, true);
        mesh.name = 'avatar-' + name;
        mesh.material = material;
        mesh.parent = parent;
        mesh.metadata = {model: 'avatar'};
        mesh.isPickable = false; mesh.checkCollisions = false;
        parts.push(mesh);
        return mesh;
    };
    const L = (rings, color, sides, caps) => loft(scene, rings, color, random, sides, caps);
    // The same, laid on its side across the body at a given height and depth.
    const across = (rings, color, y, z, caps = '') => {
        const mesh = L(rings, color, 8, caps);
        mesh.rotation.z = -Math.PI / 2;
        mesh.position.set(0, y, z);
        return mesh;
    };
    // A small faceted bead, for eyes and buckles. Painted like everything else.
    const bead = (position, size, color) => ellipsoid(scene, 'bead', position, size, color, random);

    const rig = joint('rig', root, 0, 0);
    rig.scaling.setAll(A.scale);

    // --- Hips: the coat's skirt and belt over the top of the trousers -------
    const hips = joint('hips', rig, 0, A.hips);
    part('pelvis', hips, [
        L([[-.15, .15, .115], [-.05, .2, .14], [.06, .2, .14]], TROUSERS, 8, 'a'),
        L([[-.1, .238, .168], [.04, .222, .152], [.13, .208, .142]], COAT, 8, 'a'),
        L([[.06, .226, .156], [.12, .22, .152]], LEATHER_DARK, 8),
        bead(V(0, .09, .156), V(.03, .028, .012), ROLL)
    ]);

    // --- Chest, with the pack strapped on -------------------------------------
    const torso = joint('torso', hips, 0, A.spine);
    part('torso', torso, [
        L([[-.02, .205, .14], [.12, .215, .15], [.27, .24, .165], [.38, .245, .155], [.45, .19, .125], [.49, .1, .09]], COAT, 8),
        // A short mantle over the shoulders hides the tops of the arms.
        L([[.34, .275, .176], [.42, .22, .15], [.5, .12, .105]], COAT_DARK, 8, 'a'),
        // Pack, its pocket, and the straps over the chest.
        L([[.0, .15, .085, -.2], [.08, .178, .105, -.225], [.3, .172, .1, -.225], [.39, .14, .08, -.205]], LEATHER, 8, 'ab'),
        L([[.06, .11, .03, -.335], [.2, .11, .03, -.33]], LEATHER_DARK, 4, 'ab'),
        L([[.3, .176, .104, -.225], [.34, .168, .098, -.22]], LEATHER_DARK, 8),
        ...[-1, 1].map(side => L([[.02, .024, .012, .152, side * .135], [.27, .024, .012, .172, side * .135], [.4, .024, .012, .158, side * .135]], LEATHER_DARK, 4)),
        // Bedroll across the top of the pack, held by two bands.
        across([[-.21, .072, .072], [.21, .072, .072]], ROLL, .435, -.235, 'ab'),
        ...[-.12, .12].map(x => across([[x - .018, .081, .081], [x + .018, .081, .081]], LEATHER_DARK, .435, -.235, 'ab'))
    ]);

    // --- Head and hood ----------------------------------------------------------
    const head = joint('head', torso, 0, A.neck);
    part('head', head, [
        L([[-.04, .062, .062], [.07, .058, .06]], SKIN, 6),
        L([[.045, .07, .08, .016], [.1, .098, .108, .016], [.2, .112, .118, .012], [.28, .104, .112, .004]], SKIN, 8, 'a'),
        // The hood sits back from the face and its brim comes forward over the brow.
        L([[-.01, .125, .105, -.05], [.1, .143, .128, -.04], [.2, .15, .14, -.03], [.275, .142, .15, -.004], [.33, .11, .122, -.03], [.39, .04, .05, -.085]], COAT, 8, 'ab'),
        // Hair under the brim, a nose, and eyes.
        L([[.235, .1, .012, .122], [.275, .104, .012, .122]], HAIR, 4, 'a'),
        L([[.13, .017, .016, .133], [.2, .011, .008, .128]], SKIN_SHADE, 4, 'a'),
        ...[-1, 1].map(side => bead(V(side * .05, .2, .129), V(.015, .014, .007), EYE))
    ]);

    // --- Arms ----------------------------------------------------------------------
    const arms = [-1, 1].map(side => {
        const shoulder = joint('shoulder', torso, side * A.shoulderWidth, A.shoulderHeight);
        part('upper-arm', shoulder, [L([[.04, .05, .05], [0, .074, .074], [-.15, .07, .07], [-A.upperArm, .062, .062]], COAT, 6, 'a')]);
        const elbow = joint('elbow', shoulder, 0, -A.upperArm);
        part('forearm', elbow, [
            L([[.012, .062, .062], [-.12, .06, .06], [-.23, .05, .05]], COAT, 6, 'a'),
            L([[-.19, .059, .059], [-.245, .056, .056]], COAT_DARK, 6, 'b'),
            L([[-.24, .038, .048], [-.31, .048, .06], [-.385, .032, .044]], SKIN, 6, 'b')
        ]);
        // Whatever is carried hangs here; its tilt is set by the pose.
        const hand = joint('hand', elbow, 0, -A.forearm, .012);
        return {shoulder, elbow, hand, side};
    });

    // --- Legs -----------------------------------------------------------------------
    const legs = [-1, 1].map(side => {
        const hip = joint('hip', hips, side * A.hipWidth, -.02);
        hip.rotation.z = side * .03; // A natural stance: feet a little apart.
        part('thigh', hip, [L([[.04, .09, .095], [0, .104, .11], [-.2, .092, .098], [-A.thigh, .074, .078]], TROUSERS, 6, 'a')]);
        const knee = joint('knee', hip, 0, -A.thigh);
        const sole = -A.shin;
        part('shin', knee, [
            L([[.012, .074, .078], [-.14, .07, .077], [-.26, .056, .06]], TROUSERS, 6, 'a'),
            L([[-.19, .075, .079], [-.235, .072, .076]], LEATHER, 6, 'a'),
            L([[-.21, .068, .072], [-.32, .064, .068], [sole + .07, .062, .07]], BOOT, 6),
            // The foot: a wedge with the toe forward.
            L([[sole, .068, .135, .05], [sole + .065, .064, .125, .045], [sole + .11, .055, .07, .004]], BOOT, 4, 'ab')
        ]);
        return {hip, knee, side};
    });

    root.isPickable = false;
    return {root, rig, hips, torso, head, arms, legs, leftHand: arms[0].hand, rightHand: arms[1].hand, parts, material};
}
