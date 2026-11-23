// The hunting pack. On the last night of every season a pack comes for the
// player at midnight, wherever they are above ground. Pure rules: when, how
// many, how strong, and what breaking it is worth.
import { SEASON_DAYS, seasonAt } from './seasons.js';
import { DENS } from './pois.js';

// Fractions of the day. Night falls at about .48, so the warning comes first.
export const WARN_AT = .47;
export const STRIKE_AT = .75;       // Midnight.
export const RAID_RING = 22;        // How far out the pack appears, in metres.
export const RAID_SIGHT = 60;       // A pack on the hunt does not lose you easily.
export const OUTLAST_XP = 15;

// What hunts in each region.
export const RAIDERS = Object.freeze({meadow: 'wolf', tundra: 'icewolf', desert: 'scorpion', marsh: 'toad'});
const NAMES = {wolf: ['wolf', 'wolves'], icewolf: ['ice wolf', 'ice wolves'], scorpion: ['scorpion', 'scorpions'], toad: ['bog toad', 'bog toads']};
export const raiderName = (kind, count) => (NAMES[kind] || [kind, kind + 's'])[count === 1 ? 0 : 1];

const whole = day => Math.max(1, Math.floor(Number.isFinite(day) ? day : 1));
// The pack comes on the last night of each season: days 3, 6, 9, 12 and on.
export const isRaidDay = day => whole(day) % SEASON_DAYS === 0;
// Which raid of the expedition a day's would be: 1 on day 3, 2 on day 6.
export const raidNumber = day => Math.floor(whole(day) / SEASON_DAYS);
// The next day a pack will come, today included.
export const nextRaidDay = day => Math.ceil(whole(day) / SEASON_DAYS) * SEASON_DAYS;

// Where the night stands: 'none' on an ordinary day, then 'quiet' until the
// warning, 'warned' until midnight, and 'strike' from then to dawn.
export function raidPhase(day, dayTime, dayLength) {
    if (!isRaidDay(day)) return 'none';
    const at = dayLength > 0 ? dayTime / dayLength : 0;
    return at >= STRIKE_AT ? 'strike' : at >= WARN_AT ? 'warned' : 'quiet';
}

// The pack that comes on a given day in a given region. It grows with every
// season survived, winter's is one stronger again, and from the second raid
// on it has an elite leader.
// `extra` is the difficulty's say: one fewer on Gentle, one more on Harsh,
// and never fewer than two.
export function raidPack(day, region = 'meadow', extra = 0) {
    const kind = RAIDERS[region] || RAIDERS.meadow, number = Math.max(1, raidNumber(day));
    const size = Math.max(2, Math.min(7, 2 + number) + (seasonAt(day).id === 'winter' ? 1 : 0) + (Number.isInteger(extra) ? extra : 0));
    const level = Math.min(6, 1 + Math.floor(number / 2));
    const leader = number >= 2;   // In the Greenwood the leader is an alpha wolf.
    return {kind, number, size, level, tier: 1 + (level - 1) * .5,
        members: Array.from({length: size}, (_, n) => ({kind, elite: leader && n === 0}))};
}

// What breaking the pack is worth: gear, the region's spoils, and experience.
export function raidReward(pack, region = 'meadow') {
    const spoils = region === 'meadow' || !DENS[region] ? {pelt: 2, rawMeat: 2} : DENS[region].spoils;
    return {xp: 40 + 15 * pack.level, gearLevel: pack.level + 1, luck: .4, spoils: {...spoils}};
}

// How the fight stands. Each member is {health, present}; `present` is false
// once the world has let go of it, whether it died or was left behind.
export function raidOutcome(members) {
    if (!members.length) return 'over';
    if (members.every(one => one.health <= 0)) return 'broken';
    return members.some(one => one.present && one.health > 0) ? 'fighting' : 'escaped';
}
