// The lands beyond the home clearing. Two slow fields, temperature and
// moisture, decide what a place is; everything within HOME_RADIUS of the
// clearing stays meadow so an established camp never changes under its owner.
// Pure maths: no engine, so terrain, creatures, survival and tests agree.
export const HOME_RADIUS = 170;
const BLEND = 90; // Metres over which the frontier fades in.

export const REGIONS = Object.freeze({
    meadow: {id: 'meadow', name: 'The Greenwood', note: 'Mild weather and plenty to gather',
        ground: [[.30, .44, .23], [.43, .53, .27]], grass: [[.27, .43, .19], [.35, .49, .21], [.44, .51, .24], [.24, .36, .19]],
        tufts: 1, cold: 0, thirst: 1, fog: 1, tint: null},
    tundra: {id: 'tundra', name: 'Frostfell', note: 'Bitter cold by day and night · wear fur or carry fire',
        ground: [[.80, .85, .89], [.93, .95, .97]], grass: [[.62, .70, .72], [.74, .80, .82], [.55, .63, .62], [.84, .88, .90]],
        tufts: .3, cold: .55, thirst: 1, fog: 1.35, tint: [.86, .92, 1]},
    desert: {id: 'desert', name: 'Sunscar', note: 'Thirst comes quickly under the sun · cactus fruit holds water',
        ground: [[.74, .58, .36], [.86, .72, .46]], grass: [[.62, .55, .30], [.70, .60, .34], [.54, .50, .28], [.76, .66, .40]],
        tufts: .22, cold: 0, thirst: 2.1, fog: .8, tint: [1, .93, .78]},
    marsh: {id: 'marsh', name: 'Mirefen', note: 'Thick fog, mushrooms and things that spit',
        ground: [[.20, .27, .19], [.31, .34, .20]], grass: [[.20, .32, .17], [.27, .36, .16], [.33, .37, .18], [.16, .26, .16]],
        tufts: 1.25, cold: 0, thirst: 1, fog: 2.3, tint: [.78, .9, .76]}
});
export const REGION_IDS = Object.freeze(Object.keys(REGIONS));
export const FRONTIERS = Object.freeze(REGION_IDS.filter(id => id !== 'meadow'));

const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

// Slow fields, roughly -1.3..1.3.
export function temperature(x, z) {
    return Math.sin(x * .0041 + .9) * Math.cos(z * .0036 - 1.3) + .35 * Math.sin((x + z) * .0027 + 2.4);
}
export function moisture(x, z) {
    return Math.sin(x * .0033 - 2.2) * Math.cos(z * .0045 + .5) + .35 * Math.cos((x - z) * .0029 + .8);
}

// How much of each region a spot is. The four weights always sum to one, so
// colours and effects blend across a border instead of snapping.
export function regionWeights(x, z) {
    const frontier = smooth((Math.hypot(x, z) - HOME_RADIUS) / BLEND);
    if (frontier <= 0) return {meadow: 1, tundra: 0, desert: 0, marsh: 0};
    const heat = temperature(x, z);
    const tundra = frontier * smooth((-heat - .30) / .2);
    const desert = frontier * smooth((heat - .30) / .2);
    const marsh = frontier * smooth((moisture(x, z) - .38) / .2) * (1 - tundra) * (1 - desert);
    return {meadow: Math.max(0, 1 - tundra - desert - marsh), tundra, desert, marsh};
}

// The region a spot belongs to: whichever weighs most (meadow wins a tie).
export function regionAt(x, z) {
    const weights = regionWeights(x, z);
    let best = 'meadow';
    for (const id of FRONTIERS) if (weights[id] > weights[best]) best = id;
    return best;
}

// How strongly a region's weather applies here: nothing at its edge, full
// strength once properly inside.
export function regionStrength(x, z, id = regionAt(x, z)) {
    return id === 'meadow' ? 0 : smooth((regionWeights(x, z)[id] - .5) / .4);
}

