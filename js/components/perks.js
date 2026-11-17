import { PERKS, pointsFor, ranksSpent, perkValue, perkOffer, sanitizeRanks } from '../perks.js';

// Holds the perks the player has chosen and answers "how much of this bonus?"
// for the other systems, which ask through game.perks?.value(stat).
export class PerkSystem {
    constructor(game) {
        this.game = game;
        this.ranks = {};
    }

    spent() { return ranksSpent(this.ranks); }

    // Points still to spend. A save from before perks existed simply has them all.
    available() {
        return Math.max(0, pointsFor(this.game.combatSystem?.level || 1) - this.spent());
    }

    offer() { return this.available() > 0 ? perkOffer(this.ranks) : []; }

    value(stat) { return perkValue(this.ranks, stat); }

    choose(id) {
        if (!this.offer().includes(id)) return false;
        this.ranks[id] = (this.ranks[id] || 0) + 1;
        const game = this.game, perk = PERKS[id];
        if (perk.stat === 'health') {
            game.playerSystem.maxHealth += perk.per;
            game.playerSystem.health = Math.min(game.playerSystem.maxHealth, game.playerSystem.health + perk.per);
            game.uiSystem?.updateHealthUI?.(game.playerSystem.health, game.playerSystem.maxHealth);
        }
        game.audio?.play('perk');
        game.uiSystem?.showNotification?.(`${perk.name}${this.ranks[id] > 1 ? ' ' + 'I'.repeat(this.ranks[id]) : ''} · ${perk.text}`);
        game.uiSystem?.updateExperienceUI?.();
        game.saveSystem?.save?.();
        return true;
    }

    list() {
        return Object.entries(this.ranks).map(([id, rank]) => ({id, rank, ...PERKS[id]}));
    }

    capture() { return {...this.ranks}; }

    restore(saved) { this.ranks = sanitizeRanks(saved); }
}
