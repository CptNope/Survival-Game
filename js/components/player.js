// Player system for handling player controls and physics
import { SPEED, MAX_STEP_UNITS, keyboardSpeed, frameFactor } from '../movement.js';
import { difficultyOf } from '../difficulty.js';
// Dodge timings (ms) and speed (m/s).
export const DODGE = Object.freeze({distance: 3.4, invulnerable: 340, cooldown: 1100, speed: 14});

// Harm that armour cannot turn aside.
const ENVIRONMENTAL = new Set(['drowning', 'starvation', 'thirst', 'the cold', 'a long fall', 'venom']);

export class PlayerSystem {
    constructor(game) {
        this.game = game;
        this.scene = game.scene;
        
        // Player properties
        this.jumpHeight = 0.22;
        this.gravity = 0.012;
        this.jumpVelocity = 0;
        this.isGrounded = true;
        this.isJumping = false;
        
        // Flying properties
        this.isFlying = false;
        this.canDoubleJump = false;
        this.flyingSpeed = 0.12; // Height units per normalized frame.
        this.jumpCount = 0;
        this.jumpTimer = 0;
        this.jumpTimerThreshold = 300; // ms to detect double jump
        this.flyingHeight = 0;
        
        // Swimming properties
        this.isSwimming = false;
        this.swimSpeed = 0.15; // Rising and sinking, in height units per normalized frame.
        this.underwaterDrag = 0.7; // Slows movement underwater
        this.oxygenLevel = 100; // Full oxygen
        this.maxOxygen = 100;
        this.oxygenDepletionRate = 0.2; // How fast oxygen depletes underwater
        this.oxygenRefillRate = 0.5; // How fast oxygen refills above water
        this.isUnderwater = false; // Eyes below the surface: oxygen is draining.
        this.swimDepth = 1.25; // Deeper than this and the player floats instead of wading.
        this.surfaceOffset = 0.35; // Eye height above the water while treading.
        
        // Health and respawn properties
        this.health = 100;
        this.maxHealth = 100;
        this.isDead = false;
        this.respawnPoint = { x: 0, y: 0, z: 0 }; // Default to origin
        this.lootDropped = false; // Track if loot was dropped on death
        this.lastDamageCause = 'the wilds';
        this.slowDamage = 0; // Accumulates gradual harm so feedback is not spammed.
        
        // Key states
        this.keys = {
            jump: false,  // Space
            descend: false, // Ctrl
            sprint: false // Shift
        };
        
        // Get spawn position from terrain system if available
        let spawnX = 0, spawnY = 2, spawnZ = 0;
        if (this.game.terrainSystem && this.game.terrainSystem.spawnPosition) {
            spawnX = this.game.terrainSystem.spawnPosition.x;
            spawnY = this.game.terrainSystem.spawnPosition.y + 2; // Add player height
            spawnZ = this.game.terrainSystem.spawnPosition.z;
        }
        
        // Create camera at spawn position
        this.camera = new BABYLON.FreeCamera("playerCamera", new BABYLON.Vector3(spawnX,
            this.game.terrainSystem ? this.game.terrainSystem.getPerlinHeight(spawnX, spawnZ) + 2 : spawnY, spawnZ), this.scene);
        this.camera.rotation.set(0, 0, 0);
        this.camera.attachControl(this.game.engine.getRenderingCanvas(), true);
        
        // Spawn immediately: terrain generation is synchronous, so the delayed
        // camera teleport previously fought mouse movement just after startup.

        // Movement settings
        this.camera.ellipsoid = new BABYLON.Vector3(1, 1.8, 1);
        this.camera.checkCollisions = true;
        this.camera.applyGravity = false; // We'll handle gravity manually
        this.camera.inertia = 0.12; // Prevent persistent camera/movement drift.
        // Ground speed in units a second; the thumbstick reads it too.
        this.moveSpeed = SPEED.walk;
        this.camera.speed = keyboardSpeed(this.moveSpeed, this.camera.inertia);
        this.camera.angularSensibility = 2200;
        this.camera.minZ = 0.1;
        this.camera.keysUp = [87]; // W
        this.camera.keysDown = [83]; // S
        this.camera.keysLeft = [65]; // A
        this.camera.keysRight = [68]; // D
        
        // Create player mesh
        this.playerMesh = this.createPlayerMesh();
    }
    
    createPlayerMesh() {
        // Player mesh - not visible in first person
        const player = BABYLON.MeshBuilder.CreateBox("player", { width: 1, height: 2, depth: 1 }, this.game.scene);
        player.position = this.camera.position;
        player.isVisible = false;
        
        // Make the player follow the camera
        this.game.scene.onBeforeRenderObservable.add(() => {
            player.position = this.camera.position;
        });
        
        return player;
    }
    
