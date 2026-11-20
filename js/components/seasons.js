// The turning year: what season it is, what that does to the player, and
// when the land changes colour. The rules are in ../seasons.js; this only
// reads the clock and tells the terrain when to repaint.
import { seasonAt, seasonLook, dawnMessage, calendarLine, seasonChill, WILD_PLANTS } from '../seasons.js';

export class SeasonSystem {
    constructor(game) {
        this.game = game;
        this.timer = 0;
        this.queue = [];   // Chunks still wearing the old colours.
        this.look = seasonLook(this.now());
    }

    now() { return this.game.dayCount + this.game.dayTime / this.game.dayLength; }
    get at() { return seasonAt(this.game.dayCount); }
    get def() { return this.at.def; }
    get calendar() { return calendarLine(this.game.dayCount); }

    // Cold a second from the season, wherever the player is standing.
    chill() {
        const regions = this.game.regions;
        return seasonChill(this.at.id, regions?.current, regions?.strength ?? 1);
    }
    // How hard the ordinary night chill bites this season.
    nightChill() { return this.def.night; }
    thirst(night = false) { return night ? 1 : this.def.thirst; }
    // Extra from a gathered plant, a garden bed or a hunted animal.
    forage(type) { return WILD_PLANTS.includes(type) ? this.def.forage : 0; }
    gardenBonus() { return this.def.forage; }
    gameBonus() { return this.def.game; }

    // Repaint if the look has moved on. Returns true when it had.
    refresh(now = false) {
        const look = seasonLook(this.now());
        if (look.key === this.look.key) return false;
        this.look = look;
        const terrain = this.game.terrainSystem;
        if (!terrain) return true;
        terrain.pool?.retint(look.foliage);
        // Nearest ground first, so the change spreads out from the player.
        const cx = terrain.currentChunkX || 0, cz = terrain.currentChunkZ || 0;
        const distance = key => { const [x, z] = key.split(',').map(Number); return Math.max(Math.abs(x - cx), Math.abs(z - cz)); };
        this.queue = [...terrain.chunkMap.keys()].sort((a, b) => distance(a) - distance(b));
        if (now) this.flush();
        return true;
    }

    // Everything at once: for a restored save, where nobody is watching.
    flush() {
        const terrain = this.game.terrainSystem;
        for (const key of this.queue.splice(0)) {
            const chunk = terrain.chunkMap.get(key);
            if (chunk) terrain.recolorChunk(chunk);
        }
    }

    update(dt) {
        this.timer -= dt;
        if (this.timer <= 0) { this.timer = .5; this.refresh(); }
        // One chunk a frame, so a change of season never costs a hitch.
        const terrain = this.game.terrainSystem;
        while (this.queue.length) {
            const chunk = terrain.chunkMap.get(this.queue.shift());
            if (chunk) { terrain.recolorChunk(chunk); break; }
        }
    }

    // Called at each dawn. Returns what the day banner should say, if the
    // calendar has anything to say this morning.
    onNewDay() {
        const game = this.game, at = this.at;
        this.refresh();
        if (at.day === 1 && at.id === 'spring' && game.dayCount > 1 && !game.playerSystem?.isDead) {
            game.progression?.record('winters');
        }
        if (at.day === 1) game.audio?.play('discover');
        return dawnMessage(game.dayCount);
    }
}
