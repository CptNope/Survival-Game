// Deterministic landmarks, zero-extra-draw-call dirt trails and discovery rewards.
// Intentionally independent of external assets, save data, and physics middleware.
import { seededRandom } from '../models/wilderness.js';

export const SITE_SPACING = 96;
export const STARTER_SITES = Object.freeze([
    { id: 'first-camp', type: 'camp', name: 'Ember Camp', x: 43, z: 13 },
    { id: 'ridge-ruin', type: 'ruin', name: 'Old Watch Post', x: -57, z: 41 },
    { id: 'southern-shelter', type: 'shelter', name: 'Trapper Shelter', x: 26, z: -71 }
]);

const SITE_TYPES = ['camp', 'ruin', 'shelter', 'circle'];
const REWARDS = {
    camp: {wood: 3, berries: 3},
    ruin: {stone: 4, ironOre: 2},
    shelter: {fiber: 3, herbs: 2},
    circle: {herbs: 3, ironOre: 1}
};

export function landmarkForCell(cx, cz) {
    // The hand-placed starter sites are the teaching route; leave the center
    // grid clear of unrelated procedural settlements.
    if (Math.abs(cx) + Math.abs(cz) <= 1) return null;
    const seed = (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663) ^ 0x739b) | 0;
    const random = seededRandom(seed);
    const type = SITE_TYPES[Math.floor(random() * SITE_TYPES.length)];
    let x = cx * SITE_SPACING + SITE_SPACING / 2 + (random() - .5) * 32;
    let z = cz * SITE_SPACING + SITE_SPACING / 2 + (random() - .5) * 32;
    // Landmark positions must be on dry ground, even in the large lakes.
    // Deterministic fallback moves within the same cell or abandons an
    // unusable site rather than placing its roof underwater.
    let foundDry = false;
    for (let attempt = 0; attempt < 8; attempt++) {
        if (Math.sin(x * .005) * Math.cos(z * .005) <= .7) {
            foundDry = true;
            break;
        }
        x = cx * SITE_SPACING + 14 + random() * 68;
        z = cz * SITE_SPACING + 14 + random() * 68;
    }
    if (!foundDry) return null;
    return {
        id: 'site:' + cx + ':' + cz, type,
        name: {camp: 'Trail Camp', ruin: 'Forgotten Ruins', shelter: 'Hunter Hide', circle: 'Standing Stones'}[type],
        x, z
    };
}

export function landmarksNear(x, z, radius = 150) {
    const result = STARTER_SITES.filter(site => Math.hypot(site.x - x, site.z - z) <= radius);
    const range = Math.ceil(radius / SITE_SPACING) + 1;
    const centerX = Math.floor(x / SITE_SPACING), centerZ = Math.floor(z / SITE_SPACING);
    for (let cx = centerX - range; cx <= centerX + range; cx++) {
        for (let cz = centerZ - range; cz <= centerZ + range; cz++) {
            const site = landmarkForCell(cx, cz);
            if (site && Math.hypot(site.x - x, site.z - z) <= radius) result.push(site);
        }
    }
    return result;
}

export function distanceToSegment(x, z, a, b) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = dx * dx + dz * dz;
    const t = len ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len)) : 0;
    return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
}

export function isTrailAt(x, z) {
    // Two networks of narrow trails intersect every 96 world units.
    const gridX = (Math.round(x / SITE_SPACING - .5) + .5) * SITE_SPACING;
    const gridZ = (Math.round(z / SITE_SPACING - .5) + .5) * SITE_SPACING;
    if (Math.abs(x - gridX) < 1.55 || Math.abs(z - gridZ) < 1.55) return true;

    for (const site of STARTER_SITES) {
        if (distanceToSegment(x, z, {x: 0, z: 0}, site) < 1.65) return true;
    }

    // Spur trails lead from each remote location to its nearest grid trail.
    // Local cell lookup avoids iterating the whole infinite world.
    const cellX = Math.floor(x / SITE_SPACING), cellZ = Math.floor(z / SITE_SPACING);
    for (let cx = cellX - 1; cx <= cellX + 1; cx++) {
        for (let cz = cellZ - 1; cz <= cellZ + 1; cz++) {
            const site = landmarkForCell(cx, cz);
            if (!site) continue;
            const junction = {x: (cx + .5) * SITE_SPACING, z: site.z};
            if (distanceToSegment(x, z, site, junction) < 1.65) return true;
        }
    }
    return false;
}

