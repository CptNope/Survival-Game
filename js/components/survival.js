// Real-time survival needs. UI is updated by the HUD; values tick only while playing.
import { difficultyOf } from '../difficulty.js';
export const WATERSKIN_CAPACITY = 3;

export class SurvivalSystem {
    constructor(game) {
        this.game = game;
        this.hunger = 100;
        this.thirst = 100;
        this.cold = 0;
        this.water = 0; // Drinks carried in the waterskin.
        this.elapsed = 0;
        this.warningAt = -Infinity;
        this.warned = {};
    }

    static clamp(value, fallback = 100) {
        return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallback;
    }

    isNight() {
        const g = this.game;
        return Math.sin(g.dayTime / g.dayLength * 2 * Math.PI) <= 0.12;
    }

    nearWater() {
        const terrain = this.game.terrainSystem;
        const pos = this.game.playerSystem.camera.position;
        // Can collect water at the edge without stepping underwater.
        if (pos.y > terrain.waterHeight + 4 || this.game.dungeonSystem?.active) return false;
        return [[0,0],[3,0],[-3,0],[0,3],[0,-3]].some(([dx,dz]) =>
            terrain.isWaterArea(pos.x + dx, pos.z + dz));
    }

    hasWaterskin() {
        return this.game.inventorySystem?.inventory?.waterskin > 0;
    }

    drink() {
        if (this.game.paused || this.game.playerSystem.isDead) return false;
        const atShore = this.nearWater();
        if (atShore) {
            // Filling the waterskin is worthwhile even when not thirsty.
            const refill = this.hasWaterskin() && this.water < WATERSKIN_CAPACITY;
            if (this.thirst >= 99 && !refill) return false;
            const drank = this.thirst < 99;
            if (drank) this.thirst = Math.min(100, this.thirst + 40);
            if (refill) this.water = WATERSKIN_CAPACITY;
            this.game.uiSystem?.showNotification(refill
                ? (drank ? 'Drank water · Waterskin filled' : 'Waterskin filled')
                : 'Drank water · Thirst restored');
        } else if (this.hasWaterskin() && this.water > 0) {
            if (this.thirst >= 99) return false;
            this.water--;
            this.thirst = Math.min(100, this.thirst + 40);
            this.game.uiSystem?.showNotification(`Drank from the waterskin · ${this.water} left`);
        } else {
            this.game.uiSystem?.showNotification(this.hasWaterskin()
                ? 'The waterskin is empty · Refill it at a lake'
                : 'Find a lake shoreline to refill thirst');
            return false;
        }
        this.game.audio?.play('drink');
        this.game.saveSystem?.save();
        return true;
    }

    // Whether the player can rest until dawn, and the reason when they cannot.
    sleepStatus() {
        const game = this.game, player = game.playerSystem;
        if (game.dungeonSystem?.active) return {near: false, ok: false, reason: ''};
        if (!game.buildSystem?.nearBed?.(player.camera.position)) return {near: false, ok: false, reason: ''};
        if (!this.isNight()) return {near: true, ok: false, reason: 'You can rest here once night falls'};
        if (game.raids?.blocksSleep()) return {near: true, ok: false, reason: 'No sleeping with a pack hunting you'};
        if (player.isFlying || player.isSwimming) return {near: true, ok: false, reason: ''};
        const wolf = game.animalSystem?.animals?.some(animal => animal.kind === 'wolf' &&
            Math.hypot(animal.mesh.position.x - player.camera.position.x,
                animal.mesh.position.z - player.camera.position.z) < 24);
        if (wolf) return {near: true, ok: false, reason: 'Wolves are too close to rest'};
        return {near: true, ok: true, reason: ''};
    }

    // Rest in a shelter until sunrise: safe, but you wake hungry and thirsty.
    sleep() {
        const game = this.game, player = game.playerSystem;
        if (game.paused || player.isDead) return false;
        const status = this.sleepStatus();
        if (!status.ok) {
            if (status.reason) game.uiSystem?.showNotification(status.reason);
            return false;
        }
        this.hunger = Math.max(8, this.hunger - 14);
        this.thirst = Math.max(8, this.thirst - 18);
        this.cold = 0;
        player.health = Math.min(player.maxHealth, player.health + 30);
        game.audio?.play('sleep');
        game.progression?.record('slept');
        game.advanceToDawn?.('You slept until dawn');
        return true;
    }

