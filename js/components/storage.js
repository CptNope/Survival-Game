import { CHEST_CAPACITY, storedTotal, moveItems, sanitizeStores } from '../storage.js';
import { ITEMS } from '../resources.js';

// What each storage chest holds, keyed by the chest's structure id. Things in
// a chest are safe: dying drops only what you carry.
export class StorageSystem {
    constructor(game) {
        this.game = game;
        this.stores = new Map();
        this.open = null;   // The id of the chest whose lid is up.
    }

    chestNear(position, reach = 3) {
        let best = null, nearest = reach;
        for (const item of this.game.buildSystem.structures) {
            if (item.type !== 'chest') continue;
            const distance = Math.hypot(position.x - item.x, position.z - item.z);
            if (distance <= nearest) { nearest = distance; best = item; }
        }
        return best;
    }

    contents(id) {
        if (!this.stores.has(id)) this.stores.set(id, {});
        return this.stores.get(id);
    }

    room(id) { return CHEST_CAPACITY - storedTotal(this.stores.get(id)); }

    interaction() {
        if (this.game.dungeonSystem?.active) return null;
        const chest = this.chestNear(this.game.playerSystem.camera.position);
        if (!chest) return null;
        return {label: 'Press E to open the storage chest', act: () => { this.open = chest.id; this.game.uiSystem?.openStorage?.(chest.id); return true; }};
    }

    // amount: a number, or 'all'.
    store(id, item, amount = 1) {
        const pack = this.game.inventorySystem.inventory;
        const moved = moveItems(pack, this.contents(id), item, amount === 'all' ? pack[item] || 0 : amount, this.room(id));
        if (moved) this.changed();
        else if ((pack[item] || 0) > 0) this.game.uiSystem?.showNotification?.('The chest is full');
        return moved;
    }

    take(id, item, amount = 1) {
        const chest = this.contents(id), pack = this.game.inventorySystem.inventory;
        const moved = moveItems(chest, pack, item, amount === 'all' ? chest[item] || 0 : amount);
        if (chest[item] === 0) delete chest[item];
        if (moved) this.changed();
        return moved;
    }

    changed() {
        const game = this.game;
        game.audio?.play('click');
        game.effects?.refreshHeld?.();
        game.uiSystem?.updateInventoryUI?.();
        game.saveSystem?.save?.();
    }

    // Rows for the panel: every kind of thing in the pack or the chest.
    rows(id) {
        const pack = this.game.inventorySystem.inventory, chest = this.stores.get(id) || {};
        return Object.keys(ITEMS).filter(item => (pack[item] || 0) > 0 || (chest[item] || 0) > 0)
            .map(item => ({item, name: ITEMS[item], carried: pack[item] || 0, stored: chest[item] || 0}));
    }

    capture() { return [...this.stores].filter(([, items]) => storedTotal(items) > 0).map(([id, items]) => ({id, items: {...items}})); }

    restore(saved) {
        const chests = new Set(this.game.buildSystem.structures.filter(item => item.type === 'chest').map(item => item.id));
        this.stores = new Map(sanitizeStores(saved, id => chests.has(id)).map(entry => [entry.id, entry.items]));
        this.open = null;
    }
}
