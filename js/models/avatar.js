// The explorer seen in third-person and overhead views: a merged body with
// separately pivoting arms and legs so it can walk, swing and carry tools.
import { V, palette, ellipsoid, branch, finish, seededRandom } from './wilderness.js';

export function createAvatarModel(scene) {
    const random = seededRandom(1907);
    const coat = [.24, .36, .3], trousers = [.3, .25, .2], skin = [.78, .6, .46], pack = [.46, .33, .2], boot = [.16, .13, .11];
    const root = new BABYLON.Mesh('player-avatar', scene);
    const body = finish(scene, [
        ellipsoid(scene, 'torso', V(0, 1.32, 0), V(.34, .42, .24), coat, random),
        ellipsoid(scene, 'hips', V(0, .98, 0), V(.3, .18, .22), trousers, random),
        branch(scene, V(0, 1.62, 0), V(0, 1.76, 0), .16, skin, random, .14),
        ellipsoid(scene, 'head', V(0, 1.9, .02), V(.19, .21, .2), skin, random),
        ellipsoid(scene, 'hood', V(0, 1.97, -.05), V(.21, .2, .21), coat, random),
        ellipsoid(scene, 'pack', V(0, 1.36, -.3), V(.26, .32, .17), pack, random),
        ellipsoid(scene, 'bedroll', V(0, 1.74, -.3), V(.3, .1, .11), palette.cream, random)
    ], 'avatar-body');
    body.parent = root;
    const limb = (name, x, y, pieces) => {
        const pivot = new BABYLON.TransformNode(name, scene);
        pivot.parent = root; pivot.position.set(x, y, 0);
        const mesh = finish(scene, pieces, 'avatar-' + name);
        mesh.parent = pivot;
        return pivot;
    };
    const legs = [-1, 1].map(side => limb('leg', side * .15, .98, [
        branch(scene, V(0, 0, 0), V(0, -.5, .02), .2, trousers, random, .15),
        branch(scene, V(0, -.5, .02), V(0, -.9, 0), .15, trousers, random, .13),
        ellipsoid(scene, 'boot', V(0, -.93, .07), V(.11, .08, .2), boot, random)
    ]));
    const arms = [-1, 1].map(side => limb('arm', side * .4, 1.58, [
        branch(scene, V(0, 0, 0), V(side * .04, -.4, .02), .15, coat, random, .12),
        branch(scene, V(side * .04, -.4, .02), V(side * .04, -.72, .1), .11, coat, random, .09),
        ellipsoid(scene, 'hand', V(side * .04, -.78, .12), V(.07, .08, .07), skin, random)
    ]));
    // Where carried things attach: torch in the left hand, tool in the right.
    const hands = arms.map((arm, n) => {
        const hand = new BABYLON.TransformNode('hand', scene);
        hand.parent = arm; hand.position.set((n ? 1 : -1) * .04, -.78, .14);
        return hand;
    });
    for (const mesh of root.getChildMeshes()) { mesh.isPickable = false; mesh.checkCollisions = false; }
    root.isPickable = false;
    return {root, legs, arms, leftHand: hands[0], rightHand: hands[1]};
}