    // E / USE: rest when a bed is ready, otherwise drink.
    interact() {
        if (this.game.paused || this.game.playerSystem.isDead) return false;
        // Doors, stairs and chests come first: they are what you walked up to.
        const special = this.game.dungeonSystem?.interaction?.();
        if (special) {
            if (special.act) return special.act() !== false;
            this.game.uiSystem?.showNotification(special.label);
            return false;
        }
        // A garden bed underfoot: plant it, or pick what has ripened.
        const garden = this.game.gardens?.interaction?.();
        if (garden?.act) return garden.act() !== false;
        // A stray at the fire, or a storage chest.
        const stray = this.game.companion?.interaction?.();
        if (stray?.act) return stray.act() !== false;
        const chest = this.game.storage?.interaction?.();
        if (chest?.act) return chest.act() !== false;
        // A watchtower to climb, a waystone to wake, a haven to use.
        const place = this.game.pois?.interaction?.();
        if (place?.act) return place.act() !== false;
        const sleep = this.sleepStatus();
        const thirsty = this.thirst < 60 && (this.nearWater() || (this.hasWaterskin() && this.water > 0));
        if (sleep.ok && !thirsty) return this.sleep();
        if (sleep.near && sleep.reason && !this.nearWater() && !(this.hasWaterskin() && this.water > 0)) {
            this.game.uiSystem?.showNotification(sleep.reason);
            return false;
        }
        return this.drink();
    }

    eatBerries(amount = 28) {
        this.hunger = Math.min(100, this.hunger + amount);
    }

    warn(key, active, message) {
        if (!active) { this.warned[key] = false; return; }
        if (this.warned[key]) return;
        this.warned[key] = true;
        this.game.uiSystem?.showNotification?.(message);
    }

    update(dt) {
        const player = this.game.playerSystem;
        if (this.game.paused || player.isDead) return;
        dt = Math.min(Math.max(Number.isFinite(dt) ? dt : 0, 0), .05);
        if (dt <= 0) return;
        const sprinting = Boolean(player.keys?.sprint && !player.isFlying);
        const gear = this.game.gear;
        const perks = this.game.perks, regions = this.game.regions;
        // The season only reaches the surface.
        const seasons = this.game.dungeonSystem?.active ? null : this.game.seasons;
        // Gentle and Harsh slow or quicken every need.
        const needs = difficultyOf(this.game.settings).needs;
        const appetite = (1 - (gear?.stat('endurance') || 0) / 100) * (1 - (perks?.value('appetite') || 0)) * needs;
        this.hunger = Math.max(0, this.hunger - dt * (sprinting ? .065 : .045) * appetite);
        // The desert sun doubles thirst; its nights are no worse than anywhere.
        this.thirst = Math.max(0, this.thirst - dt * (sprinting ? .15 : .09) * appetite * (regions?.thirstFactor(this.isNight()) || 1)
            * (seasons?.thirst(this.isNight()) ?? 1));
        // Underground there is no weather: the cold neither bites nor lifts.
        const underground = Boolean(this.game.dungeonSystem?.active);
        const safe = !underground && (this.game.buildSystem?.isProtected(player.camera.position) || false);
        const night = this.isNight();
        const storm=this.game.weatherSystem?.type === 'storm';
        const rain=this.game.weatherSystem?.type === 'rain';
        const exposed=!safe && !underground;
        // A lit torch takes the edge off the chill but is no substitute for a fire.
        const torch = this.game.effects?.torchLit ? .7 : 1;
        // Most dungeons are merely cool; a frozen vault chills unless a torch is lit.
        const chill = this.game.dungeonSystem?.theme?.chill ?? -.25;
        // Whatever keeps the cold out: gear, a fur cloak and the Insulated perk.
        const shield = (1 - (gear?.stat('warmth') || 0) / 100) * (this.game.inventorySystem?.inventory?.furCloak > 0 ? .5 : 1)
            * (1 - (perks?.value('insulation') || 0)) * (this.game.buffs?.factor('cold') || 1);
        // Weather chills anywhere; Frostfell chills even on a clear day.
        // Summer nights are mild, and winter is cold even at noon.
        const weather = night || storm || rain ? .65 * (night ? seasons?.nightChill() ?? 1 : 1) + (storm ? .85 : rain ? .3 : 0) : 0;
        const surface = exposed ? weather + (regions?.coldRate(night) || 0) + (seasons?.chill() || 0) : 0;
        const coldRate = underground ? (chill > 0 ? chill * (torch < 1 ? .15 : 1) * shield * needs : chill)
            : surface > 0 ? surface * torch * shield * needs : -1.4;
        this.cold = SurvivalSystem.clamp(this.cold + dt * coldRate, 0);
        if (this.hunger <= 0) player.takeDamage(.65 * dt, 'starvation');
        if (this.thirst <= 0) player.takeDamage(1.2 * dt, 'thirst');
        if (this.cold >= 90) player.takeDamage(.7 * dt, 'the cold');
        this.warn('hunger', this.hunger < 20, 'You are starving · Eat berries or cooked meat');
        this.warn('thirst', this.thirst < 20, 'You are parched · Drink at a lake or from a waterskin');
        this.warn('cold', this.cold > 70, 'You are freezing · Reach a fire or shelter');
        this.elapsed += dt;
    }
}
