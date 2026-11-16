import { createDeerModel, createRabbitModel, createWolfModel, animateDeer, animateRabbit } from '../models/wilderness.js';
import { createCreatureModel } from '../models/creatures.js';
import { CREATURES, ELITE, scaleFor } from '../creatures.js';
import { CreatureAI } from './creatures.js';
// Animal system for handling animal spawning and behavior
export class AnimalSystem {
    constructor(game) {
        this.game = game;
        
        // Animal properties
        this.animals = [];
        this.animalSpawnTimer = 0;
        this.animalSpawnInterval = 6500; // Keep wildlife in the player's vicinity.
        this.maxAnimals = 12;
        this.maxWolves = 3;
        this.ai = new CreatureAI(game); // Drives boars, bears and everything underground.
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

    isNight() {
        return Math.sin(this.game.dayTime / this.game.dayLength * Math.PI * 2) <= .12;
    }

    update() {
        // Make sure terrain system is initialized
        if (!this.game.terrainSystem) return;
        
        const dt = Math.min(this.game.engine.getDeltaTime() / 1000, 0.05);
        const playerPosition = this.game.playerSystem.camera.position;
        // While the player is underground the surface stands still, and the reverse.
        const underground = Boolean(this.game.dungeonSystem?.active);
        this.ai.updateBolts(dt);

        // Update existing animals
        for (let i = this.animals.length - 1; i >= 0; i--) {
            const animal = this.animals[i];
            
            // Skip if animal mesh was disposed
            if (!animal || !animal.mesh) {
                this.animals.splice(i, 1);
                continue;
            }
            
            if (Boolean(animal.dungeon) !== underground) continue;
            const dx = playerPosition.x - animal.mesh.position.x;
            const dz = playerPosition.z - animal.mesh.position.z;
            const distance = Math.hypot(dx, dz);
            if (distance > 100 && !underground) {
                animal.mesh.dispose(false, true);
                this.animals.splice(i, 1);
                continue;
            }
            if (CREATURES[animal.kind]?.brain) {
                this.ai.update(animal, dt);
                if (animal.health <= 0) this.finish(animal, i);
                continue;
            }
            animal.turnTimer = (animal.turnTimer || 0) - dt;
            if (animal.turnTimer <= 0) {
                animal.heading = Math.random() * Math.PI * 2;
                animal.turnTimer = 2 + Math.random() * 3;
            }
            const wolf = animal.kind === 'wolf';
            animal.fleeTimer = Math.max(0, (animal.fleeTimer || 0) - dt);
            animal.staggerTimer = Math.max(0, (animal.staggerTimer || 0) - dt);
            // Prey runs when the player is close, or for a while after being struck.
            const threatened = distance < (animal.kind === 'rabbit' ? 7 : 9) || animal.fleeTimer > 0;
            const hunting = wolf && distance < 26 && !this.game.playerSystem.isDead;
            if (hunting && !animal.alerted) {
                animal.alerted = true;
                this.game.audio?.play('growl', {volume: Math.max(.25, 1 - distance / 30)});
            } else if (!hunting) animal.alerted = false;
            const heading = hunting ? Math.atan2(dx, dz) :
                threatened && !wolf ? Math.atan2(-dx, -dz) : animal.heading;
            // Wander, pause to graze, or bolt away from the player. A blow
            // staggers the animal for a moment before it moves again.
            const speed = animal.staggerTimer > 0 ? 0 : hunting ? 3.8 : threatened && !wolf ? (animal.kind === 'rabbit' ? 6.2 : 4.5)
                : (Math.sin(animal.gait * .35 + i) > .68 ? .12 : (animal.kind === 'rabbit' ? 1.45 : .9));
            // Recoil from the last hit decays quickly.
            const knockX = animal.knockX || 0, knockZ = animal.knockZ || 0;
            animal.knockX = knockX * Math.max(0, 1 - dt * 7);
            animal.knockZ = knockZ * Math.max(0, 1 - dt * 7);
            const nextX = animal.mesh.position.x + (Math.sin(heading) * speed + knockX) * dt;
            const nextZ = animal.mesh.position.z + (Math.cos(heading) * speed + knockZ) * dt;
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
            else if (animal.kind === 'deer') animateDeer(animal, dt, speed);
            else animal.gait += dt * speed;

            if (wolf && distance < 2.7 && !this.game.playerSystem.isDead) {
                animal.attackCooldown = (animal.attackCooldown || 0) - dt;
                if (animal.attackCooldown <= 0) {
                    animal.attackCooldown = 2.25;
                    this.game.playerSystem.takeDamage(8, 'a wolf');
                    this.game.uiSystem?.showNotification?.('Wolf attack! Seek shelter or defend yourself');
                }
            }
            
            // Check if animal is dead
            if (animal.health <= 0) this.finish(animal, i);
        }
        if (underground) return; // Nothing new wanders in from the surface.

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
                const count=kind=>this.animals.filter(a=>a.kind===kind).length;
                const wolfCount=count('wolf');
                const fromHome=Math.hypot(spawnX, spawnZ);
                const roll=Math.random();
                // Boars root about by day; bears keep to the country well away from camp.
                const kind = this.isNight() && wolfCount < this.maxWolves && roll < .45 ? 'wolf'
                    : !this.isNight() && fromHome > 110 && count('bear') < 1 && roll < .07 ? 'bear'
                    : !this.isNight() && fromHome > 45 && count('boar') < 2 && roll < .24 ? 'boar'
                    : Math.random() < .38 ? 'rabbit' : 'deer';
                this.spawnAnimal(spawnX, terrainHeight, spawnZ, kind);
            }
        }
    }
    
    // Death: effects, experience, meat and (sometimes) a piece of gear.
    finish(animal, i) {
        const game = this.game, def = CREATURES[animal.kind] || {};
        const position = animal.mesh.position.clone();
        game.effects?.burst?.(position.add(new BABYLON.Vector3(0, .7, 0)), animal.dungeon ? 'stone' : 'fur', def.boss ? 40 : 16);
        game.progression?.record(def.stat || 'hunted');
        animal.mesh.dispose(false, true);
        this.animals.splice(i, 1);

        // Give experience for killing animal if combat system exists
        game.combatSystem?.gainExperience(Math.round((def.xp || 20) * (animal.xpScale || 1)));
        if (game.inventorySystem && def.loot) {
            const inv = game.inventorySystem.inventory;
            for (const [item, amount] of Object.entries(def.loot)) inv[item] += amount;
            game.uiSystem?.showNotification?.('Hunted ' + animal.kind + ' · Raw meat recovered');
        } else if (def.brain) {
            game.uiSystem?.showNotification?.('Defeated ' + (animal.elite ? 'an elite ' : '') + def.label.toLowerCase());
        }
        if (animal.elite) {
            // Elites always carry something, and it tends to be good.
            game.gear?.dropRoll?.(position, {level: (animal.level || 1) + 1, luck: (def.gear?.luck || 0) + ELITE.luck});
        } else if (def.gear && Math.random() < def.gear.chance) {
            game.gear?.dropRoll?.(position, {level: animal.level || 1, luck: def.gear.luck});
        }
        // Some creatures come apart into smaller ones.
        if (def.split && animal.dungeon) game.dungeonSystem?.summonAround?.(position, def.split.kind, def.split.count, 1.3);
        if (def.boss) game.dungeonSystem?.onBossDefeated?.(animal, position);
        game.uiSystem?.updateInventoryUI?.();
        if (!animal.dungeon) game.saveSystem?.save();
    }

    // `options` scales dungeon creatures: {dungeon, tier, floor, level}.
    spawnAnimal(x, y, z, kind = 'deer', options = {}) {
        const seed = Math.floor(x * 1000 + z * 13);
        const def = CREATURES[kind] || CREATURES.deer;
        const model = def.brain ? createCreatureModel(this.game.scene, kind, seed)
            : kind === 'rabbit'
            ? createRabbitModel(this.game.scene, seed) : kind === 'wolf'
                ? createWolfModel(this.game.scene, seed) : createDeerModel(this.game.scene, seed);
        model.mesh.position.set(x, y, z);
        model.mesh.computeWorldMatrix(true);
        if (kind === 'deer') this.game.registerModelShadow(model.mesh);
        const scale = def.brain ? {...scaleFor(options.tier, options.floor)} : {health: 1, damage: 1, xp: 1};
        const elite = Boolean(options.elite && def.brain && !def.boss);
        if (elite) {
            scale.health *= ELITE.health; scale.damage *= ELITE.damage; scale.xp *= ELITE.xp;
            model.mesh.scaling.setAll(ELITE.size);
            if (model.mesh.material) model.mesh.material.emissiveColor = new BABYLON.Color3(.42, .3, .06);
        }
        const health = Math.round(def.health * scale.health);
        const animal = { ...model, kind, health, maxHealth: health, speed: 1, gait: 0, attackCooldown: 0,
            seed: Math.abs(seed % 97), damageScale: scale.damage, xpScale: scale.xp,
            level: options.level || 1, dungeon: Boolean(options.dungeon), elite };
        this.animals.push(animal);
        if (kind === 'wolf') this.game.audio?.play('howl', {volume: .8});
        return animal;
    }

    // Remove everything that belongs underground (leaving or rebuilding a floor).
    clearDungeon() {
        this.ai.clearBolts();
        for (let i = this.animals.length - 1; i >= 0; i--) {
            if (!this.animals[i].dungeon) continue;
            this.animals[i].mesh?.dispose(false, true);
            this.animals.splice(i, 1);
        }
    }

    // Wolves slink away at sunrise (and whenever the player sleeps the night out).
    clearWolves(beyond = 0) {
        const player = this.game.playerSystem.camera.position;
        for (let i = this.animals.length - 1; i >= 0; i--) {
            const animal = this.animals[i];
            if (animal.kind !== 'wolf' || !animal.mesh) continue;
            if (Math.hypot(animal.mesh.position.x - player.x, animal.mesh.position.z - player.z) < beyond) continue;
            this.animals[i].mesh?.dispose(false, true);
            this.animals.splice(i, 1);
        }
    }
}
