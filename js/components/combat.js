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

    // A spear out-reaches a bare hand or a tool.
    reach() {
        return this.game.inventorySystem?.inventory?.spear > 0 ? 7 : 5;
    }

    // The best weapon carried decides the bonus; they do not stack.
    weaponBonus() {
        const inventory = this.game.inventorySystem?.inventory || {};
        return Math.max(inventory.spear > 0 ? 12 : 0, inventory.ironTools > 0 ? 8 : 0);
    }

    damage() {
        return this.attackPower + (this.level - 1) * 2 + this.weaponBonus();
    }

    // Returns true when the blow landed on an animal.
    tryAttack() {
        if (this.game.paused || this.game.playerSystem.isDead || this.isAttacking) return false;

        this.isAttacking = true;
        // Cooldown is a gaming term for a period during which an action cannot be performed again
        // This prevents players from attacking too rapidly and balances gameplay
        setTimeout(() => { this.isAttacking = false; }, 450); // Attack cooldown

        const hit = this.game.pickTarget(this.reach());
        this.game.effects?.swing?.(this.game.inventorySystem?.inventory?.spear > 0 ? 'spear' : 'tool');

        if (hit && hit.hit) {
            // Check if we hit an animal
            for (let animal of this.game.animalSystem.animals) {
                if (hit.pickedMesh === animal.mesh || hit.pickedMesh.isDescendantOf(animal.mesh)) {
                    this.strike(animal, this.damage(), hit.pickedPoint);
                    return true;
                }
            }
        }
        this.game.audio?.play('whoosh');
        return false;
    }

    // Shared by normal and heavy attacks: damage, recoil and feedback.
    strike(animal, damage, point = null, squish = 0.8) {
        animal.health -= damage;
        animal.fleeTimer = 5; // Prey bolts when struck, wherever the player stands.
        animal.staggerTimer = 0.3;
        const from = this.game.playerSystem.camera?.position;
        if (from && animal.mesh?.position) {
            const dx = animal.mesh.position.x - from.x, dz = animal.mesh.position.z - from.z;
            const length = Math.hypot(dx, dz) || 1;
            animal.knockX = dx / length * 5;
            animal.knockZ = dz / length * 5;
        }

        // Visual feedback
        animal.mesh.scaling.y = squish; // Squish effect
        setTimeout(() => { if (animal.mesh && animal.kind !== 'rabbit') animal.mesh.scaling.y = 1; }, 200);
        this.game.audio?.play('hit');
        this.game.effects?.hitAnimal?.(animal, damage, point);
    }

    specialAttack() {
        if (this.game.paused || this.game.playerSystem.isDead || this.isAttacking) return false;
        if (this.game.inventorySystem.inventory.tools <= 0) {
            this.game.uiSystem?.showNotification?.('A heavy sweep needs a stone tool');
            return false;
        }

        // Attack all animals within range
        const attackRange = 10;
        const targets = this.game.animalSystem.animals.filter(animal =>
            BABYLON.Vector3.Distance(this.game.playerSystem.camera.position, animal.mesh.position) < attackRange);
        if (!targets.length) {
            // Nothing to hit: keep the tool rather than wasting it on thin air.
            this.game.uiSystem?.showNotification?.('Nothing in reach for a heavy sweep');
            return false;
        }

        // The sweep breaks the tool.
        this.game.inventorySystem.inventory.tools--;
        this.game.uiSystem.updateInventoryUI();

        this.isAttacking = true;
        setTimeout(() => { this.isAttacking = false; }, 1000); // Longer cooldown
        this.game.effects?.swing?.('tool', true);
        for (const animal of targets) this.strike(animal, this.attackPower * 3, null, 0.5);
        this.game.effects?.refreshHeld?.();

        // Give some experience for using special attack
        this.gainExperience(10);
        return true;
    }

    // Experience and leveling system
    gainExperience(amount) {
        this.experience += amount;

        // Check for level up
        while (this.experience >= this.expToNextLevel) {
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
        this.game.playerSystem.maxHealth += 20;
        this.game.playerSystem.health = this.game.playerSystem.maxHealth; // Heal on level up
        this.attackPower += 5;
        this.game.audio?.play('levelup');

        // Update UI
        if (this.game.uiSystem) {
            this.game.uiSystem.updateExperienceUI();
            this.game.uiSystem.updateHealthUI(this.game.playerSystem.health, this.game.playerSystem.maxHealth);

            // Show level up message
            this.game.uiSystem.showLevelUpMessage();
        }
    }
}
