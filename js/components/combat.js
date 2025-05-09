// Combat system for handling player combat and experience
export class CombatSystem {
    constructor(game) {
        this.game = game;
        
        // Combat properties
        this.isAttacking = false;
        this.attackPower = 10;
        
        // Player stats
        this.health = 100;
        this.maxHealth = 100;
        this.experience = 0;
        this.level = 1;
        this.expToNextLevel = 100;
    }
    
    tryAttack() {
        if (this.isAttacking) return;
        
        this.isAttacking = true;
        // Cooldown is a gaming term for a period during which an action cannot be performed again
        // This prevents players from attacking too rapidly and balances gameplay
        setTimeout(() => { this.isAttacking = false; }, 500); // Attack cooldown of 500ms
        
        // Create a ray from the camera to detect what we're looking at
        const ray = this.game.scene.createPickingRay(
            this.game.scene.pointerX, 
            this.game.scene.pointerY, 
            BABYLON.Matrix.Identity(), 
            this.game.playerSystem.camera
        );
        
        const hit = this.game.scene.pickWithRay(ray);
        
        if (hit && hit.hit) {
            // Check if we hit an animal
            for (let animal of this.game.animalSystem.animals) {
                if (hit.pickedMesh === animal.mesh || hit.pickedMesh.parent === animal.mesh) {
                    // Calculate damage based on level and tools
                    let damage = this.attackPower + (this.level - 1) * 2;
                    
                    // Apply damage
                    animal.health -= damage;
                    
                    // Visual feedback
                    animal.mesh.scaling.y = 0.8; // Squish effect
                    setTimeout(() => { if (animal.mesh) animal.mesh.scaling.y = 1; }, 200);
                    
                    break;
                }
            }
        }
    }
    
    specialAttack() {
        if (this.isAttacking || this.game.inventorySystem.inventory.tools <= 0) return;
        
        // Use a tool
        this.game.inventorySystem.inventory.tools--;
        this.game.uiSystem.updateInventoryUI();
        
        this.isAttacking = true;
        setTimeout(() => { this.isAttacking = false; }, 1000); // Longer cooldown
        
        // Attack all animals within range
        const attackRange = 10;
        let animalHit = false;
        
        for (let animal of this.game.animalSystem.animals) {
            const distance = BABYLON.Vector3.Distance(this.game.playerSystem.camera.position, animal.mesh.position);
            if (distance < attackRange) {
                // Apply heavy damage
                animal.health -= this.attackPower * 3;
                animalHit = true;
                
                // Visual feedback
                animal.mesh.scaling.y = 0.5; // Stronger squish effect
                setTimeout(() => { if (animal.mesh) animal.mesh.scaling.y = 1; }, 300);
            }
        }
        
        // Give some experience for using special attack
        if (animalHit) {
            this.gainExperience(10);
        }
    }
    
    // Experience and leveling system
    gainExperience(amount) {
        this.experience += amount;
        console.log(`Gained ${amount} experience. Total: ${this.experience}/${this.expToNextLevel}`);
        
        // Check for level up
        if (this.experience >= this.expToNextLevel) {
            this.levelUp();
        }
        
        // Update UI - directly update the experience UI
        if (this.game.uiSystem) {
            this.game.uiSystem.updateExperienceUI();
        }
    }
    
    levelUp() {
        this.level++;
        this.experience -= this.expToNextLevel;
        this.expToNextLevel = Math.floor(this.expToNextLevel * 1.5); // Increase exp needed for next level
        this.maxHealth += 20;
        this.health = this.maxHealth; // Heal on level up
        this.attackPower += 5;
        
        console.log(`Leveled up to ${this.level}! Next level at ${this.expToNextLevel} exp`);
        
        // Update UI
        if (this.game.uiSystem) {
            this.game.uiSystem.updateExperienceUI();
            this.game.uiSystem.updateHealthUI(this.health, this.maxHealth);
            
            // Show level up message
            this.game.uiSystem.showLevelUpMessage();
        }
    }
}
