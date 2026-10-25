// Terrain generation and management system
import { seededRandom } from '../models/wilderness.js';
import { createTreeModel, createRockModel, createOreModel, createPlantModel } from '../models/wilderness.js';

export class TerrainSystem {
    constructor(game) {
        this.game = game;
        this.scene = game.scene;

        // Terrain generation properties
        this.chunkSize = 32;
        this.chunkHeight = 5; // Reduced height for flatter terrain
        this.renderDistance = 2;
        this.terrainScale = 0.015; // Reduced scale for smoother, flatter terrain
        this.chunkMap = new Map();
        this.currentChunkX = 0;
        this.currentChunkZ = 0;

        // Player spawn parameters
        this.spawnPosition = { x: 0, y: 0, z: 0 };
        this.spawnAreaRadius = 10; // Clear area radius around spawn point

        // Water parameters
        this.waterHeight = 1.0; // Height of water surface
        this.waterMeshes = []; // Store water meshes for updates
        this.harvestedIds = new Set(); // Resource depletion persists when revisiting a chunk.
        this.setupSharedMaterials();

        // Initialize noise generator
        // Perlin/Simplex noise is a procedural texture generation algorithm used to create natural-looking patterns
        // It's commonly used in game development for terrain generation, clouds, and other organic features
        // World height and vegetation derive from stable world coordinates.

        // Initialize terrain
        this.generateInitialChunks();
    }

    setupSharedMaterials() {
        // One texture/material for the whole world rather than dozens of
        // identical downloads, GPU textures and shader compilations.
        this.terrainMaterial = new BABYLON.StandardMaterial('terrain-grass', this.scene);
        const grass = new BABYLON.Texture('https://assets.babylonjs.com/textures/grass.png', this.scene);
        grass.uScale = grass.vScale = 6;
        this.terrainMaterial.diffuseTexture = grass;
        this.terrainMaterial.specularColor = BABYLON.Color3.Black();

        this.waterMaterial = new BABYLON.StandardMaterial('world-water', this.scene);
        this.waterMaterial.diffuseColor = new BABYLON.Color3(.13, .36, .56);
        this.waterMaterial.alpha = .73;
        this.waterMaterial.specularColor = new BABYLON.Color3(.10, .13, .13);
        this.waterMaterial.backFaceCulling = false;

        this.grassMaterial = new BABYLON.StandardMaterial('groundcover', this.scene);
        this.grassMaterial.diffuseColor = BABYLON.Color3.White();
        this.grassMaterial.specularColor = BABYLON.Color3.Black();
        this.grassMaterial.backFaceCulling = false;
    }

    generateInitialChunks() {
        // Create a flat spawn area first
        this.createFlatSpawnArea();

        // Generate chunks around the player
        for (let x = -this.renderDistance; x <= this.renderDistance; x++) {
            for (let z = -this.renderDistance; z <= this.renderDistance; z++) {
                const chunkX = this.currentChunkX + x;
                const chunkZ = this.currentChunkZ + z;
                this.generateChunk(chunkX, chunkZ);
            }
        }
    }

    // Create a flat area for player spawning
    createFlatSpawnArea() {
        // Set spawn position at origin (0,0,0) or another desired location
        this.spawnPosition = { x: 0, z: 0 };

        // Calculate the terrain height at spawn position for consistency
        const baseHeight = 2; // Consistent flat height for spawn area
        this.spawnPosition.y = baseHeight;

        // Store the spawn height for later use
        this.spawnHeight = baseHeight;

        console.log(`Created flat spawn area at (${this.spawnPosition.x}, ${this.spawnPosition.y}, ${this.spawnPosition.z}) with radius ${this.spawnAreaRadius}`);
    }

    // Generate a terrain chunk at the specified coordinates
    generateChunk(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;

        // Skip if this chunk already exists
        if (this.chunkMap.has(key)) {
            return;
        }

        // Create a simple ground mesh for this chunk
        const ground = BABYLON.MeshBuilder.CreateGround(
            `terrain_${chunkX}_${chunkZ}`,
            {
                width: this.chunkSize,
                height: this.chunkSize,
                subdivisions: 20,
                updatable: true
            },
            this.game.scene
        );

        // Position the chunk correctly in world space
        ground.position.x = chunkX * this.chunkSize;
        ground.position.z = chunkZ * this.chunkSize;

        // Apply custom height modifications
        this.applyHeightMap(ground);

        // Apply materials and textures
        this.applyTerrainMaterial(ground);

        // Add collision detection
        ground.checkCollisions = true;
        ground.receiveShadows = true;

        // Store in chunk map
        this.chunkMap.set(key, { mesh: ground });

        // Populate with trees and rocks
        const before = this.game.inventorySystem.harvestableObjects.length;
        const waterBefore = this.waterMeshes.length;
        this.populateChunk(chunkX, chunkZ);
        const chunk = this.chunkMap.get(key);
        chunk.objects = this.game.inventorySystem.harvestableObjects.slice(before);
        chunk.water = this.waterMeshes.slice(waterBefore);
        chunk.groundCover = this.createGroundCover(chunkX, chunkZ);
    }

