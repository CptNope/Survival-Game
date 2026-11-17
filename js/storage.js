// Storage chests: what fits and how things move between pack and chest.
import { ITEMS } from './resources.js';

export const CHEST_CAPACITY = 300;   // Items of any kind, in total.

export const storedTotal = store => Object.values(store || {}).reduce((sum, count) => sum + count, 0);

// Move up to `amount` of `item` from one tally to another. `room` is how many
// more the destination can take (Infinity for the pack). Returns how many moved.
export function moveItems(from, to, item, amount, room = Infinity) {
    if (!ITEMS[item]) return 0;
    const moved = Math.max(0, Math.min(Math.floor(amount), from[item] || 0, room));
    if (!moved) return 0;
    from[item] -= moved;
    to[item] = (to[item] || 0) + moved;
    if (!from[item] && from !== to) from[item] = 0;
    return moved;
}

// Clean a saved list of chests: [{id, items}]. Unknown items and bad counts
// are dropped, and a chest is never restored over its capacity.
export function sanitizeStores(saved, validId = () => true) {
    const stores = [], seen = new Set();
    for (const entry of Array.isArray(saved) ? saved : []) {
        if (!entry || !Number.isInteger(entry.id) || seen.has(entry.id) || !validId(entry.id)) continue;
        seen.add(entry.id);
        const items = {};
        let room = CHEST_CAPACITY;
        for (const [item, count] of Object.entries(entry.items && typeof entry.items === 'object' ? entry.items : {})) {
            const whole = Math.floor(Number(count));
            if (!ITEMS[item] || !(whole > 0) || room <= 0) continue;
            items[item] = Math.min(whole, room);
            room -= items[item];
        }
        stores.push({id: entry.id, items});
    }
    return stores;
}