    jump() {
        const now = Date.now();
        
        if (this.isGrounded) {
            // First jump
            this.isJumping = true;
            this.isGrounded = false;
            this.jumpVelocity = this.jumpHeight;
            this.jumpCount = 1;
            this.jumpTimer = now;
            this.canDoubleJump = true;
        } else if (this.canDoubleJump && !this.isFlying) {
            // Check for double jump (second jump while in air)
            if (this.game.dungeonSystem?.active) {
                this.canDoubleJump = false; // No room to take flight under a stone ceiling.
            } else if (now - this.jumpTimer < this.jumpTimerThreshold) {
                // Double jump detected, activate flying
                this.isFlying = true;
                this.jumpVelocity = this.jumpHeight * 0.5; // Initial upward boost
                this.flyingHeight = this.camera.position.y; // Set current height as base flying height
                this.game.audio?.play('whoosh');
            } else {
                // Reset timer for potential double jump
                this.jumpTimer = now;
            }
            this.jumpCount = 2;
            this.canDoubleJump = false;
        } else if (this.isFlying) {
            // While flying, jump again to deactivate flying and fall
            this.isFlying = false;
            this.jumpVelocity = 0; // Start falling
        }
    }
    
    // Handle key state updates
    updateKeyState(keyCode, isPressed) {
        if (keyCode === 32) { // Space key for jump
            this.keys.jump = isPressed;
        } else if (keyCode === 17) { // Ctrl key for descend
            this.keys.descend = isPressed;
        } else if (keyCode === 16) { // Shift to sprint
            this.keys.sprint = isPressed;
        }
    }
    
    // A quick sidestep along the way the player is moving (a hop backwards
    // when standing still). Blows that land during it miss.
    dodge() {
        const now = performance.now();
        if (this.game.paused || this.isDead || this.isSwimming || this.isFlying || now < (this.dodgeReadyAt || 0)) return false;
        const yaw = this.camera.rotation.y;
        let dx = this.moveX || 0, dz = this.moveZ || 0;
        const length = Math.hypot(dx, dz);
        if (length > .015) { dx /= length; dz /= length; } else { dx = -Math.sin(yaw); dz = -Math.cos(yaw); }
        this.dodgeX = dx; this.dodgeZ = dz;
        this.dodgeLeft = DODGE.distance;
        this.invulnerableUntil = now + DODGE.invulnerable;
        this.dodgeReadyAt = now + DODGE.cooldown * (1 - (this.game.perks?.value('dodge') || 0));
        this.game.audio?.play('dodge');
        return true;
    }

