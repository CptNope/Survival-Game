// Timed boons granted by dungeon shrines. Each one multiplies something for a
// while; time only runs while the game is being played, and boons are saved.
export const BOONS = Object.freeze({
    fury: {label: 'Fury', text: '+30% damage', seconds: 120, damage: 1.3},
    stoneskin: {label: 'Stoneskin', text: '30% less damage taken', seconds: 120, defence: .7},
    haste: {label: 'Swiftness', text: '+20% move and swing speed', seconds: 120, speed: 1.2}
});

export class BuffSystem {
    constructor(game) {
        this.game = game;
        this.active = new Map(); // boon id -> seconds left
    }

    add(id, seconds = BOONS[id]?.seconds) {
        if (!BOONS[id] || !(seconds > 0)) return false;
        this.active.set(id, Math.max(this.active.get(id) || 0, seconds));
        return true;
    }

    has(id) { return (this.active.get(id) || 0) > 0; }

    // Combined multiplier for 'damage', 'defence' or 'speed'.
    factor(kind) {
        let value = 1;
        for (const id of this.active.keys()) value *= BOONS[id][kind] || 1;
        return value;
    }

    update(dt) {
        for (const [id, left] of this.active) {
            if (left - dt > 0) { this.active.set(id, left - dt); continue; }
            this.active.delete(id);
            this.game.uiSystem?.showNotification?.(`${BOONS[id].label} has faded`);
        }
    }

    // For the HUD: [{id, label, left}]
    list() {
        return [...this.active].map(([id, left]) => ({id, label: BOONS[id].label, text: BOONS[id].text, left}));
    }

    capture() { return Object.fromEntries(this.active); }

    restore(saved) {
        this.active.clear();
        for (const [id, left] of Object.entries(saved && typeof saved === 'object' ? saved : {})) {
            if (BOONS[id] && Number.isFinite(left) && left > 0) this.active.set(id, Math.min(left, 600));
        }
    }
}
