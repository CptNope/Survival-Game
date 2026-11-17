import { LEGENDS, LEGEND_LIST, WAKE_RADIUS, LEASH, lairFor, marksPassed } from '../legends.js';
import { CREATURES } from '../creatures.js';
import { V, ellipsoid, branch, finish, seededRandom } from '../models/wilderness.js';

const STONE = {tundra: [.72, .80, .88], desert: [.70, .52, .32], marsh: [.30, .36, .26]};

// A ring of standing stones round a heap of bones: you know a lair when you see one.
function createLairModel(scene, region) {
    const random = seededRandom(region.length * 977 + 5), stone = STONE[region] || [.5, .5, .5], bone = [.86, .83, .74], pieces = [];
    for (let n = 0; n < 6; n++) {
        const angle = n / 6 * Math.PI * 2 + .3, radius = 6.2, tall = 2.6 + random() * 1.8;
        const foot = V(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
        pieces.push(branch(scene, foot, foot.add(V((random() - .5) * .8, tall, (random() - .5) * .8)), .62, stone.map(c => c * (.85 + random() * .25)), random, .16));
    }
    for (let n = 0; n < 7; n++) {
        const angle = random() * Math.PI * 2, radius = random() * 1.6;
        const from = V(Math.cos(angle) * radius, .12, Math.sin(angle) * radius);
        pieces.push(branch(scene, from, from.add(V((random() - .5) * 1.3, .1 + random() * .25, (random() - .5) * 1.3)), .07, bone, random, .05));
    }
    pieces.push(ellipsoid(scene, 'lair-skull', V(0, .32, 0), V(.34, .28, .4), bone, random));
    const mesh = finish(scene, pieces, 'legend-lair');
    mesh.isPickable = false;
    return mesh;
}

// Wakes each region's legend when the player nears its lair, runs the fight
// (reinforcements, leash, health bar) and hands out the reward.
export class LegendSystem {
    constructor(game) {
        this.game = game;
        this.slain = new Set();
        this.active = null;     // {legend, animal, marks}
        this.markers = new Map();
        this.spots = new Map();
        this.timer = 0;
    }

    // The lair's exact spot, nudged out of any lake.
    lair(region) {
        if (this.spots.has(region)) return this.spots.get(region);
        const base = lairFor(region), terrain = this.game.terrainSystem;
        let spot = base ? {...base} : null;
        for (let n = 0; spot && n < 30 && terrain.isWaterArea?.(spot.x, spot.z); n++) spot = {x: base.x + (n + 1) * 9, z: base.z + (n % 2 ? 9 : -9) * (n + 1) / 2};
        this.spots.set(region, spot);
        return spot;
    }

    // The nearest legend still alive in a region the player has found.
    nearest(position) {
        let best = null;
        for (const legend of LEGEND_LIST) {
            if (this.slain.has(legend.id) || !this.game.regions?.discovered.has(legend.region)) continue;
            const spot = this.lair(legend.region);
            if (!spot) continue;
            const distance = Math.hypot(spot.x - position.x, spot.z - position.z);
            if (!best || distance < best.distance) best = {legend, distance, bearing: Math.atan2(spot.x - position.x, spot.z - position.z), ...spot};
        }
        return best;
    }

    wake(legend) {
        const game = this.game, spot = this.lair(legend.region);
        const animal = game.animalSystem.spawnAnimal(spot.x, game.terrainSystem.getPerlinHeight(spot.x, spot.z), spot.z, legend.kind);
        animal.legend = legend.id;
        this.active = {legend, animal, marks: 0};
        game.audio?.play(CREATURES[legend.kind].sound);
        game.uiSystem?.showDayBanner?.(legend.name, `${legend.epithet[0].toUpperCase()}${legend.epithet.slice(1)} wakes · Stand and fight, or run`, false, true);
        return animal;
    }

    // It goes home and licks its wounds: the next visit starts afresh.
    retire(reason) {
        const active = this.active;
        if (!active) return;
        const animals = this.game.animalSystem.animals, index = animals.indexOf(active.animal);
        if (index >= 0) animals.splice(index, 1);
        active.animal.mesh.dispose(false, true);
        this.active = null;
        if (reason) this.game.uiSystem?.showNotification?.(`${active.legend.name} ${reason}`);
    }

    onSlain(animal, position) {
        const game = this.game, legend = LEGEND_LIST.find(candidate => candidate.id === animal.legend);
        if (!legend) return;
        this.slain.add(legend.id);
        if (this.active?.animal === animal) this.active = null;
        // The reward: a legendary piece that carries the beast's name.
        const level = Math.max(3, game.combatSystem?.level || 1);
        const item = game.gear?.dropRoll?.(position, {level, luck: .4, slot: legend.reward.slot, minRarity: 'legendary'});
        if (item) item.name = legend.reward.name;
        game.audio?.play('levelup');
        game.uiSystem?.showDayBanner?.(`${legend.name} is slain`, `${legend.reward.name} lies where it fell`, false, true);
        game.progression?.check?.();
        game.saveSystem?.save?.();
    }

    update(dt) {
        const game = this.game;
        if (game.paused) return;
        this.timer -= dt;
        if (this.timer > 0) return;
        this.timer = .4;
        const underground = Boolean(game.dungeonSystem?.active), player = game.playerSystem, position = player.camera.position;
        for (const legend of LEGEND_LIST) {
            const spot = this.lair(legend.region);
            if (!spot) continue;
            const distance = underground ? Infinity : Math.hypot(spot.x - position.x, spot.z - position.z);
            // The stones stand whether or not their owner still lives.
            if (distance < 230 && !this.markers.has(legend.id)) {
                const mesh = createLairModel(game.scene, legend.region);
                mesh.position.set(spot.x, game.terrainSystem.getPerlinHeight(spot.x, spot.z), spot.z);
                mesh.computeWorldMatrix(true);
                game.registerModelShadow?.(mesh);
                this.markers.set(legend.id, mesh);
            } else if (distance > 270 && this.markers.has(legend.id)) {
                this.markers.get(legend.id).dispose(false, true);
                this.markers.delete(legend.id);
            }
            if (!this.active && !this.slain.has(legend.id) && distance < WAKE_RADIUS && !player.isDead) this.wake(legend);
        }
        const active = this.active;
        if (!active) return;
        const spot = this.lair(active.legend.region);
        if (underground || player.isDead || Math.hypot(spot.x - position.x, spot.z - position.z) > LEASH) {
            this.retire(player.isDead ? 'returns to its lair' : 'loses interest and returns to its lair');
            return;
        }
        // Reinforcements as it weakens.
        const summon = active.legend.summon, animal = active.animal;
        const due = marksPassed(animal.health / animal.maxHealth, summon.at, active.marks);
        for (let n = 0; n < due; n++) {
            active.marks++;
            for (let k = 0; k < summon.count; k++) {
                const angle = Math.random() * Math.PI * 2, x = animal.mesh.position.x + Math.sin(angle) * 4, z = animal.mesh.position.z + Math.cos(angle) * 4;
                const add = game.animalSystem.spawnAnimal(x, game.terrainSystem.getPerlinHeight(x, z), z, summon.kind);
                add.fleeTimer = 6; add.state = 'chase';
            }
            game.uiSystem?.showNotification?.(`${active.legend.name} calls for help`);
            game.audio?.play(CREATURES[active.legend.kind].sound);
        }
    }

    capture() { return [...this.slain]; }

    restore(saved) {
        this.retire();
        this.slain = new Set((Array.isArray(saved) ? saved : []).filter(id => LEGEND_LIST.some(legend => legend.id === id)));
    }
}

export { LEGENDS };
