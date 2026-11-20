import { FISHING, biteDelay, fishingCatch, CROPS, pickCrop, growth, growthStage, ripeIn, sanitizeBeds } from '../homestead.js';
import { ITEMS } from '../resources.js';
import { V, ellipsoid, branch, finish, seededRandom } from '../models/wilderness.js';

// --- Fishing ------------------------------------------------------------------
// Stand at a shore with a rod, click to cast, click again when the float dips.
export class FishingSystem {
    constructor(game) {
        this.game = game;
        this.state = 'idle';   // idle, waiting or bite
        this.timer = 0;
        this.origin = null;    // Where the player stood to cast.
        this.float = null;
        this.clock = 0;
    }

    // The water to cast into: open water a few metres ahead, from dry ground.
    spot() {
        const game = this.game, player = game.playerSystem, terrain = game.terrainSystem;
        if (!(game.inventorySystem.inventory.fishingRod > 0) || game.dungeonSystem?.active) return null;
        if (player.isSwimming || player.isDead || player.isFlying) return null;
        const eye = player.camera.position, yaw = player.camera.rotation.y;
        if (terrain.isWaterArea(eye.x, eye.z)) return null;
        for (const reach of [FISHING.reach, FISHING.reach - 2]) {
            const x = eye.x + Math.sin(yaw) * reach, z = eye.z + Math.cos(yaw) * reach;
            if (terrain.isWaterArea(x, z)) return {x, z};
        }
        return null;
    }

    busy() { return this.state !== 'idle'; }

    hint() {
        if (this.state === 'bite') return 'A bite! Click now!';
        if (this.state === 'waiting') return 'Waiting for a bite · Click to reel in';
        return this.spot() ? 'Click to cast your line' : '';
    }

    // The primary action while fishing. Returns true when it used the click.
    act() {
        const game = this.game;
        if (this.state === 'bite') {
            const haul = fishingCatch(Math.random, game.perks?.value('forage') || 0);
            game.inventorySystem.inventory[haul.item] += haul.amount;
            game.uiSystem?.showNotification?.(`${haul.text} · +${haul.amount} ${ITEMS[haul.item].toLowerCase()}`);
            game.audio?.play('splash');
            if (haul.item === 'fish') {
                game.progression?.record('fish', haul.amount);
                game.combatSystem?.gainExperience?.(6);
            }
            game.uiSystem?.updateInventoryUI?.();
            this.stop();
            return true;
        }
        if (this.state === 'waiting') {
            game.uiSystem?.showNotification?.('You reel in too soon');
            this.stop();
            return true;
        }
        const spot = this.spot();
        if (!spot) return false;
        const eye = game.playerSystem.camera.position;
        this.state = 'waiting';
        this.timer = biteDelay();
        this.origin = {x: eye.x, z: eye.z};
        this.cast = spot;
        this.showFloat(spot);
        game.audio?.play('splash', {volume: .6});
        return true;
    }

    stop() {
        this.state = 'idle';
        this.origin = null;
        this.float?.setEnabled(false);
    }

    showFloat(spot) {
        if (!this.float) {
            const random = seededRandom(91);
            this.float = finish(this.game.scene, [
                ellipsoid(this.game.scene, 'float-top', V(0, .1, 0), V(.11, .13, .11), [.86, .16, .14], random),
                ellipsoid(this.game.scene, 'float-base', V(0, -.02, 0), V(.11, .1, .11), [.93, .92, .86], random)
            ], 'fishing-float');
            this.float.isPickable = false;
        }
        this.float.setEnabled(true);
        this.float.position.set(spot.x, this.game.terrainSystem.waterHeight, spot.z);
    }

    update(dt) {
        if (this.game.paused || this.state === 'idle') return;
        const game = this.game, player = game.playerSystem, eye = player.camera.position;
        this.clock += dt;
        if (player.isDead || player.isSwimming || Math.hypot(eye.x - this.origin.x, eye.z - this.origin.z) > FISHING.tether) {
            if (!player.isDead) game.uiSystem?.showNotification?.('You bring the line in');
            this.stop();
            return;
        }
        this.timer -= dt;
        const water = game.terrainSystem.waterHeight;
        if (this.state === 'waiting') {
            this.float.position.y = water + Math.sin(this.clock * 2.2) * .03;
            if (this.timer <= 0) {
                this.state = 'bite';
                this.timer = FISHING.window;
                game.audio?.play('bite');
            }
        } else {
            // The float is pulled under, hard.
            this.float.position.y = water - .12 + Math.sin(this.clock * 26) * .05;
            if (this.timer <= 0) {
                game.uiSystem?.showNotification?.('It got away');
                this.stop();
            }
        }
    }
}

// --- Gardening ----------------------------------------------------------------
function createCropModel(scene, crop, stage, seed) {
    const random = seededRandom(seed), def = CROPS[crop], leaf = [.26, .46, .22], pieces = [];
    const tall = [.16, .42, .62][stage];
    for (let row = -1; row <= 1; row += 2) for (let column = -1; column <= 1; column++) {
        const base = V(column * .78 + (random() - .5) * .16, .26, row * .42 + (random() - .5) * .12);
        pieces.push(branch(scene, base, base.add(V(0, tall, 0)), .05, leaf, random, .03));
        if (stage > 0) pieces.push(ellipsoid(scene, 'crop-leaves', base.add(V(0, tall, 0)), V(.17 + stage * .04, .13 + stage * .03, .17 + stage * .04), leaf.map(c => c * (.85 + random() * .3)), random));
        // Ripe: the crop's own colour shows all round each plant.
        if (stage === 2) for (let n = 0; n < 4; n++) {
            const angle = n * 1.6 + random();
            pieces.push(ellipsoid(scene, 'crop-fruit', base.add(V(Math.cos(angle) * .24, tall + .1 - n * .05, Math.sin(angle) * .24)), V(.1, .1, .1), def.colour, random));
        }
    }
    const mesh = finish(scene, pieces, 'garden-crop');
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    return mesh;
}

