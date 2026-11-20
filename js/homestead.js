// Fishing and gardening: the quiet half of the game. Pure rules and numbers.
import { grownDays, readyAt } from './seasons.js';
export const FISHING = Object.freeze({
    reach: 6,       // How far out the line lands.
    minWait: 2.5,   // Seconds before the earliest bite.
    maxWait: 7.5,
    window: 1.5,    // Seconds to strike once the float dips.
    tether: 3       // Walk this far from where you cast and the line comes in.
});

export const biteDelay = (random = Math.random) => FISHING.minWait + random() * (FISHING.maxWait - FISHING.minWait);

// What comes up on the hook. `bonus` is the Forager perk's chance of one more.
export function fishingCatch(random = Math.random, bonus = 0) {
    const roll = random();
    if (roll < .1) return {item: 'fiber', amount: 1, text: 'A clump of weed'};
    const big = roll > .88;
    return {item: 'fish', amount: (big ? 2 : 1) + (random() < bonus ? 1 : 0), text: big ? 'A fine catch' : 'A fish'};
}

// What can go in a garden bed: seed cost, days to ripen, and the harvest.
export const CROPS = Object.freeze({
    berries: {name: 'Berries', seed: 2, yield: 7, days: 1.5, colour: [.62, .12, .24]},
    herbs: {name: 'Herbs', seed: 2, yield: 6, days: 1.5, colour: [.48, .70, .34]},
    mushrooms: {name: 'Mushrooms', seed: 2, yield: 6, days: 2, colour: [.66, .25, .18]},
    cactusFruit: {name: 'Cactus fruit', seed: 1, yield: 4, days: 2.5, colour: [.82, .22, .38]}
});
export const CROP_IDS = Object.freeze(Object.keys(CROPS));

// The crop to plant from what is carried: whichever you hold the most of.
export function pickCrop(inventory) {
    let best = null;
    for (const id of CROP_IDS) {
        const held = inventory[id] || 0;
        if (held >= CROPS[id].seed && (!best || held > (inventory[best] || 0))) best = id;
    }
    return best;
}

// 0 when planted, 1 when ripe. `now` and `plantedAt` are in days. A bed
// grows at the season's pace: quick in spring, barely at all in winter.
export function growth(now, plantedAt, crop) {
    const days = CROPS[crop]?.days;
    return days ? Math.max(0, Math.min(1, grownDays(plantedAt, now) / days)) : 0;
}

// Seedling, growing or ripe: what the bed looks like.
export const growthStage = fraction => fraction >= 1 ? 2 : fraction >= .4 ? 1 : 0;

// "about 6 hours", "about a day": time left, in words. A game day is 24 hours.
export function ripeIn(now, plantedAt, crop) {
    const left = Math.max(0, readyAt(plantedAt, CROPS[crop]?.days || 0) - now) * 24;
    if (left <= 0) return 'now';
    if (left < 1.5) return 'about an hour';
    if (left < 20) return `about ${Math.round(left)} hours`;
    if (left < 30) return 'about a day';
    if (left < 42) return 'about a day and a half';
    return `about ${Math.round(left / 24)} days`;
}

// Clean a saved list of beds: {id, crop, plantedAt}.
export function sanitizeBeds(saved, validId = () => true) {
    const beds = [];
    const seen = new Set();
    for (const bed of Array.isArray(saved) ? saved : []) {
        if (!bed || !CROPS[bed.crop] || !Number.isFinite(bed.plantedAt) || !Number.isInteger(bed.id)) continue;
        if (seen.has(bed.id) || !validId(bed.id)) continue;
        seen.add(bed.id);
        beds.push({id: bed.id, crop: bed.crop, plantedAt: bed.plantedAt});
    }
    return beds;
}
