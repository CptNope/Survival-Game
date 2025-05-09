// Inventory system for handling resources and crafting
export class InventorySystem {
    constructor(game) {
        this.game = game;
        
        // Inventory
        this.inventory = {
            wood: 0,
            stone: 0,
            planks: 0,
            tools: 0
        };
        
        // Harvestable objects
        this.harvestableObjects = [];
        
        // Dropped loot items
        this.droppedItems = [];
        
        // Loot pickup range
        this.pickupRange = 3; // Distance in units player can pick up items
    }
    
    tryHarvest() {
        // Create a ray from the camera to detect what we're looking at
        const ray = this.game.scene.createPickingRay(
            this.game.scene.pointerX, 
            this.game.scene.pointerY, 
            BABYLON.Matrix.Identity(), 
            this.game.playerSystem.camera
        );
        
        const hit = this.game.scene.pickWithRay(ray);
        
        if (hit && hit.hit) {
            // Check if we hit a harvestable object
            for (let i = this.harvestableObjects.length - 1; i >= 0; i--) {
                const obj = this.harvestableObjects[i];
                if (hit.pickedMesh === obj.mesh) {
                    // Determine what we harvested
                    if (obj.type === "tree") {
                        this.inventory.wood += 2;
                    } else if (obj.type === "rock") {
                        this.inventory.stone += 2;
                    }
                    
                    // Remove the harvested object and any related meshes
                    obj.mesh.dispose();
                    
                    // Dispose of any related meshes (like tree leaves)
                    if (obj.relatedMeshes && Array.isArray(obj.relatedMeshes)) {
                        for (const relatedMesh of obj.relatedMeshes) {
                            if (relatedMesh && relatedMesh.dispose) {
                                relatedMesh.dispose();
                            }
                        }
                    }
                    
                    this.harvestableObjects.splice(i, 1);
                    
                    // Update UI
                    this.game.uiSystem.updateInventoryUI();
                    break;
                }
            }
        }
    }
    
    craftPlanks() {
        if (this.inventory.wood >= 2) {
            this.inventory.wood -= 2;
            this.inventory.planks += 1;
            this.game.uiSystem.updateInventoryUI();
        }
    }
    
    craftTool() {
        if (this.inventory.planks >= 1 && this.inventory.stone >= 2) {
            this.inventory.planks -= 1;
            this.inventory.stone -= 2;
            this.inventory.tools += 1;
            this.game.uiSystem.updateInventoryUI();
        }
    }
    
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
        const lootBag = BABYLON.MeshBuilder.CreateBox(
            `loot_${itemType}_${Date.now()}`,
            { width: 0.5, height: 0.5, depth: 0.5 },
            this.game.scene
        );
        
        // Position the loot bag
        lootBag.position.x = position.x + (Math.random() - 0.5) * 2; // Scatter slightly
        lootBag.position.y = position.y;
        lootBag.position.z = position.z + (Math.random() - 0.5) * 2; // Scatter slightly
        
        // Create material based on item type
        const lootMaterial = new BABYLON.StandardMaterial(`lootMat_${itemType}`, this.game.scene);
        
        // Set color based on item type
        switch (itemType) {
            case 'wood':
                lootMaterial.diffuseColor = new BABYLON.Color3(0.6, 0.3, 0.1);
                break;
            case 'stone':
                lootMaterial.diffuseColor = new BABYLON.Color3(0.5, 0.5, 0.5);
                break;
            case 'planks':
                lootMaterial.diffuseColor = new BABYLON.Color3(0.8, 0.6, 0.3);
                break;
            case 'tools':
                lootMaterial.diffuseColor = new BABYLON.Color3(0.3, 0.3, 0.7);
                break;
            default:
                lootMaterial.diffuseColor = new BABYLON.Color3(1, 1, 1);
        }
        
        lootMaterial.emissiveColor = new BABYLON.Color3(0.2, 0.2, 0.2); // Slight glow
        lootBag.material = lootMaterial;
        
        // Make the loot bag rotate slowly
        this.game.scene.registerBeforeRender(() => {
            lootBag.rotation.y += 0.01;
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
        if (!this.game.playerSystem || this.droppedItems.length === 0) {
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
