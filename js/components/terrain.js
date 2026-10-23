// Terrain generation and management system
import { Utils } from '../utils.js';
import { createTreeModel, createRockModel } from '../models/wilderness.js';

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
        
        // Initialize noise generator
        // Perlin/Simplex noise is a procedural texture generation algorithm used to create natural-looking patterns
        // It's commonly used in game development for terrain generation, clouds, and other organic features
        this.initNoise();
        
        // Initialize terrain
        this.generateInitialChunks();
    }
    
    initNoise() {
        this.noise = new SimplexNoise();
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
    
    // Apply materials and textures to the terrain
    applyTerrainMaterial(mesh) {
        // Create multi-material for different terrain types
        const terrainMaterial = new BABYLON.StandardMaterial("terrainMat", this.game.scene);
        
        // Load grass texture
        const grassTexture = new BABYLON.Texture("https://assets.babylonjs.com/textures/grass.png", this.game.scene);
        grassTexture.uScale = 10;
        grassTexture.vScale = 10;
        
        // Apply textures
        terrainMaterial.diffuseTexture = grassTexture;
        terrainMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
        terrainMaterial.emissiveColor = new BABYLON.Color3(0.1, 0.1, 0.1);
        
        // Apply material to mesh
        mesh.material = terrainMaterial;
    }
    
    // Get height at a specific world position using Perlin noise
    // Perlin noise is a procedural generation algorithm that creates natural-looking random patterns
    // It's widely used in game development for terrain generation, as it creates smooth, continuous variations
    getPerlinHeight(x, z) {
        // Check if position is within spawn area radius
        const distanceToSpawn = Math.sqrt(
            Math.pow(x - this.spawnPosition.x, 2) + 
            Math.pow(z - this.spawnPosition.z, 2)
        );
        
        // If within spawn area, return flat terrain height
        if (distanceToSpawn <= this.spawnAreaRadius) {
            return this.spawnHeight;
        }
        
        // Check if this is a water area
        if (this.isWaterArea(x, z)) {
            return this.waterHeight;
        }
        
        // Much flatter terrain generation using sine waves with reduced amplitude
        let height = 2; // Base height
        
        // Add very gentle hills using sine waves with reduced amplitude
        height += Math.sin(x * 0.01) * 0.8; // Reduced frequency and amplitude
        height += Math.cos(z * 0.01) * 0.8;
        height += Math.sin((x + z) * 0.015) * 0.4;
        
        // Ensure minimum height and cap maximum height for easier navigation
        return Math.max(1.5, Math.min(3.5, height));
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
                for (const water of chunk.water) water.dispose(false, true);
                this.waterMeshes = this.waterMeshes.filter(mesh => !chunk.water.includes(mesh));
                chunk.mesh.dispose(false, true);
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
        const numTrees = 4 + Math.floor(Math.random() * 4); // Only 1-3 trees per chunk
        for (let i = 0; i < numTrees; i++) {
            // Random position within chunk
            const x = worldX + Math.random() * this.chunkSize;
            const z = worldZ + Math.random() * this.chunkSize;
            
            // Skip if in spawn area or water area
            if (this.isWithinSpawnArea(x, z) || this.isWaterArea(x, z)) {
                continue;
            }
            
            const y = this.getPerlinHeight(x, z);
            this.createTree(x, y, z);
        }
        
        // Add rocks - REDUCED NUMBER significantly
        const numRocks = 2 + Math.floor(Math.random() * 2); // Only 2-4 rocks per chunk
        for (let i = 0; i < numRocks; i++) {
            // Random position within chunk
            const x = worldX + Math.random() * this.chunkSize;
            const z = worldZ + Math.random() * this.chunkSize;
            
            // Skip if in spawn area or water area
            if (this.isWithinSpawnArea(x, z) || this.isWaterArea(x, z)) {
                continue;
            }
            
            const y = this.getPerlinHeight(x, z);
            
            // Create rocks immediately - no need for staggering with fewer rocks
            this.createRock(x, y, z);
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
        
        // Create water material
        const waterMaterial = new BABYLON.StandardMaterial("waterMat", this.scene);
        waterMaterial.diffuseColor = new BABYLON.Color3(0.1, 0.3, 0.7);
        waterMaterial.alpha = 0.7; // Semi-transparent
        waterMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
        waterMaterial.emissiveColor = new BABYLON.Color3(0, 0.1, 0.2);
        water.material = waterMaterial;
        
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
    
    // One merged mesh per asset keeps picking, disposal, and draw calls simple.
    createTree(x, y, z) {
        const seed = Math.floor(x * 73856093) ^ Math.floor(z * 19349663);
        const mesh = createTreeModel(this.scene, seed, Math.abs(seed % 4) === 0 ? 'oak' : 'pine');
        mesh.position.set(x, y, z);
        mesh.rotation.y = (seed % 360) * Math.PI / 180;
        mesh.receiveShadows = true;
        this.game.registerModelShadow(mesh);
        this.game.inventorySystem.harvestableObjects.push({ mesh, type: 'tree' });
    }

    createRock(x, y, z) {
        const seed = Math.floor(x * 83492791) ^ Math.floor(z * 2971215073);
        const mesh = createRockModel(this.scene, seed);
        mesh.position.set(x, y, z);
        mesh.rotation.y = (seed % 360) * Math.PI / 180;
        mesh.receiveShadows = true;
        this.game.registerModelShadow(mesh);
        this.game.inventorySystem.harvestableObjects.push({ mesh, type: 'rock' });
    }
}
