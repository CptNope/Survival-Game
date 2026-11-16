// What the player has found and is wearing. Gear lives outside the resource
// pack: it is kept on death, has four equipped slots and a bag, and its
// bonuses feed combat, survival and movement through `stat()`.
import { RARITIES, SLOTS, rarityIndex, rollGear, totalStats, sanitizeGear, salvageValue, gearScore } from '../gear.js';
import { createGearDropModel } from '../models/creatures.js';

export const BAG_SIZE = 24;
const PICKUP_RANGE = 2.4;

export class GearSystem {
    constructor(game) {
        this.game = game;
        this.equipped = Object.fromEntries(Object.keys(SLOTS).map(slot => [slot, null]));
        this.bag = [];
        this.drops = [];
        this.totals = totalStats(this.equipped);
        this.appliedVitality = 0; // Bonus health currently folded into the player's maximum.
    }

    // Total bonus from everything equipped (already capped).
    stat(name) { return this.totals[name] || 0; }

    recalculate() {
        this.totals = totalStats(this.equipped);
        const player = this.game.playerSystem;
        if (player) {
            const change = this.totals.vitality - this.appliedVitality;
            player.maxHealth += change;
            this.appliedVitality = this.totals.vitality;
            // Putting armour on adds its health; taking it off never kills.
            player.health = Math.max(Math.min(1, player.health), Math.min(player.maxHealth, player.health + Math.max(0, change)));
        }
        this.game.uiSystem?.updateGearUI?.();
    }

    find(id) {
        return this.bag.find(item => item.id === id) || Object.values(this.equipped).find(item => item?.id === id) || null;
    }

    // Take a new item. Fills an empty slot straight away; a full bag breaks it down instead.
    add(item, announce = true) {
        const game = this.game;
        if (!item) return false;
        const grade = RARITIES[rarityIndex(item.rarity)];
        game.progression?.record('gearFound');
        if (!this.equipped[item.slot]) {
            this.equipped[item.slot] = item;
            this.recalculate();
            if (announce) game.uiSystem?.showLoot?.(item, 'Equipped');
        } else if (this.bag.length >= BAG_SIZE) {
            const value = salvageValue(item);
            game.combatSystem?.gainExperience(value.xp);
            if (announce) game.uiSystem?.showNotification?.(`Gear bag full · ${item.name} broken down for ${value.xp} XP`);
            return false;
        } else {
            this.bag.push(item);
            game.uiSystem?.updateGearUI?.();
            if (announce) game.uiSystem?.showLoot?.(item, 'Found');
        }
        if (announce) game.audio?.play(rarityIndex(item.rarity) >= 3 ? 'legendary' : 'loot', {pitch: 1 + rarityIndex(item.rarity) * .08});
        game.progression?.check?.();
        return true;
    }

    equip(id) {
        const index = this.bag.findIndex(item => item.id === id);
        if (index < 0) return false;
        const item = this.bag[index], previous = this.equipped[item.slot];
        this.bag.splice(index, 1);
        if (previous) this.bag.push(previous);
        this.equipped[item.slot] = item;
        this.recalculate();
        this.game.audio?.play('equip');
        this.game.progression?.check?.();
        this.game.saveSystem?.save();
        return true;
    }

    unequip(slot) {
        const item = this.equipped[slot];
        if (!item || this.bag.length >= BAG_SIZE) return false;
        this.equipped[slot] = null;
        this.bag.push(item);
        this.recalculate();
        this.game.audio?.play('equip');
        this.game.saveSystem?.save();
        return true;
    }

    salvage(id) {
        const index = this.bag.findIndex(item => item.id === id);
        if (index < 0) return false;
        const [item] = this.bag.splice(index, 1);
        const value = salvageValue(item);
        this.game.combatSystem?.gainExperience(value.xp);
        if (value.iron && this.game.inventorySystem) this.game.inventorySystem.inventory.iron += value.iron;
        this.game.uiSystem?.showNotification?.(`Broke down ${item.name} · +${value.xp} XP${value.iron ? ` · +${value.iron} iron` : ''}`);
        this.game.uiSystem?.updateInventoryUI?.();
        this.game.uiSystem?.updateGearUI?.();
        this.game.audio?.play('craft');
        this.game.saveSystem?.save();
        return true;
    }

