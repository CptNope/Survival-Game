import { REGIONS, FRONTIERS, regionAt, regionStrength, nearestRegion } from '../regions.js';

const DISCOVERY_XP = 60;

// Knows which region the player stands in, announces a new one, and tells
// survival and the sky how strongly its weather applies.
export class RegionSystem {
    constructor(game) {
        this.game = game;
        this.current = 'meadow';
        this.strength = 0;
        this.discovered = new Set(['meadow']);
        this.pending = null;    // A region must hold for two checks before it takes over.
        this.timer = 0;
        this.guideTimer = 0;
        this.guide = null;      // The nearest region not yet visited.
    }

    get def() { return REGIONS[this.current]; }

    // Extra cold per second from the region itself.
    coldRate(night = false) {
        return (this.def.cold || 0) * this.strength * (night ? 1.6 : 1);
    }

    // How much faster thirst builds here. The desert is only cruel by day.
    thirstFactor(night = false) {
        return 1 + ((this.def.thirst || 1) - 1) * this.strength * (night ? .25 : 1);
    }

    enter(id) {
        const game = this.game, def = REGIONS[id];
        this.current = id;
        if (this.discovered.has(id)) {
            game.uiSystem?.showNotification?.('Entering ' + def.name);
            return false;
        }
        this.discovered.add(id);
        this.guideTimer = 0;
        game.uiSystem?.showDayBanner?.(def.name, def.note, false, true);
        game.audio?.play('discover');
        game.combatSystem?.gainExperience?.(DISCOVERY_XP);
        game.progression?.check?.();
        game.saveSystem?.save?.();
        return true;
    }

    update(dt) {
        const game = this.game;
        if (game.paused || game.dungeonSystem?.active) return;
        this.timer -= dt;
        if (this.timer > 0) return;
        this.timer = .5;
        const position = game.playerSystem.camera.position;
        const here = regionAt(position.x, position.z);
        if (here !== this.current) {
            if (this.pending === here) { this.pending = null; this.enter(here); }
            else this.pending = here;
        } else this.pending = null;
        this.strength = regionStrength(position.x, position.z, this.current);
        // Point the way to somewhere new, refreshed every few seconds.
        this.guideTimer -= .5;
        if (this.guideTimer <= 0) {
            this.guideTimer = 4;
            this.guide = null;
            for (const id of FRONTIERS) {
                if (this.discovered.has(id)) continue;
                const spot = nearestRegion(position.x, position.z, id);
                if (spot && (!this.guide || spot.distance < this.guide.distance)) this.guide = {...spot, id, name: REGIONS[id].name};
            }
        }
    }

    capture() { return [...this.discovered]; }

    restore(saved) {
        this.discovered = new Set(['meadow']);
        if (Array.isArray(saved)) for (const id of saved) if (REGIONS[id]) this.discovered.add(id);
        const position = this.game.playerSystem?.camera?.position;
        // Start in the right region without re-announcing it.
        this.current = position ? regionAt(position.x, position.z) : 'meadow';
        this.discovered.add(this.current);
        this.strength = position ? regionStrength(position.x, position.z, this.current) : 0;
        this.pending = null;
        this.guideTimer = 0;
    }
}
