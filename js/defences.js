// Camp defences: what a spike trap, a palisade and a watch fire do to the
// things that hunt you. Pure rules and geometry, no engine.
import { CREATURES } from './creatures.js';

// A spike trap hurts and staggers a hunter that steps on it, then needs a
// moment before it can catch another. It breaks after so many catches.
export const SPIKES = Object.freeze({damage: 14, every: 1, reach: 1.4, stagger: .5, catches: 10});
// A palisade stops hunters dead. Each one pushing at it tears it down a
// little; `health / batter` is how many seconds one hunter needs.
export const PALISADE = Object.freeze({health: 150, batter: 5, half: 2.2});
// Hunters near a watch fire are wary of it and move at this share of their pace.
export const WATCHFIRE = Object.freeze({reach: 9, pace: .7, warmth: 5});

export const DEFENCES = Object.freeze(['spikes', 'palisade', 'watchfire']);
// Small pieces may stand close to other structures; everything else keeps its distance.
export const SMALL_PIECES = Object.freeze(['spikes', 'watchfire', 'cookpot']);
export const SMALL_GAP = 2.5;

// The things defences work on: wolves and every creature with a mind to
// attack, above ground. Deer and rabbits walk through unharmed.
export function isHunter(animal) {
    if (!animal || animal.dungeon || !(animal.health > 0)) return false;
    return animal.kind === 'wolf' || Boolean(CREATURES[animal.kind]?.brain);
}

// The two ends of a palisade on the ground. A structure's rotation turns its
// long axis the way Babylon turns a mesh about the vertical.
export function palisadeEnds(record, half = PALISADE.half) {
    const cos = Math.cos(record.rotation || 0), sin = Math.sin(record.rotation || 0);
    return [{x: record.x - cos * half, z: record.z + sin * half}, {x: record.x + cos * half, z: record.z - sin * half}];
}

// Does a step from (x0, z0) to (x1, z1) cross the palisade?
export function crossesPalisade(record, x0, z0, x1, z1) {
    const [a, b] = palisadeEnds(record);
    const side = (px, pz, qx, qz, rx, rz) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
    const d1 = side(a.x, a.z, b.x, b.z, x0, z0), d2 = side(a.x, a.z, b.x, b.z, x1, z1);
    const d3 = side(x0, z0, x1, z1, a.x, a.z), d4 = side(x0, z0, x1, z1, b.x, b.z);
    return d1 * d2 < 0 && d3 * d4 < 0;
}

// How much of a palisade is left, 0 to 1.
export const palisadeLeft = record => Math.max(0, 1 - (record.wear || 0) / PALISADE.health);
// How many more catches a spike trap has in it.
export const spikesLeft = record => Math.max(0, SPIKES.catches - Math.floor(record.wear || 0));
