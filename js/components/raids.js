// The hunting pack: warns at dusk on the last night of a season, sends the
// pack at midnight, and settles up when it is broken, outlasted or outrun.
// The rules are in ../raids.js.
import { raidPhase, raidPack, raidReward, raidOutcome, raiderName, isRaidDay, nextRaidDay, RAID_RING, OUTLAST_XP, FIRST_WOLF, finalePack } from '../raids.js';
import { LEGEND_LIST } from '../legends.js';
import { WOLF_BITE } from '../creatures.js';
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
        this.crowned = 0;    // The day the First Wolf was broken, or 0.
    }

    // Is the last hunt due? Every frontier legend slain, and the First Wolf not yet broken.
    get finaleDue() {
        const slain = this.game.legends?.slain;
        return !this.crowned && Boolean(slain) && LEGEND_LIST.every(legend => slain.has(legend.id));
    }
    // The pack that will come tonight.
    plan() {
        const extra = difficultyOf(this.game.settings).pack;
        return this.finaleDue ? finalePack(extra) : raidPack(this.game.dayCount, this.region, extra);
    }
    // The First Wolf, while it is on you: for the bar across the top of the screen.
    get boss() {
        const first = this.fight?.first;
        return first && first.health > 0 && this.game.animalSystem.animals.includes(first) ? {legend: {name: FIRST_WOLF.name}, animal: first} : null;
    }

    get region() { return this.game.regions?.current || 'meadow'; }
    get underground() { return Boolean(this.game.dungeonSystem?.active); }
    // The day the next pack comes, for the map.
    // The next pack night: tonight, unless tonight's pack has already been.
    get next() { const day = this.game.dayCount; return nextRaidDay(this.struck === day ? day + 1 : day); }

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
        const game = this.game, pack = this.plan();
        game.audio?.play('growl');
        if (pack.finale) {
            game.uiSystem?.showDayBanner?.(`${FIRST_WOLF.name} is hunting tonight`,
                `The Greenwood's own legend comes at midnight with ${pack.size - 1} of its pack · there will be no sleeping`, false, true);
            return;
        }
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
        const region = this.region, pack = this.plan(), terrain = game.terrainSystem;
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
            if (one.first) {
                // A legend, not a tier: its numbers are its own.
                animal.health = animal.maxHealth = FIRST_WOLF.health;
                animal.damageScale = FIRST_WOLF.bite / WOLF_BITE;
                animal.mesh.scaling.setAll(FIRST_WOLF.size);
                animal.first = true;
                animal.title = 'the First Wolf';
            }
            animals.push(animal);
        });
        this.fight = {day, region, pack, animals, finale: Boolean(pack.finale), first: animals.find(animal => animal.first) || null};
        game.audio?.play(pack.finale ? 'roar' : 'growl');
        game.uiSystem?.showNotification?.(pack.finale ? `${FIRST_WOLF.name} is here` : `The pack is here · ${pack.size} ${raiderName(pack.kind, pack.size)}`);
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
        // When the First Wolf falls, the rest of its pack scatter.
        if (outcome === 'broken' || (fight.finale && fight.first && fight.first.health <= 0)) return this.end('broken');
        // Dawn: whatever is left gives up. Checked before 'escaped', because
        // sunrise itself sends distant wolves away.
        if (game.dayCount !== fight.day) return this.end('outlasted');
        if (outcome !== 'fighting') return this.end('escaped');
    }

    // Called for everything the player kills.
    onKill(animal) {
        if (!this.fight || !this.fight.animals.includes(animal)) return;
        if (animal.first) return;   // The rest are about to scatter.
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
        if (result === 'broken' && fight.finale) {
            this.crowned = fight.day;
            const player = game.playerSystem.camera.position, x = player.x + 1.2, z = player.z + 1.2;
            const item = game.gear?.dropRoll?.(new BABYLON.Vector3(x, game.terrainSystem.getPerlinHeight(x, z), z),
                {level: Math.max(FIRST_WOLF.level, game.combatSystem?.level || 1), luck: .4, slot: FIRST_WOLF.reward.slot, minRarity: 'legendary'});
            if (item && typeof item === 'object') item.name = FIRST_WOLF.reward.name;
            game.combatSystem?.gainExperience?.(FIRST_WOLF.xp);
            game.progression?.record?.('raids');
            game.progression?.record?.('firstWolf');
            game.audio?.play('levelup');
            game.uiSystem?.showDayBanner?.(`${FIRST_WOLF.name} is broken`, `${FIRST_WOLF.reward.name} lies where it fell · the Wilds are yours`, false, true);
            game.uiSystem?.showEnding?.();
        } else if (result === 'broken') {
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

    capture() { return this.crowned ? {warned: this.warned, struck: this.struck, crowned: this.crowned} : {warned: this.warned, struck: this.struck}; }

    // A fight is not saved: a pack that was on you when you left has moved on.
    restore(saved) {
        const day = value => Number.isInteger(value) && value >= 0 && value < 1e7 ? value : 0;
        this.warned = day(saved?.warned);
        this.struck = day(saved?.struck);
        this.crowned = day(saved?.crowned);
        this.fight = null;
    }
}