    // Break down every bag item below a grade, for clearing out a full bag.
    salvageBelow(rarity) {
        const limit = rarityIndex(rarity);
        const ids = this.bag.filter(item => rarityIndex(item.rarity) < limit).map(item => item.id);
        for (const id of ids) this.salvage(id);
        return ids.length;
    }

    // Is `item` better than what is worn in its slot? Used to flag upgrades.
    isUpgrade(item) {
        const worn = this.equipped[item.slot];
        return !worn || gearScore(item) * (1 + item.level * .2) > gearScore(worn) * (1 + worn.level * .2);
    }

    // --- Items lying in the world -----------------------------------------
    dropRoll(position, options = {}) {
        return this.drop(rollGear(Math.random, options), position);
    }

    drop(item, position) {
        const colour = RARITIES[rarityIndex(item.rarity)].color;
        const mesh = createGearDropModel(this.game.scene, colour);
        mesh.position.copyFrom(position);
        this.drops.push({item, mesh, age: 0, underground: Boolean(this.game.dungeonSystem?.active)});
        return item;
    }

    takeDrop(index, announce = true) {
        const [drop] = this.drops.splice(index, 1);
        drop.mesh.dispose(false, true);
        this.add(drop.item, announce);
    }

    // Leaving a floor: anything not yet picked up comes along.
    collectStragglers() {
        let taken = 0;
        for (let i = this.drops.length - 1; i >= 0; i--) {
            if (!this.drops[i].underground) continue;
            this.takeDrop(i, false);
            taken++;
        }
        if (taken) this.game.uiSystem?.showNotification?.(`Gathered ${taken} piece${taken === 1 ? '' : 's'} of gear left behind`);
        return taken;
    }

    update(dt) {
        if (!this.drops.length) return;
        const player = this.game.playerSystem;
        const position = player.camera.position;
        for (let i = this.drops.length - 1; i >= 0; i--) {
            const drop = this.drops[i];
            drop.age += dt;
            const gem = drop.mesh.metadata?.gem;
            if (gem) { gem.rotation.y += dt * 2.2; gem.position.y = .6 + Math.sin(drop.age * 3) * .08; }
            // A short delay lets the gem be seen before it is swept up.
            if (drop.age < .45 || player.isDead) continue;
            const spot = drop.mesh.position;
            if (Math.hypot(spot.x - position.x, spot.z - position.z) < PICKUP_RANGE && Math.abs(position.y - 2 - spot.y) < 4) this.takeDrop(i);
        }
    }

    // --- Saving -------------------------------------------------------------
    capture() {
        return {
            equipped: Object.fromEntries(Object.entries(this.equipped).map(([slot, item]) => [slot, item ? {...item} : null])),
            // Gear on the ground is kept too, so closing the game never eats a drop.
            bag: [...this.bag, ...this.drops.map(drop => drop.item)].slice(0, BAG_SIZE).map(item => ({...item}))
        };
    }

    restore(saved) {
        for (const drop of this.drops) drop.mesh.dispose(false, true);
        this.drops = [];
        const seen = new Set();
        const clean = raw => {
            const item = sanitizeGear(raw);
            if (!item) return null;
            while (seen.has(item.id)) item.id += 'x';
            seen.add(item.id);
            return item;
        };
        for (const slot of Object.keys(SLOTS)) {
            const item = clean(saved?.equipped?.[slot]);
            this.equipped[slot] = item && item.slot === slot ? item : null;
        }
        this.bag = (Array.isArray(saved?.bag) ? saved.bag : []).map(clean).filter(Boolean).slice(0, BAG_SIZE);
        // The save holds the player's own maximum; add this gear's health on top.
        this.appliedVitality = 0;
        this.recalculate();
    }
}