    update() {
        const deltaTime = Math.min(2.5, this.game.scene.getAnimationRatio());

        // Check for death first
        if (this.isDead) {
            this.handleDeath();
            return; // Skip other updates if dead
        }

        // Remember which way the player is travelling, for the dodge.
        const here = this.camera.position;
        if (this.previous) {
            const stepX = here.x - this.previous.x, stepZ = here.z - this.previous.z;
            if (Math.hypot(stepX, stepZ) < 2) { this.moveX = stepX; this.moveZ = stepZ; }
            this.previous.x = here.x; this.previous.z = here.z;
        } else this.previous = {x: here.x, z: here.z};
        // Mid-dodge: push through the camera's own movement so walls and trees still stop it.
        // The dodge covers a fixed distance however fast frames are arriving.
        if (this.dodgeLeft > 0 && this.camera.cameraDirection) {
            const seconds = Math.min(.05, (this.game.engine?.getDeltaTime?.() ?? 16) / 1000);
            const step = Math.min(this.dodgeLeft, DODGE.speed * seconds, MAX_STEP_UNITS);
            this.dodgeLeft -= step;
            // The camera carries a little of each push into the next frame.
            const push = step * (1 - (this.camera.inertia || 0));
            this.camera.cameraDirection.x += this.dodgeX * push;
            this.camera.cameraDirection.z += this.dodgeZ * push;
        }

        // Get current position info
        const x = this.camera.position.x;
        const y = this.camera.position.y;
        const z = this.camera.position.z;
        const terrain = this.game.terrainSystem;
        // Underground the floor is flat stone: no lakes, no sky to fly in.
        const dungeon = this.game.dungeonSystem?.active ? this.game.dungeonSystem : null;
        if (dungeon) this.isFlying = false;
        const terrainHeight = dungeon ? dungeon.floorY : terrain ? terrain.getPerlinHeight(x, z) : 0;
        const waterLevel = terrain?.waterHeight;

        // Deep water floats the player; shallows are simply waded through.
        const depth = !dungeon && terrain && terrain.isWaterArea(x, z) && Number.isFinite(waterLevel)
            ? waterLevel - terrainHeight : 0;
        const surface = waterLevel + this.surfaceOffset;
        const deep = depth > this.swimDepth;
        const wasSwimming = this.isSwimming;
        this.isSwimming = deep && !this.isFlying && y <= surface + 0.45;
        this.isUnderwater = this.isSwimming && y < waterLevel - 0.05;
        if (this.isSwimming && !wasSwimming) this.game.audio?.play('splash');

        // Handle oxygen and drowning
        if (this.isUnderwater) {
            this.oxygenLevel -= this.oxygenDepletionRate * deltaTime;

            // Damage player if out of oxygen
            if (this.oxygenLevel <= 0) {
                this.oxygenLevel = 0;
                this.takeDamage(0.5 * deltaTime, 'drowning'); // Drowning damage
            }
        } else {
            // Refill oxygen above water
            this.oxygenLevel = Math.min(this.maxOxygen, this.oxygenLevel + this.oxygenRefillRate * deltaTime);
        }
        this.moveSpeed = (this.isSwimming ? SPEED.swim
            : depth > 0.35 ? SPEED.wade // Wading through the shallows is slow going.
            : this.keys.sprint ? SPEED.sprint : SPEED.walk) * (1 + (this.game.gear?.stat('swiftness') || 0) / 100)
            * (this.game.buffs?.factor('speed') || 1) * (1 + (this.game.perks?.value('speed') || 0));
        const engine = this.game.engine;
        this.camera.speed = keyboardSpeed(this.moveSpeed, this.camera.inertia,
            engine?.getFps ? frameFactor(engine.getDeltaTime(), engine.getFps()) : 0);
        // Venom works on its own clock and cannot be dodged or armoured against.
        if (this.poisonLeft > 0) {
            const seconds = Math.min(.05, (this.game.engine?.getDeltaTime?.() ?? 16) / 1000);
            this.poisonLeft -= seconds;
            this.takeDamage(this.poisonRate * seconds, 'venom');
        }
        // A jump cannot carry the player through a dungeon ceiling.
        if (dungeon && this.camera.position.y > dungeon.floorY + dungeon.ceiling - .5) {
            this.camera.position.y = dungeon.floorY + dungeon.ceiling - .5;
            this.jumpVelocity = Math.min(0, this.jumpVelocity);
        }

        if (this.isFlying) {
            // Handle flying controls
            if (this.keys.jump) {
                // Fly upward when space is held
                this.camera.position.y += this.flyingSpeed * deltaTime;
            }

            if (this.keys.descend) {
                // Descend when ctrl is held
                this.camera.position.y -= this.flyingSpeed * deltaTime;
            }
            // Never sink through the ground or the lake bed.
            if (terrain) this.camera.position.y = Math.max(this.camera.position.y, terrainHeight + 2);

        } else if (this.isSwimming) {
            // Tread water at the surface; hold descend to dive, jump to rise.
            if (this.keys.descend) {
                this.camera.position.y -= this.swimSpeed * deltaTime;
            } else if (this.keys.jump || y < surface) {
                this.camera.position.y = Math.min(surface,
                    y + (this.keys.jump ? this.swimSpeed : 0.05) * deltaTime);
            } else {
                this.camera.position.y = Math.max(surface, y - 0.06 * deltaTime);
            }
            // Keep the player above the lake bed.
            this.camera.position.y = Math.max(this.camera.position.y, terrainHeight + 0.7);

            // Reset jump parameters while swimming
            this.isGrounded = false;
            this.isJumping = false;
            this.jumpCount = 0;
            this.jumpVelocity = 0;
            this.canDoubleJump = false;

        } else if (wasSwimming) {
            // Feet found the bottom again: walk out of the lake.
            this.isGrounded = true;
            this.jumpVelocity = 0;
            if (terrain) this.camera.position.y = terrainHeight + 2;

        } else if (!this.isGrounded) {
            // Normal jumping and gravity when not flying or swimming
            this.jumpVelocity -= this.gravity * deltaTime;
            this.camera.position.y += this.jumpVelocity * deltaTime;

            // Check if we've landed
            // Make sure terrainSystem is initialized before trying to get height
            if (terrain) {
                if (this.camera.position.y <= terrainHeight + 2 && this.jumpVelocity <= 0) {
                    this.camera.position.y = terrainHeight + 2;
                    this.isGrounded = true;
                    this.isJumping = false;
                    this.jumpCount = 0;
                    this.canDoubleJump = false;
                }
            }

            // Check for fall damage
            if (this.isGrounded && this.jumpVelocity < -0.6) {
                // Calculate fall damage based on velocity
                const fallDamage = (Math.abs(this.jumpVelocity) - 0.6) * 50;
                if (fallDamage > 0) {
                    this.takeDamage(fallDamage, 'a long fall');
                }
            }
        } else {
            // Keep camera at terrain height when grounded
            if (terrain) {
                this.camera.position.y = terrainHeight + 2;
            }
        }
    }

