// World props are drawn as instances of a few shared models. Building a tree
// from scratch takes milliseconds; placing an instance of one takes almost
// nothing and lets the GPU draw every copy in one call. Each kind has a
// handful of variants, and every instance gets its own turn and size, so a
// forest still looks hand-planted.
import { createTreeModel, createRockModel, createOreModel, createPlantModel } from './wilderness.js';

export const VARIANTS = Object.freeze({
    pine: 6, oak: 5, snowpine: 4, bogtree: 4, deadwood: 3,
    rock: 6, ore: 3, fiber: 3, herb: 3, berry: 3, cactus: 3, mushroom: 3
});
const TREES = new Set(['pine', 'oak', 'snowpine', 'bogtree', 'deadwood']);

export class ModelPool {
    constructor(scene) {
        this.scene = scene;
        this.sources = new Map();
        this.spawned = 0;
    }

    // The hidden original that instances of (kind, variant) are drawn from.
    source(kind, variant) {
        const key = kind + ':' + variant;
        if (this.sources.has(key)) return this.sources.get(key);
        const seed = 7919 * (variant + 1) + kind.length * 131;
        const mesh = TREES.has(kind) ? createTreeModel(this.scene, seed, kind)
            : kind === 'rock' ? createRockModel(this.scene, seed)
            : kind === 'ore' ? createOreModel(this.scene, seed)
            : createPlantModel(this.scene, seed, kind);
        // The original itself is never seen, picked or bumped into.
        mesh.metadata = {...mesh.metadata, collides: Boolean(mesh.checkCollisions), pooled: true};
        mesh.isVisible = false;
        mesh.isPickable = false;
        mesh.checkCollisions = false;
        mesh.receiveShadows = true;
        mesh.alwaysSelectAsActiveMesh = false;
        this.sources.set(key, mesh);
        return mesh;
    }

    // A placed copy. `seed` picks the variant and the copy's size.
    spawn(kind, seed) {
        const count = VARIANTS[kind] || 3, whole = Math.abs(Math.floor(seed)) || 0;
        const source = this.source(kind, whole % count);
        const mesh = source.createInstance(`${kind}-${this.spawned++}`);
        mesh.metadata = {model: source.metadata.model};
        mesh.isPickable = true;
        mesh.checkCollisions = source.metadata.collides;
        mesh.scaling.setAll(.88 + ((whole >>> 4) % 100) / 100 * .28);
        // The game removes a gathered node with dispose(false, true), which on
        // a copy would also throw away the material every other copy shares.
        const dispose = mesh.dispose;
        mesh.dispose = function (doNotRecurse) { return dispose.call(this, doNotRecurse, false); };
        return mesh;
    }

    dispose() {
        for (const mesh of this.sources.values()) mesh.dispose(false, true);
        this.sources.clear();
    }
}
