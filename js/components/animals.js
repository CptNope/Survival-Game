import { createDeerModel, animateDeer } from '../models/wilderness.js';
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
            
            const dt = Math.min(this.game.engine.getDeltaTime() / 1000, 0.05);
            const player = this.game.playerSystem;
            const offset = player.camera.position.subtract(animal.mesh.position);
            const distance = offset.length();
            if (distance > 100) {
                animal.mesh.dispose(false, true);
                this.animals.splice(i, 1);
                continue;
            }
            animal.turnTimer = (animal.turnTimer || 0) - dt;
            if (animal.turnTimer <= 0) {
                animal.heading = Math.random() * Math.PI * 2;
                animal.turnTimer = 2 + Math.random() * 3;
            }
            const threatened = distance < 9;
            const heading = threatened ? Math.atan2(-offset.x, -offset.z) : animal.heading;
            const speed = threatened ? 4 : 1;
            animal.mesh.position.x += Math.sin(heading) * speed * dt;
            animal.mesh.position.z += Math.cos(heading) * speed * dt;
            animal.mesh.rotation.y = heading;

            // Keep animal on terrain
            const terrainHeight = this.game.terrainSystem.getPerlinHeight(animal.mesh.position.x, animal.mesh.position.z);
            animal.mesh.position.y = terrainHeight;
            animateDeer(animal, dt, speed);
            
            // Check if animal is dead
            if (animal.health <= 0) {
                animal.mesh.dispose(false, true);
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
        const model = createDeerModel(this.game.scene, Math.floor(x * 1000 + z * 13));
        model.mesh.position.set(x, y, z);
        this.game.registerModelShadow(model.mesh);
        this.animals.push({ ...model, health: 30, speed: 1, gait: 0 });
    }
}
