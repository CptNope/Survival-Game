import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainSystem } from '../js/components/terrain.js';
import { AnimalSystem } from '../js/components/animals.js';
import { InventorySystem } from '../js/components/inventory.js';
import { seededRandom } from '../js/models/wilderness.js';

test('procedural hills are deterministic and the flat spawn area blends into terrain', () => {
    const world = Object.create(TerrainSystem.prototype);
    Object.assign(world, {spawnPosition: {x: 0, z: 0}, spawnHeight: 2, spawnAreaRadius: 10, waterHeight: 1});
    assert.equal(world.getPerlinHeight(0, 0), 2);
    assert.equal(world.getPerlinHeight(9.9, 0), 2);
    assert.ok(Math.abs(world.getPerlinHeight(10.001, 0) - world.getPerlinHeight(9.999, 0)) < .01);
    const h = world.getPerlinHeight(67, 39);
    assert.equal(world.getPerlinHeight(67, 39), h);
    assert.ok(Number.isFinite(h));
});

test('seeded resource placement stays repeatable when chunks are visited again', () => {
    const seed = (Math.imul(-2, 73856093) ^ Math.imul(4, 19349663) ^ 0x4b1d) | 0;
    const seq = () => Array.from({length: 20}, seededRandom(seed));
    assert.deepEqual(seq(), seq());
});

test('chunk queue deduplicates generation and skips stale out-of-range tiles', () => {
    const world = Object.create(TerrainSystem.prototype);
    const built = [];
    Object.assign(world, {
        chunkMap: new Map(), pendingChunks: [], pendingChunkKeys: new Set(),
        currentChunkX: 0, currentChunkZ: 0, renderDistance: 2
    });
    world.generateChunk = (x, z) => { built.push([x, z]); world.chunkMap.set(`${x},${z}`, {}); };
    world.queueChunk(2, 1);
    world.queueChunk(2, 1);
    assert.equal(world.pendingChunks.length, 1);
    world.processChunkQueue();
    world.processChunkQueue();
    assert.deepEqual(built, [[2, 1]]);
    world.queueChunk(2, 2);
    world.currentChunkX = 7;
    world.processChunkQueue();
    assert.deepEqual(built, [[2, 1]]);
});

test('nearby wildlife spawns immediately at safe terrain positions', () => {
    const animals = Object.create(AnimalSystem.prototype);
    const positions = [];
    animals.game = {
        playerSystem: {camera: {position: {x: 0, z: 0}}},
        terrainSystem: {isWaterArea: () => false, getPerlinHeight: () => 2}
    };
    animals.spawnAnimal = (x, y, z) => positions.push([x, y, z]);
    animals.seedNearbyAnimals();
    assert.equal(positions.length, 6);
    assert.ok(positions.every(([x, y, z]) => Math.hypot(x, z) >= 26 && y === 2));
});

test('harvested resource IDs stay depleted if a terrain chunk unloads', () => {
    const mesh = {dispose() {}};
    const world = {harvestedIds: new Set()};
    const game = {
        paused: false, playerSystem: {isDead: false},
        terrainSystem: world,
        uiSystem: {showNotification() {}, updateInventoryUI() {}},
        pickTarget: () => ({hit: true, pickedMesh: mesh})
    };
    const inventory = new InventorySystem(game);
    game.inventorySystem = inventory;
    inventory.harvestableObjects.push({mesh, type: 'tree', resourceId: '0,0:tree:4'});
    inventory.tryHarvest();
    assert.equal(inventory.inventory.wood, 2);
    assert.equal(world.harvestedIds.has('0,0:tree:4'), true);
});
