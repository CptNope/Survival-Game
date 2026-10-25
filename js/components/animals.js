import { createDeerModel, createRabbitModel, animateDeer, animateRabbit } from '../models/wilderness.js';
// Animal system for handling animal spawning and behavior
export class AnimalSystem {
    constructor(game) {
        this.game = game;
        
        // Animal properties
        this.animals = [];
        this.animalSpawnTimer = 0;
        this.animalSpawnInterval = 6500; // Keep wildlife in the player's vicinity.
        this.maxAnimals = 12;
        // Establish life in the world immediately rather than waiting
        // ten seconds for the first deer to appear.
        this.seedNearbyAnimals();
    }
    
    seedNearbyAnimals() {
        const player = this.game.playerSystem.camera.position;
        for (let i = 0; i < 6; i++) {
            const angle = i * Math.PI * 2 / 6 + .27;
            for (let attempt = 0; attempt < 4; attempt++) {
                const radius = 26 + attempt * 5 + (i % 3) * 4;
                const x = player.x + Math.sin(angle) * radius;
                const z = player.z + Math.cos(angle) * radius;
                if (this.game.terrainSystem.isWaterArea(x, z)) continue;
                this.spawnAnimal(x, this.game.terrainSystem.getPerlinHeight(x, z), z, i % 3 === 2 ? 'rabbit' : 'deer');
                break;
            }
        }
    }

    update() {
        // Make sure terrain system is initialized
        if (!this.game.terrainSystem) return;
        
        const dt = Math.min(this.game.engine.getDeltaTime() / 1000, 0.05);
        const playerPosition = this.game.playerSystem.camera.position;

        // Update existing animals
        for (let i = this.animals.length - 1; i >= 0; i--) {
            const animal = this.animals[i];
            
            // Skip if animal mesh was disposed
            if (!animal || !animal.mesh) {
                this.animals.splice(i, 1);
                continue;
            }
            
            const dx = playerPosition.x - animal.mesh.position.x;
            const dz = playerPosition.z - animal.mesh.position.z;
            const distance = Math.hypot(dx, dz);
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
            const threatened = distance < (animal.kind === 'rabbit' ? 7 : 9);
            const heading = threatened ? Math.atan2(-dx, -dz) : animal.heading;
            // Wander, pause to graze, or bolt away from the player.
            const speed = threatened ? (animal.kind === 'rabbit' ? 6.2 : 4.5)
                : (Math.sin(animal.gait * .35 + i) > .68 ? .12 : (animal.kind === 'rabbit' ? 1.45 : .9));
            const nextX = animal.mesh.position.x + Math.sin(heading) * speed * dt;
            const nextZ = animal.mesh.position.z + Math.cos(heading) * speed * dt;
            if (!this.game.terrainSystem.isWaterArea(nextX, nextZ)) {
                animal.mesh.position.x = nextX;
                animal.mesh.position.z = nextZ;
                animal.mesh.rotation.y = heading;
            } else {
                animal.heading = heading + Math.PI * .75;
                animal.turnTimer = 1;
            }

            // Keep animal on terrain
            const terrainHeight = this.game.terrainSystem.getPerlinHeight(animal.mesh.position.x, animal.mesh.position.z);
            animal.mesh.position.y = terrainHeight;
            if (animal.kind === 'rabbit') animateRabbit(animal, dt, speed);
            else animateDeer(animal, dt, speed);
            
            // Check if animal is dead
            if (animal.health <= 0) {
                animal.mesh.dispose(false, true);
                this.animals.splice(i, 1);
                
                // Give experience for killing animal if combat system exists
                if (this.game.combatSystem) {
                    this.game.combatSystem.gainExperience(animal.kind === 'rabbit' ? 10 : 20);
                }
                if (animal.kind === 'rabbit' && this.game.inventorySystem) {
                    // Small animals provide a modest resource without another
                    // system of persistent item drops.
                    this.game.inventorySystem.inventory.fiber += 1;
                    this.game.uiSystem?.showNotification('Recovered 1 fiber from rabbit');
                    this.game.uiSystem?.updateInventoryUI();
                }
            }
        }
        
        // Spawn new animals occasionally
        this.animalSpawnTimer += this.game.scene.getEngine().getDeltaTime();
        if (this.animalSpawnTimer > this.animalSpawnInterval && this.animals.length < this.maxAnimals) {
            this.animalSpawnTimer = 0;
            
            // Spawn animal at random position near player
            const spawnDistance = 30 + Math.random() * 20;
            const spawnAngle = Math.random() * Math.PI * 2;
            const spawnX = this.game.playerSystem.camera.position.x + Math.sin(spawnAngle) * spawnDistance;
            const spawnZ = this.game.playerSystem.camera.position.z + Math.cos(spawnAngle) * spawnDistance;
            if (!this.game.terrainSystem.isWaterArea(spawnX, spawnZ)) {
                const terrainHeight = this.game.terrainSystem.getPerlinHeight(spawnX, spawnZ);
                this.spawnAnimal(spawnX, terrainHeight, spawnZ, Math.random() < .38 ? 'rabbit' : 'deer');
            }
        }
    }
    
    spawnAnimal(x, y, z, kind = 'deer') {
        const seed = Math.floor(x * 1000 + z * 13);
        const model = kind === 'rabbit'
            ? createRabbitModel(this.game.scene, seed) : createDeerModel(this.game.scene, seed);
        model.mesh.position.set(x, y, z);
        if (kind === 'deer') this.game.registerModelShadow(model.mesh);
        this.animals.push({ ...model, kind, health: kind === 'rabbit' ? 12 : 30, speed: 1, gait: 0 });
    }
}
