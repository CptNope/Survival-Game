// The hunting pack: warns at dusk on the last night of a season, sends the
// pack at midnight, and settles up when it is broken, outlasted or outrun.
// The rules are in ../raids.js.
import { raidPhase, raidPack, raidReward, raidOutcome, raiderName, isRaidDay, nextRaidDay, RAID_RING, OUTLAST_XP } from '../raids.js';
import { rollGear } from '../gear.js';
import { itemAmount } from '../resources.js';
import { difficultyOf } from '../difficulty.js';

export class RaidSystem {
    constructor(game) {
        this.game = game;
        this.timer = 0;
        this.warned = 0;     // The last raid day the warning was given on.
        this.struck = 0;     // The last raid day the pack came, or passed by.
        this.fight = null;   // {day, region, pack, animals} while the pack is on you.
    }

    get region() { return this.game.regions?.current || 'meadow'; }
    get underground() { return Boolean(this.game.dungeonSystem?.active); }
    // The day the next pack comes, for the map.
    get next() { return nextRaidDay(this.game.dayCount); }

    // From the warning until the pack is dealt with, there is no sleeping.
    blocksSleep() {
        const game = this.game;
        if (this.fight) return true;
        return isRaidDay(game.dayCount) && this.struck !== game.dayCount
            && raidPhase(game.dayCount, game.dayTime, game.dayLength) !== 'quiet';
    }

    update(dt) {
        this.timer -= dt;
        if (this.timer > 0) return;
        this.timer = .5;
        const game = this.game, day = game.dayCount;
        if (this.fight) return this.tend();
        const phase = raidPhase(day, game.dayTime, game.dayLength);
        if (phase === 'none' || phase === 'quiet' || this.struck === day) return;
        if (this.warned !== day) {
            this.warned = day;
            if (!this.underground && !game.playerSystem.isDead) this.warn();
        }
        if (phase === 'strike') this.strike();
    }

    warn() {
        const game = this.game, pack = raidPack(game.dayCount, this.region, difficultyOf(game.settings).pack);
        game.audio?.play('growl');
        game.uiSystem?.showDayBanner?.('A pack is hunting tonight',
            `${pack.size} ${raiderName(pack.kind, pack.size)} will come for you at midnight · there will be no sleeping until they are dealt with`, false, true);
    }

    // Midnight. Underground or dead, the pack finds no one and moves on.
    strike() {
        const game = this.game, day = game.dayCount;
        this.struck = day;
        if (this.underground || game.playerSystem.isDead) {
            game.saveSystem?.save?.();
            return null;
        }
        const region = this.region, pack = raidPack(day, region, difficultyOf(game.settings).pack), terrain = game.terrainSystem;
        const player = game.playerSystem.camera.position, animals = [];
        pack.members.forEach((one, n) => {
            // Spread round the player, nudged along the ring off any water.
            let angle = n / pack.size * Math.PI * 2 + day, x = 0, z = 0;
            for (let tries = 0; tries < 12; tries++, angle += .5) {
                x = player.x + Math.sin(angle) * RAID_RING; z = player.z + Math.cos(angle) * RAID_RING;
                if (!terrain.isWaterArea(x, z)) break;
            }
            const animal = game.animalSystem.spawnAnimal(x, terrain.getPerlinHeight(x, z), z, one.kind,
                {level: pack.level, tier: pack.tier, elite: one.elite});
            animal.raid = day;
            animals.push(animal);
        });
        this.fight = {day, region, pack, animals};
        game.audio?.play('growl');
        game.uiSystem?.showNotification?.(`The pack is here · ${pack.size} ${raiderName(pack.kind, pack.size)}`);
        return this.fight;
    }

    // How many of the pack are still on their feet.
    left() {
        const animals = this.game.animalSystem.animals;
        return this.fight ? this.fight.animals.filter(animal => animal.health > 0 && animals.includes(animal)).length : 0;
    }

    tend() {
        const game = this.game, fight = this.fight, animals = game.animalSystem.animals;
        if (game.playerSystem.isDead) return this.end('lost');
        const outcome = raidOutcome(fight.animals.map(animal => ({health: animal.health, present: animals.includes(animal)})));
        if (outcome === 'broken') return this.end('broken');
        // Dawn: whatever is left gives up. Checked before 'escaped', because
        // sunrise itself sends distant wolves away.
        if (game.dayCount !== fight.day) return this.end('outlasted');
        if (outcome !== 'fighting') return this.end('escaped');
    }

    // Called for everything the player kills.
    onKill(animal) {
        if (!this.fight || !this.fight.animals.includes(animal)) return;
        const left = this.fight.animals.filter(one => one !== animal && one.health > 0 && this.game.animalSystem.animals.includes(one)).length;
        if (left) this.game.uiSystem?.showNotification?.(`${left} of the pack left`);
    }

    end(result) {
        const game = this.game, fight = this.fight;
        this.fight = null;
        // Whoever is still alive slinks off.
        for (const animal of fight.animals) {
            const index = game.animalSystem.animals.indexOf(animal);
            if (index < 0 || animal.health <= 0) continue;
            animal.mesh?.dispose(false, true);
            game.animalSystem.animals.splice(index, 1);
        }
        if (result === 'broken') {
            const pay = raidReward(fight.pack, fight.region), player = game.playerSystem.camera.position;
            const x = player.x + 1.2, z = player.z + 1.2;
            game.gear?.dropRoll?.(new BABYLON.Vector3(x, game.terrainSystem.getPerlinHeight(x, z), z),
                {level: pay.gearLevel, luck: pay.luck + (game.perks?.value?.('luck') || 0)});
            for (const [item, amount] of Object.entries(pay.spoils)) game.inventorySystem.inventory[item] += amount;
            game.combatSystem?.gainExperience?.(pay.xp);
            game.progression?.record?.('raids');
            game.audio?.play('levelup');
            game.uiSystem?.updateInventoryUI?.();
            game.uiSystem?.showDayBanner?.('The pack is broken',
                `${Object.entries(pay.spoils).map(([item, amount]) => itemAmount(item, amount)).join(' and ')}, and something they were carrying · the next comes on day ${nextRaidDay(fight.day + 1)}`, false, true);
        } else if (result === 'outlasted') {
            game.combatSystem?.gainExperience?.(OUTLAST_XP);
            game.uiSystem?.showNotification?.(`Dawn · what is left of the pack gives up · +${OUTLAST_XP} XP`);
        } else if (result === 'escaped') {
            game.uiSystem?.showNotification?.('You have lost the pack');
        }
        game.saveSystem?.save?.();
        return result;
    }

    capture() { return {warned: this.warned, struck: this.struck}; }

    // A fight is not saved: a pack that was on you when you left has moved on.
    restore(saved) {
        const day = value => Number.isInteger(value) && value >= 0 && value < 1e7 ? value : 0;
        this.warned = day(saved?.warned);
        this.struck = day(saved?.struck);
        this.fight = null;
    }
}
