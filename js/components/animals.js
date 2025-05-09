// Animal system for handling animal spawning and behavior
export class AnimalSystem {
    constructor(game) {
        this.game = game;
        
        // Animal properties
        this.animals = [];
        this.animalSpawnTimer = 0;
        this.animalSpawnInterval = 10000; // 10 seconds
    }
    
    update() {
        // Make sure terrain system is initialized
        if (!this.game.terrainSystem) return;
        
        // Update existing animals
        for (let i = this.animals.length - 1; i >= 0; i--) {
            const animal = this.animals[i];
            
            // Skip if animal mesh was disposed
            if (!animal || !animal.mesh) {
                this.animals.splice(i, 1);
                continue;
            }
            
            // Move animal randomly
            const randomMove = Math.random() * 0.05;
            const randomDirection = Math.random() * Math.PI * 2;
            animal.mesh.position.x += Math.sin(randomDirection) * randomMove;
            animal.mesh.position.z += Math.cos(randomDirection) * randomMove;
            
            // Keep animal on terrain
            const terrainHeight = this.game.terrainSystem.getPerlinHeight(animal.mesh.position.x, animal.mesh.position.z);
            animal.mesh.position.y = terrainHeight + 0.5;
            
            // Check if animal is dead
            if (animal.health <= 0) {
                animal.mesh.dispose();
                this.animals.splice(i, 1);
                
                // Give experience for killing animal if combat system exists
                if (this.game.combatSystem) {
                    this.game.combatSystem.gainExperience(20);
                }
            }
        }
        
        // Spawn new animals occasionally
        this.animalSpawnTimer += this.game.scene.getEngine().getDeltaTime();
        if (this.animalSpawnTimer > this.animalSpawnInterval && this.animals.length < 10) {
            this.animalSpawnTimer = 0;
            
            // Spawn animal at random position near player
            const spawnDistance = 30 + Math.random() * 20;
            const spawnAngle = Math.random() * Math.PI * 2;
            const spawnX = this.game.playerSystem.camera.position.x + Math.sin(spawnAngle) * spawnDistance;
            const spawnZ = this.game.playerSystem.camera.position.z + Math.cos(spawnAngle) * spawnDistance;
            const terrainHeight = this.game.terrainSystem.getPerlinHeight(spawnX, spawnZ);
            
            this.spawnAnimal(spawnX, terrainHeight, spawnZ);
        }
    }
    
    spawnAnimal(x, y, z) {
        // Create animal body (cube) - position at exact terrain height
        const animalBody = BABYLON.MeshBuilder.CreateBox("animalBody", { width: 1, height: 1, depth: 2 }, this.game.scene);
        // Position the body so its bottom is exactly at terrain height
        animalBody.position.set(x, y + 0.5, z); // y + 0.5 puts the bottom of the box at terrain height
        
        // Create animal material
        const animalMaterial = new BABYLON.StandardMaterial("animalMat", this.game.scene);
        animalMaterial.diffuseColor = new BABYLON.Color3(0.6, 0.3, 0.1); // Brown color
        animalBody.material = animalMaterial;
        
        // Create head (smaller cube)
        const head = BABYLON.MeshBuilder.CreateBox("head", { width: 0.8, height: 0.8, depth: 0.8 }, this.game.scene);
        // Position relative to the parent (body)
        head.position = new BABYLON.Vector3(0, 0.4, 1.0); // Position at front of body
        head.material = animalMaterial;
        head.parent = animalBody;
        
        // Create legs (small cubes)
        const legMaterial = new BABYLON.StandardMaterial("legMat", this.game.scene);
        legMaterial.diffuseColor = new BABYLON.Color3(0.4, 0.2, 0.1); // Darker brown
        
        // Front legs
        const frontLeftLeg = BABYLON.MeshBuilder.CreateBox("frontLeftLeg", { width: 0.2, height: 0.6, depth: 0.2 }, this.game.scene);
        frontLeftLeg.position = new BABYLON.Vector3(-0.4, -0.8, 0.7); // Position relative to body
        frontLeftLeg.material = legMaterial;
        frontLeftLeg.parent = animalBody;
        
        const frontRightLeg = BABYLON.MeshBuilder.CreateBox("frontRightLeg", { width: 0.2, height: 0.6, depth: 0.2 }, this.game.scene);
        frontRightLeg.position = new BABYLON.Vector3(0.4, -0.8, 0.7); // Position relative to body
        frontRightLeg.material = legMaterial;
        frontRightLeg.parent = animalBody;
        
        // Back legs
        const backLeftLeg = BABYLON.MeshBuilder.CreateBox("backLeftLeg", { width: 0.2, height: 0.6, depth: 0.2 }, this.game.scene);
        backLeftLeg.position = new BABYLON.Vector3(-0.4, -0.8, -0.7); // Position relative to body
        backLeftLeg.material = legMaterial;
        backLeftLeg.parent = animalBody;
        
        const backRightLeg = BABYLON.MeshBuilder.CreateBox("backRightLeg", { width: 0.2, height: 0.6, depth: 0.2 }, this.game.scene);
        backRightLeg.position = new BABYLON.Vector3(0.4, -0.8, -0.7); // Position relative to body
        backRightLeg.material = legMaterial;
        backRightLeg.parent = animalBody;
        
        // Add animal to list
        this.animals.push({
            mesh: animalBody,
            health: 30,
            speed: 0.05 + Math.random() * 0.05
        });
    }
}