// Ground colour for a spot before shores and heights are painted over it.
// `patch` (0..1) is the terrain's own light-and-dark mottling.
// `grounds` swaps in a season's colours for the regions that have them.
export function groundColor(x, z, patch, grounds = null) {
    // Sharpen the blend so the ground changes where the trees and wildlife
    // do (at half weight) instead of smearing sand far into the meadow.
    const raw = regionWeights(x, z), weights = {meadow: 1};
    for (const id of FRONTIERS) { weights[id] = smooth((raw[id] - .25) / .5); weights.meadow -= weights[id]; }
    weights.meadow = Math.max(0, weights.meadow);
    let r = 0, g = 0, b = 0;
    for (const id of REGION_IDS) {
        const weight = weights[id];
        if (weight <= 0) continue;
        const [low, high] = grounds?.[id] || REGIONS[id].ground;
        r += (low[0] + (high[0] - low[0]) * patch) * weight;
        g += (low[1] + (high[1] - low[1]) * patch) * weight;
        b += (low[2] + (high[2] - low[2]) * patch) * weight;
    }
    return [r, g, b];
}

// A stable 0..1 number for a spot, for choices that must not disturb the
// seeded sequence that places things (so old saves keep their gathered nodes).
export function spotHash(x, z, salt = 0) {
    let h = (Math.imul(Math.floor(x * 8), 374761393) ^ Math.imul(Math.floor(z * 8), 668265263) ^ Math.imul(salt + 1, 2246822519)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// What stands where a tree would stand in the meadow.
export function treeFor(x, z) {
    const region = regionAt(x, z), roll = spotHash(x, z, 1);
    if (region === 'tundra') return roll < .6 ? {type: 'tree', model: 'snowpine'} : null;
    if (region === 'desert') return roll < .3 ? {type: 'cactus'} : roll < .42 ? {type: 'tree', model: 'deadwood'} : null;
    if (region === 'marsh') return {type: 'tree', model: 'bogtree'};
    return {type: 'tree', model: null}; // The meadow keeps its own mix of pine and oak.
}

// What grows in a small-plant slot: the same plant, another, or nothing.
export function plantFor(type, x, z) {
    const region = regionAt(x, z);
    if (region === 'marsh' && type === 'berry') return 'mushroom';
    if (region === 'desert' && type === 'berry') return 'cactus';
    if (region === 'desert' && type === 'fiber' && spotHash(x, z, 2) < .5) return null;
    if (region === 'tundra' && type !== 'ore' && spotHash(x, z, 3) < .45) return null;
    return type;
}

// The wildlife of a region: what a spawn there may be, by time of day.
// `roll` is 0..1; the result is a creature id.
export function wildlifeFor(region, night, roll) {
    if (region === 'tundra') return roll < .5 ? 'icewolf' : roll < .8 ? 'deer' : 'rabbit';
    if (region === 'desert') return roll < (night ? .6 : .4) ? 'scorpion' : roll < .75 ? 'rabbit' : 'boar';
    if (region === 'marsh') return roll < .45 ? 'toad' : roll < .7 ? 'boar' : roll < .85 ? 'deer' : 'rabbit';
    return null; // The meadow keeps its own rules.
}

// The closest spot belonging to `id`, found by looking outward in rings.
// Returns {x, z, distance, bearing} or null when none lies within `reach`.
export function nearestRegion(x, z, id, reach = 1200, step = 60) {
    for (let radius = step; radius <= reach; radius += step) {
        const points = Math.max(12, Math.round(radius / 22));
        let best = null;
        for (let n = 0; n < points; n++) {
            const angle = n / points * Math.PI * 2;
            const px = x + Math.sin(angle) * radius, pz = z + Math.cos(angle) * radius;
            if (regionAt(px, pz) !== id) continue;
            // Prefer the point deepest inside, so the bearing leads into the region.
            const weight = regionWeights(px, pz)[id];
            if (!best || weight > best.weight) best = {x: px, z: pz, distance: radius, bearing: angle, weight};
        }
        if (best) return best;
    }
    return null;
}
