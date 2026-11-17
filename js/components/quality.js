import { QUALITY, AUTO, isQuality, startingLevel, hardwareScale, autoStep } from '../quality.js';

// Applies the graphics setting to the engine and, on Auto, watches the frame
// rate and trades resolution (then shadows) for smoothness.
export class QualitySystem {
    constructor(game) {
        this.game = game;
        this.touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
        const ceiling = startingLevel(this.touch);
        this.auto = {level: ceiling, scale: 1, slow: 0, fast: 0, ceiling};
        this.elapsed = 0;
        this.frames = 0;
        this.settle = 3;     // Seconds to ignore after a change, a pause or loading.
        this.frame = 0;
        this.fps = 0;
        this.apply();
    }

    get choice() { return isQuality(this.game.settings?.quality) ? this.game.settings.quality : 'auto'; }

    // The level actually in force, and the resolution scale on top of it.
    get level() { return this.choice === 'auto' ? this.auto.level : this.choice; }
    get scale() { return this.choice === 'auto' ? this.auto.scale : 1; }
    get preset() { return QUALITY[this.level]; }

    setChoice(choice) {
        if (!isQuality(choice)) return false;
        this.game.updateSettings({quality: choice});
        this.settle = 3; this.auto.slow = this.auto.fast = 0;
        this.apply();
        return true;
    }

    apply() {
        const game = this.game, preset = this.preset;
        const density = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
        game.engine?.setHardwareScalingLevel?.(hardwareScale(density, this.level, this.scale));
        if (game.sunLight) game.sunLight.shadowEnabled = preset.shadowEvery > 0;
        const map = game.shadowGenerator?.getShadowMap?.();
        if (map) map.refreshRate = Math.max(1, preset.shadowEvery || 1);
        if (game.terrainSystem) game.terrainSystem.coverScale = preset.cover;
    }

    // For the settings panel: "Auto · Medium, 85% resolution".
    describe() {
        const scale = this.scale < 1 ? `, ${Math.round(this.scale * 100)}% resolution` : '';
        const level = this.level[0].toUpperCase() + this.level.slice(1);
        return this.choice === 'auto' ? `Auto · ${level}${scale}` : level;
    }

    update(dt) {
        const game = this.game;
        if (this.choice !== 'auto') return;
        // Menus, loading and a hidden tab say nothing about how the game runs.
        if (game.paused || (typeof document !== 'undefined' && document.hidden) || !(dt > 0) || dt > .25) { this.elapsed = 0; this.frames = 0; this.settle = Math.max(this.settle, 1); return; }
        if (this.settle > 0) { this.settle -= dt; return; }
        this.elapsed += dt; this.frames++;
        if (this.elapsed < AUTO.window) return;
        this.fps = this.frames / this.elapsed;
        this.elapsed = 0; this.frames = 0;
        const next = autoStep(this.auto, this.fps);
        const changed = next.level !== this.auto.level || next.scale !== this.auto.scale;
        this.auto = next;
        if (changed) { this.apply(); this.settle = 1.5; }
    }
}