// What is planted in each garden bed, keyed by the bed's structure id.
export class GardenSystem {
    constructor(game) {
        this.game = game;
        this.beds = new Map();     // id -> {crop, plantedAt}
        this.meshes = new Map();   // id -> {mesh, stage}
        this.timer = 0;
    }

    // Time in days, fractions and all.
    now() { return this.game.dayCount + this.game.dayTime / this.game.dayLength; }

    bedNear(position, reach = 3.2) {
        let best = null, nearest = reach;
        for (const item of this.game.buildSystem.structures) {
            if (item.type !== 'garden') continue;
            const distance = Math.hypot(position.x - item.x, position.z - item.z);
            if (distance <= nearest) { nearest = distance; best = item; }
        }
        return best;
    }

    // What E does at a bed: a label for the hint, and an action if there is one.
    interaction() {
        const game = this.game;
        if (game.dungeonSystem?.active) return null;
        const bed = this.bedNear(game.playerSystem.camera.position);
        if (!bed) return null;
        const planted = this.beds.get(bed.id);
        if (!planted) {
            const crop = pickCrop(game.inventorySystem.inventory);
            return crop
                ? {label: `Press E to plant ${CROPS[crop].name.toLowerCase()} · uses ${CROPS[crop].seed}`, act: () => this.plant(bed, crop)}
                : {label: 'Empty bed · Carry berries, herbs, mushrooms or cactus fruit to plant'};
        }
        const def = CROPS[planted.crop];
        return growth(this.now(), planted.plantedAt, planted.crop) >= 1
            ? {label: `Press E to harvest ${def.name.toLowerCase()}`, act: () => this.harvest(bed)}
            : {label: `${def.name} growing · ripe in ${ripeIn(this.now(), planted.plantedAt, planted.crop)}`};
    }

    plant(bed, crop) {
        const game = this.game, pack = game.inventorySystem.inventory, def = CROPS[crop];
        if (this.beds.has(bed.id) || !def || (pack[crop] || 0) < def.seed) return false;
        pack[crop] -= def.seed;
        this.beds.set(bed.id, {crop, plantedAt: this.now()});
        this.refresh(bed);
        game.audio?.play('plant');
        game.uiSystem?.showNotification?.(`${def.name} planted · ripe in ${ripeIn(this.now(), this.now(), crop)}`);
        game.uiSystem?.updateInventoryUI?.();
        game.saveSystem?.save?.();
        return true;
    }

    harvest(bed) {
        const game = this.game, planted = this.beds.get(bed.id);
        if (!planted || growth(this.now(), planted.plantedAt, planted.crop) < 1) return false;
        const def = CROPS[planted.crop];
        // Autumn fills the beds: one more of whatever was planted.
        const amount = def.yield + (Math.random() < (game.perks?.value('forage') || 0) ? 1 : 0) + (game.seasons?.gardenBonus() || 0);
        game.inventorySystem.inventory[planted.crop] += amount;
        this.beds.delete(bed.id);
        this.refresh(bed);
        game.audio?.play('pluck');
        game.uiSystem?.showNotification?.(`Harvested +${amount} ${ITEMS[planted.crop].toLowerCase()}`);
        game.progression?.record('harvests');
        game.combatSystem?.gainExperience?.(8);
        game.uiSystem?.updateInventoryUI?.();
        game.saveSystem?.save?.();
        return true;
    }

    // Bring one bed's plants in line with what is planted and how far along it is.
    refresh(bed) {
        const planted = this.beds.get(bed.id), shown = this.meshes.get(bed.id);
        const position = this.game.playerSystem.camera.position;
        const near = Math.hypot(position.x - bed.x, position.z - bed.z) < 125;
        const stage = planted && near ? growthStage(growth(this.now(), planted.plantedAt, planted.crop)) : -1;
        if (shown && (stage < 0 || shown.stage !== stage || shown.crop !== planted.crop)) {
            shown.mesh.dispose(false, true);
            this.meshes.delete(bed.id);
        }
        if (stage >= 0 && !this.meshes.has(bed.id)) {
            const mesh = createCropModel(this.game.scene, planted.crop, stage, bed.id * 31 + stage);
            mesh.position.set(bed.x, bed.y, bed.z);
            mesh.rotation.y = bed.rotation || 0;
            this.meshes.set(bed.id, {mesh, stage, crop: planted.crop});
        }
    }

    update(dt) {
        this.timer -= dt;
        if (this.timer > 0) return;
        this.timer = 1;
        for (const bed of this.game.buildSystem.structures) if (bed.type === 'garden') this.refresh(bed);
    }

    capture() { return [...this.beds].map(([id, bed]) => ({id, crop: bed.crop, plantedAt: bed.plantedAt})); }

    restore(saved) {
        for (const shown of this.meshes.values()) shown.mesh.dispose(false, true);
        this.meshes.clear();
        const gardens = new Set(this.game.buildSystem.structures.filter(item => item.type === 'garden').map(item => item.id));
        this.beds = new Map(sanitizeBeds(saved, id => gardens.has(id)).map(bed => [bed.id, {crop: bed.crop, plantedAt: bed.plantedAt}]));
        this.timer = 0;
    }
}