    // Handle player taking damage. `cause` names what hurt the player and is
    // A sting: `rate` health a second for `seconds`. A fresh sting restarts the clock.
    poison(rate, seconds) {
        if (this.isDead || this.game.buffs?.has('antivenom')) return;
        if (!(this.poisonLeft > 0)) this.game.uiSystem?.showNotification?.('Poisoned · It will pass');
        this.poisonRate = Math.max(this.poisonLeft > 0 ? this.poisonRate || 0 : 0, rate);
        this.poisonLeft = Math.max(this.poisonLeft || 0, seconds);
    }

    // shown on the death screen.
    takeDamage(amount, cause = 'the wilds') {
        if (this.isDead || !(amount > 0)) return;
        // Armour turns blows, but does nothing against hunger, cold or water.
        if (!ENVIRONMENTAL.has(cause)) {
            if (performance.now() < (this.invulnerableUntil || 0)) return; // Dodged.
            amount *= (1 - (this.game.gear?.stat('armor') || 0) / 100) * (this.game.buffs?.factor('defence') || 1)
                * difficultyOf(this.game.settings).damage;
        }
        this.health -= amount;
        this.lastDamageCause = cause;

        // Sudden blows land at once; gradual harm pulses every few points.
        if (amount >= 3) this.game.effects?.hurt?.(amount);
        else {
            this.slowDamage += amount;
            if (this.slowDamage >= 4) { this.slowDamage = 0; this.game.effects?.hurt?.(1); }
        }

        // Check for death
        if (this.health <= 0) {
            this.health = 0;
            this.isDead = true;
            this.game.progression?.record('deaths');
            this.game.audio?.play('death');

            // Save respawn position
            this.respawnPoint = {
                x: this.camera.position.x,
                y: this.camera.position.y,
                z: this.camera.position.z
            };
        }

        // Update UI if available
        if (this.game.uiSystem) {
            this.game.uiSystem.updateHealthUI(this.health, this.maxHealth);
        }
    }

    // Handle death and respawning
    // Respawning is a gaming term for bringing a character back to life after death
    // This process typically involves a delay and returning to a designated spawn point
    handleDeath() {
        // Drop loot once
        if (!this.lootDropped) {
            this.dropLoot();
            this.lootDropped = true;
            
            this.game.buildSystem?.cancelPlacement?.();
            this.game.uiSystem?.showDeath?.(this.lastDamageCause);

            // Set timer for respawn (a pause to read the summary before returning)
            setTimeout(() => this.respawn(), 4500);
        }
    }
    
    // Drop player's inventory items as loot
    dropLoot() {
        // If inventory system exists, drop items
        if (this.game.inventorySystem) {
            // Falling underground leaves the pack outside, by the entrance.
            const dropPosition = this.game.dungeonSystem?.deathDropPosition?.() || {
                x: this.camera.position.x,
                y: this.camera.position.y,
                z: this.camera.position.z
            };
            
            this.game.inventorySystem.dropAllItems(dropPosition);
        }
    }
    
    // Respawn player
    // This method resets the player's state and returns them to the spawn point
    // Part of the death/respawn cycle in survival games that allows players to continue after dying
    respawn() {
        // Dying underground ends the run: wake at camp, not in the dark.
        this.game.dungeonSystem?.leave?.(false);
        // Reset health
        this.health = this.maxHealth;
        this.isDead = false;
        this.lootDropped = false;
        
        // Move to spawn point
        if (this.game.terrainSystem && this.game.terrainSystem.spawnPosition) {
            const spawnX = this.game.terrainSystem.spawnPosition.x;
            const spawnZ = this.game.terrainSystem.spawnPosition.z;
            const spawnY = this.game.terrainSystem.spawnHeight + 2;
            
            this.camera.position = new BABYLON.Vector3(spawnX, spawnY, spawnZ);
        }
        
        // Reset other states
        this.jumpVelocity = 0;
        this.isGrounded = true;
        this.isJumping = false;
        this.isFlying = false;
        this.isSwimming = false;
        this.isUnderwater = false;
        this.slowDamage = 0;
        this.oxygenLevel = this.maxOxygen;
        
        this.game.survivalSystem && Object.assign(this.game.survivalSystem, {hunger: 75, thirst: 75, cold: 0});
        this.game.uiSystem?.hideDeath?.();
        
        // Update UI
        if (this.game.uiSystem) {
            this.game.uiSystem.updateHealthUI(this.health, this.maxHealth);
        }
        this.game.saveSystem?.save();
    }
}