function createLandmarkMesh(scene, site, terrain, material) {
    const parts = [];
    const colors = {
        wood: [.33, .23, .14], dark: [.19, .17, .13], linen: [.56, .49, .35],
        stone: [.41, .43, .40], moss: [.29, .39, .25],
        ember: [.92, .38, .12], treasure: [.78, .65, .33]
    };
    function paint(mesh, color) {
        const rgba = colors[color];
        const vertexColors = new Float32Array(mesh.getTotalVertices() * 4);
        for (let i = 0; i < vertexColors.length; i += 4) {
            vertexColors[i] = rgba[0]; vertexColors[i+1] = rgba[1];
            vertexColors[i+2] = rgba[2]; vertexColors[i+3] = 1;
        }
        mesh.setVerticesData(BABYLON.VertexBuffer.ColorKind, vertexColors);
        parts.push(mesh);
    }
    function box(name, x, y, z, w, h, d, color, rotate = 0) {
        const mesh = BABYLON.MeshBuilder.CreateBox(name, {width: w, height: h, depth: d}, scene);
        mesh.position.set(x, y, z); mesh.rotation.y = rotate;
        paint(mesh, color);
    }
    function pillar(name, x, y, z, h, dia, color) {
        const mesh = BABYLON.MeshBuilder.CreateCylinder(name, {
            height: h, diameter: dia, tessellation: 6
        }, scene);
        mesh.position.set(x, y, z); paint(mesh, color);
    }
    function stone(x, y, z, size, color) {
        const mesh = BABYLON.MeshBuilder.CreateIcoSphere('landmark-stone', {
            radius: size, subdivisions: 1, flat: true
        }, scene);
        mesh.position.set(x, y, z); mesh.scaling.y = 0.65;
        paint(mesh, color);
    }

    if (site.type === 'camp') {
        // A small triangular tent, stacked logs and a fire circle.
        box('tent-front', -.9, .9, .1, .12, 1.8, 2.4, 'linen', -.52);
        box('tent-back', .25, .9, .1, .12, 1.8, 2.4, 'linen', .52);
        box('tent-floor', -.32, .10, .1, 2.1, .15, 2.2, 'wood');
        for (let i = 0; i < 6; i++) {
            const angle = i * Math.PI / 3;
            stone(2.3 + Math.cos(angle) * .7, .18, .3 + Math.sin(angle) * .7, .34, 'stone');
        }
        pillar('fire', 2.3, .40, .3, .70, .42, 'ember');
        box('supply-crate', -1.8, .33, -2.3, 1, .65, .9, 'wood', .2);
    } else if (site.type === 'ruin') {
        // Collapsed lookout arch, pillar stumps and stone rubble.
        box('ruined-wall', 0, 1.4, 2.2, 6, 2.8, .65, 'stone');
        box('broken-gate-left', -1.7, 2, -.6, .85, 4, 1, 'stone');
        box('broken-gate-right', 1.7, 1.2, -.6, .85, 2.4, 1, 'stone');
        box('gate-lintel', -.20, 3.6, -.6, 4, .5, 1, 'stone', -.06);
        for (let i = 0; i < 5; i++) stone(-2 + i * 1.1, .3, -2.5, .45 + i % 2 * .25, 'moss');
        box('relic', 0, .28, .1, .72, .55, .72, 'treasure');
    } else if (site.type === 'shelter') {
        // A simple lean-to for recovering supplies.
        pillar('post-left', -2, 1.5, 1.5, 3, .3, 'wood');
        pillar('post-right', 2, 1.5, 1.5, 3, .3, 'wood');
        box('roof', 0, 2.9, -.1, 4.8, .2, 4, 'dark', -.12);
        box('back-wall', 0, 1.5, -1.85, 4.6, 3, .28, 'wood');
        box('supply-chest', 0, .44, .75, 1.55, .85, .85, 'treasure');
        for (let i = 0; i < 3; i++) box('stacked-log', -2.7, .16 + i * .24, -1, .33, .28, 2.2, 'wood');
    } else {
        // Mysterious but nonmagical standing stones with a centerpiece.
        for (let i = 0; i < 6; i++) {
            const angle = i * Math.PI / 3;
            pillar('standing-stone', Math.cos(angle) * 3, 1.15, Math.sin(angle) * 3, 2.3, .75, 'stone');
        }
        pillar('central-plinth', 0, .52, 0, 1, 1.65, 'moss');
        stone(0, 1.2, 0, .58, 'treasure');
    }

    const model = BABYLON.Mesh.MergeMeshes(parts, true, true);
    if (!model) return null;
    model.name = 'landmark:' + site.id;
    model.position.set(site.x, terrain.getPerlinHeight(site.x, site.z), site.z);
    model.material = material;
    model.checkCollisions = true;
    model.isPickable = false;
    model.receiveShadows = false;
    model.metadata = {landmark: site.id};
    return model;
}

