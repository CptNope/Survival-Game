import { createLootModel } from '../models/wilderness.js';
import { ITEMS, RESOURCES, RECIPES } from '../resources.js';
// Inventory system for handling resources and crafting
export class InventorySystem {
    constructor(game) {
        this.game = game;

        // Inventory
        this.inventory = Object.fromEntries(Object.keys(ITEMS).map(key => [key, 0]));

        // Harvestable objects
        this.harvestableObjects = [];

        // Dropped loot items
        this.droppedItems = [];

        // Loot pickup range
        this.pickupRange = 3; // Distance in units player can pick up items
    }

    tryHarvest() {
        if (this.game.paused || this.game.playerSystem.isDead) return;
        const hit = this.game.pickTarget();
        if (hit && hit.hit) {
            // Check if we hit a harvestable object
            for (let i = this.harvestableObjects.length - 1; i >= 0; i--) {
                const obj = this.harvestableObjects[i];
                if (hit.pickedMesh === obj.mesh || obj.relatedMeshes?.includes(hit.pickedMesh)) {
                    const resource = RESOURCES[obj.type];
                    if (!resource) return;
                    if (resource.requiresTool && !this.inventory.tools && !this.inventory.ironTools) {
                        this.game.uiSystem.showNotification('Craft a stone or iron tool to mine this deposit');
                        return;
                    }
                    const bonus = obj.type === 'ore' && this.inventory.ironTools > 0 ? 1 : 0;
                    const gained = Object.entries(resource.yields).map(([item, amount]) => {
                        this.inventory[item] += amount + bonus;
                        return `+${amount + bonus} ${ITEMS[item].toLowerCase()}`;
                    });
                    this.game.uiSystem.showNotification(gained.join(' · '));
                    // Remove the harvested object and any related meshes
                    obj.mesh.dispose(false, true);

                    // Dispose of any related meshes (like tree leaves)
                    if (obj.relatedMeshes && Array.isArray(obj.relatedMeshes)) {
                        for (const relatedMesh of obj.relatedMeshes) {
                            if (relatedMesh && relatedMesh.dispose) {
                                relatedMesh.dispose(false, true);
                            }
                        }
                    }

                    this.harvestableObjects.splice(i, 1);
                    // A depleted location should stay depleted when its chunk unloads.
                    if (obj.resourceId) this.game.terrainSystem?.harvestedIds?.add(obj.resourceId);

                    // Update UI
                    this.game.uiSystem.updateInventoryUI();
                    break;
                }
            }
        }
    }

    canCraft(type) {
        const recipe = RECIPES[type];
        const player = this.game.playerSystem;
        return !!recipe && !player.isDead
            && (!recipe.heal || player.health < player.maxHealth)
            && Object.entries(recipe.cost).every(([item, count]) => this.inventory[item] >= count);
    }
    craft(type) {
        const recipe = RECIPES[type];
        if (!this.canCraft(type)) return false;
        for (const [item, count] of Object.entries(recipe.cost)) this.inventory[item] -= count;
        if (recipe.heal) {
            const player = this.game.playerSystem;
            const healed = Math.min(recipe.heal, player.maxHealth - player.health);
            player.health += healed;
            this.game.uiSystem.showNotification(`Recovered ${healed} health`);
        } else {
            this.inventory[recipe.output] += recipe.amount;
            this.game.uiSystem.showNotification(`Crafted ${recipe.name.toLowerCase()}`);
        }
        this.game.uiSystem.updateInventoryUI();
        return true;
    }
    craftPlanks() { return this.craft('planks'); }
    craftTool() { return this.craft('tools'); }

    // Drop all items when player dies
    dropAllItems(position) {
        // Create loot objects for each item type that player has
        for (const itemType in this.inventory) {
            const count = this.inventory[itemType];
            if (count > 0) {
                // Create a loot bag for each item type
                this.createLootBag(position, itemType, count);
                // Clear inventory
                this.inventory[itemType] = 0;
            }
        }

        // Update UI
        if (this.game.uiSystem) {
            this.game.uiSystem.updateInventoryUI();
        }

        console.log('Dropped all items at', position);
    }

    // Create a loot bag at the specified position
    createLootBag(position, itemType, count) {
        // Create a mesh for the loot bag
        const lootBag = createLootModel(this.game.scene, itemType);
        lootBag.name = `loot_${itemType}_${Date.now()}`;

        // Position the loot bag
        lootBag.position.x = position.x + (Math.random() - 0.5) * 2; // Scatter slightly
        lootBag.position.y = position.y;
        lootBag.position.z = position.z + (Math.random() - 0.5) * 2; // Scatter slightly

        const lootMaterial = lootBag.material;
        lootMaterial.emissiveColor = new BABYLON.Color3(0.12, 0.12, 0.08);

        // Make the loot bag rotate slowly
        const spin = this.game.scene.onBeforeRenderObservable.add(() => {
            lootBag.rotation.y += 0.01;
        });

        lootBag.onDisposeObservable.add(() => {
            this.game.scene.onBeforeRenderObservable.remove(spin);
            lootMaterial.dispose();
        });
        // Add to dropped items array
        this.droppedItems.push({
            mesh: lootBag,
            itemType: itemType,
            count: count,
            position: {
                x: lootBag.position.x,
                y: lootBag.position.y,
                z: lootBag.position.z
            },
            createdTime: Date.now()
        });
    }

    // Check for nearby loot to pick up
    checkForLoot() {
        if (!this.game.playerSystem || this.game.playerSystem.isDead || this.droppedItems.length === 0) {
            return;
        }

        const playerPos = this.game.playerSystem.camera.position;

        // Check each dropped item
        for (let i = this.droppedItems.length - 1; i >= 0; i--) {
            const item = this.droppedItems[i];

            // Calculate distance to player
            const distance = BABYLON.Vector3.Distance(
                new BABYLON.Vector3(playerPos.x, playerPos.y, playerPos.z),
                new BABYLON.Vector3(item.position.x, item.position.y, item.position.z)
            );

            // If player is within pickup range
            if (distance <= this.pickupRange) {
                // Add items to inventory
                this.inventory[item.itemType] += item.count;

                // Remove loot bag
                item.mesh.dispose();
                this.droppedItems.splice(i, 1);

                // Update UI
                if (this.game.uiSystem) {
                    this.game.uiSystem.updateInventoryUI();
                }

                console.log(`Picked up ${item.count} ${item.itemType}`);
            }
        }
    }

    // Update method to be called regularly
    update() {
        // Check for nearby loot
        this.checkForLoot();
    }
}
