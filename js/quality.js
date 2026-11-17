// Graphics quality: what each level costs, and the rule that moves the
// automatic setting up and down to hold a steady frame rate. Pure maths.
export const QUALITY_LEVELS = Object.freeze(['low', 'medium', 'high']);
export const QUALITY_CHOICES = Object.freeze(['auto', ...QUALITY_LEVELS]);
export const QUALITY_LABELS = Object.freeze({auto: 'Auto', low: 'Low', medium: 'Medium', high: 'High'});

// pixelRatio: the most device pixels drawn per CSS pixel. shadowEvery: draw
// the shadow map every Nth frame (0 = no shadows). cover: share of ground
// cover planted in newly loaded country.
export const QUALITY = Object.freeze({
    low: {pixelRatio: 1, shadowEvery: 0, cover: .45},
    medium: {pixelRatio: 1.5, shadowEvery: 2, cover: .75},
    high: {pixelRatio: 2, shadowEvery: 1, cover: 1}
});

export const AUTO = Object.freeze({
    window: 2,         // Seconds of frames per judgement.
    slow: 42,          // Below this many frames a second, ease off.
    fast: 57,          // At or above this, there is room to sharpen up.
    patience: 2,       // Slow windows in a row before easing off.
    confidence: 4,     // Fast windows in a row before sharpening.
    minScale: .6, step: .85
});

export const isQuality = value => QUALITY_CHOICES.includes(value);

// Where the automatic setting starts: phones and tablets a step lower.
export const startingLevel = touch => touch ? 'medium' : 'high';

// The engine's hardware scaling level (1 = one draw pixel per device pixel,
// 2 = half resolution each way) for a screen density, level and auto scale.
export function hardwareScale(devicePixelRatio, level, scale = 1) {
    const density = Math.max(1, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1);
    const drawn = Math.min(density, QUALITY[level].pixelRatio) * Math.max(AUTO.minScale, Math.min(1, scale));
    return Math.round(density / drawn * 100) / 100;
}

// One judgement of the automatic setting. `state` is {level, scale, slow,
// fast}; `fps` is the average over the last window. Returns the next state.
// Resolution gives way first because it costs the least to look at; only
// then does the level itself drop (losing shadows and some ground cover).
export function autoStep(state, fps) {
    const next = {...state};
    if (!(fps > 0)) return next;
    if (fps < AUTO.slow) {
        next.fast = 0;
        if (++next.slow < AUTO.patience) return next;
        next.slow = 0;
        if (next.scale > AUTO.minScale + 1e-6) next.scale = Math.max(AUTO.minScale, Math.round(next.scale * AUTO.step * 100) / 100);
        else if (next.level !== 'low') { next.level = QUALITY_LEVELS[QUALITY_LEVELS.indexOf(next.level) - 1]; next.scale = .85; }
    } else if (fps >= AUTO.fast) {
        next.slow = 0;
        if (++next.fast < AUTO.confidence) return next;
        next.fast = 0;
        if (next.scale < 1 - 1e-6) next.scale = Math.min(1, Math.round(next.scale / AUTO.step * 100) / 100);
        else if (next.level !== next.ceiling && QUALITY_LEVELS.indexOf(next.level) < QUALITY_LEVELS.indexOf(next.ceiling || 'high')) {
            next.level = QUALITY_LEVELS[QUALITY_LEVELS.indexOf(next.level) + 1];
            next.scale = AUTO.minScale + .15; // Come up gently: the new level costs more.
        }
    } else { next.slow = 0; next.fast = 0; }
    return next;
}