export class ExplorationSystem {
    constructor(game) {
        this.game = game;
        this.terrain = null;
        this.discovered = new Set();
        this.lastUpdate = 0;
        this.nearest = null;
    }

    attachWorld(terrain) {
        this.terrain = terrain;
        this.material = new BABYLON.StandardMaterial('landmark-vertex-colors', this.game.scene);
        this.material.diffuseColor = BABYLON.Color3.White();
        this.material.specularColor = BABYLON.Color3.Black();
        for (const [key, chunk] of terrain.chunkMap) {
            const [x, z] = key.split(',').map(Number);
            this.populateChunk(x, z, chunk);
        }
    }

    isTrail(x, z) { return isTrailAt(x, z); }

    isClearing(x, z) {
        return landmarksNear(x, z, 16).some(site =>
            Math.hypot(site.x - x, site.z - z) < 8) || isTrailAt(x, z);
    }

    populateChunk(cx, cz, chunk) {
        chunk.landmarks = [];
        const size = this.terrain.chunkSize;
        for (const site of landmarksNear(cx * size, cz * size, size * .75)) {
            const siteChunkX = Math.floor((site.x + size / 2) / size);
            const siteChunkZ = Math.floor((site.z + size / 2) / size);
            if (siteChunkX !== cx || siteChunkZ !== cz) continue;
            const mesh = createLandmarkMesh(this.game.scene, site, this.terrain, this.material);
            if (mesh) chunk.landmarks.push(mesh);
        }
    }

    disposeChunk(chunk) {
        for (const mesh of chunk.landmarks || []) mesh.dispose(false, false);
        chunk.landmarks = [];
    }

    update() {
        if (this.game.paused || this.game.playerSystem.isDead) return;
        const now = performance.now();
        if (now - this.lastUpdate < 250) return;
        this.lastUpdate = now;
        const position = this.game.playerSystem.camera.position;
        const candidates = landmarksNear(position.x, position.z, 165);
        let nearest = null, closest = Infinity;
        for (const site of candidates) {
            const distance = Math.hypot(site.x - position.x, site.z - position.z);
            if (distance < 8 && !this.discovered.has(site.id)) this.discover(site);
            if (!this.discovered.has(site.id) && distance < closest) {
                nearest = site; closest = distance;
            }
        }
        this.nearest = nearest ? { ...nearest, distance: closest } : null;
        this.game.uiSystem?.updateExplorationUI?.(this.nearest, this.discovered.size);
    }

    discover(site) {
        if (this.discovered.has(site.id)) return false;
        this.discovered.add(site.id);
        const inventory = this.game.inventorySystem.inventory;
        const reward = REWARDS[site.type];
        for (const [item, amount] of Object.entries(reward)) inventory[item] += amount;
        this.game.uiSystem?.updateInventoryUI?.();
        this.game.uiSystem?.showNotification?.('Discovered ' + site.name + ' · Supplies recovered!');
        this.game.saveSystem?.save();
        return true;
    }
}
