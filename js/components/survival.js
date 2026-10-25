// Real-time survival needs. UI is updated by the HUD; values tick only while playing.
export class SurvivalSystem {
    constructor(game) {
        this.game = game;
        this.hunger = 100;
        this.thirst = 100;
        this.cold = 0;
        this.elapsed = 0;
        this.warningAt = -Infinity;
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
        if (pos.y > terrain.waterHeight + 4) return false;
        return [[0,0],[3,0],[-3,0],[0,3],[0,-3]].some(([dx,dz]) =>
            terrain.isWaterArea(pos.x + dx, pos.z + dz));
    }

    drink() {
        if (this.game.paused || this.game.playerSystem.isDead) return false;
        if (!this.nearWater()) {
            this.game.uiSystem?.showNotification('Find a lake shoreline to refill thirst');
            return false;
        }
        if (this.thirst >= 99) return false;
        this.thirst = Math.min(100, this.thirst + 40);
        this.game.uiSystem?.showNotification('Drank water · Thirst restored');
        this.game.saveSystem?.save();
        return true;
    }

    eatBerries(amount = 28) {
        this.hunger = Math.min(100, this.hunger + amount);
    }

    update(dt) {
        const player = this.game.playerSystem;
        if (this.game.paused || player.isDead) return;
        dt = Math.min(Math.max(Number.isFinite(dt) ? dt : 0, 0), .05);
        if (dt <= 0) return;
        const sprinting = Boolean(player.keys?.sprint && !player.isFlying);
        this.hunger = Math.max(0, this.hunger - dt * (sprinting ? .065 : .045));
        this.thirst = Math.max(0, this.thirst - dt * (sprinting ? .15 : .09));
        const safe = this.game.buildSystem?.isProtected(player.camera.position) || false;
        const night = this.isNight();
        const storm=this.game.weatherSystem?.type === 'storm';
        const rain=this.game.weatherSystem?.type === 'rain';
        const exposed=!safe;
        const coldRate = exposed && (night || storm || rain)
            ? .65 + (storm ? .85 : rain ? .3 : 0) : -1.4;
        this.cold = SurvivalSystem.clamp(this.cold + dt * coldRate, 0);
        const damage = (this.hunger <= 0 ? .65 : 0) +
            (this.thirst <= 0 ? 1.2 : 0) + (this.cold >= 90 ? .7 : 0);
        if (damage) player.takeDamage(damage * dt);
        this.elapsed += dt;
    }
}
