// Player system for handling player controls and physics
export class PlayerSystem {
    constructor(game) {
        this.game = game;
        this.scene = game.scene;
        
        // Player properties
        this.jumpHeight = 5;
        this.gravity = 0.5;
        this.jumpVelocity = 0;
        this.isGrounded = true;
        this.isJumping = false;
        
        // Flying properties
        this.isFlying = false;
        this.canDoubleJump = false;
        this.flyingSpeed = 0.2;
        this.jumpCount = 0;
        this.jumpTimer = 0;
        this.jumpTimerThreshold = 300; // ms to detect double jump
        this.flyingHeight = 0;
        
        // Swimming properties
        this.isSwimming = false;
        this.swimSpeed = 0.15;
        this.underwaterDrag = 0.7; // Slows movement underwater
        this.oxygenLevel = 100; // Full oxygen
        this.maxOxygen = 100;
        this.oxygenDepletionRate = 0.2; // How fast oxygen depletes underwater
        this.oxygenRefillRate = 0.5; // How fast oxygen refills above water
        
        // Health and respawn properties
        this.health = 100;
        this.maxHealth = 100;
        this.isDead = false;
        this.respawnPoint = { x: 0, y: 0, z: 0 }; // Default to origin
        this.lootDropped = false; // Track if loot was dropped on death
        
        // Key states
        this.keys = {
            jump: false,  // Space
            descend: false // Ctrl
        };
        
        // Get spawn position from terrain system if available
        let spawnX = 0, spawnY = 2, spawnZ = 0;
        if (this.game.terrainSystem && this.game.terrainSystem.spawnPosition) {
            spawnX = this.game.terrainSystem.spawnPosition.x;
            spawnY = this.game.terrainSystem.spawnPosition.y + 2; // Add player height
            spawnZ = this.game.terrainSystem.spawnPosition.z;
            console.log(`Spawning player at terrain system spawn point: (${spawnX}, ${spawnY}, ${spawnZ})`);
        } else {
            console.log('No terrain spawn point found, using default spawn position');
        }
        
        // Create camera at spawn position
        this.camera = new BABYLON.FreeCamera("playerCamera", new BABYLON.Vector3(0, 5, -10), this.scene);
        this.camera.setTarget(BABYLON.Vector3.Zero());
        this.camera.attachControl(this.game.engine.getRenderingCanvas(), true);
        
        // Set initial position after terrain is generated
        this.scene.executeWhenReady(() => {
            // Wait a bit for terrain to be fully generated
            setTimeout(() => {
                if (this.game.terrainSystem) {
                    const spawnY = this.game.terrainSystem.getPerlinHeight(spawnX, spawnZ) + 2;
                    this.camera.position = new BABYLON.Vector3(spawnX, spawnY, spawnZ);
                    console.log(`Player positioned at (${spawnX}, ${spawnY}, ${spawnZ})`);
                }
            }, 500);
        });
        
        // Movement settings
        this.camera.ellipsoid = new BABYLON.Vector3(1, 1.8, 1);
        this.camera.checkCollisions = true;
        this.camera.applyGravity = false; // We'll handle gravity manually
        this.camera.speed = 0.5;
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
            if (now - this.jumpTimer < this.jumpTimerThreshold) {
                // Double jump detected, activate flying
                this.isFlying = true;
                this.jumpVelocity = this.jumpHeight * 0.5; // Initial upward boost
                this.flyingHeight = this.camera.position.y; // Set current height as base flying height
                console.log('Flying activated!');
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
            console.log('Flying deactivated!');
        }
    }
    
    // Handle key state updates
    updateKeyState(keyCode, isPressed) {
        if (keyCode === 32) { // Space key for jump
            this.keys.jump = isPressed;
        } else if (keyCode === 17) { // Ctrl key for descend
            this.keys.descend = isPressed;
        }
    }
    
