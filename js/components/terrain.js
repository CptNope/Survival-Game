// Terrain generation and management system
import { Utils } from '../utils.js';

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
        this.spawnAreaRadius = 20; // Clear area radius around spawn point
        
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
        
        // Store in chunk map
        this.chunkMap.set(key, { mesh: ground });
        
        // Populate with trees and rocks
        this.populateChunk(chunkX, chunkZ);
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
                chunk.mesh.dispose();
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
        const worldX = chunkX * this.chunkSize;
        const worldZ = chunkZ * this.chunkSize;
        
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
        const numTrees = 1 + Math.floor(Math.random() * 2); // Only 1-3 trees per chunk
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
    
    // Create a tree at the specified position
    createTree(x, y, z) {
        // Create trunk
        const trunk = BABYLON.MeshBuilder.CreateCylinder("trunk", {
            height: 4,
            diameter: 1
        }, this.game.scene);
        trunk.position.set(x, y + 2, z);
        
        // Create leaves
        const leaves = BABYLON.MeshBuilder.CreateSphere("leaves", {
            diameter: 4,
            segments: 8
        }, this.game.scene);
        leaves.position.set(x, y + 5, z);
        
        // Materials
        const trunkMaterial = new BABYLON.StandardMaterial("trunkMat", this.game.scene);
        trunkMaterial.diffuseColor = new BABYLON.Color3(0.4, 0.3, 0.2);
        trunk.material = trunkMaterial;
        
        const leavesMaterial = new BABYLON.StandardMaterial("leavesMat", this.game.scene);
        leavesMaterial.diffuseColor = new BABYLON.Color3(0.1, 0.5, 0.1);
        leaves.material = leavesMaterial;
        
        // Add to harvestable objects with reference to both trunk and leaves
        this.game.inventorySystem.harvestableObjects.push({
            mesh: trunk,
            type: "tree",
            relatedMeshes: [leaves] // Store leaves to dispose when tree is harvested
        });
    }
    
    // Create a rock at the specified position
    createRock(x, y, z) {
        // Create rock mesh with larger size for better visibility
        const diameter = 2.5 + Math.random() * 1.5; // Random size between 2.5 and 4.0
        
        // Use a box shape for some rocks to add variety
        let rock;
        if (Math.random() > 0.5) {
            rock = BABYLON.MeshBuilder.CreateSphere("rock", {
                diameter: diameter,
                segments: 6
            }, this.game.scene);
            
            // Flatten the rock a bit for more natural look
            rock.scaling.y = 0.3 + Math.random() * 0.3; // Random y-scale between 0.3 and 0.6
        } else {
            // Create a box-shaped rock for variety
            rock = BABYLON.MeshBuilder.CreateBox("rock", {
                width: diameter * 0.8,
                height: diameter * 0.5,
                depth: diameter * 0.8
            }, this.game.scene);
        }
        
        // Position directly on the ground for guaranteed visibility
        rock.position.set(x, y + diameter * 0.25, z);
        
        // Add slight random scaling to x and z for variety
        const xzScale = 0.8 + Math.random() * 0.6; // Random scale between 0.8 and 1.4
        rock.scaling.x *= xzScale;
        rock.scaling.z *= xzScale;
        
        // Random rotation on all axes for more natural placement
        rock.rotation.x = Math.random() * Math.PI * 0.3; // Limit x rotation to avoid weird angles
        rock.rotation.y = Math.random() * Math.PI * 2;  // Full rotation on y axis
        rock.rotation.z = Math.random() * Math.PI * 0.3; // Limit z rotation
        
        // Disable physics for rocks and use static positioning instead
        // Position the rock directly on the ground with a small offset to prevent z-fighting
        const rockHeight = (rock.getBoundingInfo().boundingBox.extendSize.y * 2) * rock.scaling.y;
        rock.position.y = y + rockHeight / 2 + 0.05; // Add a small offset to prevent sinking
        
        // Enable collision detection but without physics
        rock.checkCollisions = true;
        
        // Add a small random rotation for natural appearance
        rock.rotation.x = Math.random() * Math.PI * 0.2;
        rock.rotation.z = Math.random() * Math.PI * 0.2;
        
        // Material with slight texture variation
        const rockMaterial = new BABYLON.StandardMaterial("rockMat", this.game.scene);
        const greyShade = 0.4 + Math.random() * 0.2; // Random grey between 0.4 and 0.6
        rockMaterial.diffuseColor = new BABYLON.Color3(greyShade, greyShade, greyShade);
        rockMaterial.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2); // Slight shine
        rock.material = rockMaterial;
        
        // Add to harvestable objects
        this.game.inventorySystem.harvestableObjects.push({
            mesh: rock,
            type: "rock"
        });
    }
}