    // Apply height modifications to the terrain using our height function
    applyHeightMap(mesh) {
        // Get mesh data
        const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        const indices = mesh.getIndices();
        const normals = mesh.getVerticesData(BABYLON.VertexBuffer.NormalKind);

        if (!positions) {
            console.error('No position data found for mesh');
            return;
        }

        // Apply height function to each vertex
        for (let i = 0; i < positions.length; i += 3) {
            // Get the world position of this vertex
            const x = positions[i] + mesh.position.x;
            const z = positions[i + 2] + mesh.position.z;

            // Set the height based on our height function
            positions[i + 1] = this.getPerlinHeight(x, z);
        }

        // Update the mesh with the new heights
        mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind, positions);

        // Recompute normals for proper lighting
        BABYLON.VertexData.ComputeNormals(positions, indices, normals);
        mesh.updateVerticesData(BABYLON.VertexBuffer.NormalKind, normals);

        console.log(`Applied height map to terrain chunk at (${mesh.position.x}, ${mesh.position.z})`);
    }

    // Use the one shared material: disposing a chunk must not dispose this.
    applyTerrainMaterial(mesh) { mesh.material = this.terrainMaterial; }

    // Get height at a specific world position using Perlin noise
    // Perlin noise is a procedural generation algorithm that creates natural-looking random patterns
    // It's widely used in game development for terrain generation, as it creates smooth, continuous variations
    getPerlinHeight(x, z) {
        const dx = x - this.spawnPosition.x, dz = z - this.spawnPosition.z;
        const distance = Math.hypot(dx, dz);
        // Rolling hills with small-scale variation, deterministic on every visit.
        const hills = 2.1 + Math.sin(x * .022) * 1.35
            + Math.cos(z * .018) * 1.05
            + Math.sin((x + z) * .012) * .7
            + Math.sin((x - z) * .054) * .23;
        const height = this.isWaterArea(x, z) ? this.waterHeight - .55 : hills;
        // Blend rather than snap between a flat spawn clearing and hillside.
        const t = Math.max(0, Math.min(1, (distance - this.spawnAreaRadius) / 10));
        const blend = t * t * (3 - 2 * t);
        return this.spawnHeight + (height - this.spawnHeight) * blend;
    }

    // Check if a position should be water
    isWaterArea(x, z) {
        // Create large water bodies using a different noise pattern
        const waterNoise = Math.sin(x * 0.005) * Math.cos(z * 0.005);

        // Water in low-lying areas and certain noise patterns
        return waterNoise > 0.7;
    }

    // Check if we need to update chunks based on player position
    checkChunkUpdates() {
        const currentChunkX = Math.floor(this.game.playerSystem.camera.position.x / this.chunkSize);
        const currentChunkZ = Math.floor(this.game.playerSystem.camera.position.z / this.chunkSize);

        if (currentChunkX !== this.currentChunkX || currentChunkZ !== this.currentChunkZ) {
            this.currentChunkX = currentChunkX;
            this.currentChunkZ = currentChunkZ;
            this.updateChunks();
        }
    }

    // Update chunks as player moves
    updateChunks() {
        // Remove chunks that are too far away
        for (const [key, chunk] of this.chunkMap.entries()) {
            const [chunkX, chunkZ] = key.split(',').map(Number);

            const distance = Math.max(
                Math.abs(chunkX - this.currentChunkX),
                Math.abs(chunkZ - this.currentChunkZ)
            );

            if (distance > this.renderDistance) {
                // Remove this chunk
                for (const obj of chunk.objects) {
                    obj.mesh.dispose(false, true);
                    for (const mesh of obj.relatedMeshes || []) mesh.dispose(false, true);
                }
                this.game.inventorySystem.harvestableObjects = this.game.inventorySystem.harvestableObjects.filter(obj => !chunk.objects.includes(obj));
                for (const water of chunk.water) water.dispose(false, false);
                chunk.groundCover?.dispose(false, false);
                this.waterMeshes = this.waterMeshes.filter(mesh => !chunk.water.includes(mesh));
                chunk.mesh.dispose(false, false);
                this.chunkMap.delete(key);
            }
        }

        // Generate new chunks that are now in range
        for (let x = -this.renderDistance; x <= this.renderDistance; x++) {
            for (let z = -this.renderDistance; z <= this.renderDistance; z++) {
                const chunkX = this.currentChunkX + x;
                const chunkZ = this.currentChunkZ + z;
                this.generateChunk(chunkX, chunkZ);
            }
        }
    }

    // Populate a chunk with trees, rocks, water, and other objects
    populateChunk(chunkX, chunkZ) {
        const random = seededRandom((Math.imul(chunkX, 73856093) ^ Math.imul(chunkZ, 19349663) ^ 0x4b1d) | 0);
        const key = `${chunkX},${chunkZ}`;
        // Calculate world position of chunk
        const worldX = chunkX * this.chunkSize - this.chunkSize / 2;
        const worldZ = chunkZ * this.chunkSize - this.chunkSize / 2;

        // Check if this chunk should have water
        let hasWater = false;
        for (let x = worldX; x < worldX + this.chunkSize; x += this.chunkSize / 4) {
            for (let z = worldZ; z < worldZ + this.chunkSize; z += this.chunkSize / 4) {
                if (this.isWaterArea(x, z)) {
                    hasWater = true;
                    break;
                }
            }
            if (hasWater) break;
        }

        // Create water if needed
        if (hasWater) {
            this.createWater(worldX, worldZ);
        }

        // Add trees - REDUCED NUMBER significantly
        const numTrees = 6 + Math.floor(random() * 3); // Denser but still bounded.
        for (let i = 0; i < numTrees; i++) {
            // Random position within chunk
            const x = worldX + random() * this.chunkSize;
            const z = worldZ + random() * this.chunkSize;

            // Skip if in spawn area or water area
            if (this.isWithinSpawnArea(x, z) || this.isWaterArea(x, z)) {
                continue;
            }

            const y = this.getPerlinHeight(x, z);
            this.createTree(x, y, z, `${key}:tree:${i}`);
        }

        // Add rocks - REDUCED NUMBER significantly
        const numRocks = 2 + Math.floor(random() * 3);
        for (let i = 0; i < numRocks; i++) {
            // Random position within chunk
            const x = worldX + random() * this.chunkSize;
            const z = worldZ + random() * this.chunkSize;

            // Skip if in spawn area or water area
            if (this.isWithinSpawnArea(x, z) || this.isWaterArea(x, z)) {
                continue;
            }

            const y = this.getPerlinHeight(x, z);

            // Create rocks immediately - no need for staggering with fewer rocks
            this.createRock(x, y, z, `${key}:rock:${i}`);
        }
        // Ores are scarcer than plants; keep both out of water and the safe clearing.
        for (const [index, type] of ['ore', 'fiber', 'fiber', 'herb', 'berry'].entries()) {
            if (chunkX === 0 && chunkZ === 0) {
                const [x, z] = [[12,6],[-12,6],[-11,9],[-6,12],[6,12]][index];
                this.createResource(type, x, this.getPerlinHeight(x,z), z, `${key}:${type}:${index}`);
                continue;
            }
            for (let attempt = 0; attempt < 5; attempt++) {
                const x = worldX + random() * this.chunkSize;
                const z = worldZ + random() * this.chunkSize;
                if (this.isWithinSpawnArea(x, z) || this.isWaterArea(x, z)) continue;
                this.createResource(type, x, this.getPerlinHeight(x, z), z, `${key}:${type}:${index}`);
                break;
            }
        }
    }

    // Create water for a chunk
    createWater(chunkX, chunkZ) {
        // Create a water plane for this chunk
        const water = BABYLON.MeshBuilder.CreateGround(
            `water_${chunkX}_${chunkZ}`,
            {
                width: this.chunkSize,
                height: this.chunkSize,
                subdivisions: 2 // Low poly for performance
            },
            this.scene
        );

        // Position at water level
        water.position.x = chunkX + this.chunkSize / 2;
        water.position.z = chunkZ + this.chunkSize / 2;
        water.position.y = this.waterHeight;

        water.material = this.waterMaterial;
        water.isPickable = false;

        // Store water mesh for updates
        this.waterMeshes.push(water);
    }

    // Check if a position is within the spawn area
    isWithinSpawnArea(x, z) {
        const distanceToSpawn = Math.sqrt(
            Math.pow(x - this.spawnPosition.x, 2) +
            Math.pow(z - this.spawnPosition.z, 2)
        );

        return distanceToSpawn <= this.spawnAreaRadius;
    }

    createResource(type, x, y, z, resourceId) {
        if (this.harvestedIds.has(resourceId)) return;
        const seed = Math.floor(x * 73856093) ^ Math.floor(z * 19349663);
        const mesh = type === 'ore' ? createOreModel(this.scene, seed) : createPlantModel(this.scene, seed, type);
        mesh.position.set(x, y, z);
        mesh.rotation.y = (seed % 360) * Math.PI / 180;
        mesh.receiveShadows = true;
        this.game.inventorySystem.harvestableObjects.push({mesh, type, resourceId});
    }

    // One merged mesh per asset keeps picking, disposal, and draw calls simple.
    createTree(x, y, z, resourceId) {
        if (this.harvestedIds.has(resourceId)) return;
        const seed = Math.floor(x * 73856093) ^ Math.floor(z * 19349663);
        const mesh = createTreeModel(this.scene, seed, Math.abs(seed % 4) === 0 ? 'oak' : 'pine');
        mesh.position.set(x, y, z);
        mesh.rotation.y = (seed % 360) * Math.PI / 180;
        mesh.receiveShadows = true;
        if ((seed & 3) === 0) this.game.registerModelShadow(mesh);
        this.game.inventorySystem.harvestableObjects.push({ mesh, type: 'tree', resourceId });
    }

    createRock(x, y, z, resourceId) {
        if (this.harvestedIds.has(resourceId)) return;
        const seed = Math.floor(x * 83492791) ^ Math.floor(z * 2971215073);
        const mesh = createRockModel(this.scene, seed);
        mesh.position.set(x, y, z);
        mesh.rotation.y = (seed % 360) * Math.PI / 180;
        mesh.receiveShadows = true;
        this.game.inventorySystem.harvestableObjects.push({ mesh, type: 'rock', resourceId });
    }
    // Hundreds of grass tufts rendered as ONE thin-instanced draw call per
    // chunk. Pure scenery: no collision, picking, or costly individual models.
    createGroundCover(chunkX, chunkZ) {
        const random = seededRandom((Math.imul(chunkX, 1013904223) ^ Math.imul(chunkZ, 1664525) ^ 0x5144) | 0);
        const mesh = new BABYLON.Mesh(`groundcover_${chunkX}_${chunkZ}`, this.scene);
        const positions = [], indices = [], colors = [];
        const greens = [[.27,.43,.19],[.35,.49,.21],[.44,.51,.24],[.24,.36,.19]];
        for (let i = 0; i < 4; i++) {
            const angle = i * Math.PI / 2;
            const dx = Math.cos(angle), dz = Math.sin(angle);
            const o = positions.length / 3;
            positions.push(-dz * .16, 0, dx * .16, dz * .16, 0, -dx * .16, dx * .10, .50 + (i % 2) * .15, dz * .10);
            indices.push(o, o+1, o+2);
            const col = greens[i];
            for (let n = 0; n < 3; n++) colors.push(...col, 1);
        }
        const data = new BABYLON.VertexData();
        data.positions = positions; data.indices = indices; data.colors = colors;
        data.normals = []; BABYLON.VertexData.ComputeNormals(positions, indices, data.normals);
        data.applyToMesh(mesh);
        mesh.material = this.grassMaterial;
        mesh.isPickable = false;
        mesh.checkCollisions = false;
        mesh.receiveShadows = false;

        const matrices = [];
        const x0 = chunkX * this.chunkSize - this.chunkSize / 2;
        const z0 = chunkZ * this.chunkSize - this.chunkSize / 2;
        const scale = new BABYLON.Vector3(), pos = new BABYLON.Vector3();
        for (let i = 0; i < 95; i++) {
            const x = x0 + random() * this.chunkSize;
            const z = z0 + random() * this.chunkSize;
            if (this.isWithinSpawnArea(x, z) || this.isWaterArea(x, z)) continue;
            const size = .65 + random() * 1.2;
            scale.set(size, size, size);
            pos.set(x, this.getPerlinHeight(x, z) + .04, z);
            const m = BABYLON.Matrix.Compose(scale, BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Y, random() * Math.PI * 2), pos);
            matrices.push(...m.m);
        }
        if (matrices.length) mesh.thinInstanceSetBuffer('matrix', new Float32Array(matrices), 16, true);
        else mesh.setEnabled(false);
        return mesh;
    }

}