    update() {
        const deltaTime = this.game.scene.getAnimationRatio();
        
        // Check for death first
        if (this.isDead) {
            this.handleDeath();
            return; // Skip other updates if dead
        }
        
        // Get current position info
        const x = this.camera.position.x;
        const y = this.camera.position.y;
        const z = this.camera.position.z;
        
        // Check if in water
        let inWater = false;
        if (this.game.terrainSystem) {
            inWater = this.game.terrainSystem.isWaterArea(x, z) && y <= this.game.terrainSystem.waterHeight + 1;
        }
        
        // Update swimming state
        this.isSwimming = inWater;
        
        // Handle oxygen and drowning
        if (this.isSwimming) {
            // Deplete oxygen underwater
            this.oxygenLevel -= this.oxygenDepletionRate * deltaTime;
            
            // Damage player if out of oxygen
            if (this.oxygenLevel <= 0) {
                this.oxygenLevel = 0;
                this.takeDamage(0.5 * deltaTime); // Drowning damage
            }
            
            // Adjust movement speed underwater
            this.camera.speed = this.swimSpeed * this.underwaterDrag;
        } else {
            // Refill oxygen above water
            this.oxygenLevel = Math.min(this.maxOxygen, this.oxygenLevel + this.oxygenRefillRate * deltaTime);
            
            // Reset normal movement speed
            this.camera.speed = 0.5;
        }
        
        if (this.isFlying) {
            // Handle flying controls
            if (this.keys.jump) {
                // Fly upward when space is held
                this.camera.position.y += this.flyingSpeed * deltaTime * 10;
            }
            
            if (this.keys.descend) {
                // Descend when ctrl is held
                this.camera.position.y -= this.flyingSpeed * deltaTime * 10;
            }
            
            // Apply slight hover effect when flying
            this.camera.position.y += Math.sin(Date.now() / 500) * 0.03;
            
            // Check if we've landed while flying (by pressing jump again)
            if (!this.isFlying && this.game.terrainSystem) {
                const terrainHeight = this.game.terrainSystem.getPerlinHeight(x, z);
                if (y <= terrainHeight + 2) {
                    this.camera.position.y = terrainHeight + 2;
                    this.isGrounded = true;
                    this.isJumping = false;
                }
            }
        } else if (this.isSwimming) {
            // Swimming physics
            if (this.keys.jump) {
                // Swim upward when space is held
                this.camera.position.y += this.swimSpeed * deltaTime * 5;
            } else {
                // Gentle sink in water
                this.camera.position.y -= 0.05 * deltaTime;
            }
            
            // Keep player above water bottom
            if (this.game.terrainSystem) {
                const terrainHeight = this.game.terrainSystem.getPerlinHeight(x, z);
                if (y <= terrainHeight + 1) {
                    this.camera.position.y = terrainHeight + 1;
                }
            }
            
            // Reset jump parameters while swimming
            this.isGrounded = false;
            this.isJumping = false;
            this.jumpCount = 0;
            this.canDoubleJump = false;
            
        } else if (!this.isGrounded) {
            // Normal jumping and gravity when not flying or swimming
            this.jumpVelocity -= this.gravity;
            this.camera.position.y += this.jumpVelocity * deltaTime;
            
            // Check if we've landed
            // Make sure terrainSystem is initialized before trying to get height
            if (this.game.terrainSystem) {
                const terrainHeight = this.game.terrainSystem.getPerlinHeight(x, z);
                if (y <= terrainHeight + 2) {
                    this.camera.position.y = terrainHeight + 2;
                    this.isGrounded = true;
                    this.isJumping = false;
                    this.jumpCount = 0;
                    this.canDoubleJump = false;
                }
            }
            
            // Check for fall damage
            if (this.isGrounded && this.jumpVelocity < -10) {
                // Calculate fall damage based on velocity
                const fallDamage = Math.abs(this.jumpVelocity) - 10;
                if (fallDamage > 0) {
                    this.takeDamage(fallDamage);
                }
            }
        } else {
            // Keep camera at terrain height when grounded
            if (this.game.terrainSystem) {
                const terrainHeight = this.game.terrainSystem.getPerlinHeight(x, z);
                this.camera.position.y = terrainHeight + 2;
            }
        }
    }
    
    // Handle player taking damage
    takeDamage(amount) {
        this.health -= amount;
        
        // Check for death
        if (this.health <= 0) {
            this.health = 0;
            this.isDead = true;
            console.log('Player died!');
            
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
            
            // Set timer for respawn (3 seconds delay before player returns to game)
            setTimeout(() => this.respawn(), 3000);
        }
    }
    
    // Drop player's inventory items as loot
    dropLoot() {
        // If inventory system exists, drop items
        if (this.game.inventorySystem) {
            const dropPosition = {
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
        this.isGrounded = true;
        this.isJumping = false;
        this.isFlying = false;
        this.isSwimming = false;
        this.oxygenLevel = this.maxOxygen;
        
        console.log('Player respawned');
        
        // Update UI
        if (this.game.uiSystem) {
            this.game.uiSystem.updateHealthUI(this.health, this.maxHealth);
        }
    }
}
