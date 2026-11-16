import { createLootModel } from '../models/wilderness.js';
import { ITEMS, RESOURCES, RECIPES, hitsNeeded } from '../resources.js';

const SWING_COOLDOWN_MS = 330;
const AIM_ASSISTED = new Set(['fiber', 'herb', 'berry']);
const AIM_ASSIST_RADIUS = .8;
const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

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

        // Earliest time the next gathering swing may land.
        this.nextSwingAt = 0;
    }

    isMeshOf(obj, mesh) {
        return mesh === obj.mesh || Boolean(obj.relatedMeshes?.includes(mesh));
    }

    // The gatherable node under the reticle, if any. Thin plants are nearly
    // impossible to hit exactly, so aiming close to one is enough.
    findTarget(hit = this.game.pickTarget?.()) {
        const struck = hit?.hit ? hit.pickedMesh : null;
        if (struck) {
            const direct = this.harvestableObjects.find(obj => this.isMeshOf(obj, struck));
            if (direct) return direct;
            // Looking straight at an animal means attack, not forage.
            if (this.game.animalSystem?.animals?.some(animal =>
                struck === animal.mesh || struck.isDescendantOf?.(animal.mesh))) return null;
        }
        return this.assistTarget();
    }

    assistTarget() {
        const camera = this.game.playerSystem?.camera;
        if (!camera?.getForwardRay) return null;
        const ray = camera.getForwardRay(5), o = ray.origin, d = ray.direction;
        let best = null, closest = AIM_ASSIST_RADIUS;
        for (const obj of this.harvestableObjects) {
            if (!AIM_ASSISTED.has(obj.type) || !obj.mesh?.position) continue;
            const p = obj.mesh.position;
            const vx = p.x - o.x, vy = p.y + .45 - o.y, vz = p.z - o.z;
            const along = vx * d.x + vy * d.y + vz * d.z;
            if (along < .3 || along > 5) continue;
            const off = Math.hypot(vx - d.x * along, vy - d.y * along, vz - d.z * along);
            if (off < closest) { best = obj; closest = off; }
        }
        return best;
    }

    // One swing at the targeted node. Returns true when the swing connected,
    // including the swings that only wear the node down.
    tryHarvest() {
        if (this.game.paused || this.game.playerSystem.isDead) return false;
        const hit = this.game.pickTarget();
        const obj = this.findTarget(hit);
        if (!obj) return false;
        const resource = RESOURCES[obj.type];
        if (!resource) return false;
        const now = clock();
        if (now < this.nextSwingAt) return false;
        const needed = hitsNeeded(obj.type, this.inventory);
        if (!Number.isFinite(needed)) {
            this.game.uiSystem.showNotification('Craft a stone or iron tool to mine this deposit');
            this.game.audio?.play('deny');
            this.nextSwingAt = now + this.swingCooldown();
            return false;
        }
        this.nextSwingAt = now + this.swingCooldown();
        obj.hits = (obj.hits || 0) + 1;
        const finished = obj.hits >= needed;
        const direct = Boolean(hit?.hit && this.isMeshOf(obj, hit.pickedMesh) && hit.pickedPoint);
        const point = direct ? hit.pickedPoint : obj.mesh.position;
        this.game.audio?.play(resource.sound);
        this.game.effects?.strike(obj, point, resource.debris, finished);
        if (!finished) {
            this.game.uiSystem.showGatherProgress?.(obj.hits, needed, resource);
            return true;
        }

        const bonus = obj.type === 'ore' && this.inventory.ironTools > 0 ? 1 : 0;
        const gained = Object.entries(resource.yields).map(([item, amount]) => {
            this.inventory[item] += amount + bonus;
            return `+${amount + bonus} ${ITEMS[item].toLowerCase()}`;
        });
        this.game.uiSystem.showNotification(gained.join(' · '));
        this.game.audio?.play(obj.type === 'tree' ? 'timber' : 'collect');
        this.game.progression?.record('gathered');

        // Trees topple before they are released; everything else goes at once.
        const release = () => {
            obj.mesh.dispose(false, true);
            for (const relatedMesh of obj.relatedMeshes || []) relatedMesh?.dispose?.(false, true);
        };
        if (this.game.effects?.fell) this.game.effects.fell(obj, release);
        else release();

        const index = this.harvestableObjects.indexOf(obj);
        if (index >= 0) this.harvestableObjects.splice(index, 1);
        // A depleted location stays depleted when its chunk unloads, until it regrows.
        if (obj.resourceId) {
            const terrain = this.game.terrainSystem;
            terrain?.harvestedIds?.add(obj.resourceId);
            terrain?.harvestedOn?.set(obj.resourceId, this.game.dayCount || 1);
        }

        this.game.uiSystem.updateInventoryUI();
        this.game.saveSystem?.save();
        return true;
    }

    swingCooldown() {
        return SWING_COOLDOWN_MS / (1 + (this.game.gear?.stat('haste') || 0) / 100);
    }

    // True while the last swing is still recovering.
    swinging() { return clock() < this.nextSwingAt; }

    canCraft(type) {
        const recipe = RECIPES[type];
        const player = this.game.playerSystem;
        return !!recipe && !player.isDead
            && (!recipe.unique || !this.inventory[recipe.output])
            && (!(recipe.heal || recipe.hunger) || player.health < player.maxHealth ||
                (recipe.hunger && this.game.survivalSystem?.hunger < 100))
            && (!recipe.requiresFire || this.game.buildSystem?.nearFire(this.game.playerSystem.camera.position))
            && Object.entries(recipe.cost).every(([item, count]) => this.inventory[item] >= count);
    }
    // Why a recipe is unavailable, for the crafting panel.
    blockedReason(type) {
        const recipe = RECIPES[type];
        if (!recipe || this.canCraft(type)) return '';
        if (recipe.unique && this.inventory[recipe.output]) return 'Already carried';
        if (!Object.entries(recipe.cost).every(([item, count]) => this.inventory[item] >= count)) return 'Missing materials';
        if (recipe.requiresFire) return 'Stand by a campfire';
        return 'Not needed right now';
    }
    craft(type) {
        const recipe = RECIPES[type];
        if (!this.canCraft(type)) return false;
        for (const [item, count] of Object.entries(recipe.cost)) this.inventory[item] -= count;
        if (recipe.heal || recipe.hunger) {
            const player = this.game.playerSystem;
            const healed = recipe.heal ? Math.min(recipe.heal, player.maxHealth - player.health) : 0;
            player.health += healed;
            if (recipe.hunger) this.game.survivalSystem?.eatBerries(recipe.hunger);
            this.game.uiSystem.showNotification(recipe.hunger
                ? (recipe.meal ? 'Ate a hot meal · Hunger restored' : 'Ate berries · Hunger restored')
                : `Recovered ${healed} health`);
            this.game.audio?.play(recipe.hunger ? 'eat' : 'heal');
            if (recipe.meal) this.game.progression?.record('meals');
        } else {
            this.inventory[recipe.output] += recipe.amount;
            this.game.uiSystem.showNotification(`Crafted ${recipe.name.toLowerCase()}`);
            this.game.audio?.play(recipe.requiresFire ? 'sizzle' : 'craft');
            this.game.progression?.record('crafted');
            this.game.effects?.refreshHeld?.();
        }
        this.game.uiSystem.updateInventoryUI();
        this.game.saveSystem?.save();
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
        this.game.effects?.refreshHeld?.();
    }

    // Create a loot bag at the specified position
    createLootBag(position, itemType, count, scatter = true) {
        // Create a mesh for the loot bag
        const lootBag = createLootModel(this.game.scene, itemType);
        lootBag.name = `loot_${itemType}_${Date.now()}`;
        lootBag.isPickable = false; // Never block the reticle from what lies behind it.

        // Position the loot bag on the ground rather than at eye height.
        lootBag.position.x = position.x + (scatter ? (Math.random() - 0.5) * 2.6 : 0); // Scatter on death, not restore.
        lootBag.position.z = position.z + (scatter ? (Math.random() - 0.5) * 2.6 : 0);
        const ground = this.game.terrainSystem?.getPerlinHeight?.(lootBag.position.x, lootBag.position.z);
        const water = this.game.terrainSystem?.waterHeight;
        lootBag.position.y = scatter && Number.isFinite(ground)
            ? Math.max(ground, Number.isFinite(water) ? water : -Infinity) + .25
            : position.y;

        const lootMaterial = lootBag.material;
        lootMaterial.emissiveColor = new BABYLON.Color3(0.22, 0.2, 0.1);

        // Make the loot bag rotate slowly
        const spin = this.game.scene.onBeforeRenderObservable.add(() => {
            lootBag.rotation.y += 0.02;
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
        let collected = false;

        // Check each dropped item
        for (let i = this.droppedItems.length - 1; i >= 0; i--) {
            const item = this.droppedItems[i];
            // Horizontal distance: the camera rides two units above the ground.
            const distance = Math.hypot(playerPos.x - item.position.x, playerPos.z - item.position.z);

            // If player is within pickup range
            if (distance <= this.pickupRange && Math.abs(playerPos.y - item.position.y) < 6) {
                // Add items to inventory
                this.inventory[item.itemType] += item.count;

                // Remove loot bag
                item.mesh.dispose();
                this.droppedItems.splice(i, 1);
                collected = true;
            }
        }
        if (collected) {
            this.game.uiSystem?.updateInventoryUI();
            this.game.uiSystem?.showNotification?.('Recovered dropped supplies');
            this.game.audio?.play('collect');
            this.game.effects?.refreshHeld?.();
        }
    }

    // Update method to be called regularly
    update() {
        // Check for nearby loot
        this.checkForLoot();
    }
}
