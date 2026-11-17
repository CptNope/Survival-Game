// Legends: one great beast in each frontier region, with a lair you can find
// and a named piece of gear for whoever brings it down. Pure data and maths.
import { nearestRegion, regionStrength } from './regions.js';

export const WAKE_RADIUS = 60;   // Come this close to the lair and it stirs.
export const LEASH = 150;        // Flee this far and it goes home, healed.

export const LEGENDS = Object.freeze({
    tundra: {id: 'rime', region: 'tundra', kind: 'rime', name: 'Old Rime', epithet: 'the white alpha',
        reward: {slot: 'weapon', name: "Rime's Fang"}, summon: {kind: 'icewolf', count: 2, at: [.66, .33]}},
    desert: {id: 'tyrant', region: 'desert', kind: 'tyrant', name: 'The Sand Tyrant', epithet: 'king of scorpions',
        reward: {slot: 'armor', name: "Tyrant's Carapace"}, summon: {kind: 'scorpion', count: 2, at: [.5]}},
    marsh: {id: 'miremother', region: 'marsh', kind: 'miremother', name: 'Mother of the Mire', epithet: 'the great toad',
        reward: {slot: 'boots', name: 'Mirewalkers'}, summon: {kind: 'toad', count: 2, at: [.6, .3]}}
});
export const LEGEND_LIST = Object.freeze(Object.values(LEGENDS));
export const legendById = id => LEGEND_LIST.find(legend => legend.id === id) || null;

// Where a legend lives: well inside the patch of its region nearest the
// clearing, so the first frontier you reach is the one that holds it.
const lairs = new Map();
export function lairFor(regionId) {
    if (lairs.has(regionId)) return lairs.get(regionId);
    const edge = nearestRegion(0, 0, regionId);
    let lair = null;
    if (edge) {
        let {x, z} = edge;
        for (let n = 0; n < 40 && regionStrength(x, z, regionId) < 1; n++) { x += Math.sin(edge.bearing) * 12; z += Math.cos(edge.bearing) * 12; }
        // A little further in, if the region runs that deep.
        const fx = x + Math.sin(edge.bearing) * 45, fz = z + Math.cos(edge.bearing) * 45;
        lair = regionStrength(fx, fz, regionId) >= 1 ? {x: fx, z: fz} : {x, z};
    }
    lairs.set(regionId, lair);
    return lair;
}

// How many of the summoning marks (fractions of health, high to low) a fall
// from `before` to `after` has passed. `done` marks are already spent.
export function marksPassed(after, marks, done = 0) {
    let passed = done;
    while (passed < marks.length && after <= marks[passed]) passed++;
    return passed - done;
}
